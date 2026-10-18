import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image as NativeImage, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { resizedImageUrl, resolveMediaUrl } from '@/hooks/useApi';
import { P } from './theme';

/** A failed derivative must not leave a blank gallery on a native device. */
export default function ProductPhoto({ src, alt, width, compact = false, fit = 'contain', priority = 'normal' }: {
  src: string; alt: string; width: number; compact?: boolean; fit?: 'contain' | 'cover'; priority?: 'low' | 'normal' | 'high';
}) {
  const [original, setOriginal] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [failure, setFailure] = useState('');
  useEffect(() => { setOriginal(false); setFailed(false); setLoading(true); }, [src]);
  useEffect(() => {
    if (!loading || failed) return;
    const timer = setTimeout(() => { setFailed(true); setLoading(false); setFailure('Loading timed out'); }, 25000);
    return () => clearTimeout(timer);
  }, [src, original, attempt, loading, failed]);
  const optimized = resizedImageUrl(src, width);
  const full = resolveMediaUrl(src);
  const native = Platform.OS !== 'web';
  const onLoad = () => { setLoading(false); setFailure(''); };
  const onError = (message?: string) => {
    if (!original && optimized !== full) { setOriginal(true); return; }
    setLoading(false); setFailed(true);
    setFailure(/decode|format/i.test(message ?? '') ? 'Image format error'
      : /404/.test(message ?? '') ? 'Photo not found'
      : /403/.test(message ?? '') ? 'Photo access denied' : 'Photo request failed');
  };
  return <View collapsable={false} style={styles.fill} onLayout={e => {
    const { width, height } = e.nativeEvent.layout;
    setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
  }}>
    {!failed ? native ? (size.width > 0 && size.height > 0 ? <NativeImage
      key={`${src}:${original}:${attempt}`} source={{ uri: original ? full : optimized }} accessibilityLabel={alt} resizeMode={fit}
      style={{ width: size.width, height: size.height }} onLoad={onLoad}
      onError={event => onError(event.nativeEvent.error)} /> : null) : <Image key={`${src}:${original}:${attempt}`} source={{ uri: original ? full : optimized }}
      accessibilityLabel={alt} contentFit={fit} style={styles.fill} priority={priority} cachePolicy="memory-disk"
      onLoad={onLoad} onError={event => onError(event.error)} /> : <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Retry photo: ${alt}`}
      onPress={() => { setFailed(false); setLoading(true); setOriginal(true); setAttempt(n => n + 1); }}
      style={styles.feedback}>
      <Text style={styles.text}>{compact ? 'Retry' : `${failure || 'Photo could not load'}. Tap to retry.`}</Text>
    </TouchableOpacity>}
    {loading && !failed ? <View pointerEvents="none" style={styles.feedback}>
      <ActivityIndicator color={P.teal} />
      {!compact ? <Text style={styles.text}>Loading photo…</Text> : null}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, bottom: 0, right: 0 },
  feedback: { position: 'absolute', top: 0, left: 0, bottom: 0, right: 0, alignItems: 'center', justifyContent: 'center', gap: 8 },
  text: { color: P.tealDark, fontSize: 13, textAlign: 'center' },
});
