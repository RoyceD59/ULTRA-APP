import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Linking } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import ImpactBubble from '@/components/ImpactBubble';
import ForestLink from '@/components/ForestLink';
import AboutSocialLinks from '@/components/AboutSocialLinks';
import publicPages from '@/data/public-pages.json';
import { headingProps } from '@/lib/accessibility';

const UC_DEEP = '#005d8f';
const UC_SKY = '#52b6dc';
const SITE = 'https://www.ucfilters.com';

export default function AboutScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottom = Platform.OS === 'web' ? 34 : insets.bottom + 24;
  const [websiteError, setWebsiteError] = useState('');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: bottom }} showsVerticalScrollIndicator={false}>
      <View style={[styles.hero, { backgroundColor: UC_DEEP, paddingTop: (Platform.OS === 'web' ? 24 : insets.top) + 24 }]}>
        <Text style={styles.kicker}>ABOUT US</Text>
        <Text {...headingProps(1)} style={styles.title}>Ultra Clear Companion</Text>
        <Text style={styles.lead}>
          Helping Ultra Clear filter owners in our communities keep their filters working, log the water they filter and see the difference it makes.
        </Text>
      </View>

      <View style={styles.body}>
        <View style={styles.block}>
          <Text {...headingProps(2)} style={[styles.h2, { color: colors.text }]}>What the app is for</Text>
          <Text style={[styles.p, { color: colors.mutedForeground }]}>
            {publicPages['/about'].description}
          </Text>
        </View>

        <View style={styles.block}>
          <Text {...headingProps(2)} style={[styles.h2, { color: colors.text }]}>Shared impact</Text>
          <ImpactBubble />
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
            <Ionicons name="leaf-outline" size={20} color={colors.primary} />
            <Text {...headingProps(2)} style={[styles.h3, { color: colors.text }]}>Hydrate the Future</Text>
          </View>
          <Text style={[styles.p, { color: colors.mutedForeground }]}>
            Part of the 3% allocated from eligible paid purchases goes towards afforestation in our community. Through Hydrate the Future™, the 3% contribution is shared equally between tree growing and clean-water access.
          </Text>
          <Text style={[styles.p, { color: colors.mutedForeground }]}>
            Logging refills in the app does not add any funding. The digital trees you see are illustrative and are not verified field outcomes. Where field evidence is not yet available, it stays marked as pending.
          </Text>
          <Text style={[styles.p, { color: colors.mutedForeground }]}>
            Explore how contributions are allocated, follow verified progress as it becomes available, and join our mission to support healthier communities.
          </Text>
          <ForestLink label="Explore our mission" testID="about-forest-link" />
        </View>

        <TouchableOpacity accessibilityRole="link" accessibilityLabel="Visit the official Ultra Clear website"
          testID="about-website-link" activeOpacity={0.85}
          onPress={() => {
            setWebsiteError('');
            Linking.openURL(SITE).catch(() => setWebsiteError('Unable to open the website. Please try again.'));
          }}
          style={[styles.cta, { backgroundColor: UC_DEEP }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.ctaTitle}>Official website</Text>
            <Text style={styles.ctaSub}>www.ucfilters.com</Text>
          </View>
          <Ionicons name="open-outline" size={20} color={UC_SKY} />
        </TouchableOpacity>
        {!!websiteError && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{websiteError}</Text>}
        <AboutSocialLinks />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 20, paddingBottom: 28, gap: 8 },
  kicker: { color: UC_SKY, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: '#fff', fontSize: 26, fontWeight: '800' },
  lead: { color: 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 21 },
  body: { padding: 16, gap: 20, width: '100%', maxWidth: 720, alignSelf: 'center' },
  block: { gap: 8 },
  h2: { fontSize: 18, fontWeight: '700' },
  h3: { fontSize: 16, fontWeight: '700' },
  p: { fontSize: 14, lineHeight: 21 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 10 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 16, minHeight: 56 },
  ctaTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  ctaSub: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 },
});
