/* The Guest: line, read once for the whole site.
 *
 * Trevor writes one optional line in each episode's show notes:
 *
 *     Guest: Cory Walker (East Nash Grass)
 *     Guests: Jon Weisberger; Kate Kirchner (Bluegrass Sundays)
 *
 * /guests/ builds its table from it and /episodes/ names the guest on each
 * row. Both ask this file, so there is exactly one answer to "who was on this
 * episode", not two implementations that can drift apart. Same posture as
 * epvideo.js, which owns the Watch question for the same reason.
 *
 * Lived inside assets/js/guests.js until 2026-09-19.
 */
window.TSGuestLine = (function () {
  'use strict';

  // One normalisation for every name comparison. Case, spacing, punctuation
  // and accents all vanish, so "T Shaw's" and "T Shaws" are the same key, and
  // so are "Béla" and "Bela". Without the accent step an accented letter was
  // simply deleted from the key.
  function key(n) {
    return String(n || '').normalize('NFD').toLowerCase().replace(/[^a-z]/g, '');
  }

  /* The show notes arrive as HTML, so "&" in a band name is "&amp;" and an
   * apostrophe may be "&#039;". Found 2026-09-12 on Adam Greuel (Horseshoes &
   * Hand Grenades): the ";" closing that entity was read as the separator
   * between two guests, which split him into two broken rows. Decode before
   * anything splits. The page encodes exactly once on the way out. */
  var NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  function decode(s) {
    return String(s).replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, function (m, d, h, n) {
      if (d) return String.fromCodePoint(parseInt(d, 10));
      if (h) return String.fromCodePoint(parseInt(h, 16));
      return NAMED[n.toLowerCase()] || m;
    });
  }

  /* ---- editorial name corrections ----
   *
   * Trevor writes the line himself, so a spelling can vary between episodes and
   * split one person into two rows. Confirmed 2026-09-07: it is Jon Weisberger,
   * and John is a misspelling wherever it appears.
   *
   * Keys are normalised names. Only add a pair somebody has confirmed. This is
   * not a place to guess that two similar names are one person. */
  var ALIASES = { johnweisberger: 'Jon Weisberger' };
  function canonical(name) { return ALIASES[key(name)] || name; }

  /* ---- band name corrections ----
   *
   * Same idea, for what is inside the parentheses. Trevor knows this scene far
   * better than this site does, so the bar is high: a correction goes in only
   * when the band's own site, or the festival that booked them, spells it
   * differently. Every entry below carries where it was checked. Anything not
   * on this list renders exactly as he wrote it.
   *
   * Keys are normalised, so this cannot fix capitalisation on its own. It
   * replaces the whole string, which is the point: "the" versus "The" is
   * precisely the kind of thing being fixed.
   *
   * Checked 2026-09-19:
   *   highcoldwind.com          page title and body, lowercase "the"
   *   woodboxheroes.com/bio     "Wood Box Heroes", three words, and the
   *                             footer reads "Wood Box Heroes TM"
   *   michaelprewitt.net/about  "Michael Prewitt & CrunchGrass Supreme"
   *   richmondfolkfestival.org  the festival that booked them, on a page that
   *                             names Jared Pool in the lineup. Charlottesville
   *                             is central Virginia, not east. */
  var AFFILIATIONS = {
    randysteeleandthehighcoldwind: 'Randy Steele and the High Cold Wind',
    woodboxheroes: 'Wood Box Heroes',
    crunchgrasssupreme: 'CrunchGrass Supreme',
    eastvirginiabluegrassdestroyers: 'Central Virginia Bluegrass Destroyers'
  };
  function fixAff(a) { return AFFILIATIONS[key(a)] || a; }

  /* ---- guests who have a page of their own ----
   *
   * Keys are normalised names, values are the directory under /guests/. This
   * is NOT a guest list and must never become one: the guests table and the
   * episode rows still come entirely from the feed, and a name missing from
   * here simply renders as plain text.
   *
   * It is a list of what is in the repo, so it cannot drift from the feed. It
   * can only drift from the filesystem, and test/guest-pages.js checks both
   * directions: every slug here has a page, and every page is listed here.
   *
   * Add a line when a page ships. Nothing else changes. */
  var PAGES = {
    adamgreuel:     'adam-greuel',
    alexgenova:     'alex-genova',
    anjway:         'anj-way',
    corywalker:     'cory-walker',
    jaredpool:      'jared-pool',
    jessecobb:      'jesse-cobb',
    johnboulware:   'john-boulware',
    kenwhite:       'ken-white',
    krishowland:    'kris-howland',
    michaelprewitt: 'michael-prewitt',
    randysteele:    'randy-steele',
    thomascassell:  'thomas-cassell'
  };
  function pageFor(name) {
    var slug = PAGES[key(name)];
    return slug ? '/guests/' + slug + '/' : null;
  }

  /* ---- the host is not a guest ----
   *
   * Trevor writes "Guest: Trevor Shaw (T Shaws Progressive Bluegrass)" on
   * episodes that have no guest, so the field is never blank. Left alone that
   * makes him the most frequent guest on his own show, ahead of every real one.
   *
   * The site absorbs the convention rather than asking him to hold an exception
   * in his head.
   *
   * Full names only. A bare "Trevor" is not on this list on purpose: a guest
   * called Trevor Wilson is a different person and must survive.
   *
   * Todd Elbrink is a guest, in episode 5, and is unaffected by any of this. */
  var HOST_KEYS = ['Trevor Shaw', "Trevor Shaw's", 'T Shaw', "T Shaw's",
                   "T Shaw's Progressive Bluegrass"].map(key);
  function isHost(name) { return HOST_KEYS.indexOf(key(name)) > -1; }

  /* Deliberately NOT a title convention. His titles are part of his voice
   * ("The Legendary Jared Pool"), and rewriting 41 published titles would churn
   * every podcast app and every existing link.
   *
   * An episode with no line contributes nobody. Since 2026-09-14 there is no
   * hand-entered list behind the feed. */
  function parse(ep) {
    var html = (ep && ep.descriptionHtml) || '';
    // Ignore ZenCast's own appended footer.
    html = html.split(/<hr\s*\/?>/i)[0];
    var text = decode(html.replace(/<[^>]+>/g, '\n'));
    /* A line of its own first. Failing that, a line typed straight on after
     * the intro's last sentence, the way episode 27 arrived on 2026-09-14:
     * "...and more. Guest: Thomas Cassell (Woodbox Heroes)". ZenCast's editor
     * makes that easy to do. The inline form needs a sentence end before it and
     * a capital G, so prose such as "my guest: nobody" is never read as a line. */
    var m = text.match(/^\s*Guests?\s*:\s*(.+)$/im) ||
            text.match(/[.!?]["'’”)]*[ \t ]+Guests?[ \t]*:[ \t]*(.+)$/m);
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
        return fixAff(a.trim());
      }).filter(Boolean);
      return { name: name, affs: affs };
    }).filter(Boolean);
  }

  return {
    key: key, decode: decode, canonical: canonical, isHost: isHost,
    fixAff: fixAff, pageFor: pageFor, parse: parse,
    // Read by test/guests.js and test/guest-pages.js.
    _aliases: ALIASES, _affiliations: AFFILIATIONS, _pages: PAGES
  };
})();
