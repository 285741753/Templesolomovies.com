import type { Router } from 'express';
import express from 'express';
import type { MusicAlbum, MusicArtist, MusicSearchType, MusicTrack } from '../src/types/cinema.ts';

export interface MusicSearchPayload {
  provider: 'spotify' | 'deezer' | 'boomplay';
  query: string;
  type: MusicSearchType;
  tracks: MusicTrack[];
  artists: MusicArtist[];
  albums: MusicAlbum[];
  cached?: boolean;
}

export interface MusicShelf {
  id: string;
  title: string;
  subtitle: string;
  tracks: MusicTrack[];
  provider: string;
}

interface MusicProvider {
  id: 'spotify' | 'deezer' | 'boomplay';
  isEnabled(): boolean;
  search(query: string, type: MusicSearchType): Promise<MusicSearchPayload>;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 45;

const searchCache = new Map<string, { expiresAt: number; data: MusicSearchPayload }>();
let shelvesCache: { expiresAt: number; shelves: MusicShelf[] } | null = null;
const rateBuckets = new Map<string, { resetAt: number; count: number }>();

let spotifyTokenCache: { accessToken: string; expiresAt: number } | null = null;

function formatDurationSec(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function buildBoomplaySearchUrl(term: string): string {
  return `https://www.boomplay.com/search/default/${encodeURIComponent(term)}`;
}

function buildSpotifySearchUrl(term: string): string {
  return `https://open.spotify.com/search/${encodeURIComponent(term)}`;
}

async function fetchJsonWithTimeout<T>(url: string, init?: RequestInit, timeoutMs = 6500): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Primary Provider: Spotify Web API (Server-side Client Credentials Flow)    */
/* -------------------------------------------------------------------------- */
async function getSpotifyAppToken(): Promise<string | null> {
  const clientId = (process.env.SPOTIFY_CLIENT_ID || '').trim();
  const clientSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return null;

  if (spotifyTokenCache && Date.now() < spotifyTokenCache.expiresAt - 60_000) {
    return spotifyTokenCache.accessToken;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Spotify auth failed (HTTP ${res.status})`);
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    spotifyTokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    };
    return spotifyTokenCache.accessToken;
  } finally {
    clearTimeout(timer);
  }
}

const SpotifyProvider: MusicProvider = {
  id: 'spotify',
  isEnabled() {
    return Boolean(
      (process.env.SPOTIFY_CLIENT_ID || '').trim() &&
        (process.env.SPOTIFY_CLIENT_SECRET || '').trim()
    );
  },
  async search(query: string, type: MusicSearchType): Promise<MusicSearchPayload> {
    const token = await getSpotifyAppToken();
    if (!token) {
      throw new Error('Spotify credentials not configured');
    }

    interface SpotifyTrackItem {
      id: string;
      name: string;
      duration_ms: number;
      preview_url: string | null;
      uri?: string;
      external_urls?: { spotify?: string };
      artists?: Array<{ name: string }>;
      album?: { name?: string; images?: Array<{ url: string }> };
    }
    interface SpotifyArtistItem {
      id: string;
      name: string;
      genres?: string[];
      followers?: { total?: number };
      images?: Array<{ url: string }>;
      external_urls?: { spotify?: string };
    }
    interface SpotifyAlbumItem {
      id: string;
      name: string;
      release_date?: string;
      total_tracks?: number;
      artists?: Array<{ name: string }>;
      images?: Array<{ url: string }>;
      external_urls?: { spotify?: string };
    }

    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=${type}&limit=18&market=US`;
    const data = await fetchJsonWithTimeout<{
      tracks?: { items?: SpotifyTrackItem[] };
      artists?: { items?: SpotifyArtistItem[] };
      albums?: { items?: SpotifyAlbumItem[] };
    }>(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const tracks: MusicTrack[] = (data.tracks?.items || []).map((t) => {
      const artist = (t.artists || []).map((a) => a.name).join(', ') || 'Unknown Artist';
      const durationSec = Math.round((t.duration_ms || 0) / 1000);
      const spotifyUrl = t.external_urls?.spotify || buildSpotifySearchUrl(`${t.name} ${artist}`);
      return {
        id: `sp-${t.id}`,
        title: t.name,
        artist,
        album: t.album?.name || 'Single',
        durationSec,
        durationLabel: formatDurationSec(durationSec),
        coverUrl: t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || '/icons/icon-192.png',
        previewUrl: t.preview_url || null,
        externalUrl: spotifyUrl,
        spotifyUrl,
        boomplayUrl: buildBoomplaySearchUrl(`${t.name} ${artist}`),
        spotifyUri: t.uri,
        provider: 'spotify',
      };
    });

    const artists: MusicArtist[] = (data.artists?.items || []).map((a) => {
      const spotifyUrl = a.external_urls?.spotify || buildSpotifySearchUrl(a.name);
      return {
        id: `sp-art-${a.id}`,
        name: a.name,
        imageUrl: a.images?.[1]?.url || a.images?.[0]?.url || '/icons/icon-192.png',
        followers: a.followers?.total,
        genres: a.genres?.slice(0, 3),
        externalUrl: spotifyUrl,
        spotifyUrl,
        boomplayUrl: buildBoomplaySearchUrl(a.name),
        provider: 'spotify',
      };
    });

    const albums: MusicAlbum[] = (data.albums?.items || []).map((al) => {
      const artist = (al.artists || []).map((a) => a.name).join(', ') || 'Various Artists';
      const spotifyUrl = al.external_urls?.spotify || buildSpotifySearchUrl(`${al.name} ${artist}`);
      return {
        id: `sp-alb-${al.id}`,
        title: al.name,
        artist,
        coverUrl: al.images?.[1]?.url || al.images?.[0]?.url || '/icons/icon-192.png',
        releaseDate: al.release_date,
        totalTracks: al.total_tracks,
        externalUrl: spotifyUrl,
        spotifyUrl,
        boomplayUrl: buildBoomplaySearchUrl(`${al.name} ${artist}`),
        provider: 'spotify',
      };
    });

    return { provider: 'spotify', query, type, tracks, artists, albums };
  },
};

/* -------------------------------------------------------------------------- */
/* Fallback Provider: Deezer Public Search API (No login, 30s MP3 previews)   */
/* -------------------------------------------------------------------------- */
const DeezerProvider: MusicProvider = {
  id: 'deezer',
  isEnabled() {
    return true;
  },
  async search(query: string, type: MusicSearchType): Promise<MusicSearchPayload> {
    interface DeezerTrack {
      id: number;
      title: string;
      duration: number;
      preview: string;
      link: string;
      artist?: { name?: string };
      album?: { title?: string; cover_medium?: string; cover_big?: string };
    }
    interface DeezerArtist {
      id: number;
      name: string;
      link: string;
      nb_fan?: number;
      picture_medium?: string;
      picture_big?: string;
    }
    interface DeezerAlbum {
      id: number;
      title: string;
      link: string;
      nb_tracks?: number;
      cover_medium?: string;
      cover_big?: string;
      artist?: { name?: string };
    }

    const endpoint =
      type === 'artist'
        ? `https://api.deezer.com/search/artist?q=${encodeURIComponent(query)}&limit=18`
        : type === 'album'
          ? `https://api.deezer.com/search/album?q=${encodeURIComponent(query)}&limit=18`
          : `https://api.deezer.com/search/track?q=${encodeURIComponent(query)}&limit=18`;

    const data = await fetchJsonWithTimeout<{
      data?: Array<DeezerTrack & DeezerArtist & DeezerAlbum>;
      error?: { message?: string };
    }>(endpoint);

    if (data.error) {
      throw new Error(data.error.message || 'Deezer API error');
    }

    const items = Array.isArray(data.data) ? data.data : [];

    if (type === 'artist') {
      const artists: MusicArtist[] = items.map((a) => ({
        id: `dz-art-${a.id}`,
        name: a.name,
        imageUrl: a.picture_medium || a.picture_big || '/icons/icon-192.png',
        followers: a.nb_fan,
        externalUrl: a.link || buildSpotifySearchUrl(a.name),
        spotifyUrl: buildSpotifySearchUrl(a.name),
        boomplayUrl: buildBoomplaySearchUrl(a.name),
        provider: 'deezer',
      }));
      return { provider: 'deezer', query, type, tracks: [], artists, albums: [] };
    }

    if (type === 'album') {
      const albums: MusicAlbum[] = items.map((al) => {
        const artist = al.artist?.name || 'Various Artists';
        return {
          id: `dz-alb-${al.id}`,
          title: al.title,
          artist,
          coverUrl: al.cover_medium || al.cover_big || '/icons/icon-192.png',
          totalTracks: al.nb_tracks,
          externalUrl: al.link || buildSpotifySearchUrl(`${al.title} ${artist}`),
          spotifyUrl: buildSpotifySearchUrl(`${al.title} ${artist}`),
          boomplayUrl: buildBoomplaySearchUrl(`${al.title} ${artist}`),
          provider: 'deezer',
        };
      });
      return { provider: 'deezer', query, type, tracks: [], artists: [], albums };
    }

    const tracks: MusicTrack[] = items.map((t) => {
      const artist = t.artist?.name || 'Unknown Artist';
      const durationSec = Number(t.duration) || 30;
      return {
        id: `dz-${t.id}`,
        title: t.title,
        artist,
        album: t.album?.title || 'Single',
        durationSec,
        durationLabel: formatDurationSec(durationSec),
        coverUrl: t.album?.cover_medium || t.album?.cover_big || '/icons/icon-192.png',
        previewUrl: t.preview || null,
        externalUrl: t.link || buildSpotifySearchUrl(`${t.title} ${artist}`),
        spotifyUrl: buildSpotifySearchUrl(`${t.title} ${artist}`),
        boomplayUrl: buildBoomplaySearchUrl(`${t.title} ${artist}`),
        provider: 'deezer',
      };
    });

    return { provider: 'deezer', query, type, tracks, artists: [], albums: [] };
  },
};

/* -------------------------------------------------------------------------- */
/* Optional Provider (Disabled by Default): Licensed Boomplay Adapter         */
/* -------------------------------------------------------------------------- */
const BoomplayProvider: MusicProvider = {
  id: 'boomplay',
  isEnabled() {
    return (
      process.env.BOOMPLAY_ENABLED === 'true' &&
      Boolean((process.env.BOOMPLAY_API_KEY || '').trim()) &&
      Boolean((process.env.BOOMPLAY_API_URL || '').trim())
    );
  },
  async search(query: string, type: MusicSearchType): Promise<MusicSearchPayload> {
    const apiUrl = (process.env.BOOMPLAY_API_URL || '').trim().replace(/\/+$/, '');
    const apiKey = (process.env.BOOMPLAY_API_KEY || '').trim();
    if (!apiUrl || !apiKey) {
      throw new Error('Boomplay adapter not configured');
    }

    const resp = await fetchJsonWithTimeout<{
      tracks?: Array<{
        id: string;
        title: string;
        artist: string;
        album?: string;
        durationSec?: number;
        coverUrl?: string;
        previewUrl?: string | null;
        url?: string;
      }>;
    }>(`${apiUrl}/search?q=${encodeURIComponent(query)}&type=${type}`, {
      headers: {
        'x-api-key': apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const tracks: MusicTrack[] = (resp.tracks || []).map((t) => {
      const dur = Number(t.durationSec) || 30;
      const url = t.url || buildBoomplaySearchUrl(`${t.title} ${t.artist}`);
      return {
        id: `bp-${t.id}`,
        title: t.title,
        artist: t.artist || 'Boomplay Artist',
        album: t.album || 'Single',
        durationSec: dur,
        durationLabel: formatDurationSec(dur),
        coverUrl: t.coverUrl || '/icons/icon-192.png',
        previewUrl: t.previewUrl || null,
        externalUrl: url,
        spotifyUrl: buildSpotifySearchUrl(`${t.title} ${t.artist}`),
        boomplayUrl: url,
        provider: 'boomplay',
      };
    });

    return { provider: 'boomplay', query, type, tracks, artists: [], albums: [] };
  },
};

const PROVIDERS: MusicProvider[] = [SpotifyProvider, DeezerProvider, BoomplayProvider];

function hasResults(payload: MusicSearchPayload): boolean {
  return (
    payload.tracks.length > 0 || payload.artists.length > 0 || payload.albums.length > 0
  );
}

export async function searchWithFailover(
  rawQuery: string,
  type: MusicSearchType = 'track'
): Promise<MusicSearchPayload> {
  const query = rawQuery.trim().slice(0, 120);
  const cacheKey = `${type}:${query.toLowerCase()}`;
  const now = Date.now();
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return { ...cached.data, cached: true };
  }

  let lastError: Error | null = null;
  let spotifyFallbackCandidate: MusicSearchPayload | null = null;

  for (const provider of PROVIDERS) {
    if (!provider.isEnabled()) continue;
    try {
      const result = await provider.search(query, type);
      if (hasResults(result)) {
        // Spotify Client Credentials often omits 30s preview_url on many tracks;
        // if searching tracks and none have a playable preview, keep Spotify candidate and try Deezer too
        if (
          provider.id === 'spotify' &&
          type === 'track' &&
          result.tracks.every((t) => !t.previewUrl)
        ) {
          spotifyFallbackCandidate = result;
          continue;
        }
        searchCache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, data: result });
        return result;
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[Music] Provider ${provider.id} failed for "${query}":`, lastError.message);
    }
  }

  if (spotifyFallbackCandidate) {
    searchCache.set(cacheKey, {
      expiresAt: now + CACHE_TTL_MS,
      data: spotifyFallbackCandidate,
    });
    return spotifyFallbackCandidate;
  }

  throw lastError || new Error('All configured music providers failed');
}

const SHELF_SPECS: Array<{ id: string; title: string; subtitle: string; query: string }> = [
  {
    id: 'trending',
    title: 'Trending Now',
    subtitle: 'Most played global & West African hits',
    query: 'Burna Boy Wizkid Tems',
  },
  {
    id: 'afrobeats',
    title: 'Afrobeats Spotlight',
    subtitle: 'Lagos to London essential club & chart anthems',
    query: 'Afrobeats Rema Asake Davido',
  },
  {
    id: 'amapiano',
    title: 'Amapiano Wave',
    subtitle: 'Log-drum grooves & late-night Johannesburg sets',
    query: 'Amapiano Kabza Uncle Waffles Tyler ICU',
  },
  {
    id: 'nollywood-soundtracks',
    title: 'Nollywood & Cinema Soundtracks',
    subtitle: 'Iconic scores & emotional African film themes',
    query: 'Nollywood soundtrack Flavour Simi Johnny Drille',
  },
];

async function buildMusicShelves(): Promise<MusicShelf[]> {
  const now = Date.now();
  if (shelvesCache && shelvesCache.expiresAt > now) {
    return shelvesCache.shelves;
  }

  const shelves = await Promise.all(
    SHELF_SPECS.map(async (spec): Promise<MusicShelf> => {
      try {
        const res = await searchWithFailover(spec.query, 'track');
        return {
          id: spec.id,
          title: spec.title,
          subtitle: spec.subtitle,
          tracks: res.tracks.slice(0, 10),
          provider: res.provider,
        };
      } catch {
        return {
          id: spec.id,
          title: spec.title,
          subtitle: spec.subtitle,
          tracks: [],
          provider: 'unavailable',
        };
      }
    })
  );

  if (shelves.some((s) => s.tracks.length > 0)) {
    shelvesCache = { expiresAt: now + CACHE_TTL_MS, shelves };
  }
  return shelves;
}

function checkRateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip =
    (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
      : '') ||
    req.ip ||
    'local';
  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { resetAt: now + RATE_LIMIT_WINDOW_MS, count: 1 });
    next();
    return;
  }

  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(429).json({
      error: 'Too many music requests right now. Please wait a few seconds and retry.',
    });
    return;
  }

  next();
}

export function createMusicRouter(): Router {
  const router = express.Router();

  router.use(checkRateLimit);

  router.get('/status', (_req, res) => {
    res.json({
      providers: PROVIDERS.map((p) => ({
        id: p.id,
        enabled: p.isEnabled(),
      })),
      cacheTtlSeconds: CACHE_TTL_MS / 1000,
    });
  });

  router.get('/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const rawType = String(req.query.type || 'track').toLowerCase();
    const type: MusicSearchType =
      rawType === 'artist' || rawType === 'album' ? rawType : 'track';

    if (!q) {
      res.status(400).json({ error: 'Search query (q) is required.' });
      return;
    }

    try {
      const payload = await searchWithFailover(q, type);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json(payload);
    } catch (err) {
      console.error('[Music] Search failed:', err);
      res.status(503).json({
        error: 'Music search is unavailable right now',
      });
    }
  });

  router.get('/shelves', async (_req, res) => {
    try {
      const shelves = await buildMusicShelves();
      if (shelves.every((s) => s.tracks.length === 0)) {
        res.status(503).json({ error: 'Music search is unavailable right now' });
        return;
      }
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json({ shelves });
    } catch (err) {
      console.error('[Music] Shelves load failed:', err);
      res.status(503).json({ error: 'Music search is unavailable right now' });
    }
  });

  return router;
}
