import { describe, it, expect } from 'vitest';
import { validateJsonlLine, validateManifest, validateDeltaLine } from '../src/validate-schemas.js';

describe('jsonl-line schema', () => {
  it('should validate a valid jsonl-line entry', () => {
    const validEntry = {
      source: 'no-intro',
      system: 'n64',
      datVersion: '2024-01-01',
      id: 'game-001',
      name: 'Super Game',
      roms: [
        {
          name: 'game.z64',
          size: 8388608,
          crc: '12345678',
          md5: '0123456789abcdef0123456789abcdef',
          sha1: '0123456789abcdef0123456789abcdef01234567',
        },
      ],
    };
    expect(validateJsonlLine(validEntry)).toBe(true);
  });

  it('should fail validation when required field is missing', () => {
    const invalidEntry = {
      source: 'no-intro',
      system: 'n64',
      id: 'game-001',
      name: 'Super Game',
      roms: [],
    };
    expect(validateJsonlLine(invalidEntry)).toBe(false);
  });
});

describe('manifest schema', () => {
  it('should validate a valid manifest', () => {
    const validManifest = {
      version: '1.0.0',
      generated: '2024-01-01T00:00:00Z',
      publicKey: 'a'.repeat(64),
      signature: 'b'.repeat(128),
      systems: [
        {
          id: 'n64',
          datVersion: '2024-01-01',
          file: 'n64.jsonl.gz',
          sha256: 'c'.repeat(64),
          size: 1000,
          url: 'https://example.com/n64.jsonl.gz',
          entries: 100,
        },
      ],
    };
    expect(validateManifest(validManifest)).toBe(true);
  });

  it('should fail validation for tampered manifest structure', () => {
    const tamperedManifest = {
      version: '1.0.0',
      generated: '2024-01-01T00:00:00Z',
      publicKey: 'a'.repeat(64),
      signature: 'b'.repeat(128),
      systems: [
        {
          id: 'n64',
          file: 'n64.jsonl.gz',
          sha256: 'c'.repeat(64),
          size: 1000,
          url: 'https://example.com/n64.jsonl.gz',
          entries: 100,
        },
      ],
    };
    expect(validateManifest(tamperedManifest)).toBe(false);
  });
});

describe('delta-line schema', () => {
  it('should validate a valid upsert delta', () => {
    const validUpsert = {
      op: 'upsert',
      source: 'no-intro',
      system: 'n64',
      datVersion: '2024-01-01',
      id: 'game-001',
      name: 'Super Game',
      roms: [
        {
          name: 'game.z64',
          size: 8388608,
          crc: '12345678',
          md5: '0123456789abcdef0123456789abcdef',
          sha1: '0123456789abcdef0123456789abcdef01234567',
        },
      ],
    };
    expect(validateDeltaLine(validUpsert)).toBe(true);
  });

  it('should fail validation for remove with extra fields', () => {
    const invalidRemove = {
      op: 'remove',
      key: 'game-001',
      source: 'no-intro',
      name: 'Should not be here',
    };
    expect(validateDeltaLine(invalidRemove)).toBe(false);
  });
});