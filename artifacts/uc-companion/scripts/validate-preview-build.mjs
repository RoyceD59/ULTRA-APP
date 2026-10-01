/** Refuse an internal preview APK that would talk to production services. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export function validatePreviewBuild(env) {
  if (env.UC_PREVIEW_BUILD !== '1') return;
  if (!env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_')) {
    throw new Error('Preview build requires a Clerk test publishable key');
  }
  if (env.EXPO_PUBLIC_CLERK_PROXY_URL && /(?:^|[/.])(?:ucfilters\.com|ucfilters\.co\.ke|replit\.app)(?:[/:]|$)/i.test(env.EXPO_PUBLIC_CLERK_PROXY_URL)) {
    throw new Error('Preview build refuses a live Clerk proxy');
  }
  for (const name of ['EXPO_PUBLIC_API_DOMAIN', 'EXPO_PUBLIC_DOMAIN']) {
    const raw = env[name]?.trim();
    if (!raw) throw new Error(`${name} is required for an isolated preview build`);
    const value = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let url;
    try { url = new URL(value); }
    catch { throw new Error(`${name} must be a valid HTTPS preview origin`); }
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      throw new Error(`${name} must be a valid HTTPS preview origin`);
    }
    if (['api.ucfilters.com', 'app.ucfilters.com', 'hub.ucfilters.com'].includes(url.hostname)
        || url.hostname.endsWith('.replit.app')) {
      throw new Error(`${name} must not point at a live Ultra Clear or Replit service`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { validatePreviewBuild(process.env); }
  catch (error) { console.error(error.message); process.exit(1); }
}
