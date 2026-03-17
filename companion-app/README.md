# Mongkol Companion (React Native)

Minimal native companion app for Instagram/Facebook Stories sharing.

**What it does**
1. Accepts deep links from the web app using the scheme `mongkolmusic://share?...`
2. Fetches the track from Supabase (by `trackId` or `ytId`)
3. Opens Instagram/Facebook Stories using Meta’s Sharing to Stories API

## Setup
1. Install dependencies
```
npm install
```
2. Configure constants in `companion-app/App.js`
- `META_APP_ID`
- `WEB_APP_URL`
3. Add the URL scheme `mongkolmusic` to iOS and Android
4. Build and run
```
npx expo prebuild
npx expo run:ios
npx expo run:android
```

## Meta App Requirements
1. Create a Facebook App (type: Consumer)
2. Add Instagram product → Sharing to Stories
3. Register your iOS Bundle ID and Android Package Name
4. Use the Facebook App ID as `META_APP_ID`

## Notes
1. Instagram Stories sharing requires the Instagram app installed
2. The app uses a tiny fallback background image so the share always has media
3. If you want a custom story background, swap `FALLBACK_BG` with a real image path or base64

## Deep Link Test
Once the app is running, test with:
```
mongkolmusic://share?title=Flashing%20Lights&artist=Kanye%20West&ytId=ZAz3rnLGthg
```
