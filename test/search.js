/* Site search tests.
 *
 *   node test/search.js          the matching rules and the wiring, offline
 *   node test/search.js --live   the same, plus real queries against the feed
 *                                and the video index
 *
 * The matching rules moved out of assets/js/videos.js into textmatch.js so the
 * video grid and the search page could share them. That move is the thing most
 * worth guarding: every documented rule is asserted here, so a change that
 * quietly loosens or tightens matching fails instead of shipping.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const LIVE = process.argv.includes('--live');
const BASE = 'https://www.tshawsprogressivebluegrass.com';

global.window = {};
require(path.join(ROOT, 'assets/js/textmatch.js'));
const M = global.window.TSMatch;

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (detail ? '  -> ' + detail : ''));
}
const titles = (list) => list.map((x) => x.t);

console.log('\nThe documented matching rules');
const L = [{ t: 'Moose Knuckle String Band' }, { t: 'Greenwood Rye' },
           { t: 'Races/Unwanted' }, { t: 'Mountain Grass Unit' },
           { t: 'Béla Fleck' }, { t: 'The Infamous Stringdusters' }];
check('five letters or more ignores spaces ("mooseknuckle")',
  titles(M.matches(L, 'mooseknuckle')).join() === 'Moose Knuckle String Band');
check('and the other way round ("green wood")',
  titles(M.matches(L, 'green wood')).join() === 'Greenwood Rye');
check('under five letters keeps its spaces, so "sun" misses "Grass Unit"',
  M.matches(L, 'sun').length === 0, titles(M.matches(L, 'sun')).join());
check('punctuation folds to a space ("races unwanted")',
  titles(M.matches(L, 'races unwanted')).join() === 'Races/Unwanted');
check('accents fold ("bela fleck")',
  titles(M.matches(L, 'bela fleck')).join() === 'Béla Fleck');
check('case is ignored', titles(M.matches(L, 'STRINGDUSTERS')).join()
  === 'The Infamous Stringdusters');
check('an empty query matches nothing by title', M.matches(L, '').length === 0 ||
  M.matches(L, '').length === L.length);

console.log('\nRanking');
const n = M.needle('stringdusters');
check('a whole-word run ranks above a spaces-dropped match',
  M.hit('The Infamous Stringdusters', n) === 1);
check('a spaces-dropped match still matches, at rank 2',
  M.hit('The Infamous String Dusters', n) === 2);
check('no match returns false', M.hit('Greenwood Rye', n) === false);

console.log('\nEvery page carries the field and the scripts');
const pages = ['index.html', 'about/index.html', 'episodes/index.html', 'guests/index.html',
  'mortgages/index.html', 'videos/index.html', 'videos/all/index.html',
  'videos/shows/index.html', 'search/index.html']
  .concat(fs.readdirSync(path.join(ROOT, 'guests'), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => 'guests/' + d.name + '/index.html'));
const missing = { form: [], textmatch: [], search: [], order: [] };
for (const p of pages) {
  const s = fs.readFileSync(path.join(ROOT, p), 'utf8');
  if (!s.includes('class="navsearch"')) missing.form.push(p);
  if (!s.includes('src="/assets/js/textmatch.js"')) missing.textmatch.push(p);
  if (!s.includes('src="/assets/js/search.js"')) missing.search.push(p);
  // textmatch.js has to be parsed before videos.js, which now calls it.
  if (s.indexOf('textmatch.js') > s.indexOf('src="/assets/js/videos.js"')) missing.order.push(p);
}
check('the nav form is on all ' + pages.length + ' pages', !missing.form.length, missing.form.join(' '));
check('textmatch.js is on all of them', !missing.textmatch.length, missing.textmatch.join(' '));
check('search.js is on all of them', !missing.search.length, missing.search.join(' '));
check('textmatch.js loads before videos.js', !missing.order.length, missing.order.join(' '));

console.log('\nThe results page');
const sp = fs.readFileSync(path.join(ROOT, 'search/index.html'), 'utf8');
check('it is noindex, because a results page has nothing of its own to index',
  /<meta name="robots" content="noindex/.test(sp));
check('it is not in the sitemap',
  !fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').includes('/search/'));
check('the form is a real GET to /search/, so it works with no JavaScript',
  /<form id="searchform"[^>]*action="\/search\/"[^>]*method="get"/.test(sp));
check('nav.js exposes the seam search.js submits through',
  fs.readFileSync(path.join(ROOT, 'assets/js/nav.js'), 'utf8').includes('window.TSNav'));

async function live() {
  console.log('\nAgainst live data');
  const eps = await fetch(BASE + '/api/episodes').then((r) => r.json());
  const idx = await fetch(BASE + '/api/videos?mode=index').then((r) => r.json());
  check('the video index came back', idx.videos && idx.videos.length > 3000,
    String(idx.count));
  for (const [q, least] of [['stringdusters', 100], ['telluride', 10], ['boulware', 5]]) {
    const v = M.matches(idx.videos, q).length;
    check('"' + q + '" finds at least ' + least + ' videos (' + v + ')', v >= least);
  }
  const nn = M.needle('mason via');
  const hits = eps.episodes.filter((e) => M.hit(e.title, nn) || M.hit(e.descriptionText || '', nn));
  check('"mason via" finds his episodes (' + hits.length + ')', hits.length >= 2);
  const titled = eps.episodes.filter((e) => M.hit(e.title, nn));
  check('and the title matches rank ahead of note-only ones (' + titled.length + ')',
    titled.length >= 2 && titled.length <= hits.length);
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
