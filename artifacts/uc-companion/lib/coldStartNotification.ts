import { parseOrderNotificationId } from './orderNotification';

export type ColdStartAction =
  | { type: 'CLEAR' }
  | { type: 'PENDING' }
  | { type: 'ROUTE_AND_CLEAR'; screen: string; orderId?: number };

export function evaluateColdStart(data: Record<string, unknown> | undefined, isAuthenticated: boolean): ColdStartAction {
  if (!data || typeof data !== 'object') return { type: 'CLEAR' };

  const screen = data['screen'];
  if (screen === 'order-detail') {
    const orderId = parseOrderNotificationId(data);
    if (orderId !== null) {
      if (!isAuthenticated) return { type: 'PENDING' };
      return { type: 'ROUTE_AND_CLEAR', screen: 'order-detail', orderId };
    }
    return { type: 'CLEAR' };
  }

  if (screen === 'products' || screen === 'shop') {
    return { type: 'ROUTE_AND_CLEAR', screen };
  }

  if (screen === 'orders' || screen === 'filterTracker' || screen === 'hydration') {
    if (!isAuthenticated) return { type: 'PENDING' };
    return { type: 'ROUTE_AND_CLEAR', screen };
  }

  return { type: 'CLEAR' };
}
