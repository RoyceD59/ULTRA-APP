import React, { useMemo, useState, useEffect } from 'react';
import {
  ActivityIndicator, FlatList, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useApi, type UCBlogArticleSummary } from '@/hooks/useApi';
import { fetchBlogPage } from '@/lib/blogContent';
import { useCartBarInset } from '@/hooks/useCartBarInset';
import { useCompanionLayout } from '@/hooks/useCompanionLayout';
import PageDataLoader from '@/components/PageDataLoader';
import PageDataError from '@/components/PageDataError';

import PhotoHeader from '@/components/PhotoHeader';
import SwipeTabs from '@/components/SwipeTabs';
import { headingProps } from '@/lib/accessibility';

const PAGE_SIZE = 12;
const topPad = 0;

function formatPublishedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function ArticleCard({
  article, onPress,
}: { article: UCBlogArticleSummary; onPress: () => void }) {
  const colors = useColors();
  const date = formatPublishedDate(article.publishedAt);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Read ${article.title}`}
      testID={`blog-article-${article.slug}`}
      activeOpacity={0.78}
      onPress={onPress}
      style={[styles.articleCard, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={styles.cardMeta}>
        <Text style={[styles.category, { color: colors.primary, backgroundColor: colors.primaryLight }]} numberOfLines={1}>
          {article.category}
        </Text>
        {date ? <Text style={[styles.date, { color: colors.mutedForeground }]}>{date}</Text> : null}
      </View>
      <Text style={[styles.articleTitle, { color: colors.text }]}>{article.title}</Text>
      <Text style={[styles.summary, { color: colors.mutedForeground }]} numberOfLines={3}>{article.summary}</Text>
      <View style={styles.readLink}>
        <Text style={[styles.readLinkText, { color: colors.primary }]}>Read article</Text>
        <Ionicons name="arrow-forward" size={15} color={colors.primary} />
      </View>
    </TouchableOpacity>
  );
}

export default function BlogScreen() {
  return <SwipeTabs tab="blog"><BlogScreenContent /></SwipeTabs>;
}

function BlogScreenContent() {
  const layout = useCompanionLayout();
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const cartBarInset = useCartBarInset();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const query = useInfiniteQuery({
    queryKey: ['companion', 'blog', { search, category, limit: PAGE_SIZE }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => fetchBlogPage(
      (requestSignal) => api.getBlogArticles({
        search,
        category: category || undefined,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }, requestSignal),
      { search, category, cursor: pageParam, limit: PAGE_SIZE },
      signal,
    ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  const articles = useMemo(
    () => query.data?.pages.flatMap((page) => page.articles) ?? [],
    [query.data],
  );
  const categories = useMemo(
    () => [...new Set((query.data?.pages ?? []).flatMap((page) => page.articles.map((article) => article.category)).filter(Boolean))].sort(),
    [query.data],
  );
  const usingCache = query.data?.pages.some((page) => page.fromCache) ?? false;
  const emptySearch = search.length > 0 || category.length > 0;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <FlatList
        key={`articles-${layout.articleColumns}`}
        numColumns={layout.articleColumns}
        columnWrapperStyle={layout.articleColumns > 1 ? { gap: layout.gap } : undefined}
        data={articles}
        keyExtractor={(article) => article.id}
        renderItem={({ item }) => (
          <View style={{ width: layout.articleWidth }}>
            <ArticleCard article={item} onPress={() => router.push(`/blog/${encodeURIComponent(item.slug)}` as never)} />
          </View>
        )}
        contentContainerStyle={[styles.listContent, { paddingHorizontal: layout.gutter, paddingBottom: cartBarInset }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={(
          <View style={styles.listHeader}>
            <PhotoHeader initialView source={require('@/assets/headers/blog-water.jpg')} photoHeight={112} position="top" style={{ marginHorizontal: -14 }}>
            <View style={[styles.header, { backgroundColor: '#005d8f', marginHorizontal: 0, paddingTop: topPad + 18 }]}>
              <View style={[styles.headerIcon, { backgroundColor: colors.primaryForeground }]}>
                <Ionicons name="book-outline" size={23} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text {...headingProps(1)} style={[styles.headerTitle, { color: colors.primaryForeground }]}>The UC Blog</Text>
                <Text style={[styles.headerSubtitle, { color: colors.primaryForeground }]}>Clear answers for healthier water.</Text>
              </View>
            </View>
            </PhotoHeader>
            <View style={styles.controls}>
              <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="search-outline" size={19} color={colors.mutedForeground} />
                <TextInput
                  value={searchInput}
                  onChangeText={setSearchInput}
                  placeholder="Search articles"
                  placeholderTextColor={colors.mutedForeground}
                  accessibilityLabel="Search blog articles"
                  returnKeyType="search"
                  style={[styles.searchInput, { color: colors.text }]}
                />
                {searchInput ? (
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear search" testID="blog-clear-search"
                    onPress={() => setSearchInput('')} hitSlop={8}>
                    <Ionicons name="close-circle" size={19} color={colors.mutedForeground} />
                  </TouchableOpacity>
                ) : null}
              </View>
              {categories.length > 0 ? (
                <FlatList
                  horizontal
                  data={['', ...categories]}
                  keyExtractor={(item) => item || 'all'}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.categoryList}
                  renderItem={({ item }) => {
                    const selected = category === item;
                    return (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        testID={`blog-category-${item || 'all'}`}
                        onPress={() => setCategory(item)}
                        style={[styles.categoryChip, {
                          backgroundColor: selected ? colors.primary : colors.card,
                          borderColor: selected ? colors.primary : colors.border,
                        }]}
                      >
                        <Text style={[styles.categoryChipText, { color: selected ? colors.primaryForeground : colors.text }]}>
                          {item || 'All'}
                        </Text>
                      </TouchableOpacity>
                    );
                  }}
                />
              ) : null}
              {usingCache ? (
                <View style={[styles.offlineNotice, { backgroundColor: colors.warningLight }]}>
                  <Ionicons name="cloud-offline-outline" size={15} color={colors.warning} />
                  <Text style={[styles.offlineText, { color: colors.text }]}>Showing saved articles. Connect to refresh.</Text>
                </View>
              ) : null}
               {query.isError && query.data !== undefined ? (
                 <PageDataError title="Articles could not refresh" message="Your saved articles remain available." onRetry={query.refetch} />
              ) : null}
            </View>
          </View>
        )}
        ListEmptyComponent={
          query.data === undefined && query.isLoading ? (
            <PageDataLoader label="Loading articles…" />
          ) : query.data === undefined && query.isError ? (
            <PageDataError title="Blog unavailable" error={query.error} onRetry={query.refetch} testID="blog-retry" />
          ) : (
            <View style={styles.state}>
              <Ionicons name="newspaper-outline" size={30} color={colors.mutedForeground} />
              <Text style={[styles.stateTitle, { color: colors.text }]}>{emptySearch ? 'No matching articles' : 'No articles yet'}</Text>
              <Text style={[styles.stateText, { color: colors.mutedForeground }]}>
                {emptySearch ? 'Try another search or category.' : 'New water and filtration reads will appear here.'}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          query.hasNextPage ? (
            <TouchableOpacity
              accessibilityRole="button"
              testID="blog-load-more"
              disabled={query.isFetchingNextPage}
              onPress={() => { void query.fetchNextPage(); }}
              style={[styles.moreButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              {query.isFetchingNextPage
                ? <ActivityIndicator color={colors.primary} />
                : <Text style={[styles.moreText, { color: colors.primary }]}>Load more articles</Text>}
            </TouchableOpacity>
          ) : articles.length > 0 ? (
            <Text style={[styles.endNote, { color: colors.mutedForeground }]}>You’re all caught up</Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  listContent: { paddingHorizontal: 14, gap: 12, width: '100%', maxWidth: 1200, alignSelf: 'center' },
  listHeader: { gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 13, marginHorizontal: -14, paddingHorizontal: 20, paddingBottom: 22 },
  headerIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 23, lineHeight: 29, fontWeight: '700' as const },
  headerSubtitle: { fontSize: 13, marginTop: 2, opacity: 0.78 },
  controls: { gap: 11 },
  searchBox: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 },
  searchInput: { flex: 1, minHeight: 44, fontSize: 14 },
  categoryList: { gap: 8, paddingRight: 8 },
  categoryChip: { minHeight: 35, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, justifyContent: 'center' },
  categoryChipText: { fontSize: 12, fontWeight: '600' as const },
  offlineNotice: { borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 7 },
  offlineText: { fontSize: 12, flexShrink: 1 },
  articleCard: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 9 },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  category: { maxWidth: '70%', overflow: 'hidden', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4, fontSize: 10, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.4 },
  date: { fontSize: 11 },
  articleTitle: { fontSize: 17, lineHeight: 23, fontWeight: '700' as const },
  summary: { fontSize: 13, lineHeight: 20 },
  readLink: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  readLinkText: { fontSize: 12, fontWeight: '700' as const },
  state: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 46, gap: 10 },
  stateTitle: { fontSize: 16, fontWeight: '700' as const, textAlign: 'center' },
  stateText: { maxWidth: 330, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retryButton: { minHeight: 42, borderRadius: 11, paddingHorizontal: 18, justifyContent: 'center', marginTop: 3 },
  retryText: { fontSize: 13, fontWeight: '700' as const },
  moreButton: { minHeight: 46, borderWidth: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 3 },
  moreText: { fontSize: 13, fontWeight: '700' as const },
  endNote: { textAlign: 'center', fontSize: 12, paddingVertical: 12 },
});
