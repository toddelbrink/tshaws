/* Export the whole video archive as a CSV for Trevor's title cleanup.
 *
 *   node tools/export-videos-csv.js
 *
 * Why this exists. Trevor cleans up his YouTube titles working through this
 * as a checklist.
 *
 * The output is NOT committed. It is a working file, and it goes stale the moment he edits a title.
 *
 * There is no write path back to YouTube, deliberately. Trevor edits YouTube
 * himself and the site picks the changes up on its own.
 *
 * The guess columns are guesses and are named that way. artist_guess is
 * derived from playlist titles where one exists, because those are reliably
 * band-first, and from the quoted-song convention in loose titles. Where
 * neither applies it is left blank rather than invented. Trevor fills
 * ARTIST_CONFIRMED; nothing downstream should trust artist_guess.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const BASE = process.env.TS_BASE || 'https://tshaws.elbrink.com';
const OUT_DIR = path.join(__dirname, '..', 'exports');

const get = async (p) => {
  const r = await fetch(BASE + p);
  if (!r.ok) throw new Error(p + ' -> HTTP ' + r.status);
  return r.json();
};

/* ---- the upload/performance date trap -------------------------------------
 * The oldest video was uploaded 2010-11-22 and its own title reads 11/20/10,
 * which is when the show happened. Those are different facts. Both columns
 * ship and they are never merged. */
function dateInTitle(title) {
  const m = String(title).match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})\b/);
  if (!m) return '';
  const mo = +m[1], d = +m[2];
  let y = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  if (y < 100) y += 2000;                       // the archive starts in 2010
  if (y < 2005 || y > 2100) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${y}-${pad(mo)}-${pad(d)}`;
}

// Some playlists are events holding several acts, not one band's set, such as
// Telluride Band Contest Round One. Any artist derivation must not assume one
// artist per playlist.
const EVENT_WORDS = /\b(festival|fest|contest|competition|showcase|round|awards|jam|camp|series|weekend|celebration|tribute|benefit)\b/i;

function artistFromShowTitle(t) {
  if (EVENT_WORDS.test(t)) return '';           // several acts, do not guess one
  let s = String(t)
    .replace(/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-](\d{2}|\d{4})\b/g, ' ')   // trailing date
    .replace(/\s+\d{4}\s*$/, ' ');
  const cut = s.split(/\s+@\s+|\s+\bat\b\s+/i)[0];                   // venue follows
  return cut.replace(/\s{2,}/g, ' ').trim();
}

// Loose titles overwhelmingly follow a quoted-song convention, in either
// order: "Long Journey Home" Greenwood Rye, or James Kee Band "Freeborn Man".
// Whatever sits outside the quotes is the best available guess. No quotes
// means no guess.
function artistFromVideoTitle(t) {
  const s = String(t);
  if (!/["“”]/.test(s)) return '';
  const stripped = s
    .replace(/["“][^"“”]*["”]/g, ' ')
    .replace(/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-](\d{2}|\d{4})\b/g, ' ')
    .replace(/\s+@\s+.*$/, ' ')
    .replace(/[\s\-–—,]{2,}/g, ' ')
    .trim()
    .replace(/^[\-–—,\s]+|[\-–—,\s]+$/g, '');
  return stripped.length > 1 ? stripped : '';
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return '"' + s.replace(/"/g, '""') + '"';
}

(async () => {
  const started = Date.now();

  process.stdout.write('Paging the archive');
  const videos = [];
  let token = null, total = null;
  do {
    const b = await get('/api/videos' + (token ? '?page=' + encodeURIComponent(token) : ''));
    if (b.total) total = b.total;
    videos.push(...(b.videos || []));
    token = b.nextPage || null;
    process.stdout.write('.');
  } while (token);
  console.log(` ${videos.length} of ${total}`);

  process.stdout.write('Reading shows');
  const { shows } = await get('/api/videos?mode=shows');
  const showOf = new Map();      // videoId -> show title
  const kindOf = new Map();      // videoId -> concert | podcast
  const inPlaylists = new Map(); // videoId -> the full record, for the check below
  for (const s of shows) {
    const b = await get('/api/videos?mode=show&id=' + encodeURIComponent(s.id));
    for (const v of (b.videos || [])) {
      showOf.set(v.id, s.title);
      kindOf.set(v.id, s.kind);
      inPlaylists.set(v.id, Object.assign({ show: s.title }, v));
    }
    process.stdout.write('.');
  }
  console.log(` ${shows.length} shows, ${showOf.size} videos placed`);

  /* Videos that sit in a playlist but not in the uploads feed.
   *
   * Found 2026-09-07: 59 of them. YouTube leaves unlisted videos out of a
   * channel's uploads playlist but still returns them inside a playlist, so
   * the site's Shows pages surface videos that are not otherwise listed
   * anywhere. The rest are public videos from other channels that Trevor added
   * to his own playlists.
   *
   * They are kept out of the main export, which is the uploads archive Trevor
   * asked for, and written to their own file so somebody decides about them on
   * purpose rather than by omission. */
  const uploadIds = new Set(videos.map((v) => v.id));
  const outsiders = [...inPlaylists.values()].filter((v) => !uploadIds.has(v.id));

  const COLUMNS = ['video_id', 'title', 'upload_date', 'date_in_title', 'show',
                   'duration', 'views', 'url', 'artist_guess', 'type_guess',
                   'ARTIST_CONFIRMED', 'EVENT', 'NEW_TITLE', 'NOTES'];

  const rows = videos.map((v) => {
    const show = showOf.get(v.id) || '';
    const kind = kindOf.get(v.id) || '';
    const type = !show ? 'individual'
      : kind === 'podcast' ? 'podcast'
      : EVENT_WORDS.test(show) ? 'event' : 'show';
    const artist = show ? artistFromShowTitle(show) : artistFromVideoTitle(v.title);
    return {
      video_id: v.id,
      title: v.title,
      upload_date: (v.published || '').slice(0, 10),
      date_in_title: dateInTitle(v.title),
      show,
      duration: v.durationLabel || '',
      views: v.viewCount == null ? '' : v.viewCount,
      url: 'https://www.youtube.com/watch?v=' + v.id,
      artist_guess: artist,
      type_guess: type,
      ARTIST_CONFIRMED: '', EVENT: '', NEW_TITLE: '', NOTES: ''
    };
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(OUT_DIR, `tshaws-videos-${stamp}.csv`);
  fs.writeFileSync(file,
    '﻿' +   // BOM, so Excel opens the accented titles as UTF-8
    [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n');

  const withArtist = rows.filter((r) => r.artist_guess).length;
  const withDate = rows.filter((r) => r.date_in_title).length;
  const byType = rows.reduce((a, r) => (a[r.type_guess] = (a[r.type_guess] || 0) + 1, a), {});
  const formulaish = rows.filter((r) => /^[=+\-@]/.test(r.title)).length;

  console.log('\nWrote ' + file);
  console.log('  rows            ' + rows.length + (total && rows.length !== total ? ' (expected ' + total + ')' : ''));
  console.log('  in a show       ' + rows.filter((r) => r.show).length);
  console.log('  type_guess      ' + JSON.stringify(byType));
  console.log('  artist_guess    ' + withArtist + ' (' + Math.round(withArtist / rows.length * 100) + '%), blank where it would be a bad guess');
  console.log('  date_in_title   ' + withDate);
  console.log('  titles a spreadsheet might read as a formula: ' + formulaish);
  console.log('  took ' + Math.round((Date.now() - started) / 1000) + 's');

  if (outsiders.length) {
    const cols = ['video_id', 'title', 'show', 'privacy_status', 'upload_date', 'views', 'url'];
    const extra = path.join(OUT_DIR, `tshaws-videos-not-in-uploads-${stamp}.csv`);
    fs.writeFileSync(extra, '\ufeff' + [cols.join(','), ...outsiders.map((v) => [
      v.id, v.title, v.show, v.privacyStatus || '', (v.published || '').slice(0, 10),
      v.viewCount == null ? '' : v.viewCount, 'https://www.youtube.com/watch?v=' + v.id
    ].map(csvCell).join(',')).join('\r\n')] .join('\r\n') + '\r\n');
    const byPrivacy = outsiders.reduce((a, v) => (a[v.privacyStatus || '?'] = (a[v.privacyStatus || '?'] || 0) + 1, a), {});
    console.log('\nAlso wrote ' + extra);
    console.log('  ' + outsiders.length + ' videos in playlists but not in the uploads feed: ' + JSON.stringify(byPrivacy));
    console.log('  Unlisted ones are reachable through the site\'s Shows pages. Trevor should know.');
  }
})().catch((e) => { console.error('\nFailed: ' + e.message); process.exit(1); });
