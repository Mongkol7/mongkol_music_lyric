// ─── app.js — Bootstrap & MediaSession wiring ────────────────────────────────
// Must be the LAST script loaded (after all other modules).

'use strict';

// ── Media Session API ──────────────────────────────────────────────────────
if ('mediaSession' in navigator) {
  try {
    navigator.mediaSession.setActionHandler('play',          () => playAll());
    navigator.mediaSession.setActionHandler('pause',         () => pauseAll());
    navigator.mediaSession.setActionHandler('nexttrack',     () => playNextTrack());
    navigator.mediaSession.setActionHandler('previoustrack', () => playPrevTrack());
  } catch (err) {}
}

// ── Init ───────────────────────────────────────────────────────────────────
(async () => {
  let loadedFromUrl = false;
  if (typeof loadTrackFromUrl === 'function') {
    loadedFromUrl = await loadTrackFromUrl();
  }
  if (!loadedFromUrl) {
    loadLastTrack(); // restore last-played track from Supabase
  }
  initDevBar(); // start the animated dev credit bar
  setTimeout(() => {
    if (typeof ensureLibraryReady === 'function') ensureLibraryReady();
  }, 900);
})();
