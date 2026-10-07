import React, { useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { usePathname } from 'expo-router';

export type PublicRecord = {
  name: string;
  commerceId: number | null;
  availability: string | null;
  purchasable: boolean;
  price: number | null;
  parentSku: string;
  diagnostics: string[];
};
type PublicDocument = { path?: string; body: string; status: number; publicRecord: PublicRecord | null };

export function hasPublicRecordDelivery() {
  return Platform.OS === 'web' && typeof document !== 'undefined'
    && !!document.querySelector('meta[name="uc-public-meta-endpoint"]');
}

function initialDocument(path: string): PublicDocument | null {
  const node = document.getElementById('uc-record-document');
  if (!node) return null;
  try {
    const value = JSON.parse(node.textContent || '') as PublicDocument;
    return value.path === path ? value : null;
  } catch { return null; }
}

/** Uses the same escaped semantic HTML as cold delivery. No authored JSON ships. */
export default function PublicRecordDocument({ controls, route }: {
  route: string;
  controls?: (record: PublicRecord) => React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === route;
  const [state, setState] = useState<{ path: string; page: PublicDocument | null }>(() => ({
    path: route, page: hasPublicRecordDelivery() ? initialDocument(route) : null,
  }));
  const container = useRef<HTMLDivElement>(null);
  const page = state.path === pathname ? state.page : null;
  useEffect(() => {
    if (!active || !hasPublicRecordDelivery()) return;
    if (state.path === pathname && state.page) return;
    const endpoint = document.querySelector<HTMLMetaElement>('meta[name="uc-public-meta-endpoint"]')!.content;
    const controller = new AbortController();
    void fetch(`${endpoint}?path=${encodeURIComponent(pathname)}`, {
      credentials: 'omit', signal: controller.signal, headers: { Accept: 'application/json' },
    }).then(async response => {
      if (![200, 404, 503].includes(response.status)) throw new Error('Public content unavailable');
      const payload = await response.json() as PublicDocument;
      if (typeof payload.body !== 'string') throw new Error('Public content unavailable');
      if (!controller.signal.aborted) setState({ path: pathname, page: payload });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ path: pathname, page: {
        status: 503, publicRecord: null,
        body: '<h1>Content temporarily unavailable</h1><p>Please reload to try again.</p>',
      } });
    });
    return () => controller.abort();
  }, [pathname, state, active]);

  useEffect(() => {
    if (!active || !page || !container.current) return;
    document.getElementById('uc-public-content')?.remove();
    document.getElementById('root')?.removeAttribute('hidden');
    // React Navigation ancestors normally own a fixed viewport. Override only
    // this screen's ancestor chain and restore every declaration on exit.
    const changed: { element: HTMLElement; style: string | null }[] = [];
    let element: HTMLElement | null = container.current.parentElement;
    while (element && element !== document.documentElement) {
      changed.push({ element, style: element.getAttribute('style') });
      Object.assign(element.style, { position: 'static', height: 'auto', minHeight: '0',
        overflow: 'visible', flex: 'none', width: '100%', maxWidth: '100%' });
      element = element.parentElement;
    }
    return () => changed.forEach(({ element, style }) => {
      if (style === null) element.removeAttribute('style'); else element.setAttribute('style', style);
    });
  }, [page, active]);

  if (Platform.OS !== 'web') return <View><Text>Topic content is not yet available.</Text></View>;
  return React.createElement('div', { ref: container, className: 'uc-record-document',
    'data-uc-record-ready': page ? 'true' : undefined },
  page ? React.createElement('main', { key: pathname },
    React.createElement('div', { dangerouslySetInnerHTML: { __html: page.body } }),
    page.publicRecord && controls ? controls(page.publicRecord) : null)
    : React.createElement('p', { role: 'status' }, 'Loading product information…'));
}
