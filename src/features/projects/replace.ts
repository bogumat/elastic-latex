export function literalChanges(
  text: string,
  query: string,
  replacement: string,
  sensitive: boolean,
) {
  if (!query) return [];
  const expression = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    sensitive ? 'gu' : 'giu',
  );
  return [...text.matchAll(expression)].map((match) => ({
    from: match.index!,
    to: match.index! + match[0].length,
    insert: replacement,
  }));
}
