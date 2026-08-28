const QR_PREFIX = 'uc-rewards:v1:';

/** Build the scanner payload from the server-issued opaque token only. */
export function buildRewardsQrPayload(token: string): string {
  const value = token.trim();
  if (!value) throw new Error('A rewards QR token is required');
  return `${QR_PREFIX}${value}`;
}