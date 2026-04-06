# meshARKade-database

DAT file compiler - transforms XML DAT files into signed, distributable JSONL artifacts.

## Purpose

This repository serves as the archive and factory at the heart of the firehose pipeline. It stores raw XML DAT files from primary sources (No-Intro, Redump, TOSEC, MAME) and transforms them into signed, gzipped JSONL artifacts for distribution to clients.

## Directory Layout

```
meshARKade-database/
├── input/                  # Raw XML DAT files (committed by curator PRs)
│   ├── no-intro/         # No-Intro DAT files
│   ├── redump/           # Redump DAT files
│   ├── tosec/            # TOSEC DAT files
│   └── mame/             # MAME DAT files
├── src/                  # TypeScript source code
│   ├── lib/             # Shared libraries (Ajv configuration)
│   └── validate-schemas.ts  # Schema validation functions
├── schemas/             # JSON Schema definitions
│   ├── jsonl-line.schema.json
│   ├── manifest.schema.json
│   └── delta-line.schema.json
├── test/                # Test fixtures and unit tests
├── output/              # Build artifacts (gitignored)
├── scripts/             # Build and utility scripts
└── .github/workflows/   # GitHub Actions workflows
```

## Schema Contract

### jsonl-line.schema.json

Shape of a single game entry line in a compiled JSONL artifact. This schema preserves all source XML fields 1:1 — no normalization.

**Required fields:** `source`, `system`, `datVersion`, `id`, `name`, `roms[]`

**Optional fields:** `description`, `category`, `cloneofid`

**ROM fields:** `name`, `size`, `crc`, `md5`, `sha1`

**Optional ROM fields:** `sha256`, `status`, `header`

### manifest.schema.json

Shape of `manifest.json` — the signed catalog index distributed to clients.

**Required fields:** `version`, `generated`, `publicKey`, `signature`, `systems[]`

Each system entry includes: `id`, `datVersion`, `file`, `sha256`, `size`, `url`, `entries`

### delta-line.schema.json

Shape of a delta JSONL line for incremental catalog updates.

**Operation types:**
- `upsert`: Adds or updates a game entry (requires all jsonl-line fields)
- `remove`: Deletes a game entry (requires only `op` and `key`)

## Local Development Setup

### Prerequisites

- Node.js (version specified in `.nvmrc`)
- npm

### Installation

```bash
npm install
```

### Running Tests

```bash
npm test
```

### Building

```bash
npm run build
```

### Validating TypeScript

```bash
npm run validate
```

## Key Management

### Keypair Generation

The Ed25519 keypair is used to sign catalog manifests. The private key is stored as a GitHub Actions Secret, and the public key is embedded in the `mesh-arkade` client.

To generate a new keypair:

```bash
npm run keygen
```

This will output:
- **Public Key** (64 hex characters): Embed in `mesh-arkade/src/constants.ts` as `CATALOG_PUBLIC_KEY`
- **Secret Key** (128 hex characters): Store as `MESH_SIGNING_KEY` in GitHub repo secrets

**Current Public Key:**
```
a365e013bd067cc0450eac8d2440c0702de8447e4aeb458555fcf8c8f91d2a30
```

### Key Rotation Procedure

1. Generate a new keypair: `npm run keygen`
2. Update `CATALOG_PUBLIC_KEY` in `mesh-arkade/src/constants.ts`
3. Update `MESH_SIGNING_KEY` in GitHub repo secrets
4. Rebuild and release the catalog to propagate the new key
5. Clients will receive the new public key on next catalog update