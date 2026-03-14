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
    const normalizedWords = words
      .map((w) => ({
        text: normalizeWord(w.text),
        start: w.start,
      }))
      .filter((w) => w.text);

    const entries = lines.map((raw) => {
      const isSection = /^\[#\s*.+\]$/.test(raw);
      const lineText = stripTimestamp(raw);
      const lineWords = lineText
        .split(/\s+/)
        .map(normalizeWord)
        .filter(Boolean);
      return {
        raw,
        isSection,
        text: lineText,
        words: lineWords,
        time: null,
        matched: false,
      };
    });

    function findBestMatch(lineWords, cursor) {
      if (!lineWords.length) return null;
      const wordSet = new Set(lineWords);
      const total = normalizedWords.length;
      const windows = [300, 900];
      const scanMax = Math.max(20, lineWords.length * 6);

      const scoreAt = (startIdx) => {
        let matches = 0;
        let idx = startIdx;
        let lastMatch = startIdx;
        for (let w = 0; w < lineWords.length; w++) {
          const target = lineWords[w];
          let advanced = 0;
          while (idx < total && advanced < scanMax) {
            if (normalizedWords[idx].text === target) {
              matches += 1;
              lastMatch = idx;
              idx += 1;
              break;
            }
            idx += 1;
            advanced += 1;
          }
        }
        return { matches, lastMatch };
      };

      for (const win of windows) {
        let best = null;
        const end = Math.min(total, cursor + win);
        for (let i = cursor; i < end; i++) {
          if (normalizedWords[i].text !== lineWords[0]) continue;
          const { matches, lastMatch } = scoreAt(i);
          if (!best || matches > best.matches) {
            best = { idx: i, matches, lastMatch };
          }
        }
        if (!best) {
          for (let i = cursor; i < end; i++) {
            if (!wordSet.has(normalizedWords[i].text)) continue;
            const { matches, lastMatch } = scoreAt(i);
            if (!best || matches > best.matches) {
              best = { idx: i, matches, lastMatch };
            }
          }
        }
        if (best && best.matches >= Math.max(2, Math.ceil(lineWords.length * 0.3))) {
          return best;
        }
      }
      return null;
    }

    let cursor = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.isSection || !entry.words.length) continue;

      const best = findBestMatch(entry.words, cursor);
      if (best && normalizedWords[best.idx]) {
        entry.time = normalizedWords[best.idx].start;
        entry.matched = true;
        cursor = Math.max(cursor, best.lastMatch + 1);
      }
    }

    const STEP = 0.6;
    let lastGlobalTime = 0;
    let idx = 0;
    while (idx < entries.length) {
      if (entries[idx].isSection) idx += 1;
      const sectionStart = idx;
      while (idx < entries.length && !entries[idx].isSection) idx += 1;
      const lineIdx = [];
      for (let i = sectionStart; i < idx; i++) {
        if (!entries[i].isSection) lineIdx.push(i);
      }
      if (!lineIdx.length) continue;

      const matchedIdx = lineIdx.filter((i) => entries[i].time !== null);
      if (!matchedIdx.length) {
        let t = Math.max(0, lastGlobalTime + STEP);
        lineIdx.forEach((i) => {
          entries[i].time = t;
          t += STEP;
        });
      } else {
        let t = entries[matchedIdx[0]].time;
        for (let i = lineIdx.indexOf(matchedIdx[0]) - 1; i >= 0; i--) {
          t = Math.max(0, t - STEP);
          entries[lineIdx[i]].time = t;
        }

        for (let m = 0; m < matchedIdx.length - 1; m++) {
          const a = matchedIdx[m];
          const b = matchedIdx[m + 1];
          const gap = [];
          for (
            let i = lineIdx.indexOf(a) + 1;
            i < lineIdx.indexOf(b);
            i++
          ) {
            gap.push(lineIdx[i]);
          }
          if (!gap.length) continue;
          const start = entries[a].time;
          const end = entries[b].time;
          if (!(end > start)) {
            let cur = start;
            gap.forEach((g) => {
              cur += STEP;
              entries[g].time = cur;
            });
          } else {
            const step = (end - start) / (gap.length + 1);
            gap.forEach((g, gi) => {
              entries[g].time = start + step * (gi + 1);
            });
          }
        }

        t = entries[matchedIdx[matchedIdx.length - 1]].time;
        for (
          let i = lineIdx.indexOf(matchedIdx[matchedIdx.length - 1]) + 1;
          i < lineIdx.length;
          i++
        ) {
          t += STEP;
          entries[lineIdx[i]].time = t;
        }
      }

      const lastLine = lineIdx[lineIdx.length - 1];
      if (entries[lastLine].time !== null) {
        lastGlobalTime = Math.max(lastGlobalTime, entries[lastLine].time);
      }
    }

    const aligned = [];
    let lastTime = 0;
    for (const entry of entries) {
      if (entry.isSection) {
        aligned.push(entry.raw);
        continue;
      }
      if (entry.time === null || !isFinite(entry.time)) {
        entry.time = lastTime + 0.01;
      }
      if (entry.time < lastTime) entry.time = lastTime + 0.01;
      lastTime = entry.time;
      aligned.push(`[${toLrcTime(entry.time)}] ${entry.text}`);
    }

    return aligned.join('\n');
  }

  try {
    let info;
    try {
      info = await ytdl.getInfo(videoId);
    } catch (err) {
      res.status(500).json({
        error: 'Failed to fetch YouTube audio',
        details: String(err?.message || err),
      });
      return;
    }
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
      res
        .status(500)
        .json({ error: 'Alignment failed (ElevenLabs)', details: t });
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
    res.status(500).json({
      error: 'Alignment failed',
      details: String(err?.message || err),
    });
  }
}
