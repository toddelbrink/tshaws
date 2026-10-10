// Shared by api/admin.js and api/videos.js.
//
// The admin page is one password and no accounts. It is the single exception
// to the no-auth rule, approved 2026-09-18, and it controls only the homepage
// featured video and the refresh button.
//
// Login sets a signed cookie. The signing key is ADMIN_PASSWORD itself, so
// changing the password in Vercel logs every session out. Settings live in one
// private file in the Vercel Blob store `tshaws-admin`, reached through the
// project's OIDC connection. No read-write token is stored anywhere.

const crypto = require('crypto');
const { get, put } = require('@vercel/blob');

const COOKIE = 'tsadmin';
const SESSION_S = 30 * 86400;
const SETTINGS_PATH = 'admin/featured.json';
const DEFAULTS = { random: true, pick: null, override: null, now: null, skip: null, updatedAt: null };
const DAY_MS = 86400000;

function password() {
  const p = process.env.ADMIN_PASSWORD;
  return p && p.length >= 8 ? p : null;
}

function mac(value, key) {
  return crypto.createHmac('sha256', key).update(value).digest('base64url');
}

// Hashing both sides first makes the comparison constant-time whatever the
// lengths, so response timing says nothing about the password.
function passwordMatches(given) {
  const p = password();
  if (!p || typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(p).digest();
  return crypto.timingSafeEqual(a, b);
}

function sessionCookie() {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_S);
  return `${COOKIE}=${exp}.${mac('session:' + exp, password())}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_S}`;
}

function clearedCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function isAdmin(req) {
  const key = password();
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)tsadmin=([^;]+)/);
  if (!key || !m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const want = Buffer.from(mac('session:' + exp, key));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// Writes must come from the site itself. SameSite=Strict already keeps the
// cookie off other sites' requests; this refuses them outright as well.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}

// One private JSON file in the Blob store. Reads never throw: a missing or
// unreadable file comes back as null, so callers fall through to their next
// source instead of failing the request.
async function readPrivateJSON(path) {
  try {
    const r = await get(path, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200) return null;
    return JSON.parse(await new Response(r.stream).text());
  } catch (e) {
    if (e && e.name !== 'BlobNotFoundError') console.error('blob read failed:', path, e.message);
    return null;
  }
}

async function writePrivateJSON(path, value) {
  await put(path, JSON.stringify(value), {
    access: 'private', addRandomSuffix: false, allowOverwrite: true,
    contentType: 'application/json'
  });
}

async function readSettings() {
  return { ...DEFAULTS, ...((await readPrivateJSON(SETTINGS_PATH)) || {}) };
}

async function writeSettings(settings) {
  const body = { ...DEFAULTS, ...settings, updatedAt: new Date().toISOString() };
  await writePrivateJSON(SETTINGS_PATH, body);
  return body;
}

// The featured day turns at 2 a.m. Eastern, so a late-night visitor still
// sees the day's video. Used by the daily pick and by Skip.
const DAY_TURNS_AT_H = 2;
function easternDay(now) {
  const shifted = new Date(now.getTime() - DAY_TURNS_AT_H * 3600 * 1000);
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(shifted);
  const [y, m, d] = key.split('-').map(Number);
  return { key, number: Math.floor(Date.UTC(y, m - 1, d) / 86400000) };
}

// How many times Trevor has skipped the random video on this day. A skip
// lasts only for the day it was pressed; at 2 a.m. the shuffle carries on.
function skipsFor(settings, dayKey) {
  const s = settings && settings.skip;
  return s && s.day === dayKey ? Math.max(0, Math.min(20, Number(s.n) || 0)) : 0;
}

// What the homepage should feature right now, before the daily pick is
// consulted. Null means use the daily pick. Highest first:
//
//   1. Feature now. Trevor pasted a video to put up straight away, so it beats
//      everything while it runs. A schedule it overlaps is not lost: it shows
//      when Feature now ends, if its own window is still open.
//   2. A scheduled video, while its window runs.
//   3. The bumped day. If Feature now had "give it its full day back" on, the
//      random video it displaced returns for 24 hours from when it ended. Only
//      while random is on: with it off there was no random video to bump, and
//      the pin comes back by itself. The caller resolves the video from
//      restoreFrom, because the daily pick lives in api/videos.js.
//   4. A pinned video, while the random rotation is switched off.
function chosenFeature(settings, now) {
  const n = settings.now;
  if (n && n.video && Date.parse(n.start) <= now && now < Date.parse(n.end)) {
    return { source: 'now', video: n.video, caption: n.caption || null, until: n.end };
  }
  const o = settings.override;
  if (o && o.video && Date.parse(o.start) <= now && now < Date.parse(o.end)) {
    return { source: 'override', video: o.video, caption: o.caption || null, until: o.end };
  }
  if (settings.random !== false && n && n.restore) {
    const from = Date.parse(n.end), to = from + DAY_MS;
    if (from <= now && now < to) {
      return { source: 'restored', video: null, caption: null, restoreFrom: n.start, until: new Date(to).toISOString() };
    }
  }
  if (!settings.random && settings.pick && settings.pick.video) {
    return { source: 'pinned', video: settings.pick.video, caption: settings.pick.caption || null, until: null };
  }
  return null;
}

// The next moment the answer above can change, so the edge never holds a
// featured video past it. Null when nothing is pending.
function nextChange(settings, now) {
  const n = settings.now, o = settings.override;
  const times = [];
  if (n) {
    times.push(Date.parse(n.start), Date.parse(n.end));
    if (n.restore) times.push(Date.parse(n.end) + DAY_MS);
  }
  if (o) times.push(Date.parse(o.start), Date.parse(o.end));
  const future = times.filter(t => Number.isFinite(t) && t > now);
  return future.length ? Math.min(...future) : null;
}

// Accepts a bare 11-character id or any common YouTube link: watch, youtu.be,
// shorts, embed, live, with or without www or m.
function videoIdFrom(input) {
  const s = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

module.exports = {
  COOKIE, passwordMatches, sessionCookie, clearedCookie, isAdmin, sameOrigin,
  readSettings, writeSettings, readPrivateJSON, writePrivateJSON,
  chosenFeature, nextChange, videoIdFrom, easternDay, skipsFor, hasPassword: () => !!password()
};
