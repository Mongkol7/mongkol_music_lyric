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
const shareOverlay    = $('shareOverlay');
const shareTrackEl    = $('shareTrack');
const shareQrEl       = $('shareQr');
const shareUrlEl      = $('shareUrl');
const shareNativeBtn  = $('shareNativeBtn');
const shareCopyBtn    = $('shareCopyBtn');
const shareCloseBtn   = $('shareCloseBtn');
let lastSharePayload  = null;
const toastSuccess    = $('toastSuccess');
const searchWrap   = $('searchWrap');
const searchBtn    = $('searchBtn');
const searchPanel  = $('searchPanel');
const searchInput  = $('searchInput');
const searchListEl = $('searchList');
const searchEmpty  = $('searchEmpty');
const librarySearchWrap   = $('librarySearchWrap');
const librarySearchBtn    = $('librarySearchBtn');
const librarySearchPanel  = $('librarySearchPanel');
const librarySearchInput  = $('librarySearchInput');
const librarySearchListEl = $('librarySearchList');
const librarySearchEmpty  = $('librarySearchEmpty');
const queueToggle = $('queueToggle');
const queuePanel  = $('queuePanel');
const queueBody   = $('queueBody');
const queueListEl = $('queueList');
const queueEmpty  = $('queueEmpty');
const queueOrderLabel = $('queueOrderLabel');
let   pendingDeleteId = null;
let   lastCountedTrackId = null;
let   searchDebounceId   = null;
const SEARCH_DEBOUNCE_MS = 140;

// ── Helpers ────────────────────────────────────────────────────────────────
function shuffleArray(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function normalizeArtistText(text) {
  return String(text || '')
    .split('·')[0]
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeTitleText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function applyLibraryOrder(mode, tracksRaw) {
  if (!Array.isArray(tracksRaw)) return [];
  if (mode === 'oldest') return tracksRaw.slice().reverse();
  if (mode === 'most_listened') {
    return tracksRaw
      .slice()
      .sort((a, b) => {
        const aCount = Number(a.listen_count || 0);
        const bCount = Number(b.listen_count || 0);
        if (bCount !== aCount) return bCount - aCount;
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      });
  }
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
    `${TRACKS_TABLE}?select=id,title,artist,yt_id,lyrics,created_at,listen_count&order=created_at.desc`,
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
  const title  = normalizeTitleText(document.title.split('—')[0] || '');
  const artist = normalizeArtistText($('hdrArtist')?.textContent || '');
  let match    = libraryTracks.find((t) => t.yt_id === YT_ID_current);
  if (!match && title) {
    match = libraryTracks.find(
      (t) => normalizeTitleText(t.title) === title && normalizeArtistText(t.artist) === artist,
    );
  }
  if (!match && title && artist) {
    match = libraryTracks.find((t) => {
      const tTitle  = normalizeTitleText(t.title);
      const tArtist = normalizeArtistText(t.artist);
      if (!tTitle || !tArtist) return false;
      return tTitle === title && (tArtist.includes(artist) || artist.includes(tArtist));
    });
  }
  if (match) { currentTrackId = match.id; updateCurrentIndex(); }
}

function updateNavButtons() {
  const disabled = libraryLoadedOnce && !libraryTracks.length;
  if (prevBtn) prevBtn.disabled = disabled;
  if (nextBtn) nextBtn.disabled = disabled;
}

function renderSearchList(tracks, query = '', listEl = searchListEl, emptyEl = searchEmpty) {
  if (!listEl || !emptyEl) return;
  const q = query.trim().toLowerCase();
  const filtered = (tracks || []).filter((t) => {
    const title  = (t.title  || '').toLowerCase();
    const artist = (t.artist || '').toLowerCase();
    return !q || title.includes(q) || artist.includes(q);
  });
  listEl.innerHTML = '';
  if (!filtered.length) {
    emptyEl.classList.add('show');
    return;
  }
  emptyEl.classList.remove('show');
  const frag = document.createDocumentFragment();
  filtered.forEach((track) => {
    const item = document.createElement('div');
    item.className = 'search-item';
    const tEl = document.createElement('div');
    tEl.className = 'search-item-title';
    tEl.textContent = (track.title || 'Untitled').toUpperCase();
    const aEl = document.createElement('div');
    aEl.className = 'search-item-artist';
    aEl.textContent = track.artist || 'Unknown artist';
    const pEl = document.createElement('div');
    pEl.className = 'search-item-plays';
    pEl.textContent = `Plays: ${Number(track.listen_count || 0).toLocaleString()}`;
    item.appendChild(tEl);
    item.appendChild(aEl);
    item.appendChild(pEl);
    item.addEventListener('click', () => {
      loadTrackFromData(track, { autoplay: true });
      closeSearch();
      closeLibrarySearch();
    });
    frag.appendChild(item);
  });
  listEl.appendChild(frag);
}

function renderQueueList(tracks) {
  if (!queueListEl || !queueEmpty) return;
  queueListEl.innerHTML = '';
  if (!tracks.length) {
    queueEmpty.classList.add('show');
    return;
  }
  queueEmpty.classList.remove('show');
  const frag = document.createDocumentFragment();
  tracks.forEach((track) => {
    const item = document.createElement('div');
    item.className = 'queue-item';
    if (currentTrackId && String(track.id) === String(currentTrackId)) {
      item.classList.add('is-current');
    }
    const tEl = document.createElement('div');
    tEl.className = 'queue-title';
    tEl.textContent = (track.title || 'Untitled').toUpperCase();
    const aEl = document.createElement('div');
    aEl.className = 'queue-artist';
    aEl.textContent = track.artist || 'Unknown artist';
    const pEl = document.createElement('div');
    pEl.className = 'queue-plays';
    pEl.textContent = `Plays: ${Number(track.listen_count || 0).toLocaleString()}`;
    item.appendChild(tEl);
    item.appendChild(aEl);
    item.appendChild(pEl);
    item.addEventListener('click', () => {
      loadTrackFromData(track, { autoplay: false });
      queuePanel?.classList.remove('open');
    });
    frag.appendChild(item);
  });
  queueListEl.appendChild(frag);
}

function updateQueueOrderLabel() {
  if (!queueOrderLabel) return;
  const labels = {
    newest: 'Newest',
    oldest: 'Oldest',
    random: 'Random',
    most_listened: 'Most listened',
  };
  queueOrderLabel.textContent = `• ${labels[libraryOrderMode] || 'Newest'}`;
}

async function openSearch() {
  if (!searchWrap || !searchPanel) return;
  searchWrap.classList.add('open');
  if (searchInput) searchInput.value = '';
  const ok = await ensureLibraryReady();
  if (ok) {
    renderSearchList(libraryTracks, '', searchListEl, searchEmpty);
    if (searchInput) searchInput.focus();
  }
}

function closeSearch() {
  if (!searchWrap) return;
  searchWrap.classList.remove('open');
  if (searchInput) searchInput.value = '';
}

function toggleSearch() {
  if (!searchWrap) return;
  if (searchWrap.classList.contains('open')) closeSearch();
  else openSearch();
}

async function openLibrarySearch() {
  if (!librarySearchWrap || !librarySearchPanel) return;
  librarySearchWrap.classList.add('open');
  if (librarySearchInput) librarySearchInput.value = '';
  const ok = await ensureLibraryReady();
  if (ok) {
    renderSearchList(libraryTracks, '', librarySearchListEl, librarySearchEmpty);
    if (librarySearchInput) librarySearchInput.focus();
  }
}

function closeLibrarySearch() {
  if (!librarySearchWrap) return;
  librarySearchWrap.classList.remove('open');
  if (librarySearchInput) librarySearchInput.value = '';
}

function toggleLibrarySearch() {
  if (!librarySearchWrap) return;
  if (librarySearchWrap.classList.contains('open')) closeLibrarySearch();
  else openLibrarySearch();
}

if (queueToggle) {
  queueToggle.addEventListener('click', async () => {
    if (!queuePanel) return;
    updateQueueOrderLabel();
    const open = queuePanel.classList.toggle('open');
    if (open) {
      const ok = await ensureLibraryReady();
      if (ok) renderQueueList(libraryTracks);
    }
  });
}

function getSharePayload() {
  const ytId  = typeof YT_ID_current === 'string' ? YT_ID_current : '';
  const base  = `${window.location.origin}${window.location.pathname}`;
  const url   = currentTrackId
    ? `${base}?track=${encodeURIComponent(currentTrackId)}`
    : (ytId ? `${base}?yt=${encodeURIComponent(ytId)}` : '');
  if (!url) return null;
  const title = ($('hdrTrackTitle')?.textContent || 'YouTube Track').trim();
  const artist = ($('hdrArtist')?.textContent || '').trim();
  const text  = artist ? `${title} - ${artist}` : title;
  return { title, text, url };
}

function openShareOverlay(payload) {
  if (!shareOverlay || !payload) return;
  lastSharePayload = payload;
  if (shareTrackEl) shareTrackEl.textContent = payload.text || payload.title || 'Track';
  if (shareUrlEl) shareUrlEl.textContent = payload.url;
  if (shareQrEl) {
    const size = '240x240';
    shareQrEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}&data=${encodeURIComponent(payload.url)}&t=${Date.now()}`;
  }
  if (shareNativeBtn) {
    const supported = !!navigator.share;
    shareNativeBtn.disabled = !supported;
    shareNativeBtn.textContent = supported ? 'Share' : 'Share';
  }
  shareOverlay.classList.add('open');
}

function closeShareOverlay() {
  if (!shareOverlay) return;
  shareOverlay.classList.remove('open');
}

async function shareToCompanion() {
  const payload = getSharePayload();
  if (!payload) return;
  try {
    if (navigator.share) await navigator.share(payload);
  } catch (err) {}
  openShareOverlay(payload);
}


// ── Load track from shared URL ───────────────────────────────────────────
async function loadTrackFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    const trackId = params.get('track');
    const ytId = params.get('yt');
    if (!trackId && !ytId) return false;
    const cacheBust = `_ts=${Date.now()}`;
    let resp = null;
    if (trackId) {
      resp = await sbFetch(
        `${TRACKS_TABLE}?select=id,title,artist,yt_id,lyrics,created_at,listen_count&id=eq.${encodeURIComponent(trackId)}&limit=1&${cacheBust}`,
        { method: 'GET' },
      );
    } else if (ytId) {
      resp = await sbFetch(
        `${TRACKS_TABLE}?select=id,title,artist,yt_id,lyrics,created_at,listen_count&yt_id=eq.${encodeURIComponent(ytId)}&limit=1&${cacheBust}`,
        { method: 'GET' },
      );
    }
    if (resp && resp.ok) {
      const data = await resp.json();
      if (data.length) {
        loadTrackFromData(data[0], { autoplay: false });
        updateQueueOrderLabel();
        return true;
      }
    }
  } catch (err) {}
  return false;
}

function bumpListenCount(trackId) {
  if (!trackId) return;
  const bump = (arr) => {
    const t = arr.find((x) => String(x.id) === String(trackId));
    if (!t) return;
    t.listen_count = Number(t.listen_count || 0) + 1;
  };
  bump(libraryTracksRaw);
  bump(libraryTracks);
  libraryTracks = applyLibraryOrder(libraryOrderMode, libraryTracksRaw);
  if (searchWrap && searchWrap.classList.contains('open')) {
    renderSearchList(libraryTracks, searchInput ? searchInput.value : '', searchListEl, searchEmpty);
  }
  if (librarySearchWrap && librarySearchWrap.classList.contains('open')) {
    renderSearchList(libraryTracks, librarySearchInput ? librarySearchInput.value : '', librarySearchListEl, librarySearchEmpty);
  }
  if (libraryOverlay && libraryOverlay.classList.contains('open')) {
    renderLibraryList(libraryTracks);
  }
  if (queuePanel?.classList.contains('open')) {
    renderQueueList(libraryTracks);
  }
}

async function recordListen(trackId) {
  let id = trackId;
  if (!id) {
    await ensureLibraryReady();
    syncCurrentTrackToLibrary();
    id = currentTrackId;
  }
  if (!id) {
    const resolved = await resolveTrackIdFromMeta();
    if (resolved) {
      id = resolved;
      currentTrackId = resolved;
      updateCurrentIndex();
    }
  }
  if (!id) return;
  if (lastCountedTrackId === id) return;
  lastCountedTrackId = id;
  bumpListenCount(id);
  try {
    await sbFetch('rpc/increment_listen', {
      method: 'POST',
      body: JSON.stringify({ track_id: id }),
    });
  } catch (err) {}
}

async function resolveTrackIdFromMeta() {
  const cacheBust = `_ts=${Date.now()}`;
  const ytId = typeof YT_ID_current === 'string' ? YT_ID_current : '';
  if (ytId) {
    const resp = await sbFetch(
      `${TRACKS_TABLE}?select=id,listen_count,yt_id&yt_id=eq.${encodeURIComponent(ytId)}&limit=1&${cacheBust}`,
      { method: 'GET' },
    );
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data) && data.length) return data[0].id;
    }
  }
  const titleKey  = normalizeTitleText(document.title.split('—')[0] || '');
  const artistKey = normalizeArtistText($('hdrArtist')?.textContent || '');
  if (!titleKey || !artistKey) return null;
  const resp = await sbFetch(
    `${TRACKS_TABLE}?select=id,listen_count,title,artist&title_key=eq.${encodeURIComponent(titleKey)}&artist_key=eq.${encodeURIComponent(artistKey)}&order=created_at.desc&limit=1&${cacheBust}`,
    { method: 'GET' },
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  if (!Array.isArray(data) || !data.length) return null;
  return data[0].id;
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
  updateQueueOrderLabel();
  return true;
}

// ── Track loading ──────────────────────────────────────────────────────────
function loadTrackFromData(track, { autoplay } = {}) {
  endHandling = false;
  lastCountedTrackId = null;
  const ok = applyTrackData(
    {
      title:      track.title  || 'Untitled',
      artist:     track.artist || '',
      ytId:       track.yt_id,
      lyricsRaw:  track.lyrics || '',
    },
    { autoplay: !!autoplay },
  );
  if (!ok) return false;
  currentTrackId = track.id || null;
  updateCurrentIndex();
  updateQueueOrderLabel();
  if (queuePanel?.classList.contains('open')) {
    renderQueueList(libraryTracks);
  }
  updateMediaSession(track);
  try {
    if (track.id) localStorage.setItem('lastTrackId', String(track.id));
    localStorage.setItem('lastTrackKey', JSON.stringify({
      title_key:  (track.title  || '').trim().replace(/\s+/g, ' ').toLowerCase(),
      artist_key: (track.artist || '').trim().replace(/\s+/g, ' ').toLowerCase(),
    }));
  } catch (err) {}
  return true;
}

async function playNextTrack(fromEnd = false) {
  endHandling = false;
  const ok = await ensureLibraryReady();
  if (!ok && fromEnd) {
    playBtn.textContent    = '? RESTART';
    statusText.textContent = 'FINISHED';
    return;
  }
  if (!ok) return;
  const nextIndex = currentTrackIndex + 1 >= libraryTracks.length ? 0 : currentTrackIndex + 1;
  const track     = libraryTracks[nextIndex];
  if (track) loadTrackFromData(track, { autoplay: true });
}

async function playPrevTrack() {
  const ok = await ensureLibraryReady();
  if (!ok) return;
  const prevIndex = currentTrackIndex - 1 < 0 ? libraryTracks.length - 1 : currentTrackIndex - 1;
  const track     = libraryTracks[prevIndex];
  if (track) loadTrackFromData(track, { autoplay: true });
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
      if (queuePanel?.classList.contains('open')) {
        renderQueueList(libraryTracks);
      }
      updateQueueOrderLabel();
    });
  }

if (searchBtn) {
  searchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSearch();
  });
}
if (searchInput) {
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceId);
    searchDebounceId = setTimeout(() => {
      renderSearchList(libraryTracks, searchInput.value, searchListEl, searchEmpty);
    }, SEARCH_DEBOUNCE_MS);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearch();
  });
}
document.addEventListener('click', (e) => {
  if (!searchWrap) return;
  if (!searchWrap.contains(e.target)) closeSearch();
});

if (librarySearchBtn) {
  librarySearchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLibrarySearch();
  });
}
if (librarySearchInput) {
  librarySearchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceId);
    searchDebounceId = setTimeout(() => {
      renderSearchList(libraryTracks, librarySearchInput.value, librarySearchListEl, librarySearchEmpty);
    }, SEARCH_DEBOUNCE_MS);
  });
  librarySearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLibrarySearch();
  });
}
document.addEventListener('click', (e) => {
  if (!librarySearchWrap) return;
  if (!librarySearchWrap.contains(e.target)) closeLibrarySearch();
});

function renderLibraryList(tracks) {
  libraryList.innerHTML = '';
  closeAllSwipes();
  if (!tracks.length) { libraryStatus.textContent = 'No saved tracks yet.'; return; }
  libraryStatus.textContent = `Saved tracks: ${tracks.length}`;

  const frag = document.createDocumentFragment();
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
    const pEl  = document.createElement('div');
    pEl.className   = 'track-plays';
    pEl.textContent = `Plays: ${Number(track.listen_count || 0).toLocaleString()}`;

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
    meta.appendChild(pEl);
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

    frag.appendChild(swipe);
  });
  libraryList.appendChild(frag);
}

async function openLibrary() {
  libraryOverlay.classList.add('open');
  closeAllSwipes();
  if (libraryOrderSelect) libraryOrderSelect.value = libraryOrderMode;
  if (libraryTracksRaw.length) {
    libraryTracks = applyLibraryOrder(libraryOrderMode, libraryTracksRaw);
    updateCurrentIndex();
    renderLibraryList(libraryTracks);
    libraryStatus.textContent = `Saved tracks: ${libraryTracks.length} (refreshing...)`;
  } else {
    libraryList.innerHTML = '';
    libraryStatus.textContent = 'Loading...';
  }
  try {
    const data = await fetchLibraryTracks();
    if (!data) {
      if (!libraryTracksRaw.length) {
        libraryStatus.textContent = 'Failed to load library. Check Supabase table/RLS.';
      } else {
        libraryStatus.textContent = `Saved tracks: ${libraryTracksRaw.length}`;
      }
      return;
    }
    libraryTracksRaw = data;
    libraryTracks    = applyLibraryOrder(libraryOrderMode, libraryTracksRaw);
    updateCurrentIndex();
    renderLibraryList(libraryTracks);
    if (queueToggle && queueToggle.closest('.queue-panel')?.classList.contains('open')) {
      renderQueueList(libraryTracks);
    }
  } catch (err) {
    if (!libraryTracksRaw.length) {
      libraryStatus.textContent = 'Failed to load library. Network or Supabase error.';
    } else {
      libraryStatus.textContent = `Saved tracks: ${libraryTracksRaw.length}`;
    }
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

if (shareNativeBtn) {
  shareNativeBtn.addEventListener('click', async () => {
    const payload = lastSharePayload || getSharePayload();
    if (!payload || !navigator.share) return;
    try { await navigator.share(payload); } catch (err) {}
  });
}
if (shareCopyBtn) {
  shareCopyBtn.addEventListener('click', async () => {
    const payload = lastSharePayload || getSharePayload();
    if (!payload) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(payload.url);
        showToast('Link copied ✓');
        return;
      }
    } catch (err) {}
    const ta = document.createElement('textarea');
    ta.value = payload.url;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast('Link copied ✓'); } catch (err) {}
    document.body.removeChild(ta);
  });
}
if (shareCloseBtn) shareCloseBtn.addEventListener('click', () => closeShareOverlay());

// ── Overlay close handlers ─────────────────────────────────────────────────
libraryOverlay.addEventListener('click', (e) => { if (e.target === libraryOverlay) closeLibrary(); });
passOverlay.addEventListener('click',    (e) => { if (e.target === passOverlay)    closePass(); });
if (shareOverlay) shareOverlay.addEventListener('click', (e) => { if (e.target === shareOverlay) closeShareOverlay(); });

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (libraryOverlay.classList.contains('open')) closeLibrary();
  if (passOverlay.classList.contains('open'))    closePass();
  if (savePassOverlay.classList.contains('open')) closeSavePass();
  if (shareOverlay && shareOverlay.classList.contains('open')) closeShareOverlay();
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
        `${TRACKS_TABLE}?select=id,title,artist,yt_id,lyrics,created_at,listen_count&id=eq.${encodeURIComponent(lastId)}&limit=1&${cacheBust}`,
        { method: 'GET' },
      );
      if (resp.ok) { const data = await resp.json(); if (data.length) track = data[0]; }
    }
    if (!track && raw) {
      const key = JSON.parse(raw);
      if (key?.title_key && key?.artist_key) {
        const resp = await sbFetch(
          `${TRACKS_TABLE}?select=id,title,artist,yt_id,lyrics,created_at,listen_count&title_key=eq.${encodeURIComponent(key.title_key)}&artist_key=eq.${encodeURIComponent(key.artist_key)}&order=created_at.desc&limit=1&${cacheBust}`,
          { method: 'GET' },
        );
        if (resp.ok) { const data = await resp.json(); if (data.length) track = data[0]; }
      }
    }
    if (!track) {
      const resp = await sbFetch(
      `${TRACKS_TABLE}?select=id,title,artist,yt_id,lyrics,created_at,listen_count&order=created_at.desc&limit=1&${cacheBust}`,
        { method: 'GET' },
      );
      if (resp.ok) { const data = await resp.json(); if (data.length) track = data[0]; }
    }
    if (track) loadTrackFromData(track, { autoplay: false });
    updateQueueOrderLabel();
  } catch (err) {}
}

