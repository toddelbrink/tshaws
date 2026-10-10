/* The plan email, offline.
 *
 *   node test/plan-email.js
 *
 * Runs /api/plan-email with the runtime cache and Resend faked, so nothing is
 * sent. Checks the guards (same site, a real address, a real plan, the
 * limits, the bot trap) and what the email says.
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (detail ? '  -> ' + detail : ''));
}

// Fake the runtime cache before the function loads it.
const store = new Map();
const fnPath = require.resolve('@vercel/functions', { paths: [ROOT] });
require.cache[fnPath] = { id: fnPath, filename: fnPath, loaded: true, exports: {
  getCache: () => ({
    get: async (k) => store.get(k),
    set: async (k, v) => { store.set(k, v); },
    delete: async (k) => { store.delete(k); }
  })
} };
const sent = [];
global.fetch = async (url, opts) => {
  sent.push({ url, body: JSON.parse(opts.body), auth: opts.headers.authorization });
  return { ok: true, status: 200, text: async () => '' };
};
const handler = require(path.join(ROOT, 'api/plan-email.js'));
const { build } = require(path.join(ROOT, 'lib/plan-email.js'));

function call(body, { origin = 'https://www.tshawsprogressivebluegrass.com', ip = '1.2.3.4', method = 'POST' } = {}) {
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    handler({ method, body, headers: { origin, host: 'www.tshawsprogressivebluegrass.com', 'x-forwarded-for': ip } }, res);
  });
}

const PLAN = 'tuebb600.tuesb630.tuerv820.tuebb850.tuemk910.tuemk1030.wedmk550.wedst610.wedbb640.wedst810.wedhf820.wedmk830.wedrv900.wedrv940.wedmk950';

(async () => {
  console.log('Guards');
  delete process.env.RESEND_API_KEY;
  check('GET is refused', (await call({}, { method: 'GET' })).code === 405);
  check('another site is refused', (await call({ email: 'a@b.co', plan: PLAN }, { origin: 'https://evil.example' })).code === 403);
  check('a bad address is refused', (await call({ email: 'not an email', plan: PLAN })).code === 400);
  check('an empty plan is refused', (await call({ email: 'a@b.co', plan: 'nope.zzz' })).code === 400);
  check('no key says it is not set up', (await call({ email: 'a@b.co', plan: PLAN })).code === 503);
  process.env.RESEND_API_KEY = 're_test';
  const trap = await call({ email: 'a@b.co', plan: PLAN, website: 'spam' });
  check('the bot trap says yes and sends nothing', trap.code === 200 && sent.length === 0);

  console.log('\nSending');
  const ok = await call({ email: 'Fan@Example.com', plan: PLAN });
  const m = sent[0] && sent[0].body;
  check('a good request sends one email', ok.code === 200 && sent.length === 1, JSON.stringify(ok));
  check('it goes to Resend with the key', sent[0] && sent[0].url === 'https://api.resend.com/emails' && sent[0].auth === 'Bearer re_test');
  check('to the address given, and only that', m && m.to.length === 1 && m.to[0] === 'Fan@Example.com');
  check('from the show, replies to the show email', m && /tshawsprogressivebluegrass\.com>$/.test(m.from) && m.reply_to === 'progressivebluegrass@gmail.com');
  check('it carries HTML and plain text', m && /^<!doctype html>/.test(m.html) && /^My IBMA Ramble plan\n/.test(m.text));

  console.log('\nLimits');
  store.clear(); sent.length = 0;
  for (let i = 0; i < 4; i++) await call({ email: 'same@example.com', plan: PLAN }, { ip: '9.9.9.' + i });
  const fifth = await call({ email: 'SAME@example.com', plan: PLAN }, { ip: '9.9.9.9' });
  check('one address gets four a day, whatever the case', sent.length === 4 && fifth.code === 429);
  store.clear(); sent.length = 0;
  for (let i = 0; i < 6; i++) await call({ email: 'x' + i + '@example.com', plan: PLAN }, { ip: '5.5.5.5' });
  check('one connection gets six an hour', sent.length === 6 && (await call({ email: 'y@example.com', plan: PLAN }, { ip: '5.5.5.5' })).code === 429);
  check('nothing kept holds the address itself', [...store.keys()].every((k) => !/@/.test(k)));

  console.log('\nThe email');
  const e = build(PLAN.split('.'), Date.UTC(2026, 9, 15));
  const visible = e.html.replace(/<[^>]+>/g, ' ');
  check('links are labelled, never printed as addresses', !/https?:\/\//.test(visible));
  check('Map, passes and the plan are linked', />Map<\/a>/.test(e.html) && />Get your passes here<\/a>/.test(e.html) && /#plan=tuebb600\./.test(e.html));
  check('the plan link points at the live site', e.html.includes('https://www.tshawsprogressivebluegrass.com/ramble/#plan=' + PLAN));
  check('images load from the live site', [...e.html.matchAll(/<img src="([^"]+)"/g)].every((x) => x[1].startsWith('https://www.tshawsprogressivebluegrass.com/assets/')));
  check('the IBMA logo is IBMA\'s own file', e.html.includes('/assets/brand/ibma-wob-2026.png'));
  check('names with an ampersand are escaped', /Ralph Stanley II &amp; The Clinch/.test(build(['wedbb640']).html));
  check('no scripts, no outside styles', !/<script|<link /i.test(e.html));
  const after = build(PLAN.split('.'), Date.UTC(2026, 9, 22, 5));
  check('after the Ramble, no passes and no shuttle', !/passes|shuttle/i.test(after.html.replace(/<[^>]+>/g, ' ')));

  // Own events are the one piece of free text in the email. The server reads
  // them with the page's own parser, so the caps and the address filter hold
  // even when the request does not come from the page.
  console.log('\nYour own events in the email');
  const code = (list) => list.map((r) => [r.d, r.s, r.e, encodeURIComponent(r.t), encodeURIComponent(r.p)].join(',')).join(';');
  const evil = '<script>alert(1)</script>';
  const withOwn = build(['tuebb600'], Date.UTC(2026, 9, 15), code([
    { d: 'tue', s: '1800', e: '1900', t: evil, p: '<b>FEED</b>' },
    { d: 'wed', s: '2330', e: '0100', t: 'Late jam', p: '' }]));
  check('own events are in the email', withOwn.yours.length === 2 && withOwn.html.includes('Late jam') && withOwn.text.includes('Late jam'));
  check('typed markup is escaped in the HTML', !withOwn.html.includes('<script') && !withOwn.html.includes('<b>FEED') &&
    withOwn.html.includes('&lt;script&gt;'));
  check('typed text is never made a link', [...withOwn.html.matchAll(/<a [^>]*>([^<]*)<\/a>/g)].every((x) => !/alert|FEED|jam/.test(x[1])));
  check('the plain text carries it as written, and AM is marked', withOwn.text.includes(evil) && withOwn.text.includes('11:30 to 1:00 AM'));
  check('the email\'s plan link carries own events', /#plan=tuebb600&amp;own=tue,1800,1900,/.test(withOwn.html));
  const linky = build(['tuebb600'], undefined, code([{ d: 'tue', s: '1800', e: '1900', t: 'Win at scam.com', p: '' },
    { d: 'tue', s: '1900', e: '2000', t: 'ok', p: 'me@evil.co' }]));
  check('the server refuses web and email addresses', linky.yours.length === 0 && !/scam|evil/.test(linky.html + linky.text));
  const ten = build(['tuebb600'], undefined, code(Array.from({ length: 10 }, (_, i) => ({ d: 'tue', s: '120' + i, e: '130' + i, t: 'T' + i, p: '' }))));
  check('the server keeps at most six', ten.yours.length === 6);
  check('the server refuses a long name', build([], undefined, code([{ d: 'tue', s: '1200', e: '1300', t: 'x'.repeat(41), p: '' }])).yours.length === 0);
  store.clear(); sent.length = 0;
  const onlyOwn = await call({ email: 'o@example.com', plan: '', own: code([{ d: 'tue', s: '1800', e: '1900', t: 'Dinner', p: '' }]) });
  check('a plan of only own events can be emailed', onlyOwn.code === 200 && sent.length === 1 && sent[0].body.text.includes('Dinner'));
  const junk = await call({ email: 'o@example.com', plan: '', own: 'x'.repeat(9000) });
  check('junk in place of own events is refused, not sent', junk.code === 400 && sent.length === 1);

  console.log('');
  if (failures) { console.log(failures + ' failing'); process.exit(1); }
  console.log('all passing');
})();
