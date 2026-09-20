/* Guest-line parser tests.
 *
 *   node test/guests.js          synthetic cases, offline
 *   node test/guests.js --live   the same, plus the real feed
 *
 * assets/js/guests.js is a browser script with no exports, so this loads it
 * against a stub DOM and reads the table it renders. That is deliberate: the
 * test exercises the file that actually ships, not a copy of its logic.
 *
 * The roster lived in about.js until 2026-09-11, when the list moved off the
 * About page onto /guests/. Same logic, same table, new home.
 *
 * The key rule under test: Trevor writes "Guest: Trevor Shaw (...)" on episodes with no guest, and
 * the host must never appear on his own guests page.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const key = (s) => String(s).normalize('NFD').toLowerCase().replace(/[^a-z]/g, '');

// The page escapes once. Undo exactly one layer, so a double-escaped value
// comes back still carrying &amp; and fails the comparison instead of passing.
const unescape = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (m, n) =>
  ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[n]);

function renderWith(feed) {
  let captured = '';
  const guestlist = { set innerHTML(v) { captured = v; }, get innerHTML() { return captured; } };
  const root = {
    querySelectorAll: () => [],
    querySelector: (s) => (s === '#guestlist' ? guestlist : null)
  };
  global.document = {
    readyState: 'complete',
    getElementById: (id) => (id === 'guestspage' ? root : null),
    addEventListener: () => {}
  };
  global.fetch = async () => ({ ok: true, json: async () => feed });
  require(path.join(ROOT, 'assets/js/guests.js'));

  return new Promise((resolve) => setTimeout(() => {
    resolve([...captured.matchAll(
      /<tr><td>(.*?)<\/td><td class="aff">(.*?)<\/td><td><div class="eps">(.*?)<\/div>/g)]
      .map((m) => ({
        // Since 2026-09-19 a guest with a page of their own has their name
        // wrapped in a link to it. The name is what these tests are about, so
        // it is read out of the cell and the link is kept separately.
        name: unescape(m[1].replace(/<\/?a\b[^>]*>/g, '')),
        page: (m[1].match(/href="(\/guests\/[a-z0-9-]+\/)"/) || [])[1] || null,
        aff: unescape(m[2].replace(/<span class="meta">&mdash;<\/span>/, '').trim()) || null,
        eps: [...m[3].matchAll(/>(\d+)</g)].map((x) => +x[1])
      })));
  }, 150));
}

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

const HOST_NAMES = ['Trevor Shaw', "Trevor Shaw's", 'T Shaw', "T Shaw's",
                    "T Shaw's Progressive Bluegrass"].map(key);

function assertNoHost(rows) {
  const host = rows.find((r) => HOST_NAMES.includes(key(r.name)));
  check('host absent from the guests list', !host, host && JSON.stringify(host));
}
function row(rows, name) { return rows.find((r) => r.name === name); }

async function synthetic() {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/guest-lines.json'), 'utf8'));
  const feed = {
    seasons: [9],
    episodes: fixture.episodes.map((e) => ({
      episode: e.episode, season: 9, slug: 's' + e.episode, guid: 'g' + e.episode,
      title: 'Fixture ' + e.episode,
      descriptionHtml: `<p>${e.line}</p><hr><p>ZenCast footer</p>`
    }))
  };
  const rows = await renderWith(feed);
  console.log('\n--- synthetic cases ---');
  assertNoHost(rows);

  const cory = row(rows, 'Cory Walker');
  check('semicolons separate people, commas separate affiliations',
    !!cory && cory.aff === 'East Nash Grass, Winding Down Boys', cory && String(cory.aff));
  check('a second person on the same line survives', !!row(rows, 'Kate Kirchner'));
  check('host named alongside a real guest keeps the guest', !!row(rows, 'Sierra Hull'));

  const hostOnly = [92, 93, 94, 95];
  check('host-only episodes yield no guests at all',
    rows.every((r) => !r.eps.some((e) => hostOnly.includes(e))),
    rows.filter((r) => r.eps.some((e) => hostOnly.includes(e))).map((r) => r.name).join(','));

  const trevorW = row(rows, 'Trevor Wilson');
  check('a guest who happens to be called Trevor is kept', !!trevorW && trevorW.eps.includes(97));

  const jon = row(rows, 'Jon Weisberger');
  check('John Weisberger is corrected to Jon and not split into two rows',
    !!jon && jon.eps.includes(96) && !row(rows, 'John Weisberger'));

  /* ---- three defects found in production, 2026-09-11 ---- */

  // The feed sends & as &amp;. The ; in that entity was read as the separator
  // between two guests, which split one person into two broken rows.
  const adam = row(rows, 'Adam Greuel');
  check('an ampersand in a band name stays one guest, decoded once',
    !!adam && adam.aff === 'Horseshoes & Hand Grenades' &&
      !rows.some((r) => /Grenades|&amp|;/.test(r.name)),
    adam ? String(adam.aff) : rows.filter((r) => /Greuel|Grenades/.test(r.name)).map((r) => r.name).join(' / '));
  const danny = row(rows, "Danny O'Keefe");
  check('numeric apostrophe entities decode in names and affiliations',
    !!danny && danny.aff === "O'Keefe & Sons", danny ? String(danny.aff) : 'no row');
  const bela = row(rows, 'Béla Fleck');
  check('accented characters survive in names and affiliations',
    !!bela && bela.aff === 'Béla Fleck & the Flecktones', bela ? String(bela.aff) : 'no row');
  const zoe = row(rows, 'Zoë Keating');
  check('numeric accented entities and &nbsp; decode',
    !!zoe && zoe.aff === 'Keating Trio', zoe ? String(zoe.aff) : 'no row');

  // His convention for a band that goes under his own name. It is his to hold.
  const mason = row(rows, 'Mason Via');
  check('an affiliation repeating the guest name is rendered, not dropped',
    !!mason && mason.aff === 'Mason Via' && mason.eps.includes(84), mason && String(mason.aff));
  const lucas = row(rows, 'Lucas White');
  check('Lucas White keeps the affiliation he wrote',
    !!lucas && (lucas.aff || '').split(', ').includes('Lucas White'), lucas && String(lucas.aff));

  // Episode 27, 2026-09-14. Trevor typed his line on the end of the intro
  // paragraph instead of on its own line, and the page read nothing.
  const jane = row(rows, 'Jane Doe');
  check('a Guest: line typed on after the intro\'s last sentence is read',
    !!jane && jane.aff === 'Fixture Band' && String(jane.eps) === '85',
    jane ? `${jane.aff} / ${jane.eps}` : rows.filter((r) => r.eps.includes(85)).map((r) => r.name).join(' / ') || 'no row');
  check('an inline host-only line still yields no guests',
    !rows.some((r) => r.eps.includes(86)),
    rows.filter((r) => r.eps.includes(86)).map((r) => r.name).join(' / '));
  check('prose mentioning a guest mid-sentence is not read as a line',
    !rows.some((r) => r.eps.includes(87)),
    rows.filter((r) => r.eps.includes(87)).map((r) => r.name).join(' / '));

  // Boulware's fallback row went on 2026-09-12, and his line must still read
  // as written.
  const john = row(rows, 'John Boulware');
  check('a guest on two episodes keeps the one affiliation both lines name (Boulware)',
    !!john && john.aff === 'Randy Steele and The High Cold Wind' &&
      String(john.eps) === '34,39', john && `${john.aff} / ${john.eps}`);
  // A guest with a page is linked to it; everyone else stays plain text. That
  // the slug points at a page that exists is test/guest-pages.js's job.
  check('a guest with a page of their own is linked to it (Boulware)',
    !!john && john.page === '/guests/john-boulware/', john && String(john.page));
  const cory2 = row(rows, 'Cory Walker');
  check('a guest with no page is still plain text', !!cory2 && cory2.page === null,
    cory2 && String(cory2.page));
}

/* ---- nobody goes missing ----
 *
 * Every guest and episode on the live page on 2026-09-12, re-checked against
 * the live page on 2026-09-13 and again on 2026-09-14, when the last fallback
 * row went. Every guest now depends on Trevor's show notes alone. The episode
 * 38 neighbours joined on 2026-09-14, once Trevor split his run-on line into
 * three people. If a Guest: line is deleted or mangled in ZenCast, that guest
 * drops off the page with nothing behind it, and the precedence check cannot
 * see it: it only proves nothing extra appears.
 *
 * This is a floor, not a snapshot. A new guest never fails it. A missing
 * guest, or a guest missing one episode, does.
 *
 * It is never rendered and never feeds the page, so it is not a second
 * fallback list. When a failure is a real change (Trevor corrects a spelling,
 * as with Kate to Katie Kirchner), update the entry here. When it is not, the
 * show note needs fixing, or he has not logged out of ZenCast yet. */
const EXPECTED = {
  'Cory Walker': [40],        'John Boulware': [34, 39],   'Anj Way': [37],
  'Jared Pool': [36],         'Alex Genova': [35],         'Michael Prewitt': [33],
  'Jesse Cobb': [29, 30],     'Randy Steele': [25, 26, 28], 'Thomas Cassell': [4, 27],
  'Adam Greuel': [24],        'Ken White': [23],           'James Kee': [20],
  'Kris Howland': [19],       'Shawn Spencer': [18],       'Katie Kirchner': [17],
  'Nick George': [16],        'Jon Weisberger': [14, 15],  'Josiah Nelson': [13],
  'Lucas White': [9, 10],     'Mason Via': [7, 8],         'Todd Elbrink': [5],
  'Jeremy Tabor': [38],       'Joe Harrison': [38],        'Ben Salaman': [38]
};

async function live() {
  console.log('\n--- live feed ---');
  const feed = await fetch('https://www.tshawsprogressivebluegrass.com/api/episodes').then((x) => x.json());
  const rows = await renderWith(feed);
  assertNoHost(rows);
  const missing = [];
  for (const [name, nums] of Object.entries(EXPECTED)) {
    const r = row(rows, name);
    if (!r) { missing.push(`${name} (${nums})`); continue; }
    const gone = nums.filter((n) => !r.eps.includes(n));
    if (gone.length) missing.push(`${name} ep ${gone}`);
  }
  check(`no known guest or guest episode has gone missing (${Object.keys(EXPECTED).length} guests)`,
    !missing.length, missing.join('; '));

  check('no guest name carries a fragment of a split line',
    rows.every((r) => !/[();]|&amp|&#/.test(r.name)),
    rows.filter((r) => /[();]|&amp|&#/.test(r.name)).map((r) => r.name).join(' / '));
  check('no affiliation carries an undecoded entity',
    rows.every((r) => !/&amp|&#|&nbsp/.test(r.aff || '')),
    rows.filter((r) => /&amp|&#|&nbsp/.test(r.aff || '')).map((r) => r.aff).join(' / '));

  /* Precedence, proved against production rather than a fixture. For every
   * row whose episodes all carry a Guest: line, the page must show exactly
   * the people and affiliations those lines name. Anything more is the
   * Boulware defect, from when fallback rows existed. This oracle is a deliberately
   * small independent reading of the line, not a copy of the page's parser. */
  const lines = {};
  for (const e of feed.episodes) {
    const t = (e.descriptionHtml || '').split(/<hr\s*\/?>/i)[0]
      .replace(/<[^>]+>/g, '\n')
      .replace(/&amp;/g, '&').replace(/&#0*39;/g, "'").replace(/&nbsp;/g, ' ');
    const m = t.match(/^\s*Guests?\s*:\s*(.+)$/im) || t.match(/[.!?]\S*\s+Guests?\s*:\s*(.+)$/m);
    if (m) lines[e.episode] = m[1];
  }
  const leaks = [];
  for (const r of rows) {
    if (!r.eps.every((n) => lines[n])) continue;
    for (const n of r.eps) {
      if (!key(lines[n]).includes(key(r.name).slice(0, 6))) leaks.push(`${r.name} not on ep ${n}`);
    }
    for (const a of (r.aff ? r.aff.split(', ') : [])) {
      if (!r.eps.some((n) => key(lines[n]).includes(key(a)))) leaks.push(`${r.name}: "${a}"`);
    }
  }
  check('covered episodes show only what their Guest: lines say', !leaks.length, leaks.join('; '));
  console.log(`      ${rows.length} guests listed`);
}

/* about.js keeps parsed episodes at module scope, which is right for a page
 * that is loaded once and wrong for a test that wants two different feeds.
 * Rather than reach into that state, each scenario gets its own process. An
 * earlier version reused one, and the live run inherited two guests from the
 * fixture without failing anything. */
if (process.env.TS_SCENARIO) {
  (async () => {
    const sc = process.env.TS_SCENARIO;
    await (sc === 'live' ? live() : synthetic());
    process.exit(failures ? 1 : 0);
  })();
} else {
  const { spawnSync } = require('child_process');
  const scenarios = ['synthetic'].concat(process.argv.includes('--live') ? ['live'] : []);
  let bad = 0;
  for (const s of scenarios) {
    const r = spawnSync(process.execPath, [__filename], {
      stdio: 'inherit', env: Object.assign({}, process.env, { TS_SCENARIO: s })
    });
    if (r.status !== 0) bad++;
  }
  console.log(bad ? `\n${bad} scenario(s) failing` : '\nall passing');
  process.exit(bad ? 1 : 0);
}
