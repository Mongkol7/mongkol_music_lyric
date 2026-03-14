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

  const body = req.body || {};
  const videoId = body.videoId;
  const language = body.language || 'en';
  const languageList = Array.isArray(body.languageList) ? body.languageList : [];

  if (!videoId) {
    res.status(400).json({ error: 'Missing videoId' });
    return;
  }

  async function fetchPrimary(lang) {
    const resp = await fetch('https://youtubetranscripts.app/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, language: lang }),
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

    let items = await fetchPrimary(language);
    if (!items || items.length === 0) {
      items = await fetchFallback(body.url || '', language);
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
