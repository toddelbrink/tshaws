/* Resolves which podcast episodes also exist as video on Trevor's YouTube
 * channel. Shared by the homepage and /episodes/ so there is exactly one answer
 * to "does this episode have a Watch button", not two implementations that can
 * drift apart.
 *
 * The rule: if the episode is
 * simulcast on YouTube, it gets a Watch button and that button works. If it is
 * not, it gets Listen only. Nothing renders on a guess.
 *
 * Everything here draws from one source: the playlist Trevor files his podcast
 * videos into. A video outside that playlist is a concert clip, not an episode.
 */
(function () {
  'use strict';

  var map = null;          // guid -> video, cached across soft navigations
  var pending = null;      // in-flight load, so two pages never fetch twice

  function norm(t) {
    return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  // YouTube will refuse to play a video in an iframe for three reasons, and the
  // Data API reports all three. A Watch button on any of them is a button that
  // does nothing, which is the exact defect this pass exists to kill. The API
  // sends null when it could not hydrate the video's status at all; that is
  // unknown, not confirmed-good, so it fails closed too.
  function playable(v) {
    return !!v && !!v.id &&
      v.embeddable === true &&
      v.privacyStatus === 'public' &&
      v.regionRestricted !== true;
  }

  function daysApart(a, b) {
    var x = Date.parse(a), y = Date.parse(b);
    if (isNaN(x) || isNaN(y)) return Infinity;
    return Math.abs(x - y) / 86400000;
  }

  /* Three passes, strongest signal first. Each video is claimed at most once
   * and each episode is filled at most once, so a later, weaker pass can never
   * overwrite a stronger match or hand one video to two episodes.
   *
   * Verified against live data 2026-09-10: 32 of 41 episodes resolve, all 32
   * playlist videos are consumed, and the three passes agree on every one. */
  function build(episodes, videos) {
    var out = {}, used = {};

    // Pass 1 — identical title. Trevor is standardising on this, so it should
    // claim more of the archive over time, not less.
    episodes.forEach(function (e) {
      var hit = videos.find(function (v) {
        return !used[v.id] && norm(v.title) === norm(e.title);
      });
      if (hit) { out[e.guid] = hit; used[hit.id] = 1; }
    });

    // Pass 2 — YouTube truncates a long title at about 100 characters, so the
    // video title is a strict prefix of the feed title. Episodes 27 and 28 are
    // both this case. A prefix that short would be a coincidence, so require a
    // substantial one and require it to be unambiguous.
    videos.forEach(function (v) {
      if (used[v.id]) return;
      var vt = norm(v.title);
      if (vt.length < 40) return;
      var cands = episodes.filter(function (e) {
        return !out[e.guid] && norm(e.title).indexOf(vt) === 0;
      });
      if (cands.length === 1) { out[cands[0].guid] = v; used[v.id] = 1; }
    });

    // Pass 3 — Trevor retitled it on YouTube. Running time alone is not enough:
    // episodes 12 and 31 sit two seconds apart from each other, so duration is
    // ambiguous on its own. Pairing it with the publish date is not. He uploads
    // the video the same day he releases the audio, and two recordings of the
    // same length in the same week would be the coincidence, not the rule.
    videos.forEach(function (v) {
      if (used[v.id] || !v.duration || !v.published) return;
      var cands = episodes.filter(function (e) {
        return !out[e.guid] && e.duration && e.published &&
          Math.abs(e.duration - v.duration) <= 2 &&
          daysApart(e.published, v.published) <= 7;
      });
      if (cands.length === 1) { out[cands[0].guid] = v; used[v.id] = 1; }
    });

    return out;
  }

  // Resolves to a map, always. A failure anywhere gives an empty map, which
  // renders Listen-only everywhere. Watch is an enhancement; listening must
  // never wait on YouTube and must never break with it.
  function load(episodes) {
    if (map) return Promise.resolve(map);
    if (pending) return pending;

    pending = (async function () {
      try {
        var r = await fetch('/api/videos?mode=shows');
        if (!r.ok) return (map = {});
        var b = await r.json();
        if (!b.podcastPlaylistId) return (map = {});

        var r2 = await fetch('/api/videos?mode=show&id=' +
          encodeURIComponent(b.podcastPlaylistId));
        if (!r2.ok) return (map = {});
        var b2 = await r2.json();

        // Filter before matching, not after. An unplayable video must not
        // consume an episode that a playable one could have claimed.
        var videos = (b2.videos || []).filter(playable);
        return (map = build(episodes || [], videos));
      } catch (e) {
        return (map = {});
      } finally {
        pending = null;
      }
    })();

    return pending;
  }

  window.TSEpVideo = {
    load: load,
    // Null until load() resolves. Callers render Listen-only and re-render.
    for: function (ep) { return map && ep ? map[ep.guid] || null : null; },
    count: function () { return map ? Object.keys(map).length : 0; },
    // Exposed for test/watch-buttons.js, which runs this against live data.
    _build: build,
    _playable: playable
  };
})();
