// GET /api/warm
// Cron target. Fetches the slow /api/videos modes so the edge cache is
// already populated before a visitor asks for them.
//
// Why this exists. Measured 2026-09-07: mode=index takes 27s cold and 0.29s
// warm, because building it walks the whole 3,148-video archive. A search on a
// cold cache looks broken. The index build itself is now half that, but nobody
// should ever pay it.
//
// The edge cache is keyed per deployment, so every push to main starts cold.
// This cron narrows the window to the gap between a deploy and the next run.
// Since 2026-09-18 mode=index is also kept in the Runtime Cache (videos.js),
// which survives deploys, so a cold edge there costs a store read, not a
// rebuild. This run also triggers the rebuild once the stored copy is stale.
//
// CAVEAT, measured 2026-09-11: the HIT this endpoint reports is not the cache a
// visitor reads. It reported HIT for mode=index in 90ms while an external
// request for the same URL seconds later took 9.8s and reported MISS. A fetch
// made from inside the function populates its own region's cache, not the edge
// node the visitor reaches. The three external requests after that MISS were
// all HITs, so an external request does warm the right cache.
//
// So: warm after a push by curling the index URL directly, not this endpoint.
// This still runs on the cron and still costs nothing,
// but its report is not evidence that visitors are covered.

module.exports = async (req, res) => {
  // Vercel sends CRON_SECRET as a bearer token when the variable is set.
  // If it is not set the endpoint is open, which is acceptable: every call
  // it makes is a cached GET against this same deployment.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const base = `https://${req.headers.host}`;
  const targets = ['/api/videos?mode=index', '/api/videos?mode=shows', '/api/videos',
                   '/api/episodes', '/api/episodes?mode=meta'];
  const startedAt = Date.now();

  const warmed = await Promise.all(targets.map(async (path) => {
    const t = Date.now();
    try {
      const r = await fetch(base + path, { headers: { 'user-agent': 'tshaws-warm/1.0' } });
      await r.arrayBuffer();   // drain it, or the transfer may not complete
      return { path, status: r.status, cache: r.headers.get('x-vercel-cache'), ms: Date.now() - t };
    } catch (e) {
      return { path, error: String(e.message || e), ms: Date.now() - t };
    }
  }));

  res.setHeader('cache-control', 'no-store');
  res.status(200).json({ ok: warmed.every(w => w.status === 200), elapsedMs: Date.now() - startedAt, warmed });
};
