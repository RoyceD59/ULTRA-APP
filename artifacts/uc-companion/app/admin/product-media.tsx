import React, { useState } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import PageDataLoader from '@/components/PageDataLoader';
import PageDataError from '@/components/PageDataError';
import { useApi, resolveMediaUrl } from '@/hooks/useApi';
import MediaPicker, { type MediaItem } from '@/components/MediaPicker';
import { uploadMediaItems } from '@/lib/uploadMedia';
import { useAuth } from '@/context/AuthContext';
import { customerQueryKeys } from '@/lib/customerQueryKeys';

/**
 * Team-only screen: add or remove extra product photos and a product video.
 * Base catalogue images are shown read-only; team uploads are removable.
 */
export default function ProductMediaAdminScreen() {
  const { productId, productName } = useLocalSearchParams<{ productId: string; productName?: string }>();
  const colors = useColors();
  const api = useApi();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const pid = parseInt(productId ?? '');

  const [staged, setStaged] = useState<MediaItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const { data: product } = useQuery({
    queryKey: ['product', String(pid)],
    queryFn: () => api.getProduct(pid),
    enabled: !isNaN(pid),
  });

  const { data: rows, isLoading, isError, refetch } = useQuery({
    queryKey: customerQueryKeys.adminProductMedia(user?.id, pid),
    queryFn: () => api.getProductMediaAdmin(pid),
    enabled: !!user && !isNaN(pid),
  });

  // Base images = catalogue entries the team cannot delete from the app.
  const overlayUrls = new Set((rows ?? []).map((r) => r.url));
  const baseImages = (product?.images ?? []).filter((img) => !overlayUrls.has(img.src));

  async function saveStaged() {
    if (staged.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaving(true);
    try {
      const uploaded = await uploadMediaItems(staged, api.requestUploadUrl, (done, total) =>
        setProgress({ done, total }),
      );
      for (const item of uploaded) {
        await api.addProductMediaAdmin(pid, {
          url: item.url,
          type: item.type,
          alt: product?.name ?? '',
        });
      }
      setStaged([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: customerQueryKeys.adminProductMedia(user?.id, pid) }),
        queryClient.invalidateQueries({ queryKey: ['product', String(pid)] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
      ]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Product media updated.');
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }

  function confirmDelete(mediaId: number) {
    Alert.alert('Remove media?', 'This removes it from the product page for all customers.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteProductMediaAdmin(mediaId);
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: customerQueryKeys.adminProductMedia(user?.id, pid) }),
              queryClient.invalidateQueries({ queryKey: ['product', String(pid)] }),
              queryClient.invalidateQueries({ queryKey: ['products'] }),
            ]);
          } catch (e) {
            Alert.alert('Could not remove', e instanceof Error ? e.message : 'Please try again.');
          }
        },
      },
    ]);
  }

  if (isNaN(pid)) {
    return (
      <View style={[s.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>Product not found</Text>
      </View>
    );
  }

  if (isLoading && rows === undefined) {
    return (
      <View style={[s.center, { backgroundColor: colors.background }]}>
        <PageDataLoader label="Loading product media…" />
      </View>
    );
  }

  if (isError && rows === undefined) {
    return (
      <View style={[s.center, { backgroundColor: colors.background, gap: 12 }]}>
        <PageDataError title="Product media unavailable" message="Product media couldn’t load. This area is for the Ultra Clear team only." onRetry={refetch} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        padding: 16, gap: 22, paddingBottom: Platform.OS === 'web' ? 34 : 48,
        width: '100%', maxWidth: 800, alignSelf: 'center'
      }}
    >
      {productName ? (
        <Text style={[s.subhead, { color: colors.mutedForeground }]}>
          Managing media for <Text style={{ color: colors.text, fontWeight: '700' }}>{productName}</Text>
        </Text>
      ) : null}

      {/* Catalogue images (read-only) */}
      <View style={s.section}>
        <Text style={[s.label, { color: colors.text }]}>Catalogue images</Text>
        <Text style={[s.hint, { color: colors.mutedForeground }]}>
          These come from the official catalogue and can't be removed here.
        </Text>
        <View style={s.grid}>
          {baseImages.length === 0 && (
            <Text style={[s.hint, { color: colors.mutedForeground }]}>None</Text>
          )}
          {baseImages.map((img, i) => (
            <View key={i} style={[s.cell, { borderColor: colors.border }]}>
              <Image source={{ uri: resolveMediaUrl(img.src) }} style={s.thumb} resizeMode="cover" />
              <View style={[s.baseBadge, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
                <Ionicons name="book-outline" size={9} color="#fff" />
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* Team uploads (removable) */}
      <View style={s.section}>
        <Text style={[s.label, { color: colors.text }]}>Team uploads</Text>
        <Text style={[s.hint, { color: colors.mutedForeground }]}>
          Extra photos appear in the product gallery; the first video becomes the product video.
        </Text>
        <View style={s.grid}>
          {(rows ?? []).length === 0 && (
            <Text style={[s.hint, { color: colors.mutedForeground }]}>Nothing uploaded yet</Text>
          )}
          {(rows ?? []).map((row) => (
            <View key={row.id} style={[s.cell, { borderColor: colors.border }]}>
              {row.type === 'photo' ? (
                <Image source={{ uri: resolveMediaUrl(row.url) }} style={s.thumb} resizeMode="cover" />
              ) : (
                <View style={[s.thumb, s.videoCell, { backgroundColor: colors.primary + '14' }]}>
                  <Ionicons name="videocam" size={22} color={colors.primary} />
                </View>
              )}
              <TouchableOpacity
                onPress={() => confirmDelete(row.id)}
                style={[s.removeBtn, { backgroundColor: colors.destructive }]}
              >
                <Ionicons name="close" size={11} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </View>

      {/* Stage new uploads */}
      <View style={s.section}>
        <MediaPicker items={staged} onChange={setStaged} maxItems={6} label="Add new media" />
        {staged.length > 0 && (
          <TouchableOpacity
            onPress={saveStaged}
            disabled={saving}
            activeOpacity={0.85}
            style={[s.saveBtn, { backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }]}
          >
            {saving ? (
              <View style={s.saveInner}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={s.saveTxt}>
                  {progress ? `Uploading ${progress.done}/${progress.total}…` : 'Saving…'}
                </Text>
              </View>
            ) : (
              <Text style={s.saveTxt}>Upload {staged.length} item{staged.length === 1 ? '' : 's'}</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const CELL = 92;

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  retryBtn: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 8 },
  subhead: { fontSize: 14 },
  section: { gap: 10 },
  label: { fontSize: 15, fontWeight: '700' },
  hint: { fontSize: 12, lineHeight: 17 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { width: CELL, height: CELL, borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  videoCell: { alignItems: 'center', justifyContent: 'center' },
  baseBadge: { position: 'absolute', bottom: 4, left: 4, borderRadius: 4, padding: 3 },
  removeBtn: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  saveBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  saveTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
