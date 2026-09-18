/* Homepage. Pulls the latest episode, three more, today's featured video and
 * the newest videos.
 * Owns no audio and no video: it hands off to TSPlayer and to the shared
 * lightbox that videos.js installs. */
(function () {
  'use strict';

  var eps = null, vids = null, feat = null, subscribed = false;

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
  function gridThumb(url) {
    return typeof url === 'string' ? url.replace(/\/(maxres|sd|mq)default\.jpg/, '/hqdefault.jpg') : url;
  }

  function nice(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-US',
      { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }
  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

  // Which episodes also exist as video lives in epvideo.js, shared with
  // /episodes/ so both surfaces answer the question identically. Null until it
  // resolves, so the first paint is Listen-only and a re-render fills it in.
  function videoFor(ep) {
    return window.TSEpVideo ? window.TSEpVideo.for(ep) : null;
  }

  // data-eptitle rather than reading the title back out of the DOM. The feature
  // block has no element carrying the guid, and the lightbox caption should say
  // the episode's name, not the video's.
  function watchBtn(ep) {
    var v = videoFor(ep);
    return v ? '<button type="button" class="play watch" data-video="' + esc(v.id) +
      '" data-eptitle="' + esc(ep.title) + '">' +
      'Watch<span class="sr-only"> ' + esc(ep.title) + ' on video</span></button>' : '';
  }

  function desc(ep) {
    return (ep.descriptionText || '').replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim();
  }

  function metaLine(ep) {
    return [ep.episode ? 'Episode ' + ep.episode : '', 'Season ' + ep.season,
            nice(ep.published), ep.durationLabel].filter(Boolean).join('  ·  ');
  }

  function renderLatest(root) {
    var ep = eps.episodes[0];
    root.querySelector('#latest').innerHTML =
      (ep.image ? '<img class="art" src="' + esc(artSize(ep.image)) + '" alt="" width="236" height="236">' : '<div></div>') +
      '<div>' +
        '<p class="meta">' + esc(metaLine(ep)) + '</p>' +
        '<h2>' + esc(ep.title) + '</h2>' +
        (desc(ep) ? '<p class="desc">' + esc(desc(ep)) + '</p>' : '') +
        '<div class="row">' +
          '<button type="button" class="play" data-guid="' + esc(ep.guid) + '" aria-pressed="false">' +
            PLAY + '<span class="verb">Play</span>' +
            '<span class="sr-only"> ' + esc(ep.title) + '</span></button>' +
          watchBtn(ep) +
          '<a class="btn" href="/episodes/#ep-' + esc(ep.slug || ep.guid) + '">Episode page</a>' +
        '</div>' +
        '<div class="rowbar"><i></i></div>' +
      '</div>';
  }

  function renderRecent(root) {
    root.querySelector('#recent').innerHTML = eps.episodes.slice(1, 4).map(function (ep) {
      return '<article class="ep" data-guid="' + esc(ep.guid) + '">' +
        (ep.image ? '<img class="ep-art" src="' + esc(artSize(ep.image)) + '" alt="" loading="lazy" width="66" height="66">'
                  : '<div class="ep-art"></div>') +
        '<div><h3>' + esc(ep.title) + '</h3>' +
        '<p class="meta">' + esc(metaLine(ep)) + '</p>' +
        '<button type="button" class="play" data-guid="' + esc(ep.guid) + '" aria-pressed="false">' +
          PLAY + '<span class="verb">Play</span>' +
          '<span class="sr-only"> ' + esc(ep.title) + '</span></button>' +
        watchBtn(ep) +
        '<div class="rowbar"><i></i></div></div></article>';
    }).join('');
  }

  function renderVideos(root) {
    if (!vids) return;
    if (vids.total) {
      root.querySelector('#vcount').textContent =
        vids.total.toLocaleString() + ' videos in the archive';
    }
    root.querySelector('#latestvids').innerHTML = vids.videos.slice(0, 6).map(function (v) {
      return '<button type="button" class="vcard" data-video="' + esc(v.id) + '">' +
        '<span class="shot"><img loading="lazy" decoding="async" alt="" src="' +
          esc(v.thumbnail ? gridThumb(v.thumbnail.url) : '') + '">' +
          (v.durationLabel ? '<span class="dur">' + esc(v.durationLabel) + '</span>' : '') +
        '</span><b>' + esc(v.title) + '</b>' +
        '<span>' + esc(nice(v.published)) + '</span></button>';
    }).join('');
  }

  // Today's featured video. The server picks it, so every visitor sees the
  // same one. A click hands off to the shared lightbox like every other video.
  function renderFeatured(root) {
    var box = root.querySelector('#featured');
    if (!box) return;
    if (!feat || !feat.video) {
      box.closest('section').hidden = true;   // no dead frame if the pick failed
      return;
    }
    var v = feat.video;
    var thumb = v.thumbnail ? v.thumbnail.url : 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg';
    box.innerHTML =
      '<button type="button" class="fshot" data-video="' + esc(v.id) + '" data-eptitle="' + esc(v.title) + '">' +
        '<img src="' + esc(thumb) + '" alt="" decoding="async">' +
        '<span class="fplay">' + PLAY + '</span>' +
        (v.durationLabel ? '<span class="dur">' + esc(v.durationLabel) + '</span>' : '') +
        '<span class="sr-only">Play ' + esc(v.title) + '</span>' +
      '</button>' +
      '<div class="fcap"><h2>' + esc(v.title) + '</h2>' +
        '<p class="meta">' + esc(nice(v.published)) + '</p>' +
        (feat.caption ? '<p class="note">' + esc(feat.caption) + '</p>' : '') +
      '</div>';
  }

  // One subscription for the whole page, matching the episodes page pattern.
  function sync(root, snap) {
    snap = snap || { guid: null, playing: false, position: 0, duration: 0 };
    root.querySelectorAll('[data-guid]').forEach(function (node) {
      var isCur = node.dataset.guid === snap.guid;
      var btn = node.matches('.play') ? node : node.querySelector('.play');
      if (!btn) return;
      var host = node.closest('.ep') || node.closest('#latest') || node.parentElement;
      if (host && host.classList) host.setAttribute('data-current', isCur ? 'true' : 'false');
      var playing = isCur && snap.playing;
      btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      var verb = btn.querySelector('.verb');
      if (verb) verb.textContent = playing ? 'Pause' : (isCur && snap.position > 1 ? 'Resume' : 'Play');
      var bar = host && host.querySelector ? host.querySelector('.rowbar i') : null;
      if (bar && isCur && snap.duration) {
        bar.style.width = ((snap.position / snap.duration) * 100).toFixed(2) + '%';
      }
    });
  }

  async function init() {
    var root = document.getElementById('home');
    if (!root) return;

    if (!root.dataset.wired) {
      root.dataset.wired = '1';
      root.addEventListener('click', function (e) {
        // Video first. A Watch button carries both .play and [data-video], so
        // testing .play first would swallow it: it has no data-guid, the
        // episode lookup fails, and the handler returns before the video
        // branch is ever reached. /episodes/ orders these the same way.
        var v = e.target.closest('[data-video]');
        if (v && window.TSVideo) {
          var label = v.dataset.eptitle ||
            (v.querySelector('b') ? v.querySelector('b').textContent : '');
          window.TSVideo.play(v.dataset.video, label);
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
      renderLatest(root); renderRecent(root);

      // Episodes paint immediately; the Watch affordance arrives a beat later
      // and re-renders. Listening must never wait on the YouTube round trip.
      if (window.TSEpVideo) {
        window.TSEpVideo.load(eps.episodes).then(function () {
          var h = document.getElementById('home');
          if (h && window.TSEpVideo.count()) { renderLatest(h); renderRecent(h); sync(h); }
        });
      }
    } catch (e) {
      root.querySelector('#latest').innerHTML =
        '<p class="status">Could not load episodes right now.</p>';
    }

    // Its own request, so a slow pick never holds up the episode or the grid.
    (async function () {
      try {
        if (!feat) {
          var rf = await fetch('/api/videos?mode=featured');
          feat = rf.ok ? await rf.json() : { video: null };
        }
      } catch (e) { feat = { video: null }; }
      var hf = document.getElementById('home');
      if (hf) renderFeatured(hf);
    })();

    try {
      if (!vids) {
        var r2 = await fetch('/api/videos');
        if (r2.ok) vids = await r2.json();
      }
      renderVideos(root);
    } catch (e) { /* the section simply stays empty */ }

    if (!subscribed) {
      subscribed = true;
      window.TSPlayer.subscribe(function (snap) {
        var h = document.getElementById('home');
        if (h) sync(h, snap);
      });
    }
    sync(root);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  document.addEventListener('tspage', init);
})();
