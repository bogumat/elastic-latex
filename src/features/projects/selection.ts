export function topPaths(paths: string[]) {
  const unique = [...new Set(paths)];
  return unique.filter(path => !unique.some(parent => parent !== path && path.startsWith(`${parent}/`)));
}
