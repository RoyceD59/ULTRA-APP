import http from 'node:http';

const port = Number(process.env.PORT || 6060);
http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && req.url === '/healthz') {
    res.end(JSON.stringify({ status: 'ok', service: 'team-ai-mock' }));
    return;
  }
  if (req.method === 'POST' && req.url === '/webhook/projecthub') {
    // No messages, agent runs or external calls are made from this process.
    req.resume();
    res.statusCode = 202;
    res.end(JSON.stringify({ ok: true, previewOnly: true }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
}).listen(port, '0.0.0.0', () => console.log(`Isolated Team AI mock on ${port}`));
