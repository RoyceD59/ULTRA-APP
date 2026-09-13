import React from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useColors } from '@/hooks/useColors';
import OrderCard from '@/components/OrderCard';

/** Complete, account-scoped order history. The account tab intentionally only
 * previews recent purchases; this screen never slices the API result. */
export default function OrdersScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const orders = useQuery({ queryKey: ['orders'], queryFn: () => api.getOrders() });

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
      {orders.isLoading ? (
        <ActivityIndicator style={styles.state} color={colors.primary} size="large" />
      ) : orders.isError ? (
        <View style={styles.state}>
          <Text style={[styles.error, { color: colors.destructive }]}>We couldn&apos;t load your order history.</Text>
          <TouchableOpacity onPress={() => orders.refetch()} style={[styles.retry, { backgroundColor: colors.primary }]}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : !orders.data?.length ? (
        <View style={styles.state}>
          <Ionicons name="bag-outline" size={44} color={colors.mutedForeground} />
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>You have no orders yet.</Text>
        </View>
      ) : (
        <View style={styles.list}>
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