import React, { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useColors } from '@/hooks/useColors';
import OrderCard from '@/components/OrderCard';
import { useAuth } from '@/context/AuthContext';
import { customerQueryKeys } from '@/lib/customerQueryKeys';
import PageDataLoader from '@/components/PageDataLoader';
import PageDataError from '@/components/PageDataError';

/** Complete, account-scoped order history. The account tab intentionally only
 * previews recent purchases; this screen never slices the API result. */
export default function OrdersScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const { user } = useAuth();

  const orders = useQuery({
    queryKey: customerQueryKeys.orders(user?.id),
    queryFn: () => api.getOrders(),
    enabled: !!user,
  });
  const commerce = useQuery({
    queryKey: ['commerce-status', user?.id],
    queryFn: () => api.getCommerceStatus(),
    enabled: !!user,
    staleTime: 60_000,
  });

  const refetchOrders = orders.refetch;

  useFocusEffect(
    useCallback(() => {
      if (user) {
        refetchOrders();
      }
    }, [user, refetchOrders])
  );

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={orders.isRefetching} onRefresh={() => orders.refetch()} tintColor={colors.primary} />}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>My Orders</Text>
        <View style={{ width: 26 }} />
      </View>
      {!!user && commerce.data?.legacyHistory !== 'reviewed' ? (
        <View style={{ padding: 12, marginBottom: 12, borderRadius: 8, backgroundColor: colors.card }}>
          <Text style={{ color: colors.text }}>
            Saved Companion orders are shown below. Historical store orders are pending staff review and may not appear yet.
          </Text>
        </View>
      ) : null}
      {!user ? (
        <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/auth/login')} style={styles.state}>
          <Text style={{ color: colors.primary }}>Sign in to view your orders</Text>
        </TouchableOpacity>
      ) : orders.data === undefined && orders.isLoading ? (
        <PageDataLoader label="Loading order history…" />
      ) : orders.data === undefined && orders.isError ? (
        <PageDataError title="Order history unavailable" error={orders.error} onRetry={orders.refetch} />
      ) : !orders.data?.length ? (
        <View style={styles.state}>
          <Ionicons name="bag-outline" size={44} color={colors.mutedForeground} />
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>No Companion orders are recorded here yet.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {orders.isError ? <PageDataError title="Order history could not refresh" message="Your saved orders are shown below." onRetry={orders.refetch} /> : null}
          {orders.data.map(order => (
            <OrderCard key={order.id} order={order} onPress={() => router.push(`/order/${order.id}` as never)} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: '700' },
  list: { gap: 10 },
  state: { alignItems: 'center', justifyContent: 'center', minHeight: 240, gap: 14 },
  empty: { fontSize: 15 },
  error: { fontSize: 15, textAlign: 'center' },
  retry: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: '700' },
});