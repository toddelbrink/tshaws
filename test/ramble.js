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
  const stages = new Set(), days = new Set(), ids = new Set(), areas = new Set();
  // The two areas. The grid merges each area's stage columns under one label,
  // so an area's stages must sit next to each other in stage order.
  if (!Array.isArray(d.areas) || !d.areas.length) out.push('no areas');
  for (const a of d.areas || []) {
    if (areas.has(a.id)) out.push('duplicate area ' + a.id);
    areas.add(a.id);
    if (!a.name) out.push('area ' + a.id + ' has no name');
  }
  const order = d.stages.map((s) => s.area);
  const runs = order.filter((a, i) => a !== order[i - 1]);
  if (new Set(runs).size !== runs.length) out.push('an area\'s stages are not next to each other: ' + order.join(' '));
  for (const a of areas) if (!order.includes(a)) out.push('area ' + a + ' has no stages');
  for (const s of d.stages) {
    if (stages.has(s.id)) out.push('duplicate stage ' + s.id);
    stages.add(s.id);
    if (!s.short || !s.name || !s.building) out.push('stage ' + s.id + ' is missing short, name or building');
    if (!areas.has(s.area)) out.push('stage ' + s.id + ' has an unknown area');
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
  broken('a stage with an unknown area', (d) => { d.stages[0].area = 'zz'; });
  broken('an area split across the stage order', (d) => { d.stages[6].area = 'cc'; });
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

// The banner is on every page until it goes, copied from the
// homepage's master by tools/sync-banner.js. Never on the schedule itself,
// where it would link to the page it is on, and never on /admin/.
const SYNC = require(path.join(ROOT, 'tools/sync-banner.js'));
const copy = SYNC.pageCopy(SYNC.master());
const drifted = SYNC.pages().filter((p) => !fs.readFileSync(path.join(ROOT, p), 'utf8').includes(copy));
check(SYNC.pages().length + ' pages carry the homepage banner, unchanged', drifted.length === 0,
  'run node tools/sync-banner.js: ' + drifted.join(', '));
check('the schedule page has no banner', !fs.readFileSync(path.join(ROOT, 'ramble/index.html'), 'utf8').includes('id="rbanner"'));
check('the admin page has no banner', !fs.readFileSync(path.join(ROOT, 'admin/index.html'), 'utf8').includes('id="rbanner"'));
check('no copy is cut short before the banner goes', !/data-event-only/.test(copy) && !/data-event-only/.test(JS));

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

// The two areas, as Trevor named them, and the grouping the list and the grid
// are drawn from. Runs the page's own code, loaded without a browser.
console.log('\nThe two areas');
global.window = {};
require(path.join(ROOT, 'assets/js/ramble.js'));
const R = global.window.TSRamble;
check('the page exposes its grouping for testing', !!R);
if (R && data) {
  R.load(data);
  check('the areas are Convention Center and Main Street, in that order',
    data.areas.map((a) => a.name).join('|') === 'Convention Center|Main Street');
  const cc = data.stages.filter((s) => s.area === 'cc').map((s) => s.short).join('|');
  check('Convention Center is Riverview and McKenzie', cc === 'Riverview|McKenzie', cc);
  check('Main Street is the other five', data.stages.filter((s) => s.area === 'ms').length === 5);
  const seen = [];
  for (const day of data.days) {
    const groups = R.listGroups(day.id, 'all');
    check(day.label + ': both areas, in order', groups.map((g) => g.area).join() === 'cc,ms');
    for (const g of groups) {
      let prev = -1, ordered = true;
      for (const slot of g.slots) for (const x of slot.rows) {
        seen.push(x.id);
        if (x.area !== g.area) ordered = false;
        if (x.s < prev) ordered = false;
        prev = x.s;
      }
      check(day.label + ', ' + g.name + ': only its own stages, in time order', ordered);
    }
  }
  check('every set is listed exactly once across both nights',
    seen.length === data.sets.length && new Set(seen).size === seen.length, seen.length + ' listed');
  check('the Main Street choice shows only Main Street',
    R.listGroups('tue', 'area:ms').map((g) => g.area).join() === 'ms');
  check('one stage shows under its own area', R.listGroups('wed', 'rv').map((g) => g.name).join() === 'Convention Center');
  check('the grid takes the same choice', R.stagesShown('area:cc').map((s) => s.id).join() === 'rv,mk' &&
    R.stagesShown('all').length === 7);
}

// Plan links. The send panel, the phone's share panel and the email all carry
// the same link, and it has to come back as the same plan. The format has not
// changed since launch, so links already shared keep working.
const linkLine = (t) => (t.split('\n').find((l) => l.startsWith('Open or change this plan: ')) || '').slice(26);
console.log('\nPlan links round-trip');
if (R && data) {
  const all = R.load(data).map((x) => x.id);
  const some = [all[0], all[17], all[42], all[60]];
  const back = (link) => R.planIds(link).join();
  check('every set survives a link', back(R.planLink(all)) === all.join());
  check('a few picks survive a link', back(R.planLink(some)) === some.join());
  check('the link points at the live page', R.planLink(some).startsWith('https://www.tshawsprogressivebluegrass.com/ramble/#plan='));
  check('a link made on another host still reads', back(R.planLink(some, 'http://localhost:8787')) === some.join());
  check('a link shared at launch still opens', back('https://www.tshawsprogressivebluegrass.com/ramble/#plan=tuebb600.tuest640.tuehf820') === 'tuebb600,tuest640,tuehf820');
  check('unknown and repeated ids are dropped', back('/ramble/#plan=tuebb600.nope99.tuebb600') === 'tuebb600');
  check('a link with no plan is empty', back('/ramble/') === '' && back('/ramble/#plan=') === '');
  const mail = R.planMail(some);
  const body = decodeURIComponent(mail.split('&body=')[1] || '');
  check('the email is addressed to no one, so it goes to yourself', mail.startsWith('mailto:?subject='));
  check('the email carries the same link', back(linkLine(body)) === some.join());
  const sets = R.load(data);
  const area = (x) => data.areas.find((a) => a.id === x.area).name;
  check('the email lists each pick, its stage as IBMA prints it and its area',
    some.every((i) => { const x = sets.find((y) => y.id === i); return body.includes(x.act) && body.includes(x.stageName + ', ' + area(x)); }));
}

// The plan message. Plain text that goes to Mail, Messages and the share
// panel. These are the rules Cowork set on 2026-10-08.
console.log('\nThe plan message');
if (R && data) {
  const sets = R.load(data);
  const by = (id) => sets.find((x) => x.id === id);
  const text = (ids, now) => R.planText(ids, undefined, now === undefined ? R.rambleOver - 1 : now);
  const ms = sets.filter((x) => x.area === 'ms'), cc = sets.filter((x) => x.area === 'cc');
  const apart = (a, b) => a.day === b.day && a.e <= b.s;
  check('no markdown, no prices', sets.every((x) => !/[*#$_`]/.test(text([x.id]).replace(/#plan=\S*/, ''))));
  check('every set prints start and end as "6:00 to 6:40"', sets.every((x) => text([x.id]).includes(x.start + ' to ' + x.end + '  ' + x.act)));
  let walks = true, roofs = true;
  ms.forEach((a) => ms.forEach((b) => {
    if (!apart(a, b) || a.stage === b.stage) return;
    const t = text([a.id, b.id]);
    if (!/About a \d minute walk\./.test(t)) walks = false;
    if ((a.stage === 'st' || b.stage === 'st') !== t.includes('Stratus is on the roof.')) roofs = false;
  }));
  check('every Main Street pair has a measured walk', walks);
  check('the roof is mentioned only for Stratus', roofs);
  const rv = cc.find((x) => x.stage === 'rv'), mk = cc.find((x) => x.stage === 'mk' && apart(rv, x));
  check('Riverview to McKenzie is the same building', text([rv.id, mk.id]).includes('Same building.'));
  let late = true, early = true;
  sets.forEach((a) => sets.forEach((b) => {
    if (!apart(a, b) || a.area === b.area) return;
    const t = text([a.id, b.id]);
    if (b.s > 22 * 60) { if (t.includes('free shuttle from') || !t.includes('The shuttle stops at 10.')) late = false; }
    else if (!t.includes('free shuttle from ' + (a.area === 'cc' ? '11th & Marriott' : 'the Choo Choo'))) early = false;
  }));
  check('the shuttle is never offered for a set that starts after 10', late);
  check('before 10 the shuttle leaves from the right stop', early);
  const ov = sets.find((a) => sets.some((b) => b !== a && b.day === a.day && a.s < b.s && b.s < a.e));
  const ov2 = sets.find((b) => b !== ov && b.day === ov.day && ov.s < b.s && b.s < ov.e);
  check('an overlap is called out', text([ov.id, ov2.id]).includes('Overlaps the set above.'));
  const ccBreak = cc.filter((a) => cc.some((b) => b.day === a.day && b.s - a.e >= 45))[0];
  const ccNext = cc.find((b) => b.day === ccBreak.day && b.s - ccBreak.e >= 45);
  check('a break at the Convention Center names no food', /Break, /.test(text([ccBreak.id, ccNext.id])) && !/Food/.test(text([ccBreak.id, ccNext.id])));
  const msBreak = ms.filter((a) => ms.some((b) => b.day === a.day && b.s - a.e >= 45))[0];
  const msNext = ms.find((b) => b.day === msBreak.day && b.s - msBreak.e >= 45);
  const food = text([msBreak.id, msNext.id]);
  check('a Main Street break names only venues with a food line, never Songbirds',
    /Food on Main Street: /.test(food) && !/Food on Main Street:[^\n]*Songbirds/.test(food));
  check('a gap under 45 minutes is no break', !/Break/.test(text([by('tuebb600').id, by('tuesb630').id])));
  check('passes, the map and the plan link print once, at the end',
    /\nMap: https:\/\/www\.google\.com\/maps\/d\/viewer\?mid=\S+\nRamble passes: \S+\nOpen or change this plan: \S+\n\nFrom T Shaw's Progressive Bluegrass$/.test(text(['tuebb600'])));
  const after = text(['tuebb600', 'tuerv820'], R.rambleOver);
  check('after the Ramble, no shuttle and no passes, and the plan link stays',
    !/shuttle|Shuttle|passes|ticketspice/.test(after) && /Open or change this plan: /.test(after));
  // Trevor's first sample, 23 sets. The plan link is the line that must survive.
  const big = R.planIds('#plan=tuebb600.tuesb630.tuerv700.tuehf720.tuesb730.tuerv820.tuest840.tuebb850.tuerv940.tuemk1030.wedmk550.wedst610.wedhf620.wedmk630.wedbb640.wedrv700.wedst810.wedhf820.wedrv820.wedmk830.wedrv900.wedrv940.wedmk1030');
  const bigMail = R.planMail(big);
  check('a 23-set plan keeps every set and its link in the email', big.length === 23 &&
    R.planIds(linkLine(decodeURIComponent(bigMail.split('&body=')[1]))).join() === big.join(), bigMail.length + ' characters');
  check('a 23-set email stays under 6,000 characters', bigMail.length < 6000, String(bigMail.length));
}

// Passes. IBMA's ticket page, one address in one constant, never a price.
console.log('\nPasses');
if (R) {
  check('the address is IBMA\'s ticket page', R.passUrl === 'https://ibma.ticketspice.com/-ibma-world-of-bluegrass-2026');
  check('it is written once in ramble.js', JS.split('ticketspice.com').length === 2);
  const page = fs.readFileSync(path.join(ROOT, 'ramble/index.html'), 'utf8');
  check('the heading link takes its address from the script', /<a class="rpass" id="rpass"[^>]*hidden>Get your passes here<\/a>/.test(page) && !page.includes('ticketspice'));
  check('the Info item hides once the Ramble is over', /if \(!over\(\)\) \{\s*h \+= '<section aria-labelledby="ri-pass">/.test(JS));
  check('the heading link hides once the Ramble is over', /pass\.hidden = Date\.now\(\) >= RAMBLE_OVER/.test(JS));
}

// The QR code is drawn in the page by a library kept in this repo and loaded
// only when the send panel opens. It must not be on any page's script list,
// and it must not reach out to another host.
console.log('\nThe QR code library');
const QR = path.join(ROOT, 'assets/js/vendor/qrcode.js');
check('it is in the repo', fs.existsSync(QR));
if (fs.existsSync(QR)) {
  const src = fs.readFileSync(QR, 'utf8');
  check('it carries its MIT license notice', /Copyright \(c\) 2009 Kazuhiko Arase/.test(src) && /MIT license/.test(src));
  check('it makes no network calls', !/\bfetch\(|XMLHttpRequest|\bimport\(/.test(src));
  const qrcode = require(QR);
  const q = qrcode(0, 'M');
  q.addData(R ? R.planLink(R.load(data).map((x) => x.id)) : 'x');
  q.make();
  check('it can encode a plan with every set picked', q.getModuleCount() > 0 && q.getModuleCount() <= 177);
}
check('the page loads it by itself, only on demand', JS.includes("'/assets/js/vendor/qrcode.js'") &&
  !pages.some((p) => fs.readFileSync(p, 'utf8').includes('vendor/qrcode.js')));

// The Info view. Addresses as checked against each venue's own site on
// 2026-10-07. The map is linked, never embedded, and only by its viewer
// address.
console.log('\nThe Info view');
if (R && data) {
  const V = R.venues;
  const covered = V.flatMap((v) => v.stages);
  check('every stage has exactly one venue',
    data.stages.every((s) => covered.filter((x) => x === s.id).length === 1) && covered.length === data.stages.length,
    covered.join());
  const want = {
    rv: 'One Carter Plaza, Chattanooga, TN 37402',
    bb: '1501 Long St, Chattanooga, TN 37408',
    hf: '122 W Main St, Chattanooga, TN 37408',
    sb: '206 W Main St, Chattanooga, TN 37408',
    st: '105 W Main St, Chattanooga, TN 37402',
    ft: '201 W Main St, Chattanooga, TN 37408'
  };
  for (const [stage, address] of Object.entries(want)) {
    const v = V.find((x) => x.stages.includes(stage));
    check(stage + ' prints ' + address, !!v && v.address === address, v && v.address);
  }
  check('every venue links its own site over https', V.every((v) => /^https:\/\/[^/]+\/$/.test(v.site)));
  check('no food line promises food during a set', V.every((v) => !v.food || !/\b(set|show|during)\b/i.test(v.food)));
  check('Songbirds has no food line', !V.find((v) => v.stages.includes('sb')).food);
  check('the map is the viewer address', R.mapUrl === 'https://www.google.com/maps/d/viewer?mid=1QFk69ZaQhCwQrVnkdLL7Tk0U1PdFyyA');
  check('the map is never embedded or linked for editing', !/maps\/d\/(edit|embed)/.test(JS) && !/<iframe/i.test(JS));
  check('the shuttle line says until 10 p.m.', /until 10 p\.m\./.test(JS) && !/until 11 p\.m\./.test(JS));
  check('the app line and the shuttle line hide once the Ramble is over',
    /over\(\) \? '' : '<p>For last-minute changes/.test(JS) && /if \(!over\(\) && bothAreas\(L\)\)/.test(JS));
}

console.log('');
if (failures) { console.log(failures + ' failing'); process.exit(1); }
console.log('all passing');
