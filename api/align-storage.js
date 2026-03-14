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
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const BUCKET = process.env.ALIGN_STORAGE_BUCKET || 'align-audio';

  if (!apiKey) {
    res.status(500).json({ error: 'Missing ELEVENLABS_API_KEY' });
    return;
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(500).json({ error: 'Missing Supabase service credentials' });
    return;
  }

  const rawLyrics = String(body.lyrics || '');
  const rawPath = String(body.path || '');
  if (!rawPath || rawPath.includes('..')) {
    res.status(400).json({ error: 'Invalid storage path' });
    return;
  }
  if (!rawLyrics.trim()) {
    res.status(400).json({ error: 'Missing lyrics' });
    return;
  }

  const MAX_BYTES = 35 * 1024 * 1024;
  const path = rawPath.replace(/^\/+/, '').replace(/\\/g, '/');

  function encodeStoragePath(p) {
    return String(p || '')
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
  }

  const STOPWORDS = new Set([
    'a','an','the','and','or','but','to','of','in','on','for','with','at','by',
    'is','am','are','was','were','be','been','being','i','you','he','she','it',
    'we','they','me','my','your','our','their','this','that','these','those',
    'just','yeah','oh','uh','ah','la','na','ooh','woo','yo'
  ]);

  function normalizeToken(t) {
    return (t || '')
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[–—-]/g, ' ')
      .replace(/\.{2,}/g, ' ')
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s+/g, '');
  }

  function tokenize(text) {
    return (text || '')
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[–—-]/g, ' ')
      .replace(/\.{2,}/g, ' ')
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => t.replace(/[^\p{L}\p{N}]+/gu, ''));
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

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function alignLinesToWords(lines, words) {
    const normalizedWords = words
      .map((w, i) => {
        const text = normalizeToken(w.text);
        if (!text) return null;
        const start = Number(w.start || 0);
        const end = Number(w.end || 0);
        return { text, start, end, index: i };
      })
      .filter(Boolean);

    for (let i = 0; i < normalizedWords.length; i++) {
      if (!normalizedWords[i].end || normalizedWords[i].end <= normalizedWords[i].start) {
        const next = normalizedWords[i + 1];
        normalizedWords[i].end = next
          ? Math.max(next.start, normalizedWords[i].start + 0.2)
          : normalizedWords[i].start + 0.2;
      }
    }

    const wordPositions = new Map();
    normalizedWords.forEach((w, idx) => {
      if (!wordPositions.has(w.text)) wordPositions.set(w.text, []);
      wordPositions.get(w.text).push(idx);
    });

    function findNextIndex(word, fromIdx, maxIdx) {
      const list = wordPositions.get(word);
      if (!list || !list.length) return null;
      let lo = 0;
      let hi = list.length - 1;
      let ans = null;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (list[mid] >= fromIdx) {
          ans = list[mid];
          hi = mid - 1;
        } else {
          lo = mid + 1;
        }
      }
      if (ans === null) return null;
      if (maxIdx != null && ans > maxIdx) return null;
      return ans;
    }

    const entries = lines.map((raw) => {
      const isSection = /^\[#\s*.+\]$/.test(raw);
      const lineText = stripTimestamp(raw);
      if (isSection) {
        return {
          raw,
          isSection: true,
          text: lineText,
          tokens: [],
          strongTokens: [],
          anchorTokens: [],
          time: null,
          matched: false,
          anchorWordIdx: null,
        };
      }

      const parenMatches = lineText.match(/\([^)]*\)/g) || [];
      const optionalTokens = [];
      parenMatches.forEach((m) => {
        const inner = m.slice(1, -1);
        optionalTokens.push(...tokenize(inner));
      });
      const coreText = lineText.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
      const coreTokens = tokenize(coreText);

      const tokens = [];
      const strongTokens = [];
      coreTokens.forEach((t) => {
        const isStop = STOPWORDS.has(t);
        const strong = t.length >= 4 && !isStop;
        const weight = strong ? 1.2 : isStop ? 0.6 : 1.0;
        tokens.push({ text: t, weight, strong, optional: false });
        if (strong) strongTokens.push(t);
      });
      optionalTokens.forEach((t) => {
        const isStop = STOPWORDS.has(t);
        const strong = t.length >= 4 && !isStop;
        const weight = strong ? 0.5 : isStop ? 0.3 : 0.4;
        tokens.push({ text: t, weight, strong, optional: true });
      });

      return {
        raw,
        isSection: false,
        text: lineText,
        tokens,
        strongTokens,
        anchorTokens: [],
        time: null,
        matched: false,
        anchorWordIdx: null,
      };
    });

    const strongFreq = new Map();
    entries.forEach((entry) => {
      if (entry.isSection) return;
      entry.strongTokens.forEach((t) => {
        strongFreq.set(t, (strongFreq.get(t) || 0) + 1);
      });
    });
    entries.forEach((entry) => {
      if (entry.isSection) return;
      const anchors = entry.strongTokens.filter((t) => (strongFreq.get(t) || 0) <= 2);
      entry.anchorTokens = anchors.length >= 2 ? anchors : entry.strongTokens.slice();
    });

    function scoreCandidate(entry, startIdx, rangeEnd) {
      if (!entry.tokens.length) return null;
      let idx = startIdx;
      let matchedWeight = 0;
      let totalWeight = 0;
      let matchedCount = 0;
      let matchedStrong = 0;
      let strongTotal = 0;
      let firstMatch = null;
      let lastMatch = null;
      const matchedTimes = [];
      const strongTimes = [];

      for (const token of entry.tokens) {
        if (!token.text) continue;
        totalWeight += token.weight;
        if (token.strong && !token.optional) strongTotal += 1;
        const found = findNextIndex(token.text, idx, rangeEnd);
        if (found !== null) {
          matchedWeight += token.weight;
          matchedCount += 1;
          if (token.strong && !token.optional) matchedStrong += 1;
          if (firstMatch === null) firstMatch = found;
          lastMatch = found;
          idx = found + 1;
          matchedTimes.push(normalizedWords[found]?.start ?? 0);
          if (token.strong && !token.optional) {
            strongTimes.push(normalizedWords[found]?.start ?? 0);
          }
        }
      }

      if (!matchedCount) return null;
      const coverage = matchedWeight / Math.max(0.01, totalWeight);
      const span = firstMatch !== null && lastMatch !== null ? Math.max(1, lastMatch - firstMatch + 1) : 1;
      const density = matchedCount / span;
      const strongCoverage = strongTotal ? matchedStrong / strongTotal : 0;
      const score = coverage * 0.7 + density * 0.2 + strongCoverage * 0.1;

      const timeSource = strongTimes.length ? strongTimes : matchedTimes;
      const time = median(timeSource.slice(0, 3));

      return {
        idx: startIdx,
        score,
        coverage,
        matchedStrong,
        firstMatch,
        lastMatch,
        time,
      };
    }

    function buildCandidates(entry, rangeStart, rangeEnd, maxCandidates = 8) {
      if (entry.isSection) return [];
      const seeds = new Set();
      const addSeeds = (tokens) => {
        tokens.forEach((t) => {
          const list = wordPositions.get(t);
          if (!list) return;
          for (const idx of list) {
            if (idx < rangeStart) continue;
            if (idx > rangeEnd) break;
            seeds.add(idx);
            if (seeds.size > 300) return;
          }
        });
      };

      if (entry.anchorTokens.length) addSeeds(entry.anchorTokens);
      if (seeds.size < 6) {
        addSeeds(entry.strongTokens.length ? entry.strongTokens : entry.tokens.map((t) => t.text));
      }
      if (!seeds.size) return [];

      const candidates = [];
      for (const idx of seeds) {
        const cand = scoreCandidate(entry, idx, rangeEnd);
        if (cand && cand.coverage >= 0.2) candidates.push(cand);
      }
      candidates.sort((a, b) => b.score - a.score);
      return candidates.slice(0, maxCandidates);
    }

    const anchors = [];
    let cursor = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.isSection || !entry.tokens.length) continue;
      const rangeStart = cursor;
      const rangeEnd = Math.min(normalizedWords.length - 1, cursor + 900);
      const candidates = buildCandidates(entry, rangeStart, rangeEnd, 6);
      const best = candidates[0];
      if (best && best.coverage >= 0.6 && best.matchedStrong >= 2 && best.time !== null) {
        entry.time = best.time;
        entry.matched = true;
        entry.anchorWordIdx = best.idx;
        anchors.push({ lineIdx: i, wordIdx: best.idx });
        cursor = Math.max(cursor, (best.lastMatch ?? best.idx) + 1);
      }
    }

    function alignSegment(lineIdxs, rangeStart, rangeEnd) {
      if (!lineIdxs.length) return;
      const candByLine = lineIdxs.map((li) =>
        buildCandidates(entries[li], rangeStart, rangeEnd, 10),
      );

      const dp = candByLine.map(() => []);
      const back = candByLine.map(() => []);
      let prevLineWithCands = -1;

      for (let i = 0; i < lineIdxs.length; i++) {
        const cands = candByLine[i];
        if (!cands.length) continue;
        for (let j = 0; j < cands.length; j++) {
          let bestScore = cands[j].score;
          let bestRef = null;
          if (prevLineWithCands >= 0) {
            const prevCands = candByLine[prevLineWithCands];
            const prevDp = dp[prevLineWithCands];
            for (let k = 0; k < prevCands.length; k++) {
              if (prevCands[k].idx >= cands[j].idx) continue;
              const penalty = (cands[j].idx - prevCands[k].idx) / 700;
              const score = prevDp[k] + cands[j].score - penalty;
              if (score > bestScore) {
                bestScore = score;
                bestRef = { line: prevLineWithCands, cand: k };
              }
            }
          }
          dp[i][j] = bestScore;
          back[i][j] = bestRef;
        }
        prevLineWithCands = i;
      }

      let bestLine = -1;
      let bestCand = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < lineIdxs.length; i++) {
        const cands = candByLine[i];
        for (let j = 0; j < cands.length; j++) {
          if (dp[i][j] > bestScore) {
            bestScore = dp[i][j];
            bestLine = i;
            bestCand = j;
          }
        }
      }
      if (bestLine < 0) return;

      let curLine = bestLine;
      let curCand = bestCand;
      while (curLine >= 0 && curCand >= 0) {
        const entry = entries[lineIdxs[curLine]];
        const cand = candByLine[curLine][curCand];
        if (!entry.anchorWordIdx && cand?.time !== null) {
          entry.time = cand.time;
          entry.matched = true;
        }
        const ref = back[curLine][curCand];
        if (!ref) break;
        curLine = ref.line;
        curCand = ref.cand;
      }
    }

    if (!anchors.length) {
      const lineIdxs = entries
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => !e.isSection)
        .map(({ i }) => i);
      alignSegment(lineIdxs, 0, normalizedWords.length - 1);
    } else {
      anchors.sort((a, b) => a.lineIdx - b.lineIdx);
      let prevAnchor = null;
      for (const anchor of anchors) {
        const startLine = prevAnchor ? prevAnchor.lineIdx + 1 : 0;
        const endLine = anchor.lineIdx - 1;
        if (endLine >= startLine) {
          const lineIdxs = [];
          for (let i = startLine; i <= endLine; i++) {
            if (!entries[i].isSection) lineIdxs.push(i);
          }
          const rangeStart = Math.max(0, (prevAnchor?.wordIdx ?? 0) - 120);
          const rangeEnd = Math.min(normalizedWords.length - 1, anchor.wordIdx + 120);
          alignSegment(lineIdxs, rangeStart, rangeEnd);
        }
        prevAnchor = anchor;
      }
      const lastAnchor = anchors[anchors.length - 1];
      const tailStart = lastAnchor.lineIdx + 1;
      const lineIdxs = [];
      for (let i = tailStart; i < entries.length; i++) {
        if (!entries[i].isSection) lineIdxs.push(i);
      }
      if (lineIdxs.length) {
        const rangeStart = Math.max(0, lastAnchor.wordIdx - 120);
        const rangeEnd = normalizedWords.length - 1;
        alignSegment(lineIdxs, rangeStart, rangeEnd);
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

  let audioBuffer = null;
  try {
    const downloadResp = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeStoragePath(path)}`,
      {
        method: 'GET',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      },
    );
    if (!downloadResp.ok) {
      const t = await downloadResp.text();
      res.status(500).json({ error: 'Failed to fetch audio from storage', details: t });
      return;
    }

    const arr = await downloadResp.arrayBuffer();
    if (arr.byteLength > MAX_BYTES) {
      res.status(413).json({ error: 'Audio too large for alignment' });
      return;
    }
    audioBuffer = Buffer.from(arr);

    const mime =
      downloadResp.headers.get('content-type') || body.mime || 'audio/mpeg';
    const form = new FormData();
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
  } finally {
    try {
      await fetch(
        `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeStoragePath(path)}`,
        {
          method: 'DELETE',
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
          },
        },
      );
    } catch (err) {}
  }
}
