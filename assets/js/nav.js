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

  /* Pages that live under a nav item without being it. Empty since
   * 2026-09-19, when Guests became its own nav item instead of a tab under
   * Podcast. Kept because a future sub-page may need it.
   *
   * This has to be one function used by both paths. A hardcoded aria-current in
   * the markup survives a hard load and is then stripped by the soft-navigation
   * pass below, which matches on exact path, so the highlight would appear or
   * vanish depending on how you arrived. */
  var SECTION = {};

  function tidy(p) { return String(p || '').replace(/\/$/, '') || '/'; }

  function markCurrent(path) {
    var here = tidy(path);
    var section = SECTION[here] || null;
    document.querySelectorAll('.sitenav .inner > a, .sitenav .navgroup > a').forEach(function (a) {
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
  // markup can carry it for a section page like /guests/, because the item to
  // highlight is a different page's link. Only SECTION knows that.
  markCurrent(location.pathname);
})();

/* Drop-down menus in the site nav.
 *
 * Hovering Videos or Podcast drops a menu down. Two groups exist, declared in the
 * markup by data-menu:
 *
 *   seasons  built from the feed, so a fifth season adds itself
 *   videos   a fixed list of the routes under /videos/
 *
 * Seasons only, no second level expanding into episodes. Forty-one items and
 * growing does not belong in a hover menu, it needs a scrollbar inside a hover
 * target, and it gets worse every year the show runs. /episodes/ does that job
 * with search and filters.
 *
 * The caret stays hidden until a menu has items, so a failed fetch or no
 * JavaScript leaves plain working links.
 */
(function () {
  'use strict';

  var BUILDERS = {
    videos: function () {
      // Same order as the chooser tiles on /videos/. Two lists of the same
      // three things in two different orders is a small cruelty.
      return Promise.resolve([
        { label: 'Shows', href: '/videos/shows/' },
        { label: 'All videos', href: '/videos/all/' }
      ]);
    },
    seasons: function () {
      if (!window.fetch) return Promise.resolve([]);
      return fetch('/api/episodes?mode=meta').then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (d) {
        var out = [{ label: 'All episodes', href: '/episodes/' }];
        (d.seasons || []).slice().sort(function (a, b) { return b - a; })
          .forEach(function (s) { out.push({ label: 'Season ' + s, href: '/episodes/#season-' + s }); });
        return out;
      }).catch(function () {
        return [{ label: 'All episodes', href: '/episodes/' }];
      });
    }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function setup(group) {
    var caret = group.querySelector('.navcaret');
    var menu = group.querySelector('.navmenu');
    var build = BUILDERS[group.dataset.menu];
    if (!caret || !menu || !build) return;

    // Menus are a wide-screen affordance. Below the breakpoint the caret is
    // hidden and the top-level link goes somewhere that already lists the same
    // routes, so nothing here should open. Checked live, so a rotation or a
    // resized desktop window gets the right behaviour.
    var wide = window.matchMedia ? window.matchMedia('(min-width: 701px)') : null;
    function allowed() { return !wide || wide.matches; }

    var loaded = false;
    // Set when the visitor closes the menu on purpose. Without it, Escape
    // closes the menu, returns focus to the caret, and the resulting focusin
    // reopens it immediately. Cleared when focus or the pointer leaves.
    var dismissed = false;

    function open() {
      if (!loaded || dismissed || !allowed()) return;
      menu.hidden = false;
      caret.setAttribute('aria-expanded', 'true');
    }
    function close() {
      menu.hidden = true;
      caret.setAttribute('aria-expanded', 'false');
    }
    function isOpen() { return !menu.hidden; }

    build().then(function (items) {
      if (!items || !items.length) return;
      menu.innerHTML = items.map(function (i) {
        return '<li><a href="' + esc(i.href) + '">' + esc(i.label) + '</a></li>';
      }).join('');
      caret.hidden = false;
      loaded = true;
    });

    var canHover = !window.matchMedia || window.matchMedia('(hover: hover)').matches;
    if (canHover) {
      group.addEventListener('mouseenter', open);
      group.addEventListener('mouseleave', function () { dismissed = false; close(); });
    }
    caret.addEventListener('click', function () {
      if (isOpen()) { dismissed = true; close(); } else { dismissed = false; open(); }
    });
    group.addEventListener('focusin', open);
    group.addEventListener('focusout', function (e) {
      if (!group.contains(e.relatedTarget)) { dismissed = false; close(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) { dismissed = true; close(); caret.focus(); }
    });
    document.addEventListener('click', function (e) {
      if (isOpen() && !group.contains(e.target)) close();
    });
    menu.addEventListener('click', close);   // choosing one closes it behind you
  }

  // The nav lives outside #page, so soft navigation never replaces it and this
  // wiring happens once.
  document.querySelectorAll('.sitenav .navgroup').forEach(setup);
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
