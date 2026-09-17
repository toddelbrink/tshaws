/* Single site-wide audio player.
 *
 * One audio element for the whole site, controlled by a small state module.
 * Never a player per episode row, which is the most common way this pattern
 * goes wrong.
 *
 * Exposes window.TSPlayer. Survives soft navigation because nav.js never
 * replaces this element or this script.
 */
window.TSPlayer = (function () {
  'use strict';

  var KEY = 'tshaws.player.v1';
  var audio = new Audio();
  audio.preload = 'metadata';
  // No crossOrigin. The enclosure 302 sends no CORS headers, so requesting
  // CORS mode would break playback outright.

  var current = null;          // the episode object now loaded
  var listeners = [];
  var saveAt = 0;

  function fmt(s) {
    if (!isFinite(s) || s < 0) s = 0;
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
    return h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0')
                 : m + ':' + String(x).padStart(2, '0');
  }

  function emit() {
    var snap = {
      guid: current && current.guid,
      playing: !!current && !audio.paused && !audio.ended,
      position: audio.currentTime || 0,
      duration: audio.duration || (current && current.duration) || 0
    };
    listeners.forEach(function (fn) { try { fn(snap); } catch (e) {} });
  }

  function save() {
    if (!current) return;
    try {
      sessionStorage.setItem(KEY, JSON.stringify({
        ep: current, position: audio.currentTime || 0, playing: !audio.paused
      }));
    } catch (e) { /* private mode, quota. Never break playback over storage. */ }
  }

  function restore() {
    try {
      var raw = sessionStorage.getItem(KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      return s && s.ep && s.ep.audioUrl ? s : null;
    } catch (e) { return null; }
  }

  /* ---------- the docked bar ---------- */

  var el = {};
  function build() {
    var bar = document.createElement('div');
    bar.id = 'player';
    bar.setAttribute('data-active', 'false');
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Audio player');
    bar.innerHTML =
      '<input class="seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Seek">' +
      '<div class="inner">' +
        '<img alt="" hidden>' +
        '<button type="button" class="sm hide-sm" data-act="back" aria-label="Back 15 seconds">15</button>' +
        '<button type="button" class="pp" data-act="toggle" aria-label="Play" aria-pressed="false">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg></button>' +
        '<button type="button" class="sm hide-sm" data-act="fwd" aria-label="Forward 30 seconds">30</button>' +
        '<div class="txt"><b></b><span></span></div>' +
        '<button type="button" class="close" data-act="close" aria-label="Close player">&times;</button>' +
      '</div>';
    document.body.appendChild(bar);

    el.bar = bar;
    el.seek = bar.querySelector('.seek');
    el.img = bar.querySelector('img');
    el.pp = bar.querySelector('.pp');
    el.title = bar.querySelector('.txt b');
    el.sub = bar.querySelector('.txt span');

    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var a = b.getAttribute('data-act');
      if (a === 'toggle') toggle();
      else if (a === 'back') audio.currentTime = Math.max(0, audio.currentTime - 15);
      else if (a === 'fwd') audio.currentTime = Math.min(audio.duration || 1e9, audio.currentTime + 30);
      else if (a === 'close') close();
    });

    // Dragging the range seeks live. Without a duration yet, ignore it.
    var scrubbing = false;
    el.seek.addEventListener('input', function () {
      if (!audio.duration) return;
      scrubbing = true;
      audio.currentTime = (el.seek.value / 1000) * audio.duration;
    });
    el.seek.addEventListener('change', function () { scrubbing = false; });
  }

  var PLAY = 'M8 5v14l11-7z';
  var PAUSE = 'M6 5h4v14H6zM14 5h4v14h-4z';

  function paint() {
    if (!el.bar) return;
    var playing = !audio.paused && !audio.ended && !!current;
    el.pp.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    el.pp.setAttribute('aria-pressed', playing ? 'true' : 'false');
    el.pp.querySelector('path').setAttribute('d', playing ? PAUSE : PLAY);
    if (current) {
      el.title.textContent = current.title || '';
      var n = current.episode ? 'Episode ' + current.episode : '';
      var d = audio.duration || current.duration || 0;
      el.sub.textContent = [n, fmt(audio.currentTime || 0) + ' / ' + fmt(d)]
        .filter(Boolean).join('  ·  ');
      if (current.image) { el.img.src = current.image; el.img.hidden = false; }
      else { el.img.hidden = true; }
      var d2 = audio.duration;
      if (d2) el.seek.value = Math.round((audio.currentTime / d2) * 1000);
      el.seek.setAttribute('aria-valuetext', fmt(audio.currentTime) + ' of ' + fmt(d2 || 0));
    }
  }

  function mediaSession() {
    if (!('mediaSession' in navigator) || !current) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title || '',
        artist: "T Shaw's Progressive Bluegrass",
        artwork: current.image ? [{ src: current.image, sizes: '512x512', type: 'image/jpeg' }] : []
      });
      navigator.mediaSession.setActionHandler('play', function () { play(); });
      navigator.mediaSession.setActionHandler('pause', function () { audio.pause(); });
      navigator.mediaSession.setActionHandler('seekbackward', function () {
        audio.currentTime = Math.max(0, audio.currentTime - 15); });
      navigator.mediaSession.setActionHandler('seekforward', function () {
        audio.currentTime = Math.min(audio.duration || 1e9, audio.currentTime + 30); });
    } catch (e) {}
  }

  /* ---------- api ---------- */

  function load(ep, opts) {
    opts = opts || {};
    if (!ep || !ep.audioUrl) return;
    var same = current && current.guid === ep.guid;
    if (!same) {
      current = ep;
      audio.src = ep.audioUrl;   // ?source=feed intact: Trevor keeps the download credit
      if (opts.position) audio.currentTime = opts.position;
      else audio.currentTime = 0;
      mediaSession();
    }
    if (el.bar) el.bar.setAttribute('data-active', 'true');
    document.body.classList.add('has-player');
    if (opts.autoplay !== false) play();
    paint(); emit(); save();
  }

  function play() {
    var p = audio.play();
    // Autoplay rejection is normal after a cold navigation. Stay silent and
    // leave the bar in a paused state the visitor can press.
    if (p && p.catch) p.catch(function () { paint(); emit(); });
  }

  function toggle(ep) {
    if (ep && (!current || current.guid !== ep.guid)) { load(ep); return; }
    if (!current) return;
    if (audio.paused) play(); else audio.pause();
  }

  function close() {
    audio.pause(); audio.removeAttribute('src'); audio.load();
    current = null;
    if (el.bar) el.bar.setAttribute('data-active', 'false');
    document.body.classList.remove('has-player');
    try { sessionStorage.removeItem(KEY); } catch (e) {}
    emit();
  }

  ['play', 'pause', 'ended'].forEach(function (ev) {
    audio.addEventListener(ev, function () { paint(); emit(); save(); });
  });
  audio.addEventListener('loadedmetadata', function () { paint(); emit(); });
  audio.addEventListener('timeupdate', function () {
    paint(); emit();
    var now = Date.now();
    if (now - saveAt > 4000) { saveAt = now; save(); }
  });
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });

  function init() {
    if (!el.bar) build();
    var s = restore();
    if (s) {
      // State is restored paused. Browsers block autoplay on a cold load and
      // starting audio unbidden would be rude anyway. Soft navigation never
      // reaches here, so it never interrupts playback.
      load(s.ep, { position: s.position, autoplay: false });
      audio.currentTime = s.position || 0;
      paint();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return {
    load: load,
    toggle: toggle,
    close: close,
    // Video playback calls this. Two things talking at once is never wanted.
    pause: function () { if (!audio.paused) audio.pause(); },
    current: function () { return current; },
    isPlaying: function (guid) {
      return !!current && current.guid === guid && !audio.paused && !audio.ended;
    },
    subscribe: function (fn) { listeners.push(fn); fn({
      guid: current && current.guid, playing: false,
      position: audio.currentTime || 0, duration: audio.duration || 0 }); },
    format: fmt
  };
})();
