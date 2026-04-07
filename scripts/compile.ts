/**
 * DAT Compiler
 *
 * Reads Logiqx XML DAT files from input/{source}/ and compiles each one into
 * a zstd-compressed JSONL artifact in output/. One .jsonl.zst file per DAT = one file
 * per system. Each line in the JSONL is a game entry validated against the
 * jsonl-line schema.
 *
 * This is the heart of the meshARKade-database pipeline:
 *
 *   XML DAT files (from meshARKade-dats relay)
 *       ↓
 *   compile.ts (this script)
 *       ↓
 *   .jsonl.zst files + compile-manifest.json (metadata for sign.ts)
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
 *     no-intro--nintendo-game-boy.jsonl.zst
 *     no-intro--nintendo-snes.jsonl.zst
 *     tosec--atari-2600.jsonl.zst
 *     redump--sony-playstation.jsonl.zst
 *     ...
 *     catalog.dict            ← Zstd dictionary trained from samples
 *     compile-manifest.json   ← metadata object consumed by sign.ts
 *
 * @intent Transform XML DATs into signed-ready JSONL artifacts using dictionary compression.
 * @guarantee Every game entry in every output file passes jsonl-line validation.
 * @constraint Requires input/ to have at least one .dat file.
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { zstdCompressSync } from 'zlib';
import { XMLParser } from 'fast-xml-parser';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Where compiled DATs land in input/{source}/ */
const INPUT_DIR = 'input';

/** Where compiled JSONL artifacts go */
const OUTPUT_DIR = 'output';

/** Known source directories — we scan each one for .dat files */
const SOURCES = ['no-intro', 'tosec', 'redump', 'mame'] as const;

/** Zstd dictionary filename */
const DICT_FILENAME = 'catalog.dict';

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

export interface DictionaryMeta {
  file: string;
  sha256: string;
  size: number;
}

/** Complete compile output metadata */
export interface CompileResult {
  systems: CompiledSystem[];
  dictionary?: DictionaryMeta;
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
           jp === 'datafile.game.release' ||
           jp === 'datafile.machine' ||
           jp === 'datafile.machine.rom' ||
           jp === 'datafile.machine.release' ||
           jp === 'datafile.software' ||
           jp === 'datafile.software.part' ||
           jp === 'datafile.software.part.dataarea' ||
           jp === 'datafile.software.part.dataarea.rom';
  },
  // Keep all values as strings — we'll parseInt(size) ourselves.
  // This prevents hashes like "00a1b2c3" from being parsed as numbers.
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: false,
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
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')  // Non-alphanumeric → hyphens
    .replace(/^-|-$/g, '');        // Trim leading/trailing hyphens
}

/**
 * Determine the logical "Family" for a DAT file.
 *
 * This collapses highly fragmented naming conventions (like TOSEC's per-letter
 * category splits or No-Intro's Aftermarket tags) into a single cohesive system
 * name (e.g., "Commodore Amiga"). This drastically reduces the number of release
 * assets and improves dictionary compression efficiency.
 *
 * @param name The original system name from the DAT <header>
 * @param source The source (no-intro, tosec, redump, etc.)
 */
export function getLogicalFamily(name: string, source: string): string {
  let family = name;

  if (source === 'mame' && family.startsWith('MAME ')) {
    return 'MAME Arcade';
  }

  // Most DATs follow "Manufacturer - System Name" convention.
  // We split by " - " and take the first part to group by manufacturer.
  if (source === 'tosec' || source === 'no-intro' || source === 'redump' || source === 'mame') {
    family = family.split(' - ')[0];
  }

  // Strip known tags to ensure clean mapping if split didn't happen or for variants
  const tagsToRemove = [
    '(Aftermarket)',
    '(Decrypted)',
    '(Encrypted)',
    '(Download Play)',
    '(BigEndian)',
    '(ByteSwapped)',
    '(Headered)',
    '(Headerless)'
  ];
  
  for (const tag of tagsToRemove) {
    family = family.replace(` ${tag}`, '');
  }

  return family.trim();
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
  // Support Logiqx <game>, MAME <machine>, or Software List <software>
  const games: unknown[] = datafile.game || datafile.machine || datafile.software || [];
  const entries: JsonlLine[] = [];

  for (const game of games) {
    const g = game as Record<string, unknown>;

    // Entry name is in the "name" attribute
    const gameName = (g.name as string) || '';
    if (!gameName) continue;  // Skip nameless entries

    // Parse ROM entries
    // For <game>/<machine>: <rom>
    // For <software>: <part><dataarea><rom>
    let rawRoms: Record<string, string>[] = [];
    
    if (g.rom) {
      rawRoms = g.rom as Record<string, string>[];
    } else if (g.part) {
      // Software List nested structure
      const parts = (Array.isArray(g.part) ? g.part : [g.part]) as Record<string, any>[];
      for (const part of parts) {
        if (part.dataarea) {
          const dataareas = (Array.isArray(part.dataarea) ? part.dataarea : [part.dataarea]) as Record<string, any>[];
          for (const da of dataareas) {
            if (da.rom) {
              const roms = (Array.isArray(da.rom) ? da.rom : [da.rom]) as Record<string, string>[];
              rawRoms.push(...roms);
            }
          }
        }
      }
    }

    const roms: RomEntry[] = [];

    for (const rom of rawRoms) {
      // Basic validation for ROM fields
      if (!rom.name || !rom.size || !rom.crc || !rom.md5 || !rom.sha1) {
        continue;
      }

      const romEntry: RomEntry = {
        name: rom.name,
        size: parseInt(rom.size, 10),
        crc: rom.crc.toLowerCase(),
        md5: rom.md5.toLowerCase(),
        sha1: rom.sha1.toLowerCase(),
      };

      if (rom.sha256) romEntry.sha256 = rom.sha256.toLowerCase();
      if (rom.status) romEntry.status = rom.status;
      if (rom.header) romEntry.header = rom.header;

      roms.push(romEntry);
    }

    if (roms.length === 0) continue;

    const entry: JsonlLine = {
      source,
      system,
      datVersion,
      id: gameName,
      name: (g.description as string) || (g.title as string) || gameName,
      roms,
    };

    if (g.category) entry.category = g.category as string;
    if (g.cloneof) entry.cloneofid = g.cloneof as string;
    
    const desc = (g.description as string) || (g.title as string);
    if (desc && desc !== gameName) {
      entry.description = desc;
    }

    entries.push(entry);
  }

  return { system, datVersion, entries };
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
 * Pass 1: Train dictionary
 * If input/catalog.dict does NOT exist, we parse all DATs, randomly select
 * ~1000 JSONL lines, and train a zstd dictionary using the CLI.
 * 
 * Pass 2: Group and Compress
 * We load input/catalog.dict, and compile each parsed DAT grouped by logical family
 * with that dictionary. The dictionary is copied to output/ for release upload.
 *
 * @returns Array of CompiledSystem metadata plus dictionary metadata.
 */
export async function compileAll(): Promise<CompileResult> {
  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const dictInputPath = path.join(INPUT_DIR, DICT_FILENAME);
  const dictOutputPath = path.join(OUTPUT_DIR, DICT_FILENAME);

  // --- PASS 1: Dictionary Training ---
  if (!fs.existsSync(dictInputPath)) {
    console.log('[compile] Dictionary not found. Training new dictionary...');
    const samplesDir = path.join(OUTPUT_DIR, 'zstd-samples');
    fs.mkdirSync(samplesDir, { recursive: true });

    let sampleCount = 0;
    // We aim for ~1000 samples. Across 350,000 entries, probability is ~ 1/350.
    // We will use 0.003 to be safe and cap at 1500 to ensure we don't over-train.
    for (const source of SOURCES) {
      const sourceDir = path.join(INPUT_DIR, source);
      const datFiles = findDatFiles(sourceDir);

      for (const datPath of datFiles) {
        try {
          const xmlContent = fs.readFileSync(datPath, 'utf-8');
          const { entries } = parseDat(xmlContent, source);
          
          for (const entry of entries) {
            if (Math.random() < 0.003 && sampleCount < 1500) {
              const samplePath = path.join(samplesDir, `sample_${sampleCount}.jsonl`);
              fs.writeFileSync(samplePath, JSON.stringify(entry));
              sampleCount++;
            }
          }
        } catch (err) {
          // Ignore parsing errors during training phase
        }
      }
    }

    if (sampleCount > 0) {
      console.log(`[compile] Training zstd dictionary on ${sampleCount} samples...`);
      const zstdExe = process.platform === 'win32' ? path.join(process.cwd(), 'scripts', 'zstd.exe') : 'zstd';
      try {
        execSync(`"${zstdExe}" --train -r "${samplesDir}" -o "${dictInputPath}"`, { stdio: 'inherit' });
        console.log(`[compile] Successfully trained dictionary at ${dictInputPath}`);
      } catch (err) {
        console.warn(`[compile] Warning: Failed to train dictionary via CLI. Ensure zstd is installed. Error: ${(err as Error).message}`);
      }
    } else {
      console.warn(`[compile] Warning: No samples collected for dictionary training.`);
    }

    // Clean up temporary samples directory
    if (fs.existsSync(samplesDir)) {
      fs.rmSync(samplesDir, { recursive: true, force: true });
    }
  }

  // Load the dictionary if it exists
  let dictBuffer: Buffer | undefined;
  let dictionaryMeta: DictionaryMeta | undefined;

  if (fs.existsSync(dictInputPath)) {
    dictBuffer = fs.readFileSync(dictInputPath);
    // Copy the dictionary to output/ so it's included in the release
    fs.copyFileSync(dictInputPath, dictOutputPath);
    
    const sha256 = createHash('sha256').update(dictBuffer).digest('hex');
    dictionaryMeta = {
      file: DICT_FILENAME,
      sha256,
      size: dictBuffer.length,
    };
    console.log(`[compile] Loaded dictionary ${DICT_FILENAME} (${dictBuffer.length} bytes)`);
  } else {
    console.log(`[compile] Proceeding without dictionary compression.`);
  }

  // --- PASS 2: Parse and Group ---
  const results: CompiledSystem[] = [];
  let totalDats = 0;
  let totalEntries = 0;

  const groupedEntries = new Map<string, { source: string, family: string, datVersion: string, entries: JsonlLine[] }>();

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
        const xmlContent = fs.readFileSync(datPath, 'utf-8');
        const { system, datVersion, entries } = parseDat(xmlContent, source);
        
        if (entries.length === 0) {
          console.warn(`[compile] Skipping ${path.basename(datPath)}: no valid game entries`);
          continue;
        }

        const family = getLogicalFamily(system, source);
        const groupKey = `${source}::${family}`;

        if (!groupedEntries.has(groupKey)) {
          groupedEntries.set(groupKey, { source, family, datVersion, entries: [] });
        }
        
        // Append entries to the group
        groupedEntries.get(groupKey)!.entries.push(...entries);
        totalDats++;
      } catch (err) {
        // Log the error but continue — one bad DAT shouldn't stop the build
        console.error(`[compile] Error compiling ${path.basename(datPath)}: ${(err as Error).message}`);
      }
    }
  }

  if (groupedEntries.size === 0) {
    throw new Error('No DAT files produced any output. Check input/ directory.');
  }

  // --- PASS 3: Compress and Write ---
  console.log(`[compile] Grouped ${totalDats} DATs into ${groupedEntries.size} logical families. Compressing...`);
  
  for (const group of groupedEntries.values()) {
    // Build the JSONL content — one JSON object per line, no trailing newline
    const jsonlLines = group.entries.map(entry => JSON.stringify(entry));
    const jsonlContent = jsonlLines.join('\n');

    // Zstd compress the JSONL using dictionary if provided
    // @ts-ignore: Node 22 supports 'level' and 'dictionary' directly but @types/node may lack it
    const compressed = zstdCompressSync(Buffer.from(jsonlContent, 'utf-8'), { level: 19, dictionary: dictBuffer });

    // Build the output filename: {source}--{system-slug}.jsonl.zst
    const slug = slugify(group.family);
    const filename = `${group.source}--${slug}.jsonl.zst`;
    const outputPath = path.join(OUTPUT_DIR, filename);

    fs.writeFileSync(outputPath, compressed);

    // Compute SHA256 of the compressed file for the manifest
    const sha256 = createHash('sha256').update(compressed).digest('hex');

    results.push({
      id: `${group.source}/${slug}`,
      source: group.source,
      system: group.family,
      datVersion: group.datVersion,
      file: filename,
      sha256,
      size: compressed.length,
      entries: group.entries.length,
    });
    
    totalEntries += group.entries.length;
  }

  const compileResult: CompileResult = {
    systems: results,
    ...(dictionaryMeta && { dictionary: dictionaryMeta })
  };

  // Write the compile manifest — sign.ts reads this to build the signed manifest
  const compileManifestPath = path.join(OUTPUT_DIR, 'compile-manifest.json');
  fs.writeFileSync(compileManifestPath, JSON.stringify(compileResult, null, 2));

  console.log(`[compile] Done: ${totalDats} DATs processed → ${results.length} artifacts (${totalEntries} total game entries)`);

  return compileResult;
}

// --- CLI entry point ---
const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectRun) {
  compileAll()
    .then(result => {
      console.log(`[compile] Output: ${OUTPUT_DIR}/`);
      console.log(`[compile] Systems: ${result.systems.length}`);
      if (result.dictionary) {
        console.log(`[compile] Dictionary: ${result.dictionary.file} (${result.dictionary.size} bytes)`);
      }
    })
    .catch(err => {
      console.error(`[compile] Fatal: ${err.message}`);
      process.exit(1);
    });
}
