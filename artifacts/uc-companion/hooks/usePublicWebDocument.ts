import { useEffect } from 'react';
import { Platform } from 'react-native';
import { usePathname } from 'expo-router';
import { syncPublicRecordLayout } from '@/lib/publicRecordLayout';

type PublicMetadata = {
  title: string;
  description?: string;
  robots: string;
  canonical?: string;
  url?: string;
  type?: string;
  image?: string;
};

/** Progressive enhancement only; never executes on native or ordinary Metro. */
export function usePublicWebDocument() {
  const pathname = usePathname();
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const endpoint = document.querySelector<HTMLMetaElement>('meta[name="uc-public-meta-endpoint"]')?.content;
    if (!endpoint) return;
    // Remove the readable initial document only after the interactive tree mounts.
    syncPublicRecordLayout(pathname, document);
    const initial = document.querySelector<HTMLMetaElement>('meta[name="uc-public-document-path"]');
    if (initial?.content === pathname) {
      initial.remove();
      return;
    }
    initial?.remove();
    const controller = new AbortController();
    // Drop old product/article metadata immediately on client navigation, even
    // when a request fails. No private route may inherit a public canonical.
    document.querySelectorAll('[data-uc-seo]').forEach(node => node.remove());
    document.title = 'Ultra-Clear Companion';
    const provisional = document.createElement('meta');
    provisional.name = 'robots';
    provisional.content = 'noindex, follow';
    provisional.dataset.ucSeo = '';
    document.head.append(provisional);

    void fetch(`${endpoint}?path=${encodeURIComponent(pathname)}`, {
      credentials: 'omit', signal: controller.signal, headers: { Accept: 'application/json' },
    }).then(async response => {
      if (![200, 404, 503].includes(response.status)) throw new Error('Public metadata unavailable');
      const payload = await response.json() as { meta: PublicMetadata; schemas: unknown[] };
      if (controller.signal.aborted) return;
      document.querySelectorAll('[data-uc-seo]').forEach(node => node.remove());
      document.title = payload.meta.title;
      const addMeta = (name: string, value?: string, property = false) => {
        if (!value) return;
        const node = document.createElement('meta');
        node.setAttribute(property ? 'property' : 'name', name);
        node.content = value;
        node.dataset.ucSeo = '';
        document.head.append(node);
      };
      addMeta('description', payload.meta.description);
      addMeta('robots', payload.meta.robots);
      addMeta('og:title', payload.meta.title, true);
      addMeta('og:description', payload.meta.description, true);
      addMeta('og:url', payload.meta.url, true);
      addMeta('og:type', payload.meta.type, true);
      addMeta('og:site_name', 'Ultra-Clear Companion', true);
      addMeta('og:image', payload.meta.image, true);
      addMeta('twitter:card', payload.meta.image ? 'summary_large_image' : 'summary');
      addMeta('twitter:title', payload.meta.title);
      addMeta('twitter:description', payload.meta.description);
      addMeta('twitter:image', payload.meta.image);
      if (payload.meta.canonical) {
        const node = document.createElement('link');
        node.rel = 'canonical';
        node.href = payload.meta.canonical;
        node.dataset.ucSeo = '';
        document.head.append(node);
      }
      for (const schema of payload.schemas) {
        const node = document.createElement('script');
        node.type = 'application/ld+json';
        node.textContent = JSON.stringify(schema);
        node.dataset.ucSeo = '';
        document.head.append(node);
      }
    }).catch(error => {
      if (!controller.signal.aborted) console.warn('Public page metadata could not be refreshed', error);
    });
    return () => controller.abort();
  }, [pathname]);
}