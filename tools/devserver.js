/* Local preview server.
 *
 *   node tools/devserver.js      then open http://localhost:8787
 *
 * Serves the repo statically and proxies /api to production, so the real feed
 * and the real playlist exercise the shipped JS without a YouTube key on this
 * machine. `vercel dev` also works and runs the functions locally; this is the
 * zero-setup option.
 *
 * It sends no-store on purpose. Without that the browser heuristically caches
 * JS and CSS, and a verification run silently exercises the previous edit. That
 * cost real time on 2026-09-11: a fix was reported as failing when the browser
 * was simply still running the file from before it.
 *
 * Not deployed. tools/ is in .vercelignore.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 8787;
const UPSTREAM = 'https://www.tshawsprogressivebluegrass.com';

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.ico': 'image/x-icon', '.xml': 'application/xml'
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname.startsWith('/api/')) {
    try {
      const r = await fetch(UPSTREAM + req.url);
      const body = Buffer.from(await r.arrayBuffer());
      res.writeHead(r.status, {
        'content-type': r.headers.get('content-type') || 'application/json'
      });
      return res.end(body);
    } catch (e) {
      res.writeHead(502);
      return res.end('upstream: ' + e.message);
    }
  }

  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  // Anything outside the repo is not ours to serve.
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, 'index.html');
  }
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }

  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store, no-cache, must-revalidate'
  });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log('preview on http://localhost:' + PORT));
