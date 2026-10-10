/* The Bluegrass Ramble schedule at /ramble/.
 *
 * The schedule is /assets/data/ramble-2026.json and nothing else. Every time
 * in it is PM in Chattanooga and is shown exactly as written, so a visitor in
 * another time zone still sees the times on the stage door.
 *
 * Picks live in the visitor's browser under one localStorage key. Every read
 * and write is wrapped, because private windows and locked-down browsers throw
 * on storage, and the schedule must still work there; picks just will not
 * outlast the visit. Safari also clears a site's storage after seven days of
 * use without a visit, which is why My Ramble pushes the share link: the link
 * carries the whole plan and never expires.
 *
 * A set's id is its night, stage and start time, "tuemk1030". A saved pick
 * survives a deploy as long as that set does not move. If IBMA moves a set, its
 * id changes and the old pick is dropped on load, which is the honest result.
 *
 * The share link is /ramble/#plan= and the ids joined by dots. It lives in the
 * hash so the server never sees it. Opening one shows that plan without
 * touching the visitor's own saved picks. The first change they make adopts it
 * as theirs and saves it. Unknown ids are ignored.
 *
 * A visitor can add up to six events of their own, like dinner or a jam. They
 * live in the browser beside the picks, under their own key, and travel after
 * the plan ids as "&own=", still in the hash. They are typed text from a
 * stranger whenever a link is opened, so every record from storage, a link or
 * the email function passes cleanYours() first, and every one is drawn
 * escaped. Web and email addresses are refused in them, because the site
 * emails plans from Trevor's domain and a mail app would make one clickable.
 *
 * Every page loads every script, so this one does nothing unless #ramble is on
 * the page, and it redraws on the soft-navigation 'tspage' event. */
(function () {
  'use strict';

  var DATA_URL = '/assets/data/ramble-2026.json';
  var STORE = 'tshaws-ramble-2026';
  var STORE_YOURS = 'tshaws-ramble-2026-yours';
  var YOURS_MAX = 6, TITLE_MAX = 40, PLACE_MAX = 30;
  // Midnight Eastern as Oct 22 begins: the Ramble is over. The page says so
  // and the homepage banner turns past tense. A month later, midnight Eastern
  // on Nov 21 (05:00 UTC, standard time by then), the banner goes. index.html
  // carries the same two instants for a page load.
  var RAMBLE_OVER = Date.UTC(2026, 9, 22, 4);
  var BANNER_UNTIL = Date.UTC(2026, 10, 21, 5);
  var GRID_START = '5:40', GRID_END = '11:00', PX = 1.8; // pixels per minute

  /* Acts with a guest on the podcast. Act name exactly as in the data file,
   * then the guest and their page. Add one only when the page exists:
   * test/ramble.js checks both sides. */
  /* The Info view. Every fact here was checked against the source named beside
   * it on 2026-10-07; change one only against its source. Stage names on the
   * schedule stay exactly as IBMA prints them. The venue's own name is used
   * here only. Food lines say what the venue's own site says it serves, never
   * that food is served during a set. */
  var MAP_URL = 'https://www.google.com/maps/d/viewer?mid=1QFk69ZaQhCwQrVnkdLL7Tk0U1PdFyyA';
  var CARTA_URL = 'https://www.gocarta.org/using-carta/services/downtown-shuttle/';
  // IBMA's own ticket page, checked 2026-10-08: Ramble passes for both nights
  // or one. Prices are IBMA's and change, so none is printed anywhere. Every
  // passes link reads this one address and hides once the Ramble is over.
  var PASS_URL = 'https://ibma.ticketspice.com/-ibma-world-of-bluegrass-2026';
  var VENUES = [
    { stages: ['rv', 'mk'], name: 'Chattanooga Convention Center', // chattanoogaconventioncenter.org
      address: 'One Carter Plaza, Chattanooga, TN 37402', site: 'https://www.chattanoogaconventioncenter.org/' },
    { stages: ['bb'], name: 'Barrelhouse Ballroom', // barrelhouseballroom.com
      address: '1501 Long St, Chattanooga, TN 37408', note: 'At the corner of Long and Main.',
      food: 'Serves a Five Wits Brewing menu.', site: 'https://www.barrelhouseballroom.com/' },
    { stages: ['hf'], name: 'Hi-Fi Clyde’s Chattanooga', // hificlydeschattanooga.com
      address: '122 W Main St, Chattanooga, TN 37408',
      food: 'Has a kitchen.', site: 'https://www.hificlydeschattanooga.com/' },
    { stages: ['sb'], name: 'Songbirds', // venue.songbirds.org: the music room, not the foundation's office
      address: '206 W Main St, Chattanooga, TN 37408', site: 'https://venue.songbirds.org/' },
    { stages: ['st'], name: 'Stratus Rooftop', // stratusrooftop.com
      address: '105 W Main St, Chattanooga, TN 37402', note: 'On top of Caption by Hyatt Chattanooga Downtown.',
      food: 'Serves shareable plates.', site: 'https://www.stratusrooftop.com/' },
    { stages: ['ft'], name: 'FEED Co. Table & Tavern', // feedtableandtavern.com
      address: '201 W Main St, Chattanooga, TN 37408',
      food: 'Serves lunch and dinner.', site: 'https://www.feedtableandtavern.com/' }
  ];
  // How the plan message names each venue with a food line, in this order.
  var EATS = ['Barrelhouse Ballroom', "Hi-Fi Clyde's", 'FEED', 'Stratus'];

  /* Walking minutes between Main Street stages, door to door, rounded up.
   * Measured 2026-10-08 from each venue's building in OpenStreetMap, which
   * agrees with the pins on IBMA's map: straight line times 1.4 for the street
   * grid, at 70 metres a minute for a crowd. The whole area is one block, so
   * no pair is over 115 metres. Stratus is a rooftop, and the trip up or down
   * is not timed here; the message says so instead. */
  var WALK = { // keys are the two stage ids in alphabetical order
    'bb ft': 3, 'bb hf': 1, 'bb sb': 2, 'bb st': 2, 'ft hf': 2,
    'ft sb': 1, 'ft st': 2, 'hf sb': 1, 'hf st': 2, 'sb st': 2
  };
  var SHUTTLE_ENDS = 22 * 60; // 10 p.m.
  var BREAK = 45;             // minutes free before the message calls it a break

  var PODCAST = {
    'Wood Box Heroes': { guest: 'Thomas Cassell', href: '/guests/thomas-cassell/' }
  };

  var data = null;     // the parsed file
  var sets = [];       // every set, sorted by night then start
  var byId = {};
  var picks = null;    // Set of ids on screen: the visitor's own, or a shared plan
  var own = null;      // the visitor's saved picks while a shared plan is showing
  var yours = [];      // the visitor's own events on screen, as clean records
  var ownYours = null; // their saved own events while a shared plan is showing
  var dayOrder = {};
  var S = { tab: 'browse', day: null, view: null, stage: 'all', open: null, toast: '', panel: false,
    mail: '', mailMsg: '', mailOk: false, mailBusy: false, form: null };
  var QR_URL = '/assets/js/vendor/qrcode.js';

  /* ---- helpers ---- */

  function minutes(t) {
    var p = t.split(':');
    return (Number(p[0]) % 12 + 12) * 60 + Number(p[1]);
  }
  function clock(m) { return (Math.floor(m / 60) % 12 || 12) + ':' + String(m % 60).padStart(2, '0'); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // A clock time with AM marked. Sets are all PM and never need it; an own
  // event can be lunch at noon or a jam past midnight.
  function wallClock(m) {
    m = ((m % 1440) + 1440) % 1440;
    return clock(m) + (m < 720 ? ' AM' : '');
  }
  function overlap(a, b) { return a.day === b.day && a.s < b.e && b.s < a.e; }
  function byTime(a, b) {
    return dayOrder[a.day] - dayOrder[b.day] || a.s - b.s || (a.yours ? 1 : 0) - (b.yours ? 1 : 0) ||
      sets.indexOf(a) - sets.indexOf(b);
  }
  // Every pick and own event on screen, in time order.
  function picked() {
    return sets.filter(function (x) { return picks.has(x.id); }).concat(yourItems(yours)).sort(byTime);
  }
  function clashes(x) {
    return picked().filter(function (p) { return p.id !== x.id && overlap(p, x); });
  }
  function others(x) {
    if (x.yours) return [];
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

  /* ---- storage and the share link ---- */

  function load() {
    var ids = [];
    try { ids = JSON.parse(localStorage.getItem(STORE) || '[]'); } catch (e) { ids = []; }
    if (!Array.isArray(ids)) ids = [];
    return new Set(ids.filter(function (i) { return byId[i]; }));
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(Array.from(picks))); } catch (e) { /* see top */ }
    try { localStorage.setItem(STORE_YOURS, JSON.stringify(yours)); } catch (e) { /* see top */ }
  }
  function loadYours() {
    var list = [];
    try { list = JSON.parse(localStorage.getItem(STORE_YOURS) || '[]'); } catch (e) { list = []; }
    return cleanYours(list);
  }

  /* ---- your own events ----
   * A record is { d, s, e, t, p }: night id, start and end as minutes after
   * midnight, title, place. An end before the start runs into the next
   * morning, up to six hours on; anything longer is a typo. */
  var LINKY = /:\/\/|@|www\.|[a-z0-9-]\.[a-z]{2,}/i;
  function tidy(v) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function yourProblem(r) {
    if (!data.days.some(function (d) { return d.id === r.d; })) return 'Pick a night.';
    if (!r.t) return 'Give it a name.';
    if (r.t.length > TITLE_MAX) return 'Keep the name to ' + TITLE_MAX + ' characters.';
    if (r.p.length > PLACE_MAX) return 'Keep the place to ' + PLACE_MAX + ' characters.';
    if (LINKY.test(r.t) || LINKY.test(r.p)) return 'Web and email addresses cannot go in a plan.';
    var ok = function (m) { return m === Math.floor(m) && m >= 0 && m < 1440; };
    if (!ok(r.s) || !ok(r.e)) return 'Set a start and an end time.';
    if (r.e === r.s) return 'The end time is the same as the start.';
    if (r.e < r.s && r.e + 1440 - r.s > 360) return 'The end time is before the start.';
    return '';
  }
  function cleanYours(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (r) {
      if (!r || typeof r !== 'object' || out.length >= YOURS_MAX) return;
      var x = { d: String(r.d), s: Number(r.s), e: Number(r.e), t: tidy(r.t), p: tidy(r.p) };
      if (!yourProblem(x)) out.push(x);
    });
    return out;
  }
  // The same records, shaped like sets so overlaps, breaks and the plan
  // message treat them alike. No building or area: a typed place is not one.
  function yourItems(list) {
    return list.map(function (r, i) {
      var e = r.e > r.s ? r.e : r.e + 1440;
      return { id: 'y' + i, n: i, yours: true, day: r.d, s: r.s, e: e, act: r.t, place: r.p,
        start: wallClock(r.s), end: wallClock(e), stageShort: r.p || 'Your own', stageName: r.p,
        building: null, area: null };
    });
  }
  // In the link: night,HHMM,HHMM,title,place per event, events split by ";".
  // encodeURIComponent turns any comma or semicolon typed in the text into
  // %2C or %3B, so the two separators can only mean what they mean.
  function hhmm(m) { return String(Math.floor(m / 60)).padStart(2, '0') + String(m % 60).padStart(2, '0'); }
  function yoursCode(list) {
    return list.map(function (r) {
      return [r.d, hhmm(r.s), hhmm(r.e), encodeURIComponent(r.t), encodeURIComponent(r.p)].join(',');
    }).join(';');
  }
  function yoursFromCode(code) {
    var list = String(code || '').split(';').slice(0, YOURS_MAX * 2).map(function (part) {
      var f = part.split(',');
      if (f.length !== 5 || !/^\d{4}$/.test(f[1]) || !/^\d{4}$/.test(f[2])) return null;
      var t = function (v) { var h = +v.slice(0, 2), m = +v.slice(2); return h < 24 && m < 60 ? h * 60 + m : -1; };
      try {
        return { d: f[0], s: t(f[1]), e: t(f[2]), t: decodeURIComponent(f[3]), p: decodeURIComponent(f[4]) };
      } catch (e) { return null; }
    });
    return cleanYours(list);
  }
  function yoursFrom(link) {
    var m = String(link || '').match(/#plan=[a-z0-9.]*&own=([^&#]*)$/);
    return m ? yoursFromCode(m[1]) : [];
  }
  /* The plan link and everything that carries it. One format since launch,
   * so links people have already shared keep opening. */
  function planIds(link) {
    var m = String(link || '').match(/#plan=([a-z0-9.]*)(?:&own=[^&#]*)?$/);
    if (!m) return [];
    return m[1].split('.').filter(function (i, n, all) { return byId[i] && all.indexOf(i) === n; });
  }
  function planLink(ids, origin, list) {
    return (origin || 'https://www.tshawsprogressivebluegrass.com') + '/ramble/#plan=' + ids.join('.') +
      (list && list.length ? '&own=' + yoursCode(list) : '');
  }
  /* The plan as plain text, for Mail, Messages and the share panel alike:
   * short lines and blank lines, no markdown. Each set gets its times, its
   * stage and area, then one line on getting there from the pick before it,
   * using the same rules My Ramble uses for overlaps and tight walks. The
   * link to open the plan is the one line that must survive. */
  function hrs(n) {
    var h = Math.floor(n / 60), m = n % 60;
    return (h ? h + ' hr' : '') + (h && m ? ' ' : '') + (m ? m + ' min' : '');
  }
  function areaName(id) {
    for (var i = 0; i < data.areas.length; i++) if (data.areas[i].id === id) return data.areas[i].name;
    return '';
  }
  function moveNote(a, b, ended) {
    if (a.yours || b.yours || a.stage === b.stage) return '';
    if (a.building === b.building) return 'Same building.';
    if (a.area === b.area) {
      var n = WALK[[a.stage, b.stage].sort().join(' ')];
      var roof = a.stage === 'st' || b.stage === 'st' ? ' Stratus is on the roof.' : '';
      return (n ? 'About a ' + n + ' minute walk.' : 'Short walk.') + roof;
    }
    if (ended) return 'Change areas: a 12 to 15 minute walk.';
    if (b.s > SHUTTLE_ENDS) return 'Change areas: a 12 to 15 minute walk. The shuttle stops at 10.';
    return 'Change areas: free shuttle from ' + (a.area === 'cc' ? '11th & Marriott' : 'the Choo Choo') +
      ', or a 12 to 15 minute walk.';
  }
  /* The plan as structured rows, which the plain text below and the HTML
   * email (lib/plan-email.js) both render, so the two can never disagree. */
  function planRows(ids, origin, now, list) {
    var ended = (now === undefined ? Date.now() : now) >= RAMBLE_OVER;
    list = cleanYours(list || []);
    var mineItems = yourItems(list);
    var P = ids.map(function (i) { return byId[i]; }).filter(Boolean).concat(mineItems).sort(byTime);
    var days = [];
    data.days.forEach(function (d) {
      var L = P.filter(function (x) { return x.day === d.id; });
      if (!L.length) return;
      var items = [], until = 0;
      L.forEach(function (x, i) {
        var a = L[i - 1];
        if (a && x.s - until >= BREAK) {
          items.push({ type: 'break', length: hrs(x.s - until),
            food: a.area === 'ms' || x.area === 'ms' ? EATS.slice() : [] });
        }
        until = Math.max(until, x.e);
        var notes = [];
        if (a) {
          var m = moveNote(a, x, ended);
          if (m) notes.push({ text: m, warn: false });
          if (overlap(a, x)) notes.push({ text: 'Overlaps the set above.', warn: true });
          else if (!a.yours && !x.yours && x.s - a.e <= 10 && x.building !== a.building) {
            notes.push({ text: x.s - a.e ? x.s - a.e + ' min to get here.' : 'No time to get here.', warn: true });
          }
          L.slice(0, i - 1).forEach(function (y) {
            if (overlap(y, x)) notes.push({ text: 'Overlaps ' + y.act + '.', warn: true });
          });
        }
        items.push(x.yours
          ? { type: 'set', yours: true, id: x.id, time: x.start + ' to ' + x.end, act: x.act,
              stage: x.place, area: '', areaId: null, notes: notes }
          : { type: 'set', id: x.id, time: clock(x.s) + ' to ' + clock(x.e), act: x.act,
              stage: x.stageName, area: areaName(x.area), areaId: x.area, notes: notes });
      });
      days.push({ label: new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-US',
        { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase(), items: items });
    });
    var cc = data.areas[0], names = data.stages.filter(function (s) { return s.area === cc.id; })
      .map(function (s) { return s.name; });
    return {
      ended: ended,
      am: mineItems.some(function (x) { return /AM/.test(x.start + x.end); }),
      days: days,
      areas: 'Two areas, a little over half a mile apart. ' + cc.name + ': ' + names.join(' and ') + '. ' +
        data.areas[1].name + ': the other ' +
        ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'][data.stages.length - names.length] + ' stages.',
      shuttle: ended ? null : 'Free CARTA electric shuttle, about every 15 minutes until 10 p.m. Board at 11th & Marriott ' +
        'beside the Convention Center, or at the Chattanooga Choo Choo for Main Street.',
      map: MAP_URL,
      passes: ended ? null : PASS_URL,
      plan: planLink(ids, origin, list)
    };
  }
  function planText(ids, origin, now, list) {
    var R = planRows(ids, origin, now, list);
    var out = ['My IBMA Ramble plan', 'Chattanooga. All times are PM Eastern' + (R.am ? ' unless marked AM.' : '.')];
    R.days.forEach(function (d) {
      out.push('', d.label);
      d.items.forEach(function (it) {
        if (it.type === 'break') {
          out.push('', 'Break, ' + it.length + '.' + (it.food.length ? ' Food on Main Street: ' + it.food.join(', ') + '.' : ''));
          return;
        }
        out.push('', it.time + '  ' + it.act, it.yours ? 'Your own' + (it.stage ? ', ' + it.stage : '') : it.stage + ', ' + it.area);
        if (it.notes.length) out.push(it.notes.map(function (n) { return n.text; }).join(' '));
      });
    });
    out.push('', 'GETTING AROUND', R.areas);
    if (R.shuttle) out.push(R.shuttle);
    out.push('', 'Map: ' + R.map);
    if (R.passes) out.push('Ramble passes: ' + R.passes);
    out.push('Open or change this plan: ' + R.plan, '', "From T Shaw's Progressive Bluegrass");
    return out.join('\n');
  }
  function planMail(ids, origin, now, list) {
    return 'mailto:?subject=' + encodeURIComponent('My IBMA Ramble plan') +
      '&body=' + encodeURIComponent(planText(ids, origin, now, list));
  }
  /* The whole plan as one calendar file, for Apple Calendar, Google Calendar
   * and Outlook alike. Times are pinned to Chattanooga with a full time zone
   * block, so a phone set anywhere else still lands a 6:00 set at 6:00
   * Eastern. Each set keeps one identifier built from its set id, so adding
   * the plan again updates it where the calendar app supports that. An own
   * event's identifier comes from what was typed, so an edited one is new. */
  var SITE = 'https://www.tshawsprogressivebluegrass.com';
  function icsText(v) {
    return String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  // Lines longer than 75 bytes fold onto the next line after one space, as
  // the format requires. Counted in bytes, so an accent never splits.
  function icsFold(line) {
    var out = [], cur = '', n = 0;
    Array.from(line).forEach(function (ch) {
      var b = unescape(encodeURIComponent(ch)).length;
      if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; }
      cur += ch; n += b;
    });
    out.push(cur);
    return out.join('\r\n ');
  }
  function icsWhen(day, m) {
    var d = null;
    for (var i = 0; i < data.days.length; i++) if (data.days[i].id === day) d = data.days[i];
    var t = Date.UTC(+d.date.slice(0, 4), +d.date.slice(5, 7) - 1, +d.date.slice(8, 10)) + Math.floor(m / 1440) * 864e5;
    var x = new Date(t), mm = m % 1440;
    var p2 = function (n) { return String(n).padStart(2, '0'); };
    return x.getUTCFullYear() + p2(x.getUTCMonth() + 1) + p2(x.getUTCDate()) + 'T' + p2(Math.floor(mm / 60)) + p2(mm % 60) + '00';
  }
  function hashOf(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  function venueOf(stage) {
    for (var i = 0; i < VENUES.length; i++) if (VENUES[i].stages.indexOf(stage) >= 0) return VENUES[i];
    return null;
  }
  function planIcs(ids, list, now) {
    list = cleanYours(list || []);
    var P = ids.map(function (i) { return byId[i]; }).filter(Boolean).concat(yourItems(list)).sort(byTime);
    var stamp = new Date(now === undefined ? Date.now() : now).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', "PRODID:-//T Shaw's Progressive Bluegrass//IBMA Ramble 2026//EN",
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:IBMA Ramble',
      'BEGIN:VTIMEZONE', 'TZID:America/New_York',
      'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT', 'DTSTART:19700308T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
      'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST', 'DTSTART:19701101T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD', 'END:VTIMEZONE'];
    P.forEach(function (x) {
      var v = x.yours ? null : venueOf(x.stage);
      var uid = x.yours ? 'own-' + hashOf([x.day, x.s, x.e, x.act, x.place].join('|')) : x.id;
      L.push('BEGIN:VEVENT', 'UID:ramble2026-' + uid + '@tshawsprogressivebluegrass.com', 'DTSTAMP:' + stamp,
        'DTSTART;TZID=America/New_York:' + icsWhen(x.day, x.s), 'DTEND;TZID=America/New_York:' + icsWhen(x.day, x.e),
        'SUMMARY:' + icsText(x.act));
      if (v) {
        // A venue with two stages names the stage. Elsewhere the stage is the venue.
        L.push('LOCATION:' + icsText((v.stages.length > 1 ? x.stageName + ' stage, ' : '') + v.name + ', ' + v.address),
          'DESCRIPTION:' + icsText('IBMA Bluegrass Ramble, ' + x.stageName + '. Set times can change: check ' +
            SITE + '/ramble/ on the day.'),
          'URL:' + SITE + '/ramble/');
      } else {
        if (x.place) L.push('LOCATION:' + icsText(x.place));
        L.push('DESCRIPTION:' + icsText('Your own plan, during the IBMA Bluegrass Ramble.'));
      }
      L.push('END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.map(icsFold).join('\r\n') + '\r\n';
  }

  function fromHash() {
    var ids = planIds(location.hash), list = yoursFrom(location.hash);
    return ids.length || list.length ? { ids: new Set(ids), yours: list } : null;
  }
  function myIds() {
    return sets.filter(function (x) { return picks.has(x.id); }).map(function (x) { return x.id; });
  }
  function dropHash() {
    if (location.hash) history.replaceState(history.state, '', location.pathname + location.search);
  }

  // Any change to a shared plan makes it the visitor's own.
  function changed() {
    if (own) { own = null; ownYours = null; dropHash(); }
    save();
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
    // "Tue 20" on wide screens, "Tue" on phones, where the row would otherwise
    // crush the stage menu. CSS picks one.
    root.querySelector('#rday').innerHTML = data.days.map(function (d) {
      return button('day', d.id, '<span class="rlong">' + esc(d.label) + '</span><span class="rshort" aria-hidden="true">' +
        esc(d.label.split(' ')[0]) + '</span>');
    }).join('');
    root.querySelector('#rtabs').innerHTML = button('tab', 'browse', 'Schedule') +
      button('tab', 'mine', 'My Ramble<span class="rcount">' + (picks.size + yours.length) + '</span>') +
      button('tab', 'info', 'Info');
    var sel = root.querySelector('#rstage');
    // The two areas first, since most people settle on one per night, then
    // each stage by the short name every row shows, so a choice fits the menu
    // on a narrow phone.
    if (!sel.options.length) {
      sel.innerHTML = '<option value="all">All stages</option>' +
        '<optgroup label="Areas">' + data.areas.map(function (a) {
          return '<option value="area:' + a.id + '">' + esc(a.name) + '</option>';
        }).join('') + '</optgroup>' +
        '<optgroup label="Stages">' + data.stages.map(function (s) {
          return '<option value="' + s.id + '">' + esc(s.short) + '</option>';
        }).join('') + '</optgroup>';
    }
    sel.value = S.stage;
    sel.classList.toggle('active', S.stage !== 'all');
    root.querySelector('#rday').hidden = !browse;
    root.querySelector('#rstagewrap').hidden = !browse;
  }

  /* ---- the menu's choice, and the two areas ----
   * "all", "area:cc" for a whole area, or a stage id. The list and the grid
   * read it the same way. */
  function shows(f, stage) {
    return f === 'all' || f === stage.id || f === 'area:' + stage.area;
  }
  function stagesShown(f) {
    return data.stages.filter(function (s) { return shows(f, s); });
  }

  /* One night's sets under the two area headings, each in time order and
   * grouped by start time. Areas with nothing to show are left out. */
  function listGroups(day, f) {
    var shown = {};
    stagesShown(f).forEach(function (s) { shown[s.id] = true; });
    return data.areas.map(function (a) {
      var slots = [], last = null;
      sets.forEach(function (x) {
        if (x.day !== day || x.area !== a.id || !shown[x.stage]) return;
        if (!last || last.t !== x.start) { last = { t: x.start, rows: [] }; slots.push(last); }
        last.rows.push(x);
      });
      return {
        area: a.id, name: a.name, slots: slots,
        stages: data.stages.filter(function (s) { return s.area === a.id; }).map(function (s) { return s.short; })
      };
    }).filter(function (g) { return g.slots.length; });
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

  function starLabel(x, on) {
    return esc((on ? 'Remove ' : 'Add ') + x.act + ', ' + dayLabel(x.day) + ' ' + x.start + ' to ' + x.end + ', ' + x.stageShort);
  }

  function list() {
    var areas = listGroups(S.day, S.stage);
    if (!areas.length) return key('list') + '<p class="status">No sets on this stage that night.</p>';
    return key('list') + areas.map(function (a) {
      return '<section class="rareasec" aria-label="' + esc(a.name) + '"><h2 class="rarea">' + esc(a.name) +
        ' <span>' + esc(a.stages.join(' · ')) + '</span></h2>' + slotsHtml(a.slots) + '</section>';
    }).join('');
  }

  function slotsHtml(groups) {
    return '<div class="rlist">' + groups.map(function (g) {
      return '<div class="rslot"><div class="rt">' + g.t + '</div><div class="rrows">' + g.rows.map(function (x) {
        var on = picks.has(x.id), c = on && clashes(x).length > 0, open = S.open === x.id;
        return '<div class="rset' + (on ? ' on' : '') + (c ? ' clash' : '') + '">' +
          '<div class="rinfo"><button type="button" class="ract one" data-open="' + x.id + '" aria-expanded="' + open + '" aria-controls="more-' + x.id + '">' + esc(x.act) + '</button>' +
          '<div class="rm one">' + esc(x.stageShort) + ' · to ' + x.end +
          (c ? ' · <b>Overlap</b>' : '') + (PODCAST[x.act] ? ' · <b>On the podcast</b>' : '') + '</div></div>' +
          '<button type="button" class="rstar" data-pick="' + x.id + '" aria-pressed="' + on + '" aria-label="' +
          starLabel(x, on) + '">' + STAR + '</button>' +
          (open ? detail(x) : '') + '</div>';
      }).join('') + '</div></div>';
    }).join('') + '</div>';
  }

  /* Stages across, time down. On a phone it scrolls sideways inside its own
   * box, never the page. Tapping a block toggles the pick. */
  /* Main Street is shaded and a heavy rule divides the two areas, so a casual
   * reader cannot miss that the grid is two places (Trevor, 2026-10-08). */
  function areaCls(cols, i) {
    var s = cols[i];
    return ' a-' + s.area + (i > 0 && cols[i - 1].area !== s.area ? ' asplit' : '');
  }
  function grid() {
    var t0 = minutes(GRID_START), t1 = minutes(GRID_END), H = (t1 - t0) * PX + 16;
    var y = function (m) { return Math.round((m - t0) * PX + 8); };
    var cols = stagesShown(S.stage);
    // The visitor's own events get a column of their own, first, and only on a
    // night that has one. Dashed, so it never reads as an IBMA set. Anything
    // outside the grid's hours is listed above it instead.
    var mineTonight = yourItems(yours).filter(function (x) { return x.day === S.day; });
    var inGrid = mineTonight.filter(function (x) { return x.e > t0 && x.s < t1; });
    var outside = mineTonight.filter(function (x) { return !(x.e > t0 && x.s < t1); });
    var ycol = inGrid.length ? 1 : 0;
    var h = key('grid', cols.length > 2) + (outside.length
      ? '<p class="ryout">Also yours this night: ' + outside.map(function (x) {
          return '<button type="button" class="rtextbtn" data-yedit="' + x.n + '">' + esc(x.act) + '</button>, ' +
            x.start + ' to ' + x.end;
        }).join('; ') + '.</p>' : '') +
      '<div class="rgridbox" tabindex="0" role="region" aria-label="Stages, ' + esc(dayLabel(S.day)) + '">' +
      '<div class="rgrid" style="grid-template-columns:40px repeat(' + (cols.length + ycol) + ',minmax(104px,1fr));min-width:' +
      (40 + (cols.length + ycol) * 104) + 'px">' +
      '<div class="rgh rpin"></div>' + (ycol ? '<div class="rgh ryh">Yours</div>' : '') + cols.map(function (s, i) {
        return '<div class="rgh one' + areaCls(cols, i) + '">' + esc(s.short) + '</div>';
      }).join('');
    // The area row. Its label sticks to the left edge while the grid scrolls
    // sideways, so a phone always shows which area it is looking at.
    h += '<div class="rga rpin"></div>' + (ycol ? '<div class="rga ryh"></div>' : '');
    data.areas.forEach(function (a) {
      var n = cols.filter(function (s) { return s.area === a.id; }).length;
      var first = cols.findIndex(function (s) { return s.area === a.id; });
      if (n) h += '<div class="rga' + areaCls(cols, first) + '" style="grid-column:span ' + n + '"><span>' + esc(a.name) + '</span></div>';
    });
    h += '<div class="rcol rtime rpin" style="height:' + H + 'px">';
    for (var t = Math.ceil(t0 / 30) * 30; t <= t1; t += 30) {
      h += '<span style="top:' + y(t) + 'px">' + clock(t) + '</span>';
    }
    h += '</div>';
    if (ycol) {
      h += '<div class="rcol ryc" style="height:' + H + 'px;background-position:0 ' + (y(Math.ceil(t0 / 30) * 30) - 54) + 'px">' +
        inGrid.map(function (x) {
          var c = clashes(x).length > 0, top = y(Math.max(x.s, t0)), bot = y(Math.min(x.e, t1));
          return '<button type="button" class="rblk yours' + (c ? ' clash' : '') + '" data-yedit="' + x.n +
            '" aria-label="' + esc('Edit ' + x.act + ', ' + x.start + ' to ' + x.end) + '" style="top:' + top + 'px;height:' +
            (bot - top - 3) + 'px">' + (c ? '<i aria-hidden="true">!</i>' : '') +
            '<span>' + esc(x.act) + '</span><small>' + x.start + ' to ' + x.end + '</small></button>';
        }).join('') + '</div>';
    }
    cols.forEach(function (s, i) {
      h += '<div class="rcol' + areaCls(cols, i) + '" style="height:' + H + 'px;background-position:0 ' + (y(Math.ceil(t0 / 30) * 30) - 54) + 'px">' +
        sets.filter(function (x) { return x.day === S.day && x.stage === s.id; }).map(function (x) {
          var on = picks.has(x.id), c = on && clashes(x).length > 0;
          return '<button type="button" class="rblk' + (on ? ' on' : '') + (c ? ' clash' : '') + '" data-pick="' + x.id +
            '" aria-pressed="' + on + '" aria-label="' + starLabel(x, on) + '" style="top:' + y(x.s) + 'px;height:' +
            (Math.round((x.e - x.s) * PX) - 3) + 'px">' + (c ? '<i aria-hidden="true">!</i>' : on ? '<i aria-hidden="true">' + STAR + '</i>' : '') +
            '<span>' + esc(x.act) + '</span><small>' + x.start + ' to ' + x.end + '</small></button>';
        }).join('') + '</div>';
    });
    return h + '</div></div>';
  }

  /* The how-to and the colour key, one line above the sets. Picked and
   * overlapping each carry a mark as well as a colour: a filled star, and the
   * word Overlap in the list or a ! in the grid. "Tap" or "Click" is chosen by
   * CSS from the pointer the visitor actually has. */
  function key(view, wide) {
    var verb = '<span class="rtap">Tap</span><span class="rclick">Click</span>';
    var how = view === 'grid'
      ? verb + ' a set to pick it.' + (wide ? '<span class="rside"> Scroll sideways for every stage.</span>' : '')
      : verb + ' the star to pick a set.';
    // The List and Grid switch sits here rather than in the pinned row, which
    // on a phone needs its width for the night and the stage menu.
    return '<div class="rkeyrow"><p class="rkey"><span class="rhow">' + how + '</span> ' +
      '<span class="rk"><i class="rsw on">' + STAR + '</i>Picked</span> ' +
      '<span class="rk"><i class="rsw clash">!</i>Overlaps another pick</span></p>' +
      '<div class="rseg" role="group" aria-label="Layout">' + button('view', 'list', 'List') + button('view', 'grid', 'Grid') + '</div></div>';
  }

  function over() { return Date.now() >= RAMBLE_OVER; }
  function bothAreas(list) {
    return data.areas.every(function (a) { return list.some(function (x) { return x.area === a.id; }); });
  }

  /* Info: how it works, the two areas, getting between them, and each venue.
   * Text and links only. The map is a link out, never embedded, so the page
   * pulls nothing from Google. */
  function info() {
    var verb = '<span class="rtap">Tap</span><span class="rclick">Click</span>';
    var stageList = function (areaId) {
      return data.stages.filter(function (s) { return s.area === areaId; }).map(function (s) { return esc(s.name); });
    };
    var and = function (l) { return l.length < 3 ? l.join(' and ') : l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1]; };
    var ms = data.areas[1], cc = data.areas[0];
    var h = '<div class="rinfo-page">';
    h += '<section aria-labelledby="ri-how"><h2 class="rarea" id="ri-how">How it works</h2><div class="rprose">' +
      '<p>' + verb + ' the star beside a set in the Schedule to pick it. ' + verb + ' an act’s name to see when it plays again.</p>' +
      '<p>A picked set takes a brass edge and a filled star. Red, with the word Overlap or a !, means it clashes with another pick. ' +
      'My Ramble lists your picks in time order and offers a fix when an act plays twice.</p>' +
      '<p>Add your own plans in My Ramble too, like dinner or a jam. They are checked against your picks, ' +
      'and only you and anyone you send your plan to will see them.</p>' +
      '<p>Your picks stay in this browser only. Use Save or send in My Ramble to keep your plan or open it on another device. A screenshot works too.</p>' +
      (over() ? '' : '<p>For last-minute changes, check IBMA’s own app, out the week of Oct 12.</p>') +
      '</div></section>';
    if (!over()) {
      h += '<section aria-labelledby="ri-pass"><h2 class="rarea" id="ri-pass">Passes</h2><div class="rprose">' +
        '<p>Ramble passes are sold by IBMA, for both nights or one.</p>' +
        '<p class="rmapbtn"><a class="btn" href="' + PASS_URL + '" target="_blank" rel="noopener">Get Ramble passes</a></p>' +
        '</div></section>';
    }
    h += '<section aria-labelledby="ri-areas"><h2 class="rarea" id="ri-areas">The two areas</h2><div class="rprose">' +
      '<p>The seven stages sit in two areas, and most people pick one a night.</p>' +
      '<p><strong>' + esc(cc.name) + ':</strong> ' + and(stageList(cc.id)) + '.</p>' +
      '<p><strong>' + esc(ms.name) + ':</strong> ' + and(stageList(ms.id)) + '.</p></div></section>';
    h += '<section aria-labelledby="ri-move"><h2 class="rarea" id="ri-move">Getting between them</h2><div class="rprose">' +
      '<p>' + esc(cc.name) + ' to ' + esc(ms.name) + ' is a little over half a mile, about a 12 to 15 minute walk.</p>' +
      '<p>Or ride CARTA’s free electric <a href="' + CARTA_URL + '" rel="noopener">Downtown Shuttle</a>, about every 15 minutes. ' +
      'Board at the 11th &amp; Marriott stop, beside the Convention Center. Ride to the Choo Choo stop for Main Street. ' +
      'On Tuesdays and Wednesdays it runs until 10 p.m., and Convention Center sets run until 11.</p>' +
      '<p class="rmapbtn"><a class="btn" href="' + MAP_URL + '" rel="noopener">Open the map</a> ' +
      '<span>Every venue, and the walking route between the two areas.</span></p></div></section>';
    h += '<section aria-labelledby="ri-venues"><h2 class="rarea" id="ri-venues">The venues</h2><div class="rvenues">' +
      VENUES.map(function (v) {
        var stages = v.stages.map(function (id) {
          for (var i = 0; i < data.stages.length; i++) if (data.stages[i].id === id) return esc(data.stages[i].name);
          return '';
        });
        var dir = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(v.name + ', ' + v.address);
        return '<div class="rvenue"><h3>' + esc(v.name) + '</h3>' +
          '<p class="rvstage">' + (stages.length > 1 ? 'Stages: ' : 'Stage: ') + and(stages) + '</p>' +
          '<p>' + esc(v.address) + (v.note ? '. ' + esc(v.note) : '') + '</p>' +
          (v.food ? '<p>' + esc(v.food) + '</p>' : '') +
          '<p class="rvlinks"><a href="' + esc(dir) + '" rel="noopener">Directions</a>' +
          '<a href="' + esc(v.site) + '" rel="noopener">Website</a></p></div>';
      }).join('') + '</div></section>';
    return h + '</div>';
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
    var h = '';
    if (own) {
      h += '<div class="rshared"><p><strong>This is a plan someone shared with you.</strong> Change anything and it becomes yours, replacing your own picks on this device.</p>' +
        (own.size || ownYours.length ? '<button type="button" class="btn" data-mine="1">Show my own picks</button>' : '') + '</div>';
    }
    if (P.length) h += sendBar();
    if (!P.length) {
      return h + '<div class="rempty"><p><strong>Nothing picked yet.</strong> Tap the star on any set in the Schedule. Tap an act’s name to see when it plays again.</p></div>' +
        yourBox(false);
    }
    data.days.forEach(function (d) {
      var L = P.filter(function (x) { return x.day === d.id; });
      if (!L.length) return;
      h += '<h2 class="rdayh">' + esc(dayLong(d)) + '</h2>';
      if (!over() && bothAreas(L)) {
        h += '<div class="rnote tight rshuttle">This night’s picks are in both areas, a 12 to 15 minute walk apart. ' +
          'CARTA’s free Downtown Shuttle runs between them until 10 p.m. ' +
          '<button type="button" class="rtextbtn" data-k="tab" data-v="info" data-goto="ri-move">Getting there</button></div>';
      }
      L.forEach(function (x, i) {
        h += x.yours
          ? '<div class="rpick yours"><div class="rt">' + x.start.replace(' AM', '<small>AM</small>') + '</div>' +
            '<div class="rinfo"><button type="button" class="ract one" data-yedit="' + x.n + '" aria-label="' +
            esc('Edit ' + x.act) + '">' + esc(x.act) + '</button>' +
            '<div class="rm one"><b>Your own</b>' + (x.place ? ' · ' + esc(x.place) : '') + ' · to ' + x.end + '</div></div>' +
            '<button type="button" class="rx" data-ydel="' + x.n + '" aria-label="Remove ' + esc(x.act) + '">' + CROSS + '</button>'
          : '<div class="rpick"><div class="rt">' + x.start + '</div>' +
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
        if (n && !x.yours && !n.yours && !overlap(x, n) && n.s - x.e <= 10 && n.building !== x.building) {
          var gap = n.s - x.e;
          h += '<div class="rnote tight">' + (gap ? gap + ' min to walk to ' : 'No time to walk to ') + esc(n.stageShort) + '.</div>';
        }
        h += '</div>';
      });
    });
    h += yourBox(true);
    return h;
  }

  /* Add your own: a button, or the form while it is open. The form's values
   * live in S.form so a redraw never wipes what was typed. */
  /* Add your own and Clear all share one row, two equal halves. While the
   * form is open, or at the cap, Clear all keeps its half on its own row. */
  function yourBox(clear) {
    var f = S.form;
    var clearBtn = clear ? '<button type="button" class="btn" data-clear="1">Clear all</button>' : '';
    if (!f && yours.length < YOURS_MAX) {
      return '<div class="ractions rpair"><button type="button" class="btn" data-yadd="1">Add your own</button>' + clearBtn + '</div>';
    }
    var tail = clear ? '<div class="ractions rpair">' + clearBtn + '</div>' : '';
    if (!f) return '<p class="rkeep">You have six of your own events, the most a plan can hold.</p>' + tail;
    var night = data.days.map(function (d) {
      return '<option value="' + d.id + '"' + (f.d === d.id ? ' selected' : '') + '>' + esc(dayLong(d)) + '</option>';
    }).join('');
    return '<form class="ryform" data-yform novalidate aria-labelledby="ryhead">' +
      '<h3 id="ryhead">' + (f.i >= 0 ? 'Edit your own' : 'Add your own') + '</h3>' +
      '<label class="rfield"><span>What</span><input type="text" name="t" maxlength="' + TITLE_MAX +
      '" autocomplete="off" placeholder="Dinner with Sam" value="' + esc(f.t) + '"></label>' +
      '<label class="rfield"><span>Night</span><select name="d">' + night + '</select></label>' +
      '<div class="rfrow"><label class="rfield"><span>Starts</span><input type="time" name="s" value="' + esc(f.s) + '"></label>' +
      '<label class="rfield"><span>Ends</span><input type="time" name="e" value="' + esc(f.e) + '"></label></div>' +
      '<label class="rfield"><span>Where, if you like</span><input type="text" name="p" maxlength="' + PLACE_MAX +
      '" autocomplete="off" value="' + esc(f.p) + '"></label>' +
      '<p class="rmailmsg" role="status">' + esc(f.msg || '') + '</p>' +
      '<div class="ractions"><button type="submit" class="btn solid">Save</button>' +
      '<button type="button" class="btn" data-ycancel="1">Cancel</button>' +
      (f.i >= 0 ? '<button type="button" class="rtextbtn" data-ydel="' + f.i + '">Remove it</button>' : '') + '</div>' +
      '<p class="rfine">Only you, and anyone you send your plan to, will see this.</p></form>' + tail;
  }
  function toClock(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  function openForm(i) {
    var r = i >= 0 ? yours[i] : null;
    S.form = r ? { i: i, d: r.d, s: toClock(r.s), e: toClock(r.e), t: r.t, p: r.p, msg: '' }
      : { i: -1, d: S.day || data.days[0].id, s: '', e: '', t: '', p: '', msg: '' };
    S.tab = 'mine';
  }

  /* Save or send, at the top of My Ramble. On a phone the button opens the
   * phone's own share panel, which already holds Messages and Mail. On a
   * computer, or where sharing is not offered, it opens the panel below: a QR
   * code to open the plan on a phone and the link to copy. Under the buttons,
   * on every device, the site will email the plan. Phones get a quieter way to that panel too, for a friend to scan
   * across a table. */
  function sendBar() {
    var ids = myIds(), url = planLink(ids, location.origin, yours);
    // Two equal halves on a phone. On a computer the main button already opens
    // the QR panel, so the second half only shows there to close it.
    // Save or send and Add to calendar as two equal halves. The QR code is the
    // quieter link under them, on phones only: on a computer Save or send
    // already opens it. The calendar goes once the Ramble is over.
    var h = '<div class="rsendbar"><div class="ractions rpair">' +
      '<button type="button" class="btn solid" data-send="1">Save or send</button>' +
      (over() ? '' : '<button type="button" class="btn" data-ics="1">Add to calendar</button>') + '</div>' +
      '<p class="rkeep">Your picks are saved in this browser only. Save or send your plan to keep it, or to open it on another device.' +
      (over() ? '' : ' Calendar entries do not change if IBMA moves a set, so check here on the day.') + '</p>' +
      '<button type="button" class="rqrlink" data-panel="' + (S.panel ? 'close' : 'open') + '" aria-expanded="' + S.panel + '" aria-controls="rsend">' +
      (S.panel ? 'Hide QR code' : 'Show QR code') + '</button>' +
      // The site emails the plan itself, as a formatted email (api/plan-email.js).
      // The typed address lives in S.mail so a redraw never wipes it.
      '<form class="rmail" data-mailform novalidate>' +
      '<label class="rmailbox"><span class="rmaillabel">Email it to me</span>' +
      '<input type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required value="' + esc(S.mail) + '"></label>' +
      '<input type="text" name="website" class="rtrap" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<button type="submit" class="btn"' + (S.mailBusy ? ' disabled' : '') + '>' + (S.mailBusy ? 'Sending…' : 'Send') + '</button>' +
      '</form>' +
      '<p class="rmailmsg' + (S.mailOk ? ' ok' : '') + '" role="status">' + esc(S.mailMsg) +
      (S.mailMsg && !S.mailOk && !S.mailBusy ? ' <a href="' + esc(planMail(ids, location.origin, undefined, yours)) + '">Open it in your mail app instead</a>.' : '') + '</p>' +
      '<p class="rfine">Your address is used to send this one email. It is not saved.</p></div>';
    if (S.panel) {
      h += '<section class="rsend" id="rsend" aria-label="Save or send your plan">' +
        '<div class="rqr" id="rqr" role="img" aria-label="QR code for your plan link"></div>' +
        '<div class="rsendtext"><h3>Open it on your phone</h3>' +
        '<p>Point your phone’s camera at the code, or use the link.</p>' +
        '<label class="rlink"><span class="sr-only">Your plan link</span><input type="text" readonly value="' + esc(url) + '"></label>' +
        '<div class="ractions"><button type="button" class="btn" data-copy="1">Copy link</button></div>' +
        '<p class="rtoast" role="status">' + esc(S.toast) + '</p></div></section>';
    }
    return h;
  }

  var qrLoading = null;
  function loadQR() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (!qrLoading) {
      qrLoading = new Promise(function (ok, fail) {
        var s = document.createElement('script');
        s.src = QR_URL;
        s.onload = function () { window.qrcode ? ok(window.qrcode) : fail(new Error('no qrcode')); };
        s.onerror = function () { qrLoading = null; fail(new Error('load')); };
        document.head.appendChild(s);
      });
    }
    return qrLoading;
  }
  // Drawn in the page from the link alone. Nothing is sent anywhere.
  function drawQR() {
    var box = document.getElementById('rqr');
    if (!box) return;
    var url = planLink(myIds(), location.origin, yours);
    loadQR().then(function (qrcode) {
      var q = qrcode(0, 'M');
      q.addData(url);
      q.make();
      var el = document.getElementById('rqr');
      if (el) el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
    }, function () {
      var el = document.getElementById('rqr');
      if (el) el.outerHTML = '';
    });
  }

  /* Redrawing replaces the buttons, which would drop keyboard focus on the
   * body after every star. Remember what had focus and put it back. */
  function focusKey(el) {
    if (!el || !el.dataset) return null;
    var d = el.dataset;
    if (d.pick) return '[data-pick="' + d.pick + '"].' + el.classList[0];
    if (d.open) return '[data-open="' + d.open + '"]';
    if (d.k) return '[data-k="' + d.k + '"][data-v="' + d.v + '"]';
    if (d.send) return '[data-send]';
    if (d.panel) return '[data-panel]';
    if (d.copy) return '[data-copy]';
    if (d.ics) return '[data-ics]';
    if (d.yadd) return '[data-yadd]';
    return null;
  }

  function render() {
    var root = document.getElementById('ramble');
    if (!root || !data) return;
    var key = root.contains(document.activeElement) ? focusKey(document.activeElement) : null;
    var box = root.querySelector('.rgridbox'), sx = box ? box.scrollLeft : 0;
    controls(root);
    root.querySelector('#rout').innerHTML = S.tab === 'mine' ? mine() : S.tab === 'info' ? info() :
      S.view === 'grid' ? grid() : list();
    box = root.querySelector('.rgridbox');
    if (box) box.scrollLeft = sx;
    if (S.panel && S.tab === 'mine') drawQR();
    if (key) {
      var el = root.querySelector(key);
      if (el) el.focus({ preventScroll: true });
    }
  }

  /* For test/ramble.js, which loads this file without a browser. */
  window.TSRamble = {
    load: function (d) { build(d); return sets; },
    listGroups: listGroups,
    stagesShown: stagesShown,
    venues: VENUES,
    mapUrl: MAP_URL,
    planIds: planIds,
    planLink: planLink,
    planRows: planRows,
    planText: planText,
    planMail: planMail,
    yoursFrom: yoursFrom,
    yoursFromCode: yoursFromCode,
    yoursCode: yoursCode,
    planIcs: planIcs,
    cleanYours: cleanYours,
    // Draws My Ramble or a night's grid for a given plan, as the page would.
    view: function (ids, list, tab, day) {
      picks = new Set(ids); yours = cleanYours(list); own = null; ownYours = null;
      S.tab = tab; S.day = day || data.days[0].id; S.view = 'grid'; S.stage = 'all'; S.form = null;
      return tab === 'mine' ? mine() : grid();
    },
    passUrl: PASS_URL,
    rambleOver: RAMBLE_OVER
  };
  if (typeof document === 'undefined') return;

  /* ---- events, bound once for the life of the document ---- */

  function send() {
    var ids = myIds();
    var phone = window.matchMedia('(pointer: coarse)').matches;
    if (phone && navigator.share) {
      // Text only: the plan link is inside it, and a separate url would print twice.
      navigator.share({ title: 'My IBMA Ramble plan', text: planText(ids, location.origin, undefined, yours) })
        .catch(function (e) {
          if (e && e.name === 'AbortError') return; // they closed the panel
          S.panel = true; render();
        });
      return;
    }
    S.panel = true;
    render();
  }

  // One file for the whole plan. The phone decides what opens it: on an
  // iPhone, Calendar offers Add All; elsewhere it downloads and opens in the
  // calendar app.
  function saveIcs() {
    var blob = new Blob([planIcs(myIds(), yours)], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'ibma-ramble-plan.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function copyLink() {
    var url = planLink(myIds(), location.origin, yours);
    var done = function (ok) {
      S.toast = ok ? 'Link copied.' : 'Copy did not work here. Select the link above and copy it.';
      render();
      if (!ok) { var input = document.querySelector('#ramble .rlink input'); if (input) input.select(); }
    };
    try {
      navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); });
    } catch (e) { done(false); }
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#ramble button');
    if (!b || !data) return;
    var d = b.dataset;
    S.toast = '';
    if (d.k) {
      S[d.k] = d.v;
      // Instant, not the site's smooth scroll, so a jump to a section that
      // follows is not overtaken by this one still running.
      if (d.k === 'tab') { S.panel = false; window.scrollTo({ top: 0, behavior: 'instant' }); }
    } else if (d.pick) {
      if (picks.has(d.pick)) picks.delete(d.pick); else picks.add(d.pick);
      changed();
    } else if (d.open) {
      S.open = S.open === d.open ? null : d.open;
    } else if (d.swap) {
      picks.delete(d.swap); picks.add(d.to); changed();
    } else if (d.clear) {
      if (!window.confirm('Clear every pick and your own events from your Ramble?')) return;
      picks.clear(); yours = []; S.form = null; S.panel = false; changed();
    } else if (d.yadd || d.yedit) {
      openForm(d.yedit ? Number(d.yedit) : -1);
      render();
      var t = document.querySelector('#ramble .ryform input[name="t"]');
      if (t) { t.scrollIntoView({ block: 'center', behavior: 'instant' }); t.focus({ preventScroll: true }); }
      return;
    } else if (d.ycancel) {
      S.form = null;
    } else if (d.ydel) {
      var gone = yours[Number(d.ydel)];
      if (!gone || !window.confirm('Remove ' + gone.t + ' from your plan?')) return;
      yours.splice(Number(d.ydel), 1); S.form = null; changed();
    } else if (d.mine) {
      picks = own; yours = ownYours; own = null; ownYours = null; dropHash();
    } else if (d.send) {
      send();
      return;
    } else if (d.panel) {
      S.panel = d.panel === 'open';
    } else if (d.copy) {
      copyLink();
      return;
    } else if (d.ics) {
      saveIcs();
      return;
    } else {
      return;
    }
    render();
    if (d.goto) {
      var to = document.getElementById(d.goto);
      if (to) to.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target.name === 'email' && e.target.closest('#ramble')) S.mail = e.target.value;
    if (S.form && e.target.closest('#ramble form[data-yform]')) S.form[e.target.name] = e.target.value;
  });
  document.addEventListener('submit', function (e) {
    var f = e.target.closest && e.target.closest('#ramble form[data-yform]');
    if (!f || !data || !S.form) return;
    e.preventDefault();
    var F = S.form;
    ['t', 'd', 's', 'e', 'p'].forEach(function (k) { F[k] = f[k].value; });
    var mins = function (v) { var m = /^(\d{2}):(\d{2})/.exec(v || ''); return m ? +m[1] * 60 + +m[2] : -1; };
    var r = { d: F.d, s: mins(F.s), e: mins(F.e), t: tidy(F.t), p: tidy(F.p) };
    F.msg = yourProblem(r);
    if (!F.msg) {
      if (F.i >= 0) yours[F.i] = r; else yours.push(r);
      S.form = null;
      S.day = r.d;
      changed();
    }
    render();
  });
  document.addEventListener('submit', function (e) {
    var f = e.target.closest && e.target.closest('#ramble form[data-mailform]');
    if (!f || !data) return;
    e.preventDefault();
    if (S.mailBusy) return;
    S.mail = f.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(S.mail)) {
      S.mailMsg = 'That email address does not look right.'; S.mailOk = false; render(); return;
    }
    S.mailBusy = true; S.mailMsg = ''; render();
    fetch('/api/plan-email', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: S.mail, plan: myIds().join('.'), own: yoursCode(yours), website: f.website.value })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (x) {
      S.mailOk = x.ok;
      S.mailMsg = x.ok ? 'Sent to ' + S.mail + '. Check your inbox, and your spam folder if it is not there in a minute.'
        : (x.j.error || 'The email did not go.');
    }, function () {
      S.mailOk = false; S.mailMsg = 'The email did not go. Check your connection.';
    }).then(function () { S.mailBusy = false; render(); });
  });

  document.addEventListener('change', function (e) {
    if (S.form && e.target.closest && e.target.closest('#ramble form[data-yform]')) { S.form[e.target.name] = e.target.value; return; }
    if (e.target.id !== 'rstage' || !data) return;
    S.stage = e.target.value;
    render();
  });

  // A shared link opened while the page is already up.
  window.addEventListener('hashchange', function () {
    if (document.getElementById('ramble') && data && fromHash()) start();
  });

  /* ---- start ---- */

  function build(d) {
    var stages = {};
    d.stages.forEach(function (s) { stages[s.id] = s; });
    var order = {};
    d.days.forEach(function (x, i) { order[x.id] = i; });
    dayOrder = order;
    sets = d.sets.map(function (x) {
      var st = stages[x.stage];
      return {
        id: x.day + x.stage + x.start.replace(':', ''),
        day: x.day, stage: x.stage, start: x.start, end: x.end, act: x.act,
        s: minutes(x.start), e: minutes(x.end),
        stageShort: st.short, stageName: st.name, building: st.building, area: st.area
      };
    }).sort(function (a, b) {
      return order[a.day] - order[b.day] || a.s - b.s || a.stageShort.localeCompare(b.stageShort);
    });
    byId = {};
    sets.forEach(function (x) { byId[x.id] = x; });
    data = d;
  }

  function start() {
    var shared = fromHash();
    S.form = null;
    if (shared) {
      own = load();
      ownYours = loadYours();
      picks = shared.ids;
      yours = shared.yours;
      S.tab = 'mine';
    } else {
      own = null;
      ownYours = null;
      picks = load();
      yours = loadYours();
    }
    if (!S.day) S.day = data.days[0].id;
    // The grid on a computer, the list on a phone, where seven stages in a row
    // cut act names short. The visitor's own switch wins after that.
    if (!S.view) S.view = window.matchMedia('(min-width: 700px)').matches ? 'grid' : 'list';
    var over = document.getElementById('rover');
    if (over) over.hidden = Date.now() < RAMBLE_OVER;
    var pass = document.getElementById('rpass');
    if (pass) { pass.href = PASS_URL; pass.hidden = Date.now() >= RAMBLE_OVER; }
    var checked = document.getElementById('rchecked');
    if (checked && /^\d{4}-\d{2}-\d{2}$/.test(data.last_checked || '')) {
      checked.textContent = new Date(data.last_checked + 'T12:00:00Z').toLocaleDateString('en-US',
        { month: 'short', day: 'numeric', timeZone: 'UTC' });
    }
    render();
  }

  function banner() {
    var b = document.getElementById('rbanner'), now = Date.now();
    if (!b) return;
    // Every page carries it, past tense once the Ramble is over, until it
    // goes. Same rule as the line in each page.
    if (now >= BANNER_UNTIL) b.remove();
    else if (now >= RAMBLE_OVER) b.classList.add('past');
  }

  async function init() {
    banner();
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
    start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  document.addEventListener('tspage', init);
})();
