import crypto from 'crypto';
import type express from 'express';
import type { MusicTrack, SpotifySessionStatus } from '../src/types/music.ts';

interface SpotifySessionRecord {
  sid: string;
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
  displayName: string;
  product: 'premium' | 'free' | 'open' | 'unknown';
  isPremium: boolean;
  avatarUrl?: string;
}

interface PendingStateRecord {
  createdAtMs: number;
  redirectUri: string;
}

const SPOTIFY_COOKIE_NAME = 'tsm_spotify_sid';
const SPOTIFY_SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-modify-playback-state',
  'user-read-playback-state',
].join(' ');

const spotifySessions = new Map<string, SpotifySessionRecord>();
const pendingOAuthStates = new Map<string, PendingStateRecord>();

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

function getAppBaseUrl(req?: express.Request): string {
  const configured = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (configured && !configured.includes('templesolosmovies.com') && configured.startsWith('http')) {
    return configured;
  }
  if (req) {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
      .split(',')[0]
      .trim();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0]
      .trim();
    if (host) {
      return `${proto}://${host}`;
    }
  }
  return configured || 'http://localhost:3000';
}

function getSpotifyCallbackUrl(req?: express.Request): string {
  const envUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  // Use APP_URL when explicitly set to the runtime container origin, otherwise request origin fallback
  if (envUrl && envUrl.includes('.run.app')) {
    return `${envUrl}/auth/spotify/callback`;
  }
  return `${getAppBaseUrl(req)}/auth/spotify/callback`;
}

function getSpotifySessionFromReq(req: express.Request): SpotifySessionRecord | null {
  const cookies = parseCookies(req.headers.cookie);
  const headerSid = String(req.headers['x-spotify-session'] || '').trim();
  const sid = headerSid || cookies[SPOTIFY_COOKIE_NAME] || '';
  if (!sid) return null;
  return spotifySessions.get(sid) || null;
}

function cleanupExpiredStates() {
  const now = Date.now();
  for (const [state, record] of pendingOAuthStates.entries()) {
    if (now - record.createdAtMs > 10 * 60 * 1000) {
      pendingOAuthStates.delete(state);
    }
  }
}

async function ensureFreshSpotifyToken(session: SpotifySessionRecord): Promise<string | null> {
  if (Date.now() < session.expiresAtMs - 60_000) {
    return session.accessToken;
  }

  const clientId = (process.env.SPOTIFY_CLIENT_ID || '').trim();
  const clientSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret || !session.refreshToken) {
    return null;
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
    });
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const resp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!resp.ok) {
      return null;
    }
    const data = (await resp.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return null;
    session.accessToken = data.access_token;
    if (data.refresh_token) {
      session.refreshToken = data.refresh_token;
    }
    session.expiresAtMs = Date.now() + (data.expires_in || 3600) * 1000;
    return session.accessToken;
  } catch {
    return null;
  }
}

function buildBoomplaySearchUrl(artist: string, title: string): string {
  const q = `${artist} ${title}`.trim();
  return `https://www.boomplay.com/search/default/${encodeURIComponent(q)}`;
}

function buildSpotifySearchUrl(artist: string, title: string): string {
  const q = `${artist} ${title}`.trim();
  return `https://open.spotify.com/search/${encodeURIComponent(q)}`;
}

function combineMusicSearchTerm(query: string, genre: string): string {
  const cleanQuery = query.trim();
  const cleanGenre = genre.trim();
  if (!cleanGenre || cleanGenre.toLowerCase() === 'all') {
    return cleanQuery || 'Afrobeats Burna Boy Rema Tems Wizkid Asake';
  }
  if (!cleanQuery) {
    return cleanGenre;
  }
  if (cleanQuery.toLowerCase().includes(cleanGenre.toLowerCase())) {
    return cleanQuery;
  }
  return `${cleanQuery} ${cleanGenre}`.trim();
}

interface ItunesSearchResultItem {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
  primaryGenreName?: string;
}

const ITUNES_CACHE_TTL_MS = 10 * 60 * 1000;
const itunesSearchCache = new Map<string, { tracks: MusicTrack[]; expiresAtMs: number }>();
const inflightItunesRequests = new Map<string, Promise<MusicTrack[]>>();

async function fetchItunesPreviews(
  term: string,
  limit = 16,
  preferredGenre = ''
): Promise<MusicTrack[]> {
  const cleanTerm = term.trim() || 'Afrobeats Burna Boy Tems Wizkid';
  const cleanGenre = preferredGenre.trim();
  const genreTag = cleanGenre && cleanGenre.toLowerCase() !== 'all' ? cleanGenre : '';
  const clampedLimit = Math.min(25, Math.max(1, limit));
  const cacheKey = `${cleanTerm.toLowerCase()}::${clampedLimit}::${genreTag.toLowerCase()}`;
  const cached = itunesSearchCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now()) {
    return cached.tracks;
  }

  const inflight = inflightItunesRequests.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const runPromise = (async () => {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanTerm)}&media=music&entity=song&limit=${clampedLimit}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    let resp: Response;
    try {
      resp = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!resp.ok) {
      throw new Error(`iTunes Search API HTTP ${resp.status}`);
    }
    const json = (await resp.json()) as { results?: ItunesSearchResultItem[] };
    const rows = Array.isArray(json.results) ? json.results : [];

    const tracks: MusicTrack[] = rows
      .filter((item) => item.trackId && item.trackName && item.artistName)
      .map((item) => {
        const title = item.trackName || 'Untitled Track';
        const artist = item.artistName || 'Unknown Artist';
        const artworkUrl = (item.artworkUrl100 || '').replace('100x100bb', '300x300bb');
        const fullDurationSec = item.trackTimeMillis
          ? Math.max(30, Math.round(item.trackTimeMillis / 1000))
          : 180;

        return {
          id: `itunes-${item.trackId}`,
          title,
          artist,
          album: item.collectionName || 'Single',
          artworkUrl,
          previewUrl: item.previewUrl || null,
          previewDurationSec: 30,
          fullDurationSec,
          spotifyUrl: buildSpotifySearchUrl(artist, title),
          boomplayUrl: buildBoomplaySearchUrl(artist, title),
          genre: genreTag || item.primaryGenreName || 'Music',
          source: 'itunes-preview',
        };
      });

    if (itunesSearchCache.size >= 80) {
      const oldestKey = itunesSearchCache.keys().next().value;
      if (oldestKey) itunesSearchCache.delete(oldestKey);
    }
    itunesSearchCache.set(cacheKey, {
      tracks,
      expiresAtMs: Date.now() + ITUNES_CACHE_TTL_MS,
    });

    return tracks;
  })();

  inflightItunesRequests.set(cacheKey, runPromise);
  try {
    return await runPromise;
  } finally {
    inflightItunesRequests.delete(cacheKey);
  }
}

async function findItunesPreviewUrl(artist: string, title: string): Promise<string | null> {
  try {
    const items = await fetchItunesPreviews(`${artist} ${title}`, 3);
    return items.find((i) => Boolean(i.previewUrl))?.previewUrl || null;
  } catch {
    return null;
  }
}

interface SpotifyTrackApiItem {
  id: string;
  name: string;
  uri: string;
  duration_ms?: number;
  preview_url?: string | null;
  external_urls?: { spotify?: string };
  artists?: Array<{ name?: string }>;
  album?: {
    name?: string;
    images?: Array<{ url?: string }>;
  };
}

async function fetchSpotifyTracks(
  accessToken: string,
  query: string,
  limit = 14,
  preferredGenre = ''
): Promise<MusicTrack[]> {
  const cleanQuery = query.trim() || 'Afrobeats';
  const cleanGenre = preferredGenre.trim();
  const genreTag = cleanGenre && cleanGenre.toLowerCase() !== 'all' ? cleanGenre : 'Music';
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(cleanQuery)}&type=track&limit=${Math.min(20, Math.max(1, limit))}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`Spotify search HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as { tracks?: { items?: SpotifyTrackApiItem[] } };
  const items = data.tracks?.items || [];

  // Enrich missing Spotify 30s preview_url cleanly from official iTunes 30s preview API (no ripping)
  const mapped = await Promise.all(
    items.map(async (item): Promise<MusicTrack> => {
      const artist = item.artists?.map((a) => a.name).filter(Boolean).join(', ') || 'Unknown Artist';
      const title = item.name || 'Untitled';
      const previewUrl =
        item.preview_url || (await findItunesPreviewUrl(artist.split(',')[0], title));

      return {
        id: `spotify-${item.id}`,
        title,
        artist,
        album: item.album?.name || 'Single',
        artworkUrl: item.album?.images?.[0]?.url || '',
        previewUrl,
        previewDurationSec: 30,
        fullDurationSec: item.duration_ms ? Math.max(30, Math.round(item.duration_ms / 1000)) : 180,
        spotifyUrl: item.external_urls?.spotify || buildSpotifySearchUrl(artist, title),
        spotifyUri: item.uri,
        boomplayUrl: buildBoomplaySearchUrl(artist, title),
        genre: genreTag,
        source: 'spotify',
      };
    })
  );

  return mapped;
}

export function attachMusicRoutes(app: express.Express) {
  app.get('/api/spotify/status', (req, res) => {
    const clientId = (process.env.SPOTIFY_CLIENT_ID || '').trim();
    const clientSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();
    const configured = Boolean(clientId && clientSecret);
    const session = getSpotifySessionFromReq(req);
    const callbackUrl = getSpotifyCallbackUrl(req);

    const status: SpotifySessionStatus = session
      ? {
          configured,
          connected: true,
          isPremium: session.isPremium,
          product: session.product,
          displayName: session.displayName,
          avatarUrl: session.avatarUrl,
          callbackUrl,
        }
      : {
          configured,
          connected: false,
          isPremium: false,
          product: 'unknown',
          callbackUrl,
        };

    res.json(status);
  });

  app.get('/api/spotify/auth-url', (req, res) => {
    const clientId = (process.env.SPOTIFY_CLIENT_ID || '').trim();
    const clientSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();
    const redirectUri = getSpotifyCallbackUrl(req);

    if (!clientId || !clientSecret) {
      res.json({
        configured: false,
        url: null,
        callbackUrl: redirectUri,
        message:
          'Spotify OAuth is not configured on the server yet (SPOTIFY_CLIENT_ID & SPOTIFY_CLIENT_SECRET). Visitors can still play 30s previews or open tracks directly in Spotify / Boomplay.',
      });
      return;
    }

    cleanupExpiredStates();
    const state = crypto.randomBytes(18).toString('hex');
    pendingOAuthStates.set(state, { createdAtMs: Date.now(), redirectUri });

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SPOTIFY_SCOPES,
      state,
      show_dialog: 'true',
    });

    res.json({
      configured: true,
      url: `https://accounts.spotify.com/authorize?${params.toString()}`,
      callbackUrl: redirectUri,
    });
  });

  const handleSpotifyCallback = async (req: express.Request, res: express.Response) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const oauthErr = typeof req.query.error === 'string' ? req.query.error : '';

    if (oauthErr || !code || !state) {
      res.status(400).send(`
        <html><body style="background:#09090B;color:#FAFAFA;font-family:sans-serif;padding:24px;">
          <h2 style="color:#E5A93B;">Spotify sign-in cancelled</h2>
          <p>${oauthErr ? `Reason: ${oauthErr.replace(/[<>&"]/g, '')}` : 'Missing authorization code.'}</p>
          <script>setTimeout(() => window.close(), 1200);</script>
        </body></html>
      `);
      return;
    }

    const pendingState = pendingOAuthStates.get(state);
    pendingOAuthStates.delete(state);
    if (!pendingState) {
      res.status(400).send(`
        <html><body style="background:#09090B;color:#FAFAFA;font-family:sans-serif;padding:24px;">
          <h2 style="color:#E5A93B;">Session expired</h2>
          <p>Please close this window and try connecting Spotify again.</p>
          <script>setTimeout(() => window.close(), 1400);</script>
        </body></html>
      `);
      return;
    }

    const clientId = (process.env.SPOTIFY_CLIENT_ID || '').trim();
    const clientSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();
    if (!clientId || !clientSecret) {
      res.status(503).send('Spotify OAuth credentials are missing on the server.');
      return;
    }

    try {
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: pendingState.redirectUri,
      });
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenResp = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: tokenBody.toString(),
      });

      if (!tokenResp.ok) {
        const text = await tokenResp.text().catch(() => '');
        throw new Error(`Spotify token error (${tokenResp.status}): ${text.slice(0, 120)}`);
      }

      const tokens = (await tokenResp.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      const meResp = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!meResp.ok) {
        throw new Error(`Spotify profile lookup failed (${meResp.status})`);
      }

      const me = (await meResp.json()) as {
        display_name?: string;
        id?: string;
        product?: string;
        images?: Array<{ url?: string }>;
      };

      const productRaw = (me.product || 'free').toLowerCase();
      const product: SpotifySessionRecord['product'] =
        productRaw === 'premium'
          ? 'premium'
          : productRaw === 'free'
            ? 'free'
            : productRaw === 'open'
              ? 'open'
              : 'unknown';

      const sid = crypto.randomBytes(24).toString('hex');
      const sessionRecord: SpotifySessionRecord = {
        sid,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || '',
        expiresAtMs: Date.now() + (tokens.expires_in || 3600) * 1000,
        displayName: me.display_name || me.id || 'Spotify Listener',
        product,
        isPremium: product === 'premium',
        avatarUrl: me.images?.[0]?.url,
      };
      spotifySessions.set(sid, sessionRecord);

      res.cookie(SPOTIFY_COOKIE_NAME, sid, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      });

      const payloadJson = JSON.stringify({
        type: 'SPOTIFY_OAUTH_SUCCESS',
        spotifySid: sid,
        connected: true,
        isPremium: sessionRecord.isPremium,
        product: sessionRecord.product,
        displayName: sessionRecord.displayName,
        avatarUrl: sessionRecord.avatarUrl || '',
      });

      res.send(`<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Spotify Connected</title></head>
  <body style="background:#09090B;color:#FAFAFA;font-family:system-ui,sans-serif;padding:24px;text-align:center;">
    <p style="color:#E5A93B;font-weight:700;font-size:16px;">Spotify Connected</p>
    <p style="font-size:13px;color:#A1A1AA;">Returning to Temple Cinema...</p>
    <script>
      (function () {
        var payload = ${payloadJson};
        if (window.opener) {
          window.opener.postMessage(payload, '*');
          window.close();
        } else {
          window.location.href = '/';
        }
      })();
    </script>
  </body>
</html>`);
    } catch (err) {
      console.error('[Spotify OAuth Callback Error]', err);
      res.status(500).send(`
        <html><body style="background:#09090B;color:#FAFAFA;font-family:sans-serif;padding:24px;">
          <h2 style="color:#E5A93B;">Spotify Connection Error</h2>
          <p>Could not complete Spotify sign-in. Please close this window and retry.</p>
        </body></html>
      `);
    }
  };

  app.get(['/auth/spotify/callback', '/auth/spotify/callback/'], handleSpotifyCallback);

  app.get('/api/spotify/token', async (req, res) => {
    const session = getSpotifySessionFromReq(req);
    if (!session) {
      res.status(401).json({ error: 'Not signed in to Spotify.' });
      return;
    }
    const token = await ensureFreshSpotifyToken(session);
    if (!token) {
      res.status(401).json({ error: 'Spotify session expired. Please reconnect Spotify.' });
      return;
    }
    res.json({
      accessToken: token,
      isPremium: session.isPremium,
      product: session.product,
      displayName: session.displayName,
    });
  });

  app.post('/api/spotify/logout', (req, res) => {
    const session = getSpotifySessionFromReq(req);
    if (session) {
      spotifySessions.delete(session.sid);
    }
    res.clearCookie(SPOTIFY_COOKIE_NAME, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
    });
    res.json({ disconnected: true });
  });

  app.get('/api/music/tracks', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const genre = typeof req.query.genre === 'string' ? req.query.genre.trim() : '';
    const effectiveQuery = combineMusicSearchTerm(q, genre);
    const session = getSpotifySessionFromReq(req);

    if (session) {
      const token = await ensureFreshSpotifyToken(session);
      if (token) {
        try {
          const tracks = await fetchSpotifyTracks(token, effectiveQuery, 14, genre);
          res.json({ tracks, provider: 'spotify', genre: genre || 'All' });
          return;
        } catch (err) {
          console.warn('[Music Search] Falling back to iTunes legal previews:', err);
        }
      }
    }

    try {
      const tracks = await fetchItunesPreviews(effectiveQuery, 16, genre);
      res.setHeader('Cache-Control', 'public, max-age=180, stale-while-revalidate=600');
      res.json({ tracks, provider: 'itunes-preview', genre: genre || 'All' });
    } catch (err) {
      console.error('[Music Search] Preview lookup failed:', err);
      res.status(502).json({
        tracks: [],
        error: 'Could not reach legal music preview catalog right now.',
      });
    }
  });
}
