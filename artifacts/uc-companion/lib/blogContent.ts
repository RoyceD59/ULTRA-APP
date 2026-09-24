import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UCBlogArticle, UCBlogPage } from '@/hooks/useApi';

const FEED_CACHE_PREFIX = 'companion_blog_feed_v1_';
const DETAIL_CACHE_PREFIX = 'companion_blog_article_v1_';

export type CachedBlogPage = UCBlogPage & { fromCache?: boolean };
export type CachedBlogArticle = { article: UCBlogArticle; fromCache?: boolean };

function feedCacheKey(params: { search?: string; category?: string; cursor?: string; limit?: number }): string {
  return `${FEED_CACHE_PREFIX}${encodeURIComponent(JSON.stringify({
    search: params.search ?? '',
    category: params.category ?? '',
    cursor: params.cursor ?? '',
    limit: params.limit ?? 12,
  }))}`;
}

export async function fetchBlogPage(
  getPage: (signal?: AbortSignal) => Promise<UCBlogPage>,
  params: { search?: string; category?: string; cursor?: string; limit?: number },
  signal?: AbortSignal,
): Promise<CachedBlogPage> {
  const key = feedCacheKey(params);
  try {
    const page = await getPage(signal);
    await AsyncStorage.setItem(key, JSON.stringify(page)).catch(() => undefined);
    return page;
  } catch (error) {
    if (signal?.aborted) throw error;
    const cached = await AsyncStorage.getItem(key).catch(() => null);
    if (!cached) throw error;
    try {
      const page = JSON.parse(cached) as UCBlogPage;
      if (!Array.isArray(page.articles)) throw new Error('Cached blog feed is invalid');
      return { ...page, fromCache: true };
    } catch {
      await AsyncStorage.removeItem(key).catch(() => undefined);
      throw error;
    }
  }
}

export async function fetchBlogArticle(
  slug: string,
  getArticle: (signal?: AbortSignal) => Promise<{ article: UCBlogArticle }>,
  signal?: AbortSignal,
): Promise<CachedBlogArticle> {
  const key = `${DETAIL_CACHE_PREFIX}${encodeURIComponent(slug)}`;
  try {
    const result = await getArticle(signal);
    await AsyncStorage.setItem(key, JSON.stringify(result)).catch(() => undefined);
    return result;
  } catch (error) {
    if (signal?.aborted) throw error;
    const cached = await AsyncStorage.getItem(key).catch(() => null);
    if (!cached) throw error;
    try {
      const result = JSON.parse(cached) as { article?: UCBlogArticle };
      if (!result.article?.body) throw new Error('Cached blog article is invalid');
      return { article: result.article, fromCache: true };
    } catch {
      await AsyncStorage.removeItem(key).catch(() => undefined);
      throw error;
    }
  }
}
