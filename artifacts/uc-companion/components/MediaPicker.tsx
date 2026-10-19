import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Image, StyleSheet,
  Modal, Alert, Platform,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useColors } from '@/hooks/useColors';
import * as Haptics from 'expo-haptics';

export interface MediaItem {
  uri: string;
  type: 'photo' | 'video';
  /** Existing server reference when reopening an already-saved attachment. */
  storedUrl?: string;
  duration?: number; // seconds
  mimeType?: string;
  fileName?: string;
  fileSize?: number; // bytes
}

/** Copy upload-relevant metadata off an ImagePicker asset. */
function assetMeta(a: ImagePicker.ImagePickerAsset): Pick<MediaItem, 'mimeType' | 'fileName' | 'fileSize'> {
  return {
    mimeType: a.mimeType ?? undefined,
    fileName: a.fileName ?? undefined,
    fileSize: a.fileSize ?? undefined,
  };
}

interface Props {
  items: MediaItem[];
  onChange: (items: MediaItem[]) => void;
  maxItems?: number;
  label?: string;
}

function fmt(sec: number) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function MediaPicker({ items, onChange, maxItems = 6, label }: Props) {
  const colors = useColors();
  const [sheetVisible, setSheetVisible] = useState(false);
  const [playerVisible, setPlayerVisible] = useState(false);
  const [activeVideo, setActiveVideo] = useState<MediaItem | null>(null);

  // Always initialise with null; we replace the source before opening.
  const player = useVideoPlayer(null as unknown as string, p => { p.loop = false; });

  // ── permissions ──────────────────────────────────────────────────────────
  async function reqCamera() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow camera access to continue.');
      return false;
    }
    return true;
  }
  async function reqLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access to continue.');
      return false;
    }
    return true;
  }

  // ── pickers ───────────────────────────────────────────────────────────────
  async function takePhoto() {
    setSheetVisible(false);
    if (!(await reqCamera())) return;
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (!r.canceled && r.assets[0]) push({ uri: r.assets[0].uri, type: 'photo', ...assetMeta(r.assets[0]) });
  }

  async function recordVideo() {
    setSheetVisible(false);
    if (!(await reqCamera())) return;
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: 15 });
    if (!r.canceled && r.assets[0]) {
      const a = r.assets[0];
      push({ uri: a.uri, type: 'video', duration: a.duration ? a.duration / 1000 : undefined, ...assetMeta(a) });
    }
  }

  async function pickPhoto() {
    setSheetVisible(false);
    if (!(await reqLibrary())) return;
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (!r.canceled && r.assets[0]) push({ uri: r.assets[0].uri, type: 'photo', ...assetMeta(r.assets[0]) });
  }

  async function pickVideo() {
    setSheetVisible(false);
    if (!(await reqLibrary())) return;
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], videoMaxDuration: 15 });
    if (!r.canceled && r.assets[0]) {
      const a = r.assets[0];
      push({ uri: a.uri, type: 'video', duration: a.duration ? a.duration / 1000 : undefined, ...assetMeta(a) });
    }
  }

  function push(item: MediaItem) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChange([...items, item]);
  }

  function remove(i: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChange(items.filter((_, j) => j !== i));
  }

  function openPlayer(item: MediaItem) {
    setActiveVideo(item);
    player.replace({ uri: item.uri });
    player.play();
    setPlayerVisible(true);
  }

  function closePlayer() {
    player.pause();
    setPlayerVisible(false);
  }

  const actions = [
    { icon: 'camera' as const,    label: 'Take Photo',                 onPress: takePhoto },
    { icon: 'videocam' as const,  label: 'Record Video  (max 15 s)',   onPress: recordVideo },
    { icon: 'images' as const,    label: 'Photo Library',              onPress: pickPhoto },
    { icon: 'film' as const,      label: 'Video Library',              onPress: pickVideo },
  ];

  return (
    <View style={{ gap: 10 }}>
      {label != null && (
        <Text style={[s.label, { color: colors.text }]}>
          {label}  <Text style={{ color: colors.mutedForeground, fontWeight: '400' }}>({items.length}/{maxItems})</Text>
        </Text>
      )}

      <View style={s.grid}>
        {items.map((item, i) => (
          <View key={i} style={s.cell}>
            {item.type === 'photo' ? (
              <Image source={{ uri: item.uri }} style={s.thumb} resizeMode="cover" />
            ) : (
              <TouchableOpacity
                onPress={() => openPlayer(item)}
                activeOpacity={0.8}
                style={[s.thumb, s.videoCell, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '40', borderWidth: 1 }]}
              >
                <Ionicons name="play-circle" size={34} color={colors.primary} />
                {item.duration != null && (
                  <View style={s.durationBadge}>
                    <Text style={s.durationTxt}>{fmt(item.duration)}</Text>
                  </View>
                )}
                <View style={s.videoLabel}>
                  <Ionicons name="videocam" size={10} color="#fff" />
                </View>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => remove(i)} style={[s.removeBtn, { backgroundColor: colors.destructive }]}>
              <Ionicons name="close" size={11} color="#fff" />
            </TouchableOpacity>
          </View>
        ))}

        {items.length < maxItems && (
          <TouchableOpacity
            onPress={() => setSheetVisible(true)}
            activeOpacity={0.8}
            style={[s.addBtn, { borderColor: colors.primary + '60', backgroundColor: colors.surface }]}
          >
            <Ionicons name="add-circle-outline" size={28} color={colors.primary} />
            <Text style={[s.addTxt, { color: colors.mutedForeground }]}>Add</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Action sheet ──────────────────────────────────────────────── */}
      <Modal visible={sheetVisible} transparent animationType="slide" onRequestClose={() => setSheetVisible(false)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setSheetVisible(false)} />
        <View style={[s.sheet, { backgroundColor: colors.card }]}>
          <View style={[s.handle, { backgroundColor: colors.border }]} />
          <Text style={[s.sheetTitle, { color: colors.text }]}>Add Media</Text>

          {actions.map(a => (
            <TouchableOpacity key={a.label} onPress={a.onPress} activeOpacity={0.7}
              style={[s.sheetRow, { borderBottomColor: colors.border }]}>
              <View style={[s.sheetIconBox, { backgroundColor: colors.primary + '14' }]}>
                <Ionicons name={a.icon} size={20} color={colors.primary} />
              </View>
              <Text style={[s.sheetRowTxt, { color: colors.text }]}>{a.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.border} />
            </TouchableOpacity>
          ))}

          <TouchableOpacity onPress={() => setSheetVisible(false)}
            style={[s.cancelBtn, { backgroundColor: colors.surface, marginTop: 10 }]}>
            <Text style={[s.cancelTxt, { color: colors.mutedForeground }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ── Full-screen video player ───────────────────────────────────── */}
      <Modal visible={playerVisible} transparent={false} animationType="fade" onRequestClose={closePlayer}>
        <View style={[s.playerModal, { backgroundColor: '#000' }]}>
          <TouchableOpacity onPress={closePlayer} style={s.playerClose}>
            <Ionicons name="close-circle" size={38} color="rgba(255,255,255,0.9)" />
          </TouchableOpacity>

          <VideoView
            player={player}
            style={s.videoView}
            contentFit="contain"
            nativeControls
          />

          {activeVideo?.duration != null && (
            <Text style={s.playerDuration}>Duration · {fmt(activeVideo.duration)}</Text>
          )}
        </View>
      </Modal>
    </View>
  );
}

const CELL = 80;

const s = StyleSheet.create({
  label: { fontSize: 15, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { width: CELL, height: CELL, borderRadius: 10, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%', borderRadius: 10 },
  videoCell: { alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  durationBadge: { position: 'absolute', bottom: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  durationTxt: { color: '#fff', fontSize: 10, fontWeight: '700' },
  videoLabel: { position: 'absolute', top: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 4, padding: 2 },
  removeBtn: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  addBtn: { width: CELL, height: CELL, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 3 },
  addTxt: { fontSize: 11 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 36 : 16 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  sheetTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetIconBox: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sheetRowTxt: { flex: 1, fontSize: 15, fontWeight: '500' },
  cancelBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelTxt: { fontSize: 15, fontWeight: '600' },

  playerModal: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  playerClose: { position: 'absolute', top: Platform.OS === 'ios' ? 54 : 22, right: 18, zIndex: 10 },
  videoView: { width: '100%', aspectRatio: 16 / 9 },
  playerDuration: { color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 18 },
});
