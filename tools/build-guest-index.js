/* Build assets/data/guests.json from the guest pages.
 *
 *   node tools/build-guest-index.js
 *
 * Site search needs to match a guest's page copy, not just their name, so that
 * "Telluride" finds John Boulware and "record club" finds Kris Howland. Fetching
 * twelve HTML pages at search time would be absurd, so their text is flattened
 * into one small file here instead.
 *
 * Run this whenever a guest page's words change, and whenever one is added.
 * test/search.js fails if the file and the pages disagree, so a stale index
 * cannot ship quietly.
 *
 * Guests who have no page are NOT in here. They come from the live feed at
 * runtime, the same Guest: lines everything else reads, so they cannot go
 * stale in the first place.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function text(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#0*39|#x27|nbsp|mdash|middot);/g,
      (m, n) => ({ amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', mdash: '-', middot: ' ' }[n] || "'"))
    .replace(/\s+/g, ' ')
    .trim();
}
const between = (s, a, b) => {
  const i = s.indexOf(a);
  if (i < 0) return '';
  const j = s.indexOf(b, i);
  return j < 0 ? '' : s.slice(i + a.length, j);
};

const out = [];
for (const slug of fs.readdirSync(path.join(ROOT, 'guests'), { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const html = fs.readFileSync(path.join(ROOT, 'guests', slug, 'index.html'), 'utf8');
  const name = text(between(html, '<h1>', '</h1>'));
  const dek = text(between(html, '<p class="dek">', '</p>'));
  /* The at-a-glance table is split, because only part of it is an identity.
   * "Bands", "Company" and "Role" say who someone plays with, and a hit there
   * belongs at the top of a search the way a name does. "Telluride", "Plays"
   * and "Home base" are facts about them, and a hit there is a page that
   * happens to mention a word. Lumping them together put two guest pages above
   * the four episodes actually about Telluride. */
  const glanceHtml = between(html, '<table class="glance">', '</table>');
  const rows = [...glanceHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g)]
    .map((m) => [text(m[1]), text(m[2])]);
  const IDENTITY = ['bands', 'company', 'role', 'does'];
  /* Parentheticals come out: "Wood Box Heroes (mandolin, 2024 to now)" is a
   * band name plus an instrument and a date, and leaving them in meant a
   * search for "banjo" counted as a band hit and pushed guests above the
   * episodes. What is left is band names, which is what rank 2 is for. */
  const bands = rows.filter((r) => IDENTITY.includes(r[0].toLowerCase()))
    .map((r) => r[1].replace(/\s*\([^)]*\)/g, '')).join('. ');
  const glance = rows.filter((r) => !IDENTITY.includes(r[0].toLowerCase()))
    .map((r) => r.join(': ')).join('. ');
  const prose = text(between(html, '<div class="prose">', '\n  </div>'));
  // Section headings are the shape of the story and cheap to keep.
  const heads = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => text(m[1])).join('. ');
  if (!name) throw new Error(slug + ': no <h1>');
  out.push({ slug, name, dek, bands, glance, heads, text: prose });
}

// An output path can be passed in, which is how test/search.js rebuilds the
// index to a temp file and checks the committed one still matches.
const file = process.argv[2] || path.join(ROOT, 'assets/data', 'guests.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ built: new Date().toISOString().slice(0, 10), guests: out }));
const kb = (fs.statSync(file).size / 1024).toFixed(1);
if (!process.argv[2]) {
  console.log('wrote assets/data/guests.json: ' + out.length + ' guests, ' + kb + 'KB');
  for (const g of out) console.log('  ' + g.slug.padEnd(16) + ' bands: ' + (g.bands || '(none)'));
}
