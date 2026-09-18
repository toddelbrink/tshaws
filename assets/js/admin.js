/* The admin page. Talks to /api/admin and to /api/videos?mode=refresh.
 * The login cookie is HttpOnly, so this script never sees it. It asks the
 * server whether it is logged in. */
(function () {
  'use strict';

  var settings = null, polishReady = false, index = null, findTarget = null;
  var chosen = { pick: null, override: null };   // looked-up videos, by slot

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function say(id, text, bad) { var el = $(id); el.textContent = text || ''; el.classList.toggle('bad', !!bad); }

  async function api(body) {
    var r = await fetch('/api/admin', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    var data = await r.json().catch(function () { return {}; });
    if (r.status === 401 && body.action !== 'login') { showLogin('You were logged out. Please log in again.'); }
    return { ok: r.ok, status: r.status, data: data };
  }

  // datetime-local speaks the device's local time with no zone. Convert both ways.
  function toLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fromLocalInput(v) { return v ? new Date(v).toISOString() : null; }
  function when(iso) {
    return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function videoCard(v, extra) {
    if (!v) return '';
    var thumb = v.thumbnail ? v.thumbnail.url : 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg';
    return '<img src="' + esc(thumb) + '" alt="" loading="lazy">' +
      '<div><b>' + esc(v.title) + '</b><span class="meta">' +
      esc([v.durationLabel, v.privacy === 'unlisted' ? 'Unlisted' : '', extra].filter(Boolean).join('  ·  ')) +
      '</span></div>';
  }

  function showLogin(msg) {
    $('boot').hidden = true; $('panel').hidden = true; $('login').hidden = false;
    say('loginmsg', msg || '', !!msg);
    $('pw').focus();
  }

  function fillForm() {
    $('random').checked = settings.random !== false;
    $('pinbox').hidden = $('random').checked;
    chosen.pick = settings.pick ? settings.pick.video : null;
    $('picklink').value = chosen.pick ? 'https://youtu.be/' + chosen.pick.id : '';
    $('pickcap').value = settings.pick && settings.pick.caption || '';
    $('pickpreview').innerHTML = videoCard(chosen.pick);
    var o = settings.override;
    chosen.override = o ? o.video : null;
    $('ovlink').value = o ? 'https://youtu.be/' + o.video.id : '';
    $('ovcap').value = o && o.caption || '';
    $('ovpreview').innerHTML = videoCard(chosen.override);
    var now = Date.now();
    $('ovstart').value = toLocalInput(o ? o.start : new Date(now).toISOString());
    $('ovend').value = toLocalInput(o ? o.end : new Date(now + 48 * 3600e3).toISOString());
    document.querySelectorAll('[data-polish]').forEach(function (b) { b.hidden = !polishReady; });
  }

  async function showNow() {
    var box = $('now');
    try {
      // A unique query skips the edge cache, so this is what a visitor gets next.
      var r = await fetch('/api/videos?mode=featured&admin=' + Date.now());
      var f = await r.json();
      var why = f.source === 'override' ? 'Scheduled, until ' + when(f.until)
              : f.source === 'pinned' ? 'Your pick, until you switch random back on'
              : 'Random video of the day';
      box.innerHTML = videoCard(f.video, why) + (f.caption ? '<p class="note">' + esc(f.caption) + '</p>' : '');
    } catch (e) { box.innerHTML = '<p class="status">Could not load it right now.</p>'; }
  }

  async function boot() {
    var r = await fetch('/api/admin', { credentials: 'same-origin' });
    var d = await r.json().catch(function () { return {}; });
    $('boot').hidden = true;
    if (!d.configured) { $('unset').hidden = false; return; }
    if (!d.admin) { showLogin(); return; }
    settings = d.settings; polishReady = !!d.polish;
    $('login').hidden = true; $('panel').hidden = false;
    fillForm(); showNow();
  }

  // Look a link up as soon as it is pasted, so Trevor sees what he picked.
  async function lookup(slot) {
    var input = slot === 'pick' ? $('picklink') : $('ovlink');
    var preview = slot === 'pick' ? $('pickpreview') : $('ovpreview');
    var link = input.value.trim();
    chosen[slot] = null;
    if (!link) { preview.innerHTML = ''; return; }
    preview.innerHTML = '<p class="status">Looking it up...</p>';
    var r = await api({ action: 'lookup', link: link });
    if (r.ok) { chosen[slot] = r.data.video; preview.innerHTML = videoCard(r.data.video); }
    else preview.innerHTML = '<p class="adm-msg bad">' + esc(r.data.error || 'Could not look that up.') + '</p>';
  }

  async function save() {
    var body = { action: 'save', random: $('random').checked, pick: null, override: null };
    if (!body.random) body.pick = { link: $('picklink').value.trim(), caption: $('pickcap').value };
    if ($('ovlink').value.trim()) {
      body.override = { link: $('ovlink').value.trim(), caption: $('ovcap').value,
        start: fromLocalInput($('ovstart').value), end: fromLocalInput($('ovend').value) };
    }
    say('savemsg', 'Saving...');
    $('save').disabled = true;
    var r = await api(body);
    $('save').disabled = false;
    if (!r.ok) { say('savemsg', r.data.error || 'Could not save.', true); return; }
    settings = r.data.settings; fillForm();
    say('savemsg', 'Saved. The homepage shows it on the next visit.');
    showNow();
  }

  async function refresh() {
    var b = $('refresh');
    b.disabled = true;
    say('refmsg', 'Pulling the newest videos and episodes. About 20 seconds...');
    try {
      var r = await fetch('/api/videos?mode=refresh', { method: 'POST', credentials: 'same-origin' });
      var d = await r.json().catch(function () { return {}; });
      if (r.status === 401) { showLogin('You were logged out. Please log in again.'); return; }
      if (!r.ok) throw new Error(d.message || d.error || 'HTTP ' + r.status);
      say('refmsg', 'Done. ' + Number(d.count).toLocaleString() + ' videos, and the episode list is fresh too.');
      index = null; showNow();
    } catch (e) {
      say('refmsg', 'That did not finish. Try again in a minute.', true);
    } finally { b.disabled = false; }
  }

  async function polish(textareaId, button) {
    var ta = $(textareaId), before = ta.value;
    if (!before.trim()) { ta.focus(); return; }
    button.disabled = true; button.textContent = 'Polishing...';
    var r = await api({ action: 'polish', text: before });
    button.disabled = false; button.textContent = 'Polish with Claude';
    if (!r.ok) { say('savemsg', r.data.error || 'Could not polish that.', true); return; }
    ta.value = r.data.text;
    // One step back, in case the rewrite loses something.
    var undo = document.createElement('button');
    undo.type = 'button'; undo.className = 'btn'; undo.textContent = 'Undo polish';
    undo.addEventListener('click', function () { ta.value = before; undo.remove(); });
    button.after(undo);
  }

  // The picker searches the whole archive with the same matching as the
  // public video search, then drops the chosen video into the link field.
  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  }
  async function openFinder(slot) {
    findTarget = slot;
    $('finder').showModal();
    $('findq').value = ''; $('findq').focus();
    if (!index) {
      $('findres').innerHTML = '<p class="status">Loading the archive...</p>';
      var r = await fetch('/api/videos?mode=index');
      index = (await r.json()).videos || [];
      index.forEach(function (v) { v._f = fold(v.t); v._j = v._f.replace(/ /g, ''); });
    }
    renderFinder();
  }
  function renderFinder() {
    var s = fold($('findq').value), j = s.replace(/ /g, '');
    if (!j) { $('findres').innerHTML = '<p class="status">Type to search ' + index.length.toLocaleString() + ' videos.</p>'; return; }
    var hits = index.filter(function (v) { return v._f.indexOf(s) > -1 || (j.length >= 5 && v._j.indexOf(j) > -1); }).slice(0, 30);
    $('findres').innerHTML = hits.length ? hits.map(function (v) {
      return '<button type="button" data-id="' + esc(v.i) + '"><img src="https://i.ytimg.com/vi/' + esc(v.i) +
        '/mqdefault.jpg" alt="" loading="lazy"><span><b>' + esc(v.t) + '</b><span class="meta">' + esc(v.p) + '</span></span></button>';
    }).join('') : '<p class="status">No videos match that.</p>';
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('login').addEventListener('submit', async function (e) {
      e.preventDefault();
      say('loginmsg', 'Checking...');
      var r = await api({ action: 'login', password: $('pw').value });
      if (!r.ok) { say('loginmsg', r.data.error || 'Could not log in.', true); return; }
      $('pw').value = '';
      boot();
    });
    $('random').addEventListener('change', function () { $('pinbox').hidden = this.checked; });
    $('picklink').addEventListener('change', function () { lookup('pick'); });
    $('ovlink').addEventListener('change', function () { lookup('override'); });
    $('ovclear').addEventListener('click', function () {
      $('ovlink').value = ''; $('ovcap').value = ''; $('ovpreview').innerHTML = ''; chosen.override = null;
      say('savemsg', 'Schedule cleared. Press Save to make it stick.');
    });
    $('save').addEventListener('click', save);
    $('refresh').addEventListener('click', refresh);
    $('logout').addEventListener('click', async function () { await api({ action: 'logout' }); showLogin(); });
    document.querySelectorAll('[data-polish]').forEach(function (b) {
      b.addEventListener('click', function () { polish(b.dataset.polish, b); });
    });
    document.querySelectorAll('[data-find]').forEach(function (b) {
      b.addEventListener('click', function () { openFinder(b.dataset.find); });
    });
    $('findq').addEventListener('input', renderFinder);
    $('findclose').addEventListener('click', function () { $('finder').close(); });
    $('findres').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-id]');
      if (!b) return;
      var input = findTarget === 'pick' ? $('picklink') : $('ovlink');
      input.value = 'https://youtu.be/' + b.dataset.id;
      $('finder').close();
      lookup(findTarget);
    });
    boot();
  });
})();
