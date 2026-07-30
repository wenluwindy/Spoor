import { describe, it, expect } from 'vitest';
import { deriveSearchQueryFromNoteText } from '../../src/services/spawnWebSearchNoteCards';

describe('deriveSearchQueryFromNoteText', () => {
  it('returns empty for blank', () => {
    expect(deriveSearchQueryFromNoteText('')).toBe('');
    expect(deriveSearchQueryFromNoteText('  \n  ')).toBe('');
  });

  it('uses first non-empty line', () => {
    expect(deriveSearchQueryFromNoteText('\nfoo\nbar')).toBe('foo');
  });

  it('truncates long first line', () => {
    const long = 'a'.repeat(400);
    expect(deriveSearchQueryFromNoteText(long, 280)).toHaveLength(280);
  });
});
