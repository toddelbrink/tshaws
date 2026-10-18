/* robots.txt tests, offline.
 *
 *   node test/robots.js
 *
 * Google could not draw /episodes/ because robots.txt blocked the feed it
 * reads (Search Console, 2026-10-18: soft 404). The two public feeds are open
 * now. This applies Google's rule (the longest matching path wins, Allow wins
 * a tie) so a later edit can never close the feeds again or open anything
 * private. It also checks the noindex header that keeps raw JSON out of search.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (detail ? '  -> ' + detail : ''));
}

const rules = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8')
  .split('\n').map((l) => l.replace(/#.*/, '').trim())
  .map((l) => l.match(/^(allow|disallow):\s*(\S*)$/i)).filter(Boolean)
  .map((m) => ({ allow: m[1].toLowerCase() === 'allow', path: m[2] }))
  .filter((r) => r.path);

function allowed(url) {
  let best = null;
  for (const r of rules) {
    if (!url.startsWith(r.path)) continue;
    if (!best || r.path.length > best.path.length ||
        (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

console.log('robots.txt');
for (const u of ['/', '/episodes/', '/videos/all/', '/guests/', '/ramble/',
                 '/api/episodes', '/api/episodes?mode=meta',
                 '/api/videos', '/api/videos?mode=shows', '/api/videos?mode=index',
                 '/api/videos?mode=featured', '/api/videos?mode=show&id=PL1']) {
  check('open    ' + u, allowed(u));
}
for (const u of ['/admin/', '/api/admin', '/api/plan-email', '/api/warm', '/api/']) {
  check('blocked ' + u, !allowed(u));
}

console.log('vercel.json');
const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const h = (v.headers || []).find((x) => x.source === '/api/(.*)');
check('every /api/ response is noindex',
  !!h && h.headers.some((x) => x.key.toLowerCase() === 'x-robots-tag' && x.value === 'noindex'));

if (failures) { console.log('\n' + failures + ' failed'); process.exit(1); }
console.log('\nall robots checks pass');
