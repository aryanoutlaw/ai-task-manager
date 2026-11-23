/**
 * Deterministic JSON serialisation (object keys sorted recursively).
 * Used to fingerprint request bodies and tool arguments so `{a:1,b:2}` and `{b:2,a:1}` are
 * recognised as the same request.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}
