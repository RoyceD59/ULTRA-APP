/**
 * Generated Zod schemas coerce OpenAPI `format: date` fields into JS `Date`
 * objects, but Drizzle date columns are configured with `{ mode: "string" }`
 * and expect `YYYY-MM-DD` strings. Convert at the DB boundary.
 */
export function toSqlDate(value: Date | null | undefined): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return value.toISOString().slice(0, 10);
}
