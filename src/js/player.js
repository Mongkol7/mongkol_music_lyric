// ─── player.js — YouTube IFrame + playback engine ────────────────────────────
// Depends on: data.js (lyrics, sections, YT_ID_current, FALLBACK_TOTAL)
// Exposes globals used by other modules and HTML onclick attributes.

'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let ytPlayer  = null;
let ytPlayerA = null;
let ytPlayerB = null;
let ytReady   = false;
let ytReadyA  = false;
let ytReadyB  = false;
let activePlayerKey = 'A';
let playing   = false;
let raf       = null;
let waveTimer = null;
let currentIdx = -1;
let endHandling = false;
let ytDuration  = 0;
let lastLoopTime = -1;
let _lastGoodTime  = 0;
let _lastGoodStamp = 0;
let _pendingPlay   = false;
let _playWatchTimer = null;
let _ytPollInterval = null;
let _autoPlayTries  = 0;
let isDragging  = false;
let dragWasPlay = false;
let pendingVolume = null;
let diskOpen = false;
let diskDragging = false;
let diskWasPlaying = false;
let diskAngle = 0;
let lastDiskSeek = -1;
let ambientPhase = 0;

// ── DOM references ─────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const seekFill    = $('seekFill');
const seekTrack   = $('seekTrack');
const seekWrap    = $('seekWrap');
const seekTip     = $('seekTip');
const seekMarkers = $('seekMarkers');
const timeDisplay = $('timeDisplay');
const timeDock    = $('timeDock');
const timeTotal   = $('timeTotal');
const timeTotalDock = $('timeTotalDock');
const sectionLbl  = $('sectionLabel');
const idleMsg     = $('idleMsg');
const playBtn     = $('playBtn');
const prevBtn     = $('prevBtn');
const nextBtn     = $('nextBtn');
const statusText  = $('statusText');
const ytContainerA = $('yt-player-container');
const ytContainerB = $('yt-player-container-b');
const flashOver   = $('flashOverlay');
const glowOrb     = $('glowOrb');
const waveformEl  = $('waveformEl');
const devBar      = $('devBar');
const volNote     = $('volNote');
const ytLabel     = $('ytStatusLabel');
const ytViewsEl   = $('ytViewCount');
const rowPrev    = $('rowPrev');
const rowCurrent = $('rowCurrent');
const rowNext    = $('rowNext');
const hdrIcon    = $('hdrIcon');
const lyricsCol  = document.querySelector('.lyrics-col');
const diskOverlay = $('diskOverlay');
const diskDisc    = $('diskDisc');
const diskThumb   = $('diskThumb');
const lyricAmbient = $('lyricAmbient');

const viewsCache = new Map();
const viewsInFlight = new Map();

if (volNote && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
  volNote.textContent = 'Use device volume';
  volNote.classList.add('show');
}

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function getTotal() {
  if (Number.isFinite(ytDuration) && ytDuration > 1) return ytDuration;
  return window._dynamicTotal || FALLBACK_TOTAL;
}

function setTotalDisplay(total) {
  const safe = Number.isFinite(total) && total > 0 ? total : getTotal();
  const text = fmt(Math.max(0, safe || 0));
  if (timeTotal)    timeTotal.textContent    = text;
  if (timeTotalDock) timeTotalDock.textContent = text;
}

function renderSeekMarkers(total) {
  const safe = Math.max(1, total || getTotal());
  seekMarkers.innerHTML = '';
  sections.forEach((s) => {
    if (!s || typeof s.t !== 'number') return;
    const pct = Math.min(1, Math.max(0, s.t / safe)) * 100;
    const mk  = document.createElement('div');
    mk.className = 's-mark';
    mk.style.left = pct + '%';
    const lb  = document.createElement('div');
    lb.className = 's-mark-lbl';
    lb.textContent = s.label;
    lb.style.left = pct + '%';
    seekMarkers.appendChild(mk);
    seekMarkers.appendChild(lb);
  });
}

function getYTDurationSafe() {
  try {
    if (ytReady && ytPlayer && typeof ytPlayer.getDuration === 'function') {
      const d = ytPlayer.getDuration();
      if (Number.isFinite(d) && d > 1) return d;
    }
  } catch (err) {}
  return 0;
}

function updateTotalFromPlayer(force = false) {
  const d = getYTDurationSafe();
  if (!d) return;
  if (!force && Math.abs(d - ytDuration) < 0.5) return;
  ytDuration = d;
  setTotalDisplay(d);
  renderSeekMarkers(d);
  const ct = safeGetTime();
  if (ct >= 0) seekFill.style.width = (ct / d) * 100 + '%';
}

function updateYouTubeViews(ytId) {
  if (!ytViewsEl) return;
  if (!ytId) {
    ytViewsEl.textContent = 'Views: unavailable';
    return;
  }
  ytViewsEl.dataset.ytId = ytId;
  const cacheKey = `yt_views_${ytId}`;
  const now = Date.now();
  try {
    const cachedRaw = localStorage.getItem(cacheKey);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      if (cached && cached.formatted && now - cached.ts < 3600 * 1000) {
        ytViewsEl.textContent = `${cached.formatted} views`;
        return;
      }
    }
  } catch (err) {}

  const memCached = viewsCache.get(ytId);
  if (memCached && now - memCached.ts < 3600 * 1000) {
    ytViewsEl.textContent = `${memCached.formatted} views`;
    return;
  }

  if (viewsInFlight.has(ytId)) {
    viewsInFlight.get(ytId).then((data) => {
      if (!data || ytViewsEl.dataset.ytId !== ytId) return;
      ytViewsEl.textContent = `${data.formatted} views`;
    });
    return;
  }

  ytViewsEl.textContent = 'Views: ...';
  const req = fetch(`/api/youtube-views?id=${encodeURIComponent(ytId)}`)
    .then((resp) => (resp.ok ? resp.json() : null))
    .then((data) => {
      if (!data || !data.formatted) return null;
      const payload = { formatted: data.formatted, ts: Date.now() };
      viewsCache.set(ytId, payload);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(payload));
      } catch (err) {}
      return payload;
    })
    .catch(() => null)
    .finally(() => viewsInFlight.delete(ytId));

  viewsInFlight.set(ytId, req);
  req.then((data) => {
    if (!data || ytViewsEl.dataset.ytId !== ytId) {
      if (!data && ytViewsEl.dataset.ytId === ytId) ytViewsEl.textContent = 'Views: unavailable';
      return;
    }
    ytViewsEl.textContent = `${data.formatted} views`;
  });
}

function setDiskThumb(ytId) {
  if (!diskThumb) return;
  if (!ytId) {
    diskThumb.removeAttribute('src');
    diskThumb.alt = '';
    return;
  }
  const url = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
  diskThumb.src = url;
  diskThumb.alt = 'YouTube thumbnail';
  diskThumb.onerror = () => {
    diskThumb.onerror = null;
    diskThumb.src = `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`;
  };
}

function setDiskAngle(deg) {
  diskAngle = ((deg % 360) + 360) % 360;
  if (diskDisc) {
    diskDisc.style.setProperty('--disk-rot', `${diskAngle}deg`);
  }
}

function angleFromEvent(e) {
  if (!diskDisc) return 0;
  const rect = diskDisc.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const x = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX) - cx;
  const y = (e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY) - cy;
  let angle = Math.atan2(y, x) * (180 / Math.PI) + 90;
  if (angle < 0) angle += 360;
  return angle;
}

function updateDiskFromTime(t) {
  const total = getTotal();
  if (!total) return;
  const angle = (t / total) * 360;
  setDiskAngle(angle);
}

function setDiskOpen(open) {
  if (!lyricsCol) return;
  diskOpen = open;
  lyricsCol.classList.toggle('disk-open', open);
  if (open) {
    updateDiskFromTime(safeGetTime());
  }
}

function setAmbientActive(active) {
  if (!lyricsCol || !lyricAmbient) return;
  lyricsCol.classList.toggle('ambient-on', active);
  if (!active) lyricAmbient.style.setProperty('--amb-op', '0.08');
}

function updateAmbient() {
  if (!lyricAmbient || prefersReduced) return;
  ambientPhase += 0.028;
  const x1 = 50 + 20 * Math.sin(ambientPhase * 0.8);
  const y1 = 48 + 24 * Math.cos(ambientPhase * 0.6);
  const x2 = 52 + 26 * Math.cos(ambientPhase * 0.5 + 1.7);
  const y2 = 52 + 22 * Math.sin(ambientPhase * 0.7 + 2.1);
  const op = 0.18 + 0.08 * Math.sin(ambientPhase * 1.4);
  lyricAmbient.style.setProperty('--amb-x1', `${x1}%`);
  lyricAmbient.style.setProperty('--amb-y1', `${y1}%`);
  lyricAmbient.style.setProperty('--amb-x2', `${x2}%`);
  lyricAmbient.style.setProperty('--amb-y2', `${y2}%`);
  lyricAmbient.style.setProperty('--amb-op', op.toFixed(3));
}

function triggerFlash() {
  flashOver.classList.add('flash');
  setTimeout(() => flashOver.classList.remove('flash'), 65);
}

function safeGetTime() {
  if (!ytReady) return 0;
  try {
    const t = ytPlayer.getCurrentTime();
    if (typeof t === 'number' && isFinite(t)) {
      _lastGoodTime  = t;
      _lastGoodStamp = performance.now();
      return t;
    }
  } catch (err) {}
  const elapsed = (performance.now() - _lastGoodStamp) / 1000;
  return _lastGoodTime + (playing ? Math.min(elapsed, 1) : 0);
}

// ── Seek bar ───────────────────────────────────────────────────────────────
function getPct(clientX) {
  const r = seekTrack.getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
}

seekWrap.addEventListener('mousemove', (e) => {
  const pct = getPct(e.clientX);
  seekTip.textContent = fmt(pct * getTotal());
  const wr = seekWrap.getBoundingClientRect(), tr = seekTrack.getBoundingClientRect();
  seekTip.style.left = tr.left - wr.left + pct * tr.width + 'px';
  if (isDragging) {
    seekFill.style.width = pct * 100 + '%';
    const tf = fmt(pct * getTotal());
    timeDisplay.textContent = tf;
    timeDock.textContent    = tf;
  }
});
seekWrap.addEventListener('mousedown', (e) => {
  isDragging  = true;
  dragWasPlay = playing;
  if (playing) pauseAll();
  seekFill.style.width = getPct(e.clientX) * 100 + '%';
});
document.addEventListener('mouseup', (e) => {
  if (!isDragging) return;
  isDragging = false;
  seekTo(getPct(e.clientX) * getTotal(), dragWasPlay);
});
seekWrap.addEventListener('touchstart', (e) => {
  isDragging  = true;
  dragWasPlay = playing;
  if (playing) pauseAll();
}, { passive: true });
seekWrap.addEventListener('touchmove', (e) => {
  if (!isDragging) return;
  const pct = getPct(e.touches[0].clientX);
  seekFill.style.width = pct * 100 + '%';
  const tf = fmt(pct * getTotal());
  timeDisplay.textContent = tf;
  timeDock.textContent    = tf;
}, { passive: true });
seekWrap.addEventListener('touchend', (e) => {
  if (!isDragging) return;
  isDragging = false;
  seekTo(getPct(e.changedTouches[0].clientX) * getTotal(), dragWasPlay);
});

if (hdrIcon) {
  hdrIcon.addEventListener('click', () => {
    setDiskOpen(!diskOpen);
  });
}

if (diskDisc) {
  diskDisc.addEventListener('pointerdown', (e) => {
    if (!diskOpen) return;
    e.preventDefault();
    diskDragging = true;
    diskWasPlaying = playing;
    lastDiskSeek = -1;
    try { diskDisc.setPointerCapture(e.pointerId); } catch (err) {}
    pauseAll();
    const angle = angleFromEvent(e);
    setDiskAngle(angle);
    const t = (angle / 360) * getTotal();
    seekTo(t, false);
    lastDiskSeek = t;
  });
  diskDisc.addEventListener('pointermove', (e) => {
    if (!diskDragging) return;
    e.preventDefault();
    const angle = angleFromEvent(e);
    setDiskAngle(angle);
    const t = (angle / 360) * getTotal();
    if (lastDiskSeek < 0 || Math.abs(t - lastDiskSeek) > 0.3) {
      seekTo(t, false);
      lastDiskSeek = t;
    }
  });
  const stopDiskDrag = (e) => {
    if (!diskDragging) return;
    diskDragging = false;
    try { diskDisc.releasePointerCapture(e.pointerId); } catch (err) {}
    const angle = angleFromEvent(e);
    setDiskAngle(angle);
    const t = (angle / 360) * getTotal();
    seekTo(t, diskWasPlaying);
    diskWasPlaying = false;
    lastDiskSeek = -1;
  };
  diskDisc.addEventListener('pointerup', stopDiskDrag);
  diskDisc.addEventListener('pointercancel', stopDiskDrag);
}

// ── Waveform ───────────────────────────────────────────────────────────────
for (let i = 0; i < 20; i++) {
  const b = document.createElement('div');
  b.className = 'wave-bar';
  waveformEl.appendChild(b);
}
function startWave() {
  if (waveTimer) return;
  const tick = () => {
    if (!playing) { waveTimer = null; return; }
    waveformEl.querySelectorAll('.wave-bar').forEach((b) => {
      b.style.height  = 3 + Math.random() * 13 + 'px';
      b.style.opacity = 0.25 + Math.random() * 0.75;
    });
    waveTimer = setTimeout(tick, 75);
  };
  waveTimer = setTimeout(tick, 75);
}
function freezeWave() {
  clearTimeout(waveTimer);
  waveTimer = null;
  waveformEl.querySelectorAll('.wave-bar').forEach((b) => {
    b.style.height  = '4px';
    b.style.opacity = '.2';
  });
}

// ── Dev bar ────────────────────────────────────────────────────────────────
const devSegs = [];
let devBarRaf  = null;
let devBarPhase = 0;
const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function initDevBar() {
  if (!devBar || devSegs.length) return;
  for (let i = 0; i < 18; i++) {
    const seg = document.createElement('div');
    seg.className = 'dev-bar-seg';
    devBar.appendChild(seg);
    devSegs.push(seg);
  }
  setDevBarIdle();
}
function setDevBarIdle() {
  devSegs.forEach((seg) => { seg.style.height = '2px'; seg.style.opacity = '0.25'; });
}
function startDevBar() {
  if (prefersReduced || devBarRaf) return;
  const tick = () => {
    if (!playing) { devBarRaf = null; setDevBarIdle(); return; }
    devBarPhase += 0.08;
    devSegs.forEach((seg, i) => {
      const amp = Math.max(0, Math.sin(devBarPhase + i * 0.55) + (Math.random() - 0.5) * 0.4);
      seg.style.height  = `${2 + amp * 7}px`;
      seg.style.opacity = `${0.25 + amp * 0.7}`;
    });
    devBarRaf = requestAnimationFrame(tick);
  };
  devBarRaf = requestAnimationFrame(tick);
}
function stopDevBar() {
  if (devBarRaf) cancelAnimationFrame(devBarRaf);
  devBarRaf = null;
  setDevBarIdle();
}

// ── Player visibility ──────────────────────────────────────────────────────
function getInactivePlayer() {
  return activePlayerKey === 'A' ? ytPlayerB : ytPlayerA;
}
function setActivePlayer(key) {
  activePlayerKey = key;
  ytPlayer = key === 'A' ? ytPlayerA : ytPlayerB;
  ytReady  = key === 'A' ? ytReadyA  : ytReadyB;
  if (!ytContainerA || !ytContainerB) return;
  if (key === 'A') {
    ytContainerA.classList.remove('is-hidden');
    ytContainerB.classList.add('is-hidden');
  } else {
    ytContainerA.classList.add('is-hidden');
    ytContainerB.classList.remove('is-hidden');
  }
}

// ── Volume ─────────────────────────────────────────────────────────────────
function applyVolume(v) {
  const vol    = Math.max(0, Math.min(100, parseInt(v)));
  pendingVolume = Number.isFinite(vol) ? vol : pendingVolume;
  if (!ytReady) return;
  try {
    const before = typeof ytPlayer.getVolume === 'function' ? ytPlayer.getVolume() : null;
    if (ytPlayer.isMuted && ytPlayer.isMuted()) ytPlayer.unMute();
    ytPlayer.setVolume(pendingVolume ?? 70);
    setTimeout(() => {
      if (!volNote || typeof ytPlayer.getVolume !== 'function') return;
      const after = ytPlayer.getVolume();
      if (before === after && after !== pendingVolume) {
        volNote.textContent = 'Use device volume';
        volNote.classList.add('show');
      }
    }, 200);
  } catch (err) {}
}
function setVol(v) { applyVolume(v); }

// ── Core playback ──────────────────────────────────────────────────────────
function ensureLoopRunning() {
  if (playing && raf) return;
  playing = true;
  _lastGoodTime  = safeGetTime();
  _lastGoodStamp = performance.now();
  startWave();
  startDevBar();
  setAmbientActive(true);
  if (idleMsg) idleMsg.style.display = 'none';
  playBtn.textContent     = '⏸ PAUSE';
  statusText.textContent  = 'PLAYING';
  if (!raf) raf = requestAnimationFrame(loop);
}

function startPlayWatch(timeoutMs = 6000) {
  if (_playWatchTimer) { clearInterval(_playWatchTimer); _playWatchTimer = null; }
  const start = performance.now();
  _playWatchTimer = setInterval(() => {
    if (!ytReady || !ytPlayer) return;
    let state = null;
    try { state = ytPlayer.getPlayerState(); } catch (err) {}
    if (state === YT.PlayerState.PLAYING) {
      ensureLoopRunning();
      clearInterval(_playWatchTimer);
      _playWatchTimer = null;
      return;
    }
    if (_pendingPlay) {
      _autoPlayTries += 1;
      if (state === YT.PlayerState.UNSTARTED || state === YT.PlayerState.CUED || state === YT.PlayerState.PAUSED) {
        try {
          if (_autoPlayTries === 2 && ytPlayer.mute) ytPlayer.mute();
          ytPlayer.playVideo();
        } catch (err) {}
      }
    }
    if (performance.now() - start >= timeoutMs) {
      clearInterval(_playWatchTimer);
      _playWatchTimer = null;
    }
  }, 250);
}

function pauseAll() {
  playing       = false;
  _pendingPlay  = false;
  if (_playWatchTimer) { clearInterval(_playWatchTimer); _playWatchTimer = null; }
  if (raf) { cancelAnimationFrame(raf); raf = null; }
  freezeWave();
  stopDevBar();
  setAmbientActive(false);
  const inactive = getInactivePlayer();
  try {
    if (ytPlayer) ytPlayer.pauseVideo();
    if (inactive) inactive.pauseVideo();
  } catch (err) {}
  playBtn.textContent     = '▶ PLAY';
  statusText.textContent  = 'PAUSED';
  if ('mediaSession' in navigator) {
    try { navigator.mediaSession.playbackState = 'paused'; } catch (err) {}
  }
}

function playAll() {
  playing = true;
  startWave();
  startDevBar();
  setAmbientActive(true);
  try { if (ytPlayer) ytPlayer.playVideo(); } catch (err) {}
  playBtn.textContent    = '⏸ PAUSE';
  statusText.textContent = 'PLAYING';
  if ('mediaSession' in navigator) {
    try { navigator.mediaSession.playbackState = 'playing'; } catch (err) {}
  }
  if (!raf) raf = requestAnimationFrame(loop);
  startPlayWatch(6000);
}

function seekTo(t, resume) {
  const c = Math.max(0, Math.min(getTotal(), t));
  currentIdx   = -1;
  lastLoopTime = -1;
  _lastGoodTime  = c;
  _lastGoodStamp = performance.now();
  rowPrev.textContent    = '';   rowPrev.classList.remove('has-text');
  rowCurrent.textContent = '';   rowCurrent.classList.remove('has-text', 'exiting');
  rowNext.textContent    = '';   rowNext.classList.remove('has-text');
  seekFill.style.width       = (c / getTotal()) * 100 + '%';
  timeDisplay.textContent    = fmt(c);
  timeDock.textContent       = fmt(c);
  if (c < 1 && idleMsg) idleMsg.style.display = 'flex';
  try { if (ytReady && ytPlayer) ytPlayer.seekTo(c, true); } catch (err) {}
  if (resume) playAll();
  else {
    playing                = false;
    playBtn.textContent    = '▶ PLAY';
    statusText.textContent = 'PAUSED';
  }
  let idx = 0;
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].t <= c) idx = i;
    else break;
  }
  userScrolling = false;
  updateLyricsList(idx, true);
}

function togglePlay() {
  if (!ytReady) {
    _pendingPlay = !_pendingPlay;
    statusText.textContent = _pendingPlay ? 'WILL PLAY ▶' : 'CANCELLED';
    playBtn.textContent    = _pendingPlay ? '⏸ PAUSE'    : '▶ PLAY';
    return;
  }
  if (!playing) playAll();
  else pauseAll();
}

function syncNow() {
  currentIdx   = -1;
  lastLoopTime = -1;
  _lastGoodTime  = safeGetTime();
  _lastGoodStamp = performance.now();
  rowPrev.textContent    = '';    rowPrev.classList.remove('has-text');
  rowCurrent.textContent = '';    rowCurrent.classList.remove('has-text', 'exiting');
  rowNext.textContent    = '';    rowNext.classList.remove('has-text');
  if (idleMsg) idleMsg.style.display = 'none';
  if (!playing) playAll();
  const sb = $('syncBtn');
  sb.classList.add('sync-flash');
  setTimeout(() => sb.classList.remove('sync-flash'), 400);
  statusText.textContent = 'SYNCED ✓';
}

// ── Main render loop ───────────────────────────────────────────────────────
function loop() {
  if (!playing) {
    if (ytReady && ytPlayer && typeof ytPlayer.getPlayerState === 'function') {
      const state = ytPlayer.getPlayerState();
      if (state === YT.PlayerState.PLAYING) { playing = true; }
      else { raf = null; return; }
    } else { raf = null; return; }
  }

  const t     = safeGetTime();
  const total = getTotal();
  const hasRealDuration = ytDuration > 1;

  // Detect seek/jump (backwards or >3.5s forward)
  const delta = t - lastLoopTime;
  if (lastLoopTime >= 0 && (delta < -0.3 || delta > 3.5)) {
    currentIdx = -1;
    rowPrev.textContent    = '';   rowPrev.classList.remove('has-text');
    rowCurrent.textContent = '';   rowCurrent.classList.remove('has-text', 'exiting');
    rowNext.textContent    = '';   rowNext.classList.remove('has-text');
  }
  lastLoopTime = t;

  // Seek bar + time
  seekFill.style.width       = (t / total) * 100 + '%';
  const tf = fmt(t);
  timeDisplay.textContent    = tf;
  timeDock.textContent       = tf;
  if (diskOpen && !diskDragging) {
    updateDiskFromTime(t);
  }
  updateAmbient();

  // Lyric index (fast path using currentIdx)
  if (lyrics.length) {
    let idx = currentIdx;
    if (idx < 0) {
      let lo = 0;
      let hi = lyrics.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lyrics[mid].t <= t) lo = mid + 1;
        else hi = mid - 1;
      }
      idx = Math.max(0, hi);
    } else if (lyrics[idx].t <= t) {
      while (idx + 1 < lyrics.length && lyrics[idx + 1].t <= t) idx += 1;
    } else {
      while (idx - 1 >= 0 && lyrics[idx].t > t) idx -= 1;
    }
    if (idx !== currentIdx && idx >= 0) {
      currentIdx = idx;
      showLyric(idx);
    }
  }

  // End detection
  let state = null;
  try {
    if (ytReady && ytPlayer && typeof ytPlayer.getPlayerState === 'function') {
      state = ytPlayer.getPlayerState();
    }
  } catch (err) {}
  if (state === YT.PlayerState.ENDED || (hasRealDuration && t >= total - 0.2)) {
    onEnd();
    return;
  }
  raf = requestAnimationFrame(loop);
}

function onEnd() {
  if (endHandling) return;
  endHandling = true;
  playing = false;
  raf     = null;
  freezeWave();
  stopDevBar();
  setAmbientActive(false);
  clearInterval(_ytPollInterval);
  _ytPollInterval = null;
  playNextTrack(true);
  setTimeout(() => { endHandling = false; }, 2000);
}

// ── YT time poll (Safari fallback) ────────────────────────────────────────
function _startYTTimePoll() {
  if (_ytPollInterval) return;
  _ytPollInterval = setInterval(() => {
    if (!ytPlayer || !ytReady) return;
    try {
      const t = ytPlayer.getCurrentTime();
      if (typeof t === 'number' && isFinite(t) && t > 0) {
        _lastGoodTime  = t;
        _lastGoodStamp = performance.now();
      }
    } catch (err) {}
  }, 500);
}

// ── YouTube IFrame API ─────────────────────────────────────────────────────
window.onYouTubeIframeAPIReady = function () {
  const proto      = location.protocol;
  const safeOrigin = (proto === 'https:' || proto === 'http:') ? location.origin : '';

  const buildPlayer = (containerId, key) =>
    new YT.Player(containerId, {
      videoId: YT_ID_current,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 0, rel: 0, modestbranding: 1, iv_load_policy: 3,
        playsinline: 1, fs: 1, cc_load_policy: 0,
        ...(safeOrigin ? { origin: safeOrigin } : {}),
      },
      events: {
        onReady(e) {
          if (key === 'A') ytReadyA = true;
          else             ytReadyB = true;

          if (key === activePlayerKey) {
            ytReady  = true;
            ytPlayer = key === 'A' ? ytPlayerA : ytPlayerB;
          }

          const ifr = document.querySelector(`#${containerId} iframe`);
          if (ifr) {
            ifr.style.cssText = 'width:100%;height:100%;border:none;display:block';
            ifr.setAttribute('allow', 'accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture');
            ifr.setAttribute('playsinline', '');
            ifr.setAttribute('webkit-playsinline', '');
          }

          if (key === activePlayerKey) {
            try { applyVolume($('volSlider').value); } catch (err) {}
            _startYTTimePoll();
            updateTotalFromPlayer(true);
            ytLabel.textContent = '▶ ready';
            ytLabel.style.color = 'var(--green)';
            statusText.textContent = 'YT READY';
            if (_pendingPlay) {
              _autoPlayTries = 0;
              playAll();
              startPlayWatch(8000);
            }
          } else {
            try { if (e.target && typeof e.target.setVolume === 'function') e.target.setVolume(0); } catch (err) {}
          }
        },

        onStateChange(e) {
          if (key !== activePlayerKey) return;
          const S = YT.PlayerState;
          if (e.data === S.PLAYING) {
            lastLoopTime = -1;
            _startYTTimePoll();
            applyVolume(pendingVolume ?? $('volSlider').value);
            updateTotalFromPlayer();
            _pendingPlay = false;
            _autoPlayTries = 0;
            ensureLoopRunning();
            try {
              if (typeof recordListen === 'function') {
                recordListen(currentTrackId);
              }
            } catch (err) {}
          }
          if (e.data === S.CUED) {
            if (_pendingPlay && ytReady && ytPlayer && typeof ytPlayer.playVideo === 'function') {
              try { ytPlayer.playVideo(); } catch (err) {}
              if (typeof startPlayWatch === 'function') startPlayWatch(8000);
            }
          }
          if (e.data === S.PAUSED)    { if (playing) pauseAll(); }
          if (e.data === S.BUFFERING) { statusText.textContent = 'BUFFERING...'; }
          if (e.data === S.ENDED)     { onEnd(); }
        },

        onError(e) {
          if (key !== activePlayerKey) return;
          const msgs = { 2: 'bad id', 5: 'HTML5 err', 100: 'not found', 101: 'blocked', 150: 'blocked' };
          ytLabel.textContent = '✕ ' + (msgs[e.data] || 'err ' + e.data);
          ytLabel.style.color = 'var(--amber)';
          statusText.textContent = 'YT ERROR';
        },
      },
    });

  ytPlayerA = buildPlayer('yt-player-container', 'A');
  ytPlayerB = buildPlayer('yt-player-container-b', 'B');
  setActivePlayer(activePlayerKey || 'A');
};

// Load YT IFrame API script
(function () {
  const s  = document.createElement('script');
  s.src    = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
})();

updateYouTubeViews(YT_ID_current);
setDiskThumb(YT_ID_current);
setAmbientActive(false);

// ── Keyboard shortcuts ─────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space')      { e.preventDefault(); togglePlay(); }
  if (e.code === 'KeyS')       { e.preventDefault(); syncNow(); }
  if (e.code === 'ArrowRight') { e.preventDefault(); if (ytReady) seekTo(Math.min(safeGetTime() + 5, getTotal()), playing); }
  if (e.code === 'ArrowLeft')  { e.preventDefault(); if (ytReady) seekTo(Math.max(safeGetTime() - 5, 0), playing); }
});

// ── Haptic / click sound (mobile) ─────────────────────────────────────────
const isTouchDevice = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
let clickAudioCtx = null;
let lastClickAt   = 0;

function playClickSound() {
  if (!isTouchDevice) return;
  const now = performance.now();
  if (now - lastClickAt < 60) return;
  lastClickAt = now;
  try {
    if (!clickAudioCtx) clickAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (clickAudioCtx.state === 'suspended') clickAudioCtx.resume();
    const t = clickAudioCtx.currentTime;
    const gain = clickAudioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.05,   t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    const osc1 = clickAudioCtx.createOscillator(); osc1.type = 'sine';     osc1.frequency.setValueAtTime(1300, t);
    const osc2 = clickAudioCtx.createOscillator(); osc2.type = 'triangle'; osc2.frequency.setValueAtTime(650, t);
    osc1.connect(gain); osc2.connect(gain); gain.connect(clickAudioCtx.destination);
    osc1.start(t); osc2.start(t); osc1.stop(t + 0.05); osc2.stop(t + 0.05);
  } catch (err) {}
}
function hapticTap() {
  if (!isTouchDevice) return;
  try { if (navigator.vibrate) navigator.vibrate([20, 10, 20]); } catch (err) {}
}
document.addEventListener('click', (e) => {
  if (e.target.closest('button, .track-item, .track-load, .track-more, .cfg-trigger, .cfg-import, .cfg-align')) {
    hapticTap();
    playClickSound();
  }
});

// ── Initial seek markers + total display ───────────────────────────────────
setTotalDisplay(getTotal());
renderSeekMarkers(getTotal());
