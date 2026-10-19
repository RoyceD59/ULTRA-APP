import { Platform } from 'react-native';
import type { Guide, GuideMedia, GuideSection } from '@/data/guides';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]!));
}

function mediaHtml(media: GuideMedia, resolveUrl: (url: string) => string): string {
  const label = `${media.kind === 'video' ? 'Video' : 'Image'}: ${media.altText}`;
  const url = resolveUrl(media.url);
  // Published content is plain text, never trusted HTML or executable URLs.
  const link = /^https?:\/\//i.test(url)
    ? `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`
    : escapeHtml(label);
  return `<p class="media">${link}${media.caption ? `<br>${escapeHtml(media.caption)}` : ''}</p>`;
}

function sectionHtml(section: GuideSection, index: number, resolveUrl: (url: string) => string): string {
  return `<section>
    <h2>${index + 1}. ${escapeHtml(section.heading)}</h2>
    ${section.body ? `<p>${escapeHtml(section.body)}</p>` : ''}
    ${section.steps?.length ? `<ol>${section.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>` : ''}
    ${section.tip ? `<aside class="tip"><strong>Tip</strong><p>${escapeHtml(section.tip)}</p></aside>` : ''}
    ${section.warning ? `<aside class="warning"><strong>Warning</strong><p>${escapeHtml(section.warning)}</p></aside>` : ''}
    ${(section.media ?? []).map((media) => mediaHtml(media, resolveUrl)).join('')}
  </section>`;
}

/** Full article, including collapsed sections, from the currently displayed guide. */
export function guideToHtml(guide: Guide, resolveUrl: (url: string) => string = (url) => url): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(guide.title)} — Ultra Clear</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #1a1a1a; background: #ffffff;
    font: 11pt/1.55 "Century Gothic", "Trebuchet MS", Arial, sans-serif; }
  header { border-bottom: 4px solid #52b6dc; padding-bottom: 14px; margin-bottom: 22px; }
  .brand { color: #005d8f; font-size: 22pt; font-weight: bold; letter-spacing: 2px; }
  .meta, .products, .media { font-size: 10pt; }
  h1 { font-size: 23pt; line-height: 1.2; color: #005d8f; margin: 12px 0; }
  h2 { color: #005d8f; font-size: 14pt; margin: 22px 0 10px;
    break-after: avoid; page-break-after: avoid; }
  p, li { white-space: pre-wrap; overflow-wrap: anywhere; }
  p { margin: 8px 0; orphans: 3; widows: 3; }
  ol { padding-left: 25px; }
  li { padding-left: 5px; margin: 8px 0; break-inside: avoid; page-break-inside: avoid; }
  li::marker { color: #005d8f; font-weight: bold; }
  aside { border: 1px solid #005d8f; border-left-width: 5px; padding: 10px 14px;
    margin: 12px 0; break-inside: avoid; page-break-inside: avoid; }
  aside strong { color: #005d8f; }
  .warning { border-color: #1a1a1a; border-left-width: 7px; }
  .warning strong { color: #1a1a1a; }
  a { color: #005d8f; overflow-wrap: anywhere; }
  footer { margin-top: 26px; padding-top: 12px; border-top: 2px solid #52b6dc; font-size: 9pt; }
  @media screen { body { max-width: 800px; padding: 24px; margin: auto; } }
</style></head><body>
<header><div class="brand">ULTRA CLEAR</div><div class="meta">Companion guide · ${escapeHtml(guide.category)} · ${escapeHtml(guide.readTime)}</div></header>
<main><h1>${escapeHtml(guide.title)}</h1><p class="products">${escapeHtml(guide.products)}</p>
<p>${escapeHtml(guide.summary)}</p>
${guide.sections.map((section, index) => sectionHtml(section, index, resolveUrl)).join('')}
</main><footer>Ultra Clear · Need help? Call 0717774049</footer>
</body></html>`;
}

/** Expo Print on web ignores its HTML argument, so print an isolated full article. */
export function printGuideInBrowser(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.title = 'Ultra Clear guide print preview';
    frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;top:0;border:0;';
    let cleanupTimer: ReturnType<typeof setTimeout>;
    const cleanup = () => { clearTimeout(cleanupTimer); frame.remove(); };
    frame.onload = () => {
      try {
        const target = frame.contentWindow;
        if (!target) throw new Error('Unable to open the guide print preview.');
        target.addEventListener('afterprint', cleanup, { once: true });
        // Retain the document while the dialog is open; also clean up browsers
        // that do not emit afterprint when the user dismisses the dialog.
        cleanupTimer = setTimeout(cleanup, 300_000);
        target.focus();
        target.print();
        resolve();
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    frame.onerror = () => { cleanup(); reject(new Error('Unable to load the guide print preview.')); };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

export interface GuidePdfServices {
  platform: string;
  printBrowser: (html: string) => Promise<void>;
  isSharingAvailable: () => Promise<boolean>;
  printToFile: (options: { html: string }) => Promise<{ uri: string }>;
  share: (uri: string, options: { mimeType: string; UTI: string; dialogTitle: string }) => Promise<void>;
}

export async function exportGuidePdf(guide: Guide, services: GuidePdfServices, resolveUrl?: (url: string) => string): Promise<void> {
  const html = guideToHtml(guide, resolveUrl);
  if (services.platform === 'web') {
    await services.printBrowser(html);
    return;
  }
  if (!await services.isSharingAvailable()) {
    throw new Error('PDF sharing is not available on this device.');
  }
  const { uri } = await services.printToFile({ html });
  await services.share(uri, {
    mimeType: 'application/pdf', UTI: 'com.adobe.pdf',
    dialogTitle: `Share / Save PDF — ${guide.title}`,
  });
}

export async function shareGuidePdf(guide: Guide, resolveUrl?: (url: string) => string): Promise<void> {
  if (Platform.OS === 'web') {
    // Keep this synchronous up to frame creation within the user's tap.
    return printGuideInBrowser(guideToHtml(guide, resolveUrl));
  }
  const [Print, Sharing] = await Promise.all([import('expo-print'), import('expo-sharing')]);
  return exportGuidePdf(guide, {
    platform: Platform.OS,
    printBrowser: printGuideInBrowser,
    isSharingAvailable: Sharing.isAvailableAsync,
    printToFile: Print.printToFileAsync,
    share: Sharing.shareAsync,
  }, resolveUrl);
}