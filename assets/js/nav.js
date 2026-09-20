/* Soft navigation.
 *
 * Why this exists: playback must survive navigation between pages. A normal page load destroys the <audio> element,
 * and browsers block autoplay on the new document, so audio would stop and
 * need a click to resume. Saving position to sessionStorage preserves state,
 * not playback.
 *
 * So internal links swap #page instead of reloading. The audio element and
 * the docked bar are never touched. This is ~70 lines of vanilla JS, not a
 * framework, and it is the only way to meet that criterion.
 *
 * Pages re-initialise by listening for the 'tspage' event.
 */
(function () {
  'use strict';
  if (!window.history || !window.fetch || !window.DOMParser) return; // graceful: hard nav

  var main = function () { return document.getElementById('page'); };
  var parser = new DOMParser();
  var cache = new Map();

  function internal(a) {
    if (!a || !a.href) return false;
    if (a.target && a.target !== '_self') return false;
    if (a.hasAttribute('download') || a.dataset.hardNav !== undefined) return false;
    var u = new URL(a.href, location.href);
    if (u.origin !== location.origin) return false;
    if (u.pathname === location.pathname) return false; // same page, let the hash work
    return !/\.(jpg|jpeg|png|gif|svg|pdf|mp3|zip|xml|json)$/i.test(u.pathname);
  }

  async function fetchPage(url) {
    if (cache.has(url)) return cache.get(url);
    var r = await fetch(url, { headers: { 'x-soft-nav': '1' } });
    if (!r.ok) throw new Error('http ' + r.status);
    var doc = parser.parseFromString(await r.text(), 'text/html');
    var next = doc.getElementById('page');
    if (!next) throw new Error('no #page');
    var payload = { html: next.innerHTML, title: doc.title, path: new URL(url, location.href).pathname };
    cache.set(url, payload);
    return payload;
  }

  /* Pages that live under a nav item without being it.
   *
   * This has to be one function used by both paths. A hardcoded aria-current in
   * the markup survives a hard load and is then stripped by the soft-navigation
   * pass below, which matches on exact path, so the highlight would appear or
   * vanish depending on how you arrived.
   *
   * SECTION is for one named page. PREFIX is for a family of them: every guest
   * page is /guests/<slug>/, and there is one per guest and growing, so naming
   * them individually here would be a second list to keep in step with the
   * filesystem. The prefix cannot go stale. */
  var SECTION = {};
  var PREFIX = [['/guests/', '/guests']];

  function tidy(p) { return String(p || '').replace(/\/$/, '') || '/'; }

  function sectionFor(here) {
    if (SECTION[here]) return SECTION[here];
    for (var i = 0; i < PREFIX.length; i++) {
      // The section page itself is not "under" the section, it is the section,
      // and it gets aria-current="page" from the exact match below.
      if (here !== tidy(PREFIX[i][0]) && (here + '/').indexOf(PREFIX[i][0]) === 0) {
        return PREFIX[i][1];
      }
    }
    return null;
  }

  function markCurrent(path) {
    var here = tidy(path);
    var section = sectionFor(here);
    document.querySelectorAll('.sitenav .inner > a').forEach(function (a) {
      var target = tidy(new URL(a.href, location.href).pathname);
      if (target === here) a.setAttribute('aria-current', 'page');
      // Not the page itself, but the section it belongs to. "true" rather than
      // "page" because it is not the current page and must not claim to be.
      else if (section && target === section) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }

  function apply(payload, hash) {
    var m = main();
    // A soft navigation that resolves after a real navigation has already
    // replaced the document has nothing left to write into. Dropping it is
    // correct: the page the visitor asked for is the one already loading.
    if (!m) return;
    m.innerHTML = payload.html;
    document.title = payload.title;

    markCurrent(payload.path);

    // Screen readers get no page-load cue on a soft nav, so move focus to the
    // new heading and announce it.
    var h = m.querySelector('h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    if (hash) {
      var t = document.getElementById(hash.slice(1));
      if (t) t.scrollIntoView();
    } else {
      window.scrollTo(0, 0);
    }
    document.dispatchEvent(new CustomEvent('tspage', { detail: { path: payload.path } }));
  }

  async function go(url, push) {
    var u = new URL(url, location.href);
    try {
      var payload = await fetchPage(u.pathname + u.search);
      if (push) history.pushState({ soft: 1 }, '', u.pathname + u.search + u.hash);
      apply(payload, u.hash);
    } catch (e) {
      location.href = url; // any failure falls back to a real navigation
    }
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest('a');
    if (!internal(a)) return;
    e.preventDefault();
    go(a.href, true);
  });

  window.addEventListener('popstate', function () { go(location.href, false); });

  // Prime the cache on hover so the swap feels instant.
  document.addEventListener('mouseover', function (e) {
    var a = e.target.closest('a');
    if (internal(a)) { var u = new URL(a.href, location.href); fetchPage(u.pathname + u.search).catch(function () {}); }
  });

  // Hard load. The markup carries aria-current for the page itself, but no
  // markup can carry it for a section page like /guests/john-boulware/,
  // because the item to highlight is a different page's link. Only the rules
  // above know that.
  markCurrent(location.pathname);

  /* The one seam out of this module. The nav's search form is not a link, so
   * it cannot ride the click handler above, and a real form submit would
   * reload the document and stop whatever is playing. search.js calls this
   * instead. */
  window.TSNav = { go: function (url) { go(url, true); } };
})();

/* The copyright year in the site footer.
 *
 * Every page carries a footer now, and three different modules used to fill
 * this in three different ways: home.js on #yr, about.js and mortgages.js on
 * .yr inside their own root. The four pages that gained a footer on 2026-09-11
 * belong to no such module, so this is one handler for all of them.
 *
 * Runs on soft navigation too. The footer lives inside #page and is replaced
 * along with everything else. */
(function () {
  'use strict';

  function stamp() {
    var y = String(new Date().getFullYear());
    document.querySelectorAll('.yr, #yr').forEach(function (n) { n.textContent = y; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', stamp);
  else stamp();
  document.addEventListener('tspage', stamp);
})();
