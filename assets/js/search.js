/* Site search: the field in the nav, and the results page at /search/.
 *
 * Two sources, both already on the site and both already cached:
 *   /api/episodes            41 episodes, titles and show notes
 *   /api/videos?mode=index   3,148 videos, titles and dates
 *
 * Episodes answer first and videos fill in behind them. The index is about
 * 300KB and on a cold edge it can take a moment, while the episode feed is
 * small and is what a name search most often wants. Nothing waits on the big
 * file to show the small answer.
 *
 * Matching rules live in textmatch.js, shared with the video grid, so the two
 * cannot disagree about what counts as a hit.
 */
(function () {
  'use strict';

  var eps = null, index = null, busy = false, wired = false;
  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function nice(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-US',
      { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }
  function fmt(sec) {
    if (!sec) return '';
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
                 : m + ':' + String(s).padStart(2, '0');
  }
  function thumb(id) { return 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'; }
  function query() {
    try { return (new URLSearchParams(location.search).get('q') || '').trim(); }
    catch (e) { return ''; }
  }

  /* ---------------- the field in the nav ---------------- */

  function wireNav() {
    document.querySelectorAll('.navsearch').forEach(function (form) {
      if (form.dataset.wired) return;
      form.dataset.wired = '1';
      form.addEventListener('submit', function (e) {
        var v = form.querySelector('input[name=q]').value.trim();
        if (!v) { e.preventDefault(); return; }
        // A real submit reloads the document and stops whatever is playing.
        if (window.TSNav) { e.preventDefault(); window.TSNav.go('/search/?q=' + encodeURIComponent(v)); }
      });
    });
  }

  /* ---------------- results ---------------- */

  // Episodes match on the title first and the show notes second, and a title
  // hit always outranks a note hit: someone typing a band name wants the
  // episode about them, not every episode that mentions them in passing.
  function findEpisodes(q) {
    if (!eps) return [];
    var n = window.TSMatch.needle(q);
    var out = [];
    eps.episodes.forEach(function (e) {
      var t = window.TSMatch.hit(e.title || '', n);
      var d = t ? 0 : (window.TSMatch.hit(e.descriptionText || '', n) ? 1 : 0);
      if (t || d) out.push({ ep: e, rank: t ? t : 10 });
    });
    return out.sort(function (a, b) {
      return a.rank - b.rank || (Date.parse(b.ep.published) - Date.parse(a.ep.published));
    }).map(function (x) { return x.ep; });
  }

  function findVideos(q) {
    if (!index) return [];
    return window.TSMatch.matches(index.videos, q).slice().sort(function (a, b) {
      return String(b.p).localeCompare(String(a.p));
    });
  }

  function epRow(e) {
    var meta = [e.episode ? 'Episode ' + e.episode : '', 'Season ' + e.season,
                nice(e.published), e.durationLabel].filter(Boolean).join('  ·  ');
    return '<li><a href="/episodes/#ep-' + esc(e.slug || e.guid) + '">' +
      '<b>' + esc(e.title) + '</b><span>' + esc(meta) + '</span></a></li>';
  }

  function vCard(v) {
    return '<button type="button" class="vcard" data-video="' + esc(v.i) + '">' +
      '<span class="shot"><img loading="lazy" decoding="async" alt="" src="' + esc(thumb(v.i)) + '">' +
      (v.d ? '<span class="dur">' + esc(fmt(v.d)) + '</span>' : '') + '</span>' +
      '<b>' + esc(v.t) + '</b><span>' + esc(nice(v.p)) + '</span></button>';
  }

  var SHOWN = 24;
  var shown = SHOWN;

  function render(root) {
    var q = query();
    var box = root.querySelector('#results');
    var field = root.querySelector('#sq');
    if (field && field.value !== q && document.activeElement !== field) field.value = q;

    if (!q) {
      box.innerHTML = '<p class="status">Type something above. This searches every ' +
        'episode and every video in the archive.</p>';
      return;
    }

    var E = findEpisodes(q), V = findVideos(q);
    var parts = [];

    parts.push('<p class="lede">' +
      (eps ? E.length.toLocaleString() + ' episode' + (E.length === 1 ? '' : 's') : 'searching episodes') +
      '  ·  ' +
      (index ? V.length.toLocaleString() + ' of ' + (index.count || index.videos.length).toLocaleString() + ' videos'
             : 'still reading the video archive') + '</p>');

    if (E.length) {
      parts.push('<section class="sec"><h2>Episodes</h2><ul class="sresults">' +
        E.map(epRow).join('') + '</ul></section>');
    }
    if (V.length) {
      var n = Math.min(shown, V.length);
      parts.push('<section class="sec"><h2>Videos</h2><div class="vgrid">' +
        V.slice(0, n).map(vCard).join('') + '</div>' +
        (V.length > n ? '<button type="button" class="more" id="moreV">Show ' +
          Math.min(SHOWN, V.length - n).toLocaleString() + ' more</button>' : '') +
        '</section>');
    }
    if (eps && index && !E.length && !V.length) {
      parts.push('<p class="status">Nothing matched “' + esc(q) + '”. ' +
        'Try a band name, a song title or a person.</p>');
    }
    box.innerHTML = parts.join('');
  }

  async function load(root) {
    if (busy) return;
    busy = true;
    try {
      if (!eps) {
        var r = await fetch('/api/episodes');
        if (r.ok) { eps = await r.json(); render(root); }
      }
    } catch (e) { eps = { episodes: [] }; }
    try {
      if (!index) {
        var r2 = await fetch('/api/videos?mode=index');
        index = r2.ok ? await r2.json() : { videos: [], count: 0 };
      }
    } catch (e) { index = { videos: [], count: 0 }; }
    busy = false;
    var live = document.getElementById('searchpage');
    if (live) render(live);
  }

  function init() {
    wireNav();
    var root = document.getElementById('searchpage');
    if (!root) return;
    shown = SHOWN;

    if (!root.dataset.wired) {
      root.dataset.wired = '1';
      root.addEventListener('submit', function (e) {
        var f = e.target.closest('#searchform');
        if (!f) return;
        e.preventDefault();
        var v = root.querySelector('#sq').value.trim();
        var url = '/search/' + (v ? '?q=' + encodeURIComponent(v) : '');
        if (window.history && history.replaceState) history.replaceState({}, '', url);
        shown = SHOWN;
        render(root);
      });
      root.addEventListener('click', function (e) {
        if (e.target.closest('#moreV')) { shown += SHOWN; render(root); return; }
        var v = e.target.closest('[data-video]');
        if (v && window.TSVideo) {
          var b = v.querySelector('b');
          window.TSVideo.play(v.dataset.video, b ? b.textContent : '');
        }
      });
    }
    render(root);
    load(root);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  document.addEventListener('tspage', init);
})();
