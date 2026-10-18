/* Search metadata tests, offline.
 *
 *   node test/metadata.js
 *
 * Every public page names itself to Google with one title and one canonical
 * address, and that address is exactly the one in sitemap.xml. The homepage
 * carries the structured data that ties the show's name, its spellings and
 * Trevor together. Its links must be the footer's own links, and the mortgage
 * business stays out of it.
 *
 * Not canonical on purpose: /admin/ (private), /search/ (noindex). /ramble/
 * was held through the event freeze (2026-10-18); it may carry one or none.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const BASE = 'https://www.tshawsprogressivebluegrass.com';
const NO_CANONICAL = ['admin', 'search'];
const MAY_LACK = ['ramble'];

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (detail ? '  -> ' + detail : ''));
}

function pages(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'content', 'exports', 'test', 'tools'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) pages(p, out);
    else if (e.name === 'index.html') out.push(path.relative(ROOT, dir));
  }
  return out;
}

const sitemap = new Set([...fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8')
  .matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));

console.log('titles and canonicals');
for (const rel of pages(ROOT, []).sort()) {
  const html = fs.readFileSync(path.join(ROOT, rel, 'index.html'), 'utf8');
  const name = '/' + (rel ? rel + '/' : '');
  const url = BASE + name;
  const top = rel.split(path.sep)[0];
  check(name + ' has one title', (html.match(/<title>/g) || []).length === 1);
  const canon = [...html.matchAll(/<link rel="canonical" href="([^"]*)">/g)].map((m) => m[1]);
  if (NO_CANONICAL.includes(top)) {
    check(name + ' has no canonical', canon.length === 0);
    continue;
  }
  if (MAY_LACK.includes(top) && canon.length === 0) continue;
  check(name + ' has one canonical', canon.length === 1, canon.join(', '));
  check(name + ' canonical is its own address', canon[0] === url, canon[0]);
  check(name + ' canonical is in the sitemap', sitemap.has(canon[0]));
}

console.log('homepage structured data');
const home = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const blocks = [...home.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
check('one JSON-LD block', blocks.length === 1);
let data = null;
try { data = JSON.parse(blocks[0][1]); } catch (e) { /* reported below */ }
check('JSON-LD parses', !!data);
if (data) {
  const types = (data['@graph'] || []).map((x) => x['@type']);
  check('WebSite, PodcastSeries and Person', ['WebSite', 'PodcastSeries', 'Person'].every((t) => types.includes(t)), types.join(', '));
  const footer = new Set([...home.replace(blocks[0][0], '').matchAll(/href="(https:\/\/[^"]+)"/g)].map((m) => m[1]));
  for (const node of data['@graph']) {
    for (const u of node.sameAs || []) check('sameAs is a footer link: ' + u, footer.has(u));
    if (node.webFeed) check('webFeed is the footer feed', footer.has(node.webFeed));
  }
  check('no mortgage business', !/mortgage|nmls|alameda|chatt/i.test(blocks[0][1]));
}
check('no meta keywords anywhere on the homepage', !/name="keywords"/i.test(home));

if (failures) { console.log('\n' + failures + ' failed'); process.exit(1); }
console.log('\nall metadata checks pass');
