// The Ramble plan as an email: HTML for the inbox, plain text beside it for
// mail apps that will not show HTML. Both come from planRows in
// assets/js/ramble.js, the same code the page and its share panel use, so the
// email can never say something the page does not.
//
// ramble.js is a browser script. It is run here in a sandbox with a stand-in
// window, the same way test/ramble.js loads it.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SITE = 'https://www.tshawsprogressivebluegrass.com';
const ROOT = path.join(__dirname, '..');

let R = null;
function ramble() {
  if (R) return R;
  const sandbox = { window: {}, Date, Math, String, Number, Array, Set, Object, JSON };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assets/js/ramble.js'), 'utf8'), sandbox);
  R = sandbox.window.TSRamble;
  R.load(JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/data/ramble-2026.json'), 'utf8')));
  return R;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// The site's palette, written out: mail apps ignore CSS variables.
const C = {
  paper: '#F5F0E6', paper2: '#EBE4D6', paper3: '#E2D9C7', rule: '#D6CBB8',
  ink: '#1A1714', ink2: '#4A423A', muted: '#6E6458', accent: '#9C4A2F',
  stage: '#211C17', warn: '#8A2B1D', ms: '#D3DBC0'
};
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";

function html(rows) {
  const link = (href, text) => '<a href="' + esc(href) + '" style="color:' + C.accent +
    ';font-weight:bold;text-decoration:underline">' + esc(text) + '</a>';
  let h = '';
  rows.days.forEach((d) => {
    h += '<tr><td style="padding:26px 0 8px;font-family:' + SANS + ';font-size:13px;font-weight:bold;' +
      'letter-spacing:2px;color:' + C.ink + ';border-bottom:2px solid ' + C.ink + '">' + esc(d.label) + '</td></tr>';
    d.items.forEach((it) => {
      if (it.type === 'break') {
        h += '<tr><td style="padding:12px 0 12px 14px;font-family:' + SERIF + ';font-size:15px;font-style:italic;' +
          'color:' + C.ink2 + ';border-bottom:1px solid ' + C.rule + '"><strong style="font-style:normal">Break, ' +
          esc(it.length) + '.</strong>' + (it.food.length ? ' Food on Main Street: ' + esc(it.food.join(', ')) + '.' : '') +
          '</td></tr>';
        return;
      }
      // Main Street carries the same sage as the grid on the page.
      const edge = it.areaId === 'ms' ? C.ms : C.paper3;
      h += '<tr><td style="padding:12px 0 12px 10px;border-bottom:1px solid ' + C.rule + ';border-left:4px solid ' + edge + '">' +
        '<div style="font-family:' + SANS + ';font-size:13px;font-weight:bold;color:' + C.accent + '">' + esc(it.time) + '</div>' +
        '<div style="font-family:' + SERIF + ';font-size:18px;font-weight:bold;color:' + C.ink + ';padding-top:2px">' + esc(it.act) + '</div>' +
        '<div style="font-family:' + SANS + ';font-size:14px;color:' + C.muted + ';padding-top:2px">' +
        esc(it.stage) + ' &middot; ' + esc(it.area) + '</div>' +
        it.notes.map((n) => '<div style="font-family:' + SANS + ';font-size:14px;padding-top:4px;color:' +
          (n.warn ? C.warn + ';font-weight:bold' : C.ink2) + '">' + esc(n.text) + '</div>').join('') +
        '</td></tr>';
    });
  });

  const links = [link(rows.map, 'Map')];
  if (rows.passes) links.push(link(rows.passes, 'Get your passes here'));
  links.push(link(rows.plan, 'Open or change this plan'));

  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">' +
    '<title>My IBMA Ramble plan</title></head>' +
    '<body style="margin:0;padding:0;background:' + C.paper2 + '">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + C.paper2 + '"><tr><td align="center" style="padding:20px 10px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:' + C.paper + ';border-radius:6px">' +
    // Header: the wordmark on the dark stage colour.
    '<tr><td style="background:' + C.stage + ';padding:18px 24px;border-radius:6px 6px 0 0">' +
    '<a href="' + SITE + '/"><img src="' + SITE + '/assets/email/wordmark-paper@2x.png" width="128" height="36" alt="T Shaw\'s" style="display:block;border:0"></a></td></tr>' +
    // Title, with IBMA's logo as IBMA supplied it.
    '<tr><td style="padding:24px 24px 4px">' +
    '<img src="' + SITE + '/assets/brand/ibma-wob-2026.png" width="133" height="26" alt="IBMA World of Bluegrass 2026" style="display:block;border:0;margin-bottom:16px">' +
    '<div style="font-family:' + SERIF + ';font-size:26px;font-weight:bold;color:' + C.ink + '">My IBMA Ramble plan</div>' +
    '<div style="font-family:' + SANS + ';font-size:14px;color:' + C.muted + ';padding-top:6px">Chattanooga, Oct 20 and 21. All times are PM Eastern.</div>' +
    '<div style="padding-top:18px"><a href="' + esc(rows.plan) + '" style="display:inline-block;background:' + C.ink +
    ';color:' + C.paper + ';font-family:' + SANS + ';font-size:14px;font-weight:bold;letter-spacing:1px;text-decoration:none;' +
    'padding:12px 22px;border-radius:999px">OPEN OR CHANGE THIS PLAN</a></div></td></tr>' +
    '<tr><td style="padding:0 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + h + '</table></td></tr>' +
    // Getting around.
    '<tr><td style="padding:28px 24px 0"><div style="font-family:' + SANS + ';font-size:13px;font-weight:bold;letter-spacing:2px;color:' + C.ink + '">GETTING AROUND</div>' +
    '<div style="font-family:' + SERIF + ';font-size:16px;line-height:1.5;color:' + C.ink2 + ';padding-top:8px">' + esc(rows.areas) +
    (rows.shuttle ? ' ' + esc(rows.shuttle) : '') + '</div>' +
    '<div style="font-family:' + SANS + ';font-size:15px;padding-top:14px;line-height:1.8">' + links.join(' &nbsp;&middot;&nbsp; ') + '</div></td></tr>' +
    // Footer.
    '<tr><td style="padding:28px 24px 24px;font-family:' + SANS + ';font-size:12px;line-height:1.6;color:' + C.muted + '">' +
    '<div style="border-top:1px solid ' + C.rule + ';padding-top:16px">From <a href="' + SITE + '/" style="color:' + C.muted + '">T Shaw\'s Progressive Bluegrass</a>. ' +
    'Schedule from IBMA World of Bluegrass, used with permission. Check IBMA for last-minute changes.</div>' +
    '<div style="padding-top:8px">You asked the Ramble page to send your plan to this address. It was used to send this email and was not saved.</div>' +
    '</td></tr></table></td></tr></table></body></html>';
}

function build(ids, now) {
  const r = ramble();
  const clean = r.planIds('#plan=' + ids.join('.'));
  const rows = r.planRows(clean, SITE, now);
  return { ids: clean, subject: 'My IBMA Ramble plan', html: html(rows), text: r.planText(clean, SITE, now) };
}

module.exports = { build, SITE };
