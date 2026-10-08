/* Copy the homepage's Ramble banner onto every page.
 *
 *   node tools/sync-banner.js
 *
 * The block between the ramble-banner markers in index.html is the master.
 * Every other page gets the same block as the first thing inside #page, with
 * data-event-only on the banner so it leaves those pages when the Ramble ends
 * and stays only on the homepage. A page that already has a copy has it
 * replaced. /ramble/ and /admin/ never get one.
 *
 * test/ramble.js fails the build if any page's copy drifts from the master,
 * so run this after any edit to the banner. Not served: the build deletes
 * tools/.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const START = '  <!-- ramble-banner:start -->\n';
const END = '  <!-- ramble-banner:end -->\n';
const SKIP = ['index.html', 'ramble/index.html', 'admin/index.html'];

function master() {
  const home = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const a = home.indexOf(START), b = home.indexOf(END);
  if (a < 0 || b < a) throw new Error('no banner markers in index.html');
  return home.slice(a, b + END.length);
}

// The copy every other page carries.
function pageCopy(block) {
  return block.replace('<div class="wrap rbanwrap" id="rbanner">',
    '<div class="wrap rbanwrap" id="rbanner" data-event-only>');
}

function pages() {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.git', 'test', 'tools', 'assets'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'index.html') out.push(path.relative(ROOT, p));
    }
  })(ROOT);
  return out.filter((p) => !SKIP.includes(p)).sort();
}

module.exports = { master, pageCopy, pages, START, END, SKIP };

if (require.main === module) {
  const copy = pageCopy(master());
  let changed = 0;
  for (const rel of pages()) {
    const file = path.join(ROOT, rel);
    let html = fs.readFileSync(file, 'utf8');
    const a = html.indexOf(START), b = html.indexOf(END);
    if (a >= 0 && b > a) html = html.slice(0, a) + copy + html.slice(b + END.length);
    else {
      const m = '<main id="page">\n';
      if (!html.includes(m)) throw new Error(rel + ' has no <main id="page">');
      html = html.replace(m, m + copy);
    }
    if (html !== fs.readFileSync(file, 'utf8')) { fs.writeFileSync(file, html); changed++; }
  }
  console.log('banner on ' + pages().length + ' pages, ' + changed + ' changed');
}
