import React, { useEffect } from 'react';
import { Modal, View, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { resolveMediaUrl } from '@/hooks/useApi';

export interface ViewerMedia {
  url: string;
  type: 'photo' | 'video';
}

interface Props {
  item: ViewerMedia | null;
  onClose: () => void;
}

/** Full-screen viewer for review/product media (photo zoom view or video player). */
export default function MediaViewer({ item, onClose }: Props) {
  const player = useVideoPlayer(null as unknown as string, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    if (item?.type === 'video') {
      player.replace({ uri: resolveMediaUrl(item.url) });
      player.play();
    } else {
      player.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.url, item?.type]);

  function close() {
    player.pause();
    onClose();
  }

  return (
    <Modal visible={!!item} transparent={false} animationType="fade" onRequestClose={close}>
      <View style={s.modal}>
        <TouchableOpacity onPress={close} style={s.close}>
          <Ionicons name="close-circle" size={38} color="rgba(255,255,255,0.9)" />
        </TouchableOpacity>
        {item?.type === 'photo' ? (
          <Image
            source={{ uri: resolveMediaUrl(item.url) }}
            style={s.photo}
            contentFit="contain"
            transition={150}
          />
        ) : item ? (
          <VideoView player={player} style={s.video} contentFit="contain" nativeControls />
        ) : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  modal: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', top: Platform.OS === 'ios' ? 54 : 22, right: 18, zIndex: 10 },
  photo: { width: '100%', height: '80%' },
  video: { width: '100%', aspectRatio: 16 / 9 },
});
