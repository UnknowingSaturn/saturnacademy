// Stable, order-insensitive serialization used for "did this actually change?"
// checks around autosave.
//
// Why this exists: journal review data round-trips through Postgres `jsonb`,
// which does NOT preserve client-side object key order (keys come back sorted
// by length then bytewise). A raw `JSON.stringify` comparison therefore always
// reports "changed" for object arrays such as `screenshots`, which turns the
// detail panel's save -> invalidate -> re-seed cycle into an infinite
// save/unsave loop. Canonicalizing both sides makes a server echo of what we
// just wrote compare equal.
//
// Normalization rules:
//  - object keys sorted alphabetically (recursively)
//  - `undefined` and `""` are treated as `null` (the DB stores empty text as
//    NULL, so "" and null must not look like a change)
//  - arrays keep their order (order is meaningful for screenshots/steps)

function normalize(value: unknown): unknown {
  if (value === undefined || value === "") return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      out[key] = normalize(src[key]);
    }
    return out;
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  try {
    return JSON.stringify(normalize(value));
  } catch {
    return "";
  }
}

export function canonicalEqual(a: unknown, b: unknown): boolean {
  return canonicalStringify(a) === canonicalStringify(b);
}
