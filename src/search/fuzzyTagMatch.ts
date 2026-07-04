/** Case-insensitive fuzzy match score; higher is better. Null when no match. */
export function fuzzyTagMatch(query: string, candidate: string): number | null {
  const q = query.trim().toLowerCase();
  const text = candidate.toLowerCase();
  if (!q) return null;

  if (text === q) return 1_000;
  if (text.startsWith(q)) return 900 + (q.length / text.length) * 80;

  const substringIndex = text.indexOf(q);
  if (substringIndex >= 0) return 800 - Math.min(substringIndex, 40);

  let score = 0;
  let queryIndex = 0;
  let lastMatch = -1;
  let consecutive = 0;

  for (let textIndex = 0; textIndex < text.length && queryIndex < q.length; textIndex += 1) {
    if (text[textIndex] !== q[queryIndex]) continue;

    score += 10;
    if (lastMatch === textIndex - 1) {
      consecutive += 1;
      score += consecutive * 6;
    } else {
      consecutive = 0;
      const previous = textIndex > 0 ? text[textIndex - 1] : ' ';
      if (textIndex === 0 || previous === ' ' || previous === '-' || previous === '(') {
        score += 12;
      }
      score -= Math.min(textIndex, 24);
    }

    lastMatch = textIndex;
    queryIndex += 1;
  }

  if (queryIndex < q.length) return null;
  return score;
}
