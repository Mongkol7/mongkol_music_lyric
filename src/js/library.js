// ─── library.js — Supabase CRUD + library panel UI ───────────────────────────
// Depends on: data.js, player.js, lyrics-display.js

'use strict';

// ── Supabase config ────────────────────────────────────────────────────────
const SUPABASE_URL  = 'https://uhfukcpnuakhxgzjdqyg.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVoZnVrY3BudWFraHhnempkcXlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTc0NjcsImV4cCI6MjA4ODg3MzQ2N30.4xlY4uR8oBVQjKcho68WjL6rXXYyLIwEFzGPdC7BlAs';
const TRACKS_TABLE  = 'tracks';

function sbFetch(path, options = {}) {
  const method  = (options.method || 'GET').toUpperCase();
  const headers = {
    'Content-Type': 'application/json',
    apikey:         SUPABASE_KEY,
    Authorization:  `Bearer ${SUPABASE_KEY}`,
    ...(options.headers || {}),
  };
  if (method === 'GET') { headers['Cache-Control'] = 'no-cache'; headers.Pragma = 'no-cache'; }
  const fetchOptions = { ...options, headers };
  if (method === 'GET') fetchOptions.cache = 'no-store';
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, fetchOptions);
}

// ── Library state ──────────────────────────────────────────────────────────
let libraryTracksRaw  = [];
let libraryTracks     = [];
let libraryShuffle    = [];
let currentTrackId    = null;
let currentTrackIndex = -1;
let libraryLoadedOnce = false;
let libraryOrderMode  = localStorage.getItem('libraryOrder') || 'newest';

// ── DOM ────────────────────────────────────────────────────────────────────
const libraryOverlay     = $('libraryOverlay');
const libraryList        = $('libraryList');
const libraryStatus      = $('libraryStatus');
const libraryOrderSelect = $('libraryOrder');
const passOverlay    = $('passOverlay');
const passInput      = $('passInput');
const passError      = $('passError');
const passCancel     = $('passCancel');
const passConfirm    = $('passConfirm');
const savePassOverlay = $('savePassOverlay');
const savePassInput   = $('savePassInput');
const savePassError   = $('savePassError');
const savePassCancel  = $('savePassCancel');
const savePassConfirm = $('savePassConfirm');
const toastSuccess    = $('toastSuccess');
let   pendingDeleteId = null;

// ── Helpers ────────────────────────────────────────────────────────────────
function shuffleArray(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function applyLibraryOrder(mode, tracksRaw) {
  if (!Array.isArray(tracksRaw)) return [];
  if (mode === 'oldest') return tracksRaw.slice().reverse();
  if (mode === 'random') {
    const ids    = tracksRaw.map((t) => t.id);
    const idSet  = new Set(ids);
    const valid  = libraryShuffle.length === ids.length && libraryShuffle.every((id) => idSet.has(id));
    if (!valid) libraryShuffle = shuffleArray(ids);
    const map    = new Map(tracksRaw.map((t) => [t.id, t]));
    return libraryShuffle.map((id) => map.get(id)).filter(Boolean);
  }
  return tracksRaw.slice();
}

async function fetchLibraryTracks() {
  const resp = await sbFetch(
    `${TRACKS_TABLE}?select=id,title,artist,yt_id,lyrics,created_at&order=created_at.desc`,
    { method: 'GET' },
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  libraryLoadedOnce = true;
  return Array.isArray(data) ? data : [];
}

function updateCurrentIndex() {
  if (!currentTrackId || !libraryTracks.length) {
    currentTrackIndex = -1;
    updateNavButtons();
    return;
  }
  currentTrackIndex = libraryTracks.findIndex((t) => String(t.id) === String(currentTrackId));
  updateNavButtons();
}

function syncCurrentTrackToLibrary() {
  if (currentTrackId || !libraryTracks.length) return;
  const title  = (document.title.split('—')[0] || '').trim().toLowerCase();
  const artist = ($('hdrArtist')?.textContent || '').trim().toLowerCase();
  let match    = libraryTracks.find((t) => t.yt_id === YT_ID_current);
  if (!match && title) {
    match = libraryTracks.find(
      (t) => (t.title || '').trim().toLowerCase() === title && (t.artist || '').trim().toLowerCase() === artist,
    );
  }
  if (match) { currentTrackId = match.id; updateCurrentIndex(); }
}

function updateNavButtons() {
  const disabled = libraryLoadedOnce && !libraryTracks.length;
  if (prevBtn) prevBtn.disabled = disabled;
  if (nextBtn) nextBtn.disabled = disabled;
}

function updateMediaSession(track) {
  if (!('mediaSession' in navigator) || !track) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title:  track.title  || 'Untitled',
      artist: track.artist || '',
      album:  '',
    });
  } catch (err) {}
}

async function ensureLibraryReady() {
  if (libraryTracksRaw.length) return true;
  const data = await fetchLibraryTracks();
  if (!data) return false;
  libraryTracksRaw = data;
  libraryTracks    = applyLibraryOrder(libraryOrderMode, libraryTracksRaw);
  syncCurrentTrackToLibrary();
  updateCurrentIndex();
  return true;
}

// ── Track loading ──────────────────────────────────────────────────────────
function loadTrackFromData(track, { autoplay } = {}) {
  endHandling = false;
  const ok = applyTrackData({
    title:      track.title  || 'Untitled',
    artist:     track.artist || '',
    ytId:       track.yt_id,
    lyricsRaw:  track.lyrics || '',
  });
  if (!ok) return false;
  currentTrackId = track.id || null;
  updateCurrentIndex();
  updateMediaSession(track);
  try {
    if (track.id) localStorage.setItem('lastTrackId', String(track.id));
    localStorage.setItem('lastTrackKey', JSON.stringify({
      title_key:  (track.title  || '').trim().replace(/\s+/g, ' ').toLowerCase(),
      artist_key: (track.artist || '').trim().replace(/\s+/g, ' ').toLowerCase(),
    }));
  } catch (err) {}
  if (autoplay) {
    _pendingPlay = true;
    playBtn.textContent    = '⏸ PAUSE';
    statusText.textContent = 'LOADING…';
    startPlayWatch(8000);
  }
  return true;
}

async function playNextTrack(fromEnd = false) {
  endHandling = false;
  const ok = await ensureLibraryReady();
  if (!ok || !libraryTracks.length) {
    if (fromEnd) {
      playBtn.textContent    = '↺ RESTART';
      statusText.textContent = 'FINISHED';
      if ('mediaSession' in navigator) {
        try { navigator.mediaSession.playbackState = 'none'; } catch (err) {}
      }
    }
    return;
  }
  if (currentTrackIndex < 0) { loadTrackFromData(libraryTracks[0], { autoplay: true }); return; }
  const nextIndex = currentTrackIndex + 1 >= libraryTracks.length ? 0 : currentTrackIndex + 1;
  const track     = libraryTracks[nextIndex];
  if (!track) return;
  loadTrackFromData(track, { autoplay: true });
}

async function playPrevTrack() {
  const ok = await ensureLibraryReady();
  if (!ok || !libraryTracks.length) return;
  if (currentTrackIndex < 0) { loadTrackFromData(libraryTracks[libraryTracks.length - 1], { autoplay: true }); return; }
  const prevIndex = currentTrackIndex - 1 < 0 ? libraryTracks.length - 1 : currentTrackIndex - 1;
  const track     = libraryTracks[prevIndex];
  if (!track) return;
  loadTrackFromData(track, { autoplay: true });
}

// ── Library UI ─────────────────────────────────────────────────────────────
libraryList.addEventListener('click', (e) => {
  const inItem    = e.target.closest('.track-item');
  const inActions = e.target.closest('.track-actions');
  if (!inItem && !inActions) closeAllSwipes();
});

if (libraryOrderSelect) {
  libraryOrderSelect.value = libraryOrderMode;
  libraryOrderSelect.addEventListener('change', () => {
    libraryOrderMode = libraryOrderSelect.value || 'newest';
    try { localStorage.setItem('libraryOrder', libraryOrderMode); } catch (err) {}
    libraryTracks = applyLibraryOrder(libraryOrderMode, libraryTracksRaw);
    updateCurrentIndex();
    if (libraryOverlay.classList.contains('open')) renderLibraryList(libraryTracks);
  });
}

function renderLibraryList(tracks) {
  libraryList.innerHTML = '';
  closeAllSwipes();
  if (!tracks.length) { libraryStatus.textContent = 'No saved tracks yet.'; return; }
  libraryStatus.textContent = `Saved tracks: ${tracks.length}`;

  tracks.forEach((track) => {
    const swipe   = document.createElement('div');
    swipe.className = 'track-swipe';
    swipe.setAttribute('data-track-id', track.id);

    const actions = document.createElement('div');
    actions.className = 'track-actions';
    const delBtn  = document.createElement('button');
    delBtn.className   = 'delete-btn';
    delBtn.textContent = 'Delete';
    actions.appendChild(delBtn);

    const item = document.createElement('div');
    item.className = 'track-item';

    const meta = document.createElement('div');
    meta.className = 'track-meta';
    const tEl  = document.createElement('div');
    tEl.className   = 'track-title';
    tEl.textContent = (track.title || 'Untitled').toUpperCase();
    const aEl  = document.createElement('div');
    aEl.className   = 'track-artist';
    aEl.textContent = track.artist || 'Unknown artist';

    const btn  = document.createElement('button');
    btn.className   = 'track-load';
    btn.textContent = 'LOAD';

    const more = document.createElement('button');
    more.className   = 'track-more';
    more.textContent = '⋯';

    const right = document.createElement('div');
    right.className = 'track-actions-right';
    right.appendChild(btn);
    right.appendChild(more);

    meta.appendChild(tEl);
    meta.appendChild(aEl);
    item.appendChild(meta);
    item.appendChild(right);
    swipe.appendChild(actions);
    swipe.appendChild(item);

    const loadTrack = () => {
      const ok = loadTrackFromData(track, { autoplay: false });
      if (ok) {
        $('cfgTitle').value   = track.title  || '';
        $('cfgArtist').value  = track.artist || '';
        $('cfgYtUrl').value   = `https://youtu.be/${track.yt_id}`;
        $('cfgLyrics').value  = track.lyrics || '';
        setStatus($('cfgStatus'), '');
        closeLibrary();
      } else {
        libraryStatus.textContent = 'This track has invalid lyrics format.';
      }
    };

    item.addEventListener('click', () => {
      if (swipe.classList.contains('swiped')) { swipe.classList.remove('swiped'); return; }
      loadTrack();
    });
    btn.addEventListener('click',  (e) => { e.stopPropagation(); loadTrack(); });
    more.addEventListener('click', (e) => { e.stopPropagation(); closeAllSwipes(); swipe.classList.toggle('swiped'); });
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); openPass(track.id); });

    // Swipe handling
    let startX = 0, startY = 0, dragging = false;
    item.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      startX = e.touches[0].clientX; startY = e.touches[0].clientY; dragging = true;
    }, { passive: true });
    item.addEventListener('touchmove', (e) => {
      if (!dragging || !e.touches || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (Math.abs(dy) > Math.abs(dx)) return;
      if (dx < -10) swipe.classList.remove('swiped');
      if (dx >  35) { closeAllSwipes(); swipe.classList.add('swiped'); }
    }, { passive: true });
    item.addEventListener('touchend',   () => { dragging = false; });
    item.addEventListener('touchcancel', () => { dragging = false; });

    libraryList.appendChild(swipe);
  });
}

async function openLibrary() {
  libraryOverlay.classList.add('open');
  libraryList.innerHTML = '';
  libraryStatus.textContent = 'Loading...';
  closeAllSwipes();
  if (libraryOrderSelect) libraryOrderSelect.value = libraryOrderMode;
  try {
    const data = await fetchLibraryTracks();
    if (!data) { libraryStatus.textContent = 'Failed to load library. Check Supabase table/RLS.'; return; }
    libraryTracksRaw = data;
    libraryTracks    = applyLibraryOrder(libraryOrderMode, libraryTracksRaw);
    updateCurrentIndex();
    renderLibraryList(libraryTracks);
  } catch (err) {
    libraryStatus.textContent = 'Failed to load library. Network or Supabase error.';
  }
}

function closeLibrary() { libraryOverlay.classList.remove('open'); }
function closeAllSwipes() {
  document.querySelectorAll('.track-swipe.swiped').forEach((el) => el.classList.remove('swiped'));
}

// ── Password dialogs ───────────────────────────────────────────────────────
function openPass(id) {
  pendingDeleteId      = id;
  passError.textContent = '';
  passInput.value      = '';
  passOverlay.classList.add('open');
  setTimeout(() => passInput.focus(), 50);
}
function closePass() { pendingDeleteId = null; passOverlay.classList.remove('open'); }

function openSavePass(msg) {
  savePassError.textContent = msg || '';
  savePassInput.value       = '';
  savePassOverlay.classList.add('open');
  setTimeout(() => savePassInput.focus(), 50);
}
function closeSavePass() { savePassOverlay.classList.remove('open'); }

function showToast(msg) {
  if (!toastSuccess) return;
  toastSuccess.textContent = msg || 'Saved successfully ✓';
  toastSuccess.classList.add('show');
  clearTimeout(toastSuccess._t);
  toastSuccess._t = setTimeout(() => toastSuccess.classList.remove('show'), 1800);
}

async function confirmDelete() {
  if (!pendingDeleteId) return;
  if (passInput.value !== '007') { passError.textContent = 'Wrong password.'; return; }
  try {
    const resp = await sbFetch(`${TRACKS_TABLE}?id=eq.${pendingDeleteId}`, { method: 'DELETE' });
    if (!resp.ok) {
      const t = await resp.text();
      passError.textContent = t ? t.slice(0, 120) : 'Delete failed.';
      return;
    }
    libraryTracksRaw  = libraryTracksRaw.filter((t) => String(t.id) !== String(pendingDeleteId));
    libraryTracks     = applyLibraryOrder(libraryOrderMode, libraryTracksRaw);
    updateCurrentIndex();
    renderLibraryList(libraryTracks);
    updateNavButtons();
    closePass();
  } catch (err) {
    passError.textContent = 'Delete failed.';
  }
}

passCancel.addEventListener('click',  () => closePass());
passConfirm.addEventListener('click', () => confirmDelete());
passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmDelete(); });

savePassCancel.addEventListener('click', () => closeSavePass());
async function submitSavePassword() {
  if (savePassConfirm.disabled) return;
  savePassConfirm.classList.add('is-loading');
  savePassConfirm.disabled = true;
  try {
    const ok = await saveTrackToLibrary(savePassInput.value);
    if (ok) { closeSavePass(); showToast('Saved successfully ✓'); }
  } finally {
    savePassConfirm.classList.remove('is-loading');
    savePassConfirm.disabled = false;
  }
}
savePassConfirm.addEventListener('click', () => submitSavePassword());
savePassInput.addEventListener('keydown', (e) => { if (e.key !== 'Enter') return; e.preventDefault(); submitSavePassword(); });
savePassOverlay.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (!savePassOverlay.classList.contains('open')) return;
  e.preventDefault();
  submitSavePassword();
});

// ── Overlay close handlers ─────────────────────────────────────────────────
libraryOverlay.addEventListener('click', (e) => { if (e.target === libraryOverlay) closeLibrary(); });
passOverlay.addEventListener('click',    (e) => { if (e.target === passOverlay)    closePass(); });

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (libraryOverlay.classList.contains('open')) closeLibrary();
  if (passOverlay.classList.contains('open'))    closePass();
  if (savePassOverlay.classList.contains('open')) closeSavePass();
});

// ── Auto-load last track on startup ───────────────────────────────────────
async function loadLastTrack() {
  try {
    let track  = null;
    const lastId = localStorage.getItem('lastTrackId');
    const raw    = localStorage.getItem('lastTrackKey');
    if (!lastId && !raw) return;
    const cacheBust = `_ts=${Date.now()}`;
    if (lastId) {
      const resp = await sbFetch(
        `${TRACKS_TABLE}?select=id,title,artist,yt_id,lyrics,created_at&id=eq.${encodeURIComponent(lastId)}&limit=1&${cacheBust}`,
        { method: 'GET' },
      );
      if (resp.ok) { const data = await resp.json(); if (data.length) track = data[0]; }
    }
    if (!track && raw) {
      const key = JSON.parse(raw);
      if (key?.title_key && key?.artist_key) {
        const resp = await sbFetch(
          `${TRACKS_TABLE}?select=id,title,artist,yt_id,lyrics,created_at&title_key=eq.${encodeURIComponent(key.title_key)}&artist_key=eq.${encodeURIComponent(key.artist_key)}&order=created_at.desc&limit=1&${cacheBust}`,
          { method: 'GET' },
        );
        if (resp.ok) { const data = await resp.json(); if (data.length) track = data[0]; }
      }
    }
    if (!track) {
      const resp = await sbFetch(
        `${TRACKS_TABLE}?select=id,title,artist,yt_id,lyrics,created_at&order=created_at.desc&limit=1&${cacheBust}`,
        { method: 'GET' },
      );
      if (resp.ok) { const data = await resp.json(); if (data.length) track = data[0]; }
    }
    if (track) loadTrackFromData(track, { autoplay: false });
  } catch (err) {}
}
