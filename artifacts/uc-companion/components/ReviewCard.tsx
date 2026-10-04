import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '@/hooks/useColors';
import StarRating from '@/components/StarRating';
import { resizedImageUrl, type UCReview, type UCReviewMedia } from '@/hooks/useApi';

interface Props {
  review: UCReview;
  onOpenMedia: (media: UCReviewMedia) => void;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ReviewCard({ review, onOpenMedia }: Props) {
  const colors = useColors();
  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={s.header}>
        <View style={[s.avatar, { backgroundColor: colors.primary + '18' }]}>
          <Text style={[s.avatarTxt, { color: colors.primary }]}>
            {review.authorName.trim().charAt(0).toUpperCase() || 'C'}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={s.nameRow}>
            <Text style={[s.author, { color: colors.text }]} numberOfLines={1}>
              {review.authorName}
            </Text>
            {review.mine && (
              <View style={[s.mineBadge, { backgroundColor: colors.primary + '14' }]}>
                <Text style={[s.mineTxt, { color: colors.primary }]}>You</Text>
              </View>
            )}
          </View>
          <View style={s.metaRow}>
            <StarRating rating={review.rating} size={12} />
            <Text style={[s.date, { color: colors.mutedForeground }]}>
              {formatDate(review.createdAt)}
            </Text>
          </View>
        </View>
      </View>

      {review.title.length > 0 && (
        <Text style={[s.title, { color: colors.text }]}>{review.title}</Text>
      )}
      <Text style={[s.body, { color: colors.text }]}>{review.body}</Text>

      {review.media.length > 0 && (
        <View style={s.mediaRow}>
          {review.media.map((m, i) => (
            <TouchableOpacity
              key={i}
              activeOpacity={0.8}
              onPress={() => onOpenMedia(m)}
              style={[s.thumbWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              {m.type === 'photo' ? (
                <Image source={{ uri: resizedImageUrl(m.url, 62) }} style={s.thumb} contentFit="cover" transition={120} recyclingKey={m.url} />
              ) : (
                <View style={[s.thumb, s.videoThumb, { backgroundColor: colors.primary + '14' }]}>
                  <Ionicons name="play-circle" size={26} color={colors.primary} />
                </View>
              )}
              {m.type === 'video' && (
                <View style={s.videoTag}>
                  <Ionicons name="videocam" size={9} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const THUMB = 62;

const s = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 15, fontWeight: '700' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  author: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  mineBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  mineTxt: { fontSize: 10, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  date: { fontSize: 11 },
  title: { fontSize: 14, fontWeight: '700' },
  body: { fontSize: 13.5, lineHeight: 19 },
  mediaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  thumbWrap: { width: THUMB, height: THUMB, borderRadius: 9, borderWidth: 1, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  videoThumb: { alignItems: 'center', justifyContent: 'center' },
  videoTag: { position: 'absolute', bottom: 3, left: 3, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: 2 },
});
