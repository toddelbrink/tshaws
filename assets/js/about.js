/* The About page.
 *
 * It used to carry the guests table too. That moved to /guests/ on 2026-09-11,
 * because it sat below the entire About text with no nav
 * entry and nobody could find it. The roster logic lives in guests.js now, in
 * one place, so the two pages cannot drift apart.
 *
 * What is left is one redirect. The page itself is static prose and needs no JavaScript at all, and the footer year is stamped sitewide by
 * nav.js.
 */
(function () {
  'use strict';

  /* /about/#guests is linked from outside the site, and it used
   * to land on the guests table. The table is a page of its own now, so the
   * link goes there.
   *
   * A redirect rather than a scroll, for two reasons. Anyone following that
   * link wants the guest list, and the new page is the guest list: scrolling
   * them to a signpost that asks them to click again is worse. And the anchor
   * does not reliably scroll on a hard load anyway, verified against the live
   * site before this change, so leaving it as an anchor would have left a
   * promise the page does not keep.
   *
   * location.replace, not assign, so the back button returns where they came
   * from instead of bouncing them through /about/ again. The section itself
   * stays on the page for anyone who simply scrolls to it. */
  function redirectLegacyAnchor() {
    if (location.hash !== '#guests') return false;
    location.replace('/guests/');
    return true;
  }

  function init() {
    if (!document.getElementById('about')) return;   // no-ops on every other page
    redirectLegacyAnchor();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  document.addEventListener('tspage', init);
})();
