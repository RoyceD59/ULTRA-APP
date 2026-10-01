import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import webRoutes from '../../artifacts/uc-companion/server/web-routes.cjs';

const root = resolve(process.argv[2] || 'dist');
const port = Number(process.env.PORT || 3000);
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
http.createServer(async (req, res) => {
  if (req.url === '/healthz') { res.end('ok'); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname); }
  catch { res.writeHead(400).end(); return; }
  const candidate = resolve(root, `.${pathname}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) { res.writeHead(403).end(); return; }
  let file = candidate;
  try {
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    await stat(file);
  } catch {
    if (!req.headers.accept?.includes('text/html') && !webRoutes.isWebAppRoute(pathname)) {
      res.writeHead(404, { 'Cache-Control': 'no-store' }).end(); return;
    }
    file = resolve(root, 'index.html');
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': extname(file) === '.html' ? 'no-store' : 'public, max-age=300' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404).end(); }
}).listen(port, '0.0.0.0', () => console.log(`Preview static server on ${port}`));
