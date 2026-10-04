import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '@/hooks/useColors';
import { resolveMediaUrl, useApi } from '@/hooks/useApi';
import { useAuth } from '@/context/AuthContext';
import StarRating from '@/components/StarRating';
import MediaPicker, { type MediaItem } from '@/components/MediaPicker';
import { uploadMediaItems } from '@/lib/uploadMedia';
import { customerQueryKeys } from '@/lib/customerQueryKeys';
import { trackEvent } from '@/lib/analytics';

const RATING_LABELS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

export default function NewReviewScreen() {
  const { user } = useAuth();
  return <NewReviewScreenContent key={user?.id ?? 'guest'} />;
}

function NewReviewScreenContent() {
  const { productId, productName } = useLocalSearchParams<{ productId: string; productName?: string }>();
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const { token, user } = useAuth();
  const queryClient = useQueryClient();

  const pid = parseInt(productId ?? '');

  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const [cameraGranted, setCameraGranted] = useState<boolean | null>(null);

  // Redirect guests to sign-in.
  useEffect(() => {
    if (!token) router.replace('/auth/login');
  }, [token, router]);

  // ── Request camera + microphone permissions proactively on mount ──────────
  useEffect(() => {
    async function requestPerms() {
      // Camera (covers photo + video recording)
      const cam = await ImagePicker.requestCameraPermissionsAsync();
      // Media library (for picking from gallery)
      await ImagePicker.requestMediaLibraryPermissionsAsync();
      setCameraGranted(cam.status === 'granted');
    }
    requestPerms();
  }, []);

  // Prefill when editing an existing review.
  const { data: existing } = useQuery({
    queryKey: customerQueryKeys.reviews(user?.id, pid),
    queryFn: () => api.getReviews(pid),
    enabled: !!token && !isNaN(pid),
  });
  useEffect(() => {
    if (prefilled || !existing) return;
    const mine = existing.reviews.find((r) => r.mine);
    if (mine) {
      setRating(mine.rating);
      setBody(mine.body);
      setMedia(mine.media.map((item) => ({
        uri: resolveMediaUrl(item.url),
        storedUrl: item.url,
        type: item.type,
      })));
    }
    setPrefilled(true);
  }, [existing, prefilled]);

  const isEditing = existing?.reviews.some((r) => r.mine) ?? false;
  const hasVideo = media.some((m) => m.type === 'video');

  // ── Direct camera helpers (bypass the picker sheet) ──────────────────────
  async function ensureCameraPermission(): Promise<boolean> {
    const { status } = await ImagePicker.getCameraPermissionsAsync();
    if (status === 'granted') return true;
    const { status: next } = await ImagePicker.requestCameraPermissionsAsync();
    if (next === 'granted') { setCameraGranted(true); return true; }
    Alert.alert(
      'Camera access needed',
      'Please go to Settings and allow camera access for Ultra-Clear Companion.',
      [{ text: 'OK' }],
    );
    return false;
  }

  async function takePhoto() {
    if (media.length >= 4) {
      Alert.alert('Limit reached', 'You can attach up to 4 photos or one video per review.');
      return;
    }
    if (!(await ensureCameraPermission())) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (!r.canceled && r.assets[0]) {
      const a = r.assets[0];
      setMedia((prev) => [
        ...prev,
        { uri: a.uri, type: 'photo', mimeType: a.mimeType ?? undefined, fileName: a.fileName ?? undefined, fileSize: a.fileSize ?? undefined },
      ]);
    }
  }

  async function recordVideo() {
    if (hasVideo) {
      Alert.alert('One video per review', 'Remove the current video to record a new one.');
      return;
    }
    if (!(await ensureCameraPermission())) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: 15 });
    if (!r.canceled && r.assets[0]) {
      const a = r.assets[0];
      setMedia((prev) => [
        ...prev,
        {
          uri: a.uri,
          type: 'video',
          duration: a.duration ? a.duration / 1000 : undefined,
          mimeType: a.mimeType ?? undefined,
          fileName: a.fileName ?? undefined,
          fileSize: a.fileSize ?? undefined,
        },
      ]);
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function submit() {
    if (rating === 0) {
      Alert.alert('Add a rating', 'Please tap the stars to rate this product.');
      return;
    }
    if (body.trim().length < 3) {
      Alert.alert('Add a few words', 'Please write a short review of the product.');
      return;
    }
    const videos = media.filter((m) => m.type === 'video').length;
    if (videos > 1) {
      Alert.alert('Too many videos', 'You can attach one video per review.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    try {
      const uploaded = media.length
        ? await uploadMediaItems(media, api.requestUploadUrl, (done, total) => setProgress({ done, total }))
        : [];
      await api.submitReview(pid, { rating, body: body.trim(), media: uploaded });
      trackEvent('review_submitted', {
        rating,
        photoCount: uploaded.filter(item => item.type === 'photo').length,
        videoCount: uploaded.filter(item => item.type === 'video').length,
      });
      await queryClient.invalidateQueries({ queryKey: customerQueryKeys.reviews(user?.id, pid) });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        isEditing ? 'Review updated' : 'Asante!',
        isEditing ? 'Your review has been updated.' : 'Thanks for sharing your experience.',
      );
      router.back();
    } catch (e) {
      Alert.alert('Could not submit', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }

  if (isNaN(pid)) {
    return (
      <View style={[s.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>Product not found</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, gap: 22, paddingBottom: Platform.OS === 'web' ? 34 : 48 }}
      keyboardShouldPersistTaps="handled"
    >
      {productName ? (
        <Text style={[s.productName, { color: colors.mutedForeground }]}>
          Reviewing <Text style={{ color: colors.text, fontWeight: '700' }}>{productName}</Text>
        </Text>
      ) : null}

      {/* Rating */}
      <View style={s.section}>
        <Text style={[s.label, { color: colors.text }]}>Your rating *</Text>
        <View style={s.starsRow}>
          <StarRating rating={rating} size={38} gap={8} onChange={setRating} />
          {rating > 0 && (
            <Text style={[s.ratingLabel, { color: colors.primary }]}>{RATING_LABELS[rating]}</Text>
          )}
        </View>
      </View>

      {/* Review text */}
      <View style={s.section}>
        <Text style={[s.label, { color: colors.text }]}>Your review *</Text>
        <TextInput
          style={[s.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          placeholder="How is the water taste? Was it easy to install? Would you recommend it?"
          placeholderTextColor={colors.mutedForeground}
          value={body}
          onChangeText={setBody}
          multiline
          numberOfLines={5}
          maxLength={2000}
          textAlignVertical="top"
        />
      </View>

      {/* ── Media section ──────────────────────────────────────────────────── */}
      <View style={s.section}>
        <Text style={[s.label, { color: colors.text }]}>Add photos or video</Text>

        {/* Permission denied notice */}
        {cameraGranted === false && (
          <View style={[s.permNotice, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="camera-outline" size={18} color={colors.mutedForeground} />
            <Text style={[s.permNoticeTxt, { color: colors.mutedForeground }]}>
              Camera access is off — tap a button below to grant it, or pick from your library.
            </Text>
          </View>
        )}

        {/* Direct camera shortcuts */}
        <View style={[s.cameraBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity
            style={s.cameraBtn}
            onPress={takePhoto}
            activeOpacity={0.75}
            disabled={media.length >= 4}
          >
            <View style={[s.cameraBtnIcon, { backgroundColor: colors.primaryLight }]}>
              <Ionicons name="camera" size={22} color={colors.primary} />
            </View>
            <Text style={[s.cameraBtnTxt, { color: colors.text }]}>Take Photo</Text>
            {media.filter((m) => m.type === 'photo').length > 0 && (
              <View style={[s.cameraBtnBadge, { backgroundColor: colors.primary }]}>
                <Text style={s.cameraBtnBadgeTxt}>
                  {media.filter((m) => m.type === 'photo').length}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          <View style={[s.cameraDivider, { backgroundColor: colors.border }]} />

          <TouchableOpacity
            style={s.cameraBtn}
            onPress={recordVideo}
            activeOpacity={0.75}
            disabled={hasVideo}
          >
            <View style={[s.cameraBtnIcon, { backgroundColor: hasVideo ? colors.surface : colors.primaryLight }]}>
              <Ionicons name="videocam" size={22} color={hasVideo ? colors.mutedForeground : colors.primary} />
            </View>
            <Text style={[s.cameraBtnTxt, { color: hasVideo ? colors.mutedForeground : colors.text }]}>
              {hasVideo ? 'Video added' : 'Record Video'}
            </Text>
            {hasVideo && (
              <Ionicons name="checkmark-circle" size={16} color={colors.success} />
            )}
          </TouchableOpacity>
        </View>

        {/* Library picker (for choosing from gallery) */}
        <MediaPicker items={media} onChange={setMedia} maxItems={4} label="Or choose from library" />

        <Text style={[s.hint, { color: colors.mutedForeground }]}>
          Up to 4 attachments — photos plus one short video (max 15 s).
        </Text>
        {isEditing && (
          <Text style={[s.hint, { color: colors.mutedForeground }]}>
            Submitting replaces the attachments on your previous review.
          </Text>
        )}
      </View>

      <TouchableOpacity
        onPress={submit}
        disabled={submitting}
        activeOpacity={0.85}
        style={[s.submitBtn, { backgroundColor: colors.primary, opacity: submitting ? 0.7 : 1 }]}
      >
        {submitting ? (
          <View style={s.submitInner}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={s.submitTxt}>
              {progress ? `Uploading ${progress.done}/${progress.total}…` : 'Submitting…'}
            </Text>
          </View>
        ) : (
          <Text style={s.submitTxt}>{isEditing ? 'Update review' : 'Submit review'}</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  productName: { fontSize: 14 },
  section: { gap: 10 },
  label: { fontSize: 15, fontWeight: '600' },
  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  ratingLabel: { fontSize: 15, fontWeight: '700' },
  input: { borderRadius: 12, borderWidth: 1, padding: 14, fontSize: 15, minHeight: 120 },
  hint: { fontSize: 12, lineHeight: 17 },

  // Permission notice
  permNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderWidth: 1, borderRadius: 10, padding: 12,
  },
  permNoticeTxt: { flex: 1, fontSize: 13, lineHeight: 18 },

  // Camera bar
  cameraBar: {
    flexDirection: 'row', borderRadius: 14, borderWidth: 1,
    overflow: 'hidden',
  },
  cameraBtn: {
    flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, gap: 6,
  },
  cameraBtnIcon: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  cameraBtnTxt: { fontSize: 13, fontWeight: '600' },
  cameraBtnBadge: {
    position: 'absolute', top: 8, right: 16,
    minWidth: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  cameraBtnBadgeTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
  cameraDivider: { width: StyleSheet.hairlineWidth },

  // Submit
  submitBtn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  submitInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  submitTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
