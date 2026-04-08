import { XMLParser } from 'fast-xml-parser';
import { IDatParser } from './base.js';
import { ParsedDat, JsonlLine, RomEntry, DiskEntry } from '../../types/dat.js';

export class LogiqxParser implements IDatParser {
  readonly name = 'logiqx';

  private xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    isArray: (_name, jpath) => {
      const jp = String(jpath);
      return jp === 'datafile.game' ||
             jp === 'datafile.game.rom' ||
             jp === 'datafile.game.release' ||
             jp === 'datafile.machine' ||
             jp === 'datafile.machine.rom' ||
             jp === 'datafile.machine.disk' ||
             jp === 'datafile.machine.release' ||
             jp === 'datafile.software' ||
             jp === 'datafile.software.part' ||
             jp === 'datafile.software.part.dataarea' ||
             jp === 'datafile.software.part.dataarea.rom';
    },
    parseAttributeValue: false,
    parseTagValue: false,
    processEntities: false,
  });

  canParse(content: string): boolean {
    const trimmed = content.trimStart();
    // Standard Logiqx XML DATs start with <?xml or <datafile
    return trimmed.startsWith('<?xml') || trimmed.startsWith('<datafile');
  }

  parse(xmlContent: string, source: string): ParsedDat {
    const parsed = this.xmlParser.parse(xmlContent);

    // Support Logiqx <datafile> (No-Intro, Redump, TOSEC)
    const datafile = parsed.datafile;
    if (!datafile) {
      throw new Error('Invalid DAT format: missing <datafile> root element');
    }

    const header = datafile.header;
    if (!header) {
      throw new Error('Invalid DAT format: missing <header> element');
    }

    const system = header.name || 'Unknown System';
    const datVersion = header.version || 'unknown';

    const games: any[] = datafile.game || datafile.machine || [];
    const entries: JsonlLine[] = [];

    for (const game of games) {
      const g = game as Record<string, any>;
      const gameName = g.name || '';
      if (!gameName) continue;

      let rawRoms: any[] = [];
      if (g.rom) {
        rawRoms = (Array.isArray(g.rom) ? g.rom : [g.rom]);
      }

      const roms: RomEntry[] = [];
      for (const rom of rawRoms) {
        if (!rom.name || !rom.size || !rom.crc) continue;
        const romEntry: RomEntry = {
          name: rom.name,
          size: parseInt(rom.size, 10),
          crc: rom.crc.toLowerCase(),
        };
        if (rom.md5) romEntry.md5 = rom.md5.toLowerCase();
        if (rom.sha1) romEntry.sha1 = rom.sha1.toLowerCase();
        if (rom.sha256) romEntry.sha256 = rom.sha256.toLowerCase();
        if (rom.status) romEntry.status = rom.status;
        if (rom.header) romEntry.header = rom.header;
        roms.push(romEntry);
      }

      const disks: DiskEntry[] = [];
      if (g.disk) {
        const rawDisks = (Array.isArray(g.disk) ? g.disk : [g.disk]);
        for (const disk of rawDisks) {
          if (!disk.name) continue;
          const diskEntry: DiskEntry = { name: disk.name };
          if (disk.sha1) diskEntry.sha1 = disk.sha1.toLowerCase();
          if (disk.md5) diskEntry.md5 = disk.md5.toLowerCase();
          if (disk.status) diskEntry.status = disk.status;
          disks.push(diskEntry);
        }
      }

      if (roms.length === 0 && disks.length === 0) continue;

      const entry: JsonlLine = {
        source,
        system,
        datVersion,
        id: gameName,
        name: g.description || g.title || gameName,
      };

      if (roms.length > 0) entry.roms = roms;
      if (disks.length > 0) entry.disks = disks;
      if (g.category) entry.category = g.category;
      if (g.cloneof) entry.cloneofid = g.cloneof;
      
      const desc = g.description || g.title;
      if (desc && desc !== gameName) {
        entry.description = desc;
      }

      entries.push(entry);
    }

    return { system, datVersion, entries };
  }
}
