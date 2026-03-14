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
