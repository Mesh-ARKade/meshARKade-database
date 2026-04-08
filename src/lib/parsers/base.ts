import { ParsedDat } from '../../types/dat.js';

/**
 * Base interface for all DAT parsers.
 */
export interface IDatParser {
  /**
   * Unique identifier for the parser (e.g. 'logiqx', 'clrmamepro').
   */
  readonly name: string;

  /**
   * Detect if this parser can handle the given content.
   */
  canParse(content: string): boolean;

  /**
   * Parse the content into a standardized ParsedDat object.
   */
  parse(content: string, source: string): ParsedDat;
}
