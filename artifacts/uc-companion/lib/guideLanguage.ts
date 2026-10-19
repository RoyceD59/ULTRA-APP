import { GUIDES, type Guide } from '@/data/guides';

export type GuideLanguage = 'en' | 'sw';
export const GUIDE_LANGUAGE_KEY = 'companion_guide_language_v1';

/** Do not overlay an old translation on newly published instructions.
 * Media-only updates can still share the bundled text translation. */
export function localizeGuide(guide: Guide, language: GuideLanguage): Guide {
  if (language === 'en') return guide;
  const bundled = GUIDES.find(item => item.id === guide.id);
  const text = (item: Guide) => JSON.stringify({
    title: item.title, summary: item.summary,
    sections: item.sections.map(({ heading, body, steps, tip, warning }) => ({ heading, body, steps, tip, warning })),
  });
  const source = guide.titleSw && guide.summarySw && guide.sectionsSw?.length
    ? guide
    : bundled && text(bundled) === text(guide) ? bundled : undefined;
  if (!source?.titleSw || !source.summarySw || !source.sectionsSw?.length) return guide;
  return {
    ...guide,
    title: source.titleSw,
    summary: source.summarySw,
    sections: source.sectionsSw.map((section, index) => ({
      ...section,
      illustrationIcon: section.illustrationIcon ?? guide.sections[index]?.illustrationIcon,
      media: section.media ?? guide.sections[index]?.media,
    })),
  };
}

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

/** One shared store: late hydration cannot undo a tap; writes stay ordered. */
export function createGuideLanguageStore(storage: Storage) {
  let language: GuideLanguage = 'en';
  let changed = false;
  let hydration: Promise<void> | undefined;
  let writes = Promise.resolve();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  return {
    getSnapshot: () => language,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    hydrate() {
      return hydration ??= storage.getItem(GUIDE_LANGUAGE_KEY).then(value => {
        if (!changed && (value === 'en' || value === 'sw')) {
          language = value;
          notify();
        }
      }).catch(error => { console.warn('Could not read guide language preference', error); });
    },
    setLanguage(value: GuideLanguage) {
      changed = true;
      language = value;
      notify();
      writes = writes.then(() => storage.setItem(GUIDE_LANGUAGE_KEY, value))
        .catch(error => { console.warn('Could not save guide language preference', error); });
      return writes;
    },
  };
}