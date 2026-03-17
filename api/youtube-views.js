const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map();

function isValidId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{6,20}$/.test(id);
}

function formatViews(num) {
  try {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(num);
  } catch (err) {
    return String(num);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const videoId = req.query?.id;
  if (!isValidId(videoId)) {
    res.status(400).json({ error: 'Invalid video id' });
    return;
  }

  const cached = cache.get(videoId);
  const now = Date.now();
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    res.status(200).json({ views: cached.views, formatted: cached.formatted, cached: true });
    return;
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Missing API key' });
    return;
  }

  try {
    const url =
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(videoId)}&key=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      res.status(502).json({ error: 'YouTube API error' });
      return;
    }
    const data = await resp.json();
    const item = Array.isArray(data?.items) && data.items.length ? data.items[0] : null;
    const rawViews = item?.statistics?.viewCount;
    const views = Number(rawViews);
    if (!Number.isFinite(views)) {
      res.status(502).json({ error: 'No view count' });
      return;
    }
    const formatted = formatViews(views);
    cache.set(videoId, { views, formatted, ts: now });
    res.status(200).json({ views, formatted, cached: false });
  } catch (err) {
    res.status(502).json({ error: 'Fetch failed' });
  }
}
