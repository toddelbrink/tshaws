/* Fuzzy text matching, shared by every surface that searches.
 *
 * Lived inside assets/js/videos.js until 2026-09-20, when site search started
 * needing the same rules. One copy, so the video grid and the search page can
 * never disagree about whether something matched.
 *
 * Search ignores case, accents and punctuation. From five letters up it also
 * ignores spaces, so "mooseknuckle" finds "Moose Knuckle" and "green wood"
 * finds "Greenwood". Shorter searches keep their spaces, because joined words
 * hide short strings ("Grass Unit" contains "sun"). Punctuation becomes a
 * space for the same reason ("Races/Unwanted"). Each character maps on its
 * own, so anything a plain lowercase search matched still matches.
 */
window.TSMatch = (function () {
  'use strict';

  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  }

  /* One prepared needle, reused across thousands of candidates rather than
   * refolded for each. `loose` is the five-letter rule above. */
  function needle(q) {
    var s = fold(q), joined = s.replace(/ /g, '');
    return { raw: String(q || '').toLowerCase(), s: s, joined: joined,
             loose: joined.length >= 5, empty: !joined };
  }

  /* Does one string match? Returns false, or a rank: 1 for a run of whole
   * words, 2 for a match only after spaces are dropped. Lower is better. */
  function hit(text, n) {
    if (n.empty) return String(text).toLowerCase().indexOf(n.raw) > -1 ? 1 : false;
    var f = fold(text);
    if (f.indexOf(n.s) > -1) return 1;
    if (n.loose && f.replace(/ /g, '').indexOf(n.joined) > -1) return 2;
    return false;
  }

  /* The list form videos.js has always used. Caches the folded title on the
   * item, which is what keeps a 3,148-video search instant. */
  function matches(list, q) {
    var n = needle(q);
    return list.filter(function (v) {
      var t = v.t || v.title || '';
      if (n.empty) return String(t).toLowerCase().indexOf(n.raw) > -1;
      if (v._fold === undefined) { v._fold = fold(t); v._joined = v._fold.replace(/ /g, ''); }
      return v._fold.indexOf(n.s) > -1 || (n.loose && v._joined.indexOf(n.joined) > -1);
    });
  }

  return { fold: fold, needle: needle, hit: hit, matches: matches };
})();
