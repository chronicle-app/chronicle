/**
 * The known name a mistyped one most likely meant: one that contains it or is
 * contained in it (`star` for `stars`), nearest in length, else one a
 * couple of edits away.
 * Lives apart from the selector so the dispatcher can use it without loading
 * ink.
 */
export function closest(typed: string, known: string[]): string | undefined {
  const needle = typed.toLowerCase();
  // Of the names that contain it or that it contains, the nearest in length.
  const containing = known
    .filter(k => k.includes(needle) || needle.includes(k))
    .sort((a, b) => Math.abs(a.length - needle.length) - Math.abs(b.length - needle.length));
  if (containing.length > 0) return containing[0];
  let best: { kind: string; distance: number } | undefined;
  for (const kind of known) {
    const distance = editDistance(needle, kind);
    if (distance <= 2 && (!best || distance < best.distance)) best = { kind, distance };
  }
  return best?.kind;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}
