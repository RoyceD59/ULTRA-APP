const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function preferredEncoding(header = '') {
  const weights = new Map(header.split(',').map(part => {
    const [name, ...parameters] = part.trim().toLowerCase().split(';');
    const q = parameters.find(parameter => parameter.trim().startsWith('q='));
    return [name, q ? Number(q.trim().slice(2)) : 1];
  }));
  const weight = name => weights.get(name) ?? weights.get('*') ?? 0;
  return ['br', 'gzip'].filter(name => weight(name) > 0)
    .sort((a, b) => weight(b) - weight(a))[0];
}

function staticCachePolicy(urlPath) {
  // Restrict immutable caching to known build assets, never arbitrary JSON,
  // documents, native manifests, APIs, or build/version metadata.
  return /^\/\d+-\d+\/(?:web\/(?:_expo\/static\/|assets\/)|_expo\/static\/)/.test(urlPath)
    && /\.(js|css|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|otf|mp4|mp3)$/.test(urlPath)
    ? 'public, max-age=31536000, immutable' : 'no-store';
}

function deliverStatic(req, res, filePath, contentType, urlPath) {
  const compressible = /\.(js|css|html|json|svg|ttf|otf)$/.test(filePath);
  const encoding = compressible ? preferredEncoding(req.headers['accept-encoding']) : undefined;
  const encodedFile = encoding && `${filePath}.${encoding === 'br' ? 'br' : 'gz'}`;
  const precompressed = encodedFile && fs.existsSync(encodedFile);
  const headers = {
    'content-type': contentType,
    'cache-control': staticCachePolicy(urlPath),
    'x-content-type-options': 'nosniff',
    ...(compressible ? { vary: 'Accept-Encoding' } : {}),
    ...(encoding ? { 'content-encoding': encoding } : {}),
  };
  if (precompressed || !encoding) {
    headers['content-length'] = fs.statSync(precompressed ? encodedFile : filePath).size;
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = fs.createReadStream(precompressed ? encodedFile : filePath);
  stream.on('error', error => res.destroy(error));
  if (encoding && !precompressed) {
    const compressor = encoding === 'br' ? zlib.createBrotliCompress() : zlib.createGzip();
    compressor.on('error', error => res.destroy(error));
    stream.pipe(compressor).pipe(res);
  } else stream.pipe(res);
}

module.exports = { preferredEncoding, staticCachePolicy, deliverStatic };