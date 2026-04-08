import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { zstdCompressSync, gunzipSync } from 'zlib';
import { execSync } from 'child_process';

// Internal modules
import { JsonlLine, ParsedDat } from '../src/types/dat.js';
import { LogiqxParser, ClrMameProParser, IDatParser } from '../src/lib/parsers/index.js';

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
// Parser Registry (SOLID)
// ---------------------------------------------------------------------------

/** Registry of available DAT parsing strategies */
const parsers: IDatParser[] = [
  new LogiqxParser(),
  new ClrMameProParser(),
];

/**
 * Detect the correct parser strategy for the given file content.
 */
function parseGenericDat(content: string, source: string, filename: string): ParsedDat {
  for (const parser of parsers) {
    if (parser.canParse(content)) {
      return parser.parse(content, source);
    }
  }

  // Graceful failure — distinguish between "corrupt" and "unsupported"
  const rootMatch = content.trimStart().match(/^<([a-zA-Z0-9_-]+)/);
  if (rootMatch) {
    throw new Error(`Unsupported DAT format (Root tag: <${rootMatch[1]}>). Only Logiqx and ClrMamePro are accepted.`);
  }

  throw new Error(`Unrecognized DAT format. Content does not match any known parsing strategy.`);
}

// ---------------------------------------------------------------------------
// Core Utilities
// ---------------------------------------------------------------------------

/**
 * Convert a system name into a URL/filename-safe slug.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')  // Non-alphanumeric → hyphens
    .replace(/^-|-$/g, '');        // Trim leading/trailing hyphens
}

/**
 * Determine the logical "Family" for a DAT file.
 */
export function getLogicalFamily(name: string, source: string): string {
  let family = name;

  if (source === 'mame' && family.startsWith('MAME ')) {
    return 'MAME Arcade';
  }

  if (source === 'tosec' || source === 'no-intro' || source === 'redump' || source === 'mame') {
    family = family.split(' - ')[0];
  }

  const tagsToRemove = [
    '(Aftermarket)', '(Decrypted)', '(Encrypted)', '(Download Play)',
    '(BigEndian)', '(ByteSwapped)', '(Headered)', '(Headerless)'
  ];
  
  for (const tag of tagsToRemove) {
    family = family.replace(` ${tag}`, '');
  }

  return family.trim();
}

/**
 * Find all .dat, .xml, and .gz files in a directory (non-recursive, flat scan).
 */
function findDatFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => {
      const ext = f.toLowerCase().split('.').pop();
      return ext === 'dat' || ext === 'xml' || ext === 'gz';
    })
    .sort()
    .map(f => path.join(dir, f));
}

/**
 * Reads a text file, automatically decompressing if it ends with .gz.
 */
function readTextFile(datPath: string): string {
  if (datPath.toLowerCase().endsWith('.gz')) {
    const compressed = fs.readFileSync(datPath);
    return gunzipSync(compressed).toString('utf-8');
  }
  return fs.readFileSync(datPath, 'utf-8');
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
          const content = readTextFile(datPath);
          const { entries } = parseGenericDat(content, source, path.basename(datPath));
          
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

  const tempGroupsDir = path.join(process.cwd(), '.tmp-groups');
  fs.mkdirSync(tempGroupsDir, { recursive: true });

  const groupedEntries = new Map<string, { source: string, family: string, datVersion: string, entriesCount: number, tempFile: string }>();

  for (const source of SOURCES) {
    const sourceDir = path.join(INPUT_DIR, source);
    const datFiles = findDatFiles(sourceDir);

    if (datFiles.length === 0) {
      console.log(`[compile] ${source}: no DAT files found, skipping`);
      continue;
    }

    let sourceProcessed = 0;
    let sourceSkipped = 0;

    for (const datPath of datFiles) {
      try {
        const fileContent = readTextFile(datPath);
          
        const { system, datVersion, entries } = parseGenericDat(fileContent, source, path.basename(datPath));

        if (entries.length === 0) {
          sourceSkipped++;
          continue;
        }

        const family = getLogicalFamily(system, source);
        const groupKey = `${source}::${family}`;

        if (!groupedEntries.has(groupKey)) {
          const tempFile = path.join(tempGroupsDir, `${groupKey.replace(/[^a-zA-Z0-9]/g, '-')}.jsonl`);
          // Clear any existing temp file
          if (fs.existsSync(tempFile)) fs.rmSync(tempFile);
          groupedEntries.set(groupKey, { source, family, datVersion, entriesCount: 0, tempFile });
        }

        const groupData = groupedEntries.get(groupKey)!;
        // Serialize and stream directly to disk to prevent OOM
        const chunk = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
        fs.appendFileSync(groupData.tempFile, chunk);
        groupData.entriesCount += entries.length;

        sourceProcessed++;
        totalDats++;
      } catch (err) {
        sourceSkipped++;
        console.error(`[compile] Error compiling ${path.basename(datPath)}: ${(err as Error).message}`);
      }
    }

    console.log(`[compile] ${source}: ${sourceProcessed}/${datFiles.length} DATs (${sourceSkipped} skipped)`);
  }

  if (groupedEntries.size === 0) {
    throw new Error('No DAT files produced any output. Check input/ directory.');
  }

  // --- PASS 3: Compress and Write ---
  console.log(`[compile] Grouped ${totalDats} DATs into ${groupedEntries.size} logical families. Compressing...`);
  
  for (const group of groupedEntries.values()) {
    // Read the temp JSONL file (this single family will easily fit in memory)
    const rawContent = fs.readFileSync(group.tempFile, 'utf-8');
    // Trim trailing newline so it matches the previous strict behavior
    const finalContent = rawContent.endsWith('\n') ? rawContent.slice(0, -1) : rawContent;

    // Zstd compress the JSONL using dictionary if provided
    // @ts-ignore: Node 22 supports 'level' and 'dictionary' directly but @types/node may lack it
    const compressed = zstdCompressSync(Buffer.from(finalContent, 'utf-8'), { level: 19, dictionary: dictBuffer });

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
      entries: group.entriesCount,
    });
    
    totalEntries += group.entriesCount;
  }

  // Cleanup map temp dir
  if (fs.existsSync(tempGroupsDir)) {
    fs.rmSync(tempGroupsDir, { recursive: true, force: true });
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
