import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDES } from '../../data/guides';
import { createGuideLanguageStore, GUIDE_LANGUAGE_KEY, localizeGuide } from '../guideLanguage';

const ids = ['bottle-setup', 'sweet-home-install', 'shower-filter-install', 'bottle-cartridge-swap'];
const visibleText = (value: unknown) => JSON.stringify(value).match(/\d+(?:[.–/-]\d+)?/g);

describe('bundled Swahili guides', () => {
  for (const id of ids) {
    it(`${id} translates every section, step and safety callout without changing quantities`, () => {
      const english = GUIDES.find(guide => guide.id === id)!;
      const sw = localizeGuide(english, 'sw');
      assert.equal(sw.title, english.titleSw);
      assert.equal(sw.summary, english.summarySw);
      assert.notEqual(sw.title, english.title);
      assert.equal(sw.sections.length, english.sections.length);
      english.sections.forEach((section, index) => {
        const translated = sw.sections[index];
        assert.notEqual(translated.heading, section.heading);
        for (const field of ['body', 'tip', 'warning'] as const) {
          assert.equal(Boolean(translated[field]), Boolean(section[field]));
          if (section[field]) {
            assert.notEqual(translated[field], section[field]);
            assert.deepEqual(visibleText(translated[field]), visibleText(section[field]));
          }
        }
        assert.equal(translated.steps?.length, section.steps?.length);
        section.steps?.forEach((step, stepIndex) => {
          assert.notEqual(translated.steps![stepIndex], step);
          assert.deepEqual(visibleText(translated.steps![stepIndex]), visibleText(step));
        });
      });
      assert.equal(localizeGuide(english, 'en'), english);
    });
  }

  it('falls back silently for untranslated and unknown guides', () => {
    const guide = GUIDES.find(item => item.id === 'ecosmart-elite-setup')!;
    assert.equal(localizeGuide(guide, 'sw'), guide);
    const unknown = { ...guide, id: 'new-published-guide' };
    assert.equal(localizeGuide(unknown, 'sw'), unknown);
  });

  it('localizes published/cached English content and retains new media', () => {
    const english = GUIDES.find(item => item.id === ids[0])!;
    const { titleSw, summarySw, sectionsSw, ...published } = english;
    const media = [{ id: 'photo', kind: 'image' as const, url: '/photo', mimeType: 'image/png', altText: 'Bottle' }];
    published.sections = published.sections.map((section, index) =>
      index === 0 ? { ...section, media, illustrationIcon: 'cube-outline' } : section);
    const sw = localizeGuide(published, 'sw');
    assert.equal(sw.title, titleSw);
    assert.equal(sw.sections[0].media, media);
    assert.equal(sw.sections[0].illustrationIcon, 'cube-outline');
    const updated = { ...published, sections: [{ ...published.sections[0], body: 'Updated safety instructions' }] };
    assert.equal(localizeGuide(updated, 'sw'), updated);
    const cached = JSON.parse(JSON.stringify(published));
    assert.equal(localizeGuide(cached, 'sw').title, titleSw);
  });
});

describe('shared persisted guide language', () => {
  it('defaults to English and restores saved Swahili across store lifetimes', async () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: async (key: string) => data.get(key) ?? null,
      setItem: async (key: string, value: string) => { data.set(key, value); },
    };
    const first = createGuideLanguageStore(storage);
    assert.equal(first.getSnapshot(), 'en');
    await first.hydrate();
    await first.setLanguage('sw');
    assert.equal(data.get(GUIDE_LANGUAGE_KEY), 'sw');
    const reopened = createGuideLanguageStore(storage);
    await reopened.hydrate();
    assert.equal(reopened.getSnapshot(), 'sw');
  });

  it('notifies both screens and preserves the last selection during slow hydration and writes', async () => {
    let finishRead!: (value: string) => void;
    let finishWrite!: () => void;
    const saved: string[] = [];
    const store = createGuideLanguageStore({
      getItem: () => new Promise(resolve => { finishRead = resolve; }),
      setItem: async (_key, value) => {
        if (saved.length === 0) await new Promise<void>(resolve => { finishWrite = resolve; });
        saved.push(value);
      },
    });
    const list: string[] = [], detail: string[] = [];
    const unsubscribe = store.subscribe(() => list.push(store.getSnapshot()));
    store.subscribe(() => detail.push(store.getSnapshot()));
    const loading = store.hydrate();
    const first = store.setLanguage('sw');
    const last = store.setLanguage('en');
    finishRead('sw');
    await loading;
    assert.equal(store.getSnapshot(), 'en');
    assert.deepEqual(list, ['sw', 'en']);
    assert.deepEqual(detail, list);
    finishWrite();
    await Promise.all([first, last]);
    assert.deepEqual(saved, ['sw', 'en']);
    unsubscribe();
    await store.setLanguage('sw');
    assert.deepEqual(list, ['sw', 'en']);
    assert.deepEqual(detail, ['sw', 'en', 'sw']);
  });

  it('ignores corrupt saved preferences', async () => {
    const store = createGuideLanguageStore({ getItem: async () => 'unsupported', setItem: async () => {} });
    await store.hydrate();
    assert.equal(store.getSnapshot(), 'en');
  });

  it('keeps toggles usable after read/write failures and reports the failures', async () => {
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args) => { warnings.push(args); };
    try {
      let attempts = 0;
      const saved: string[] = [];
      const store = createGuideLanguageStore({
        getItem: async () => { throw new Error('Storage unavailable'); },
        setItem: async (_key, value) => {
          if (attempts++ === 0) throw new Error('Disk full');
          saved.push(value);
        },
      });
      await store.hydrate();
      await store.setLanguage('sw');
      assert.equal(store.getSnapshot(), 'sw');
      await store.setLanguage('en');
      assert.deepEqual(saved, ['en']);
      assert.equal(warnings.length, 2);
    } finally { console.warn = originalWarn; }
  });
});