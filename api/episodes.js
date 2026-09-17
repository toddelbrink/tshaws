// GET /api/episodes
// Fetches the ZenCast RSS feed, parses it, returns JSON.
//
// Why this exists: the feed sends no Access-Control-Allow-Origin header
// (verified 2026-09-01 with a browser Origin), so the browser cannot fetch
// the XML directly. The audio files are a separate matter and play fine
// from an <audio> element without this function.
//
// No dependencies. The feed shape is known and verified.

const FEED_URL = 'https://media.zencast.fm/t-shaw-s-progressive-bluegrass/rss';

// Named and numeric XML entities. ZenCast emits &#039; in itunes:* fields
// and raw apostrophes in the plain <title>, so everything gets decoded.
function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos|nbsp|#39));/g,
      (m, dec, hex, name) => {
        if (dec) return String.fromCodePoint(parseInt(dec, 10));
        if (hex) return String.fromCodePoint(parseInt(hex, 16));
        return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[name] || m;
      })
    .replace(/&amp;/g, '&');
}

function stripCdata(s) {
  if (!s) return '';
  const m = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : s;
}

// Exact tag match. `itunes:episode` is a prefix of `itunes:episodeType`, so a
// loose [^>]* pattern silently returns the wrong element. This bit us once.
function tag(xml, name) {
  const re = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

function attr(xml, tagName, attrName) {
  const re = new RegExp('<' + tagName + '\\b([\\s\\S]*?)\\/?>');
  const el = xml.match(re);
  if (!el) return '';
  const a = el[1].match(new RegExp(attrName + '\\s*=\\s*"([^"]*)"'));
  return a ? a[1] : '';
}

function htmlToText(html) {
  return decodeEntities(
    html.replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/p>/gi, ' ')
        .replace(/<[^>]+>/g, '')
  ).replace(/\s+/g, ' ').trim();
}

function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function parseItem(xml) {
  const durationRaw = tag(xml, 'itunes:duration');
  const duration = /^\d+$/.test(durationRaw) ? parseInt(durationRaw, 10) : null;

  const link = decodeEntities(tag(xml, 'link'));
  // Trailing path segment of the ZenCast episode page, used for #deep-links.
  const slug = (link.match(/\/episodes\/([^/?#]+)/) || [])[1] || '';

  const descriptionHtml = stripCdata(tag(xml, 'description')).trim();
  const season = parseInt(tag(xml, 'itunes:season'), 10);
  const episode = parseInt(tag(xml, 'itunes:episode'), 10);
  const pubDate = tag(xml, 'pubDate');
  const published = new Date(pubDate);

  return {
    guid: tag(xml, 'guid'),
    slug,
    season: Number.isFinite(season) ? season : null,
    episode: Number.isFinite(episode) ? episode : null,
    episodeType: tag(xml, 'itunes:episodeType') || 'full',
    title: decodeEntities(tag(xml, 'title')),
    subtitle: decodeEntities(tag(xml, 'itunes:subtitle')),
    descriptionHtml,
    descriptionText: htmlToText(descriptionHtml),
    published: isNaN(published) ? null : published.toISOString(),
    publishedRaw: pubDate,
    duration,
    durationLabel: formatDuration(duration),
    // ?source=feed is ZenCast's download analytics tag. Keep it. Plays from
    // the site then count toward Trevor's numbers, which benefits him.
    audioUrl: decodeEntities(attr(xml, 'enclosure', 'url')),
    audioBytes: parseInt(attr(xml, 'enclosure', 'length'), 10) || null,
    audioType: attr(xml, 'enclosure', 'type') || 'audio/mpeg',
    image: decodeEntities(attr(xml, 'itunes:image', 'href')),
    link
  };
}

module.exports = async (req, res) => {
  try {
    const upstream = await fetch(FEED_URL, {
      headers: { 'user-agent': 'tshaws-site/1.0 (+https://tshaws.elbrink.com)' }
    });
    if (!upstream.ok) {
      res.status(502).json({ error: 'feed_unavailable', status: upstream.status });
      return;
    }

    const xml = await upstream.text();
    const channel = xml.split('<item>')[0];

    const episodes = (xml.match(/<item>[\s\S]*?<\/item>/g) || [])
      .map(parseItem)
      .filter(e => e.audioUrl)
      .sort((a, b) => (b.published || '').localeCompare(a.published || ''));

    const seasons = [...new Set(episodes.map(e => e.season).filter(Boolean))]
      .sort((a, b) => b - a);

    // The feed changes weekly at most. One hour at the edge is plenty, and
    // stale-while-revalidate means a visitor never waits on ZenCast.
    res.setHeader('cache-control', 's-maxage=3600, stale-while-revalidate=86400');

    // ?mode=meta answers "which seasons exist" in a few hundred bytes rather
    // than 97 KB. The season menu in the nav needs nothing else, and it sits
    // on every page including /videos, which otherwise never touches the feed.
    if (req.query && req.query.mode === 'meta') {
      res.status(200).json({
        mode: 'meta',
        title: decodeEntities(tag(channel, 'title')),
        count: episodes.length,
        seasons,
        latest: episodes[0] ? { season: episodes[0].season, episode: episodes[0].episode } : null
      });
      return;
    }

    res.status(200).json({
      show: {
        title: decodeEntities(tag(channel, 'title')),
        description: decodeEntities(tag(channel, 'description')),
        author: decodeEntities(tag(channel, 'itunes:author')),
        image: decodeEntities(attr(channel, 'itunes:image', 'href')),
        link: decodeEntities(tag(channel, 'link')),
        feed: FEED_URL,
        lastBuildDate: tag(channel, 'lastBuildDate')
      },
      count: episodes.length,
      seasons,
      episodes
    });
  } catch (err) {
    res.status(500).json({ error: 'parse_failed', message: String(err && err.message || err) });
  }
};
