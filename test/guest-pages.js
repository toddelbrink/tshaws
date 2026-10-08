/* Guest page tests.
 *
 *   node test/guest-pages.js          structural checks, offline
 *   node test/guest-pages.js --live   the same, plus the episode numbers on
 *                                     each page checked against the live feed
 *
 * What this exists to catch. A guest page carries two hand-typed things that
 * nothing else on the site can verify: the slug in the PAGES map in
 * assets/js/guests.js, and the season and episode numbers in each page's
 * data-season and data-episode. A wrong slug means a guest's name on /guests/
 * links to a 404. A wrong episode number means the page silently ships with no
 * player, because guest.js correctly refuses to invent a match.
 *
 * Everything else on those pages is either written copy, which is not this
 * file's business, or resolved from the feed at runtime, which cannot rot.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LIVE = process.argv.includes('--live');
const BASE = 'https://www.tshawsprogressivebluegrass.com';

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('  ok   ' + name); return true; }
  failures++;
  console.log('  FAIL ' + name);
  return false;
}

/* The PAGES map, read out of the shipped file rather than duplicated here.
 * guestline.js is a browser script with no module exports, so the literal is
 * lifted from the source. A test that kept its own copy would pass while the
 * site was broken. */
const PAGES_FILE = 'assets/js/guestline.js';
function readPages() {
  const src = fs.readFileSync(path.join(ROOT, PAGES_FILE), 'utf8');
  const m = src.match(/var PAGES = \{([\s\S]*?)\};/);
  if (!m) throw new Error('PAGES map not found in ' + PAGES_FILE);
  const out = {};
  m[1].split(',').forEach((line) => {
    const p = line.trim().match(/^([a-z]+)\s*:\s*'([a-z0-9-]+)'$/);
    if (p) out[p[1]] = p[2];
  });
  return out;
}

// Directories under /guests/ that are pages, which is every one of them: the
// index lives at guests/index.html, not in a subdirectory.
function pageDirs() {
  return fs.readdirSync(path.join(ROOT, 'guests'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

const pages = readPages();
const dirs = pageDirs();
const slugs = Object.values(pages).sort();

console.log('\nThe map and the filesystem agree');
check('every slug in PAGES has a page on disk',
  slugs.every((s) => dirs.includes(s)));
check('every page on disk is listed in PAGES',
  dirs.every((d) => slugs.includes(d)));
check('no slug is listed twice',
  new Set(slugs).size === slugs.length);

console.log('\nEach page');
const eps = {};   // slug -> [[season, episode], ...]
dirs.forEach((slug) => {
  const file = path.join(ROOT, 'guests', slug, 'index.html');
  const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  check(slug + ': has an index.html', !!html);
  if (!html) return;

  check(slug + ': canonical og:url matches its path',
    html.includes('property="og:url" content="' + BASE + '/guests/' + slug + '/"'));
  check(slug + ': loads guest.js',
    html.includes('/assets/js/guest.js'));
  check(slug + ': is in the sitemap',
    fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8')
      .includes(BASE + '/guests/' + slug + '/'));
  // The photo slot ships hidden and empty. A page that shipped with a visible
  // empty figure would render a grey box where a face belongs.
  const fig = html.match(/<figure class="gportrait"([^>]*)>[\s\S]*?<img([^>]*)>/);
  if (check(slug + ': has a lead photo slot', !!fig)) {
    const filled = /src="[^"]+"/.test(fig[2]);
    check(slug + ': photo slot is either filled or hidden',
      filled ? !fig[1].includes('hidden') : fig[1].includes('hidden'));
  }

  /* The pages cross-reference each other, e.g. Randy Steele's page links to
   * John Boulware's. Those hrefs are written into the copy, so a slug that
   * does not exist is a 404 nobody would notice by reading the page it is on. */
  const internal = [...html.matchAll(/href="\/guests\/([a-z0-9-]+)\/"/g)]
    .map((m) => m[1]);
  const dead = internal.filter((s) => !dirs.includes(s));
  check(slug + ': every /guests/ link it makes has a page' +
    (internal.length ? ' (' + internal.length + ')' : ''), dead.length === 0);

  const rows = [...html.matchAll(/data-season="(\d+)" data-episode="(\d+)"/g)]
    .map((m) => [Number(m[1]), Number(m[2])]);
  check(slug + ': names at least one episode', rows.length > 0);
  eps[slug] = rows;
});

/* More photos from the guest: a row below the prose, off unless listed here.
 * Only photos the guest sent, named <slug>-guest-N so they can never be
 * mistaken for footage stills (<slug>-N), two at most. Each needs its 1x, 2x
 * and full-size file, opens the full-size file without the soft navigation,
 * and every file is served with no metadata: no EXIF, XMP, ICC or comment. */
console.log('\nMore photos from the guest');
const EXTRAS = { 'jesse-cobb': 1 }; // trial, 2026-10-08
function bareJpeg(file) {
  const d = fs.readFileSync(file);
  let i = 2;
  while (i + 4 < d.length && d[i] === 0xFF && d[i + 1] !== 0xDA) {
    const t = d[i + 1];
    if ((t >= 0xE1 && t <= 0xEF) || t === 0xFE) return false; // APP1-15, COM
    i += 2 + d.readUInt16BE(i + 2);
  }
  return d[0] === 0xFF && d[1] === 0xD8;
}
dirs.forEach((slug) => {
  const html = fs.readFileSync(path.join(ROOT, 'guests', slug, 'index.html'), 'utf8');
  const row = html.match(/<section class="section gmore"[\s\S]*?<\/section>/);
  const want = EXTRAS[slug] || 0;
  if (!want) { if (row) check(slug + ': carries more photos only when listed', false); return; }
  if (!check(slug + ': has its more-photos row', !!row)) return;
  const items = [...row[0].matchAll(/<a href="([^"]+)" data-hard-nav>\s*<img src="([^"]+)"\s+srcset="[^"]*?([^\s"]+@2x\.jpg) 2x"[^>]*alt="([^"]+)"/g)];
  check(slug + ': ' + want + ' photo' + (want > 1 ? 's' : '') + ', two at most', items.length === want && want <= 2);
  items.forEach((m, n) => {
    const base = '/assets/photos/guests/' + slug + '-guest-';
    const files = [m[1], m[2], m[3]];
    check(slug + ' photo ' + (n + 1) + ': guest-photo names', files.every((f) => f.startsWith(base)));
    check(slug + ' photo ' + (n + 1) + ': files exist with no metadata',
      files.every((f) => fs.existsSync(path.join(ROOT, f)) && bareJpeg(path.join(ROOT, f))));
  });
});

/* The same question for every page on the site, not only the guest pages.
 * Twenty pages now link each other in their copy, and a renamed directory
 * would 404 every link pointing at it. This runs on every Vercel build (see
 * buildCommand in vercel.json), so a dead guest link stops the deploy instead
 * of shipping. */
console.log('\nEvery /guests/ link on the site has a page');
function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name.startsWith('.') || d.name === 'node_modules') return [];
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return htmlFiles(p);
    return d.name.endsWith('.html') ? [p] : [];
  });
}
const linkFiles = htmlFiles(ROOT);
let linkCount = 0;
linkFiles.forEach((file) => {
  const html = fs.readFileSync(file, 'utf8');
  [...html.matchAll(/href="(?:https:\/\/www\.tshawsprogressivebluegrass\.com)?\/guests\/([^"#?]+)"/g)]
    .forEach((m) => {
      linkCount++;
      const slug = m[1].replace(/\/$/, '');
      check(path.relative(ROOT, file) + ' -> /guests/' + m[1],
        dirs.includes(slug) && m[1] === slug + '/');
    });
});
check('found guest links to check (' + linkCount + ' across ' + linkFiles.length + ' files)',
  linkCount > 0);

async function live() {
  console.log('\nAgainst the live feed');
  const r = await fetch(BASE + '/api/episodes');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const feed = await r.json();
  const have = new Set(feed.episodes.map((e) => e.season + '-' + e.episode));

  Object.entries(eps).forEach(([slug, rows]) => {
    rows.forEach(([s, n]) => {
      check(slug + ': S' + s + 'E' + n + ' exists in the feed',
        have.has(String(s) + '-' + String(n)));
    });
  });
}

(async () => {
  if (LIVE) {
    try { await live(); }
    catch (e) { failures++; console.log('\n  FAIL live: ' + e.message); }
  }
  console.log('');
  if (failures) { console.log(failures + ' failing'); process.exit(1); }
  console.log('all passing');
})();
