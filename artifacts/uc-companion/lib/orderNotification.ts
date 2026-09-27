export function parseOrderNotificationId(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as Record<string, unknown>;
  if (payload['screen'] !== 'order-detail') return null;

  const orderId = Number(payload['orderId']);
  return Number.isSafeInteger(orderId) && orderId > 0 ? orderId : null;
}