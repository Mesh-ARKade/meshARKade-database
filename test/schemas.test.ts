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

  it('should validate a disk-only entry (CHDs)', () => {
    const diskEntry = {
      source: 'mame',
      system: 'MAME',
      datVersion: '1.0',
      id: '2spicy',
      name: '2 Spicy',
      disks: [
        {
          name: 'mda-c0004a_revb_lindyellow_v2.4.20_mvl31a_boot_2.01',
          sha1: 'e13da5f827df852e742b594729ee3f933b387410',
          status: 'good',
        },
      ],
    };
    expect(validateJsonlLine(diskEntry)).toBe(true);
  });

  it('should fail validation when neither roms nor disks present', () => {
    const noMedia = {
      source: 'mame',
      system: 'MAME',
      datVersion: '1.0',
      id: 'test',
      name: 'Test',
    };
    expect(validateJsonlLine(noMedia)).toBe(false);
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
          file: 'n64.jsonl.zst',
          sha256: 'c'.repeat(64),
          size: 1000,
          url: 'https://example.com/n64.jsonl.zst',
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
          file: 'n64.jsonl.zst',
          sha256: 'c'.repeat(64),
          size: 1000,
          url: 'https://example.com/n64.jsonl.zst',
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