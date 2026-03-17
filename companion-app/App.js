import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Share from 'react-native-share';

const SUPABASE_URL = 'https://uhfukcpnuakhxgzjdqyg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVoZnVrY3BudWFraHhnempkcXlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTc0NjcsImV4cCI6MjA4ODg3MzQ2N30.4xlY4uR8oBVQjKcho68WjL6rXXYyLIwEFzGPdC7BlAs';
const TRACKS_TABLE = 'tracks';

const META_APP_ID = '1254128952993058';
const WEB_APP_URL = 'https://mongkol-music-lyric.vercel.app';

const FALLBACK_BG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6oJjT8AAAAASUVORK5CYII=';

function getThumbnailUrl(ytId) {
  if (!ytId) return null;
  return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
}

function parseParams(rawUrl) {
  if (!rawUrl) return {};
  try {
    const url = new URL(rawUrl);
    const params = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  } catch (err) {
    const parts = rawUrl.split('?');
    if (parts.length < 2) return {};
    const query = parts[1];
    return query.split('&').reduce((acc, item) => {
      const [k, v] = item.split('=');
      if (!k) return acc;
      acc[decodeURIComponent(k)] = decodeURIComponent(v || '');
      return acc;
    }, {});
  }
}

function buildWebUrl(track) {
  if (!track) return WEB_APP_URL;
  if (track.id) return `${WEB_APP_URL}?track=${encodeURIComponent(track.id)}`;
  if (track.yt_id) return `${WEB_APP_URL}?yt=${encodeURIComponent(track.yt_id)}`;
  return WEB_APP_URL;
}

async function sbFetch(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...(options.headers || {}),
  };
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers, method });
}

async function fetchTrackById(id) {
  if (!id) return null;
  const resp = await sbFetch(
    `${TRACKS_TABLE}?select=id,title,artist,yt_id,created_at&limit=1&id=eq.${encodeURIComponent(id)}`,
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function fetchTrackByYt(ytId) {
  if (!ytId) return null;
  const resp = await sbFetch(
    `${TRACKS_TABLE}?select=id,title,artist,yt_id,created_at&order=created_at.desc&limit=1&yt_id=eq.${encodeURIComponent(ytId)}`,
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  return Array.isArray(data) && data.length ? data[0] : null;
}

export default function App() {
  const [track, setTrack] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Waiting for share link...');

  const loadFromParams = useCallback(async (params) => {
    const trackId = params.trackId || params.trackid;
    const ytId = params.ytId || params.ytid;
    setLoading(true);
    setStatus('Loading track...');
    let data = null;
    try {
      if (trackId) data = await fetchTrackById(trackId);
      if (!data && ytId) data = await fetchTrackByYt(ytId);
      if (!data) {
        data = {
          id: trackId || null,
          yt_id: ytId || null,
          title: params.title || 'Unknown title',
          artist: params.artist || 'Unknown artist',
        };
      }
      setTrack(data);
      setStatus('Ready to share.');
    } catch (err) {
      setStatus('Failed to load track.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (!url) return;
      const params = parseParams(url);
      loadFromParams(params);
    });
    const sub = Linking.addEventListener('url', ({ url }) => {
      const params = parseParams(url);
      loadFromParams(params);
    });
    return () => sub.remove();
  }, [loadFromParams]);

  const webUrl = useMemo(() => buildWebUrl(track), [track]);

  const shareToInstagram = async () => {
    if (!track) return;
    const thumb = getThumbnailUrl(track.yt_id) || FALLBACK_BG;
    try {
      await Share.shareSingle({
        social: Share.Social.INSTAGRAM_STORIES,
        backgroundImage: thumb,
        stickerImage: thumb,
        attributionURL: webUrl,
        contentUrl: webUrl,
        appId: META_APP_ID,
      });
      setStatus('Instagram opened.');
    } catch (err) {
      Alert.alert('Share failed', 'Instagram Stories share failed or app not installed.');
    }
  };

  const shareToFacebook = async () => {
    if (!track) return;
    const thumb = getThumbnailUrl(track.yt_id) || FALLBACK_BG;
    try {
      await Share.shareSingle({
        social: Share.Social.FACEBOOK_STORIES,
        backgroundImage: thumb,
        stickerImage: thumb,
        attributionURL: webUrl,
        contentUrl: webUrl,
        appId: META_APP_ID,
      });
      setStatus('Facebook opened.');
    } catch (err) {
      Alert.alert('Share failed', 'Facebook Stories share failed or app not installed.');
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>Mongkol Companion</Text>
        <Text style={styles.subtitle}>{status}</Text>
        {loading && <ActivityIndicator color="#21f6a1" />}

        <View style={styles.trackBox}>
          <Text style={styles.trackTitle}>{track?.title || 'No track loaded'}</Text>
          <Text style={styles.trackArtist}>{track?.artist || 'Send from web app'}</Text>
          <Text style={styles.trackMeta}>{track?.yt_id ? `YT: ${track.yt_id}` : ''}</Text>
        </View>

        <TouchableOpacity style={styles.btn} onPress={shareToInstagram} disabled={!track}>
          <Text style={styles.btnText}>Share to Instagram Story</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnAlt} onPress={shareToFacebook} disabled={!track}>
          <Text style={styles.btnText}>Share to Facebook Story</Text>
        </TouchableOpacity>
        <Text style={styles.note}>Web link: {webUrl}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0c16',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#101528',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    fontSize: 20,
    color: '#e8f2ff',
    fontWeight: '600',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 12,
    color: '#8b92a3',
    marginBottom: 12,
  },
  trackBox: {
    borderRadius: 10,
    padding: 12,
    backgroundColor: 'rgba(14,18,30,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 16,
  },
  trackTitle: {
    fontSize: 16,
    color: '#ffffff',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  trackArtist: {
    fontSize: 12,
    color: '#21f6a1',
    marginTop: 4,
  },
  trackMeta: {
    fontSize: 11,
    color: '#80889a',
    marginTop: 6,
  },
  btn: {
    backgroundColor: '#21f6a1',
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 10,
  },
  btnAlt: {
    backgroundColor: '#2b58ff',
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnText: {
    textAlign: 'center',
    color: '#0a0c16',
    fontWeight: '700',
  },
  note: {
    marginTop: 14,
    fontSize: 10,
    color: '#7b8396',
  },
});
