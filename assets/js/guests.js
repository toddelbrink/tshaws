/* The guests page.
 *
 * Lived at the bottom of /about/ until 2026-09-11, below the entire About text
 * and with no nav entry, which made it undiscoverable.
 *
 * Every row is resolved from the live feed at runtime: names, affiliations,
 * episode titles, dates and deep links. That way the table cannot drift out of
 * sync when Trevor publishes, and nothing is duplicated into markup where it
 * would rot.
 *
 * Reading the Guest: line moved to assets/js/guestline.js on 2026-09-19, when
 * /episodes/ started naming guests too. This file owns the table; that one owns
 * the question of who was on an episode. */
(function () {
  'use strict';

  var eps = null;
  var GL = window.TSGuestLine;

  function buildRoster() {
    var byName = {};

    function entry(name) {
      var k = GL.key(name);
      if (!byName[k]) byName[k] = { name: name, affs: [], eps: [] };
      return byName[k];
    }
    function addAffs(e, list) {
      list.forEach(function (a) {
        var seen = e.affs.some(function (x) { return GL.key(x) === GL.key(a); });
        if (a && !seen) e.affs.push(a);
      });
    }

    (eps ? eps.episodes : []).forEach(function (e) {
      var found = GL.parse(e);
      // An episode whose only named guest was the host has no guests at all.
      if (!found.length) return;
      found.forEach(function (g) {
        var row = entry(g.name);
        addAffs(row, g.affs);
        if (row.eps.indexOf(e.episode) < 0) row.eps.push(e.episode);
      });
    });

    return Object.keys(byName).map(function (k) { return byName[k]; })
      .filter(function (g) { return g.eps.length; })
      .map(function (g) { g.eps.sort(function (a, b) { return a - b; }); return g; })
      .sort(function (a, b) { return Math.max.apply(null, b.eps) - Math.max.apply(null, a.eps); });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function render(root) {
    var byNum = {};
    (eps ? eps.episodes : []).forEach(function (e) { byNum[e.episode] = e; });

    var rows = buildRoster().map(function (g) {
      var name = g.name, aff = g.affs.join(', '), nums = g.eps;
      // A guest with a page of their own is linked to it. Everyone else stays
      // plain text, exactly as this column read before pages existed.
      var href = GL.pageFor(name);
      var cell = href ? '<a href="' + esc(href) + '">' + esc(name) + '</a>' : esc(name);
      var links = nums.map(function (n) {
        var e = byNum[n];
        if (!e) return '<span class="meta">' + n + '</span>';
        // Deep link into the episode list, which scrolls to and loads that row.
        return '<a href="/episodes/#ep-' + esc(e.slug || e.guid) + '" title="' +
               esc(e.title) + '">' + n + '</a>';
      }).join('');
      return '<tr><td>' + cell + '</td>' +
             '<td class="aff">' + (aff ? esc(aff) : '<span class="meta">&mdash;</span>') + '</td>' +
             '<td><div class="eps">' + links + '</div></td></tr>';
    }).join('');

    root.querySelector('#guestlist').innerHTML =
      '<table class="guests"><caption>Newest first. Episode numbers link straight to ' +
      'the episode.</caption><thead><tr><th>Guest</th><th>Affiliation</th>' +
      '<th>Episodes</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  async function init() {
    var root = document.getElementById('guestspage');
    // Every page loads every script, so this one no-ops elsewhere. Both checks
    // matter: /about/ carries id="guests" for its anchor, which is why the root
    // is "guestspage", and the list is checked too so a future id reuse cannot
    // get this far and throw on a missing table.
    if (!root || !root.querySelector('#guestlist')) return;

    try {
      if (!eps) {
        var r = await fetch('/api/episodes');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        eps = await r.json();
      }
      render(root);
    } catch (e) {
      // The names are the content; the links are the enhancement. Degrade to
      // a table without links rather than showing nothing.
      eps = { episodes: [] };
      render(root);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  document.addEventListener('tspage', init);
})();
