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

  const password = body.password || '';
  const expected = process.env.SAVE_PASSWORD || '';
  if (!expected) {
    res.status(500).json({ error: 'Missing SAVE_PASSWORD' });
    return;
  }
  if (password !== expected) {
    res.status(401).json({ error: 'Wrong password' });
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(500).json({ error: 'Missing Supabase service credentials' });
    return;
  }

  const title = (body.title || '').trim().replace(/\s+/g, ' ');
  const artist = (body.artist || '').trim().replace(/\s+/g, ' ');
  const ytId = body.yt_id || '';
  const lyrics = body.lyrics || '';
  const titleKey =
    body.title_key || title.trim().replace(/\s+/g, ' ').toLowerCase();
  const artistKey =
    body.artist_key || artist.trim().replace(/\s+/g, ' ').toLowerCase();

  if (!title || !ytId || !lyrics) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  const qTitle = encodeURIComponent(titleKey);
  const qArtist = encodeURIComponent(artistKey);
  const qYt = encodeURIComponent(ytId);
  const qTitleQ = encodeURIComponent(`"${titleKey}"`);
  const qArtistQ = encodeURIComponent(`"${artistKey}"`);
  const qYtQ = encodeURIComponent(`"${ytId}"`);

  const headers = {
    'Content-Type': 'application/json',
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
  };

  try {
    const matchResp = await fetch(
      `${SUPABASE_URL}/rest/v1/tracks?select=id,created_at,title_key,artist_key,yt_id&or=(and(title_key.eq.${qTitleQ},artist_key.eq.${qArtistQ}),and(title_key.eq.${qTitleQ},yt_id.eq.${qYtQ}),and(artist_key.eq.${qArtistQ},yt_id.eq.${qYtQ}))&order=created_at.desc`,
      { method: 'GET', headers },
    );
    if (!matchResp.ok) {
      const t = await matchResp.text();
      res.status(500).json({ error: 'Match lookup failed', details: t });
      return;
    }
    const rows = await matchResp.json();
    if (!rows.length) {
      res.status(404).json({ error: 'No matching row found' });
      return;
    }
    const keepId = rows[0].id;

    const payload = {
      title,
      artist,
      title_key: titleKey,
      artist_key: artistKey,
      yt_id: ytId,
      lyrics,
    };

    const patchResp = await fetch(
      `${SUPABASE_URL}/rest/v1/tracks?id=eq.${keepId}`,
      {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(payload),
      },
    );
    if (!patchResp.ok) {
      const t = await patchResp.text();
      res.status(500).json({ error: 'Update failed', details: t });
      return;
    }

    if (rows.length > 1) {
      const delIds = rows
        .slice(1)
        .map((r) => r.id)
        .filter(Boolean);
      if (delIds.length) {
        const idList = delIds.join(',');
        await fetch(`${SUPABASE_URL}/rest/v1/tracks?id=in.(${idList})`, {
          method: 'DELETE',
          headers,
        });
      }
    }

    res.status(200).json({ id: keepId });
  } catch (err) {
    res.status(500).json({
      error: 'Update failed',
      details: String(err?.message || err),
    });
  }
}
