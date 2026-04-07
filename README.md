# meshARKade-database

The central catalog compiler for [Mesh ARKade](https://github.com/Mesh-ARKade).

Transforms raw XML DAT files (staged by the `meshARKade-dats` ingestion pipeline) into highly compressed, cryptographically signed JSONL artifacts ready for distribution across the P2P network.

## Purpose

This repository serves as the factory at the heart of the Mesh ARKade metadata pipeline. It takes fragmented, multi-source XML files and processes them into a unified, seekable, and secure format. 

During the build process, the pipeline:
1. Groups highly fragmented systems into cohesive logical families.
2. Trains a custom Zstandard (zstd) dictionary to maximize compression across the catalog.
3. Compresses the grouped metadata into `.jsonl.zst` artifacts.
4. Generates an Ed25519-signed `manifest.json` that acts as the root of trust for the network.

## Local Development Setup

### Prerequisites

- Node.js (version specified in `.nvmrc`)
- npm

### Installation

```bash
npm install
```

### Commands

```bash
# Run unit tests
npm test

# Build TypeScript source
npm run build

# Validate TypeScript without emitting
npm run validate
```

## Schema Contract

The compilation pipeline strictly adheres to the following schemas (found in `/schemas`):

- **`jsonl-line.schema.json`**: The shape of a single game entry line in a compiled artifact. Preserves all source XML fields (ROM hashes, sizes, names) without loss of fidelity.
- **`manifest.schema.json`**: The shape of the signed `manifest.json` catalog index. Contains the cryptographic signature, dictionary metadata, and file hashes for every compiled artifact in the release.
- **`delta-line.schema.json`**: The shape of incremental catalog updates (`upsert` and `remove` operations).

## Security & Trust

The integrity of the Mesh ARKade catalog relies on an Ed25519 signature chain. 

The `manifest.json` produced by this repository is cryptographically signed during the automated release process. Client nodes hardcode the corresponding public key and verify the manifest's signature before trusting any of the underlying system artifacts it links to.
