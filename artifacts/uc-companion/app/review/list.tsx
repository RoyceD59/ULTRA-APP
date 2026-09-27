import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useApi, type UCReviewMedia } from '@/hooks/useApi';
import { useAuth } from '@/context/AuthContext';
import StarRating from '@/components/StarRating';
import ReviewCard from '@/components/ReviewCard';
import MediaViewer from '@/components/MediaViewer';
import { customerQueryKeys } from '@/lib/customerQueryKeys';

export default function ReviewListScreen() {
  const { productId, productName } = useLocalSearchParams<{ productId: string; productName?: string }>();
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const { token, user } = useAuth();
  const [viewerItem, setViewerItem] = useState<UCReviewMedia | null>(null);

  const pid = parseInt(productId ?? '');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: customerQueryKeys.reviews(user?.id, pid),
    queryFn: () => api.getReviews(pid),
    enabled: !isNaN(pid),
  });

  if (isLoading) {
    return (
      <View style={[s.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={[s.center, { backgroundColor: colors.background, gap: 12 }]}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground }}>Couldn't load reviews</Text>
        <TouchableOpacity onPress={() => refetch()} style={[s.retryBtn, { borderColor: colors.primary }]}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const mine = data.reviews.find((r) => r.mine);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={data.reviews}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
        ListHeaderComponent={
          <View style={[s.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.avg, { color: colors.text }]}>{data.average.toFixed(1)}</Text>
            <StarRating rating={data.average} size={18} />
            <Text style={[s.count, { color: colors.mutedForeground }]}>
              {data.count} review{data.count === 1 ? '' : 's'}
              {productName ? ` · ${productName}` : ''}
            </Text>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() =>
                token
                  ? router.push({ pathname: '/review/new', params: { productId: String(pid), productName: productName ?? '' } })
                  : router.push('/auth/login')
              }
              style={[s.writeBtn, { backgroundColor: colors.primary }]}
            >
              <Ionicons name="create-outline" size={16} color="#fff" />
              <Text style={s.writeTxt}>{mine ? 'Edit your review' : 'Write a review'}</Text>
            </TouchableOpacity>
          </View>
        }
        ListEmptyComponent={
          <View style={[s.empty, { borderColor: colors.border }]}>
            <Ionicons name="chatbubble-ellipses-outline" size={36} color={colors.mutedForeground} />
            <Text style={[s.emptyTitle, { color: colors.text }]}>No reviews yet</Text>
            <Text style={[s.emptySub, { color: colors.mutedForeground }]}>
              Be the first to share your experience with this product.
            </Text>
          </View>
        }
        renderItem={({ item }) => <ReviewCard review={item} onOpenMedia={setViewerItem} />}
      />
      <MediaViewer item={viewerItem} onClose={() => setViewerItem(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  retryBtn: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 8 },
  summary: { borderRadius: 14, borderWidth: 1, padding: 18, alignItems: 'center', gap: 6, marginBottom: 6 },
  avg: { fontSize: 34, fontWeight: '800' },
  count: { fontSize: 13 },
  writeBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, marginTop: 8 },
  writeTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 14, padding: 28, alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '700' },
  emptySub: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
