import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { resizedImageUrl, resolveMediaUrl } from '@/hooks/useApi';
import { P } from './theme';

/** A failed derivative must not leave a blank gallery on a native device. */
export default function ProductPhoto({ src, alt, width, compact = false }: {
  src: string; alt: string; width: number; compact?: boolean;
}) {
  const [original, setOriginal] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { setOriginal(false); setFailed(false); setLoading(true); }, [src]);
  const optimized = resizedImageUrl(src, width);
  const full = resolveMediaUrl(src);
  return <View style={styles.fill}>
    {!failed ? <Image key={`${src}:${original}:${attempt}`} source={{ uri: original ? full : optimized }}
      accessibilityLabel={alt} contentFit="contain" style={styles.fill}
      onLoad={() => setLoading(false)}
      onError={() => {
        if (!original && optimized !== full) { setOriginal(true); return; }
        setLoading(false); setFailed(true);
      }} /> : <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Retry photo: ${alt}`}
      onPress={() => { setFailed(false); setLoading(true); setOriginal(true); setAttempt(n => n + 1); }}
      style={styles.feedback}>
      <Text style={styles.text}>{compact ? 'Retry' : 'Photo could not load. Tap to retry.'}</Text>
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
