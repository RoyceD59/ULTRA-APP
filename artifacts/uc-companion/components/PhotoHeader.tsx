import React, { useState } from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Image, type ImageSource } from 'expo-image';

const UC_DEEP = '#005d8f';

type Props = {
  source: ImageSource | number;
  photoHeight?: number;
  position?: 'top' | 'center' | 'bottom';
  style?: StyleProp<ViewStyle>;
  panelStyle?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

/** Photo band over a brand-colour fallback; content sits on an opaque Deep Ocean panel so contrast never depends on the image. */
export default function PhotoHeader({ source, photoHeight = 112, position = 'center', style, panelStyle, children }: Props) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.band, { height: photoHeight }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {!failed && (
          <Image
            source={source}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            contentPosition={position}
            transition={0}
            priority="low"
            accessible={false}
            onError={() => setFailed(true)}
          />
        )}
      </View>
      <View style={[styles.panel, panelStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: UC_DEEP, width: '100%' },
  band: { backgroundColor: UC_DEEP, overflow: 'hidden' },
  panel: { backgroundColor: UC_DEEP },
});
