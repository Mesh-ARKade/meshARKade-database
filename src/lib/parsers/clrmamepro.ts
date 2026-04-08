import { IDatParser } from './base.js';
import { ParsedDat, JsonlLine, RomEntry } from '../../types/dat.js';

export class ClrMameProParser implements IDatParser {
  readonly name = 'clrmamepro';

  canParse(content: string): boolean {
    return content.trimStart().startsWith('clrmamepro');
  }

  parse(content: string, source: string): ParsedDat {
    const lines = content.split('\n');
    let system = 'Unknown System';
    let datVersion = 'unknown';
    const entries: JsonlLine[] = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (line.startsWith('clrmamepro')) {
        while (i < lines.length) {
          const hline = lines[i].trim();
          const nameMatch = hline.match(/^\s*name\s+"(.+)"/);
          const verMatch = hline.match(/^\s*version\s+(.+)/);
          if (nameMatch) system = nameMatch[1];
          if (verMatch) datVersion = verMatch[1].trim();
          if (hline === ')') break;
          i++;
        }
      }

      if (line === 'game (') {
        let gameName = '';
        let gameDesc = '';
        const roms: RomEntry[] = [];

        i++;
        while (i < lines.length) {
          const gline = lines[i].trim();
          if (gline === ')') break;

          const gNameMatch = gline.match(/^\s*name\s+"(.+)"/);
          const gDescMatch = gline.match(/^\s*description\s+"(.+)"/);
          if (gNameMatch) gameName = gNameMatch[1];
          if (gDescMatch) gameDesc = gDescMatch[1];

          const romMatch = gline.match(/^\s*rom\s+\(\s*(.+)\s*\)\s*$/);
          if (romMatch) {
            const romStr = romMatch[1];
            const nameM = romStr.match(/name\s+(\S+)/);
            const sizeM = romStr.match(/size\s+(\d+)/);
            const crcM = romStr.match(/crc\s+([0-9a-fA-F]+)/);
            const md5M = romStr.match(/md5\s+([0-9a-fA-F]+)/);
            const sha1M = romStr.match(/sha1\s+([0-9a-fA-F]+)/);

            if (nameM && sizeM && crcM) {
              const romEntry: RomEntry = {
                name: nameM[1],
                size: parseInt(sizeM[1], 10),
                crc: crcM[1].toLowerCase(),
              };
              if (md5M) romEntry.md5 = md5M[1].toLowerCase();
              if (sha1M) romEntry.sha1 = sha1M[1].toLowerCase();
              roms.push(romEntry);
            }
          }
          i++;
        }

        if (gameName && roms.length > 0) {
          const entry: JsonlLine = {
            source,
            system,
            datVersion,
            id: gameName,
            name: gameDesc || gameName,
            roms,
          };
          if (gameDesc && gameDesc !== gameName) {
            entry.description = gameDesc;
          }
          entries.push(entry);
        }
      }
      i++;
    }

    return { system, datVersion, entries };
  }
}
