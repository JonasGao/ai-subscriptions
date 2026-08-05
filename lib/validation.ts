/**
 * Shared request-body validation helpers.
 *
 * Kept small and dependency-free so API routes (and only the API routes —
 * lib/db.ts has its own parallel guards) can reuse them without pulling
 * in route-specific concerns.
 */

/**
 * Normalize a nullable numeric field on a request body: an explicit `null`
 * is rewritten as `undefined` so downstream spread-based updaters
 * (notably `updateSubscription`) overwrite any previously stored value
 * with "no value", while the field stays present on the object. Real
 * numbers and already-`undefined` values pass through untouched.
 *
 * Mutates `body` in place.
 */
export function normalizeNullable<
  T extends Record<string, unknown>,
  K extends keyof T,
>(body: T, field: K): void {
  if (body[field] === null) {
    // Cast is safe: `K extends keyof T` and every field in our payloads
    // is declared optional, so `undefined` is a valid assignment.
    (body as Record<string, unknown>)[field as string] = undefined;
  }
}

/**
 * Validate that an optional numeric value, if provided, is a non-negative
 * finite number. Returns an error message on failure, or `null` on success.
 *
 * The `Number.isFinite` check rejects `NaN`, `Infinity`, and `-Infinity`;
 * this matters because `JSON.stringify(Infinity)` produces `null`, which
 * `normalizeNullable` would silently delete — but a client could still
 * send a raw `Infinity` over the wire via other encodings, and we'd rather
 * reject it loudly than quietly fall back to a default.
 */
export function validateNonNegative(
  value: unknown,
  fieldName: string
): string | null {
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return `${fieldName} must be a non-negative finite number`;
  }
  return null;
}
