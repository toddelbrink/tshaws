/* The Bluegrass Ramble schedule at /ramble/.
 *
 * The schedule is /assets/data/ramble-2026.json and nothing else. Every time
 * in it is PM in Chattanooga and is shown exactly as written, so a visitor in
 * another time zone still sees the times on the stage door.
 *
 * Picks live in the visitor's browser under one localStorage key. Every read
 * and write is wrapped, because private windows and locked-down browsers throw
 * on storage, and the schedule must still work there; picks just will not
 * outlast the visit.
 *
 * A set's id is its night, stage and start time, "tuemk1030". A saved pick
 * survives a deploy as long as that set does not move. If IBMA moves a set, its
 * id changes and the old pick is dropped on load, which is the honest result.
 *
 * Every page loads every script, so this one does nothing unless #ramble is on
 * the page, and it redraws on the soft-navigation 'tspage' event. */
(function () {
  'use strict';

  var DATA_URL = '/assets/data/ramble-2026.json';
  var STORE = 'tshaws-ramble-2026';

  /* Acts with a guest on the podcast. Act name exactly as in the data file,
   * then the guest and their page. Add one only when the page exists:
   * test/ramble.js checks both sides. */
  var PODCAST = {
    'Wood Box Heroes': { guest: 'Thomas Cassell', href: '/guests/thomas-cassell/' }
  };

  var data = null;     // the parsed file, with sets built out below
  var sets = [];       // every set, sorted by night then start
  var byId = {};
  var picks = null;    // Set of ids
  var S = { tab: 'browse', day: null, stage: 'all', open: null, toast: '' };

  /* ---- helpers ---- */

  function minutes(t) {
    var p = t.split(':');
    return (Number(p[0]) % 12 + 12) * 60 + Number(p[1]);
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function overlap(a, b) { return a.day === b.day && a.s < b.e && b.s < a.e; }
  function picked() { return sets.filter(function (x) { return picks.has(x.id); }); }
  function clashes(x) {
    return picked().filter(function (p) { return p.id !== x.id && overlap(p, x); });
  }
  function others(x) {
    return sets.filter(function (o) { return o.act === x.act && o.id !== x.id; });
  }
  function dayLabel(id) {
    for (var i = 0; i < data.days.length; i++) if (data.days[i].id === id) return data.days[i].label.split(' ')[0];
    return id;
  }
  // "Tuesday, October 20". Read as noon UTC so no time zone can move the date.
  function dayLong(d) {
    return new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-US',
      { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }

  /* ---- storage ---- */

  function load() {
    var ids = [];
    try { ids = JSON.parse(localStorage.getItem(STORE) || '[]'); } catch (e) { ids = []; }
    if (!Array.isArray(ids)) ids = [];
    return new Set(ids.filter(function (i) { return byId[i]; }));
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(Array.from(picks))); } catch (e) { /* see top */ }
  }

  /* ---- markup ---- */

  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.6l2.8 6.1 6.7.7-5 4.5 1.4 6.6L12 17.1l-5.9 3.4 1.4-6.6-5-4.5 6.7-.7z"/></svg>';
  var CROSS = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.4 2L8 6.6 12.6 2 14 3.4 9.4 8l4.6 4.6-1.4 1.4L8 9.4 3.4 14 2 12.6 6.6 8 2 3.4z"/></svg>';

  function button(key, value, label, extra) {
    var on = String(S[key]) === String(value);
    return '<button type="button" data-k="' + key + '" data-v="' + esc(value) + '" aria-pressed="' + on + '"' +
      (extra || '') + '>' + label + '</button>';
  }

  function controls(root) {
    var browse = S.tab === 'browse';
    root.querySelector('#rday').innerHTML = data.days.map(function (d) {
      return button('day', d.id, esc(d.label));
    }).join('');
    root.querySelector('#rtabs').innerHTML = button('tab', 'browse', 'Schedule') +
      button('tab', 'mine', 'My Ramble<span class="rcount">' + picks.size + '</span>');
    var sel = root.querySelector('#rstage');
    if (!sel.options.length) {
      sel.innerHTML = '<option value="all">All stages</option>' + data.stages.map(function (s) {
        return '<option value="' + s.id + '">' + esc(s.name) + '</option>';
      }).join('');
    }
    sel.value = S.stage;
    sel.classList.toggle('active', S.stage !== 'all');
    root.querySelector('#rday').hidden = !browse;
    root.querySelector('#rstagewrap').hidden = !browse;
  }

  function detail(x) {
    var o = others(x), pod = PODCAST[x.act];
    var h = '<div class="rmore" id="more-' + x.id + '">';
    h += o.length ? o.map(function (y) {
      return '<span>Also plays ' + dayLabel(y.day) + ' ' + y.start + ' to ' + y.end + ' at ' + esc(y.stageName) + '</span>';
    }).join('') : '<span>This is the only Ramble set for this act.</span>';
    if (pod) h += '<span>On the podcast: <a href="' + pod.href + '">' + esc(pod.guest) + '</a></span>';
    return h + '</div>';
  }

  function list() {
    var rows = sets.filter(function (x) {
      return x.day === S.day && (S.stage === 'all' || x.stage === S.stage);
    });
    if (!rows.length) return '<p class="status">No sets on this stage that night.</p>';
    var groups = [], last = null;
    rows.forEach(function (x) {
      if (!last || last.t !== x.start) { last = { t: x.start, rows: [] }; groups.push(last); }
      last.rows.push(x);
    });
    return '<div class="rlist">' + groups.map(function (g) {
      return '<div class="rslot"><div class="rt">' + g.t + '</div><div class="rrows">' + g.rows.map(function (x) {
        var on = picks.has(x.id), c = on && clashes(x).length > 0, open = S.open === x.id;
        return '<div class="rset' + (on ? ' on' : '') + (c ? ' clash' : '') + '">' +
          '<div class="rinfo"><button type="button" class="ract one" data-open="' + x.id + '" aria-expanded="' + open + '" aria-controls="more-' + x.id + '">' + esc(x.act) + '</button>' +
          '<div class="rm one">' + esc(x.stageShort) + ' · to ' + x.end +
          (c ? ' · <b>Overlap</b>' : '') + (PODCAST[x.act] ? ' · <b>On the podcast</b>' : '') + '</div></div>' +
          '<button type="button" class="rstar" data-pick="' + x.id + '" aria-pressed="' + on + '" aria-label="' +
          esc((on ? 'Remove ' : 'Add ') + x.act + ', ' + dayLabel(x.day) + ' ' + x.start + ', ' + x.stageShort) + '">' + STAR + '</button>' +
          (open ? detail(x) : '') + '</div>';
      }).join('') + '</div></div>';
    }).join('') + '</div>';
  }

  /* An overlap note sits under the earlier of the two picks. If either act has
   * another set that is not picked and fits the rest of the plan, the note
   * names it and offers to move the pick there. */
  function fixFor(a, b) {
    var pairs = [[a, b], [b, a]];
    for (var i = 0; i < pairs.length; i++) {
      var from = pairs[i][0];
      var alt = others(from).filter(function (o) {
        if (picks.has(o.id)) return false;
        return !picked().some(function (p) { return p.id !== from.id && overlap(p, o); });
      })[0];
      if (alt) return { from: from, to: alt };
    }
    return null;
  }

  function mine() {
    var P = picked();
    if (!P.length) {
      return '<div class="rempty"><p><strong>Nothing picked yet.</strong> Tap the star on any set in the Schedule. Tap an act’s name to see when it plays again.</p></div>';
    }
    var h = '';
    data.days.forEach(function (d) {
      var L = P.filter(function (x) { return x.day === d.id; });
      if (!L.length) return;
      h += '<h2 class="rdayh">' + esc(dayLong(d)) + '</h2>';
      L.forEach(function (x, i) {
        h += '<div class="rpick"><div class="rt">' + x.start + '</div>' +
          '<div class="rinfo"><div class="ract one">' + esc(x.act) + '</div>' +
          '<div class="rm one">' + esc(x.stageShort) + ' · to ' + x.end + '</div></div>' +
          '<button type="button" class="rx" data-pick="' + x.id + '" aria-label="Remove ' + esc(x.act) + '">' + CROSS + '</button>';
        L.forEach(function (y) {
          if (y === x || !overlap(x, y)) return;
          // Only under the earlier one, and once per pair.
          if (y.s < x.s || (y.s === x.s && y.id < x.id)) return;
          var f = fixFor(x, y);
          h += '<div class="rnote bad"><strong>Overlaps ' + esc(y.act) + '.</strong>' + (f
            ? '<span>' + esc(f.from.act) + ' also plays ' + dayLabel(f.to.day) + ' ' + f.to.start + ', ' + esc(f.to.stageShort) + '.</span>' +
              '<button type="button" data-swap="' + f.from.id + '" data-to="' + f.to.id + '">Move</button>'
            : '<span>Neither act has another set that fits your plan.</span>') + '</div>';
        });
        var n = L[i + 1];
        if (n && !overlap(x, n) && n.s - x.e <= 10 && n.building !== x.building) {
          var gap = n.s - x.e;
          h += '<div class="rnote tight">' + (gap ? gap + ' min to walk to ' : 'No time to walk to ') + esc(n.stageShort) + '.</div>';
        }
        h += '</div>';
      });
    });
    h += '<div class="ractions"><button type="button" class="btn" data-clear="1">Clear all</button>' +
      '<span class="rtoast" role="status">' + esc(S.toast) + '</span></div>';
    return h;
  }

  /* Redrawing replaces the buttons, which would drop keyboard focus on the
   * body after every star. Remember what had focus and put it back. */
  function focusKey(el) {
    if (!el || !el.dataset) return null;
    var d = el.dataset;
    if (d.pick) return '[data-pick="' + d.pick + '"]' + (el.classList.contains('rx') ? '.rx' : '.rstar');
    if (d.open) return '[data-open="' + d.open + '"]';
    if (d.k) return '[data-k="' + d.k + '"][data-v="' + d.v + '"]';
    return null;
  }

  function render() {
    var root = document.getElementById('ramble');
    if (!root || !data) return;
    var key = root.contains(document.activeElement) ? focusKey(document.activeElement) : null;
    controls(root);
    root.querySelector('#rout').innerHTML = S.tab === 'mine' ? mine() : list();
    if (key) {
      var el = root.querySelector(key);
      if (el) el.focus({ preventScroll: true });
    }
  }

  /* ---- events, bound once for the life of the document ---- */

  function toggle(id) {
    if (picks.has(id)) picks.delete(id); else picks.add(id);
    save();
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#ramble button');
    if (!b || !data) return;
    var d = b.dataset;
    if (d.k) {
      S[d.k] = d.v;
      S.toast = '';
      if (d.k === 'tab') window.scrollTo(0, 0);
    } else if (d.pick) {
      toggle(d.pick);
      S.toast = '';
    } else if (d.open) {
      S.open = S.open === d.open ? null : d.open;
    } else if (d.swap) {
      picks.delete(d.swap); picks.add(d.to); save();
    } else if (d.clear) {
      if (!window.confirm('Clear every pick from your Ramble?')) return;
      picks.clear(); save();
    } else {
      return;
    }
    render();
  });

  document.addEventListener('change', function (e) {
    if (e.target.id !== 'rstage' || !data) return;
    S.stage = e.target.value;
    render();
  });

  /* ---- start ---- */

  function build(d) {
    var stages = {};
    d.stages.forEach(function (s) { stages[s.id] = s; });
    var order = {};
    d.days.forEach(function (x, i) { order[x.id] = i; });
    sets = d.sets.map(function (x) {
      var st = stages[x.stage];
      return {
        id: x.day + x.stage + x.start.replace(':', ''),
        day: x.day, stage: x.stage, start: x.start, end: x.end, act: x.act,
        s: minutes(x.start), e: minutes(x.end),
        stageShort: st.short, stageName: st.name, building: st.building
      };
    }).sort(function (a, b) {
      return order[a.day] - order[b.day] || a.s - b.s || a.stageShort.localeCompare(b.stageShort);
    });
    byId = {};
    sets.forEach(function (x) { byId[x.id] = x; });
    data = d;
  }

  async function init() {
    var root = document.getElementById('ramble');
    if (!root) return;
    try {
      if (!data) {
        var r = await fetch(DATA_URL);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        build(await r.json());
      }
    } catch (e) {
      root.querySelector('#rout').innerHTML = '<p class="status">The schedule did not load. ' +
        '<a href="https://worldofbluegrass.org/ramble-schedule/" rel="noopener">See the official schedule</a>.</p>';
      return;
    }
    picks = load();
    if (!S.day) S.day = data.days[0].id;
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  document.addEventListener('tspage', init);
})();
