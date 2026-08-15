import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Platform,
  TextInput, ScrollView, SectionList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import TicketCard from '@/components/TicketCard';
import SwipeTabs from '@/components/SwipeTabs';
import {
  GUIDES, GUIDE_CATEGORIES, CATEGORY_ICONS,
  type Guide, type GuideCategory,
} from '@/data/guides';
import { useCartBarInset } from '@/hooks/useCartBarInset';

const TABS = ['Guides', 'My Tickets', 'Water Test'];
const topPad = Platform.OS === 'web' ? 67 : 0;

// ─── AI banner ────────────────────────────────────────────────────────────────
function AiBanner({
  onPress,
  colors,
}: {
  onPress: () => void;
  colors: ReturnType<typeof import('@/hooks/useColors').useColors>;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[aiBannerStyles.wrap, {
        backgroundColor: colors.primaryLight,
        borderColor: colors.primary + '40',
      }]}>
      <View style={[aiBannerStyles.iconWrap, { backgroundColor: colors.primary }]}>
        <Ionicons name="water" size={18} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[aiBannerStyles.title, { color: colors.text }]}>Ask AI — Water Assistant</Text>
        <Text style={[aiBannerStyles.sub, { color: colors.mutedForeground }]}>
          Get instant answers about your filter, water quality, and Nairobi water
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.primary} />
    </TouchableOpacity>
  );
}

const aiBannerStyles = StyleSheet.create({
  wrap:     { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 14, borderRadius: 14, borderWidth: 1, padding: 14 },
  iconWrap: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title:    { fontSize: 14, fontWeight: '700' as const },
  sub:      { fontSize: 12, marginTop: 2, lineHeight: 17 },
});

// ─── Guide card ───────────────────────────────────────────────────────────────
function GuideCard({
  guide,
  onPress,
  colors,
  isLast,
}: {
  guide: Guide;
  onPress: () => void;
  colors: ReturnType<typeof import('@/hooks/useColors').useColors>;
  isLast: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        guideCardStyles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
        !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border, borderRadius: 0, borderWidth: 0, borderTopWidth: 0, borderLeftWidth: 0, borderRightWidth: 0 },
      ]}>
      <View style={[guideCardStyles.icon, { backgroundColor: colors.primaryLight }]}>
        <Ionicons name={guide.icon as never} size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[guideCardStyles.title, { color: colors.text }]}>{guide.title}</Text>
        <Text style={[guideCardStyles.sub, { color: colors.mutedForeground }]} numberOfLines={1}>
          {guide.products} · {guide.readTime}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

const guideCardStyles = StyleSheet.create({
  card:  { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  icon:  { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title: { fontSize: 14, fontWeight: '600' as const, lineHeight: 20 },
  sub:   { fontSize: 12, marginTop: 2 },
});

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function SupportScreen() {
  return (
    <SwipeTabs tab="support">
      <SupportScreenContent />
    </SwipeTabs>
  );
}

function SupportScreenContent() {
  const colors = useColors();
  const router = useRouter();
  const api    = useApi();
  const [tab, setTab]       = useState(0);
  const [search, setSearch] = useState('');
  const cartBarInset = useCartBarInset();

  const { data: tickets, isLoading: loadingTickets } = useQuery({
    queryKey: ['tickets'],
    queryFn:  () => api.getTickets(),
    enabled:  tab === 1,
  });

  // Build grouped sections for SectionList (or flat list when searching)
  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? GUIDES.filter(
          g =>
            g.title.toLowerCase().includes(q) ||
            g.products.toLowerCase().includes(q) ||
            g.summary.toLowerCase().includes(q),
        )
      : GUIDES;

    if (q) {
      // When searching, show flat list as one section
      return [{ category: 'Results' as GuideCategory, data: filtered }];
    }

    return GUIDE_CATEGORIES.map(cat => ({
      category: cat,
      data: filtered.filter(g => g.category === cat),
    })).filter(s => s.data.length > 0);
  }, [search]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Tab bar */}
      <View style={[styles.tabBar, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: topPad }]}>
        {TABS.map((t, i) => (
          <TouchableOpacity
            key={t}
            onPress={() => setTab(i)}
            activeOpacity={0.8}
            style={[styles.tab, tab === i && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}>
            <Text style={[styles.tabText, { color: tab === i ? colors.primary : colors.mutedForeground }]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Guides ── */}
      {tab === 0 && (
        <SectionList
          sections={sections}
          keyExtractor={g => g.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: cartBarInset || (Platform.OS === 'web' ? 34 : 80) }}
          ListHeaderComponent={
            <>
              <AiBanner colors={colors} onPress={() => router.push('/ai-chat' as never)} />
              {/* Search */}
              <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="search-outline" size={16} color={colors.mutedForeground} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search guides…"
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.searchInput, { color: colors.text }]}
                />
                {search.length > 0 && (
                  <TouchableOpacity onPress={() => setSearch('')}>
                    <Ionicons name="close-circle" size={16} color={colors.mutedForeground} />
                  </TouchableOpacity>
                )}
              </View>
            </>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={36} color={colors.border} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No guides found</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                Try a different search term
              </Text>
            </View>
          }
          renderSectionHeader={({ section }) => (
            <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
              <View style={[styles.sectionHeaderIcon, { backgroundColor: colors.primaryLight }]}>
                <Ionicons
                  name={(CATEGORY_ICONS[section.category as GuideCategory] ?? 'document-outline') as never}
                  size={14}
                  color={colors.primary}
                />
              </View>
              <Text style={[styles.sectionHeaderText, { color: colors.text }]}>{section.category}</Text>
            </View>
          )}
          renderItem={({ item: guide, section, index }) => {
            const groupItems = section.data;
            const isFirst = index === 0;
            const isLast  = index === groupItems.length - 1;
            return (
              <View style={[
                styles.guideGroup,
                { backgroundColor: colors.card, borderColor: colors.border },
                isFirst && styles.guideGroupFirst,
                isLast  && styles.guideGroupLast,
                !isFirst && !isLast && { borderRadius: 0 },
              ]}>
                <GuideCard
                  guide={guide}
                  onPress={() => router.push(`/guide/${guide.id}` as never)}
                  colors={colors}
                  isLast={isLast}
                />
              </View>
            );
          }}
          stickySectionHeadersEnabled={false}
        />
      )}

      {/* ── Tickets ── */}
      {tab === 1 && (
        <View style={{ flex: 1 }}>
          <FlatList
            data={tickets ?? []}
            keyExtractor={t => t.id}
            contentContainerStyle={[styles.list, { paddingBottom: cartBarInset || (Platform.OS === 'web' ? 34 : 80) }]}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <TouchableOpacity
                onPress={() => router.push('/ticket/new')}
                style={[styles.newTicketBtn, { backgroundColor: colors.primary }]}>
                <Ionicons name="add" size={20} color="#fff" />
                <Text style={styles.newTicketText}>New Maintenance Ticket</Text>
              </TouchableOpacity>
            }
            ListEmptyComponent={
              loadingTickets ? null : (
                <View style={styles.empty}>
                  <Ionicons name="construct-outline" size={40} color={colors.border} />
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No tickets yet</Text>
                  <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Submit a ticket when you need service</Text>
                </View>
              )
            }
            renderItem={({ item }) => <TicketCard ticket={item} />}
          />
        </View>
      )}

      {/* ── Water Test ── */}
      {tab === 2 && (
        <ScrollView contentContainerStyle={[styles.waterTestContent, { paddingBottom: cartBarInset || (Platform.OS === 'web' ? 34 : 80) }]}>
          <View style={[styles.waterTestCard, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
            <Ionicons name="flask" size={40} color={colors.primary} />
            <Text style={[styles.waterTestTitle, { color: colors.text }]}>Free Water Quality Test</Text>
            <Text style={[styles.waterTestDesc, { color: colors.mutedForeground }]}>
              Book a free water quality assessment at your home or office. Our certified technician will test for
              contaminants, pH, hardness, and recommend the right filtration system.
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/water-test')}
              style={[styles.waterTestBtn, { backgroundColor: colors.primary }]}>
              <Text style={styles.waterTestBtnText}>Book a Water Test</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.waterFeatures}>
            {['Free assessment', 'Certified technician', 'Same-week scheduling', 'Written report included'].map(f => (
              <View key={f} style={styles.waterFeature}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={[styles.waterFeatureText, { color: colors.text }]}>{f}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen:           { flex: 1 },
  tabBar:           { flexDirection: 'row', borderBottomWidth: 1 },
  tab:              { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabText:          { fontSize: 14, fontWeight: '600' as const },

  searchBar:        { flexDirection: 'row', alignItems: 'center', gap: 10, margin: 16, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  searchInput:      { flex: 1, fontSize: 14 },

  sectionHeader:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 },
  sectionHeaderIcon:{ width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  sectionHeaderText:{ fontSize: 13, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.6 },

  guideGroup:       { marginHorizontal: 16, borderWidth: 1, overflow: 'hidden' },
  guideGroupFirst:  { borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  guideGroupLast:   { borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },

  list:             { padding: 16, gap: 10, paddingBottom: Platform.OS === 'web' ? 34 : 80 },
  newTicketBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 14, marginBottom: 16 },
  newTicketText:    { color: '#fff', fontSize: 15, fontWeight: '600' as const },

  empty:            { alignItems: 'center', marginTop: 40, gap: 8, paddingHorizontal: 32 },
  emptyTitle:       { fontSize: 17, fontWeight: '600' as const },
  emptySub:         { fontSize: 14, textAlign: 'center', lineHeight: 22 },

  waterTestContent: { padding: 20, gap: 20, paddingBottom: Platform.OS === 'web' ? 34 : 80 },
  waterTestCard:    { borderWidth: 1, borderRadius: 16, padding: 24, alignItems: 'center', gap: 12 },
  waterTestTitle:   { fontSize: 20, fontWeight: '700' as const, textAlign: 'center' },
  waterTestDesc:    { fontSize: 14, lineHeight: 22, textAlign: 'center' },
  waterTestBtn:     { paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12 },
  waterTestBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' as const },
  waterFeatures:    { gap: 12 },
  waterFeature:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  waterFeatureText: { fontSize: 15, fontWeight: '500' as const },
});
