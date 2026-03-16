import ytdl from 'ytdl-core';

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
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Missing ELEVENLABS_API_KEY' });
    return;
  }

  const url = body.url || '';
  const rawLyrics = String(body.lyrics || '');

  if (!url || !rawLyrics.trim()) {
    res.status(400).json({ error: 'Missing url or lyrics' });
    return;
  }

  function extractIdFromUrl(inputUrl) {
    try {
      const u = new URL(inputUrl);
      if (u.hostname.includes('youtu.be')) {
        return u.pathname.replace('/', '').trim();
      }
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const paths = u.pathname.split('/').filter(Boolean);
      const embedIdx = paths.indexOf('embed');
      if (embedIdx >= 0 && paths[embedIdx + 1]) return paths[embedIdx + 1];
    } catch (err) {}
    return null;
  }

  const videoId = extractIdFromUrl(url);
  if (!videoId) {
    res.status(400).json({ error: 'Invalid YouTube URL' });
    return;
  }

  const MAX_BYTES = 35 * 1024 * 1024; // ~35MB limit for serverless safety

  function normalizeWord(t) {
    return (t || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .trim();
  }

  function parseLyricsLines(text) {
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  function stripTimestamp(line) {
    return line
      .replace(/^\[\d{1,2}:\d{2}(?:\.\d+)?\]\s*/, '')
      .replace(/^\[\d+(?:\.\d+)?\]\s*/, '');
  }

  function toLrcTime(sec) {
    const s = Math.max(0, sec || 0);
    const m = Math.floor(s / 60);
    const r = (s - m * 60).toFixed(2).padStart(5, '0');
    return `${String(m).padStart(2, '0')}:${r}`;
  }

  function alignLinesToWords(lines, words) {
    const aligned = [];
    let cursor = 0;
    const normalizedWords = words.map((w) => ({
      text: normalizeWord(w.text),
      start: w.start,
    }));

    for (const rawLine of lines) {
      const isSection = /^\[#\s*.+\]$/.test(rawLine);
      if (isSection) {
        aligned.push(rawLine);
        continue;
      }

      const lineText = stripTimestamp(rawLine);
      const lineWords = lineText
        .split(/\s+/)
        .map(normalizeWord)
        .filter(Boolean);
      if (!lineWords.length) continue;

      let startIdx = -1;
      for (let i = cursor; i < normalizedWords.length; i++) {
        if (normalizedWords[i].text === lineWords[0]) {
          startIdx = i;
          break;
        }
      }
      if (startIdx === -1) startIdx = cursor;

      const startTime = normalizedWords[startIdx]
        ? normalizedWords[startIdx].start
        : null;

      // Advance cursor roughly by line word count, allowing skips
      let matches = 0;
      let idx = startIdx;
      while (idx < normalizedWords.length && matches < lineWords.length) {
        if (normalizedWords[idx].text === lineWords[matches]) {
          matches += 1;
        }
        idx += 1;
      }
      cursor = Math.max(cursor, idx);

      if (startTime !== null && isFinite(startTime)) {
        aligned.push(`[${toLrcTime(startTime)}] ${lineText}`);
      }
    }

    return aligned.join('\n');
  }

  try {
    const info = await ytdl.getInfo(videoId);
    const format = ytdl.chooseFormat(info.formats, {
      quality: 'lowestaudio',
      filter: 'audioonly',
    });
    const length = parseInt(format.contentLength || '0', 10);
    if (length && length > MAX_BYTES) {
      res.status(413).json({ error: 'Audio too large for alignment' });
      return;
    }

    const stream = ytdl.downloadFromInfo(info, { format });
    const chunks = [];
    let total = 0;
    for await (const chunk of stream) {
      total += chunk.length;
      if (total > MAX_BYTES) {
        res.status(413).json({ error: 'Audio too large for alignment' });
        return;
      }
      chunks.push(chunk);
    }
    const audioBuffer = Buffer.concat(chunks);

    const form = new FormData();
    const mime = (format.mimeType || 'audio/mpeg').split(';')[0];
    const blob = new Blob([audioBuffer], { type: mime });
    form.append('file', blob, 'audio');
    form.append('text', rawLyrics);
    form.append('enabled_spooled_file', 'true');

    const resp = await fetch('https://api.elevenlabs.io/v1/forced-alignment', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
    });
    if (!resp.ok) {
      const t = await resp.text();
      res.status(500).json({ error: 'Alignment failed', details: t });
      return;
    }
    const data = await resp.json();
    const words = Array.isArray(data?.words) ? data.words : [];
    if (!words.length) {
      res.status(500).json({ error: 'No alignment words returned' });
      return;
    }

    const lines = parseLyricsLines(rawLyrics);
    const lrc = alignLinesToWords(lines, words);
    if (!lrc) {
      res.status(500).json({ error: 'Unable to align lines' });
      return;
    }

    res.status(200).json({ lrc, loss: data?.loss ?? null });
  } catch (err) {
    res.status(500).json({ error: 'Alignment failed' });
  }
}
