/* Ramble schedule data tests, offline.
 *
 *   node test/ramble.js
 *
 * assets/data/ramble-2026.json is the only source for /ramble/. It is typed
 * by hand from IBMA's schedule page, so a typo would otherwise ship as a set
 * at the wrong time or on a stage that does not exist. Any failure here stops
 * the deploy.
 *
 * The set count is pinned. If IBMA adds or drops a set, change SET_COUNT.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'assets/data/ramble-2026.json');
const SET_COUNT = 61;

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (detail ? '  -> ' + detail : ''));
}

// Every time is PM and written as on IBMA's page, "5:40" or "10:30".
const TIME = /^(1[0-2]|[1-9]):[0-5]\d$/;
function minutes(t) {
  const [h, m] = t.split(':').map(Number);
  return (h % 12 + 12) * 60 + m;
}
const label = (s) => `${s.day} ${s.stage} ${s.start} ${s.act}`;

// Returns a list of problems, empty when the data is good. Kept separate from
// the checks so the self-test below can feed it broken copies.
function problems(d) {
  const out = [];
  if (!d || !Array.isArray(d.stages) || !Array.isArray(d.days) || !Array.isArray(d.sets)) {
    return ['stages, days and sets must all be lists'];
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.last_checked || '')) out.push('last_checked is not a YYYY-MM-DD date');
  const stages = new Set(), days = new Set(), ids = new Set();
  for (const s of d.stages) {
    if (stages.has(s.id)) out.push('duplicate stage ' + s.id);
    stages.add(s.id);
    if (!s.short || !s.name || !s.building) out.push('stage ' + s.id + ' is missing short, name or building');
  }
  for (const x of d.days) {
    if (days.has(x.id)) out.push('duplicate day ' + x.id);
    days.add(x.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date || '') || !x.label) out.push('day ' + x.id + ' is missing a date or label');
  }
  for (const s of d.sets) {
    if (!days.has(s.day)) out.push('unknown day: ' + label(s));
    if (!stages.has(s.stage)) out.push('unknown stage: ' + label(s));
    if (!s.act || typeof s.act !== 'string') out.push('no act name: ' + label(s));
    if (!TIME.test(s.start) || !TIME.test(s.end)) { out.push('bad time: ' + label(s)); continue; }
    if (minutes(s.end) <= minutes(s.start)) out.push('ends before it starts: ' + label(s));
    // The page builds each set's id from day, stage and start, and saved picks
    // use that id, so it has to be unique.
    const id = s.day + s.stage + s.start.replace(':', '');
    if (ids.has(id)) out.push('two sets share an id: ' + label(s));
    ids.add(id);
  }
  const good = d.sets.filter((s) => TIME.test(s.start) && TIME.test(s.end));
  for (let i = 0; i < good.length; i++) {
    for (let j = i + 1; j < good.length; j++) {
      const a = good[i], b = good[j];
      if (a.day === b.day && a.stage === b.stage &&
          minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end)) {
        out.push('same stage overlap: ' + label(a) + ' / ' + label(b));
      }
    }
  }
  if (d.sets.length !== SET_COUNT) out.push(`${d.sets.length} sets, expected ${SET_COUNT}`);
  return out;
}

console.log('\nThe Ramble data file');
let data = null;
try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* reported below */ }
check('is valid JSON', data !== null);
if (data) {
  const p = problems(data);
  check('has no problems', p.length === 0, p.join('; '));
  check('says its times are Eastern', data.timezone === 'America/New_York');
}

// The checks above only mean something if they can fail. Break a copy of the
// data one way at a time and make sure each break is caught.
console.log('\nThe checks catch a broken file');
if (data) {
  const broken = (name, edit) => {
    const copy = JSON.parse(JSON.stringify(data));
    edit(copy);
    check(name, problems(copy).length > 0);
  };
  broken('an unknown stage', (d) => { d.sets[0].stage = 'zz'; });
  broken('an unknown day', (d) => { d.sets[0].day = 'thu'; });
  broken('an end time before the start', (d) => { d.sets[0].end = d.sets[0].start; });
  broken('a malformed time', (d) => { d.sets[0].start = '17:40'; });
  broken('two sets overlapping on one stage', (d) => {
    const a = d.sets.find((s) => s.day === 'tue' && s.stage === 'bb' && s.start === '6:50');
    a.start = '5:50';
  });
  broken('a missing set', (d) => { d.sets.pop(); });
  broken('a bad last_checked', (d) => { d.last_checked = 'Oct 7'; });
}

// The page's "On the podcast" links. Each act must be in the data under that
// exact name, and each guest page must exist, or the link is dead.
console.log('\nOn the podcast links');
const JS = fs.readFileSync(path.join(ROOT, 'assets/js/ramble.js'), 'utf8');
const block = (JS.match(/var PODCAST = \{([\s\S]*?)\n  \};/) || [])[1] || '';
const entries = [...block.matchAll(/'([^']+)':\s*\{[^}]*href:\s*'([^']+)'/g)];
check('the map is readable', entries.length > 0);
for (const [, act, href] of entries) {
  check(act + ' is an act in the data', !!data && data.sets.some((s) => s.act === act));
  const m = href.match(/^\/guests\/([a-z0-9-]+)\/$/);
  check(href + ' is a guest page that exists',
    !!m && fs.existsSync(path.join(ROOT, 'guests', m[1], 'index.html')));
}

// Pages swap without reloading, so a visitor who clicks through to /ramble/
// runs whatever scripts the first page loaded. Every page that soft-navigates
// has to carry ramble.js, or the schedule never draws.
console.log('\nEvery page loads the schedule script');
const pages = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git', 'test', 'tools'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === 'index.html') pages.push(p);
  }
})(ROOT);
const missing = pages.filter((p) => {
  const h = fs.readFileSync(p, 'utf8');
  return h.includes('/assets/js/nav.js') && !h.includes('/assets/js/ramble.js');
}).map((p) => path.relative(ROOT, p));
check(pages.length + ' pages checked, none missing it', missing.length === 0, missing.join(', '));

// The banner changes twice by date, with no deploy: past tense when the
// Ramble ends, gone a month later. Each instant is written in two places,
// index.html for a page load and ramble.js for arriving inside the site.
console.log('\nThe homepage banner');
const HOME = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const utc = (src, re) => { const m = src.match(re); return m ? Date.UTC.apply(null, m[1].split(',').map(Number)) : NaN; };
const homeOver = utc(HOME, /over = Date\.UTC\(([\d, ]+)\)/), jsOver = utc(JS, /var RAMBLE_OVER = Date\.UTC\(([\d, ]+)\);/);
const homeUntil = utc(HOME, /until = Date\.UTC\(([\d, ]+)\)/), jsUntil = utc(JS, /var BANNER_UNTIL = Date\.UTC\(([\d, ]+)\);/);
check('the end of the Ramble is the same instant in both places', homeOver === jsOver && !isNaN(homeOver));
check('the banner takedown is the same instant in both places', homeUntil === jsUntil && !isNaN(homeUntil));
check('the Ramble ends Oct 22, midnight Eastern', homeOver === Date.parse('2026-10-22T00:00:00-04:00'));
check('the banner goes Nov 21, midnight Eastern, standard time', homeUntil === Date.parse('2026-11-21T00:00:00-05:00'));
check('the banner has a past-tense line', /class="one rb-past"/.test(HOME));
check('the page has its ended note', fs.readFileSync(path.join(ROOT, 'ramble/index.html'), 'utf8').includes('id="rover" hidden'));
check('it links to /ramble/', /id="rbanner"[\s\S]*?href="\/ramble\/"/.test(HOME));

console.log('\nThe page around the schedule');
const PAGE = fs.readFileSync(path.join(ROOT, 'ramble/index.html'), 'utf8');
for (const src of ['/assets/brand/ibma-wob-2026.png', '/assets/brand/ibma-icon-60.jpg']) {
  check(src + ' exists', fs.existsSync(path.join(ROOT, src)));
}
check('the credit shows the logo with its alt text',
  PAGE.includes('src="/assets/brand/ibma-wob-2026.png"') && PAGE.includes('alt="IBMA World of Bluegrass 2026"'));
check('the sitemap lists /ramble/',
  fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').includes('tshawsprogressivebluegrass.com/ramble/</loc>'));
check('the link preview points at /ramble/',
  PAGE.includes('<meta property="og:url" content="https://www.tshawsprogressivebluegrass.com/ramble/">'));

console.log('');
if (failures) { console.log(failures + ' failing'); process.exit(1); }
console.log('all passing');
