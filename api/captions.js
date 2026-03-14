export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body =
    typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const videoId = body.videoId;
  const language = body.language || 'en';
  const languageList = Array.isArray(body.languageList) ? body.languageList : [];

  if (!videoId) {
    res.status(400).json({ error: 'Missing videoId' });
    return;
  }

  async function fetchPrimary(lang) {
    const payload = lang && lang !== 'auto' ? { videoId, language: lang } : { videoId };
    const resp = await fetch('https://youtubetranscripts.app/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const items = data?.transcript || data?.captions || data?.segments;
    return Array.isArray(items) ? items : null;
  }

  async function fetchFallback(url, lang) {
    const payload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'get_transcript',
        arguments: { url, language: lang },
      },
    };
    const resp = await fetch(
      'https://youtube-transcript-mcp.ergut.workers.dev/mcp',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const resData = data?.result ?? data;
    const candidate =
      resData?.transcript ||
      resData?.segments ||
      resData?.captions ||
      resData?.content ||
      resData;
    if (Array.isArray(candidate)) return candidate;
    if (candidate?.text) {
      try {
        const parsed = JSON.parse(candidate.text);
        if (Array.isArray(parsed)) return parsed;
        if (Array.isArray(parsed?.transcript)) return parsed.transcript;
      } catch (err) {}
    }
    return null;
  }

  async function fetchAlt(videoId) {
    const resp = await fetch(
      `https://youtubetranscript.com/?server_vid2=${encodeURIComponent(videoId)}`,
      { method: 'GET' },
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const items = data?.transcript || data?.captions || data;
    return Array.isArray(items) ? items : null;
  }

  function decodeXml(text) {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  function parseTimedTextXml(xml) {
    if (!xml) return null;
    const items = [];
    const re = /<text[^>]*start="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g;
    let match;
    while ((match = re.exec(xml))) {
      const start = parseFloat(match[1]);
      const text = decodeXml(match[2].replace(/\s+/g, ' ').trim());
      if (!text || !isFinite(start)) continue;
      items.push({ start, text });
    }
    return items.length ? items : null;
  }

  async function fetchTimedText(videoId, lang, asr = false) {
    const url = new URL('https://video.google.com/timedtext');
    url.searchParams.set('v', videoId);
    if (lang && lang !== 'auto') url.searchParams.set('lang', lang);
    if (asr) url.searchParams.set('kind', 'asr');
    const resp = await fetch(url.toString(), { method: 'GET' });
    if (!resp.ok) return null;
    const xml = await resp.text();
    return parseTimedTextXml(xml);
  }

  try {
    if (languageList.length) {
      const detected = [];
      for (const code of languageList) {
        try {
          const items = await fetchPrimary(code);
          if (items && items.length) detected.push(code);
        } catch (err) {}
      }
      res.status(200).json({ languages: detected });
      return;
    }

    const langAttempts = Array.from(
      new Set([language, 'en', 'en-US', 'en-GB', 'auto']),
    );
    let items = null;
    for (const lang of langAttempts) {
      items = await fetchPrimary(lang);
      if (items && items.length) break;
    }
    if (!items || items.length === 0) {
      for (const lang of langAttempts) {
        items = await fetchFallback(body.url || '', lang);
        if (items && items.length) break;
      }
    }
    if (!items || items.length === 0) {
      items = await fetchAlt(videoId);
    }
    if (!items || items.length === 0) {
      for (const lang of langAttempts) {
        items = await fetchTimedText(videoId, lang, false);
        if (items && items.length) break;
      }
    }
    if (!items || items.length === 0) {
      for (const lang of langAttempts) {
        items = await fetchTimedText(videoId, lang, true);
        if (items && items.length) break;
      }
    }
    if (!items || items.length === 0) {
      res.status(404).json({ error: 'No captions found' });
      return;
    }
    res.status(200).json({ items });
  } catch (err) {
    res.status(500).json({ error: 'Caption fetch failed' });
  }
}
