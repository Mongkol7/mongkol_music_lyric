# System Memory

## Project
- App: Mongkol Music Lyric (single-page `index.html` + Vercel serverless API)
- Repo root: `mongkol_ai_app`
- Frontend: static HTML/CSS/JS in `index.html`
- Backend: Vercel serverless functions in `api/`

## Key Features
- YouTube lyric sync player with 3-row main lyrics + scrollable full lyrics list
- Supabase library save/load with unique matching and dedupe
- Swipe-to-delete (mobile) + three-dot delete (desktop) + password prompt (`007`)
- Volume control for YouTube player
- Vercel Analytics script injected in `index.html`
- Caption import + language detection + merge mode
- Auto-align lyrics using ElevenLabs forced alignment (YouTube audio or uploaded audio)

## Supabase
- URL: `https://uhfukcpnuakhxgzjdqyg.supabase.co`
- Table: `tracks`
- Unique constraint: `(title_key, artist_key)`
- Save logic: update if any **2 of 3** match `(title, artist, yt_id)`; otherwise upsert by `title_key + artist_key`, dedupe duplicates
- `lastTrackId` stored in localStorage for reload

## Caption Import
- Client: `importCaptions()` and `detectCaptionLanguages()` in `index.html`
- Server proxy: `api/captions.js`
- Providers:
  - `youtubetranscripts.app`
  - `youtube-transcript-mcp.ergut.workers.dev`
  - `youtubetranscript.com`
  - YouTube timedtext (XML) + language list
- Filters out system/noise caption lines

## Auto Align
- Buttons: `AUTO ALIGN (ADD TIMESTAMPS)` and `AUTO ALIGN (UPLOAD AUDIO)`
- Server routes:
  - `api/align.js` (YouTube audio + ElevenLabs)
    - Uses lowest quality audio via `ytdl-core`
    - Known issue: YouTube may block download (410)
  - `api/align-upload.js` (upload audio + ElevenLabs) using `busboy`
- Env var required in Vercel: `ELEVENLABS_API_KEY`
- Alignment logic reverted to the original ElevenLabs matching (simple first-word anchor + cursor scan).
- Reverted storage-based upload flow (bucket/CORS issues). Current upload still subject to Vercel payload limits.

## Commits (recent)
- `9b3715f` Add audio upload auto align
- `d9f1e8e` Improve align error reporting
- `312d76a` Make auto align button visible
- `44a6082` Improve captions proxy fallbacks
- `2de4305` Add captions proxy API for import
- `0864962` Add library add button and caption tools
- `f691463` Improve auto-align accuracy and password submit

## UI Notes
- Dev credit glow with animated horizontal light-bar under name
- Desktop layout: lyrics left, YouTube + list right
- Mobile: responsive adjustments and controls

## Passwords
- Delete password: `007`

## Known Issues
- Some YouTube links block audio download (HTTP 410), use upload alignment.

