import React, { useEffect, useRef } from 'react';
import { installConfiguredGoogleProductAnalytics } from '@/lib/productAnalytics';
import { QueryClient, QueryClientProvider, useQueryClient, focusManager } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Stack, useRouter, usePathname } from 'expo-router';
import { TouchableOpacity, Text, AppState, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as SplashScreen from 'expo-splash-screen';
import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { useNativeNotificationRouting, usePushTokenSync } from '@/hooks/useNativeNotifications';
import { useWaterTestHandoffCapture } from '@/hooks/useWaterTestHandoff';
import { CartProvider } from '@/context/CartContext';
import { getApiBase } from '@/lib/apiBase';
import { webAnalyticsLoader } from '@/lib/umamiWeb';
import { initializeCompanionFieldVitals } from '@/lib/companionFieldVitals';
import { shouldRedirectToLogin } from '@/lib/authSessionRedirect';
import { retrySessionRequest } from '@/hooks/deletedAccountResponse';
import { cartBackDestination } from '@/lib/customerScreenState';
import { sharedDataRefreshInterval } from '@/lib/queryFreshness';
import { usePublicWebDocument } from '@/hooks/usePublicWebDocument';
import { installQueryConnectivity } from '@/lib/queryConnectivity';
import { nativeRecoveryDefaults } from '@/lib/nativeQueryRecovery';
import { installCompanionDiagnostics, setDiagnosticRoute } from '@/lib/runtimeDiagnostics';

// Set API base URL before any component renders
import CompanionMenu, { CompanionTabMenu } from '@/components/CompanionMenu';
import { View } from 'react-native';
import ConnectionStatusFrame from '@/components/ConnectionStatusFrame';
import { setBaseUrl, setAuthTokenGetter } from '@workspace/api-client-react/config';
import { CheckoutReceiptProvider } from '@/context/CheckoutReceiptContext';
const apiBase = getApiBase();
if (apiBase) {
  setBaseUrl(apiBase);
}

// Screens and navigation use system typography, so no text fonts need loading.
// Keep the static native splash until the root mounts; icons load independently.
if (Platform.OS !== 'web') void SplashScreen.preventAutoHideAsync();

// Clerk (social sign-in). Env vars are injected by the dev script in
// development and by scripts/build.js in production builds.
const clerkPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;
const clerkProxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;

const isolatedPreview = process.env.EXPO_PUBLIC_PREVIEW_SAFE_MODE === '1';
const recoveryDefaults = nativeRecoveryDefaults(Platform.OS);
const queryClient = new QueryClient({
  defaultOptions: {
    ...recoveryDefaults,
    queries: {
      ...recoveryDefaults.queries,
      staleTime: 2 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: retrySessionRequest,
      refetchOnWindowFocus: 'always',
      refetchOnReconnect: 'always',
      refetchInterval: query => sharedDataRefreshInterval(query.queryKey),
      refetchIntervalInBackground: false,
    },
  },
});

function RootLayoutNav() {
  const pathname = usePathname();
  useEffect(() => setDiagnosticRoute(pathname), [pathname]);
  usePublicWebDocument();
  const router = useRouter();
  const { token, mustChangePassword } = useAuth();
  const client = useQueryClient();
  const previousToken = useRef<string | null>(token);
  // Keep the server's push token fresh: re-registers on app foreground if
  // Expo has rotated the token since the last registration.
  usePushTokenSync(token);
  useNativeNotificationRouting();

  useWaterTestHandoffCapture();

  useEffect(() => installQueryConnectivity(), []);

  useEffect(() => {
    // React Query already handles browser visibility; native needs AppState.
    if (Platform.OS === 'web') return;
    focusManager.setFocused(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', state => {
      focusManager.setFocused(state === 'active');
    });
    return () => { subscription.remove(); focusManager.setFocused(undefined); };
  }, []);

  useEffect(() => {
    const tokenBeforeUpdate = previousToken.current;
    previousToken.current = token;

    // Update API client auth token for this session
    setAuthTokenGetter(token ? () => Promise.resolve(token) : null);

    if (tokenBeforeUpdate !== token) {
      // A replacement session (including same-account re-login) must not keep
      // a prior session's validated QR, balances, or in-flight personalized reads.
      void client.cancelQueries();
      client.clear();
    }
    if (shouldRedirectToLogin(tokenBeforeUpdate, token)) {
      router.replace('/auth/login' as never);
    }
  }, [client, router, token]);

  useEffect(() => {
    if (token && mustChangePassword) {
      router.replace('/auth/change-password' as never);
    }
  }, [mustChangePassword, router, token]);

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
    <>
    <Stack screenOptions={{ headerBackTitle: 'Back', headerTintColor: '#0054A6', headerRight: () => <CompanionMenu /> }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="about" options={{ title: 'About Us', headerBackTitle: 'Back' }} />
      <Stack.Screen name="blog/[slug]" options={{ headerShown: false }} />
      <Stack.Screen name="product/[id]" options={{ title: 'Product Details', headerBackTitle: 'Back' }} />
      <Stack.Screen name="cart" options={{
        title: 'My Cart',
        headerLeft: () => (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to previous screen or shop"
            onPress={() => cartBackDestination(router.canGoBack()) === 'back' ? router.back() : router.replace('/(tabs)/products')}
            style={{ minWidth: 72, minHeight: 44, flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="chevron-back" size={22} color="#0054A6" />
            <Text style={{ color: '#0054A6', fontSize: 16 }}>Back</Text>
          </TouchableOpacity>
        ),
      }} />
      <Stack.Screen name="checkout" options={{ title: 'Checkout' }} />
      <Stack.Screen name="order/[id]" options={{ title: 'Order Details' }} />
      <Stack.Screen name="ticket/new" options={{ title: 'New Ticket' }} />
      <Stack.Screen name="review/new" options={{ title: 'Write a Review' }} />
      <Stack.Screen name="review/list" options={{ title: 'Reviews' }} />
      <Stack.Screen name="admin/product-media" options={{ title: 'Product Media' }} />
      <Stack.Screen name="admin/product-edit" options={{ title: 'Edit Product' }} />
      <Stack.Screen name="water-test" options={{ title: 'Water Test Request' }} />
      <Stack.Screen name="rewards" options={{ title: 'My Rewards' }} />
      <Stack.Screen name="care" options={{ title: 'Your water care' }} />
      <Stack.Screen name="auth/login" options={{ title: '', headerTransparent: true }} />
      <Stack.Screen name="auth/register" options={{ title: '', headerTransparent: true }} />
      <Stack.Screen name="auth/forgot-password" options={{ title: '', headerTransparent: true }} />
      <Stack.Screen name="auth/change-password" options={{ title: '', headerTransparent: true }} />
    </Stack>
    <CompanionTabMenu />
    </>
  );
}

export default function RootLayout() {
  useEffect(() => installCompanionDiagnostics(), []);
  useEffect(() => {
    if (installConfiguredGoogleProductAnalytics() === 'invalid') console.warn('Product analytics configuration is invalid; Google events remain disabled.');
  }, []);
  useEffect(() => {
    if (Platform.OS === 'web') webAnalyticsLoader.initialize();
    if (Platform.OS === 'web') initializeCompanionFieldVitals();
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'web') {
      void SplashScreen.hideAsync().catch(() => {});
    }
  }, []);

  const app = (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CheckoutReceiptProvider>
        <CartProvider>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <ConnectionStatusFrame>
                <RootLayoutNav />
              </ConnectionStatusFrame>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </CartProvider>
        </CheckoutReceiptProvider>
      </AuthProvider>
    </QueryClientProvider>
  );

  return (
    <SafeAreaProvider style={{ flex: 1 }}>
      <ErrorBoundary>
        {isolatedPreview ? app : (
          <ClerkProvider
            publishableKey={clerkPublishableKey}
            tokenCache={tokenCache}
            proxyUrl={clerkProxyUrl}
          >
            {app}
          </ClerkProvider>
        )}
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
