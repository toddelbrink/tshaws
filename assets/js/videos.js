/* The video archive.
 *
 * Restructured 2026-09-07. A single feed led with the playlists and put a new
 * upload about 1,700 rows below the fold, where it looked like the site had
 * stopped updating.
 *
 * So /videos/ is a chooser, not a feed. Three routes sit under it:
 *
 *   /videos/            the chooser
 *   /videos/shows/      the playlist-derived groupings
 *   /videos/all/        every upload, filterable by year
 *
 * A show is NOT a complete concert. A playlist holds selected songs from a
 * show, not the whole set. No copy here may say otherwise.
 *
 * Which view runs is declared by data-view on #videos, so one module serves
 * all three pages and soft navigation keeps working.
 *
 * Playback is inline in a <dialog>. Nobody gets sent to YouTube.
 */
(function () {
  'use strict';

  var shows = null;      // playlist groupings, from mode=shows
  var stream = [];       // pages of the upload stream, the fast first paint
  var nextPage = null;
  var total = null;
  var index = null;      // every upload, lite. Powers search and the year filter
  var showCache = {};    // playlistId -> videos
  var q = '';
  var yr = 'all';
  var busy = false;

  var CAP = 120;         // cards rendered per step. Filtering all 3,148 takes
                         // 0.45ms, so the cap is about the DOM, not the search.
  var shownHits = CAP;
  var shownAll = CAP;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function year(iso) { return iso ? String(iso).slice(0, 4) : ''; }
  function nice(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-US',
      { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function fmt(sec) {
    if (!sec) return '';
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
                 : m + ':' + String(s).padStart(2, '0');
  }
  // The lite index omits thumbnails because every one is derivable from the ID.
  function thumb(v) {
    return gridThumb((v.thumbnail && v.thumbnail.url) ||
      'https://i.ytimg.com/vi/' + (v.id || v.i) + '/hqdefault.jpg');
  }

  // Grid cards are ~224px wide. maxresdefault is 1280x720, roughly six times
  // more pixels than the slot can show, times 135 tiles on first paint.
  // hqdefault is 480x360, exists for every video, and object-fit:cover crops
  // its 4:3 letterboxing back to 16:9.
  function gridThumb(url) {
    return typeof url === 'string'
      ? url.replace(/\/(maxres|sd|mq)default\.jpg/, '/hqdefault.jpg')
      : url;
  }

  function el(id) { return document.getElementById(id); }
  function root() { return el('videos'); }
  function view() { var r = root(); return (r && r.dataset.view) || 'chooser'; }

  /* ---------------- cards ---------------- */

  function videoCard(v) {
    var id = v.id || v.i, title = v.title || v.t, pub = v.published || v.p, dur = v.duration || v.d;
    return '<button type="button" class="vcard" data-video="' + esc(id) + '">' +
      '<span class="shot"><img loading="lazy" decoding="async" alt="" src="' + esc(thumb(v)) + '">' +
        (dur ? '<span class="dur">' + fmt(dur) + '</span>' : '') + '</span>' +
      '<b>' + esc(title) + '</b><span>' + esc(nice(pub)) + '</span></button>';
  }

  function showCard(s) {
    return '<button type="button" class="vcard" data-show="' + esc(s.id) + '">' +
      '<span class="shot"><img loading="lazy" decoding="async" alt="" src="' +
        esc(s.thumbnail ? gridThumb(s.thumbnail.url) : '') + '">' +
        '<span class="n">' + s.itemCount + '</span></span>' +
      '<b>' + esc(s.title) + '</b><span>' + esc(year(s.published)) + '</span></button>';
  }

  function concerts() {
    return shows ? shows.filter(function (s) { return s.kind === 'concert'; }) : [];
  }
  function archiveSize() { return total || (index && index.count) || null; }

  /* ---------------- views ---------------- */

  // The chooser. The top of the archive names its parts instead of leading
  // with one of them.
  function renderChooser() {
    var n = archiveSize();
    el('lede').textContent = n
      ? n.toLocaleString() + ' videos  ·  ' + concerts().length + ' shows  ·  since 2010' : '';

    el('body').innerHTML =
      '<div class="chooser">' +
        '<a class="tile" href="/videos/shows/"><b>Shows</b><span>' +
          (shows ? concerts().length + ' shows. ' : '') +
          'Videos filmed at one show, in the order they were played.</span></a>' +
        '<a class="tile" href="/videos/all/"><b>All videos</b><span>' +
          (n ? n.toLocaleString() + ' videos, newest first. ' : '') +
          'Filter by year.</span></a>' +
        '<span class="tile off" aria-disabled="true"><b>Artists</b>' +
          '<span>Coming soon.</span></span>' +
      '</div>';
  }

  function renderShows() {
    var c = concerts();
    var podcast = shows ? shows.filter(function (s) { return s.kind === 'podcast'; }) : [];
    el('lede').textContent = shows ? c.length + ' shows  ·  since 2010' : '';

    el('body').innerHTML =
      '<p class="note">Each show holds the videos Trevor filmed that night, ' +
        'in the order they were played. Not every song, and not the whole set.</p>' +
      '<div class="sec"><h2>Shows</h2><div class="vgrid" id="showgrid">' +
        c.map(showCard).join('') + '</div></div>' +
      (podcast.length ? '<div class="sec"><h2>The podcast, on video</h2><div class="vgrid">' +
        podcast.map(showCard).join('') + '</div></div>' : '');
  }

  function renderShow(id) {
    var s = shows ? shows.find(function (x) { return x.id === id; }) : null;
    var vids = showCache[id] || [];
    // An old deep link can point at a show we now filter out for having no
    // surviving videos, so there is no title to look up. Say that plainly
    // instead of heading the page "Show".
    var heading = s ? s.title : (vids.length ? 'Show' : 'This show is no longer available');
    el('lede').textContent = vids.length
      ? vids.length + ' videos' + (s && s.published ? '  ·  ' + year(s.published) : '')
      : '';
    el('body').innerHTML =
      '<button type="button" class="back" id="back"><svg class=\"arr\" viewBox=\"0 0 16 16\" aria-hidden=\"true\"><path d=\"M2 7h9.2L7.6 3.4 9 2l6 6-6 6-1.4-1.4L11.2 9H2z\"/></svg>All shows</button>' +
      '<div class="sec"><h2>' + esc(heading) + '</h2>' +
      // A deep link can outlive its videos. Never render an empty grid and
      // leave the visitor wondering whether the page broke.
      (vids.length
        ? '<div class="vgrid">' + vids.map(videoCard).join('') + '</div>'
        : '<p class="status">The videos in this show are no longer available on ' +
          'YouTube. Everything else in the archive is still here.</p>') +
      '</div>';
  }

  function years() {
    if (!index) return [];
    var seen = {};
    index.videos.forEach(function (v) { if (v.p) seen[v.p.slice(0, 4)] = 1; });
    return Object.keys(seen).sort().reverse();
  }

  // Dig in by date, by artist, by event. Year is the cut that exists in the
  // data today. Artist and event arrive with the
  // confirmed artist list, not before.
  function renderAll() {
    // The index is the real source here, because filtering by year needs the
    // whole archive in memory. Until it lands, the paged stream is already
    // here and shows the newest videos, which is what most visitors want.
    var ready = !!index;
    var source = ready ? index.videos : stream;
    var list = (ready && yr !== 'all')
      ? source.filter(function (v) { return String(v.p || '').slice(0, 4) === yr; })
      : source;

    var n = archiveSize();
    el('lede').textContent = ready
      ? (yr === 'all'
          ? n.toLocaleString() + ' videos  ·  newest first'
          : list.length.toLocaleString() + ' videos from ' + yr)
      : (n ? n.toLocaleString() + ' videos  ·  loading the year filter...' : '');

    // Two controls, one shown at a time. Seventeen year chips is a fine row on
    // a desktop and a four-row wall on a phone, roughly 200px of buttons before
    // the visitor reaches a single video. A native select collapses that to one
    // line and brings the platform's own picker with it. Both write to the same
    // `yr`, so whichever is visible stays in step.
    var ys = ready ? years() : [];
    var chips = ready
      ? '<div class="chips" id="yrs"><button type="button" data-yr="all" aria-pressed="' +
          (yr === 'all') + '">All years</button>' +
        ys.map(function (y) {
          return '<button type="button" data-yr="' + y + '" aria-pressed="' +
            (yr === y) + '">' + y + '</button>';
        }).join('') +
        '</div>' +
        '<div class="yrsel"><label for="yrpick">Year</label>' +
        '<select id="yrpick"><option value="all"' + (yr === 'all' ? ' selected' : '') +
          '>All years</option>' +
        ys.map(function (y) {
          return '<option value="' + y + '"' + (yr === y ? ' selected' : '') + '>' + y + '</option>';
        }).join('') + '</select></div>'
      : '';

    var shown = Math.min(shownAll, list.length);
    var out = chips + '<div class="sec"><div class="vgrid" id="streamgrid">' +
      list.slice(0, shown).map(videoCard).join('') + '</div>';

    if (ready) {
      if (list.length > shown) {
        out += '<button type="button" class="more" id="moreAll">Show ' +
          Math.min(CAP, list.length - shown) + ' more</button>' +
          '<p class="status">Showing ' + shown.toLocaleString() + ' of ' +
          list.length.toLocaleString() + '.</p>';
      } else if (list.length) {
        out += '<p class="status">That is all ' + list.length.toLocaleString() +
          ' videos' + (yr === 'all' ? '.' : ' from ' + yr + '.') + '</p>';
      } else {
        out += '<p class="status">No videos from ' + esc(yr) + '.</p>';
      }
    } else {
      out += '<button type="button" class="more" id="more"' + (nextPage ? '' : ' disabled') + '>' +
        (nextPage ? 'Load more' : 'End of archive') + '</button>';
    }
    el('body').innerHTML = out + '</div>';
  }

  // The matching rules moved to assets/js/textmatch.js on 2026-09-20, so the
  // grid and the site search cannot drift apart on what counts as a match.
  var fold = function (s) { return window.TSMatch.fold(s); };
  var matches = function (list, needle) { return window.TSMatch.matches(list, needle); };

  // Search whatever is in memory first. On a cold edge cache the full index
  // takes seconds to arrive, and the pages already loaded cover the newest
  // videos, which is what most searches are reaching for. Results widen on
  // their own when the index lands.
  function renderSearch() {
    var needle = q.toLowerCase();
    var ready = !!index;
    var hits = matches(ready ? index.videos : stream, needle);
    var scope = ready ? (index.count || index.videos.length) : stream.length;

    el('lede').textContent = ready
      ? hits.length.toLocaleString() + ' of ' + scope.toLocaleString() + ' videos match'
      : hits.length.toLocaleString() + ' so far, still reading the full archive';

    var out = '<div class="sec"><h2>Search: ' + esc(q) + '</h2>';
    if (hits.length) {
      var shown = Math.min(shownHits, hits.length);
      out += '<div class="vgrid">' + hits.slice(0, shown).map(videoCard).join('') + '</div>';
      if (hits.length > shown) {
        out += '<button type="button" class="more" id="moreHits">Show ' +
          Math.min(CAP, hits.length - shown) + ' more</button>' +
          '<p class="status">Showing ' + shown.toLocaleString() + ' of ' +
          hits.length.toLocaleString() + ' matches.</p>';
      }
      if (!ready) out += '<p class="status">Still searching the rest of the archive...</p>';
    } else {
      out += '<p class="status">' +
        (ready ? 'No videos match that.' : 'Searching the whole archive...') + '</p>';
    }
    el('body').innerHTML = out + '</div>';
  }

  /* ---------------- routing ---------------- */

  function route() {
    if (!root()) return;
    if (q) return renderSearch();

    var h = location.hash;
    // A show can be opened from /videos/shows/ or from an older /videos/ link.
    // Both keep working; the hash decides, not the path.
    if (h.indexOf('#show-') === 0) {
      var id = h.slice(6);
      if (showCache[id]) return renderShow(id);
      loadShow(id);
      el('body').innerHTML = '<p class="status">Loading show...</p>';
      return;
    }
    if (view() === 'shows') return renderShows();
    if (view() === 'all') return renderAll();
    renderChooser();
  }

  /* ---------------- data ---------------- */

  async function loadShows() {
    if (shows) return;
    try {
      var r = await fetch('/api/videos?mode=shows');
      var b = await r.json();
      shows = b.shows || [];
    } catch (e) { shows = []; }
  }

  async function loadShow(id) {
    try {
      var r = await fetch('/api/videos?mode=show&id=' + encodeURIComponent(id));
      var b = await r.json();
      showCache[id] = b.videos || [];
      if (location.hash === '#show-' + id) renderShow(id);
    } catch (e) {
      el('body').innerHTML = '<p class="status">Could not load that show.</p>';
    }
  }

  async function loadPage() {
    if (busy || (stream.length && !nextPage)) return;
    busy = true;
    var btn = el('more'); if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }
    try {
      var r = await fetch('/api/videos' + (nextPage ? '?page=' + encodeURIComponent(nextPage) : ''));
      var b = await r.json();
      if (b.total) total = b.total;
      stream = stream.concat(b.videos || []);
      nextPage = b.nextPage || null;
    } catch (e) { /* leave the button re-enabled by the re-render below */ }
    busy = false;
    if (!q && location.hash.indexOf('#show-') !== 0) route();
  }

  // Called from the search box, its focus, an idle prefetch, and /videos/all
  // on entry. The guard keeps that from becoming four fetches.
  var indexBusy = false;
  async function loadIndex() {
    if (index || indexBusy) return;
    indexBusy = true;
    try {
      var r = await fetch('/api/videos?mode=index');
      index = await r.json();
    } catch (e) { index = { videos: [], count: 0 }; }
    indexBusy = false;
    // Whatever the visitor already scrolled past stays on screen when the
    // index takes over from the paged stream.
    shownAll = Math.max(shownAll, stream.length);
    if (q) shownHits = CAP;
    route();
  }

  // Fetch the index before anyone asks for it. Focus is the strongest signal
  // of intent; the idle pass covers visitors who browse first and search later.
  function prefetchIndex() {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(loadIndex, { timeout: 4000 });
    else setTimeout(loadIndex, 2500);
  }

  /* ---------------- inline playback ---------------- */

  // Teardown is explicit and never relies on the dialog's 'close' event. That
  // event was verified not to fire in at least one engine, which left the
  // iframe alive and the video audible behind a closed dialog.
  var opener = null;   // the tile that opened the lightbox

  function closeVideo() {
    var d = el('vdlg');
    if (!d) return;
    d.querySelector('.frame').innerHTML = '';   // kill the iframe first, always
    if (d.open) { try { d.close(); } catch (e) { d.removeAttribute('open'); } }
    // Return focus where it came from. Without this a keyboard user is dumped
    // at the top of a 3,000-tile page every time they close a video.
    if (opener && document.contains(opener)) { try { opener.focus(); } catch (e) {} }
    opener = null;
  }

  function dialog() {
    var d = el('vdlg');
    if (d) return d;
    d = document.createElement('dialog');
    d.id = 'vdlg';
    d.innerHTML = '<div class="frame"></div><div class="bar"><b></b>' +
      '<button type="button" class="x" data-close>Close</button></div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-close') || e.target === d) closeVideo();
    });
    // Escape reaches us as 'cancel' only while focus is outside the iframe.
    d.addEventListener('cancel', function (e) { e.preventDefault(); closeVideo(); });

    // Not the 'close' event. Measured 2026-09-11: it does not fire in this
    // engine at all, so a dialog dismissed by any native path left the iframe
    // alive and the video audible behind a closed dialog. The 'cancel' handler
    // above only covers Escape pressed while focus is outside the embed, and
    // focus moves into the embed as soon as playback starts, so the native path
    // is the common one rather than the edge case.
    //
    // Every close path in every engine removes the open attribute, so watch the
    // attribute instead of trusting an event. Re-entrant by design: closeVideo
    // calls close(), which trips this again, and the second pass is a no-op.
    if (typeof MutationObserver === 'function') {
      new MutationObserver(function () { if (!d.open) closeVideo(); })
        .observe(d, { attributes: true, attributeFilter: ['open'] });
    } else {
      d.addEventListener('close', function () { if (!d.open) closeVideo(); });
    }
    return d;
  }

  function playVideo(id, title) {
    opener = document.activeElement && document.activeElement.closest
      ? document.activeElement.closest('[data-video]') : null;
    // Never let a video and an episode talk over each other.
    if (window.TSPlayer) window.TSPlayer.pause();
    var d = dialog();
    d.querySelector('b').textContent = title || '';
    d.setAttribute('aria-label', title ? 'Video: ' + title : 'Video player');
    // www.youtube.com, not youtube-nocookie.com.
    //
    // Verified in a real browser 2026-09-01: every nocookie embed fails with
    // "This content isn't available" while the identical video on
    // www.youtube.com plays. Six different videos on one method all failed;
    // one video on four methods played only on the two youtube.com variants.
    // The Data API reports these videos embeddable, public and unrestricted,
    // so this is the privacy-enhanced domain misbehaving, not a rights
    // restriction and not a channel setting.
    //
    // Cost: nocookie defers YouTube's tracking cookies until playback starts
    // and www.youtube.com does not. Worth revisiting, but a working archive
    // beats a marginally more private broken one.
    //
    // origin must match the serving page. location.origin keeps this correct
    // wherever the site is served from.
    d.querySelector('.frame').innerHTML =
      '<iframe src="https://www.youtube.com/embed/' + encodeURIComponent(id) +
      '?autoplay=1&rel=0&playsinline=1&origin=' + encodeURIComponent(location.origin) +
      '" title="' + esc(title || 'Video') + '" allow="autoplay; fullscreen; ' +
      'encrypted-media; picture-in-picture" allowfullscreen></iframe>';
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    // The embed grabs focus, and once focus is inside a cross-origin iframe no
    // key event reaches this document, so Escape stops working. Put focus on
    // Close so the keyboard has somewhere to go before the player takes over.
    var x = d.querySelector('.x');
    if (x) x.focus();
  }

  /* ---------------- wiring ---------------- */

  function wire(r) {
    if (r.dataset.wired) return;   // never stack listeners on one root
    r.dataset.wired = '1';
    r.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'more') { loadPage(); return; }
      if (b.id === 'moreAll') { shownAll += CAP; renderAll(); return; }
      if (b.id === 'moreHits') { shownHits += CAP; renderSearch(); return; }
      if (b.id === 'back') {
        // Back always means the shows grid. On an older /videos/#show- link
        // that is a different page, so it is a real navigation there.
        if (view() === 'shows') { history.pushState({}, '', location.pathname); route(); }
        else location.href = '/videos/shows/';
        return;
      }
      if (b.dataset.yr) {
        yr = b.dataset.yr;
        shownAll = CAP;            // a new year starts at the top
        renderAll();
        return;
      }
      if (b.dataset.show) { history.pushState({}, '', '#show-' + b.dataset.show); route(); return; }
      if (b.dataset.video) {
        playVideo(b.dataset.video, b.querySelector('b') ? b.querySelector('b').textContent : '');
      }
    });

    r.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'yrpick') {
        yr = e.target.value;
        shownAll = CAP;          // a new year starts at the top
        renderAll();
      }
    });

    var input = r.querySelector('#vq'), t;
    input.addEventListener('focus', loadIndex);
    input.addEventListener('input', function () {
      // Acknowledge inside one frame. The full render stays debounced, but a
      // visitor must never type into a page that does not visibly react.
      var typed = input.value.trim();
      if (typed && typed !== q) {
        loadIndex();
        var lede = el('lede');
        if (lede) lede.textContent = 'Searching...';
      }
      clearTimeout(t);
      t = setTimeout(function () {
        var next = input.value.trim();
        if (next !== q) shownHits = CAP;   // a new query starts at the top again
        q = next;
        if (q) renderSearch(); else route();
      }, 150);
    });
  }

  var hooked = false;
  async function init() {
    var r = root(); if (!r) return;
    q = '';                    // same reason as episodes.js: the input is fresh
    yr = 'all';
    shownAll = CAP;
    shownHits = CAP;
    wire(r);
    if (!hooked) {
      hooked = true;
      window.addEventListener('hashchange', function () { if (root()) route(); });
      window.addEventListener('popstate', function () { if (root()) route(); });
    }

    var v = view();
    var needsShows = v === 'chooser' || v === 'shows' || location.hash.indexOf('#show-') === 0;

    el('body').innerHTML = '<p class="status">Loading the archive...</p>';
    if (needsShows) await loadShows();

    // The chooser needs the archive total for its tile; /all needs the stream
    // for a fast first paint while the index loads behind it.
    if ((v === 'chooser' || v === 'all') && !stream.length) await loadPage();

    route();

    if (v === 'all') loadIndex(); else prefetchIndex();
  }

  /* ---------------- shared lightbox export ---------------- */

  // The homepage video tiles and the Watch buttons on /episodes/ open this same
  // dialog. Both files were written against `window.TSVideo` and it was never
  // assigned, so every one of those buttons did nothing at all until 2026-09-10.
  // The match behind the button was fine; the button had no handler.
  //
  // One dialog for the whole site, owned here, because this is the file that
  // knows how to tear it down. Every page loads videos.js.
  window.TSVideo = { play: playVideo, close: closeVideo };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  document.addEventListener('tspage', init);
})();
