import { describe, it, expect } from 'vitest';
import { getLogicalFamily } from '../scripts/compile.js';

describe('Logical Grouping', () => {
  describe('TOSEC', () => {
    it('groups Amiga categories into Commodore Amiga', () => {
      expect(getLogicalFamily('Commodore Amiga - Games - [Z]', 'tosec')).toBe('Commodore Amiga');
      expect(getLogicalFamily('Commodore Amiga - Demos', 'tosec')).toBe('Commodore Amiga');
    });
  });

  describe('No-Intro', () => {
    it('groups all Nintendo consoles into Nintendo', () => {
      expect(getLogicalFamily('Nintendo - Game Boy', 'no-intro')).toBe('Nintendo');
      expect(getLogicalFamily('Nintendo - Game Boy Color', 'no-intro')).toBe('Nintendo');
      expect(getLogicalFamily('Nintendo - Super Nintendo Entertainment System', 'no-intro')).toBe('Nintendo');
    });

    it('groups Sega systems into Sega', () => {
      expect(getLogicalFamily('Sega - Mega Drive - Genesis', 'no-intro')).toBe('Sega');
      expect(getLogicalFamily('Sega - Master System - Mark III', 'no-intro')).toBe('Sega');
    });
  });

  describe('Redump', () => {
    it('groups Sony systems into Sony', () => {
      expect(getLogicalFamily('Sony - PlayStation', 'redump')).toBe('Sony');
      expect(getLogicalFamily('Sony - PlayStation 2', 'redump')).toBe('Sony');
    });
  });

  describe('MAME', () => {
    it('groups Arcade into MAME Arcade', () => {
      expect(getLogicalFamily('MAME 0.286', 'mame')).toBe('MAME Arcade');
    });

    it('groups Software Lists by manufacturer', () => {
      expect(getLogicalFamily('Nintendo - Game Boy', 'mame')).toBe('Nintendo');
    });
  });
});
