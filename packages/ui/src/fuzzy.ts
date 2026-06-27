/**
 * A small, dependency-free fuzzy matcher (subsequence with contiguity + boundary
 * bonuses), à la VS Code / Linear command palettes. Pure and synchronous so it's
 * trivially testable and fast enough to run on every keystroke.
 */

export interface FuzzyMatch {
  /** Higher is better. */
  score: number;
  /** Indices in the target that matched, for highlighting. */
  indices: number[];
}

/**
 * Match `query` against `text`. Returns null when not all query characters are
 * found in order. Case-insensitive. An empty query matches everything (score 0).
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return { score: 0, indices: [] };
  const t = text.toLowerCase();

  let score = 0;
  let qi = 0;
  let prevIndex = -1;
  const indices: number[] = [];

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    indices.push(ti);

    // Base point for a match.
    let pts = 1;
    // Contiguous match bonus.
    if (prevIndex === ti - 1) pts += 3;
    // Word-boundary bonus (start, or after a separator).
    const before = ti > 0 ? text[ti - 1]! : "";
    if (ti === 0 || /[\s\-_/@.]/.test(before)) pts += 4;
    // Early-match bonus.
    if (ti < 4) pts += 1;

    score += pts;
    prevIndex = ti;
    qi++;
  }

  if (qi < q.length) return null; // not all query chars consumed
  // Prefer shorter targets when scores tie.
  score -= text.length * 0.01;
  return { score, indices };
}

export interface RankedItem<T> {
  item: T;
  match: FuzzyMatch;
}

/**
 * Rank a list by fuzzy relevance to `query`, dropping non-matches. `keyOf`
 * extracts the searchable string. Stable for equal scores (preserves input order).
 */
export function fuzzyRank<T>(
  query: string,
  items: T[],
  keyOf: (item: T) => string,
): Array<RankedItem<T>> {
  const ranked: Array<RankedItem<T> & { i: number }> = [];
  items.forEach((item, i) => {
    const match = fuzzyMatch(query, keyOf(item));
    if (match) ranked.push({ item, match, i });
  });
  ranked.sort((a, b) => b.match.score - a.match.score || a.i - b.i);
  return ranked.map(({ item, match }) => ({ item, match }));
}
