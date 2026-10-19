import React, { useState } from 'react';
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '@/hooks/useColors';
import { headingProps } from '@/lib/accessibility';

const SOCIAL_LINKS = [
  {
    name: 'Instagram',
    icon: 'logo-instagram',
    url: 'https://www.instagram.com/ultra_clear_filtration_tech?stkn=MTJrYTk3bXd1bHRoYw%3D%3D&utm_source=qr',
  },
  {
    name: 'TikTok',
    icon: 'logo-tiktok',
    url: 'https://www.tiktok.com/@ultra_clear?_r=1&_t=ZS-9AGJ0kmeUjs',
  },
  {
    name: 'Facebook',
    icon: 'logo-facebook',
    url: 'https://www.facebook.com/share/1C1caWuQ17/?mibextid=wwXIfr',
  },
  {
    name: 'YouTube',
    icon: 'logo-youtube',
    url: 'https://www.youtube.com/@UltraClear',
  },
] as const;

export default function AboutSocialLinks() {
  const colors = useColors();
  const [error, setError] = useState('');
  const [focused, setFocused] = useState<string | null>(null);

  async function openLink(link: typeof SOCIAL_LINKS[number]) {
    setError('');
    try {
      await Linking.openURL(link.url);
    } catch {
      setError(`Unable to open ${link.name}. Please try again.`);
    }
  }

  return (
    <View style={styles.section} testID="about-social-links">
      <Text {...headingProps(2)} style={[styles.heading, { color: colors.text }]}>Follow us</Text>
      <View style={styles.row}>
        {SOCIAL_LINKS.map(link => (
          <TouchableOpacity
            key={link.name}
            testID={`about-social-${link.name.toLowerCase()}`}
            accessibilityRole="link"
            accessibilityLabel={`Follow Ultra Clear on ${link.name}`}
            accessibilityHint={`Opens ${link.name} outside the app`}
            {...(Platform.OS === 'web' ? { tabIndex: 0, href: link.url } : {})}
            activeOpacity={0.85}
            onFocus={() => setFocused(link.name)}
            onBlur={() => setFocused(null)}
            onPress={event => {
              // Web anchors supply Enter-key activation. Use the same opener
              // as native, without also following the browser's default URL.
              if (Platform.OS === 'web') event?.preventDefault();
              return openLink(link);
            }}
            style={[styles.link, {
              backgroundColor: colors.card,
              borderColor: focused === link.name ? colors.primary : colors.border,
            }]}>
            <Ionicons name={link.icon} size={26} color={colors.primary}
              accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          </TouchableOpacity>
        ))}
      </View>
      {!!error && (
        <Text testID="about-social-error" accessibilityRole="alert" accessibilityLiveRegion="polite"
          style={[styles.error, { color: colors.destructive }]}>{error}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  heading: { fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  link: { width: 48, height: 48, borderWidth: 2, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  error: { fontSize: 12 },
});