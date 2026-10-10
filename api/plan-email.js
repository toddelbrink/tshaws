// /api/plan-email — email a visitor their Ramble plan, as HTML with a plain
// text copy, through Resend. Approved by Todd on 2026-10-08.
//
//   POST { email, plan, own }   plan is the ids joined by dots, as in the plan
//                               link; own is the link's "&own=" part
//
// Nothing is stored. The address is used for this one send and dropped; the
// only thing kept is a count, under a hash of the address, for the limits
// below. The body is built from the schedule, the picked set ids and the
// visitor's own events (since 2026-10-09, Todd's go). Own events are the one
// piece of free text, so they pass the page's own cleanYours() here too: at
// most six, short, no web or email addresses, and escaped in the HTML. The
// limits stop the form from being used to flood someone's inbox.
//
// Needs RESEND_API_KEY (Production, Sensitive): Todd's Resend account, key
// tshaws-ramble, sending access to tshawsprogressivebluegrass.com only.

const crypto = require('crypto');
const { getCache } = require('@vercel/functions');
const { sameOrigin } = require('../lib/admin');
const { build } = require('../lib/plan-email');

const FROM = "T Shaw's Progressive Bluegrass <ramble@tshawsprogressivebluegrass.com>";
const REPLY_TO = 'progressivebluegrass@gmail.com';
const PER_IP = 6;          // sends an hour from one connection
const PER_ADDRESS = 4;     // sends a day to one address
const PER_DAY = 100;       // sends a day in all: Resend's free plan stops at 100 a day anyway
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

function send(res, status, body) {
  res.setHeader('cache-control', 'no-store');
  res.status(status).json(body);
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

// Counts one use against a limit. Returns false once the limit is reached.
async function within(store, key, limit, ttl) {
  const n = (await store.get(key)) || 0;
  if (n >= limit) return false;
  await store.set(key, n + 1, { ttl });
  return true;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!sameOrigin(req)) return send(res, 403, { error: 'forbidden' });

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  // A field people never see. Anything filling it in is a bot; say yes and do nothing.
  if (body.website) return send(res, 200, { ok: true });

  const email = String(body.email || '').trim();
  if (email.length > 254 || !EMAIL.test(email)) {
    return send(res, 400, { error: 'That email address does not look right.' });
  }
  const ids = String(body.plan || '').split('.').filter(Boolean).slice(0, 100);
  const mail = build(ids, undefined, String(body.own || '').slice(0, 4000));
  if (!mail.ids.length && !mail.yours.length) return send(res, 400, { error: 'Pick at least one set first.' });

  const key = process.env.RESEND_API_KEY;
  if (!key) return send(res, 503, { error: 'Email is not set up yet.' });

  const store = getCache();
  const who = crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 32);
  const day = new Date().toISOString().slice(0, 10);
  if (!await within(store, 'plan-mail-ip:' + clientIp(req), PER_IP, 3600)) {
    return send(res, 429, { error: 'That is a lot of emails. Try again in an hour.' });
  }
  if (!await within(store, 'plan-mail-to:' + who + ':' + day, PER_ADDRESS, 86400)) {
    return send(res, 429, { error: 'That address has had a few plans today. Try again tomorrow.' });
  }
  if (!await within(store, 'plan-mail-all:' + day, PER_DAY, 86400)) {
    return send(res, 429, { error: 'Email is busy today. Use Save or send instead.' });
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: [email], reply_to: REPLY_TO,
      subject: mail.subject, html: mail.html, text: mail.text,
      tags: [{ name: 'kind', value: 'ramble-plan' }]
    })
  }).catch(() => null);
  if (!r || !r.ok) {
    const detail = r ? r.status + ' ' + (await r.text()).slice(0, 300) : 'no response';
    console.error('plan-email: resend failed', detail);
    return send(res, 502, { error: 'The email did not go. Use Save or send instead.' });
  }
  return send(res, 200, { ok: true });
};
