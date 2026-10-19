/** Parse displayed KES/litres without floating-point rounding or silent zeroes. */
export function parseFixedUnits(value: string, places: number): number {
  if (places !== 2 && places !== 3) throw new Error('Unsupported unit');
  const match = value.trim().match(new RegExp(`^(\\d+)(?:\\.(\\d{1,${places}}))?$`));
  if (!match) throw new Error(`Use a non-negative number with at most ${places} decimal places.`);
  const units = BigInt(match[1]!) * 10n ** BigInt(places) + BigInt((match[2] ?? '').padEnd(places, '0'));
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount is too large.');
  return Number(units);
}
