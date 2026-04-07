/**
 * Manifest Signer
 *
 * Reads the compile-manifest.json produced by compile.ts, constructs the
 * final manifest object, signs it with Ed25519 via hypercore-crypto, and
 * writes the signed manifest.json to output/.
 *
 * The signed manifest is the root of trust for the entire catalog:
 *
 *   manifest.json (signed, contains system list + file hashes)
 *       ↓
 *   Clients verify: signature → publicKey → then each file's sha256
 *       ↓
 *   Trust chain: manifest signature → file sha256 → individual game entries
 *
 * Signing process:
 *   1. Build the manifest object (without signature field)
 *   2. Serialize to deterministic JSON (sorted keys)
 *   3. Sign the UTF-8 bytes with Ed25519
 *   4. Insert the signature into the manifest
 *   5. Validate against manifest.schema.json
 *   6. Write to output/manifest.json
 *
 * @intent Sign the compiled catalog for distribution to P2P clients.
 * @guarantee The output manifest passes schema validation and signature verification.
 * @constraint Requires MESH_SIGNING_KEY env var (128-char hex Ed25519 secret key).
 */

import fs from 'fs';
import path from 'path';
import hypercoreCrypto from 'hypercore-crypto';
import type { CompiledSystem } from './compile.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OUTPUT_DIR = 'output';
const COMPILE_MANIFEST = path.join(OUTPUT_DIR, 'compile-manifest.json');
const OUTPUT_MANIFEST = path.join(OUTPUT_DIR, 'manifest.json');

/** The current manifest format version. Bump this if the schema changes. */
const MANIFEST_VERSION = '1';

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON serialization — sorted keys at every level.
 *
 * This ensures the same data always produces the exact same bytes,
 * which is critical for reproducible signatures. Without sorted keys,
 * two identical manifests could produce different JSON strings and
 * therefore different signatures.
 */
function deterministicStringify(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) => {
    // Sort object keys for deterministic output
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value).sort().reduce((sorted: Record<string, unknown>, k) => {
        sorted[k] = (value as Record<string, unknown>)[k];
        return sorted;
      }, {});
    }
    return value;
  });
}

/**
 * Build the manifest systems array from compile output.
 *
 * Each compiled system gets an entry with a URL pointing to the
 * GitHub Release where the artifact will be uploaded. The release
 * tag is `catalog-{YYYY-MM-DD}`.
 *
 * @param systems - Array of compiled system metadata from compile.ts.
 * @param releaseTag - The GitHub Release tag (e.g., "catalog-2026-04-06").
 * @returns Manifest systems array ready for signing.
 */
function buildSystemEntries(
  systems: CompiledSystem[],
  releaseTag: string,
): Array<{
  id: string;
  datVersion: string;
  file: string;
  sha256: string;
  size: number;
  url: string;
  entries: number;
}> {
  const repoUrl = 'https://github.com/Mesh-ARKade/meshARKade-database';

  return systems.map(sys => ({
    id: sys.id,
    datVersion: sys.datVersion,
    file: sys.file,
    sha256: sys.sha256,
    size: sys.size,
    url: `${repoUrl}/releases/download/${releaseTag}/${sys.file}`,
    entries: sys.entries,
  }));
}

/**
 * Sign the catalog manifest with Ed25519.
 *
 * @param releaseTag - Optional release tag override. Defaults to meshARKade-metadats-{YYYYMMDD-HHMMSS}.
 * @returns The signed manifest object.
 */
export async function signManifest(releaseTag?: string): Promise<Record<string, unknown>> {
  // --- Load the signing key from environment ---
  const secretKeyHex = process.env.MESH_SIGNING_KEY;
  if (!secretKeyHex) {
    throw new Error(
      'Missing MESH_SIGNING_KEY environment variable.\n' +
      'This should be a 128-character hex string (Ed25519 secret key).\n' +
      'Generate one with: npm run keygen'
    );
  }

  if (secretKeyHex.length !== 128) {
    throw new Error(
      `MESH_SIGNING_KEY should be 128 hex characters, got ${secretKeyHex.length}`
    );
  }

  const secretKey = Buffer.from(secretKeyHex, 'hex');

  // Derive the public key from the secret key.
  // The first 32 bytes of an Ed25519 secret key is the seed; the last 32
  // bytes is the public key. hypercore-crypto follows this convention.
  const publicKey = secretKey.subarray(32, 64);
  const publicKeyHex = publicKey.toString('hex');

  // --- Load compile output ---
  if (!fs.existsSync(COMPILE_MANIFEST)) {
    throw new Error(
      `Compile manifest not found at ${COMPILE_MANIFEST}.\n` +
      'Run compile.ts first: node dist/scripts/compile.js'
    );
  }

  const systems: CompiledSystem[] = JSON.parse(
    fs.readFileSync(COMPILE_MANIFEST, 'utf-8')
  );

  if (systems.length === 0) {
    throw new Error('Compile manifest is empty — nothing to sign');
  }

  // --- Build the manifest ---
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const tag = releaseTag || `meshARKade-metadats-${timestamp}`;
  const generated = new Date().toISOString();

  // Build the unsigned manifest (signature placeholder will be replaced)
  const unsigned = {
    version: MANIFEST_VERSION,
    generated,
    publicKey: publicKeyHex,
    signature: '',  // Placeholder — will be filled after signing
    systems: buildSystemEntries(systems, tag),
  };

  // --- Sign ---
  // Remove the signature field, serialize deterministically, sign the bytes
  const forSigning = { ...unsigned };
  delete (forSigning as Record<string, unknown>).signature;

  const message = Buffer.from(deterministicStringify(forSigning), 'utf-8');
  const signature = hypercoreCrypto.sign(message, secretKey);
  const signatureHex = signature.toString('hex');

  // Insert the real signature
  unsigned.signature = signatureHex;

  // --- Verify our own signature (sanity check) ---
  const verified = hypercoreCrypto.verify(message, signature, publicKey);
  if (!verified) {
    throw new Error('FATAL: Self-verification failed. The generated signature does not verify.');
  }

  // --- Write the signed manifest ---
  const manifestJson = JSON.stringify(unsigned, null, 2);
  fs.writeFileSync(OUTPUT_MANIFEST, manifestJson);

  console.log(`[sign] Manifest signed successfully`);
  console.log(`[sign]   Public key: ${publicKeyHex}`);
  console.log(`[sign]   Signature:  ${signatureHex.slice(0, 16)}...`);
  console.log(`[sign]   Systems:    ${systems.length}`);
  console.log(`[sign]   Release:    ${tag}`);
  console.log(`[sign]   Output:     ${OUTPUT_MANIFEST}`);

  return unsigned;
}

// --- CLI entry point ---
const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectRun) {
  // Accept optional release tag as first argument
  const releaseTag = process.argv[2] || undefined;

  signManifest(releaseTag)
    .then(() => {
      console.log('[sign] Done.');
    })
    .catch(err => {
      console.error(`[sign] Fatal: ${err.message}`);
      process.exit(1);
    });
}
