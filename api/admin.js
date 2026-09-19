// /api/admin — the admin page's server side. One password, no accounts.
//
//   GET                         { admin, configured, settings? }
//   POST { action: 'login', password }
//   POST { action: 'logout' }
//   POST { action: 'lookup', link }            resolve a YouTube link or id
//   POST { action: 'save', random, pick, override }
//   POST { action: 'polish', text }            rewrite a caption with Claude
//
// Every POST must come from this site (Origin check), and every action but
// login needs the session cookie. The refresh button lives in
// /api/videos?mode=refresh, because the index builder lives there.

const {
  passwordMatches, sessionCookie, clearedCookie, isAdmin, sameOrigin,
  readSettings, writeSettings, videoIdFrom, hasPassword
} = require('../lib/admin');
const { getCache, dangerouslyDeleteByTag } = require('@vercel/functions');
const AnthropicSDK = require('@anthropic-ai/sdk');
const Anthropic = AnthropicSDK.default || AnthropicSDK;

const MAX_FAILS = 8;          // wrong passwords from one address...
const LOCK_S = 15 * 60;       // ...lock that address out for fifteen minutes
// Measured under the featured video: 160 characters is four lines on a 360px
// phone and three on a laptop. The page also clamps the caption to four lines.
const CAPTION_MAX = 160;
// A draft may run longer. Polish exists to cut it down, and Save refuses
// anything still over CAPTION_MAX.
const DRAFT_MAX = 600;

function send(res, status, body, cookie) {
  res.setHeader('cache-control', 'no-store');
  if (cookie) res.setHeader('set-cookie', cookie);
  res.status(status).json(body);
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

function captionOf(slot) {
  return String((slot && slot.caption) || '').trim() || null;
}

function isoOrNull(v) {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// Look the video up on YouTube. Unlisted videos come back by id even though
// they never appear in the channel's upload list, which is what makes the
// "exclusive, only on my site" feature possible.
async function lookupVideo(link) {
  const id = videoIdFrom(link);
  if (!id) return { error: 'That does not look like a YouTube link.' };
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'snippet,contentDetails,status');
  url.searchParams.set('id', id);
  url.searchParams.set('key', process.env.YOUTUBE_API_KEY || '');
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  const v = d.items && d.items[0];
  if (!r.ok || !v) return { error: 'YouTube did not find that video. Is it private or deleted?' };
  if (v.status.privacyStatus === 'private') return { error: 'That video is private. Make it unlisted or public first.' };
  if (v.status.embeddable === false) return { error: 'That video does not allow playing on other websites.' };
  const t = v.snippet.thumbnails || {};
  const thumb = ['maxres', 'standard', 'high', 'medium', 'default'].map(k => t[k]).find(x => x && x.url);
  const m = String(v.contentDetails.duration || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  const sec = m ? (+(m[1] || 0) * 86400) + (+(m[2] || 0) * 3600) + (+(m[3] || 0) * 60) + +(m[4] || 0) : 0;
  const label = sec >= 3600
    ? `${Math.floor(sec / 3600)}:${String(Math.floor(sec % 3600 / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
    : sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '';
  return {
    video: {
      id: v.id, title: v.snippet.title, published: v.snippet.publishedAt,
      channel: v.snippet.channelTitle, privacy: v.status.privacyStatus,
      thumbnail: thumb ? { url: thumb.url, width: thumb.width || null, height: thumb.height || null } : null,
      duration: sec || null, durationLabel: label
    }
  };
}

async function polish(text) {
  if (!process.env.ANTHROPIC_API_KEY) return { status: 503, body: { error: 'The Claude key is not set up yet.' } };
  const client = new Anthropic();
  const request = {
      model: 'claude-opus-5',
      max_tokens: 2000,
      output_config: { effort: 'low' },
      system:
        "You polish short captions for T Shaw's Progressive Bluegrass, a bluegrass video and podcast site " +
        "run by Trevor Shaw. He describes himself this way: \"I document and share all things bluegrass.\" " +
        'Tighten the caption he gives you so it reads cleanly in his own voice: warm, direct, excited about ' +
        'the music, conversational rather than promotional. Fix spelling and grammar. Only ever cut or ' +
        'rephrase: never add words, details, facts or sentences, and keep every name and date exactly as ' +
        'written. Your version must be no longer than his draft and must be ' + CAPTION_MAX +
        ' characters or fewer, so a long draft gets cut down to its best one or two sentences. ' +
        'Do not add hashtags, emojis or quotation marks. Reply with the caption text only.',
      messages: [{ role: 'user', content: text }]
  };
  try {
    let msg;
    try {
      // Server-side fallback: if the model declines, another finishes the job.
      msg = await client.beta.messages.create({
        ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default'
      });
    } catch (e) {
      // Measured 2026-09-18: the first live call returned 400. The fallback
      // option is newer and not enabled on every account, so a 400 retries
      // once as a plain request rather than failing the button.
      if (!(e instanceof Anthropic.BadRequestError)) throw e;
      console.error('polish with fallbacks rejected, retrying plain:', e.message);
      msg = await client.messages.create(request);
    }
    if (msg.stop_reason === 'refusal') return { status: 422, body: { error: 'Claude would not rewrite that one. Edit it by hand.' } };
    const out = msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!out) return { status: 502, body: { error: 'Claude returned nothing. Try again.' } };
    // Polish only ever tightens. A few characters of slack covers a fixed
    // apostrophe or a comma; anything longer than that is padding, so it is
    // refused rather than shown.
    if (out.length > text.length + 3) {
      return { status: 422, body: { error: 'Claude\u2019s version came out longer than yours, so it was not used.' } };
    }
    if (out.length > CAPTION_MAX) {
      return { status: 422, body: { error: `Claude could not get it under ${CAPTION_MAX} characters. Trim it a little and try again.` } };
    }
    return { status: 200, body: { text: out } };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { status: 429, body: { error: 'Claude is busy. Try again in a minute.' } };
    if (e instanceof Anthropic.AuthenticationError) return { status: 503, body: { error: 'The Claude key was rejected. Check it in Vercel.' } };
    if (e instanceof Anthropic.APIError) {
      // Anthropic's own reason, so a failure can be diagnosed from the page.
      const why = e.error && e.error.error && e.error.error.message;
      console.error('polish failed:', e.status, why || e.message);
      return { status: 502, body: { error: `Claude error ${e.status}${why ? ': ' + why : ''}` } };
    }
    return { status: 502, body: { error: 'Could not reach Claude. Try again.' } };
  }
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const admin = isAdmin(req);
    return send(res, 200, {
      admin, configured: hasPassword(), polish: !!process.env.ANTHROPIC_API_KEY,
      settings: admin ? await readSettings() : undefined
    });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!sameOrigin(req)) return send(res, 403, { error: 'forbidden' });

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const action = body.action;

  if (action === 'login') {
    if (!hasPassword()) return send(res, 503, { error: 'The admin password is not set up yet.' });
    const store = getCache();
    const key = 'admin-fails:' + clientIp(req);
    const fails = (await store.get(key)) || 0;
    if (fails >= MAX_FAILS) return send(res, 429, { error: 'Too many wrong passwords. Try again in 15 minutes.' });
    if (!passwordMatches(body.password)) {
      await store.set(key, fails + 1, { ttl: LOCK_S });
      await new Promise(r => setTimeout(r, 700));   // slows guessing further
      return send(res, 401, { error: 'That password is not right.' });
    }
    await store.delete(key);
    return send(res, 200, { ok: true }, sessionCookie());
  }

  if (action === 'logout') return send(res, 200, { ok: true }, clearedCookie());

  if (!isAdmin(req)) return send(res, 401, { error: 'Please log in again.' });

  if (action === 'lookup') {
    const r = await lookupVideo(body.link);
    return send(res, r.error ? 400 : 200, r);
  }

  if (action === 'polish') {
    const text = String(body.text || '').trim();
    if (!text) return send(res, 400, { error: 'Write a caption first.' });
    if (text.length > DRAFT_MAX) return send(res, 400, { error: `That draft is over ${DRAFT_MAX} characters. Shorten it first.` });
    const r = await polish(text);
    return send(res, r.status, r.body);
  }

  if (action === 'save') {
    for (const slot of [body.pick, body.override]) {
      if (slot && String(slot.caption || '').trim().length > CAPTION_MAX) {
        return send(res, 400, { error: `Captions can be up to ${CAPTION_MAX} characters.` });
      }
    }
    const next = { random: body.random !== false, pick: null, override: null };

    if (body.pick && body.pick.link) {
      const r = await lookupVideo(body.pick.link);
      if (r.error) return send(res, 400, { error: 'Pinned video: ' + r.error });
      next.pick = { video: r.video, caption: captionOf(body.pick) };
    }
    if (!next.random && !next.pick) {
      return send(res, 400, { error: 'With the random video switched off, pick a video to show instead.' });
    }

    if (body.override && body.override.link) {
      const start = isoOrNull(body.override.start), end = isoOrNull(body.override.end);
      if (!start || !end || Date.parse(end) <= Date.parse(start)) {
        return send(res, 400, { error: 'The scheduled video needs a start and an end, with the end after the start.' });
      }
      const r = await lookupVideo(body.override.link);
      if (r.error) return send(res, 400, { error: 'Scheduled video: ' + r.error });
      next.override = { video: r.video, start, end, caption: captionOf(body.override) };
    }

    const saved = await writeSettings(next);
    // The homepage asks for the featured video through the edge cache. Drop
    // that copy so the change shows on the next visit, not up to 5 minutes on.
    try { await dangerouslyDeleteByTag('featured'); } catch (e) { console.error('featured purge failed:', e.message); }
    return send(res, 200, { ok: true, settings: saved });
  }

  return send(res, 400, { error: 'unknown_action' });
};
