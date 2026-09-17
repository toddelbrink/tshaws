/* The mortgages page.
 *
 * Trevor is a loan officer, and the podcast was built in part to reach the
 * progressive bluegrass audience as a lender, so this page matters more to his
 * business than anything else on the site.
 *
 * Everything a human has to confirm lives in this block. Nothing below it
 * needs editing to switch any of it on.
 */
(function () {
  'use strict';

  /* ---- the switch --------------------------------------------------------
   *
   * The apply button is rendered fully styled and does nothing while this is
   * false. That is deliberate, not indecision.
   *
   * Vercel's fair use guidelines, checked 2026-09-07: "Hobby teams are
   * restricted to non-commercial personal use only. All commercial usage of
   * the platform requires either a Pro or Enterprise plan." Commercial usage
   * explicitly includes "advertising the sale of a product or service". A
   * working mortgage funnel is that.
   *
   * So this is switched on only while the project runs on a Pro plan. */
  var MORTGAGE_CTA_ENABLED = false;

  /* ---- the destination ---------------------------------------------------
   *
   * One place, on purpose. Getting this wrong sends Trevor's leads to a
   * default loan officer in Tucson.
   *
   * This is Alameda Mortgage's Home Hub signup, which carries Trevor's photo,
   * his name, his NMLS number and his contact details, and assigns him the
   * lead. Attribution rides on the path segment, not a query parameter, so the
   * whole string matters.
   *
   * It is NOT chatmortgage.com/trevorshaw. That page's own Apply button bounces
   * to the generic corporate site and drops his attribution.
   *
   * The double T in chattmortgage is not a typo. It matches his real email
   * address as printed on the destination page. His marketing site uses one T.
   * Do not normalise it. */
  var APPLY_URL = 'https://www.amcvantage.com/homehub/signup/tshaw@chattmortgage.com';

  /* ---- licensing -------------------------------------------------------
   *
   * The single source of truth for a regulated claim. The sentence in the bio
   * is generated from this array and is never typed out, so the page cannot
   * drift from the list.
   *
   * Tennessee, Georgia and Colorado, confirmed against Trevor's NMLS
   * record on 2026-09-09. Arkansas is in progress and is deliberately absent:
   * "working on it" is not a license and must never be printed as one.
   * Add a state only from that record. */
  var LICENSED_STATES = ['Tennessee', 'Georgia', 'Colorado'];

  /* ---- still awaiting ----------------------------------------------------
   *
   * PORTRAIT renders nothing while null and the prose takes the full width,
   * so the page is presentable without it.
   *
   * INTERIM since 2026-09-14. A new headshot is a file swap: build a 210 and a 420 wide 3:4 JPEG
   * from the new master, strip their metadata, and swap the file names
   * below. The slot is 210 CSS px at every width, so 420 covers 2x screens. */
  var PORTRAIT = {
    src: '/assets/photos/trevor-headshot-210.jpg',
    srcset: '/assets/photos/trevor-headshot-210.jpg 210w, /assets/photos/trevor-headshot-420.jpg 420w',
    width: 210, height: 280,
    alt: 'Headshot of Trevor Shaw.'
  };

  var ROLE = 'Mortgage Loan Officer  ·  NMLS #929381';

  /* ---- the bio -----------------------------------------------------------
   *
   * Trevor's words, approved by Alameda Mortgage compliance. Do not rewrite
   * them here.
   *
   * The licensing sentence is built from LICENSED_STATES rather than typed, so
   * the regulated claim has exactly one source. */
  var STATES_SENTENCE = "I'm licensed in " + list(LICENSED_STATES) + '.';

  /* Approved by Alameda Mortgage compliance. The rule: never claim a license in
   * a state Trevor is not licensed in. This claims no license. The states
   * themselves are still generated from LICENSED_STATES, so the regulated half
   * of the claim has one source and this sentence cannot contradict it.
   * Arkansas stays out of LICENSED_STATES until it is actually issued. */
  var REFERRAL =
    "Buying or refinancing somewhere else? Ask anyway and I'll point you in " +
    "the right direction.";

  var BIO = [
    "I've been in mortgage lending since 2012. Before that I spent years in real " +
    "estate, and I moved over to lending because I wanted to be more directly " +
    "involved in the part where people actually get the keys.",

    "I work with anyone who needs a mortgage, from a first-time buyer to an investor " +
    "picking up rental property. Purchases and refinances, VA, USDA, FHA, DPA and " +
    "conventional financing. My goal on every loan is to make the process easier than " +
    "you are expecting it to be.",

    "I'm originally from the Chicago suburbs and I moved to Chattanooga to be closer " +
    "to the Smoky Mountains, my favorite part of the country. I take pride in doing " +
    "this with integrity and in doing whatever it takes for the people I work with.",

    // One paragraph, two constants. Compliance approved the pair as a single
    // sentence pair, so it reads as one. They stay separate constants because
    // the licensing half is generated from LICENSED_STATES and must survive any
    // edit to the referral half. Removing the referral is still a one-line
    // diff: drop the concatenation, not the line.
    STATES_SENTENCE + ' ' + REFERRAL,

    "When I'm not working I'm at a bluegrass show with a camera, or watching the Cubs."
  ];

  /* ---- the compliance footer --------------------------------------------
   *
   * Required by Alameda Mortgage. It matches the footer of Trevor's own live
   * application page.
   *
   * This is compliance furniture, not design. It should read as a legal
   * footer, because it is one, and it must stay visually subordinate to
   * Trevor's voice above it.
   *
   * EQUAL HOUSING AS TEXT. Their instruction was "add logo or write out 'Equal
   * Housing Opportunity'", so text satisfies it. The only artwork anyone has is
   * a roughly 20px raster that breaks at any usable size. If the approved
   * vector arrives, swap it in. Text beats a bad logo.
   *
   * NO APP STORE BADGES. The screenshot shows Google Play and App Store badges
   * for Alameda's mobile app. They do not apply.
   * A visitor arriving from a bluegrass podcast is not being driven to download
   * a lender's app. Do not add them back.
   *
   * THE DISCLAIMER IS PRINTED, NOT LINKED. On Alameda's own page "Disclaimer"
   * is not a link at all: its href is empty and it opens a modal. Measured
   * 2026-09-11, the modal contains exactly the sentence below, word for word.
   * So there is no URL to link even if we wanted one, and a compliance reviewer
   * who can read the language on the page has less to object to than one who
   * has to click for it. */
  var COMPLIANCE = {
    equalHousing: 'Equal Housing Opportunity',

    // Matches his live application page exactly, including the double T in
    // chattmortgage, which is his real address and not a typo.
    contact: [
      { text: 'Questions? Contact Trevor Shaw' },
      { text: 'Loan Officer' },
      { text: 'tshaw@chattmortgage.com', href: 'mailto:tshaw@chattmortgage.com' },
      { text: 'Cell: (423) 991-7429', href: 'tel:+14239917429' }
    ],

    // Both NMLS numbers. Alameda's #271603 and Trevor's #929381. These are
    // required and were nearly dropped once by a copy swap read literally.
    // Grep for both before committing anything that touches this page.
    identity: [
      { text: 'Alameda Mortgage Corporation NMLS #271603' },
      { text: 'Trevor Shaw NMLS #929381' },
      { text: 'Privacy Policy', href: 'https://www.alamedamortgage.com/privacy-statement/' },
      { text: 'NMLS', href: 'https://www.nmlsconsumeraccess.org/EntityDetails.aspx/COMPANY/271603' }
    ],

    disclaimer: 'Alameda Mortgage Corporation dba ChattMortgage, NMLS #271603, Licensed by the CA ' +
      'Department of Financial Protection and Innovation under the Residential ' +
      'Mortgage Lending Act.'
  };

  /* ---------------------------------------------------------------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function el(id) { return document.getElementById(id); }

  // A pipe-separated row. Pipes are decoration between items a screen reader
  // should hear as separate things, so they are aria-hidden and the items are
  // separated for assistive tech by the list semantics instead.
  function row(items) {
    return '<ul>' + items.map(function (it) {
      var body = it.href
        ? '<a href="' + esc(it.href) + '"' +
          (/^https?:/.test(it.href) ? ' rel="noopener"' : '') + '>' + esc(it.text) + '</a>'
        : esc(it.text);
      return '<li>' + body + '</li>';
    }).join('') + '</ul>';
  }

  function complianceHtml() {
    var c = COMPLIANCE;
    return '<p class="eho">' + esc(c.equalHousing) + '</p>' +
      row(c.contact) +
      row(c.identity) +
      '<p class="legal">' + esc(c.disclaimer) + '</p>';
  }

  function list(names) {
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' and ' + names[1];
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  function init() {
    var root = el('mortgages');
    if (!root) return;   // every page loads every script; this one no-ops elsewhere

    el('role').textContent = ROLE;

    var portrait = el('portrait');
    if (PORTRAIT && PORTRAIT.src) {
      portrait.innerHTML = '<img src="' + esc(PORTRAIT.src) + '"' +
        (PORTRAIT.srcset ? ' srcset="' + esc(PORTRAIT.srcset) + '" sizes="210px"' : '') +
        (PORTRAIT.width ? ' width="' + PORTRAIT.width + '" height="' + PORTRAIT.height + '"' : '') +
        ' decoding="async" alt="' + esc(PORTRAIT.alt || '') + '">';
      portrait.hidden = false;
    } else {
      portrait.hidden = true;   // the prose takes the full width, no gap left behind
    }

    el('bio').innerHTML = BIO.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');

    el('disclosure').innerHTML = complianceHtml();

    var apply = el('apply');
    if (MORTGAGE_CTA_ENABLED) {
      apply.addEventListener('click', function () { location.href = APPLY_URL; });
    }
    // When it is off, nothing is bound. The button is styled and inert.
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  document.addEventListener('tspage', init);
})();
