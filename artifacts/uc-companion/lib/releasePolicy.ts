export type Delivery = 'web' | 'expo-go' | 'standalone';
export interface LoadedRelease {
  delivery: Delivery;
  buildId: string;
  platform: string;
  runtime: string;
  version: string;
}
export interface ReleaseMetadata {
  buildId: string;
  apiOrigin: string;
  expoGoLaunchUrl?: string;
  supported: {
    web: string;
    expoGo: string;
    native: Array<{ platform: 'ios' | 'android'; runtime: string; version: string; release: string; updateUrl: string }>;
  };
}
export function verifiedUpdateUrl(platform: string, value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) return false;
    return platform === 'android'
      ? url.hostname === 'play.google.com' && url.pathname === '/store/apps/details'
        && url.searchParams.get('id') === 'com.ultraclean.companion' && [...url.searchParams.keys()].length === 1
      : platform === 'ios' && url.hostname === 'apps.apple.com' && /\/id\d+$/.test(url.pathname) && !url.search;
  } catch { return false; }
}
export function compareRelease(loaded: LoadedRelease, metadata: ReleaseMetadata | undefined, apiOrigin: string, launchOrigin?: string) {
  if (!metadata || typeof metadata.buildId !== 'string' || !metadata.buildId
      || metadata.apiOrigin !== apiOrigin || !metadata.supported
      || metadata.supported.web !== metadata.buildId || metadata.supported.expoGo !== metadata.buildId) {
    return { status: 'unknown' as const };
  }
  if (loaded.delivery !== 'standalone') {
    if (!loaded.buildId || loaded.buildId === 'development') return { status: 'unknown' as const };
    if (loaded.buildId === metadata.buildId) return { status: 'supported' as const };
    let reopenUrl: string | undefined;
    if (loaded.delivery === 'expo-go' && metadata.expoGoLaunchUrl && launchOrigin) {
      try {
        const target = new URL(metadata.expoGoLaunchUrl);
        if (target.protocol === 'exps:' && !target.search && !target.hash && !target.username && !target.password
            && `https://${target.host}` === launchOrigin.replace(/\/$/, '')) reopenUrl = target.href;
      } catch { /* Unsafe launch links remain unavailable. */ }
    }
    return { status: 'different' as const, reopenUrl };
  }
  if (!Array.isArray(metadata.supported.native)) return { status: 'unknown' as const };
  const target = metadata.supported.native.find(entry => entry && typeof entry === 'object' && entry.platform === loaded.platform
    && entry.runtime === loaded.runtime);
  if (!target || typeof target.release !== 'string' || !target.release || typeof target.version !== 'string'
      || !verifiedUpdateUrl(loaded.platform, target.updateUrl)) return { status: 'unknown' as const };
  return target.release === loaded.buildId && target.version === loaded.version
    ? { status: 'supported' as const }
    : { status: 'different' as const, updateUrl: target.updateUrl };
}
