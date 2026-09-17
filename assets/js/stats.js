/* Keeps the numbers inside the prose true on their own.
 *
 * Trevor publishes weekly. Episode 41's own description says season five is
 * right around the corner. Any sentence containing "four seasons and forty-one
 * episodes" is therefore wrong within weeks, and nobody is going to remember to
 * edit an About page.
 *
 * Any element with data-stat gets its text replaced from live data. The text
 * written in the HTML is the fallback and must be correct on its own, so the
 * page still reads properly if the API is unreachable or JS never runs.
 *
 *   data-stat="years|episodes|seasons|concerts|videos"
 *   data-stat-case="title"   capitalise, for sentence-initial numbers
 *   data-stat="videos" data-stat-format="numeral|words"
 */
(function () {
  'use strict';

  var FIRST_UPLOAD = '2010-11-20';   // the show in the oldest video's own title
  var cache = null;

  var ONES = ['zero','one','two','three','four','five','six','seven','eight','nine','ten',
    'eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  var TENS = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];

  function words(n) {
    n = Math.floor(n);
    if (n < 20) return ONES[n] || String(n);
    if (n < 100) {
      var t = TENS[Math.floor(n / 10)], r = n % 10;
      return r ? t + '-' + ONES[r] : t;
    }
    if (n < 1000) {
      var h = ONES[Math.floor(n / 100)] + ' hundred', rem = n % 100;
      return rem ? h + ' ' + words(rem) : h;
    }
    if (n < 10000) {
      var k = ONES[Math.floor(n / 1000)] + ' thousand', rem2 = n % 1000;
      return rem2 ? k + ' ' + words(rem2) : k;
    }
    return String(n);
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function yearsSince(iso) {
    var a = new Date(iso), b = new Date();
    var y = b.getUTCFullYear() - a.getUTCFullYear();
    var m = b.getUTCMonth() - a.getUTCMonth();
    if (m < 0 || (m === 0 && b.getUTCDate() < a.getUTCDate())) y--;
    return y;
  }

  async function gather() {
    if (cache) return cache;
    var out = {};
    var jobs = [
      fetch('/api/episodes').then(function (r) { return r.ok ? r.json() : null; })
        .then(function (b) {
          if (!b) return;
          out.episodes = b.count;
          out.seasons = (b.seasons || []).length;
        }).catch(function () {}),
      fetch('/api/videos?mode=shows').then(function (r) { return r.ok ? r.json() : null; })
        .then(function (b) { if (b) out.concerts = b.concertCount; }).catch(function () {}),
      fetch('/api/videos').then(function (r) { return r.ok ? r.json() : null; })
        .then(function (b) { if (b) out.videos = b.total; }).catch(function () {})
    ];
    await Promise.all(jobs);
    out.years = yearsSince(FIRST_UPLOAD);
    cache = out;
    return out;
  }

  function value(key, d, el) {
    if (key === 'videos') {
      if (d.videos == null) return null;
      // Round down to the thousand so "more than N" stays honestly true as the
      // archive grows, instead of needing an edit every upload.
      var floored = Math.floor(d.videos / 1000) * 1000;
      return el.getAttribute('data-stat-format') === 'words'
        ? words(floored) : floored.toLocaleString();
    }
    if (d[key] == null) return null;
    return words(d[key]);
  }

  async function apply() {
    var nodes = document.querySelectorAll('[data-stat]');
    if (!nodes.length) return;
    var d = await gather();
    nodes.forEach(function (el) {
      var v = value(el.getAttribute('data-stat'), d, el);
      if (v == null) return;                       // keep the written fallback
      el.textContent = el.getAttribute('data-stat-case') === 'title' ? cap(v) : v;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
  document.addEventListener('tspage', apply);
})();
