import { describe, it, expect } from 'vitest';
import { getLogicalFamily } from '../scripts/compile.js';

describe('Logical Grouping', () => {
  describe('TOSEC', () => {
    it('groups Amiga categories into Commodore Amiga', () => {
      expect(getLogicalFamily('Commodore Amiga - Games - [Z]', 'tosec')).toBe('Commodore Amiga');
      expect(getLogicalFamily('Commodore Amiga - Demos', 'tosec')).toBe('Commodore Amiga');
      expect(getLogicalFamily('Commodore Amiga - Magazines - Amiga Format', 'tosec')).toBe('Commodore Amiga');
    });

    it('groups general TOSEC splits', () => {
      expect(getLogicalFamily('Atari ST - Games - [A]', 'tosec')).toBe('Atari ST');
      expect(getLogicalFamily('Sinclair ZX Spectrum - Coverdisks', 'tosec')).toBe('Sinclair ZX Spectrum');
    });
  });

  describe('No-Intro', () => {
    it('groups Aftermarket into main system', () => {
      expect(getLogicalFamily('Nintendo - Game Boy (Aftermarket)', 'no-intro')).toBe('Nintendo - Game Boy');
      expect(getLogicalFamily('Sega - Mega Drive - Genesis (Aftermarket)', 'no-intro')).toBe('Sega - Mega Drive - Genesis');
    });

    it('groups subsets into main system', () => {
      expect(getLogicalFamily('Nintendo - Nintendo DS (Decrypted)', 'no-intro')).toBe('Nintendo - Nintendo DS');
      expect(getLogicalFamily('Nintendo - Nintendo DS (Encrypted)', 'no-intro')).toBe('Nintendo - Nintendo DS');
      expect(getLogicalFamily('Nintendo - Nintendo DS (Download Play)', 'no-intro')).toBe('Nintendo - Nintendo DS');
    });

    it('leaves standard names unchanged', () => {
      expect(getLogicalFamily('Nintendo - Super Nintendo Entertainment System', 'no-intro')).toBe('Nintendo - Super Nintendo Entertainment System');
    });
  });

  describe('Redump', () => {
    it('leaves Redump names mostly unchanged', () => {
      expect(getLogicalFamily('Sony - PlayStation', 'redump')).toBe('Sony - PlayStation');
      expect(getLogicalFamily('Microsoft - Xbox', 'redump')).toBe('Microsoft - Xbox');
    });
  });
});
