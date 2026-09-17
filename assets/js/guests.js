/* The guests page.
 *
 * Lived at the bottom of /about/ until 2026-09-11, below the entire About text
 * and with no nav entry, which made it undiscoverable.
 *
 * Every row is resolved from the live feed at runtime: names, affiliations,
 * episode titles, dates and deep links. That way the table cannot drift out of
 * sync when Trevor publishes, and nothing is duplicated into markup where it
 * would rot. */
(function () {
  'use strict';

  var eps = null;

  // One normalisation for every name comparison on this page. Case, spacing,
  // punctuation and accents all vanish, so "T Shaw's" and "T Shaws" are the
  // same key, and so are "Béla" and "Bela". Without the accent step an accented
  // letter was simply deleted from the key.
  function key(n) {
    return String(n || '').normalize('NFD').toLowerCase().replace(/[^a-z]/g, '');
  }

  /* The show notes arrive as HTML, so "&" in a band name is "&amp;" and an
   * apostrophe may be "&#039;". Found 2026-09-12 on Adam Greuel (Horseshoes &
   * Hand Grenades): the ";" closing that entity was read as the separator
   * between two guests, which split him into two broken rows. Decode before
   * anything splits. esc() below then encodes exactly once on the way out. */
  var NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  function decode(s) {
    return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, function (m, d, h, n) {
      if (d) return String.fromCodePoint(parseInt(d, 10));
      if (h) return String.fromCodePoint(parseInt(h, 16));
      return NAMED[n.toLowerCase()] || m;
    });
  }

  /* ---- the host is not a guest ----
   *
   * Trevor writes "Guest: Trevor Shaw (T Shaws
   * Progressive Bluegrass)" on episodes that have no guest, so the field is
   * never blank. Six episodes already carry it. Left alone that makes him the
   * most frequent guest on his own show, ahead of every real one.
   *
   * The site absorbs the convention rather than asking him to hold an
   * exception in his head. Consistency is easier to keep than a rule with a
   * carve-out, and he has already committed to it.
   *
   * Todd Elbrink is a guest, in episode 5, and is unaffected by any of this. */
  /* ---- editorial name corrections ----
   *
   * Trevor writes the Guest: line himself, so a spelling can vary between
   * episodes and split one person into two rows. Confirmed 2026-09-07:
   * it is Jon Weisberger, and John is a misspelling wherever it appears.
   *
   * Keys are normalised names. Only add a pair somebody has confirmed. This is
   * not a place to guess that two similar names are one person. */
  var ALIASES = { johnweisberger: 'Jon Weisberger' };
  function canonical(name) { return ALIASES[key(name)] || name; }

  // Full names only. A bare "Trevor" is not on this list on purpose: a guest
  // called Trevor Wilson is a different person and must survive.
  var HOST_KEYS = ['Trevor Shaw', "Trevor Shaw's", 'T Shaw', "T Shaw's",
                   "T Shaw's Progressive Bluegrass"].map(key);
  function isHost(name) { return HOST_KEYS.indexOf(key(name)) > -1; }

  /* ---- self-populating guests, if Trevor adopts the convention ----
   *
   * The feed carries no structured guest field. ZenCast declares the
   * Podcasting 2.0 namespace but emits only podcast:season and
   * podcast:episode, and there are zero <podcast:person> tags. Verified
   * against the live feed 2026-09-01.
   *
   * So we read one optional line from the show notes, a field Trevor already
   * fills for every episode:
   *
   *     Guest: Cory Walker (East Nash Grass)
   *     Guests: Jon Weisberger; Kate Kirchner (Bluegrass Sundays)
   *
   * Deliberately NOT a title convention. His titles are part of his voice
   * ("The Legendary Jared Pool"), and rewriting 41 published titles would
   * churn every podcast app and every existing link.
   *
   * An episode with no line contributes nobody. Since 2026-09-14 the page is
   * fully automatic: there is no hand-entered list behind the feed. */
  function parseGuests(ep) {
    var html = ep.descriptionHtml || '';
    // Ignore ZenCast's own appended footer.
    html = html.split(/<hr\s*\/?>/i)[0];
    var text = decode(html.replace(/<[^>]+>/g, '\n'));
    /* A line of its own first. Failing that, a line typed straight on after
     * the intro's last sentence, the way episode 27 arrived on 2026-09-14:
     * "...and more. Guest: Thomas Cassell (Woodbox Heroes)". ZenCast's editor
     * makes that easy to do. The inline form needs a sentence end before it and
     * a capital G, so prose such as "my guest: nobody" is never read as a line. */
    var m = text.match(/^\s*Guests?\s*:\s*(.+)$/im) ||
            text.match(/[.!?]["'\u2019\u201d)]*[ \t\u00a0]+Guests?[ \t]*:[ \t]*(.+)$/m);
    if (!m) return [];
    // Semicolons separate people. Commas inside the parentheses separate that
    // person's affiliations, so one guest may carry several.
    return m[1].split(/\s*;\s*/).map(function (chunk) {
      var g = chunk.trim().match(/^(.+?)\s*\(([^)]*)\)\s*$/);
      var name = (g ? g[1] : chunk).trim().replace(/[.,]+$/, '');
      if (!name || isHost(name)) return null;
      name = canonical(name);
      // "Mason Via (Mason Via)" is rendered as written. Trevor uses it for a
      // band that goes under the guest's own name, and asked 2026-09-11 for it
      // to show. It was dropped as a duplicate until 2026-09-12.
      var affs = (g ? g[2] : '').split(/\s*,\s*/).map(function (a) {
        return a.trim();
      }).filter(Boolean);
      return { name: name, affs: affs };
    }).filter(Boolean);
  }

  function buildRoster() {
    var byName = {};

    function entry(name) {
      var k = key(name);
      if (!byName[k]) byName[k] = { name: name, affs: [], eps: [] };
      return byName[k];
    }
    function addAffs(e, list) {
      list.forEach(function (a) {
        var seen = e.affs.some(function (x) { return key(x) === key(a); });
        if (a && !seen) e.affs.push(a);
      });
    }

    (eps ? eps.episodes : []).forEach(function (e) {
      var found = parseGuests(e);
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
      var links = nums.map(function (n) {
        var e = byNum[n];
        if (!e) return '<span class="meta">' + n + '</span>';
        // Deep link into the episode list, which scrolls to and loads that row.
        return '<a href="/episodes/#ep-' + esc(e.slug || e.guid) + '" title="' +
               esc(e.title) + '">' + n + '</a>';
      }).join('');
      return '<tr><td>' + esc(name) + '</td>' +
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
