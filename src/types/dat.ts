/**
 * Core DAT and JSONL Type Definitions
 */

export interface RomEntry {
  name: string;
  size: number;
  crc: string;
  md5?: string;
  sha1?: string;
  sha256?: string;
  status?: string;
  header?: string;
}

export interface DiskEntry {
  name: string;
  sha1?: string;
  md5?: string;
  status?: string;
}

export interface JsonlLine {
  source: string;
  system: string;
  datVersion: string;
  id: string;
  name: string;
  description?: string;
  category?: string;
  cloneofid?: string;
  roms?: RomEntry[];
  disks?: DiskEntry[];
}

export interface ParsedDat {
  system: string;
  datVersion: string;
  entries: JsonlLine[];
}
