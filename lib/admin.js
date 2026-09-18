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
const DEFAULTS = { random: true, pick: null, override: null, updatedAt: null };

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

async function readSettings() {
  try {
    const r = await get(SETTINGS_PATH, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(await new Response(r.stream).text()) };
  } catch (e) {
    if (e && e.name !== 'BlobNotFoundError') console.error('admin settings read failed:', e.message);
    return { ...DEFAULTS };
  }
}

async function writeSettings(settings) {
  const body = { ...DEFAULTS, ...settings, updatedAt: new Date().toISOString() };
  await put(SETTINGS_PATH, JSON.stringify(body), {
    access: 'private', addRandomSuffix: false, allowOverwrite: true,
    contentType: 'application/json'
  });
  return body;
}

// What the homepage should feature right now, before the daily pick is
// consulted. A scheduled override wins while it runs. Then a pinned video, but
// only while the random rotation is switched off. Null means use the daily pick.
function chosenFeature(settings, now) {
  const o = settings.override;
  if (o && o.video && Date.parse(o.start) <= now && now < Date.parse(o.end)) {
    return { source: 'override', video: o.video, caption: o.caption || null, until: o.end };
  }
  if (!settings.random && settings.pick && settings.pick.video) {
    return { source: 'pinned', video: settings.pick.video, caption: settings.pick.caption || null, until: null };
  }
  return null;
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
  readSettings, writeSettings, chosenFeature, videoIdFrom, hasPassword: () => !!password()
};
