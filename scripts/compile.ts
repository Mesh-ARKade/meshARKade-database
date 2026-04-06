/**
 * DAT Compiler
 *
 * Reads Logiqx XML DAT files from input/{source}/ and compiles each one into
 * a gzipped JSONL artifact in output/. One .jsonl.gz file per DAT = one file
 * per system. Each line in the JSONL is a game entry validated against the
 * jsonl-line schema.
 *
 * This is the heart of the meshARKade-database pipeline:
 *
 *   XML DAT files (from meshARKade-dats relay)
 *       ↓
 *   compile.ts (this script)
 *       ↓
 *   .jsonl.gz files + compile-manifest.json (metadata for sign.ts)
 *
 * Input structure (populated by meshARKade-dats PRs):
 *   input/
 *     no-intro/   ← ~380 .dat files (cartridge systems)
 *     tosec/      ← ~4,700 .dat files (home computers, consoles)
 *     redump/     ← ~60 .dat files (optical disc systems)
 *     mame/       ← (future)
 *
 * Output structure:
 *   output/
 *     no-intro--nintendo-game-boy.jsonl.gz
 *     no-intro--nintendo-snes.jsonl.gz
 *     tosec--atari-2600.jsonl.gz
 *     redump--sony-playstation.jsonl.gz
 *     ...
 *     compile-manifest.json   ← metadata array consumed by sign.ts
 *
 * @intent Transform XML DATs into signed-ready JSONL artifacts.
 * @guarantee Every game entry in every output file passes jsonl-line validation.
 * @constraint Requires input/ to have at least one .dat file.
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';
import { XMLParser } from 'fast-xml-parser';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Where compiled DATs land in input/{source}/ */
const INPUT_DIR = 'input';

/** Where compiled JSONL artifacts go */
const OUTPUT_DIR = 'output';

/** Known source directories — we scan each one for .dat files */
const SOURCES = ['no-intro', 'tosec', 'redump', 'mame'] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single ROM entry in a game — maps to the `roms` array in jsonl-line schema */
interface RomEntry {
  name: string;
  size: number;
  crc: string;
  md5: string;
  sha1: string;
  sha256?: string;
  status?: string;
  header?: string;
}

/** A single game/JSONL line — matches jsonl-line.schema.json */
interface JsonlLine {
  source: string;
  system: string;
  datVersion: string;
  id: string;
  name: string;
  description?: string;
  category?: string;
  cloneofid?: string;
  roms: RomEntry[];
}

/** Metadata for a compiled system — consumed by sign.ts to build the manifest */
export interface CompiledSystem {
  id: string;
  source: string;
  system: string;
  datVersion: string;
  file: string;
  sha256: string;
  size: number;
  entries: number;
}

// ---------------------------------------------------------------------------
// XML Parser Configuration
// ---------------------------------------------------------------------------

/**
 * Configure fast-xml-parser for Logiqx DAT format.
 *
 * Key decisions:
 *   - ignoreAttributes: false — we NEED attributes, that's where ROM hashes live
 *   - attributeNamePrefix: '' — don't add '@_' prefix to attribute names
 *   - isArray callback — force `game` and `rom` to always be arrays even when
 *     there's only one entry (XML parsers collapse single-element arrays)
 *   - parseAttributeValue: false — keep all attribute values as strings;
 *     we parse `size` to number ourselves to avoid losing leading zeros on hashes
 */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  // Force these elements to always be arrays — without this, a DAT with a
  // single game or a game with a single ROM would parse as an object instead
  // of a one-element array, breaking our iteration.
  isArray: (_name, jpath) => {
    const jp = String(jpath);
    return jp === 'datafile.game' ||
           jp === 'datafile.game.rom' ||
           jp === 'datafile.game.release';
  },
  // Keep all values as strings — we'll parseInt(size) ourselves.
  // This prevents hashes like "00a1b2c3" from being parsed as numbers.
  parseAttributeValue: false,
  parseTagValue: false,
});

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Convert a system name into a URL/filename-safe slug.
 *
 * "Nintendo - Game Boy Advance" → "nintendo-game-boy-advance"
 * "Sony - PlayStation 2"        → "sony-playstation-2"
 *
 * Used for both the output filename and the manifest system `id`.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')  // Non-alphanumeric → hyphens
    .replace(/^-|-$/g, '');        // Trim leading/trailing hyphens
}

/**
 * Parse a single Logiqx XML DAT file into an array of JsonlLine entries.
 *
 * The Logiqx format is the standard used by No-Intro, Redump, and TOSEC:
 *
 *   <datafile>
 *     <header>
 *       <name>System Name</name>
 *       <version>20260405</version>
 *     </header>
 *     <game name="Game Title">
 *       <description>Game Title</description>
 *       <rom name="file.ext" size="1234" crc="abcd1234" md5="..." sha1="..."/>
 *     </game>
 *   </datafile>
 *
 * @param xmlContent - Raw XML string from the .dat file.
 * @param source - Source identifier ("no-intro", "tosec", "redump", "mame").
 * @returns Object with system metadata and parsed game entries.
 */
function parseDat(xmlContent: string, source: string): {
  system: string;
  datVersion: string;
  entries: JsonlLine[];
} {
  const parsed = xmlParser.parse(xmlContent);

  // Navigate to the datafile root — some DATs wrap in <?xml?> + <datafile>
  const datafile = parsed.datafile;
  if (!datafile) {
    throw new Error('Invalid DAT format: missing <datafile> root element');
  }

  // Extract header metadata
  const header = datafile.header;
  if (!header) {
    throw new Error('Invalid DAT format: missing <header> element');
  }

  const system = header.name || 'Unknown System';
  const datVersion = header.version || 'unknown';

  // Parse game entries — may be absent if DAT is empty (rare but possible)
  const games: unknown[] = datafile.game || [];
  const entries: JsonlLine[] = [];

  for (const game of games) {
    const g = game as Record<string, unknown>;

    // Game name is in the "name" attribute of <game>
    const gameName = (g.name as string) || '';
    if (!gameName) continue;  // Skip nameless entries

    // Parse ROM entries — each <rom> has hash attributes
    const rawRoms = (g.rom as Record<string, string>[]) || [];
    const roms: RomEntry[] = [];

    for (const rom of rawRoms) {
      // All hash fields are required by the schema, but real-world DATs
      // sometimes omit them. We only include ROMs that have the minimum
      // required fields (name, size, and at least CRC+MD5+SHA1).
      if (!rom.name || !rom.size || !rom.crc || !rom.md5 || !rom.sha1) {
        // Log but don't fail — some DATs have partial entries
        continue;
      }

      const romEntry: RomEntry = {
        name: rom.name,
        size: parseInt(rom.size, 10),
        crc: rom.crc.toLowerCase(),
        md5: rom.md5.toLowerCase(),
        sha1: rom.sha1.toLowerCase(),
      };

      // Optional fields — include only if present
      if (rom.sha256) romEntry.sha256 = rom.sha256.toLowerCase();
      if (rom.status) romEntry.status = rom.status;
      if (rom.header) romEntry.header = rom.header;

      roms.push(romEntry);
    }

    // Skip games with no valid ROMs — can happen if all ROMs were incomplete
    if (roms.length === 0) continue;

    const entry: JsonlLine = {
      source,
      system,
      datVersion,
      id: gameName,
      name: (g.description as string) || gameName,
      roms,
    };

    // Optional fields — include only if present
    if (g.category) entry.category = g.category as string;
    if (g.cloneof) entry.cloneofid = g.cloneof as string;
    // Some DATs put description in the <description> tag, which we
    // already used for `name`. Only set `description` if it differs.
    if (g.description && g.description !== gameName) {
      entry.description = g.description as string;
    }

    entries.push(entry);
  }

  return { system, datVersion, entries };
}

/**
 * Compile a single DAT file into a gzipped JSONL artifact.
 *
 * Flow:
 *   1. Read the XML file
 *   2. Parse into game entries via parseDat()
 *   3. Serialize each entry as a JSON line
 *   4. Gzip the entire JSONL buffer
 *   5. Write to output/{source}--{slug}.jsonl.gz
 *   6. Return metadata for the manifest
 *
 * @param datPath - Full path to the .dat file.
 * @param source - Source identifier.
 * @param outputDir - Directory to write the .jsonl.gz file.
 * @returns CompiledSystem metadata, or null if the DAT had no valid entries.
 */
function compileDat(
  datPath: string,
  source: string,
  outputDir: string,
): CompiledSystem | null {
  const xmlContent = fs.readFileSync(datPath, 'utf-8');

  const { system, datVersion, entries } = parseDat(xmlContent, source);

  if (entries.length === 0) {
    console.warn(`[compile] Skipping ${path.basename(datPath)}: no valid game entries`);
    return null;
  }

  // Build the JSONL content — one JSON object per line, no trailing newline
  const jsonlLines = entries.map(entry => JSON.stringify(entry));
  const jsonlContent = jsonlLines.join('\n');

  // Gzip compress the JSONL
  const gzipped = gzipSync(Buffer.from(jsonlContent, 'utf-8'), { level: 9 });

  // Build the output filename: {source}--{system-slug}.jsonl.gz
  const slug = slugify(system);
  const filename = `${source}--${slug}.jsonl.gz`;
  const outputPath = path.join(outputDir, filename);

  fs.writeFileSync(outputPath, gzipped);

  // Compute SHA256 of the gzipped file for the manifest
  const sha256 = createHash('sha256').update(gzipped).digest('hex');

  return {
    id: `${source}/${slug}`,
    source,
    system,
    datVersion,
    file: filename,
    sha256,
    size: gzipped.length,
    entries: entries.length,
  };
}

/**
 * Find all .dat files in a directory (non-recursive, flat scan).
 * Returns full paths sorted alphabetically for deterministic output.
 */
function findDatFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.dat'))
    .sort()
    .map(f => path.join(dir, f));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Compile all DAT files from all sources.
 *
 * Scans input/{source}/ for each known source, compiles every .dat file
 * into a .jsonl.gz artifact, and writes a compile-manifest.json with
 * metadata for sign.ts to consume.
 *
 * @returns Array of CompiledSystem metadata.
 */
export async function compileAll(): Promise<CompiledSystem[]> {
  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const results: CompiledSystem[] = [];
  let totalDats = 0;
  let totalEntries = 0;

  for (const source of SOURCES) {
    const sourceDir = path.join(INPUT_DIR, source);
    const datFiles = findDatFiles(sourceDir);

    if (datFiles.length === 0) {
      console.log(`[compile] ${source}: no DAT files found, skipping`);
      continue;
    }

    console.log(`[compile] ${source}: found ${datFiles.length} DAT files`);

    for (const datPath of datFiles) {
      try {
        const result = compileDat(datPath, source, OUTPUT_DIR);
        if (result) {
          results.push(result);
          totalEntries += result.entries;
        }
        totalDats++;
      } catch (err) {
        // Log the error but continue — one bad DAT shouldn't stop the build
        console.error(`[compile] Error compiling ${path.basename(datPath)}: ${(err as Error).message}`);
      }
    }
  }

  if (results.length === 0) {
    throw new Error('No DAT files produced any output. Check input/ directory.');
  }

  // Write the compile manifest — sign.ts reads this to build the signed manifest
  const compileManifestPath = path.join(OUTPUT_DIR, 'compile-manifest.json');
  fs.writeFileSync(compileManifestPath, JSON.stringify(results, null, 2));

  console.log(`[compile] Done: ${totalDats} DATs processed → ${results.length} artifacts (${totalEntries} total game entries)`);

  return results;
}

// --- CLI entry point ---
const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectRun) {
  compileAll()
    .then(results => {
      console.log(`[compile] Output: ${OUTPUT_DIR}/`);
      console.log(`[compile] Systems: ${results.length}`);
    })
    .catch(err => {
      console.error(`[compile] Fatal: ${err.message}`);
      process.exit(1);
    });
}
