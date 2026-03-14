import Busboy from 'busboy';

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

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Missing ELEVENLABS_API_KEY' });
    return;
  }

  const MAX_BYTES = 35 * 1024 * 1024;
  let audioBuffer = null;
  let audioMime = 'audio/mpeg';
  let lyricsText = '';
  let fileTooLarge = false;

  const bb = Busboy({
    headers: req.headers,
    limits: { fileSize: MAX_BYTES },
  });

  bb.on('file', (_name, file, info) => {
    audioMime = info?.mimeType || audioMime;
    const chunks = [];
    file.on('data', (data) => chunks.push(data));
    file.on('limit', () => {
      fileTooLarge = true;
    });
    file.on('end', () => {
      audioBuffer = Buffer.concat(chunks);
    });
  });

  bb.on('field', (name, val) => {
    if (name === 'lyrics') lyricsText = String(val || '');
  });

  bb.on('finish', async () => {
    if (fileTooLarge) {
      res.status(413).json({ error: 'Audio too large for alignment' });
      return;
    }
    if (!audioBuffer) {
      res.status(400).json({ error: 'Missing audio file' });
      return;
    }
    if (!lyricsText.trim()) {
      res.status(400).json({ error: 'Missing lyrics text' });
      return;
    }

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

      let cursor = 0;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.isSection || !entry.words.length) continue;

        let startIdx = -1;
        for (let j = cursor; j < normalizedWords.length; j++) {
          if (normalizedWords[j].text === entry.words[0]) {
            startIdx = j;
            break;
          }
        }
        if (startIdx === -1) {
          for (let j = cursor; j < normalizedWords.length; j++) {
            if (entry.words.includes(normalizedWords[j].text)) {
              startIdx = j;
              break;
            }
          }
        }

        if (startIdx !== -1 && normalizedWords[startIdx]) {
          entry.time = normalizedWords[startIdx].start;
          entry.matched = true;

          let matches = 0;
          let idx = startIdx;
          while (idx < normalizedWords.length && matches < entry.words.length) {
            if (normalizedWords[idx].text === entry.words[matches]) {
              matches += 1;
            }
            idx += 1;
          }
          cursor = Math.max(cursor, idx);
        }
      }

      const lineIdx = entries
        .map((e, i) => (!e.isSection ? i : null))
        .filter((i) => i !== null);
      const matchedIdx = lineIdx.filter((i) => entries[i].time !== null);

      if (!matchedIdx.length) {
        let t = 0;
        lineIdx.forEach((i) => {
          entries[i].time = t;
          t += 0.6;
        });
      } else {
        // Leading gap
        let t = entries[matchedIdx[0]].time;
        for (let i = matchedIdx[0] - 1; i >= 0; i--) {
          if (entries[i].isSection) continue;
          t = Math.max(0, t - 0.6);
          entries[i].time = t;
        }

        // Between gaps
        for (let m = 0; m < matchedIdx.length - 1; m++) {
          const a = matchedIdx[m];
          const b = matchedIdx[m + 1];
          const gap = [];
          for (let i = a + 1; i < b; i++) {
            if (!entries[i].isSection) gap.push(i);
          }
          if (!gap.length) continue;
          const start = entries[a].time;
          const end = entries[b].time;
          if (!(end > start)) {
            let cur = start;
            gap.forEach((idx) => {
              cur += 0.6;
              entries[idx].time = cur;
            });
          } else {
            const step = (end - start) / (gap.length + 1);
            gap.forEach((idx, gi) => {
              entries[idx].time = start + step * (gi + 1);
            });
          }
        }

        // Trailing gap
        t = entries[matchedIdx[matchedIdx.length - 1]].time;
        for (let i = matchedIdx[matchedIdx.length - 1] + 1; i < entries.length; i++) {
          if (entries[i].isSection) continue;
          t += 0.6;
          entries[i].time = t;
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
      const form = new FormData();
      const blob = new Blob([audioBuffer], { type: audioMime });
      form.append('file', blob, 'audio');
      form.append('text', lyricsText);
      form.append('enabled_spooled_file', 'true');

      const resp = await fetch(
        'https://api.elevenlabs.io/v1/forced-alignment',
        {
          method: 'POST',
          headers: { 'xi-api-key': apiKey },
          body: form,
        },
      );
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

      const lines = parseLyricsLines(lyricsText);
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
  });

  req.pipe(bb);
}
