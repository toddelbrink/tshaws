/* /episodes page. Renders the list, search, season filter and deep links.
 * Owns no audio: every play button talks to the single TSPlayer instance. */
(function () {
  'use strict';

  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var LISTEN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 9a5 5 0 0 1 10 0v4h-3V9h1.5a3.5 3.5 0 0 0-7 0H6v4H3z"/></svg>';

  var data = null;            // cached across soft navigations
  var state = { q: '', season: 'all' };
  var subscribed = false;     // subscribe once, not once per soft navigation

  // Which episodes also exist as video lives in epvideo.js, shared with the
  // homepage so both surfaces answer the question identically.
  function videoFor(ep) {
    return window.TSEpVideo ? window.TSEpVideo.for(ep) : null;
  }

  // ZenCast serves the same artwork at several sizes and the feed hands us the
  // 3000x3000 "large" one, which is 470 KB. Measured 2026-09-07: a full season
  // list would pull 18.4 MB of artwork for slots no wider than 194 CSS px.
  // "medium" is 300x300 and 21 KB, so it is 1.5x density where it is biggest
  // and 22 times lighter. "thumb" exists too but is only 3.8 KB at what looks
  // like 100px, which is too soft for the episode list.
  function artSize(url) {
    return typeof url === 'string'
      ? url.replace(/(%2F|\/)large(%2F|\/)/i, '$1medium$2')
      : url;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* Who was on the episode, read from the same place /guests/ reads it, so the
   * two surfaces can never name different people. A guest with a page of their
   * own is linked to it; everyone else is plain text, which is most of them and
   * will stay that way.
   *
   * An episode with no Guest: line, or whose only named guest is the host,
   * renders nothing at all rather than an empty label. Six episodes are that
   * case today. Affiliations are deliberately left out here: the row already
   * carries a title, a date, a running time and three lines of show notes, and
   * the band names belong on /guests/ where there is a column for them. */
  function guestLine(ep) {
    var GL = window.TSGuestLine;
    if (!GL) return '';
    var names = GL.parse(ep).map(function (g) { return g.name; });
    if (!names.length) return '';
    var list = names.map(function (n) {
      var href = GL.pageFor(n);
      return href ? '<a href="' + esc(href) + '">' + esc(n) + '</a>' : esc(n);
    }).join(', ');
    return '<p class="ep-guests"><span>' + (names.length > 1 ? 'Guests' : 'Guest') +
           '</span>' + list + '</p>';
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-US',
      { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }

  // Show notes often end in a run of bare youtu.be links. Useful on the feed,
  // noise in a three-line summary.
  function snippet(ep) {
    return (ep.descriptionText || '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function matches(ep) {
    if (state.season !== 'all' && String(ep.season) !== state.season) return false;
    if (!state.q) return true;
    var q = state.q.toLowerCase();
    var s = fold(q), joined = s.replace(/ /g, '');
    // A query of only punctuation folds to nothing. Match it literally.
    if (!joined) {
      return (ep.title || '').toLowerCase().indexOf(q) > -1 ||
             (ep.descriptionText || '').toLowerCase().indexOf(q) > -1;
    }
    if (ep._fold === undefined) {
      ep._fold = fold(ep.title) + ' \n ' + fold(ep.descriptionText);
      ep._joined = fold(ep.title).replace(/ /g, '') + '\n' + fold(ep.descriptionText).replace(/ /g, '');
    }
    return ep._fold.indexOf(s) > -1 || (joined.length >= 5 && ep._joined.indexOf(joined) > -1);
  }

  // Same rules as video search (videos.js): case, accents and punctuation are
  // ignored, and from five letters up so are spaces.
  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  }

  function render(root) {
    var list = root.querySelector('#list');
    var count = root.querySelector('#count');
    var shown = data.episodes.filter(matches);

    count.textContent = shown.length === data.count
      ? data.count + ' episodes'
      : shown.length + ' of ' + data.count + ' episodes';

    if (!shown.length) {
      list.innerHTML = '<p class="status">No episodes match that search.</p>';
      return;
    }

    list.innerHTML = shown.map(function (ep) {
      var n = ep.episode ? 'Episode ' + ep.episode : '';
      var meta = [n, 'Season ' + ep.season, fmtDate(ep.published), ep.durationLabel]
        .filter(Boolean).join('  ·  ');
      return '<article class="ep" id="ep-' + esc(ep.slug || ep.guid) + '" data-guid="' + esc(ep.guid) + '">' +
        (ep.image ? '<img class="ep-art" src="' + esc(artSize(ep.image)) + '" alt="" loading="lazy" width="64" height="64">'
                  : '<div class="ep-art" aria-hidden="true"></div>') +
        '<div>' +
          '<h2>' + esc(ep.title) + '</h2>' +
          '<div class="meta">' + esc(meta) + '</div>' +
          guestLine(ep) +
          (snippet(ep) ? '<p>' + esc(snippet(ep)) + '</p>' : '') +
          // Listen and Watch as one joined control. Listen alone without a video.
          '<span class="lw"><button type="button" class="play" data-guid="' + esc(ep.guid) + '" aria-pressed="false">' +
            LISTEN + '<span class="verb">Listen</span>' +
            '<span class="sr-only"> ' + esc(ep.title) + '</span></button>' +
          (videoFor(ep)
            ? '<button type="button" class="play watch" data-video="' + esc(videoFor(ep).id) + '">' + PLAY +
              'Watch<span class="sr-only"> ' + esc(ep.title) + ' on video</span></button>'
            : '') + '</span>' +
          '<div class="rowbar"><i></i></div>' +
        '</div></article>';
    }).join('');

    sync(root);
  }

  // Reflect player state onto the rows. One subscription, not one per row.
  function sync(root, snap) {
    snap = snap || { guid: null, playing: false, position: 0, duration: 0 };
    root.querySelectorAll('.ep').forEach(function (row) {
      var isCur = row.dataset.guid === snap.guid;
      row.setAttribute('data-current', isCur ? 'true' : 'false');
      var btn = row.querySelector('.play');
      var playing = isCur && snap.playing;
      btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      // "Resume" only means something if there is a position to resume from.
      btn.querySelector('.verb').textContent =
        playing ? 'Pause' : (isCur && snap.position > 1 ? 'Resume' : 'Listen');
      if (isCur && snap.duration) {
        row.querySelector('.rowbar i').style.width =
          ((snap.position / snap.duration) * 100).toFixed(2) + '%';
      }
    });
  }

  function wire(root) {
    root.addEventListener('click', function (e) {
      var w = e.target.closest('[data-video]');
      if (w && window.TSVideo) {
        var row = w.closest('.ep');
        var epv = row && data.episodes.find(function (x) { return x.guid === row.dataset.guid; });
        window.TSVideo.play(w.dataset.video, epv ? epv.title : '');
        return;
      }
      var b = e.target.closest('.play');
      if (!b || !b.dataset.guid) return;
      var ep = data.episodes.find(function (x) { return x.guid === b.dataset.guid; });
      if (ep) window.TSPlayer.toggle(ep);
    });

    var search = root.querySelector('#q');
    var t;
    search.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () { state.q = search.value.trim(); render(root); }, 140);
    });

    root.querySelector('.seasons').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-season]');
      if (!b) return;
      state.season = b.dataset.season;
      root.querySelectorAll('.seasons button').forEach(function (x) {
        x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      });
      // Drop a stale #season-N so the URL never contradicts the buttons.
      if (/^#season-\d+$/.test(location.hash) && window.history && history.replaceState) {
        history.replaceState(history.state, '', location.pathname + location.search);
      }
      render(root);
    });
  }

  // A shared link like /episodes/#ep-season-4-wrap-up loads that episode into
  // the bar, paused. No autoplay: there has been no user gesture yet.
  //
  // The deep link outranks a session restored from sessionStorage. Someone who
  // clicked a link to a specific episode should find that episode in the bar,
  // not whatever they half-listened to earlier. The one thing it must never do
  // is interrupt audio that is actually playing, which is the soft-navigation
  // case, so a live playback always wins.
  // /episodes/#season-4 arrives from the season menu in the nav. The season
  // list is derived from the feed, so an unknown number is ignored rather than
  // filtering the page down to nothing.
  function applySeasonHash(root) {
    var m = /^#season-(\d+)$/.exec(location.hash);
    var want = m && data && data.seasons.indexOf(parseInt(m[1], 10)) > -1 ? m[1] : 'all';
    if (state.season === want) return false;
    state.season = want;
    root.querySelectorAll('.seasons button').forEach(function (x) {
      x.setAttribute('aria-pressed', x.dataset.season === want ? 'true' : 'false');
    });
    return true;
  }

  function openHash(root) {
    var h = location.hash;
    if (!h || h.indexOf('#ep-') !== 0) return;
    var row = root.querySelector('#' + (window.CSS && CSS.escape ? CSS.escape(h.slice(1)) : h.slice(1)));
    if (!row) return;
    var cur = window.TSPlayer.current();
    var busy = cur && window.TSPlayer.isPlaying(cur.guid);
    var ep = data.episodes.find(function (x) { return x.guid === row.dataset.guid; });
    if (ep && !busy && (!cur || cur.guid !== ep.guid)) {
      window.TSPlayer.load(ep, { autoplay: false });
    }
    row.scrollIntoView({ block: 'center' });
  }

  async function init() {
    var root = document.getElementById('episodes');
    if (!root) return;        // soft-navigated away; the subscriber no-ops

    var status = root.querySelector('#count');
    try {
      if (!data) {
        status.textContent = 'Loading episodes...';
        var r = await fetch('/api/episodes');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        data = await r.json();
      }
    } catch (e) {
      // The reason goes to the console, not the page. A visitor cannot act on
      // an HTTP status, and a Loading line left above the message contradicts it.
      console.error('episodes:', e);
      status.textContent = '';
      root.querySelector('#list').innerHTML =
        '<p class="status">Could not load episodes right now. Please try again in a moment.</p>';
      return;
    }

    // Controls are rebuilt empty on every entry, so the filter state that
    // survived at module scope has to be reset to match, or the UI shows "All"
    // while a season filter is still applied.
    state.q = ''; state.season = 'all';
    var sel = root.querySelector('.seasons');
    sel.innerHTML = '<button data-season="all" aria-pressed="true">All</button>' +
      data.seasons.map(function (s) {
        // Two labels, one shown at a time. "Season 4" reads plainly where
        // there is room; "S04" keeps the row from wrapping on a phone, and
        // keeps doing so as Trevor adds seasons. The aria-label says the long
        // form either way, so a screen reader never hears "S04".
        return '<button data-season="' + s + '" aria-pressed="false" aria-label="Season ' + s + '">' +
          '<span class="lbl-long">Season ' + s + '</span>' +
          '<span class="lbl-short">S' + String(s).padStart(2, '0') + '</span></button>';
      }).join('');

    wire(root);
    applySeasonHash(root);
    render(root);
    openHash(root);

    // Episodes render immediately; the Watch affordance arrives a beat later
    // and re-renders. Listening must never wait on the YouTube round trip.
    if (window.TSEpVideo) {
      window.TSEpVideo.load(data.episodes).then(function () {
        var r = document.getElementById('episodes');
        if (r && window.TSEpVideo.count()) render(r);
      });
    }

    if (!subscribed) {
      subscribed = true;
      window.TSPlayer.subscribe(function (snap) {
        var r = document.getElementById('episodes');
        if (r) sync(r, snap);   // silently does nothing on other pages
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  document.addEventListener('tspage', init);

  // Changing only the hash fires no navigation and no 'tspage', so a deep link
  // followed while already on this page would otherwise do nothing at all.
  window.addEventListener('hashchange', function () {
    var root = document.getElementById('episodes');
    if (!root || !data) return;
    if (applySeasonHash(root)) render(root);
    openHash(root);
  });
})();
