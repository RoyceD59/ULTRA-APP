import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiBase } from '@/lib/apiBase';
import { GUIDES, type Guide, type GuideMedia, type GuideSection } from '@/data/guides';

const CACHE_KEY = 'companion_published_guides_v1';
const detailKey = (slug: string) => `companion_published_guide_${slug}_v1`;

function normalizeGuide(value: any): Guide {
  return {
    id: String(value.slug ?? value.id),
    title: String(value.title ?? ''),
    summary: String(value.summary ?? ''),
    products: String(value.products ?? ''),
    category: value.category as Guide['category'],
    icon: String(value.icon ?? 'document-text-outline'),
    readTime: String(value.readTime ?? '3 min read'),
    version: Number(value.version ?? 1),
    updatedAt: value.updatedAt ? String(value.updatedAt) : undefined,
    sections: Array.isArray(value.sections) ? value.sections.map((section: any): GuideSection => ({
      heading: String(section.heading ?? ''),
      body: section.body == null ? undefined : String(section.body),
      steps: Array.isArray(section.steps) ? section.steps.map(String) : undefined,
      tip: section.tip == null ? undefined : String(section.tip),
      warning: section.warning == null ? undefined : String(section.warning),
      illustrationIcon: section.illustrationIcon == null ? undefined : String(section.illustrationIcon),
      media: Array.isArray(section.media) ? section.media.map((media: any): GuideMedia => ({
        id: String(media.id),
        kind: media.kind,
        url: String(media.url),
        mimeType: String(media.mimeType ?? ''),
        altText: String(media.altText ?? 'Guide media'),
        caption: media.caption == null ? null : String(media.caption),
        posterUrl: media.posterUrl == null ? null : String(media.posterUrl),
        byteSize: media.byteSize == null ? null : Number(media.byteSize),
        durationSeconds: media.durationSeconds == null ? null : Number(media.durationSeconds),
        animated: Boolean(media.animated),
      })) : undefined,
    })) : [],
  };
}

export async function fetchPublishedGuides(): Promise<Guide[]> {
  try {
    const response = await fetch(`${getApiBase()}/api/uc/guides`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Guide request failed (${response.status})`);
    const payload = await response.json() as { guides?: unknown[] };
    const guides = (payload.guides ?? []).map(normalizeGuide);
    if (!guides.length) throw new Error('No published guides');
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(guides)).catch(() => undefined);
    return guides;
  } catch {
    return readCachedGuides();
  }
}

export async function readCachedGuides(): Promise<Guide[]> {
  const raw = await AsyncStorage.getItem(CACHE_KEY).catch(() => null);
  if (!raw) return GUIDES;
  try {
    const guides = JSON.parse(raw);
    return Array.isArray(guides) && guides.length ? guides.map(normalizeGuide) : GUIDES;
  } catch {
    return GUIDES;
  }
}

export async function fetchPublishedGuide(slug: string): Promise<Guide> {
  try {
    const response = await fetch(`${getApiBase()}/api/uc/guides/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Guide request failed (${response.status})`);
    const payload = await response.json() as { guide?: unknown };
    if (!payload.guide) throw new Error('Guide response was empty');
    const guide = normalizeGuide(payload.guide);
    await AsyncStorage.setItem(detailKey(slug), JSON.stringify(guide)).catch(() => undefined);
    return guide;
  } catch {
    const raw = await AsyncStorage.getItem(detailKey(slug)).catch(() => null);
    if (raw) {
      try { return normalizeGuide(JSON.parse(raw)); } catch { /* use bundled fallback */ }
    }
    const bundled = GUIDES.find((guide) => guide.id === slug);
    if (bundled) return bundled;
    throw new Error('Guide is unavailable offline');
  }
}

export function bundledGuides(): Guide[] { return GUIDES; }

export function mergeGuideFallback(remote: Guide[] | undefined, cached: Guide[] | undefined): Guide[] {
  if (remote?.length) return remote;
  if (cached?.length) return cached;
  return GUIDES;
}