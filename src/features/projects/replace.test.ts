import { expect, it } from 'vitest';
import { literalChanges } from './replace';

it('replaces escaped search characters and keeps replacement dollars literal', () => {
  expect(literalChanges('a.b A.B', 'a.b', '$1', false)).toEqual([{ from: 0, to: 3, insert: '$1' }, { from: 4, to: 7, insert: '$1' }]);
  expect(literalChanges('a.b A.B', 'a.b', '', true)).toHaveLength(1);
  expect(literalChanges('abc', '', 'x', false)).toEqual([]);
});
