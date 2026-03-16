# System Memory

## Project
- App: Mongkol Music Lyric (single-page `index.html` + Vercel serverless API)
- Repo root: `mongkol_ai_app`
- Frontend: clean HTML shell (`index.html`) + split source files in `src/`
- Backend: Vercel serverless functions in `api/`

## File Structure
```
mongkol_ai_app/
├── api/                      # Vercel serverless functions
│   ├── align.js              # ElevenLabs auto-align via YouTube audio
│   ├── align-upload.js       # ElevenLabs auto-align via file upload
│   ├── captions.js           # YouTube captions proxy
│   └── update-track.js       # Password-protected Supabase update
├── src/
│   ├── css/
│   │   └── main.css          # ALL styles (extracted from old index.html)
│   └── js/
│       ├── data.js           # Default lyrics[], sections[], constants
│       ├── player.js         # YouTube IFrame API + playback engine + seek
│       ├── lyrics-display.js # 3-row lyric stage + scrollable list panel
│       ├── library.js        # Supabase CRUD + library/password UI
│       ├── config.js         # Config panel, caption import, align, save
│       └── app.js            # Bootstrap (MediaSession + init calls)
├── index.html                # Clean HTML shell (links CSS + JS)
├── index.html.bak            # Backup of original monolithic file
├── vercel.json               # Vercel function config
├── package.json
├── MEMORY.md
└── README.md
```

## Key Features
- YouTube lyric sync player with 3-row main lyrics + scrollable full lyrics list
- Dual YouTube players kept for reliability; crossfade toggle removed
- Auto-advance + prev/next
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
- Client: `importCaptions()` and `detectCaptionLanguages()` in `src/js/config.js`
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

## Playback
- Crossfade removed; auto-advance reloads the player per song.
- Auto-advance uses YT duration when available; total time display updates from `ytPlayer.getDuration()`.
- Added guard `endHandling` + `syncCurrentTrackToLibrary()` to reduce double-next and mis-synced lyrics/video.
- **Lyric timing fix**: removed 180ms `setTimeout` in `showLyric()` — lyrics now display immediately at the correct timestamp. Entrance animation still uses double-`rAF` for smooth CSS transition.
- Jump-detection delta raised from 2.5s → 3.5s to prevent false resets during buffering.
- User-scroll auto-scroll lock reduced from 3000ms → 1500ms.

## Commits (recent)
- `(pending)` Reorganize file structure: extract CSS/JS from index.html into src/
- `(pending)` Fix lyric timing: remove 180ms setTimeout delay in showLyric
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
