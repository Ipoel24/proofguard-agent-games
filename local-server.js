// Local dev server that mimics Vercel's routing for /api/*.js + public/.
// Usage: npm run dev  (then http://localhost:3000)
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const handlers = {
  '/api/guard': require('./api/guard.js'),
  '/api/verify': require('./api/verify.js'),
  '/api/health': require('./api/health.js'),
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const handler = handlers[url.pathname];
  if (handler) return handler(req, res);
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(root, 'public', file);
  if (!filePath.startsWith(path.join(root, 'public'))) {
    res.statusCode = 403; return res.end('forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('not found'); }
    const type = file.endsWith('.html') ? 'text/html' : 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.end(data);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`ProofGuard dev server at http://localhost:${port}`));
