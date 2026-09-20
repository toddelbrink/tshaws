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
 * guests.js is a browser script in an IIFE with no exports, so the literal is
 * lifted from the source. A test that kept its own copy would pass while the
 * site was broken. */
function readPages() {
  const src = fs.readFileSync(path.join(ROOT, 'assets/js/guests.js'), 'utf8');
  const m = src.match(/var PAGES = \{([\s\S]*?)\};/);
  if (!m) throw new Error('PAGES map not found in assets/js/guests.js');
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
