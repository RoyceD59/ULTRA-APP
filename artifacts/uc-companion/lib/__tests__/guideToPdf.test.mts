import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDES, type Guide } from '../../data/guides.ts';
import { localizeGuide } from '../guideLanguage.ts';
import { guideToHtml, exportGuidePdf, type GuidePdfServices } from '../../utils/guideToPdf.ts';

const guide: Guide = {
  ...GUIDES[0],
  title: 'Published guide <script>alert("x")</script>',
  summary: 'Updated & approved',
  sections: [{
    heading: 'Install <safely>',
    body: 'First line\nSecond line',
    steps: ['One & two', 'Check > 3'],
    tip: 'Tip "quoted"',
    warning: 'Never <skip>',
    media: [
      { id: 'image', kind: 'image', url: '/api/media/photo', mimeType: 'image/png', altText: 'Connection diagram', caption: 'Correct fit' },
      { id: 'video', kind: 'video', url: 'javascript:alert(1)', mimeType: 'video/mp4', altText: 'Unsafe link' },
    ],
  }, { heading: 'Collapsed section', body: 'Still included' }],
};

function services(platform: string) {
  const calls: unknown[][] = [];
  const adapter: GuidePdfServices = {
    platform,
    printBrowser: async (html) => { calls.push(['browser', html]); },
    isSharingAvailable: async () => { calls.push(['available']); return true; },
    printToFile: async (options) => { calls.push(['pdf', options]); return { uri: 'file:///cache/guide.pdf' }; },
    share: async (uri, options) => { calls.push(['share', uri, options]); },
  };
  return { adapter, calls };
}

test('branded HTML includes the displayed article, all sections, steps and callouts safely', () => {
  const html = guideToHtml(guide, (url) => url.startsWith('/') ? `https://example.test${url}` : url);
  assert.match(html, /ULTRA CLEAR/);
  assert.match(html, /#005d8f/);
  assert.match(html, /#52b6dc/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|href="javascript:/);
  assert.match(html, /Updated &amp; approved/);
  assert.match(html, /<ol><li>One &amp; two<\/li><li>Check &gt; 3<\/li><\/ol>/);
  assert.match(html, /class="tip"/);
  assert.match(html, /class="warning"/);
  assert.match(html, /Never &lt;skip&gt;/);
  assert.match(html, /2\. Collapsed section/);
  assert.match(html, /First line\nSecond line/);
  assert.match(html, /href="https:\/\/example.test\/api\/media\/photo"/);
  assert.match(html, /Correct fit/);
});

test('every bundled guide exports every section without changing the source', () => {
  const original = JSON.stringify(GUIDES);
  for (const guide of GUIDES) {
    const html = guideToHtml(guide);
    assert.equal((html.match(/<section>/g) ?? []).length, guide.sections.length);
    assert.equal((html.match(/<li>/g) ?? []).length, guide.sections.reduce((count, section) => count + (section.steps?.length ?? 0), 0));
  }
  assert.equal(JSON.stringify(GUIDES), original);
});

test('PDF exports the selected Swahili guide content rather than the English source', () => {
  const source = GUIDES.find((guide) => guide.titleSw && guide.sectionsSw?.length);
  assert.ok(source, 'At least one translated guide must be available');
  const localized = localizeGuide(source, 'sw');
  const html = guideToHtml(localized);
  assert.notEqual(localized.title, source.title);
  assert.ok(html.includes(localized.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')));
  assert.equal((html.match(/<section>/g) ?? []).length, localized.sections.length);
});

for (const platform of ['ios', 'android']) {
  test(`${platform} creates a PDF then opens the native sheet with PDF metadata`, async () => {
    const { adapter, calls } = services(platform);
    await exportGuidePdf(guide, adapter);
    assert.deepEqual(calls.map((call) => call[0]), ['available', 'pdf', 'share']);
    assert.match((calls[1][1] as { html: string }).html, /Still included/);
    assert.deepEqual(calls[2], ['share', 'file:///cache/guide.pdf', {
      mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `Share / Save PDF — ${guide.title}`,
    }]);
  });
}

test('web prints full branded HTML without creating a native file or sharing', async () => {
  const { adapter, calls } = services('web');
  await exportGuidePdf(guide, adapter);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'browser');
  assert.match(calls[0][1] as string, /Still included/);
});

test('unavailable sharing fails explicitly before generating a file', async () => {
  const { adapter, calls } = services('ios');
  adapter.isSharingAvailable = async () => false;
  await assert.rejects(exportGuidePdf(guide, adapter), /not available/);
  assert.deepEqual(calls, []);
});

test('PDF and sharing failures propagate so the UI can offer retry', async () => {
  const { adapter } = services('android');
  adapter.printToFile = async () => { throw new Error('PDF failed'); };
  await assert.rejects(exportGuidePdf(guide, adapter), /PDF failed/);
  adapter.printToFile = async () => ({ uri: 'file:///cache/guide.pdf' });
  adapter.share = async () => { throw new Error('Share failed'); };
  await assert.rejects(exportGuidePdf(guide, adapter), /Share failed/);
});