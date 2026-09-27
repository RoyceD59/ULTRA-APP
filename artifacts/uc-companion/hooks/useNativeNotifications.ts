import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { evaluateColdStart } from '@/lib/coldStartNotification';
import { parseOrderNotificationId } from '@/lib/orderNotification';

/**
 * Native notification code is deliberately loaded only after the web bundle has
 * been excluded. This keeps expo-notifications and its native dependencies out
 * of the Companion web startup path.
 */
export function useNativeNotificationRouting(): void {
  const router = useRouter();
  const client = useQueryClient();
  const { token, user, isLoading: authLoading } = useAuth();
  const handledNotificationRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web' || authLoading) return;
    let active = true;
    let removeListeners: (() => void) | undefined;

    void import('expo-notifications').then(Notifications => {
      if (!active) return;
      const hasUser = !!user?.id;
      const userId = user?.id;
      Notifications.getLastNotificationResponseAsync().then(response => {
        if (!active || !response || response.notification.request.identifier === handledNotificationRef.current) return;
        const data = response.notification.request.content.data as Record<string, any> | undefined;
        const action = evaluateColdStart(data, hasUser);
        if (action.type === 'ROUTE_AND_CLEAR') {
          handledNotificationRef.current = response.notification.request.identifier;
          if (action.screen === 'order-detail' && action.orderId) {
            if (userId) {
              client.invalidateQueries({ queryKey: ['customer', userId, 'orders'] });
              client.invalidateQueries({ queryKey: ['customer', userId, 'order', String(action.orderId)] });
              client.invalidateQueries({ queryKey: ['customer', userId, 'order', action.orderId] });
            }
            router.push(`/order/${action.orderId}` as never);
          } else if (action.screen === 'products' || action.screen === 'shop') {
            router.push('/(tabs)/products' as never);
          } else if (action.screen === 'orders' || action.screen === 'filterTracker') {
            router.push('/(tabs)/account' as never);
          }
          Notifications.clearLastNotificationResponseAsync().catch(() => {});
        } else if (action.type === 'CLEAR') {
          handledNotificationRef.current = response.notification.request.identifier;
          Notifications.clearLastNotificationResponseAsync().catch(() => {});
        }
      });

      const responseSub = Notifications.addNotificationResponseReceivedListener(response => {
        handledNotificationRef.current = response.notification.request.identifier;
        const data = response.notification.request.content.data as Record<string, any> | undefined;
        const screen = data?.['screen'];
        if (screen === 'products' || screen === 'shop') router.push('/(tabs)/products' as never);
        else if (screen === 'orders' || screen === 'filterTracker') router.push('/(tabs)/account' as never);
        else if (screen === 'order-detail') {
          const orderId = parseOrderNotificationId(data);
          if (orderId !== null) router.push(`/order/${orderId}` as never);
        }
      });
      const foregroundSub = Notifications.addNotificationReceivedListener(notification => {
        const data = notification.request.content.data as Record<string, any> | undefined;
        if (data?.screen === 'order-detail') {
          const orderId = parseOrderNotificationId(data);
          if (userId && orderId !== null) {
            client.invalidateQueries({ queryKey: ['customer', userId, 'orders'] });
            client.invalidateQueries({ queryKey: ['customer', userId, 'order', String(orderId)] });
            client.invalidateQueries({ queryKey: ['customer', userId, 'order', orderId] });
          }
        }
      });
      removeListeners = () => {
        responseSub.remove();
        foregroundSub.remove();
      };
    }).catch(() => {});

    return () => {
      active = false;
      removeListeners?.();
    };
  }, [router, client, user?.id, authLoading]);
}

export function usePushTokenSync(token: string | null): void {
  useEffect(() => {
    if (Platform.OS === 'web' || !token) return;
    let active = true;
    void import('./useNotifications').then(({ syncPushTokenWithServer }) => {
      if (active) void syncPushTokenWithServer(token);
    }).catch(() => {});
    return () => { active = false; };
  }, [token]);
}