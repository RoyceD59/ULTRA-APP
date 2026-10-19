import React, { useEffect, useRef, useState } from 'react';
import {
  Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useApi, type UCBlogArticle, type UCBlogSource } from '@/hooks/useApi';
import { fetchBlogArticle } from '@/lib/blogContent';
import { useCartBarInset } from '@/hooks/useCartBarInset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { articleInlineLinks } from '@workspace/api-zod/blog-inline-links';
import { trackEvent } from '@/lib/analytics';
import PageDataLoader from '@/components/PageDataLoader';
import PageDataError from '@/components/PageDataError';

type ArticleBlock = { kind: 'heading' | 'paragraph' | 'list' | 'quote'; text: string; ordered?: boolean; number?: string };

function parseArticleBody(body: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  const paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph.length = 0;
  };
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) { flushParagraph(); continue; }
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    const listItem = line.match(/^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/);
    const listNumber = line.match(/^(\d+)[.)]\s+/)?.[1];
    const quote = line.match(/^>\s?(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'heading', text: heading[1] });
    } else if (listItem) {
      flushParagraph();
      blocks.push({ kind: 'list', text: listItem[1], ordered: Boolean(listNumber), number: listNumber });
    } else if (quote) {
      flushParagraph();
      blocks.push({ kind: 'quote', text: quote[1] });
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  return blocks;
}

function renderEmphasis(text: string, color?: string, keyPrefix = ''): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <Text key={`${keyPrefix}${index}`} style={{ fontWeight: '700', ...(color ? { color } : {}) }}>{part.slice(2, -2)}</Text>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <Text key={`${keyPrefix}${index}`} style={{ fontStyle: 'italic' }}>{part.slice(1, -1)}</Text>;
    }
    return <Text key={`${keyPrefix}${index}`}>{part}</Text>;
  });
}

function renderInline(
  text: string,
  color: string,
  linkColor: string,
  sources: readonly UCBlogSource[],
  onSourceError: () => void,
  onSourceClick: () => void,
): React.ReactNode[] {
  return articleInlineLinks(text, sources).map((part, index) => {
    if (part.kind === 'text') {
      return renderEmphasis(part.text, color, `text-${index}-`);
    }
    const label = part.text.replace(/\*\*([^*]+)\*\*|\*([^*]+)\*/g, '$1$2');
    const webLinkProps = Platform.OS === 'web' ? { href: part.url } as { href: string } : {};
    return (
      <Text
        key={`link-${index}`}
        {...webLinkProps}
        accessibilityRole="link"
        accessibilityLabel={label}
        onPress={(event) => {
          // The web anchor and Linking must not both navigate on the same click.
          if (Platform.OS === 'web') event.preventDefault();
          onSourceClick();
          void Linking.openURL(part.url).catch(onSourceError);
        }}
        style={{ color: linkColor, textDecorationLine: 'underline' }}
      >
        {renderEmphasis(part.text, undefined, `link-${index}-`)}
      </Text>
    );
  });
}

function trustedSource(source: UCBlogSource): string | null {
  try {
    const url = new URL(source.url);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function publishedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function ArticleContent({
  article, onSourceError,
}: { article: UCBlogArticle; onSourceError: () => void }) {
  const colors = useColors();
  const blocks = parseArticleBody(article.body);
  const sources = Array.isArray(article.sources) ? article.sources : [];
  const onBodySourceClick = () => trackEvent('article_source_clicked', {
    articleId: article.id, placement: 'body',
  });

  return (
    <>
      <View style={styles.articleMeta}>
        <Text style={[styles.category, { color: colors.primary, backgroundColor: colors.primaryLight }]}>{article.category}</Text>
        <Text style={[styles.date, { color: colors.mutedForeground }]}>{publishedDate(article.publishedAt)}</Text>
      </View>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{article.title}</Text>
      <Text style={[styles.summary, { color: colors.mutedForeground }]}>{article.summary}</Text>
      <View style={[styles.rule, { backgroundColor: colors.border }]} />
      <View style={styles.body}>
        {blocks.map((block, index) => {
          if (block.kind === 'heading') {
            return <Text key={index} accessibilityRole="header" style={[styles.bodyHeading, { color: colors.text }]}>{renderInline(block.text, colors.text, colors.primary, sources, onSourceError, onBodySourceClick)}</Text>;
          }
          if (block.kind === 'list') {
            return (
              <View key={index} style={styles.listItem}>
                <Text style={[styles.listMarker, { color: colors.primary }]}>{block.ordered ? `${block.number ?? '1'}.` : '•'}</Text>
                <Text style={[styles.paragraph, { color: colors.text }]}>{renderInline(block.text, colors.text, colors.primary, sources, onSourceError, onBodySourceClick)}</Text>
              </View>
            );
          }
          if (block.kind === 'quote') {
            return (
              <View key={index} style={[styles.quote, { borderLeftColor: colors.accent, backgroundColor: colors.surface }]}>
                <Text style={[styles.paragraph, { color: colors.text }]}>{renderInline(block.text, colors.text, colors.primary, sources, onSourceError, onBodySourceClick)}</Text>
              </View>
            );
          }
          return <Text key={index} style={[styles.paragraph, { color: colors.text }]}>{renderInline(block.text, colors.text, colors.primary, sources, onSourceError, onBodySourceClick)}</Text>;
        })}
      </View>
      {sources.length > 0 ? (
        <View style={[styles.sourcesBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sourcesHeading}>
            <Ionicons name="link-outline" size={17} color={colors.primary} />
            <Text style={[styles.sourcesTitle, { color: colors.text }]}>Sources</Text>
          </View>
          {sources.map((source, index) => {
            const url = trustedSource(source);
            if (!url) return null;
            return (
              <TouchableOpacity
                key={`${source.title}-${index}`}
                accessibilityRole="link"
                accessibilityLabel={`Open source: ${source.title}`}
                testID={`blog-source-${index}`}
                onPress={() => {
                  trackEvent('article_source_clicked', { articleId: article.id, placement: 'sources' });
                  void Linking.openURL(url).catch(onSourceError);
                }}
                style={styles.sourceLink}
              >
                <Text style={[styles.sourceTitle, { color: colors.primary }]}>{source.title}</Text>
                <Ionicons name="open-outline" size={14} color={colors.primary} />
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </>
  );
}

export default function BlogArticleScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cartBarInset = useCartBarInset();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const api = useApi();
  const [sourceError, setSourceError] = useState(false);
  const query = useQuery({
    queryKey: ['companion', 'blog', 'article', slug],
    queryFn: ({ signal }) => fetchBlogArticle(
      String(slug),
      (requestSignal) => api.getBlogArticle(String(slug), requestSignal),
      signal,
    ),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
    enabled: Boolean(slug),
  });
  const article = query.data?.article;
  const lastOpenedArticle = useRef<string | null>(null);
  useEffect(() => {
    if (query.isLoading || query.isError || !article || lastOpenedArticle.current === article.id) return;
    lastOpenedArticle.current = article.id;
    trackEvent('article_opened', { articleId: article.id });
  }, [article, query.isLoading, query.isError]);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { backgroundColor: colors.card, borderBottomColor: colors.border, paddingTop: topPad + 7 }]}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back to blog"
          testID="blog-back"
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/blog' as never)}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={21} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.topBarTitle, { color: colors.text }]} numberOfLines={1}>The UC Blog</Text>
        <View style={styles.backButton} />
      </View>
      {!article && query.isLoading ? (
        <PageDataLoader label="Loading article…" />
      ) : !article ? (
        <PageDataError title={(query.error as { status?: number })?.status === 404 ? 'Article not found' : 'Article unavailable'}
          error={query.error} onRetry={(query.error as { status?: number })?.status === 404 ? () => router.replace('/(tabs)/blog') : query.refetch}
          actionLabel={(query.error as { status?: number })?.status === 404 ? 'Browse articles' : 'Retry'} testID="blog-article-retry" />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, { paddingBottom: cartBarInset || (Platform.OS === 'web' ? 118 : 100) }]}
        >
          {query.isError ? <PageDataError title="Article could not refresh" message="Your saved article is still available below." onRetry={query.refetch} /> : null}
          {query.data?.fromCache ? (
            <View style={[styles.offlineNotice, { backgroundColor: colors.warningLight }]}>
              <Ionicons name="cloud-offline-outline" size={15} color={colors.warning} />
              <Text style={[styles.offlineText, { color: colors.text }]}>Saved for offline reading</Text>
            </View>
          ) : null}
          <ArticleContent article={article} onSourceError={() => setSourceError(true)} />
          {sourceError ? <Text style={[styles.sourceError, { color: colors.mutedForeground }]}>This source link couldn’t be opened.</Text> : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingBottom: 8, borderBottomWidth: 1 },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topBarTitle: { flex: 1, fontSize: 15, fontWeight: '600' as const, textAlign: 'center' },
  content: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 40, gap: 15, width: '100%', maxWidth: 820, alignSelf: 'center' },
  articleMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  category: { overflow: 'hidden', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, fontSize: 10, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.5 },
  date: { fontSize: 12 },
  title: { fontSize: 29, lineHeight: 37, fontWeight: '700' as const },
  summary: { fontSize: 16, lineHeight: 24 },
  rule: { height: 1, marginVertical: 2 },
  body: { gap: 15 },
  bodyHeading: { fontSize: 20, lineHeight: 27, fontWeight: '700' as const, marginTop: 5 },
  paragraph: { fontSize: 15, lineHeight: 25, flexShrink: 1 },
  listItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  listMarker: { width: 22, fontSize: 15, lineHeight: 25, fontWeight: '700' as const, textAlign: 'right' },
  quote: { borderLeftWidth: 3, borderRadius: 7, paddingHorizontal: 14, paddingVertical: 11 },
  sourcesBox: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 11, marginTop: 8 },
  sourcesHeading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sourcesTitle: { fontSize: 14, fontWeight: '700' as const },
  sourceLink: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6 },
  sourceTitle: { flexShrink: 1, fontSize: 13, lineHeight: 19, fontWeight: '600' as const },
  sourceError: { fontSize: 12, marginTop: 2 },
  offlineNotice: { borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 7 },
  offlineText: { fontSize: 12 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 11 },
  stateTitle: { fontSize: 17, fontWeight: '700' as const, textAlign: 'center' },
  stateText: { maxWidth: 340, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  retryButton: { minHeight: 42, borderRadius: 11, paddingHorizontal: 18, justifyContent: 'center', marginTop: 3 },
  retryText: { fontSize: 13, fontWeight: '700' as const },
});
