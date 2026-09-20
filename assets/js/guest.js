/* A guest page, /guests/<slug>/.
 *
 * The page's words are in its markup. This file adds only the parts that must
 * never be typed by hand: each episode's artwork, date, running time and the
 * Listen and Watch controls.
 *
 * Episodes are matched on season and episode number, never on title text.
 * Trevor retitles episodes on YouTube and occasionally in the feed, and a page
 * that matched on the title would quietly lose its player the day he did. The
 * numbers do not move.
 *
 * Owns no audio and no video. It hands off to TSPlayer and to the shared
 * lightbox that videos.js installs, exactly as the homepage and /episodes/ do,
 * so a guest page behaves like every other surface on the site.
 */
(function () {
  'use strict';

  var eps = null;            // cached across soft navigations
  var subscribed = false;

  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var LISTEN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 9a5 5 0 0 1 10 0v4h-3V9h1.5a3.5 3.5 0 0 0-7 0H6v4H3z"/></svg>';
  var ARROW = '<svg class="arr" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 7h9.2L7.6 3.4 9 2l6 6-6 6-1.4-1.4L11.2 9H2z"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ZenCast hands us the 3000x3000 "large" artwork, 470 KB, for a 116px slot.
  // "medium" is 300x300 and 21 KB. Same swap the homepage and /episodes/ make.
  function artSize(url) {
    return typeof url === 'string'
      ? url.replace(/(%2F|\/)large(%2F|\/)/i, '$1medium$2')
      : url;
  }

  function nice(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-US',
      { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }

  function videoFor(ep) {
    return window.TSEpVideo ? window.TSEpVideo.for(ep) : null;
  }

  function watchBtn(ep) {
    var v = videoFor(ep);
    return v ? '<button type="button" class="play watch" data-video="' + esc(v.id) +
      '" data-eptitle="' + esc(ep.title) + '">' + PLAY +
      'Watch<span class="sr-only"> ' + esc(ep.title) + ' on video</span></button>' : '';
  }

  function listenWatch(ep) {
    return '<span class="lw">' +
      '<button type="button" class="play" data-guid="' + esc(ep.guid) + '" aria-pressed="false">' +
        LISTEN + '<span class="verb">Listen</span>' +
        '<span class="sr-only"> ' + esc(ep.title) + '</span></button>' +
      watchBtn(ep) + '</span>';
  }

  /* The feed returns season and episode as strings, so both sides are coerced.
   * A number typed into the markup that matches nothing leaves the row exactly
   * as it shipped: the written sentence, no player. That is the right failure.
   * A row that cannot be matched must never invent an episode. */
  function find(season, episode) {
    if (!eps || !eps.episodes) return null;
    return eps.episodes.find(function (e) {
      return String(e.season) === String(season) &&
             String(e.episode) === String(episode);
    }) || null;
  }

  function metaLine(ep) {
    return ['Season ' + ep.season, nice(ep.published), ep.durationLabel]
      .filter(Boolean).join('  ·  ');
  }

  function fill(row) {
    var ep = find(row.dataset.season, row.dataset.episode);
    if (!ep) return;

    var art = row.querySelector('.gep-art');
    if (art && ep.image) {
      art.src = artSize(ep.image);
      art.classList.remove('ph');
      art.loading = 'lazy';
      art.decoding = 'async';
    }

    var body = row.querySelector('div');
    if (!body) return;

    // Rebuilt wholesale on every pass, so the second render (once the Watch
    // answer arrives) cannot stack two players on one row.
    var old = body.querySelector('.gep-live');
    if (old) old.remove();

    var live = document.createElement('div');
    live.className = 'gep-live';
    live.innerHTML =
      '<p class="meta">' + esc(metaLine(ep)) + '</p>' +
      '<div class="row">' + listenWatch(ep) +
        '<a class="mlink" href="/episodes/#ep-' + esc(ep.slug || ep.guid) + '">Episode page' + ARROW + '</a>' +
      '</div>' +
      '<div class="rowbar"><i></i></div>';
    body.appendChild(live);
  }

  function render(root) {
    root.querySelectorAll('.gep[data-season][data-episode]').forEach(fill);
  }

  // One subscription for the page, matching the homepage and /episodes/.
  function sync(root, snap) {
    snap = snap || { guid: null, playing: false, position: 0, duration: 0 };
    root.querySelectorAll('.gep [data-guid]').forEach(function (btn) {
      var isCur = btn.dataset.guid === snap.guid;
      var host = btn.closest('.gep');
      if (host) host.setAttribute('data-current', isCur ? 'true' : 'false');
      var playing = isCur && snap.playing;
      btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      var verb = btn.querySelector('.verb');
      if (verb) verb.textContent = playing ? 'Pause' : (isCur && snap.position > 1 ? 'Resume' : 'Listen');
      var bar = host && host.querySelector('.rowbar i');
      if (bar && isCur && snap.duration) {
        bar.style.width = ((snap.position / snap.duration) * 100).toFixed(2) + '%';
      }
    });
  }

  async function init() {
    var root = document.getElementById('guestpage');
    // Every page loads every script, so this one no-ops everywhere else.
    if (!root) return;

    if (!root.dataset.wired) {
      root.dataset.wired = '1';
      root.addEventListener('click', function (e) {
        // Video first. A Watch button carries both .play and [data-video], so
        // testing .play first would swallow it. /episodes/ and the homepage
        // order these the same way.
        var v = e.target.closest('[data-video]');
        if (v && window.TSVideo) {
          window.TSVideo.play(v.dataset.video, v.dataset.eptitle || '');
          return;
        }
        var b = e.target.closest('.play');
        if (b) {
          var ep = eps && eps.episodes.find(function (x) { return x.guid === b.dataset.guid; });
          if (ep) window.TSPlayer.toggle(ep);
        }
      });
    }

    try {
      if (!eps) {
        var r = await fetch('/api/episodes');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        eps = await r.json();
      }
      render(root);

      // The rows paint immediately; the Watch affordance arrives a beat later
      // and re-renders. Listening must never wait on the YouTube round trip.
      if (window.TSEpVideo) {
        window.TSEpVideo.load(eps.episodes).then(function () {
          var g = document.getElementById('guestpage');
          if (g && window.TSEpVideo.count()) { render(g); sync(g); }
        });
      }
    } catch (e) {
      // The written sentence under each episode is the content; the player is
      // the enhancement. A failed feed leaves the page reading correctly.
      return;
    }

    if (!subscribed) {
      subscribed = true;
      window.TSPlayer.subscribe(function (snap) {
        var g = document.getElementById('guestpage');
        if (g) sync(g, snap);
      });
    }
    sync(root);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  document.addEventListener('tspage', init);
})();
