// ─── config.js — Config panel, caption import, auto-align, save ───────────────
// Depends on: data.js, player.js, library.js

'use strict';

const cfgStatus = $('cfgStatus');

// ── Helpers ────────────────────────────────────────────────────────────────
function setStatus(el, msg, color) {
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = color || 'var(--muted)';
}

function fmt2(sec) {
  // fmtLrcTime — for export (mm:ss.cs)
  const s = Math.max(0, sec || 0);
  const m = Math.floor(s / 60);
  const r = (s - m * 60).toFixed(2).padStart(5, '0');
  return `${String(m).padStart(2, '0')}:${r}`;
}

function extractYTId(url) {
  url = url.trim();
  let m = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);          if (m) return m[1];
  m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);                   if (m) return m[1];
  m = url.match(/embed\/([a-zA-Z0-9_-]{11})/);                  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
  return null;
}

function parseLyrics(raw) {
  const lines    = raw.split('\n');
  const result   = [];
  let   pendingSection = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const secMatch = trimmed.match(/^\[#\s*(.+?)\]$/);
    if (secMatch) { pendingSection = secMatch[1].trim(); continue; }
    const tsMatch = trimmed.match(/^\[(\d{1,2}):(\d{2}(?:\.\d+)?)\]\s*(.*)/);
    if (tsMatch) {
      const t = parseFloat(tsMatch[1]) * 60 + parseFloat(tsMatch[2]);
      result.push({ t, text: tsMatch[3].trim(), section: pendingSection });
      pendingSection = '';
      continue;
    }
    const tsMatch2 = trimmed.match(/^\[(\d+(?:\.\d+)?)\]\s*(.*)/);
    if (tsMatch2) {
      const t = parseFloat(tsMatch2[1]);
      result.push({ t, text: tsMatch2[2].trim(), section: pendingSection });
      pendingSection = '';
    }
  }
  result.sort((a, b) => a.t - b.t);
  return result;
}

function mergeLyricsText(existingText, newText) {
  const existing = existingText.split('\n').map((l) => l.trim()).filter(Boolean);
  const incoming = newText.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!existing.length) return newText;
  const seen   = new Set(existing);
  const merged = [...existing];
  incoming.forEach((line) => { if (!seen.has(line)) { seen.add(line); merged.push(line); } });
  return merged.join('\n');
}

// ── applyTrackData — replaces lyrics/sections/player when loading a track ──
function applyTrackData({ title, artist, ytId, lyricsRaw }, opts = {}) {
  const { skipPlayerReload = false, keepTime = false } = opts || {};
  const newLyrics = parseLyrics(lyricsRaw);
  if (newLyrics.length === 0) return false;

  ytDuration = 0;
  if (_playWatchTimer) { clearInterval(_playWatchTimer); _playWatchTimer = null; }

  document.title = title + (artist ? ' — ' + artist : '');
  $('hdrTrackTitle').textContent    = title.toUpperCase();
  $('hdrArtist').textContent        = artist || '';
  $('titlebarSongName').textContent = (title + (artist ? ' ft. ' + artist : '')).toLowerCase();
  updateMediaSession({ title, artist });

  // Swap global lyrics + sections
  lyrics.length = 0;
  newLyrics.forEach((l) => lyrics.push(l));

  sections.length = 0;
  const seenSections = new Set();
  lyrics.forEach((l) => {
    if (l.section && !seenSections.has(l.section)) {
      seenSections.add(l.section);
      sections.push({ t: l.t, label: l.section.split(/[—\-–]/)[0].trim().substring(0, 12) });
    }
  });

  const lastT    = lyrics[lyrics.length - 1].t;
  const newTotal = Math.ceil(lastT + 30);
  window._dynamicTotal = newTotal;
  setTotalDisplay(newTotal);
  renderSeekMarkers(newTotal);

  // Rebuild lyrics list panel
  rebuildLyricsList();

  // Reload YouTube player
  if (!skipPlayerReload) {
    if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
      YT_ID_current = ytId;
      ytPlayer.loadVideoById(ytId);
      ytLabel.textContent = '▶ loading';
    } else {
      pauseAll();
      ytReady = false; ytReadyA = false; ytReadyB = false;
      _lastGoodTime = 0; _lastGoodStamp = 0;
      clearInterval(_ytPollInterval); _ytPollInterval = null;
      try { if (ytPlayerA) ytPlayerA.destroy(); if (ytPlayerB) ytPlayerB.destroy(); } catch (err) {}
      const containerA = $('yt-player-container');
      const containerB = $('yt-player-container-b');
      if (containerA) containerA.innerHTML = '';
      if (containerB) containerB.innerHTML = '';
      YT_ID_current = ytId;
      setActivePlayer('A');
      if (window.YT && window.YT.Player) window.onYouTubeIframeAPIReady();
    }
  } else {
    YT_ID_current = ytId;
  }
  updateTotalFromPlayer(true);
  if (typeof updateYouTubeViews === 'function') updateYouTubeViews(ytId);

  // Reset player state
  currentIdx     = -1;
  lastLoopTime   = -1;
  _lastGoodTime  = safeGetTime();
  _lastGoodStamp = performance.now();
  rowPrev.textContent    = '';    rowPrev.classList.remove('has-text');
  rowCurrent.textContent = '';    rowCurrent.classList.remove('has-text', 'exiting');
  rowNext.textContent    = '';    rowNext.classList.remove('has-text');
  sectionLbl.classList.remove('show');

  if (keepTime) {
    const ct = safeGetTime();
    seekFill.style.width    = (ct / getTotal()) * 100 + '%';
    timeDisplay.textContent = fmt(ct);
    timeDock.textContent    = fmt(ct);
    if (idleMsg) idleMsg.style.display = 'none';
    statusText.textContent = playing ? 'PLAYING' : 'LOADED';
  } else {
    seekFill.style.width    = '0%';
    timeDisplay.textContent = '0:00';
    timeDock.textContent    = '0:00';
    if (idleMsg) idleMsg.style.display = 'flex';
    statusText.textContent = 'LOADED';
  }
  return true;
}

// ── Config panel ───────────────────────────────────────────────────────────
function openConfig() {
  $('cfgTitle').value  = document.title.split('—')[0].trim();
  $('cfgArtist').value = $('hdrArtist') ? $('hdrArtist').textContent : '';
  $('cfgYtUrl').value  = 'https://youtu.be/' + YT_ID_current;
  $('cfgLyrics').value = lyrics
    .filter((l) => l.text || l.section)
    .map((l) => {
      const lines = [];
      if (l.section) lines.push('[#' + l.section + ']');
      if (l.text !== undefined) lines.push(`[${fmt2(l.t)}] ${l.text}`);
      return lines.join('\n');
    })
    .join('\n');
  $('cfgError').textContent = '';
  setStatus(cfgStatus, '');
  $('configOverlay').classList.add('open');
  setTimeout(() => $('cfgTitle').focus(), 350);
}

function openConfigFromLibrary() {
  closeLibrary();
  $('cfgTitle').value   = '';
  $('cfgArtist').value  = '';
  $('cfgYtUrl').value   = '';
  $('cfgLyrics').value  = '';
  $('cfgError').textContent = '';
  setStatus(cfgStatus, '');
  $('configOverlay').classList.add('open');
  setTimeout(() => $('cfgTitle').focus(), 350);
}

function closeConfig() { $('configOverlay').classList.remove('open'); }

$('configOverlay').addEventListener('click', (e) => {
  if (e.target === $('configOverlay') && e.currentTarget === e.target) closeConfig();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($('configOverlay').classList.contains('open')) closeConfig();
});

function applyConfig() {
  const errEl  = $('cfgError');
  errEl.textContent = '';
  setStatus(cfgStatus, '');

  const title  = $('cfgTitle').value.trim();
  const artist = $('cfgArtist').value.trim();
  const ytUrl  = $('cfgYtUrl').value.trim();
  const raw    = $('cfgLyrics').value.trim();

  if (!title)  { errEl.textContent = '⚠ Track title is required.';  return; }
  if (!ytUrl)  { errEl.textContent = '⚠ YouTube URL is required.';  return; }
  if (!raw)    { errEl.textContent = '⚠ Lyrics are required.';       return; }

  const newYtId = extractYTId(ytUrl);
  if (!newYtId) { errEl.textContent = '⚠ Could not parse YouTube video ID from that URL.'; return; }

  const ok = applyTrackData({ title, artist, ytId: newYtId, lyricsRaw: raw });
  if (!ok) { errEl.textContent = '⚠ No valid timestamped lines found. Use format: [mm:ss.cs] lyric'; return; }

  const match =
    libraryTracksRaw.find((t) => t.yt_id === newYtId) ||
    libraryTracksRaw.find((t) =>
      (t.title  || '').trim().toLowerCase() === title.trim().toLowerCase() &&
      (t.artist || '').trim().toLowerCase() === artist.trim().toLowerCase(),
    );
  currentTrackId = match ? match.id : null;
  updateCurrentIndex();
  closeConfig();
}

// ── Caption import ─────────────────────────────────────────────────────────
const CAPTION_LANG_CANDIDATES = ['en','es','fr','de','it','pt','ja','ko','zh','th'];

async function detectCaptionLanguages() {
  const errEl = $('cfgError');
  errEl.textContent = '';
  setStatus(cfgStatus, 'Detecting languages...', 'var(--cyan)');
  const ytId = extractYTId($('cfgYtUrl').value.trim());
  if (!ytId) { errEl.textContent = '⚠ Please provide a valid YouTube URL first.'; setStatus(cfgStatus, ''); return; }
  const detected = [];
  try {
    const resp = await fetch('/api/captions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: ytId, languageList: CAPTION_LANG_CANDIDATES }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data?.languages)) detected.push(...data.languages);
    }
  } catch (err) {}
  const list = $('capLangList');
  if (list) {
    list.innerHTML = '';
    detected.forEach((code) => { const opt = document.createElement('option'); opt.value = code; list.appendChild(opt); });
  }
  if (detected.length) {
    $('cfgCapLang').value = detected[0];
    setStatus(cfgStatus, `Detected: ${detected.join(', ')}`, 'var(--green)');
  } else {
    setStatus(cfgStatus, 'No captions detected', '#ff6b6b');
  }
}

async function importCaptions() {
  const errEl = $('cfgError');
  errEl.textContent = '';
  setStatus(cfgStatus, 'Fetching captions...', 'var(--cyan)');
  const ytUrl = $('cfgYtUrl').value.trim();
  const ytId  = extractYTId(ytUrl);
  if (!ytId) { errEl.textContent = '⚠ Please provide a valid YouTube URL first.'; setStatus(cfgStatus, ''); return; }
  const lang = ($('cfgCapLang').value || 'en').trim() || 'en';
  try {
    const resp = await fetch('/api/captions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: ytId, language: lang, url: ytUrl }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      errEl.textContent = '⚠ Failed to fetch captions. Try another language code.';
      setStatus(cfgStatus, t ? t.slice(0, 120) : 'Fetch failed', '#ff6b6b');
      return;
    }
    const data  = await resp.json();
    const items = data?.items;
    if (!Array.isArray(items) || !items.length) { errEl.textContent = '⚠ No captions found for this video/language.'; setStatus(cfgStatus, ''); return; }
    const lines = items
      .map((seg) => {
        const start = seg.start ?? seg.startTime ?? seg.offset ?? 0;
        const text  = (seg.text || seg.caption || '').replace(/\s+/g, ' ').trim();
        if (!text) return '';
        if (/requested language/i.test(text) && /not available/i.test(text)) return '';
        return `[${fmt2(Number(start))}] ${text}`;
      })
      .filter(Boolean)
      .join('\n');
    const merge = $('cfgMergeCaptions')?.checked;
    $('cfgLyrics').value = merge ? mergeLyricsText($('cfgLyrics').value, lines) : lines;
    setStatus(cfgStatus, 'Captions loaded ✓', 'var(--green)');
  } catch (err) {
    errEl.textContent = '⚠ Failed to fetch captions. Network error.';
    setStatus(cfgStatus, 'Fetch failed', '#ff6b6b');
  }
}

// ── Auto align ─────────────────────────────────────────────────────────────
async function autoAlignLyrics() {
  const errEl = $('cfgError');
  errEl.textContent = '';
  setStatus(cfgStatus, 'Aligning lyrics...', 'var(--cyan)');
  const btn = $('autoAlignBtn');
  if (btn) { btn.classList.add('is-loading'); btn.disabled = true; }
  const ytUrl = $('cfgYtUrl').value.trim();
  const raw   = $('cfgLyrics').value.trim();
  if (!ytUrl) { errEl.textContent = '⚠ Please provide a YouTube URL first.'; setStatus(cfgStatus, ''); return; }
  if (!raw)   { errEl.textContent = '⚠ Paste lyrics first (with or without timestamps).'; setStatus(cfgStatus, ''); return; }
  try {
    const resp = await fetch('/api/align', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: ytUrl, lyrics: raw }) });
    if (!resp.ok) {
      let msg = 'Alignment failed.';
      try { const d = await resp.json(); if (d?.error) msg = d.error; if (d?.details) msg += `: ${d.details}`; }
      catch { const t = await resp.text(); if (t) msg = t.slice(0, 160); }
      errEl.textContent = `⚠ ${msg}`;
      setStatus(cfgStatus, 'Align failed', '#ff6b6b');
      return;
    }
    const data = await resp.json();
    if (!data?.lrc) { errEl.textContent = '⚠ Alignment returned no data.'; setStatus(cfgStatus, 'Align failed', '#ff6b6b'); return; }
    $('cfgLyrics').value = data.lrc;
    setStatus(cfgStatus, 'Aligned ✓', 'var(--green)');
  } catch (err) {
    errEl.textContent = '⚠ Alignment failed. Network error.';
    setStatus(cfgStatus, 'Align failed', '#ff6b6b');
  } finally {
    if (btn) { btn.classList.remove('is-loading'); btn.disabled = false; }
  }
}

async function autoAlignFromUpload() {
  const errEl = $('cfgError');
  errEl.textContent = '';
  setStatus(cfgStatus, 'Aligning with upload...', 'var(--cyan)');
  const btn  = $('autoAlignUploadBtn');
  if (btn) { btn.classList.add('is-loading'); btn.disabled = true; }
  const raw  = $('cfgLyrics').value.trim();
  const file = $('cfgAudioFile').files[0];
  if (!file) { errEl.textContent = '⚠ Please select an audio file first.'; setStatus(cfgStatus, ''); return; }
  if (!raw)  { errEl.textContent = '⚠ Paste lyrics first (with or without timestamps).'; setStatus(cfgStatus, ''); return; }
  try {
    const form = new FormData();
    form.append('audio', file);
    form.append('lyrics', raw);
    const resp = await fetch('/api/align-upload', { method: 'POST', body: form });
    if (!resp.ok) {
      let msg = 'Alignment failed.';
      try { const d = await resp.json(); if (d?.error) msg = d.error; if (d?.details) msg += `: ${d.details}`; }
      catch { const t = await resp.text(); if (t) msg = t.slice(0, 160); }
      errEl.textContent = `⚠ ${msg}`;
      setStatus(cfgStatus, 'Align failed', '#ff6b6b');
      return;
    }
    const data = await resp.json();
    if (!data?.lrc) { errEl.textContent = '⚠ Alignment returned no data.'; setStatus(cfgStatus, 'Align failed', '#ff6b6b'); return; }
    $('cfgLyrics').value = data.lrc;
    setStatus(cfgStatus, 'Aligned ✓', 'var(--green)');
  } catch (err) {
    errEl.textContent = '⚠ Alignment failed. Network error.';
    setStatus(cfgStatus, 'Align failed', '#ff6b6b');
  } finally {
    if (btn) { btn.classList.remove('is-loading'); btn.disabled = false; }
  }
}

// ── Save track to library ──────────────────────────────────────────────────
async function saveTrackToLibrary(savePassword) {
  const errEl   = $('cfgError');
  errEl.textContent = '';
  setStatus(cfgStatus, 'Saving...', 'var(--cyan)');

  const title     = $('cfgTitle').value.trim().replace(/\s+/g, ' ');
  const artist    = $('cfgArtist').value.trim().replace(/\s+/g, ' ');
  const ytUrl     = $('cfgYtUrl').value.trim();
  const raw       = $('cfgLyrics').value.trim();
  const titleKey  = title.trim().replace(/\s+/g, ' ').toLowerCase();
  const artistKey = artist.trim().replace(/\s+/g, ' ').toLowerCase();

  if (!title)  { errEl.textContent = '⚠ Track title is required.';           setStatus(cfgStatus, ''); return; }
  if (!ytUrl)  { errEl.textContent = '⚠ YouTube URL is required.';           setStatus(cfgStatus, ''); return; }
  if (!raw)    { errEl.textContent = '⚠ Lyrics are required.';               setStatus(cfgStatus, ''); return; }

  const ytId = extractYTId(ytUrl);
  if (!ytId) { errEl.textContent = '⚠ Could not parse YouTube video ID from that URL.'; setStatus(cfgStatus, ''); return; }

  const payload = { title, artist, title_key: titleKey, artist_key: artistKey, yt_id: ytId, lyrics: raw };

  try {
    const qTitle  = encodeURIComponent(titleKey);
    const qArtist = encodeURIComponent(artistKey);
    const qYt     = encodeURIComponent(ytId);
    const qTitleQ  = encodeURIComponent(`"${titleKey}"`);
    const qArtistQ = encodeURIComponent(`"${artistKey}"`);
    const qYtQ     = encodeURIComponent(`"${ytId}"`);
    let   upsertId       = null;
    let   updatedByMatch = false;

    if (savePassword) {
      const updateResp = await fetch('/api/update-track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: savePassword, title, artist, title_key: titleKey, artist_key: artistKey, yt_id: ytId, lyrics: raw }),
      });
      if (updateResp.ok) {
        const data   = await updateResp.json();
        upsertId      = data?.id || null;
        updatedByMatch = true;
      } else if (updateResp.status === 401) {
        savePassError.textContent = 'Wrong password.';
        setStatus(cfgStatus, '');
        return false;
      } else if (updateResp.status !== 404) {
        let msg = 'Update failed.';
        try { const d = await updateResp.json(); if (d?.error) msg = d.error; if (d?.details) msg += `: ${d.details}`; }
        catch { const t = await updateResp.text(); if (t) msg = t.slice(0, 160); }
        errEl.textContent = `⚠ ${msg}`;
        setStatus(cfgStatus, 'Update failed', '#ff6b6b');
        return false;
      }
    }

    if (!updatedByMatch) {
      const matchResp = await sbFetch(
        `${TRACKS_TABLE}?select=id,created_at,title_key,artist_key,yt_id&or=(and(title_key.eq.${qTitleQ},artist_key.eq.${qArtistQ}),and(title_key.eq.${qTitleQ},yt_id.eq.${qYtQ}),and(artist_key.eq.${qArtistQ},yt_id.eq.${qYtQ}))&order=created_at.desc`,
        { method: 'GET' },
      );
      if (matchResp.ok) {
        const rows = await matchResp.json();
        if (rows.length) {
          if (!savePassword) { openSavePass('Password required to update this track.'); setStatus(cfgStatus, ''); return false; }
          const updateResp = await fetch('/api/update-track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: savePassword, title, artist, title_key: titleKey, artist_key: artistKey, yt_id: ytId, lyrics: raw }),
          });
          if (!updateResp.ok) {
            let msg = 'Update failed.';
            try { const d = await updateResp.json(); if (d?.error) msg = d.error; if (d?.details) msg += `: ${d.details}`; }
            catch { const t = await updateResp.text(); if (t) msg = t.slice(0, 160); }
            errEl.textContent = `⚠ ${msg}`;
            setStatus(cfgStatus, 'Update failed', '#ff6b6b');
            return false;
          }
          const data = await updateResp.json();
          upsertId     = data?.id || rows[0].id;
          updatedByMatch = true;
        }
      }
    }

    if (!updatedByMatch) {
      const insertResp = await sbFetch(`${TRACKS_TABLE}`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([payload]) });
      if (!insertResp.ok) {
        const t = await insertResp.text();
        if (/duplicate key|23505/i.test(t || '')) { openSavePass('Password required to update this track.'); setStatus(cfgStatus, ''); return false; }
        errEl.textContent = '⚠ Save failed. Check Supabase table/RLS.';
        setStatus(cfgStatus, t ? t.slice(0, 120) : 'Save failed', '#ff6b6b');
        return false;
      }
      const saved = await insertResp.json();
      upsertId = saved?.[0]?.id || null;
    }

    if (!updatedByMatch) {
      try {
        const listResp = await sbFetch(`${TRACKS_TABLE}?select=id,created_at&title_key=eq.${qTitle}&artist_key=eq.${qArtist}&order=created_at.desc`, { method: 'GET' });
        if (listResp.ok) {
          const rows = await listResp.json();
          if (rows.length > 1) {
            const delIds = rows.slice(1).map((r) => r.id).filter(Boolean);
            if (delIds.length) await sbFetch(`${TRACKS_TABLE}?id=in.(${delIds.join(',')})`, { method: 'DELETE' });
          }
          if (!upsertId && rows.length) upsertId = rows[0].id;
        }
      } catch (err) {}
    }

    if (upsertId) {
      try {
        const verifyResp = await sbFetch(`${TRACKS_TABLE}?select=id,lyrics&id=eq.${upsertId}&limit=1`, { method: 'GET' });
        if (verifyResp.ok) {
          const rows = await verifyResp.json();
          if (rows.length && rows[0].lyrics !== raw) {
            errEl.textContent = '⚠ Save failed. Supabase rejected the update.';
            setStatus(cfgStatus, 'Save failed', '#ff6b6b');
            return false;
          }
        }
      } catch (err) {}
    }

    setStatus(cfgStatus, upsertId ? 'Saved ✓' : 'Updated ✓', 'var(--green)');
    try {
      if (upsertId) localStorage.setItem('lastTrackId', String(upsertId));
      localStorage.setItem('lastTrackKey', JSON.stringify({ title_key: titleKey, artist_key: artistKey }));
    } catch (err) {}
    return true;
  } catch (err) {
    errEl.textContent = '⚠ Save failed. Network or Supabase error.';
    setStatus(cfgStatus, 'Save failed', '#ff6b6b');
    return false;
  }
}
