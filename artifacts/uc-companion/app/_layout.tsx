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
import { TouchableOpacity, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as SplashScreen from 'expo-splash-screen';
import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { setBaseUrl, setAuthTokenGetter } from '@workspace/api-client-react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { useNativeNotificationRouting, usePushTokenSync } from '@/hooks/useNativeNotifications';
import { useWaterTestHandoffCapture } from '@/hooks/useWaterTestHandoff';
import { CartProvider } from '@/context/CartContext';
import { getApiBase } from '@/lib/apiBase';
import { shouldRedirectToLogin } from '@/lib/authSessionRedirect';
import { cartBackDestination } from '@/lib/customerScreenState';

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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function RootLayoutNav() {
  const router = useRouter();
  const { token, mustChangePassword } = useAuth();
  const client = useQueryClient();
  const previousToken = useRef<string | null>(token);
  // Keep the server's push token fresh: re-registers on app foreground if
  // Expo has rotated the token since the last registration.
  usePushTokenSync(token);
  useNativeNotificationRouting();

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
