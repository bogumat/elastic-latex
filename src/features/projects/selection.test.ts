import { expect, it } from 'vitest';
import { topPaths } from './selection';
it('processes selected parents once while retaining unrelated prefixes', () => {
  expect(topPaths(['chapters/a.tex', 'chapters', 'chapters-other/a.tex', 'chapters'])).toEqual(['chapters', 'chapters-other/a.tex']);
});
