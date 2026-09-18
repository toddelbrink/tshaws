/* Watch-button resolution tests.
 *
 *   node test/watch-buttons.js          synthetic cases, offline
 *   node test/watch-buttons.js --live   the same, plus a report from live data
 *   node test/watch-buttons.js --live --report   print only the report
 *
 * assets/js/epvideo.js is a browser script with no exports, so this loads it
 * against a stub window and calls the builder it hangs on TSEpVideo. That is
 * deliberate: the test exercises the file that actually ships.
 *
 * The rule under test: if the
 * episode is simulcast on YouTube, it gets a Watch button and that button
 * works. If it is not, it gets Listen only. Nothing renders on a guess.
 */
'use strict';
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LIVE = process.argv.includes('--live');
const ONLY_REPORT = process.argv.includes('--report');
const BASE = 'https://www.tshawsprogressivebluegrass.com';

global.window = {};
require(path.join(ROOT, 'assets/js/epvideo.js'));
const { _build: build, _playable: playable } = global.window.TSEpVideo;

let failures = 0;
function check(name, cond) {
  if (cond) { if (!ONLY_REPORT) console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name);
}

// A playable video. Every field the gate reads is present and good, so a test
// can spread this and break exactly one thing.
const good = (over) => Object.assign({
  id: 'vid1', title: 'A Title', duration: 1000,
  published: '2026-01-01T12:00:00Z',
  embeddable: true, privacyStatus: 'public', regionRestricted: false
}, over);

const ep = (over) => Object.assign({
  guid: 'g1', title: 'A Title', duration: 1000, published: '2026-01-01T09:00:00Z'
}, over);

/* ---------------- the playability gate ---------------- */

if (!ONLY_REPORT) console.log('\nPlayability gate');
check('a public embeddable video is playable', playable(good()) === true);
check('non-embeddable is not', playable(good({ embeddable: false })) === false);
check('unlisted is not', playable(good({ privacyStatus: 'unlisted' })) === false);
check('private is not', playable(good({ privacyStatus: 'private' })) === false);
check('region restricted is not', playable(good({ regionRestricted: true })) === false);
check('unknown status fails closed', playable(good({ embeddable: null })) === false);
check('no id is not', playable(good({ id: '' })) === false);

/* ---------------- the three passes ---------------- */

if (!ONLY_REPORT) console.log('\nPass 1, identical title');
check('exact title matches', build([ep()], [good()]).g1.id === 'vid1');
check('punctuation and case are ignored',
  build([ep({ title: "What I've Been Up To" })],
        [good({ title: '"What Ive been up to"' })]).g1.id === 'vid1');
check('a different title does not match on title alone',
  build([ep({ duration: 5, published: '2020-01-01T00:00:00Z' })],
        [good({ title: 'Something Else', duration: 999, published: '2026-06-06T00:00:00Z' })]).g1 === undefined);
check('one video is never handed to two episodes', (() => {
  const m = build([ep({ guid: 'a' }), ep({ guid: 'b' })], [good()]);
  return !!m.a !== !!m.b;
})());

if (!ONLY_REPORT) console.log('\nPass 2, YouTube truncates a long title');
const LONG = 'Thomas Cassell Mandolin Woodbox Heroes and I talk about the IBMA Conference From a Professional Musicians Perspective';
check('a long prefix matches',
  build([ep({ title: LONG })],
        [good({ title: LONG.slice(0, 100), duration: 7, published: '1999-01-01T00:00:00Z' })]).g1.id === 'vid1');
check('a short prefix does not',
  build([ep({ title: LONG })],
        [good({ title: 'Thomas', duration: 7, published: '1999-01-01T00:00:00Z' })]).g1 === undefined);
check('an ambiguous prefix does not', (() => {
  const m = build([ep({ guid: 'a', title: LONG + ' Part 1' }), ep({ guid: 'b', title: LONG + ' Part 2' })],
                  [good({ title: LONG, duration: 7, published: '1999-01-01T00:00:00Z' })]);
  return m.a === undefined && m.b === undefined;
})());

if (!ONLY_REPORT) console.log('\nPass 3, retitled but same recording');
check('same duration and same week matches',
  build([ep({ title: 'Feed Name' })],
        [good({ title: 'Totally Different' })]).g1.id === 'vid1');
check('same duration a year apart does not',
  build([ep({ title: 'Feed Name', published: '2024-01-01T00:00:00Z' })],
        [good({ title: 'Totally Different' })]).g1 === undefined);
check('a duration three seconds off does not',
  build([ep({ title: 'Feed Name' })],
        [good({ title: 'Totally Different', duration: 1003 })]).g1 === undefined);
check('two episodes of the same length in the same week stay unmatched', (() => {
  const m = build([ep({ guid: 'a', title: 'One' }), ep({ guid: 'b', title: 'Two' })],
                  [good({ title: 'Neither' })]);
  return m.a === undefined && m.b === undefined;
})());

if (!ONLY_REPORT) console.log('\nOrdering');
check('a title match outranks a duration match', (() => {
  const m = build([ep({ guid: 'a', title: 'Exact' })],
                  [good({ id: 'dur', title: 'Other' }), good({ id: 'ttl', title: 'Exact', duration: 7 })]);
  return m.a.id === 'ttl';
})());
check('an unmatched episode yields no entry at all',
  build([ep({ title: 'Nothing', duration: 42, published: '2001-01-01T00:00:00Z' })], []).g1 === undefined);

/* ---------------- live report ---------------- */

async function live() {
  const get = async (u) => {
    const r = await fetch(BASE + u);
    if (!r.ok) throw new Error(u + ' -> HTTP ' + r.status);
    return r.json();
  };

  const feed = await get('/api/episodes');
  const shows = await get('/api/videos?mode=shows');
  const pl = await get('/api/videos?mode=show&id=' + encodeURIComponent(shows.podcastPlaylistId));

  const playableVids = (pl.videos || []).filter(playable);
  const dropped = (pl.videos || []).length - playableVids.length;
  const map = build(feed.episodes, playableVids);

  const rows = feed.episodes.slice().sort((a, b) =>
    (a.season - b.season) || ((a.episode || 0) - (b.episode || 0)));

  console.log('\nWATCH BUTTON REPORT  ' + new Date().toISOString().slice(0, 10));
  console.log(feed.episodes.length + ' episodes, ' + playableVids.length +
    ' playable videos in the podcast playlist' +
    (dropped ? ', ' + dropped + ' dropped as unplayable' : '') + '\n');

  for (const e of rows) {
    const v = map[e.guid];
    console.log([
      ('S' + e.season + 'E' + String(e.episode || '?')).padEnd(6),
      (v ? 'WATCH' : 'listen').padEnd(6),
      (v ? v.id : '').padEnd(11),
      e.title
    ].join('  '));
  }

  const bySeason = {};
  for (const e of rows) {
    const s = (bySeason[e.season] = bySeason[e.season] || { watch: 0, listen: 0 });
    map[e.guid] ? s.watch++ : s.listen++;
  }
  console.log('');
  for (const s of Object.keys(bySeason).sort()) {
    console.log('Season ' + s + ': ' + bySeason[s].watch + ' watch, ' +
      bySeason[s].listen + ' listen only');
  }
  const total = Object.keys(map).length;
  console.log('Total: ' + total + ' of ' + feed.episodes.length + ' carry Watch');

  if (!ONLY_REPORT) {
    console.log('\nLive invariants');
    check('every resolved video is playable',
      Object.values(map).every(playable));
    check('no video is claimed by two episodes',
      new Set(Object.values(map).map((v) => v.id)).size === total);
    check('every Watch button has a video id',
      Object.values(map).every((v) => typeof v.id === 'string' && v.id.length > 5));
  }
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
