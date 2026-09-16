import React, { useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { ActivityIndicator, Platform, View } from 'react-native';
import { setBaseUrl, setAuthTokenGetter } from '@workspace/api-client-react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { usePushTokenSync } from '@/hooks/useNotifications';
import { useWaterTestHandoffCapture } from '@/hooks/useWaterTestHandoff';
import { CartProvider } from '@/context/CartContext';
import { getApiBase } from '@/lib/apiBase';
import { parseOrderNotificationId } from '@/lib/orderNotification';
import { evaluateColdStart } from '@/lib/coldStartNotification';
import { shouldRedirectToLogin } from '@/lib/authSessionRedirect';

// Import the notification hook — this also runs setNotificationHandler at
// module level so it's registered before any notification can arrive.
import * as Notifications from 'expo-notifications';

// Set API base URL before any component renders
const apiBase = getApiBase();
if (apiBase) {
  setBaseUrl(apiBase);
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// Clerk (social sign-in). Env vars are injected by the dev script in
// development and by scripts/build.js in production builds.
const clerkPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;
const clerkProxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;

const queryClient = new QueryClient();

function RootLayoutNav() {
  const router = useRouter();
  const { token, user, isLoading: authLoading, mustChangePassword } = useAuth();
  const client = useQueryClient();
  const previousToken = useRef<string | null>(token);
  const handledNotificationRef = useRef<string | null>(null);

  // Keep the server's push token fresh: re-registers on app foreground if
  // Expo has rotated the token since the last registration.
  usePushTokenSync(token);

  useWaterTestHandoffCapture();

  useEffect(() => {
    const tokenBeforeUpdate = previousToken.current;
    previousToken.current = token;

    // Update API client auth token for this session
    setAuthTokenGetter(token ? () => Promise.resolve(token) : null);

    if (shouldRedirectToLogin(tokenBeforeUpdate, token)) {
      client.clear();
      router.replace('/auth/login' as never);
    }
  }, [client, router, token]);

  useEffect(() => {
    if (token && mustChangePassword) {
      router.replace('/auth/change-password' as never);
    }
  }, [mustChangePassword, router, token]);

  // Handle notification taps: route user to the relevant screen
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const hasUser = !!user?.id;
    const userId = user?.id;

    if (!authLoading) {
      Notifications.getLastNotificationResponseAsync().then(response => {
        if (response && response.notification.request.identifier !== handledNotificationRef.current) {
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
        }
      });
    }

    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      handledNotificationRef.current = response.notification.request.identifier;
      const data = response.notification.request.content.data as Record<string, any> | undefined;
      const screen = data?.['screen'];
      if (screen === 'products' || screen === 'shop') {
        router.push('/(tabs)/products' as never);
      } else if (screen === 'orders' || screen === 'filterTracker') {
        router.push('/(tabs)/account' as never);
      } else if (screen === 'order-detail') {
        const orderId = parseOrderNotificationId(data);
        if (orderId !== null) {
          router.push(`/order/${orderId}` as never);
        }
      }
    });

    const fgSub = Notifications.addNotificationReceivedListener(notification => {
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

    return () => {
      sub.remove();
      fgSub.remove();
    };
  }, [router, client, user?.id, authLoading]);

  // Do not mount protected tabs or their React Query observers until the
  // combined Companion session record has been hydrated. This avoids a
  // guest navigation flash and unauthenticated requests during cold start.
  if (authLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#0054A6" />
      </View>
    );
  }

  // Temporary sessions are deliberately unable to mount customer routes (and
  // therefore cannot create authenticated query observers) until the new
  // bearer returned by /change-password has been atomically activated.
  if (token && mustChangePassword) {
    return (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="auth/change-password" />
      </Stack>
    );
  }

  return (
    <Stack screenOptions={{ headerBackTitle: 'Back', headerTintColor: '#0054A6' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="product/[id]" options={{ title: 'Product Details', headerBackTitle: 'Back' }} />
      <Stack.Screen name="cart" options={{ title: 'My Cart' }} />
      <Stack.Screen name="checkout" options={{ title: 'Checkout' }} />
      <Stack.Screen name="order/[id]" options={{ title: 'Order Details' }} />
      <Stack.Screen name="ticket/new" options={{ title: 'New Ticket' }} />
      <Stack.Screen name="review/new" options={{ title: 'Write a Review' }} />
      <Stack.Screen name="review/list" options={{ title: 'Reviews' }} />
      <Stack.Screen name="admin/product-media" options={{ title: 'Product Media' }} />
      <Stack.Screen name="admin/product-edit" options={{ title: 'Edit Product' }} />
      <Stack.Screen name="water-test" options={{ title: 'Water Test Request' }} />
      <Stack.Screen name="rewards" options={{ title: 'My Rewards' }} />
      <Stack.Screen name="auth/login" options={{ title: '', headerTransparent: true }} />
      <Stack.Screen name="auth/register" options={{ title: '', headerTransparent: true }} />
      <Stack.Screen name="auth/forgot-password" options={{ title: '', headerTransparent: true }} />
      <Stack.Screen name="auth/change-password" options={{ title: '', headerTransparent: true }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider style={{ flex: 1 }}>
      <ErrorBoundary>
        {/* ClerkProvider loads in the background; the app itself never waits
            on Clerk. Social sign-in buttons gate themselves on ClerkLoaded, so
            a Clerk outage or offline start can't block password users. */}
        <ClerkProvider
          publishableKey={clerkPublishableKey}
          tokenCache={tokenCache}
          proxyUrl={clerkProxyUrl}
        >
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <CartProvider>
                <GestureHandlerRootView style={{ flex: 1 }}>
                  <KeyboardProvider>
                    <RootLayoutNav />
                  </KeyboardProvider>
                </GestureHandlerRootView>
              </CartProvider>
            </AuthProvider>
          </QueryClientProvider>
        </ClerkProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
