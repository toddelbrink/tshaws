// GET /api/videos
// Proxies the YouTube Data API v3 so the API key never reaches the browser.
//
// Cost discipline (SETUP.md): playlistItems.list, videos.list and
// playlists.list are 1 unit each and return up to 50 items. search.list is
// 100 units and returns less. It is never used here.
//
// Shape of the real archive, measured 2026-09-01:
//   3,147 uploads spanning 2014-2026
//   85 playlists holding 1,429 of them, each playlist being one concert
//      split into songs
// A single response carrying everything is 1.2 MB and takes 22 seconds.
// That is why this endpoint has modes instead of one payload.
//
//   /api/videos                      first page of all uploads + nextPage cursor
//   /api/videos?page=TOKEN           subsequent pages
//   /api/videos?mode=shows           the concert playlists, with covers
//   /api/videos?mode=show&id=PLID    the videos inside one concert
//   /api/videos?mode=index           lite index of every upload, for search
//   /api/warm                        cron target, keeps the caches above hot

const CHANNEL_ID = 'UCDS7usPBxVlwfWbM5euFhWQ';
const UPLOADS_PLAYLIST = 'UU' + CHANNEL_ID.slice(2);
const API = 'https://www.googleapis.com/youtube/v3';
const PAGE_SIZE = 50;

// The channel's own show playlist is not a concert. Verified 2026-09-01:
// 31 of its 32 live entries are podcast episodes that also exist in the RSS
// feed, matching audio duration to the second. It stays in the response and
// is tagged, not hidden, so the design can offer Watch alongside Listen on
// the episode rows instead of filing it beside the live shows.
const PODCAST_PLAYLIST_ID = 'PLw21tIo6r9GxGkY-mUWx0PUeMANAKYjE4';
const INDEX_MAX_PAGES = 80;   // 4000 videos. Headroom over the current 3,147.
const SHOW_MAX_PAGES = 6;     // 300 videos in one concert. Largest today is 50.

// The index is kept in Vercel's Runtime Cache as well as the edge cache.
// The edge copy was lost on every push and during quiet spells, and each loss
// cost a visitor a 13 to 20 second rebuild: 63 YouTube pages walked in order.
// The Runtime Cache sits beside the function and survives deployments, so a
// lost edge copy now costs one store read. Past INDEX_FRESH_MS the stored copy
// is still served at once and rebuilt after the response. Off Vercel the
// library falls back to an in-memory cache, and failed reads or writes are
// logged, not thrown, so the worst case is the old behavior.
const { getCache, waitUntil } = require('@vercel/functions');
// Bump the version whenever the index's shape changes. The stored copy
// outlives deploys, so an old shape would otherwise be served for hours.
const INDEX_KEY = 'video-index:v1';
const INDEX_LOCK = 'video-index:v1:rebuilding';
const INDEX_FRESH_MS = 6 * 3600 * 1000;
const INDEX_KEEP_S = 30 * 86400;   // a month-old index still beats a 20s wait

// The store has no atomic claim, so two stale requests arriving together could
// both see no lock and both rebuild, doubling the 126 quota units. Each writes
// its own ticket and reads it back, and only the last writer rebuilds.
async function claimRebuild(store) {
  if (await store.get(INDEX_LOCK)) return false;
  const ticket = Math.random().toString(36).slice(2);
  await store.set(INDEX_LOCK, { ticket }, { ttl: 300 });
  const held = await store.get(INDEX_LOCK);
  return !!held && held.ticket === ticket;
}

function parseIsoDuration(iso) {
  if (!iso) return null;
  const m = iso.match(/^P(?:([\d.]+)D)?T?(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?$/);
  if (!m) return null;
  const [, d, h, min, s] = m;
  const t = (parseFloat(d || 0) * 86400) + (parseFloat(h || 0) * 3600) +
            (parseFloat(min || 0) * 60) + parseFloat(s || 0);
  return Number.isFinite(t) && t > 0 ? Math.round(t) : null;
}

function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
               : `${m}:${String(s).padStart(2,'0')}`;
}

// Not every video has maxres. Walk down rather than shipping a broken <img>.
function pickThumb(t) {
  if (!t) return null;
  for (const k of ['maxres', 'standard', 'high', 'medium', 'default']) {
    if (t[k] && t[k].url) return { url: t[k].url, width: t[k].width || null, height: t[k].height || null, size: k };
  }
  return null;
}

// Private and deleted uploads linger in playlists as tombstones.
function isLive(it) {
  const t = it.snippet && it.snippet.title;
  return it.contentDetails && it.contentDetails.videoId && t &&
         t !== 'Private video' && t !== 'Deleted video' &&
         it.snippet.thumbnails && Object.keys(it.snippet.thumbnails).length > 0;
}

module.exports = async (req, res) => {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    res.status(500).json({
      error: 'missing_api_key',
      message: 'YOUTUBE_API_KEY is not set on this deployment. Add it in Vercel project settings and redeploy.'
    });
    return;
  }

  const startedAt = Date.now();
  let units = 0;

  async function yt(path, params) {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('key', key);
    const r = await fetch(url);
    const body = await r.json().catch(() => ({}));
    units++;
    if (!r.ok) {
      // Surface YouTube's reason. Never the key, never the full URL.
      const e = new Error((body.error && body.error.message) || 'youtube_request_failed');
      e.httpStatus = r.status;
      e.reason = body.error && body.error.errors && body.error.errors[0]
        ? body.error.errors[0].reason : 'unknown';
      throw e;
    }
    return body;
  }

  // playlistItems carries no duration and no view count. Backfill in 50s.
  // videos.list takes 50 ids per call, so a page needs one call and the whole
  // archive needs 63. Those calls do not depend on each other, unlike the
  // playlist pagination above, which has to walk nextPageToken in order.
  // Running them in parallel is the difference between 13 seconds and 2.
  async function hydrate(ids, concurrency) {
    const chunks = [];
    for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
    const out = new Map();
    let next = 0;
    async function worker() {
      while (next < chunks.length) {
        const mine = chunks[next++];
        const d = await yt('/videos', { part: 'contentDetails,statistics,status', id: mine.join(',') });
        for (const v of (d.items || [])) out.set(v.id, v);
      }
    }
    const lanes = Math.max(1, Math.min(concurrency || 1, chunks.length));
    await Promise.all(Array.from({ length: lanes }, worker));
    return out;
  }

  function shape(it, detail) {
    const id = it.contentDetails.videoId;
    const sn = it.snippet;
    const d = detail && detail.get(id);
    const sec = d ? parseIsoDuration(d.contentDetails && d.contentDetails.duration) : null;
    return {
      id,
      title: sn.title,
      description: sn.description || '',
      published: it.contentDetails.videoPublishedAt || sn.publishedAt || null,
      thumbnail: pickThumb(sn.thumbnails),
      duration: sec,
      durationLabel: formatDuration(sec),
      viewCount: d && d.statistics && d.statistics.viewCount ? parseInt(d.statistics.viewCount, 10) : null,
      // Authoritative: whether YouTube will let this play in an iframe at all.
      embeddable: d && d.status ? d.status.embeddable !== false : null,
      privacyStatus: d && d.status ? d.status.privacyStatus : null,
      regionRestricted: !!(d && d.contentDetails && d.contentDetails.regionRestriction),
      // Inline playback. Visitors are never sent to YouTube.
      embedUrl: `https://www.youtube.com/embed/${id}?rel=0&playsinline=1`
    };
  }

  // Lite index of everything, for client-side search and /videos/all.
  // No descriptions, no thumbnail objects, no view counts. The grid fetches
  // detail per page. This exists so search can span all 3,147 at once.
  async function buildIndex() {
    const builtStart = Date.now();
    const unitsBefore = units;
    const items = [];
    let token = '', pages = 0, truncated = false;
    do {
      const p = await yt('/playlistItems', {
        part: 'snippet,contentDetails', playlistId: UPLOADS_PLAYLIST,
        maxResults: String(PAGE_SIZE), ...(token ? { pageToken: token } : {})
      });
      items.push(...(p.items || []));
      token = p.nextPageToken || '';
      if (token && ++pages >= INDEX_MAX_PAGES) { truncated = true; break; }
    } while (token);

    // Duration was dropped from this mode on 2026-09-07 to halve a 27s cold
    // build, when the index only fed search. It is back, because /videos/all
    // now renders from this index so it can filter by year, and that grid is
    // the main way into the archive. The 63 lookups run in parallel now, so
    // they cost seconds rather than the 13 they used to.
    const live = items.filter(isLive);
    const detail = await hydrate(live.map(i => i.contentDetails.videoId), 8);
    const videos = live.map(i => {
      const d = detail.get(i.contentDetails.videoId);
      return {
        i: i.contentDetails.videoId,
        t: i.snippet.title,
        p: (i.contentDetails.videoPublishedAt || i.snippet.publishedAt || '').slice(0, 10),
        d: d ? parseIsoDuration(d.contentDetails && d.contentDetails.duration) : null
      };
    }).sort((a, b) => b.p.localeCompare(a.p));

    return {
      mode: 'index', count: videos.length, truncated,
      skipped: items.length - live.length,
      quotaUnitsUsed: units - unitsBefore, elapsedMs: Date.now() - builtStart,
      builtAt: new Date().toISOString(),
      // Thumbnails are derivable: https://i.ytimg.com/vi/<id>/hqdefault.jpg
      fields: { i: 'videoId', t: 'title', p: 'publishedDate', d: 'durationSeconds' },
      videos
    };
  }


  const mode = (req.query && req.query.mode) || 'page';
  const SIX_HOURS = 's-maxage=21600, stale-while-revalidate=604800';

  try {
    // ---- The 85 concerts -------------------------------------------------
    if (mode === 'shows') {
      let shows = [];
      let token = '', pages = 0;
      do {
        const pl = await yt('/playlists', {
          part: 'snippet,contentDetails', channelId: CHANNEL_ID, maxResults: '50',
          ...(token ? { pageToken: token } : {})
        });
        shows.push(...(pl.items || []).map(p => ({
          id: p.id,
          title: p.snippet.title,
          description: p.snippet.description || '',
          published: p.snippet.publishedAt || null,
          thumbnail: pickThumb(p.snippet.thumbnails),
          itemCount: p.contentDetails ? p.contentDetails.itemCount : null,
          kind: p.id === PODCAST_PLAYLIST_ID ? 'podcast' : 'concert'
        })));
        token = pl.nextPageToken || '';
      } while (token && ++pages < 20);

      // A playlist keeps its itemCount after its videos go private or are
      // deleted, so a dead show still advertises "10 videos" and then opens
      // empty. YouTube serves a placeholder thumbnail in that case, which is
      // the cheapest reliable signal without a request per playlist.
      // One of 85 was in this state on 2026-09-01.
      const usable = shows.filter(s =>
        s.thumbnail && s.thumbnail.url && s.thumbnail.url.indexOf('no_thumbnail') === -1);
      const hidden = shows.length - usable.length;
      shows = usable;

      shows.sort((a, b) => (b.published || '').localeCompare(a.published || ''));
      res.setHeader('cache-control', SIX_HOURS);
      const concerts = shows.filter(s => s.kind === 'concert');
      res.status(200).json({
        mode, count: shows.length,
        hiddenEmptyShows: hidden,
        concertCount: concerts.length,
        totalVideosInShows: shows.reduce((n, s) => n + (s.itemCount || 0), 0),
        podcastPlaylistId: PODCAST_PLAYLIST_ID,
        quotaUnitsUsed: units, elapsedMs: Date.now() - startedAt, shows
      });
      return;
    }

    // ---- One concert -----------------------------------------------------
    if (mode === 'show') {
      const id = req.query && req.query.id;
      if (!id || !/^[A-Za-z0-9_-]{10,64}$/.test(id)) {
        res.status(400).json({ error: 'bad_playlist_id' });
        return;
      }
      const items = [];
      let token = '', pages = 0;
      do {
        const p = await yt('/playlistItems', {
          part: 'snippet,contentDetails', playlistId: id, maxResults: String(PAGE_SIZE),
          ...(token ? { pageToken: token } : {})
        });
        items.push(...(p.items || []));
        token = p.nextPageToken || '';
      } while (token && ++pages < SHOW_MAX_PAGES);

      const live = items.filter(isLive);
      const detail = await hydrate(live.map(i => i.contentDetails.videoId));
      // Playlist order is the running order of the show. Do not re-sort.
      res.setHeader('cache-control', SIX_HOURS);
      res.status(200).json({
        mode, playlistId: id,
        kind: id === PODCAST_PLAYLIST_ID ? 'podcast' : 'concert',
        count: live.length,
        skipped: items.length - live.length,
        quotaUnitsUsed: units, elapsedMs: Date.now() - startedAt,
        videos: live.map(i => shape(i, detail))
      });
      return;
    }

    // ---- Lite index of everything, served from the store when it can be ----
    if (mode === 'index') {
      // The edge keeps it an hour, not six. A miss now costs one store read,
      // and a shorter edge life keeps a background rebuild from being hidden
      // behind a stale edge copy for another six hours.
      const INDEX_EDGE = 's-maxage=3600, stale-while-revalidate=604800';
      const store = getCache();
      const kept = await store.get(INDEX_KEY);

      if (kept && Array.isArray(kept.videos)) {
        const age = Date.now() - Date.parse(kept.builtAt);
        if (!(age < INDEX_FRESH_MS) && await claimRebuild(store)) {
          waitUntil(buildIndex()
            .then(fresh => store.set(INDEX_KEY, fresh, { ttl: INDEX_KEEP_S }))
            .catch(e => console.error('index rebuild failed:', e.message))
            .finally(() => store.delete(INDEX_LOCK)));
        }
        res.setHeader('cache-control', INDEX_EDGE);
        res.status(200).json({ ...kept, source: 'store' });
        return;
      }

      const fresh = await buildIndex();
      await store.set(INDEX_KEY, fresh, { ttl: INDEX_KEEP_S });
      res.setHeader('cache-control', INDEX_EDGE);
      res.status(200).json({ ...fresh, source: 'youtube' });
      return;
    }

    // ---- Default: one page of the full upload stream ---------------------
    const pageToken = (req.query && req.query.page) || '';
    const p = await yt('/playlistItems', {
      part: 'snippet,contentDetails', playlistId: UPLOADS_PLAYLIST,
      maxResults: String(PAGE_SIZE), ...(pageToken ? { pageToken } : {})
    });
    const live = (p.items || []).filter(isLive);
    const detail = await hydrate(live.map(i => i.contentDetails.videoId));

    res.setHeader('cache-control', SIX_HOURS);
    res.status(200).json({
      mode: 'page',
      channel: { id: CHANNEL_ID, uploadsPlaylist: UPLOADS_PLAYLIST },
      total: (p.pageInfo && p.pageInfo.totalResults) || null,
      count: live.length,
      skipped: (p.items || []).length - live.length,
      nextPage: p.nextPageToken || null,
      quotaUnitsUsed: units, elapsedMs: Date.now() - startedAt,
      videos: live.map(i => shape(i, detail))
    });
  } catch (err) {
    // Say whose fault it is. A stale link to a deleted playlist, or a mangled
    // page cursor, is YouTube answering 400 "invalid" to a bad request, and
    // reporting that as 500 claims the server broke when it did not. Found
    // 2026-09-07: a nonexistent playlist id returned 500. 403 stays 502
    // because that is a real upstream problem, quota or key.
    const upstream = err.httpStatus;
    const status = upstream === 403 ? 502
                 : (upstream === 400 || upstream === 404) ? 404
                 : 500;
    res.status(status).json({
      error: status === 404 ? 'not_found' : 'youtube_request_failed',
      reason: err.reason || null, status: upstream || null,
      message: String(err.message || err)
    });
  }
};
