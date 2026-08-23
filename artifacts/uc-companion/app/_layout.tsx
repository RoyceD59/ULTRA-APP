import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
import { Platform } from 'react-native';
import { setBaseUrl } from '@workspace/api-client-react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { usePushTokenSync } from '@/hooks/useNotifications';
import { CartProvider } from '@/context/CartContext';

// Import the notification hook — this also runs setNotificationHandler at
// module level so it's registered before any notification can arrive.
import * as Notifications from 'expo-notifications';

// Set API base URL before any component renders
if (process.env.EXPO_PUBLIC_DOMAIN) {
  setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
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
  const { token } = useAuth();

  // Keep the server's push token fresh: re-registers on app foreground if
  // Expo has rotated the token since the last registration.
  usePushTokenSync(token);

  // Handle notification taps: route user to the relevant screen
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as Record<string, string> | undefined;
      const screen = data?.['screen'];
      if (screen === 'products') {
        router.push('/(tabs)/products' as never);
      } else if (screen === 'shop') {
        router.push('/(tabs)/products' as never);
      } else if (screen === 'orders') {
        router.push('/(tabs)/account' as never);
      } else if (screen === 'filterTracker') {
        // Opens the Account tab which hosts the filter tracker.
        // syncActivationWithCatalogue() runs on mount there and reschedules
        // any activation whose lifespanDays changed in the catalogue.
        router.push('/(tabs)/account' as never);
      }
    });

    return () => sub.remove();
  }, [router]);

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
      <Stack.Screen name="auth/login" options={{ title: '', headerTransparent: true }} />
      <Stack.Screen name="auth/register" options={{ title: '', headerTransparent: true }} />
      <Stack.Screen name="auth/forgot-password" options={{ title: '', headerTransparent: true }} />
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
    <SafeAreaProvider>
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
                <GestureHandlerRootView>
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
