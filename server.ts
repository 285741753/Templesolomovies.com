import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import zlib from 'zlib';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import { attachFootballServer } from './server/footballSocket.ts';
import { attachMusicRoutes } from './server/musicRoutes.ts';
import { GoogleGenAI, Modality, type LiveServerMessage } from '@google/genai';
import type {
  BrokenLinkReport,
  ChatMessage,
  ChatRoomId,
  ChessRoomMovePayload,
  ChessRoomState,
  ChessRoomSummary,
  ClientWsEvent,
  Movie,
  MovieGenre,
  MovieQuality,
  MovieRequestItem,
  OnlineUser,
  ServerWsEvent,
  UpcomingMovie,
  WatchPartyState,
} from './src/types/cinema.ts';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = process.cwd();
const STORAGE_DIR = path.join(ROOT_DIR, 'storage');
const MOVIES_DIR = path.join(STORAGE_DIR, 'movies');
const POSTERS_DIR = path.join(STORAGE_DIR, 'posters');
const CHUNKS_DIR = path.join(STORAGE_DIR, 'chunks');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DB_PATH = path.join(STORAGE_DIR, 'db.json');
const FIREBASE_CONFIG_PATH = path.join(ROOT_DIR, 'firebase-applet-config.json');

interface ReleaseSubscription {
  releaseId: string;
  email: string;
  userId?: string;
  createdAt: string;
}

interface StoredUpcomingMovie extends Omit<UpcomingMovie, 'subscriberCount'> {
  baseSubscribers: number;
}

interface DatabaseState {
  movies: Movie[];
  messages: ChatMessage[];
  upcomingMovies: StoredUpcomingMovie[];
  releaseSubscriptions: ReleaseSubscription[];
  movieRequests: MovieRequestItem[];
  brokenLinkReports: BrokenLinkReport[];
}

interface FirebaseAppletConfig {
  apiKey?: string;
  projectId?: string;
  authDomain?: string;
  firestoreDatabaseId?: string;
}

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'madubachigozie00@gmail.com').toLowerCase();

function getFirebaseConfig(): FirebaseAppletConfig {
  try {
    if (fs.existsSync(FIREBASE_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(FIREBASE_CONFIG_PATH, 'utf-8')) as FirebaseAppletConfig;
    }
  } catch {
    // Ignore config read errors
  }
  return {};
}

interface VerifiedFirebaseUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
  displayName?: string;
  idToken: string;
}

async function verifyFirebaseIdToken(
  authHeader: string | undefined
): Promise<VerifiedFirebaseUser | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) return null;

  const { apiKey } = getFirebaseConfig();
  if (!apiKey) return null;

  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.warn(`[Upload Auth] Firebase token verification failed (HTTP ${resp.status}): ${errText.slice(0, 180)}`);
      return null;
    }
    const data = (await resp.json()) as {
      users?: Array<{
        localId?: string;
        email?: string;
        emailVerified?: boolean;
        displayName?: string;
      }>;
    };
    const user = data.users?.[0];
    if (!user?.localId) return null;
    return {
      uid: user.localId,
      email: user.email,
      emailVerified: Boolean(user.emailVerified),
      displayName: user.displayName,
      idToken,
    };
  } catch (err) {
    console.error('[Upload Auth] Token verification network/parse error:', err);
    return null;
  }
}

async function isAdminUser(verifiedUser: VerifiedFirebaseUser | null): Promise<boolean> {
  if (!verifiedUser) return false;
  if (verifiedUser.emailVerified && verifiedUser.email?.toLowerCase() === ADMIN_EMAIL) {
    return true;
  }

  const { projectId, firestoreDatabaseId } = getFirebaseConfig();
  if (!projectId) return false;
  const dbId = firestoreDatabaseId || '(default)';

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(dbId)}/documents/admins/${encodeURIComponent(verifiedUser.uid)}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${verifiedUser.idToken}` },
    });
    return resp.ok;
  } catch (err) {
    console.warn('[Upload Auth] Admin lookup check failed:', err);
    return false;
  }
}

function ensureDirectories() {
  for (const dir of [STORAGE_DIR, MOVIES_DIR, POSTERS_DIR, CHUNKS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    try {
      fs.accessSync(dir, fs.constants.W_OK);
    } catch (err) {
      console.error(`[Storage Error] Upload directory is not writable: ${dir}`, err);
      throw new Error(`Upload directory is not writable: ${dir}`);
    }
  }
  console.log(`[Storage] Verified writable directories under ${STORAGE_DIR}`);
}

function loadDatabase(): DatabaseState {
  if (fs.existsSync(DB_PATH)) {
    try {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<DatabaseState>;
      return {
        movies: Array.isArray(parsed.movies) ? parsed.movies : [],
        messages: Array.isArray(parsed.messages)
          ? parsed.messages.map((m) => ({
              ...m,
              likedBy: Array.isArray(m.likedBy) ? m.likedBy : [],
            }))
          : [],
        upcomingMovies: Array.isArray(parsed.upcomingMovies) ? parsed.upcomingMovies : [],
        releaseSubscriptions: Array.isArray(parsed.releaseSubscriptions)
          ? parsed.releaseSubscriptions
          : [],
        movieRequests: Array.isArray(parsed.movieRequests) ? parsed.movieRequests : [],
        brokenLinkReports: Array.isArray(parsed.brokenLinkReports)
          ? parsed.brokenLinkReports
          : [],
      };
    } catch {
      // Fall back to fresh seed if JSON is corrupted
    }
  }
  return {
    movies: [],
    messages: [],
    upcomingMovies: [],
    releaseSubscriptions: [],
    movieRequests: [],
    brokenLinkReports: [],
  };
}

interface SerializedJsonCacheEntry {
  json: Buffer;
  gzip: Buffer;
  br: Buffer;
}

let cachedMoviesPayload: SerializedJsonCacheEntry | null = null;
let cachedUpcomingPayload: SerializedJsonCacheEntry | null = null;

function invalidateCatalogCache() {
  cachedMoviesPayload = null;
  cachedUpcomingPayload = null;
}

function buildSerializedJsonCache(payload: unknown): SerializedJsonCacheEntry {
  const json = Buffer.from(JSON.stringify(payload), 'utf-8');
  return {
    json,
    gzip: zlib.gzipSync(json, { level: 1 }),
    br: zlib.brotliCompressSync(json, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
    }),
  };
}

function sendCachedJsonEntry(
  req: express.Request,
  res: express.Response,
  entry: SerializedJsonCacheEntry
) {
  const accept = String(req.headers['accept-encoding'] || '');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Vary', 'Accept-Encoding');
  if (accept.includes('gzip')) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', String(entry.gzip.length));
    res.send(entry.gzip);
    return;
  }
  if (accept.includes('br')) {
    res.setHeader('Content-Encoding', 'br');
    res.setHeader('Content-Length', String(entry.br.length));
    res.send(entry.br);
    return;
  }
  res.setHeader('Content-Length', String(entry.json.length));
  res.send(entry.json);
}

function saveDatabase(state: DatabaseState) {
  invalidateCatalogCache();
  const tempPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tempPath, DB_PATH);
}

interface SeedMovieSpec {
  id: string;
  title: string;
  genre: MovieGenre;
  category?: Movie['category'];
  country?: string;
  year: number;
  duration: string;
  quality: MovieQuality;
  director: string;
  uploader: string;
  synopsis: string;
  imdbRating: number;
  sourcePosterFile: string;
  sourceBackdropFile?: string;
  posterTargetName: string;
  backdropTargetName?: string;
  trailerUrl?: string;
  videoFileName: string;
  downloads: number;
  featured: boolean;
  createdAt: string;
}

const SEED_SPECS: SeedMovieSpec[] = [
  {
    id: 'movie-obsidian-dawn',
    title: 'Obsidian Dawn',
    genre: 'Sci-Fi',
    year: 2024,
    duration: '2h 14m',
    quality: '4K UHD',
    director: 'Kofi Mensah',
    uploader: 'TempleSolo',
    synopsis:
      'In a fortified orbital metropolis under solar siege, an elite tactical vanguard descends to reclaim the last obsidian power spire before dawn.',
    imdbRating: 8.8,
    sourcePosterFile: 'poster_iron_horizon_1794734030987.jpg',
    sourceBackdropFile: 'hero_midnight_meridian_1794734028437.jpg',
    posterTargetName: 'obsidian_dawn_poster.jpg',
    backdropTargetName: 'obsidian_dawn_backdrop.jpg',
    videoFileName: 'obsidian-dawn-4k.mp4',
    downloads: 1842,
    featured: true,
    createdAt: '2026-11-16T02:00:00.000Z',
  },
  {
    id: 'movie-vengeance-protocol',
    title: 'Vengeance Protocol',
    genre: 'Action',
    year: 2025,
    duration: '2h 04m',
    quality: '4K UHD',
    director: 'Devon Kade',
    uploader: 'TempleSolo',
    synopsis:
      'After a black-ops extraction team is burned mid-mission, a lone operative activates a forgotten counter-strike dossier across three borders.',
    imdbRating: 8.1,
    sourcePosterFile: 'poster_iron_horizon_1794734030987.jpg',
    posterTargetName: 'iron_horizon_poster.jpg',
    videoFileName: 'vengeance-protocol-4k.mp4',
    downloads: 1320,
    featured: false,
    createdAt: '2026-11-15T19:00:00.000Z',
  },
  {
    id: 'movie-black-ops-iii',
    title: 'Black Ops III',
    genre: 'Action',
    year: 2025,
    duration: '2h 14m',
    quality: '4K UHD',
    director: 'Marcus Cole',
    uploader: 'TempleSolo',
    synopsis:
      'An armored strike squad infiltrates a subterranean rail fortress to disarm an autonomous satellite uplink before countdown zero.',
    imdbRating: 7.9,
    sourcePosterFile: 'upcoming_cinder_pass_1794747753251.jpg',
    posterTargetName: 'upcoming_cinder_pass.jpg',
    videoFileName: 'black-ops-iii-4k.mp4',
    downloads: 1185,
    featured: false,
    createdAt: '2026-11-15T18:00:00.000Z',
  },
  {
    id: 'movie-redemption-strike',
    title: 'Redemption Strike',
    genre: 'Action',
    year: 2025,
    duration: '1h 56m',
    quality: '1080p HD',
    director: 'Mateo Silva',
    uploader: 'TempleSolo',
    synopsis:
      'With sixty minutes before an offshore rig detonates, a disgraced tactician teams up with coastal defenders for one final assault.',
    imdbRating: 7.4,
    sourcePosterFile: 'upcoming_glass_monsoon_1794747751625.jpg',
    posterTargetName: 'upcoming_glass_monsoon.jpg',
    videoFileName: 'redemption-strike-1080p.mp4',
    downloads: 1044,
    featured: false,
    createdAt: '2026-11-15T17:00:00.000Z',
  },
  {
    id: 'movie-shadow-hunt',
    title: 'Shadow Hunt',
    genre: 'Action',
    year: 2025,
    duration: '2h 02m',
    quality: '4K UHD',
    director: 'Julian Vance',
    uploader: 'TempleSolo',
    synopsis:
      'Through rain-slicked harbor alleys, a relentless tracker hunts the phantom courier carrying encrypted syndicate keys.',
    imdbRating: 8.3,
    sourcePosterFile: 'hero_midnight_meridian_1794734028437.jpg',
    posterTargetName: 'midnight_meridian_poster.jpg',
    videoFileName: 'shadow-hunt-4k.mp4',
    downloads: 992,
    featured: false,
    createdAt: '2026-11-15T16:00:00.000Z',
  },
  {
    id: 'movie-lagos-bloodline',
    title: 'Lagos Bloodline',
    genre: 'Nollywood',
    year: 2026,
    duration: '2h 18m',
    quality: '4K UHD',
    director: 'Tunde Adeyemi',
    uploader: 'TempleSolo',
    synopsis:
      'When a coastal shipping empire faces a hostile takeover on Victoria Island, a fearless matriarch fights to safeguard her family legacy.',
    imdbRating: 8.6,
    sourcePosterFile: 'poster_velvet_echo_1794734030259.jpg',
    posterTargetName: 'velvet_echo_poster.jpg',
    videoFileName: 'lagos-bloodline-4k.mp4',
    downloads: 1480,
    featured: false,
    createdAt: '2026-11-15T15:00:00.000Z',
  },
  {
    id: 'movie-chiefs-oath',
    title: "The Chief's Oath",
    genre: 'Nollywood',
    year: 2026,
    duration: '2h 08m',
    quality: '4K UHD',
    director: 'Amara Okafor',
    uploader: 'TempleSolo',
    synopsis:
      'Bound by an ancient royal vow, a young heir returns from abroad to confront palace intrigue and unite two rival provinces.',
    imdbRating: 8.4,
    sourcePosterFile: 'poster_golden_harbor_1794734029335.jpg',
    posterTargetName: 'golden_harbor_poster.jpg',
    videoFileName: 'the-chiefs-oath-4k.mp4',
    downloads: 1295,
    featured: false,
    createdAt: '2026-11-15T14:00:00.000Z',
  },
  {
    id: 'movie-money-and-blood',
    title: 'Money & Blood',
    genre: 'Nollywood',
    year: 2025,
    duration: '1h 59m',
    quality: '1080p HD',
    director: 'Chidi Nwosu',
    uploader: 'TempleSolo',
    synopsis:
      'Two childhood friends turned high-stakes Lagos financiers find their brotherhood tested when a billion-naira ledger vanishes overnight.',
    imdbRating: 7.7,
    sourcePosterFile: 'upcoming_copper_symphony_1794747752684.jpg',
    posterTargetName: 'upcoming_copper_symphony.jpg',
    videoFileName: 'money-and-blood-1080p.mp4',
    downloads: 1170,
    featured: false,
    createdAt: '2026-11-15T13:00:00.000Z',
  },
  {
    id: 'movie-asahi-the-heir',
    title: 'Asahi: The Heir',
    genre: 'Nollywood',
    year: 2026,
    duration: '2h 11m',
    quality: '4K UHD',
    director: 'Ngozi Eze',
    uploader: 'TempleSolo',
    synopsis:
      'Returning home after years in exile, Asahi must outmaneuver treacherous councilmen to claim his rightful throne.',
    imdbRating: 8.2,
    sourcePosterFile: 'poster_golden_harbor_1794734029335.jpg',
    posterTargetName: 'golden_harbor_poster.jpg',
    videoFileName: 'asahi-the-heir-4k.mp4',
    downloads: 1085,
    featured: false,
    createdAt: '2026-11-15T12:00:00.000Z',
  },
  {
    id: 'movie-neon-voyager',
    title: 'Neon Voyager',
    genre: 'Sci-Fi',
    year: 2026,
    duration: '2h 20m',
    quality: '4K UHD',
    director: 'Elena Rostova',
    uploader: 'TempleSolo',
    synopsis:
      'Piloting an experimental light-sail cruiser past Jupiter, a navigator decodes an interstellar beacon pulsing inside a cosmic dust storm.',
    imdbRating: 8.9,
    sourcePosterFile: 'poster_orbital_drift_1794734028947.jpg',
    posterTargetName: 'orbital_drift_poster.jpg',
    videoFileName: 'neon-voyager-4k.mp4',
    downloads: 1365,
    featured: false,
    createdAt: '2026-11-15T11:00:00.000Z',
  },
  {
    id: 'movie-project-nebula',
    title: 'Project Nebula',
    genre: 'Sci-Fi',
    year: 2025,
    duration: '2h 15m',
    quality: '4K UHD',
    director: 'Henrik Lindqvist',
    uploader: 'TempleSolo',
    synopsis:
      'When deep-space observatory sensors capture an artificial horizon anomaly, two astrophysicists launch a daring rescue flight.',
    imdbRating: 8.0,
    sourcePosterFile: 'upcoming_solstice_station_1794747751566.jpg',
    posterTargetName: 'upcoming_solstice_station.jpg',
    videoFileName: 'project-nebula-4k.mp4',
    downloads: 1210,
    featured: false,
    createdAt: '2026-11-15T10:00:00.000Z',
  },
  {
    id: 'movie-stasis-loop',
    title: 'Stasis Loop',
    genre: 'Sci-Fi',
    year: 2025,
    duration: '1h 54m',
    quality: '1080p HD',
    director: 'Clara Moreau',
    uploader: 'TempleSolo',
    synopsis:
      'Trapped inside a recurring twelve-hour cryo-hibernation cycle, an engineer leaves tactical clues for her own future self.',
    imdbRating: 7.3,
    sourcePosterFile: 'poster_orbital_drift_1794734028947.jpg',
    posterTargetName: 'orbital_drift_poster.jpg',
    videoFileName: 'stasis-loop-1080p.mp4',
    downloads: 940,
    featured: false,
    createdAt: '2026-11-15T09:00:00.000Z',
  },
  {
    id: 'movie-void-protocol',
    title: 'Void Protocol',
    genre: 'Sci-Fi',
    year: 2026,
    duration: '2h 06m',
    quality: '4K UHD',
    director: 'Soren Patel',
    uploader: 'TempleSolo',
    synopsis:
      'At the edge of an uncharted wormhole relay, a tactical commander enforces the final quarantine protocol.',
    imdbRating: 7.6,
    sourcePosterFile: 'upcoming_solstice_station_1794747751566.jpg',
    posterTargetName: 'upcoming_solstice_station.jpg',
    videoFileName: 'void-protocol-4k.mp4',
    downloads: 880,
    featured: false,
    createdAt: '2026-11-15T08:00:00.000Z',
  },
  {
    id: 'movie-midnight-meridian',
    title: 'The Midnight Meridian',
    genre: 'Thriller',
    year: 2026,
    duration: '2h 14m',
    quality: '4K UHD',
    director: 'Julian Vance',
    uploader: 'TempleSolo',
    synopsis:
      'A nocturnal transit investigator uncovers a city-wide ledger of erased departures along the harbor bridge, racing the dawn tide before the archive goes dark.',
    imdbRating: 9.1,
    sourcePosterFile: 'hero_midnight_meridian_1794734028437.jpg',
    sourceBackdropFile: 'hero_midnight_meridian_1794734028437.jpg',
    posterTargetName: 'midnight_meridian_poster.jpg',
    backdropTargetName: 'midnight_meridian_backdrop.jpg',
    videoFileName: 'the-midnight-meridian-4k.mp4',
    downloads: 1428,
    featured: false,
    createdAt: '2026-11-10T18:00:00.000Z',
  },
  {
    id: 'movie-golden-harbor',
    title: 'Golden Harbor',
    genre: 'Drama',
    year: 2025,
    duration: '1h 58m',
    quality: '1080p HD',
    director: 'Marcus Chen',
    uploader: 'TempleSolo',
    synopsis:
      'Over a single fog-bound weekend on Pier 19, a retired dockmaster confronts the shipping syndicate that built his town and nearly sank his family.',
    imdbRating: 8.5,
    sourcePosterFile: 'poster_golden_harbor_1794734029335.jpg',
    posterTargetName: 'golden_harbor_poster.jpg',
    videoFileName: 'golden-harbor-1080p.mp4',
    downloads: 876,
    featured: false,
    createdAt: '2026-11-12T09:15:00.000Z',
  },
  {
    id: 'movie-velvet-echo',
    title: 'Velvet Echo',
    genre: 'Mystery',
    year: 2026,
    duration: '1h 49m',
    quality: '1080p HD',
    director: 'Clara Moreau',
    uploader: 'TempleSolo',
    synopsis:
      'When an abandoned 1930s opera house opens for one unannounced rehearsal, a sound archivist discovers that the stage acoustics preserve conversations decades after they were spoken.',
    imdbRating: 7.8,
    sourcePosterFile: 'poster_velvet_echo_1794734030259.jpg',
    posterTargetName: 'velvet_echo_poster.jpg',
    videoFileName: 'velvet-echo-1080p.mp4',
    downloads: 742,
    featured: false,
    createdAt: '2026-11-13T16:45:00.000Z',
  },
  {
    id: 'movie-lagos-symphony-live',
    title: 'Lagos Symphony: Live Sessions',
    genre: 'Music',
    category: 'Music',
    country: 'Nigeria',
    year: 2026,
    duration: '1h 32m',
    quality: '4K UHD',
    director: 'Amara Okafor',
    uploader: 'TempleSolo',
    synopsis:
      'Recorded live inside a candlelit concert hall, an acoustic collective blends orchestral brass, talking drums, and soaring vocal arrangements.',
    imdbRating: 8.6,
    sourcePosterFile: 'upcoming_copper_symphony_1794747752684.jpg',
    posterTargetName: 'upcoming_copper_symphony.jpg',
    videoFileName: 'lagos-symphony-live-4k.mp4',
    downloads: 915,
    featured: false,
    createdAt: '2026-11-15T12:30:00.000Z',
  },
];

interface SeedUpcomingSpec {
  id: string;
  title: string;
  genre: MovieGenre;
  releaseDate: string;
  duration: string;
  quality: MovieQuality;
  director: string;
  synopsis: string;
  sourcePosterFile: string;
  posterTargetName: string;
  baseSubscribers: number;
  createdAt: string;
}

const SEED_UPCOMING_SPECS: SeedUpcomingSpec[] = [
  {
    id: 'upcoming-glass-monsoon',
    title: 'The Glass Monsoon',
    genre: 'Thriller',
    releaseDate: '2026-11-24',
    duration: '2h 09m',
    quality: '4K UHD',
    director: 'Nadia Thorne',
    synopsis:
      'During a five-day coastal blackout, a harbor customs archivist traces a vanished freight manifest across rain-flooded granite bridges.',
    sourcePosterFile: 'upcoming_glass_monsoon_1794747751625.jpg',
    posterTargetName: 'upcoming_glass_monsoon.jpg',
    baseSubscribers: 42,
    createdAt: '2026-11-15T04:00:00.000Z',
  },
  {
    id: 'upcoming-solstice-station',
    title: 'Solstice Station',
    genre: 'Sci-Fi',
    releaseDate: '2026-12-03',
    duration: '2h 22m',
    quality: '4K UHD',
    director: 'Henrik Lindqvist',
    synopsis:
      'A solo botanist aboard a ringed-planet conservatory receives a delayed acoustic signal from an expedition presumed lost for twenty years.',
    sourcePosterFile: 'upcoming_solstice_station_1794747751566.jpg',
    posterTargetName: 'upcoming_solstice_station.jpg',
    baseSubscribers: 68,
    createdAt: '2026-11-15T04:10:00.000Z',
  },
  {
    id: 'upcoming-copper-symphony',
    title: 'The Copper Symphony',
    genre: 'Documentary',
    releaseDate: '2026-12-12',
    duration: '1h 44m',
    quality: '1080p HD',
    director: 'Amara Okafor',
    synopsis:
      'Inside a century-old municipal concert hall slated for restoration, brass luthiers and archivists race to record every surviving acoustic echo.',
    sourcePosterFile: 'upcoming_copper_symphony_1794747752684.jpg',
    posterTargetName: 'upcoming_copper_symphony.jpg',
    baseSubscribers: 31,
    createdAt: '2026-11-15T04:20:00.000Z',
  },
  {
    id: 'upcoming-cinder-pass',
    title: 'Cinder Pass',
    genre: 'Action',
    releaseDate: '2026-12-20',
    duration: '2h 04m',
    quality: '4K UHD',
    director: 'Mateo Silva',
    synopsis:
      'A high-altitude telegraph courier guides a stranded survey crew through narrow basalt canyon switchbacks before winter snow seals the ridge.',
    sourcePosterFile: 'upcoming_cinder_pass_1794747753251.jpg',
    posterTargetName: 'upcoming_cinder_pass.jpg',
    baseSubscribers: 55,
    createdAt: '2026-11-15T04:30:00.000Z',
  },
];

async function generateMp4FromPoster(posterPath: string, outputVideoPath: string): Promise<void> {
  if (fs.existsSync(outputVideoPath) && fs.statSync(outputVideoPath).size > 4096) {
    return;
  }
  const tmpOut = `${outputVideoPath}.tmp.mp4`;
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-loop',
      '1',
      '-i',
      posterPath,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-t',
      '3',
      '-vf',
      'scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2:color=#09090b',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '64k',
      '-shortest',
      '-movflags',
      '+faststart',
      tmpOut,
    ]);
    fs.renameSync(tmpOut, outputVideoPath);
  } catch (err) {
    console.warn(`Could not run ffmpeg for ${outputVideoPath}:`, err);
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  }
}

function seedMetadataFast(db: DatabaseState): DatabaseState {
  const generatedImagesDir = path.join(ROOT_DIR, 'src', 'assets', 'images');

  const shouldBackfillShowcase =
    db.movies.length === 0 ||
    (!db.movies.some((m) => m.genre === 'Nollywood') &&
      db.movies.every((m) => m.isSeeded)) ||
    (!db.movies.some((m) => m.genre === 'Music' || m.category === 'Music') &&
      db.movies.every((m) => m.isSeeded));

  if (shouldBackfillShowcase) {
    if (db.movies.length > 0) {
      for (const m of db.movies) {
        if (m.id === 'movie-midnight-meridian') {
          m.featured = false;
        }
      }
    }
    for (const spec of SEED_SPECS) {
      const srcPoster = path.join(generatedImagesDir, spec.sourcePosterFile);
      const destPoster = path.join(POSTERS_DIR, spec.posterTargetName);
      if (fs.existsSync(srcPoster) && !fs.existsSync(destPoster)) {
        fs.copyFileSync(srcPoster, destPoster);
      }

      let backdropUrl: string | undefined;
      if (spec.sourceBackdropFile && spec.backdropTargetName) {
        const srcBackdrop = path.join(generatedImagesDir, spec.sourceBackdropFile);
        const destBackdrop = path.join(POSTERS_DIR, spec.backdropTargetName);
        if (fs.existsSync(srcBackdrop) && !fs.existsSync(destBackdrop)) {
          fs.copyFileSync(srcBackdrop, destBackdrop);
        }
        backdropUrl = `/storage/posters/${spec.backdropTargetName}`;
      }

      if (db.movies.some((m) => m.id === spec.id)) continue;

      const videoPath = path.join(MOVIES_DIR, spec.videoFileName);
      const fileSizeBytes = fs.existsSync(videoPath) ? fs.statSync(videoPath).size : 524323;

      db.movies.push({
        id: spec.id,
        title: spec.title,
        genre: spec.genre,
        ...(spec.category ? { category: spec.category } : {}),
        ...(spec.country ? { country: spec.country } : {}),
        year: spec.year,
        duration: spec.duration,
        quality: spec.quality,
        director: spec.director,
        uploader: spec.uploader,
        synopsis: spec.synopsis,
        imdbRating: spec.imdbRating,
        posterUrl: `/storage/posters/${spec.posterTargetName}`,
        backdropUrl,
        ...(spec.trailerUrl ? { trailerUrl: spec.trailerUrl } : {}),
        videoUrl: `/storage/movies/${spec.videoFileName}`,
        fileName: spec.videoFileName,
        fileSizeBytes,
        mimeType: 'video/mp4',
        downloads: spec.downloads,
        featured: spec.featured,
        isSeeded: true,
        createdAt: spec.createdAt,
      });
    }
  }

  const LEGACY_IMDB_RATINGS: Record<string, number> = {
    'movie-orbital-drift': 8.7,
    'movie-iron-horizon': 8.4,
  };

  for (const spec of SEED_SPECS) {
    const existing = db.movies.find((m) => m.id === spec.id);
    if (existing && typeof existing.imdbRating !== 'number') {
      existing.imdbRating = spec.imdbRating;
    }
  }

  for (const movie of db.movies) {
    if (typeof movie.imdbRating !== 'number') {
      movie.imdbRating = LEGACY_IMDB_RATINGS[movie.id] ?? 7.8;
    }
  }

  if (db.messages.length === 0) {
    db.messages.push(
      {
        id: 'seed-msg-1',
        room: 'general',
        userId: 'system-host',
        username: 'TempleSolo',
        text: 'Welcome to templesolosmovies.com! Sign up or log in to manage your uploads, save movies to your watchlist, and chat with everyone live.',
        timestamp: '2026-11-15T08:00:00.000Z',
        isSystem: true,
      },
      {
        id: 'seed-msg-2',
        room: 'requests',
        userId: 'system-host',
        username: 'TempleSolo',
        text: 'Drop your movie requests in this channel so uploaders know what titles to add next.',
        timestamp: '2026-11-15T08:01:00.000Z',
        isSystem: true,
      },
      {
        id: 'seed-msg-3',
        room: 'drops',
        userId: 'system-host',
        username: 'TempleSolo',
        text: 'Every newly uploaded movie is announced automatically in this channel with a quick download card.',
        timestamp: '2026-11-15T08:02:00.000Z',
        isSystem: true,
      }
    );
  }

  if (db.upcomingMovies.length === 0) {
    for (const spec of SEED_UPCOMING_SPECS) {
      const srcPoster = path.join(generatedImagesDir, spec.sourcePosterFile);
      const destPoster = path.join(POSTERS_DIR, spec.posterTargetName);
      if (fs.existsSync(srcPoster) && !fs.existsSync(destPoster)) {
        fs.copyFileSync(srcPoster, destPoster);
      }

      db.upcomingMovies.push({
        id: spec.id,
        title: spec.title,
        genre: spec.genre,
        releaseDate: spec.releaseDate,
        duration: spec.duration,
        quality: spec.quality,
        director: spec.director,
        synopsis: spec.synopsis,
        posterUrl: `/storage/posters/${spec.posterTargetName}`,
        baseSubscribers: spec.baseSubscribers,
        createdAt: spec.createdAt,
      });
    }
  } else {
    // Ensure poster files exist if upcoming items were already saved
    for (const spec of SEED_UPCOMING_SPECS) {
      const srcPoster = path.join(generatedImagesDir, spec.sourcePosterFile);
      const destPoster = path.join(POSTERS_DIR, spec.posterTargetName);
      if (fs.existsSync(srcPoster) && !fs.existsSync(destPoster)) {
        fs.copyFileSync(srcPoster, destPoster);
      }
    }
  }

  saveDatabase(db);
  return db;
}

async function seedStarterVideosInBackground(db: DatabaseState) {
  for (const spec of SEED_SPECS) {
    const posterPath = path.join(POSTERS_DIR, spec.posterTargetName);
    const videoPath = path.join(MOVIES_DIR, spec.videoFileName);
    if (fs.existsSync(posterPath)) {
      await generateMp4FromPoster(posterPath, videoPath);
      if (fs.existsSync(videoPath)) {
        const size = fs.statSync(videoPath).size;
        const movie = db.movies.find((m) => m.id === spec.id);
        if (movie && size > 0 && movie.fileSizeBytes !== size) {
          movie.fileSizeBytes = size;
          saveDatabase(db);
        }
      }
    }
  }
}

const VALID_GENRES: MovieGenre[] = [
  'Action',
  'Nollywood',
  'Sci-Fi',
  'Music',
  'Thriller',
  'Drama',
  'Mystery',
  'Comedy',
  'Documentary',
  'Animation',
  'Horror',
];

const VALID_QUALITIES: MovieQuality[] = ['4K UHD', '1080p HD', '720p HD'];

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function compressPosterImage(inputPath: string, maxWidth = 540): Promise<string> {
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const outPath = path.join(dir, `${base}-opt.jpg`);
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-vf',
      `scale='min(${maxWidth},iw)':-2`,
      '-q:v',
      '5',
      outPath,
    ]);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      if (outPath !== inputPath && fs.existsSync(inputPath)) {
        fs.unlinkSync(inputPath);
      }
      return outPath;
    }
  } catch {
    if (fs.existsSync(outPath)) {
      fs.unlinkSync(outPath);
    }
  }
  return inputPath;
}

async function startServer() {
  ensureDirectories();
  const db = seedMetadataFast(loadDatabase());

  const app = express();

  // CORS + preflight headers so cross-origin frontend deploys can authenticate and upload cleanly
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, Range, X-Unique-Upload-Id, X-Spotify-Session'
    );
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, X-Download-Quality');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Compress GET JSON responses quickly without blocking the Node event loop
  app.use((req, res, next) => {
    if (req.method !== 'GET') {
      next();
      return;
    }
    const origJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      const jsonStr = JSON.stringify(body);
      const accept = String(req.headers['accept-encoding'] || '');
      if (typeof jsonStr === 'string' && jsonStr.length > 1024 && !res.headersSent) {
        if (accept.includes('gzip')) {
          const compressed = zlib.gzipSync(jsonStr, { level: 1 });
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Vary', 'Accept-Encoding');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Content-Length', String(compressed.length));
          return res.send(compressed);
        }
        if (accept.includes('br')) {
          const compressed = zlib.brotliCompressSync(jsonStr, {
            params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
          });
          res.setHeader('Content-Encoding', 'br');
          res.setHeader('Vary', 'Accept-Encoding');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Content-Length', String(compressed.length));
          return res.send(compressed);
        }
      }
      return origJson(body);
    }) as typeof res.json;
    next();
  });

  // Serve public assets (favicon / app icon) and uploaded/seeded media with browser caching
  const DOWNLOADS_DIRS = [path.join(PUBLIC_DIR, 'downloads'), path.join(STORAGE_DIR, 'downloads')];
  app.get('/downloads/:filename', (req, res, next) => {
    const safeName = path.basename(req.params.filename || '');
    if (!safeName) {
      next();
      return;
    }
    for (const dir of DOWNLOADS_DIRS) {
      const filePath = path.join(dir, safeName);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        if (safeName.toLowerCase().endsWith('.apk')) {
          res.setHeader('Content-Type', 'application/vnd.android.package-archive');
          res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
          res.setHeader('Cache-Control', 'public, max-age=3600');
        }
        res.sendFile(filePath);
        return;
      }
    }
    if (safeName.toLowerCase().endsWith('.apk')) {
      res.status(404).json({ error: 'Android APK package is not uploaded yet.' });
      return;
    }
    next();
  });

  if (fs.existsSync(PUBLIC_DIR)) {
    app.use(express.static(PUBLIC_DIR, { maxAge: '1d', etag: true, lastModified: true }));
  }
  app.use('/storage/posters', express.static(POSTERS_DIR, { maxAge: '7d', etag: true, lastModified: true }));
  app.use('/storage/movies', express.static(MOVIES_DIR, { maxAge: '1d', etag: true, lastModified: true }));

  const server = http.createServer(app);
  // Prevent socket/request timeouts & proxy 502 races during large 2 GB movie uploads
  server.requestTimeout = 0;
  server.headersTimeout = 120_000;
  server.keepAliveTimeout = 65_000;
  const wss = new WebSocketServer({ noServer: true });
  const liveWss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    try {
      const pathname = new URL(req.url || '/', 'http://localhost').pathname;
      if (pathname === '/ws') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      } else if (pathname === '/ws/live') {
        liveWss.handleUpgrade(req, socket, head, (ws) => {
          liveWss.emit('connection', ws, req);
        });
      }
    } catch {
      socket.destroy();
    }
  });

  attachFootballServer(app, server, STORAGE_DIR);
  attachMusicRoutes(app);

  interface ConnectedClient {
    ws: WebSocket;
    userId: string;
    username: string;
    room: ChatRoomId;
    partyCode?: string;
    chessRoomCode?: string;
  }

  const clients = new Map<WebSocket, ConnectedClient>();
  const watchParties = new Map<string, WatchPartyState>();
  const chessRooms = new Map<string, ChessRoomState>();

  function sendToParty(roomCode: string, event: ServerWsEvent) {
    const payload = JSON.stringify(event);
    for (const [socket, client] of clients.entries()) {
      if (client.partyCode === roomCode && socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
  }

  function removeClientFromParty(client: ConnectedClient, targetCode?: string) {
    const code = targetCode || client.partyCode;
    if (!code) return;
    const party = watchParties.get(code);
    if (client.partyCode === code) {
      client.partyCode = undefined;
    }
    if (!party) return;

    party.participants = party.participants.filter((p) => p.userId !== client.userId);
    if (party.participants.length === 0) {
      watchParties.delete(code);
      return;
    }

    if (party.hostUserId === client.userId) {
      party.hostUserId = party.participants[0].userId;
      party.hostName = party.participants[0].username;
    }
    sendToParty(code, { type: 'party:state', party });
  }

  function getPublicChessRooms(): ChessRoomSummary[] {
    const list: ChessRoomSummary[] = [];
    for (const room of chessRooms.values()) {
      if (room.players.length > 0 && room.players.length < 2 && room.status === 'waiting') {
        list.push({
          roomCode: room.roomCode,
          hostName: room.hostName,
          playersCount: room.players.length,
          status: room.status,
          createdAt: room.updatedAt,
        });
      }
    }
    return list.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
  }

  function broadcastChessRooms() {
    broadcast({ type: 'chess:rooms', rooms: getPublicChessRooms() });
  }

  function sendToChessRoom(roomCode: string, event: ServerWsEvent) {
    const payload = JSON.stringify(event);
    for (const [socket, client] of clients.entries()) {
      if (client.chessRoomCode === roomCode && socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
  }

  function removeClientFromChessRoom(client: ConnectedClient, targetCode?: string) {
    const code = targetCode || client.chessRoomCode;
    if (!code) return;
    const room = chessRooms.get(code);
    if (client.chessRoomCode === code) {
      client.chessRoomCode = undefined;
    }
    if (!room) return;

    const leaving = room.players.find((p) => p.userId === client.userId);
    room.players = room.players.filter((p) => p.userId !== client.userId);

    if (room.players.length === 0) {
      chessRooms.delete(code);
      broadcastChessRooms();
      return;
    }

    if (room.status === 'playing' && leaving) {
      room.status = 'finished';
      room.resignedBy = leaving.color;
      room.winner = leaving.color === 'w' ? 'b' : 'w';
    } else if (room.status !== 'playing') {
      room.status = 'waiting';
    }

    if (room.hostUserId === client.userId) {
      room.hostUserId = room.players[0].userId;
      room.hostName = room.players[0].username;
    }
    room.updatedAt = Date.now();
    sendToChessRoom(code, { type: 'chess:state', room });
    broadcastChessRooms();
  }

  function getOnlineUsers(): OnlineUser[] {
    const dedup = new Map<string, OnlineUser>();
    for (const c of clients.values()) {
      if (c.userId) {
        dedup.set(c.userId, {
          userId: c.userId,
          username: c.username,
          room: c.room,
        });
      }
    }
    return Array.from(dedup.values());
  }

  function broadcast(event: ServerWsEvent) {
    const payload = JSON.stringify(event);
    for (const [socket] of clients.entries()) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
  }

  wss.on('connection', (ws) => {
    clients.set(ws, {
      ws,
      userId: '',
      username: 'Guest',
      room: 'general',
    });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString()) as ClientWsEvent;
        const client = clients.get(ws);
        if (!client) return;

        if (data.type === 'user:join') {
          client.userId = String(data.userId || randomUUID()).slice(0, 64);
          client.username = String(data.username || 'MovieFan').trim().slice(0, 32) || 'MovieFan';
          client.room = data.room || 'general';

          const initPayload: ServerWsEvent = {
            type: 'ws:init',
            movies: db.movies,
            messages: db.messages.slice(-200),
            onlineUsers: getOnlineUsers(),
          };
          ws.send(JSON.stringify(initPayload));
          ws.send(JSON.stringify({ type: 'chess:rooms', rooms: getPublicChessRooms() }));
          broadcast({ type: 'presence:update', onlineUsers: getOnlineUsers() });
        } else if (data.type === 'user:rename') {
          const nextName = String(data.username || '').trim().slice(0, 32);
          if (nextName) {
            client.username = nextName;
            broadcast({ type: 'presence:update', onlineUsers: getOnlineUsers() });
            if (client.partyCode) {
              const party = watchParties.get(client.partyCode);
              if (party) {
                party.participants = party.participants.map((p) =>
                  p.userId === client.userId ? { ...p, username: nextName } : p
                );
                if (party.hostUserId === client.userId) {
                  party.hostName = nextName;
                }
                sendToParty(client.partyCode, { type: 'party:state', party });
              }
            }
            if (client.chessRoomCode) {
              const chessRoom = chessRooms.get(client.chessRoomCode);
              if (chessRoom) {
                chessRoom.players = chessRoom.players.map((p) =>
                  p.userId === client.userId ? { ...p, username: nextName } : p
                );
                if (chessRoom.hostUserId === client.userId) {
                  chessRoom.hostName = nextName;
                }
                sendToChessRoom(client.chessRoomCode, { type: 'chess:state', room: chessRoom });
                broadcastChessRooms();
              }
            }
          }
        } else if (data.type === 'room:switch') {
          client.room = data.room;
          broadcast({ type: 'presence:update', onlineUsers: getOnlineUsers() });
        } else if (data.type === 'chat:send') {
          const text = String(data.text || '').trim().slice(0, 1000);
          if (!text && !data.movieRef) return;

          const messageId = String(data.id || randomUUID());
          if (db.messages.some((m) => m.id === messageId)) {
            return;
          }

          const message: ChatMessage = {
            id: messageId,
            room: data.room || 'general',
            userId: client.userId || data.userId,
            username: client.username || data.username || 'MovieFan',
            text: text || `Shared ${data.movieRef?.title ?? 'a movie'}`,
            timestamp: new Date().toISOString(),
            movieRef: data.movieRef,
            likedBy: [],
            reactions: {},
          };

          db.messages.push(message);
          if (db.messages.length > 500) {
            db.messages = db.messages.slice(-500);
          }
          saveDatabase(db);
          broadcast({ type: 'chat:message', message });
        } else if (data.type === 'chat:like') {
          const messageId = String(data.messageId || '').trim();
          const actorId = (client.userId || String(data.userId || '')).trim().slice(0, 64);
          if (!messageId || !actorId) return;

          const target = db.messages.find((m) => m.id === messageId);
          if (!target || target.userId === actorId) return;

          const existingLikes = Array.isArray(target.likedBy) ? target.likedBy : [];
          const hasLiked = existingLikes.includes(actorId);
          target.likedBy = hasLiked
            ? existingLikes.filter((id) => id !== actorId)
            : [...existingLikes, actorId];

          saveDatabase(db);
          broadcast({
            type: 'chat:like_updated',
            messageId: target.id,
            likedBy: target.likedBy,
          });
        } else if (data.type === 'chat:react') {
          const messageId = String(data.messageId || '').trim();
          const actorId = (client.userId || String(data.userId || '')).trim().slice(0, 64);
          const emoji = String(data.emoji || '').trim();
          if (!messageId || !actorId || !emoji || emoji.length > 16 || /\s/.test(emoji)) return;

          const target = db.messages.find((m) => m.id === messageId);
          if (!target) return;

          const nextReactions: Record<string, string[]> = { ...(target.reactions || {}) };
          const currentReactors = Array.isArray(nextReactions[emoji]) ? nextReactions[emoji] : [];
          if (currentReactors.includes(actorId)) {
            const filtered = currentReactors.filter((id) => id !== actorId);
            if (filtered.length > 0) {
              nextReactions[emoji] = filtered;
            } else {
              delete nextReactions[emoji];
            }
          } else {
            nextReactions[emoji] = [...currentReactors, actorId];
          }
          target.reactions = nextReactions;

          saveDatabase(db);
          broadcast({
            type: 'chat:reaction_updated',
            messageId: target.id,
            reactions: target.reactions,
          });
        } else if (data.type === 'party:join') {
          const roomCode = String(data.roomCode || '')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9_-]/g, '')
            .slice(0, 12);
          if (!roomCode) {
            ws.send(JSON.stringify({ type: 'party:error', message: 'Invalid Watch Party room code.' }));
            return;
          }

          const actorId = (client.userId || String(data.userId || randomUUID())).slice(0, 64);
          const actorName = (String(data.username || client.username || 'MovieFan').trim().slice(0, 32)) || 'MovieFan';
          client.userId = actorId;
          client.username = actorName;

          if (client.partyCode && client.partyCode !== roomCode) {
            removeClientFromParty(client, client.partyCode);
          }
          client.partyCode = roomCode;

          let party = watchParties.get(roomCode);
          if (!party) {
            const initialMovieId =
              (data.movieId && db.movies.some((m) => m.id === data.movieId) ? data.movieId : '') ||
              db.movies[0]?.id ||
              '';
            party = {
              roomCode,
              movieId: initialMovieId,
              isPlaying: false,
              currentTime: 0,
              updatedAt: Date.now(),
              hostUserId: actorId,
              hostName: actorName,
              participants: [{ userId: actorId, username: actorName }],
            };
            watchParties.set(roomCode, party);
          } else {
            if (data.movieId && db.movies.some((m) => m.id === data.movieId) && actorId === party.hostUserId) {
              party.movieId = data.movieId;
              party.currentTime = 0;
              party.isPlaying = false;
              party.updatedAt = Date.now();
            }
            if (!party.participants.some((p) => p.userId === actorId)) {
              party.participants.push({ userId: actorId, username: actorName });
            }
          }

          sendToParty(roomCode, { type: 'party:state', party });
        } else if (data.type === 'party:leave') {
          const roomCode = String(data.roomCode || client.partyCode || '')
            .trim()
            .toUpperCase()
            .slice(0, 12);
          removeClientFromParty(client, roomCode);
        } else if (data.type === 'party:sync') {
          const roomCode = String(data.roomCode || client.partyCode || '')
            .trim()
            .toUpperCase()
            .slice(0, 12);
          const party = watchParties.get(roomCode);
          if (!party) return;

          if (data.movieId && db.movies.some((m) => m.id === data.movieId)) {
            party.movieId = data.movieId;
          }
          party.isPlaying = Boolean(data.isPlaying);
          party.currentTime = Math.max(0, Number(data.currentTime) || 0);
          party.updatedAt = Date.now();

          sendToParty(roomCode, { type: 'party:state', party });
        } else if (data.type === 'chess:list') {
          ws.send(JSON.stringify({ type: 'chess:rooms', rooms: getPublicChessRooms() }));
        } else if (data.type === 'chess:create') {
          const actorId = (client.userId || String(data.userId || randomUUID())).slice(0, 64);
          const actorName =
            String(data.username || client.username || 'MovieFan').trim().slice(0, 32) || 'MovieFan';
          client.userId = actorId;
          client.username = actorName;

          if (client.chessRoomCode) {
            removeClientFromChessRoom(client, client.chessRoomCode);
          }

          let code = '';
          for (let attempt = 0; attempt < 8; attempt++) {
            const candidate = Math.random().toString(36).slice(2, 8).toUpperCase();
            if (!chessRooms.has(candidate)) {
              code = candidate;
              break;
            }
          }
          if (!code) code = randomUUID().slice(0, 6).toUpperCase();

          const hostColor: 'w' | 'b' =
            data.preferredColor === 'b'
              ? 'b'
              : data.preferredColor === 'random'
              ? Math.random() < 0.5
                ? 'w'
                : 'b'
              : 'w';

          const room: ChessRoomState = {
            roomCode: code,
            hostUserId: actorId,
            hostName: actorName,
            players: [{ userId: actorId, username: actorName, color: hostColor }],
            moves: [],
            turn: 'w',
            status: 'waiting',
            resignedBy: null,
            winner: null,
            updatedAt: Date.now(),
          };
          chessRooms.set(code, room);
          client.chessRoomCode = code;
          sendToChessRoom(code, { type: 'chess:state', room });
          broadcastChessRooms();
        } else if (data.type === 'chess:join') {
          const roomCode = String(data.roomCode || '')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9_-]/g, '')
            .slice(0, 12);
          const room = chessRooms.get(roomCode);
          if (!room) {
            ws.send(JSON.stringify({ type: 'chess:error', message: `Chess room "${roomCode}" not found.` }));
            return;
          }

          const actorId = (client.userId || String(data.userId || randomUUID())).slice(0, 64);
          const actorName =
            String(data.username || client.username || 'MovieFan').trim().slice(0, 32) || 'MovieFan';
          client.userId = actorId;
          client.username = actorName;

          const existingPlayer = room.players.find((p) => p.userId === actorId);
          if (!existingPlayer && room.players.length >= 2) {
            ws.send(JSON.stringify({ type: 'chess:error', message: 'This chess room already has 2 players.' }));
            return;
          }

          if (client.chessRoomCode && client.chessRoomCode !== roomCode) {
            removeClientFromChessRoom(client, client.chessRoomCode);
          }
          client.chessRoomCode = roomCode;

          if (!existingPlayer) {
            const takenColor = room.players[0]?.color || 'w';
            const guestColor: 'w' | 'b' = takenColor === 'w' ? 'b' : 'w';
            room.players.push({ userId: actorId, username: actorName, color: guestColor });
            if (room.status === 'waiting') {
              room.status = 'playing';
            }
          } else {
            existingPlayer.username = actorName;
          }
          room.updatedAt = Date.now();
          sendToChessRoom(roomCode, { type: 'chess:state', room });
          broadcastChessRooms();
        } else if (data.type === 'chess:move') {
          const roomCode = String(data.roomCode || client.chessRoomCode || '')
            .trim()
            .toUpperCase()
            .slice(0, 12);
          const room = chessRooms.get(roomCode);
          if (!room || room.status !== 'playing') return;

          const actorId = client.userId || String(data.userId || '');
          const player = room.players.find((p) => p.userId === actorId);
          if (!player) return;

          const mv = data.move as ChessRoomMovePayload;
          if (!mv || player.color !== room.turn || mv.byColor !== room.turn) return;
          if (mv.ply !== room.moves.length + 1) return;

          room.moves.push(mv);
          room.turn = room.turn === 'w' ? 'b' : 'w';
          room.updatedAt = Date.now();
          sendToChessRoom(roomCode, { type: 'chess:state', room });
        } else if (data.type === 'chess:resign') {
          const roomCode = String(data.roomCode || client.chessRoomCode || '')
            .trim()
            .toUpperCase()
            .slice(0, 12);
          const room = chessRooms.get(roomCode);
          if (!room || room.status !== 'playing') return;

          const actorId = client.userId || String(data.userId || '');
          const player = room.players.find((p) => p.userId === actorId);
          if (!player) return;

          room.status = 'finished';
          room.resignedBy = player.color;
          room.winner = player.color === 'w' ? 'b' : 'w';
          room.updatedAt = Date.now();
          sendToChessRoom(roomCode, { type: 'chess:state', room });
        } else if (data.type === 'chess:rematch') {
          const roomCode = String(data.roomCode || client.chessRoomCode || '')
            .trim()
            .toUpperCase()
            .slice(0, 12);
          const room = chessRooms.get(roomCode);
          if (!room) return;

          room.players = room.players.map((p) => ({
            ...p,
            color: p.color === 'w' ? 'b' : 'w',
          }));
          room.moves = [];
          room.turn = 'w';
          room.resignedBy = null;
          room.winner = null;
          room.status = room.players.length >= 2 ? 'playing' : 'waiting';
          room.updatedAt = Date.now();
          sendToChessRoom(roomCode, { type: 'chess:state', room });
        } else if (data.type === 'chess:leave') {
          const roomCode = String(data.roomCode || client.chessRoomCode || '')
            .trim()
            .toUpperCase()
            .slice(0, 12);
          removeClientFromChessRoom(client, roomCode);
          ws.send(JSON.stringify({ type: 'chess:left', roomCode }));
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    });

    ws.on('close', () => {
      const client = clients.get(ws);
      if (client) {
        removeClientFromParty(client);
        removeClientFromChessRoom(client);
      }
      clients.delete(ws);
      broadcast({ type: 'presence:update', onlineUsers: getOnlineUsers() });
    });
  });

  const MAX_MOVIE_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
  const ALLOWED_VIDEO_EXTS = /\.(mp4|webm|mkv|mov|m4v|3gp|avi|mpeg|mpg|ts|flv|wmv)$/i;
  const ALLOWED_VIDEO_MIMES = new Set([
    'video/mp4',
    'video/webm',
    'video/x-matroska',
    'video/matroska',
    'application/x-matroska',
    'application/mp4',
    'video/quicktime',
    'video/3gpp',
    'video/3gpp2',
    'video/x-m4v',
    'video/x-msvideo',
    'video/avi',
    'video/mpeg',
    'video/mp2t',
    'video/x-flv',
    'video/x-ms-wmv',
  ]);
  const ALLOWED_POSTER_EXTS = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i;
  const ALLOWED_POSTER_MIMES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/avif',
    'image/heic',
    'image/heif',
  ]);

  function isValidVideoUpload(fileName: string, mimeType: string): boolean {
    const mime = (mimeType || '').toLowerCase();
    if (mime.startsWith('image/')) return false;
    return mime.startsWith('video/') || ALLOWED_VIDEO_MIMES.has(mime) || ALLOWED_VIDEO_EXTS.test(fileName || '');
  }

  function sanitizeHttpUrl(raw: unknown): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim().slice(0, 500);
    if (!trimmed) return undefined;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return undefined;
  }

  const storage = multer.diskStorage({
    destination: (_req, file, cb) => {
      if (file.fieldname === 'poster') {
        cb(null, POSTERS_DIR);
      } else {
        cb(null, MOVIES_DIR);
      }
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || (file.fieldname === 'poster' ? '.jpg' : '.mp4');
      const base = sanitizeFilename(path.basename(file.originalname, ext)).slice(0, 60);
      cb(null, `${Date.now()}-${base}${ext}`);
    },
  });

  const upload = multer({
    storage,
    limits: {
      fileSize: MAX_MOVIE_UPLOAD_BYTES,
      fieldSize: 25 * 1024 * 1024,
    },
    fileFilter: (_req, file, cb) => {
      if (file.fieldname === 'video') {
        if (!isValidVideoUpload(file.originalname, file.mimetype)) {
          const err = new Error('Please choose a video file (MP4, WEBM, MKV, MOV, M4V, 3GP, or AVI).') as Error & {
            status?: number;
          };
          err.status = 400;
          cb(err);
          return;
        }
      } else if (file.fieldname === 'poster') {
        const mime = (file.mimetype || '').toLowerCase();
        if (!mime.startsWith('image/') && !ALLOWED_POSTER_MIMES.has(mime) && !ALLOWED_POSTER_EXTS.test(file.originalname || '')) {
          const err = new Error('Poster must be an image file (JPG, PNG, WEBP, GIF, AVIF, or HEIC).') as Error & {
            status?: number;
          };
          err.status = 400;
          cb(err);
          return;
        }
      }
      cb(null, true);
    },
  });

  const chunkUpload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const uploadId = sanitizeFilename(String(req.params.uploadId || '')).slice(0, 64);
        const dir = path.join(CHUNKS_DIR, uploadId);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
      },
      filename: (req, _file, cb) => {
        const idx = Math.max(0, Number(req.query?.chunkIndex ?? req.body?.chunkIndex ?? 0) || 0);
        cb(null, `part-${String(idx).padStart(6, '0')}`);
      },
    }),
    limits: {
      fileSize: 25 * 1024 * 1024,
      fieldSize: 5 * 1024 * 1024,
    },
  });

  interface PendingChunkUpload {
    uploadId: string;
    fileName: string;
    fileSizeBytes: number;
    mimeType: string;
    totalChunks: number;
    ownerUid?: string;
    createdAt: number;
  }

  const pendingChunkUploads = new Map<string, PendingChunkUpload>();

  function getChunkSessionPath(uploadId: string): string {
    return path.join(CHUNKS_DIR, uploadId, 'session.json');
  }

  function saveChunkSession(session: PendingChunkUpload): void {
    pendingChunkUploads.set(session.uploadId, session);
    const dir = path.join(CHUNKS_DIR, session.uploadId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(getChunkSessionPath(session.uploadId), JSON.stringify(session), 'utf-8');
  }

  function loadChunkSession(rawUploadId: string): PendingChunkUpload | null {
    const uploadId = sanitizeFilename(rawUploadId).slice(0, 64);
    if (!uploadId) return null;
    const inMemory = pendingChunkUploads.get(uploadId);
    if (inMemory) return inMemory;
    const sessionPath = getChunkSessionPath(uploadId);
    if (!fs.existsSync(sessionPath)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(sessionPath, 'utf-8')) as PendingChunkUpload;
      if (parsed?.uploadId) {
        pendingChunkUploads.set(uploadId, parsed);
        return parsed;
      }
    } catch (err) {
      console.error(`[Upload] Failed reading chunk session ${uploadId}:`, err);
    }
    return null;
  }

  function appendChunkFileToStream(
    partPath: string,
    outStream: fs.WriteStream
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const readStream = fs.createReadStream(partPath);
      let settled = false;

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        readStream.destroy();
        reject(err);
      };

      readStream.on('error', (err) => fail(err));
      outStream.once('error', (err) => fail(err));

      readStream.on('data', (chunk) => {
        if (!outStream.write(chunk)) {
          readStream.pause();
          outStream.once('drain', () => {
            if (!settled) readStream.resume();
          });
        }
      });

      readStream.on('end', () => {
        if (settled) return;
        settled = true;
        resolve();
      });
    });
  }

  async function finalizeUploadedMovie(params: {
    videoFilePath: string;
    videoUrlFilename: string;
    originalFileName: string;
    fileSizeBytes: number;
    mimeType: string;
    posterFile?: Express.Multer.File;
    body: Record<string, unknown>;
    verifiedUser?: VerifiedFirebaseUser;
  }): Promise<Movie> {
    const {
      videoFilePath,
      videoUrlFilename,
      originalFileName,
      fileSizeBytes,
      mimeType,
      posterFile,
      body,
      verifiedUser,
    } = params;

    const title = String(body.title || '').trim();
    const rawGenre = String(body.genre || 'Drama') as MovieGenre;
    const genre: MovieGenre = VALID_GENRES.includes(rawGenre) ? rawGenre : 'Drama';
    const rawQuality = String(body.quality || '1080p HD') as MovieQuality;
    const quality: MovieQuality = VALID_QUALITIES.includes(rawQuality) ? rawQuality : '1080p HD';
    const year = Math.min(2030, Math.max(1900, Number(body.year) || new Date().getFullYear()));
    const duration = String(body.duration || '1h 45m').trim() || '1h 45m';
    const director = String(body.director || 'Independent').trim() || 'Independent';
    const uploader =
      verifiedUser?.displayName ||
      String(body.uploader || 'TempleSolo Admin').trim() ||
      'TempleSolo Admin';
    const synopsis =
      String(body.synopsis || '').trim() ||
      `${title} uploaded to templesolosmovies.com by ${uploader}. Ready for instant streaming preview and direct file download.`;

    let posterUrl = '/storage/posters/midnight_meridian_poster.jpg';
    if (posterFile) {
      const optimizedPath = await compressPosterImage(posterFile.path, 540);
      posterUrl = `/storage/posters/${path.basename(optimizedPath)}`;
    } else {
      const extractedPosterName = `poster-${Date.now()}.jpg`;
      const extractedPosterPath = path.join(POSTERS_DIR, extractedPosterName);
      try {
        await execFileAsync('ffmpeg', [
          '-y',
          '-ss',
          '00:00:01',
          '-i',
          videoFilePath,
          '-vframes',
          '1',
          '-vf',
          "scale='min(540,iw)':-2",
          '-q:v',
          '5',
          extractedPosterPath,
        ]);
        if (fs.existsSync(extractedPosterPath) && fs.statSync(extractedPosterPath).size > 0) {
          posterUrl = `/storage/posters/${extractedPosterName}`;
        }
      } catch {
        // Fallback silently
      }
    }

    const rawImdb = Number(body.imdbRating);
    const imdbRating =
      Number.isFinite(rawImdb) && rawImdb >= 1 && rawImdb <= 10
        ? Math.round(rawImdb * 10) / 10
        : 7.8;

    const country = String(body.country || '').trim().slice(0, 60) || undefined;
    const rawCategory = String(body.category || '').trim();
    const normalizedCategory = rawCategory === 'Movie' ? 'Movies' : rawCategory;
    const validCategories = ['Movies', 'Series', 'Music', 'Anime', 'Nollywood', 'K-Drama'];
    const category = validCategories.includes(normalizedCategory)
      ? (normalizedCategory as Movie['category'])
      : undefined;
    const ageRating = String(body.ageRating || '').trim().slice(0, 12) || undefined;
    const trailerUrl = sanitizeHttpUrl(body.trailerUrl);

    const movie: Movie = {
      id: `movie-${randomUUID().slice(0, 8)}`,
      title,
      genre,
      ...(category ? { category } : {}),
      ...(country ? { country } : {}),
      ...(ageRating ? { ageRating } : {}),
      year,
      duration,
      quality,
      director,
      uploader,
      synopsis,
      imdbRating,
      posterUrl,
      ...(trailerUrl ? { trailerUrl } : {}),
      videoUrl: `/storage/movies/${videoUrlFilename}`,
      fileName: originalFileName || videoUrlFilename,
      fileSizeBytes,
      mimeType: mimeType || 'video/mp4',
      downloads: 0,
      featured: Boolean(body.featured === 'true' || body.featured === true),
      isSeeded: false,
      ownerUid: verifiedUser?.uid,
      createdAt: new Date().toISOString(),
    };

    db.movies.unshift(movie);

    const dropMessage: ChatMessage = {
      id: `drop-${movie.id}`,
      room: 'drops',
      userId: verifiedUser?.uid || 'system-drops',
      username: uploader,
      text: `Uploaded "${movie.title}" (${movie.quality}) to the vault.`,
      timestamp: new Date().toISOString(),
      isSystem: true,
      movieRef: {
        id: movie.id,
        title: movie.title,
        genre: movie.genre,
        year: movie.year,
        quality: movie.quality,
        posterUrl: movie.posterUrl,
      },
    };
    db.messages.push(dropMessage);
    saveDatabase(db);

    broadcast({ type: 'movie:created', movie });
    broadcast({ type: 'chat:message', message: dropMessage });

    return movie;
  }

  const requireAdmin: express.RequestHandler = async (req, res, next) => {
    const verifiedUser = await verifyFirebaseIdToken(req.headers.authorization);
    if (!verifiedUser) {
      console.warn(`[Upload Auth] Unauthorized ${req.method} ${req.originalUrl}: missing or invalid Bearer token.`);
      res.status(401).json({ error: 'Administrator sign-in expired or missing. Please log in again and retry.' });
      return;
    }
    const admin = await isAdminUser(verifiedUser);
    if (!admin) {
      console.warn(`[Upload Auth] Forbidden ${req.method} ${req.originalUrl} for ${verifiedUser.email || verifiedUser.uid}`);
      res.status(403).json({
        error: 'Only the administrator can upload, edit, or remove movies.',
      });
      return;
    }
    res.locals.verifiedUser = verifiedUser;
    next();
  };

  app.get('/api/upload/health', requireAdmin, (_req, res) => {
    try {
      ensureDirectories();
      res.json({
        ok: true,
        storageWritable: true,
        maxVideoBytes: MAX_MOVIE_UPLOAD_BYTES,
        chunkSupported: true,
      });
    } catch (err) {
      console.error('[Upload Health] Storage check failed:', err);
      res.status(500).json({
        ok: false,
        storageWritable: false,
        error: err instanceof Error ? err.message : 'Upload storage is unavailable.',
      });
    }
  });

  app.get('/api/movies', (req, res) => {
    if (!cachedMoviesPayload) {
      cachedMoviesPayload = buildSerializedJsonCache({ movies: db.movies });
    }
    sendCachedJsonEntry(req, res, cachedMoviesPayload);
  });

  app.post(
    '/api/movies',
    requireAdmin,
    upload.fields([
      { name: 'video', maxCount: 1 },
      { name: 'poster', maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        const verifiedUser = res.locals.verifiedUser as VerifiedFirebaseUser | undefined;
        const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
        const videoFile = files?.video?.[0];
        const posterFile = files?.poster?.[0];

        if (!videoFile) {
          console.warn('[Upload] Direct POST /api/movies missing video file field');
          if (posterFile && fs.existsSync(posterFile.path)) fs.unlinkSync(posterFile.path);
          res.status(400).json({ error: 'Please choose a video file to upload.' });
          return;
        }

        const title = String(req.body.title || '').trim();
        if (!title) {
          if (fs.existsSync(videoFile.path)) fs.unlinkSync(videoFile.path);
          if (posterFile && fs.existsSync(posterFile.path)) fs.unlinkSync(posterFile.path);
          res.status(400).json({ error: 'Movie title is required.' });
          return;
        }

        console.log(
          `[Upload] Direct upload "${title}" (${videoFile.originalname}, ${videoFile.size} bytes, ${videoFile.mimetype}) by ${verifiedUser?.email || verifiedUser?.uid || 'admin'}`
        );

        const movie = await finalizeUploadedMovie({
          videoFilePath: videoFile.path,
          videoUrlFilename: videoFile.filename,
          originalFileName: videoFile.originalname || videoFile.filename,
          fileSizeBytes: videoFile.size,
          mimeType: videoFile.mimetype || 'video/mp4',
          posterFile,
          body: req.body as Record<string, unknown>,
          verifiedUser,
        });

        console.log(`[Upload] Published direct movie "${movie.title}" (id=${movie.id})`);
        res.status(201).json({ movie });
      } catch (err) {
        console.error('[Upload Error] Direct POST /api/movies failed:', err);
        res.status(500).json({
          error: err instanceof Error ? `Upload failed: ${err.message}` : 'Failed to process movie upload.',
        });
      }
    }
  );

  // Chunked upload pipeline (bypasses strict proxy/Cloud Run body limits up to 2 GB)
  app.post('/api/movies/chunked/init', requireAdmin, (req, res) => {
    try {
      ensureDirectories();
      const verifiedUser = res.locals.verifiedUser as VerifiedFirebaseUser | undefined;
      const fileName = String(req.body?.fileName || '').trim();
      const mimeType = String(req.body?.mimeType || '').trim();
      const fileSizeBytes = Number(req.body?.fileSizeBytes || 0);
      const totalChunks = Number(req.body?.totalChunks || 0);

      if (!fileName || !isValidVideoUpload(fileName, mimeType)) {
        res.status(400).json({ error: 'Please choose a video file (MP4, WEBM, MKV, MOV, or M4V).' });
        return;
      }
      if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
        res.status(400).json({ error: 'Selected video file is empty.' });
        return;
      }
      if (fileSizeBytes > MAX_MOVIE_UPLOAD_BYTES) {
        res.status(413).json({ error: 'Video file exceeds the 2 GB upload limit.' });
        return;
      }
      if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 4096) {
        res.status(400).json({ error: 'Invalid upload chunk configuration.' });
        return;
      }

      const uploadId = `chk-${randomUUID()}`;
      const uploadDir = path.join(CHUNKS_DIR, uploadId);
      fs.mkdirSync(uploadDir, { recursive: true });

      saveChunkSession({
        uploadId,
        fileName,
        fileSizeBytes,
        mimeType: mimeType || 'video/mp4',
        totalChunks,
        ownerUid: verifiedUser?.uid,
        createdAt: Date.now(),
      });

      console.log(
        `[Upload] Chunked session started (${uploadId}): "${fileName}", ${fileSizeBytes} bytes in ${totalChunks} chunks`
      );
      res.status(201).json({ uploadId });
    } catch (err) {
      console.error('[Upload Error] Chunked init failed:', err);
      res.status(500).json({
        error: err instanceof Error ? `Could not initialize upload session: ${err.message}` : 'Could not initialize upload session.',
      });
    }
  });

  app.post(
    '/api/movies/chunked/:uploadId/part',
    requireAdmin,
    chunkUpload.single('chunk'),
    (req, res) => {
      const uploadId = sanitizeFilename(String(req.params.uploadId || '').trim()).slice(0, 64);
      const session = loadChunkSession(uploadId);
      if (!session) {
        console.warn(`[Upload] Chunk part rejected — unknown session ${uploadId}`);
        res.status(404).json({ error: 'Upload session not found or expired. Please retry upload.' });
        return;
      }
      const chunkIndex = Number(req.body?.chunkIndex ?? req.query?.chunkIndex ?? -1);
      if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
        res.status(400).json({ error: `Invalid chunk index (${chunkIndex}).` });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'Chunk binary payload is missing.' });
        return;
      }
      if (chunkIndex === 0 || chunkIndex + 1 === session.totalChunks || (chunkIndex + 1) % 10 === 0) {
        console.log(
          `[Upload] Chunk ${chunkIndex + 1}/${session.totalChunks} stored for ${uploadId} (${req.file.size} bytes)`
        );
      }
      res.json({ received: true, chunkIndex });
    }
  );

  app.post(
    '/api/movies/chunked/:uploadId/complete',
    requireAdmin,
    upload.fields([{ name: 'poster', maxCount: 1 }]),
    async (req, res) => {
      const uploadId = sanitizeFilename(String(req.params.uploadId || '').trim()).slice(0, 64);
      const session = loadChunkSession(uploadId);
      const uploadDir = path.join(CHUNKS_DIR, uploadId);
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const posterFile = files?.poster?.[0];

      const cleanupSession = () => {
        pendingChunkUploads.delete(uploadId);
        if (fs.existsSync(uploadDir)) {
          fs.rmSync(uploadDir, { recursive: true, force: true });
        }
      };

      if (!session) {
        console.warn(`[Upload] Complete failed — missing session ${uploadId}`);
        if (posterFile && fs.existsSync(posterFile.path)) fs.unlinkSync(posterFile.path);
        cleanupSession();
        res.status(404).json({ error: 'Upload session expired before completion. Please try again.' });
        return;
      }

      const title = String(req.body?.title || '').trim();
      if (!title) {
        if (posterFile && fs.existsSync(posterFile.path)) fs.unlinkSync(posterFile.path);
        cleanupSession();
        res.status(400).json({ error: 'Movie title is required.' });
        return;
      }

      const ext = path.extname(session.fileName) || '.mp4';
      const base = sanitizeFilename(path.basename(session.fileName, ext)).slice(0, 60);
      const finalFileName = `${Date.now()}-${base}${ext}`;
      const finalFilePath = path.join(MOVIES_DIR, finalFileName);

      try {
        for (let i = 0; i < session.totalChunks; i += 1) {
          const partPath = path.join(uploadDir, `part-${String(i).padStart(6, '0')}`);
          if (!fs.existsSync(partPath)) {
            console.warn(`[Upload] Missing part ${i + 1}/${session.totalChunks} in session ${uploadId}`);
            if (posterFile && fs.existsSync(posterFile.path)) fs.unlinkSync(posterFile.path);
            cleanupSession();
            res.status(400).json({ error: `Missing upload chunk ${i + 1} of ${session.totalChunks}. Please retry.` });
            return;
          }
        }

        console.log(`[Upload] Merging ${session.totalChunks} chunks for "${title}" (${uploadId})...`);
        const outStream = fs.createWriteStream(finalFilePath);
        for (let i = 0; i < session.totalChunks; i += 1) {
          const partPath = path.join(uploadDir, `part-${String(i).padStart(6, '0')}`);
          await appendChunkFileToStream(partPath, outStream);
        }
        await new Promise<void>((resolve, reject) => {
          outStream.once('error', reject);
          outStream.once('finish', resolve);
          outStream.end();
        });

        const verifiedUser = res.locals.verifiedUser as VerifiedFirebaseUser | undefined;
        const statSize = fs.existsSync(finalFilePath) ? fs.statSync(finalFilePath).size : session.fileSizeBytes;
        const movie = await finalizeUploadedMovie({
          videoFilePath: finalFilePath,
          videoUrlFilename: finalFileName,
          originalFileName: session.fileName,
          fileSizeBytes: statSize,
          mimeType: session.mimeType,
          posterFile,
          body: req.body as Record<string, unknown>,
          verifiedUser,
        });

        cleanupSession();
        console.log(`[Upload] Completed & published "${movie.title}" (id=${movie.id}, ${statSize} bytes)`);
        res.status(201).json({ movie });
      } catch (err) {
        console.error(`[Upload Error] Chunked complete failed for ${uploadId}:`, err);
        if (fs.existsSync(finalFilePath)) fs.unlinkSync(finalFilePath);
        if (posterFile && fs.existsSync(posterFile.path)) fs.unlinkSync(posterFile.path);
        cleanupSession();
        res.status(500).json({
          error: err instanceof Error ? `Failed to assemble uploaded movie: ${err.message}` : 'Failed to assemble uploaded movie.',
        });
      }
    }
  );

  app.post('/api/movies/chunked/:uploadId/abort', requireAdmin, (req, res) => {
    const uploadId = sanitizeFilename(String(req.params.uploadId || '').trim()).slice(0, 64);
    console.log(`[Upload] Aborted chunked session ${uploadId}`);
    pendingChunkUploads.delete(uploadId);
    const uploadDir = path.join(CHUNKS_DIR, uploadId);
    if (fs.existsSync(uploadDir)) {
      fs.rmSync(uploadDir, { recursive: true, force: true });
    }
    res.json({ aborted: true });
  });

  // Save externally hosted (Cloudinary) uploaded movie into persistent server catalog
  app.post('/api/movies/cloudinary', requireAdmin, (req, res) => {
    try {
      const verifiedUser = res.locals.verifiedUser as VerifiedFirebaseUser | undefined;
      const body = req.body as Record<string, unknown>;
      const title = String(body.title || '').trim().slice(0, 140);
      const videoUrl = sanitizeHttpUrl(body.videoUrl);
      const posterUrl = sanitizeHttpUrl(body.posterUrl) || '/storage/posters/midnight_meridian_poster.jpg';

      if (!title) {
        res.status(400).json({ error: 'Movie title is required.' });
        return;
      }
      if (!videoUrl) {
        res.status(400).json({ error: 'A valid Cloudinary video URL is required.' });
        return;
      }

      const rawGenre = String(body.genre || 'Action') as MovieGenre;
      const genre: MovieGenre = VALID_GENRES.includes(rawGenre) ? rawGenre : 'Action';
      const rawQuality = String(body.quality || '1080p HD') as MovieQuality;
      const quality: MovieQuality = VALID_QUALITIES.includes(rawQuality) ? rawQuality : '1080p HD';
      const rawCategory = String(body.category || '').trim();
      const normalizedCategory = rawCategory === 'Movie' ? 'Movies' : rawCategory;
      const validCategories = ['Movies', 'Series', 'Music', 'Anime', 'Nollywood', 'K-Drama'];
      const category = validCategories.includes(normalizedCategory)
        ? (normalizedCategory as Movie['category'])
        : 'Movies';
      const year = Math.min(2035, Math.max(1900, Number(body.year) || new Date().getFullYear()));
      const duration = String(body.duration || '1h 45m').trim() || '1h 45m';
      const uploader =
        verifiedUser?.displayName ||
        String(body.uploader || 'TempleSolo Admin').trim() ||
        'TempleSolo Admin';
      const synopsis =
        String(body.synopsis || '').trim().slice(0, 1000) ||
        `${title} (${year}) — uploaded to Temple Cinema vault.`;
      const ageRating = String(body.ageRating || '16+').trim().slice(0, 12) || '16+';
      const trailerUrl = sanitizeHttpUrl(body.trailerUrl);
      const fileSizeBytes = Math.max(0, Number(body.fileSizeBytes) || 0);

      const movie: Movie = {
        id:
          typeof body.id === 'string' && body.id.trim()
            ? sanitizeFilename(body.id.trim()).slice(0, 64)
            : `movie-cld-${randomUUID().slice(0, 8)}`,
        title,
        genre,
        category,
        year,
        duration,
        quality,
        director: String(body.director || uploader).trim() || uploader,
        uploader,
        synopsis,
        imdbRating: Number.isFinite(Number(body.imdbRating))
          ? Math.round(Math.min(10, Math.max(1, Number(body.imdbRating))) * 10) / 10
          : 8.2,
        ageRating,
        posterUrl,
        backdropUrl: posterUrl,
        ...(trailerUrl ? { trailerUrl } : {}),
        videoUrl,
        fileName: String(body.fileName || `${title}.mp4`).trim(),
        fileSizeBytes,
        mimeType: String(body.mimeType || 'video/mp4').trim(),
        downloads: 0,
        featured: false,
        isSeeded: false,
        ownerUid: verifiedUser?.uid,
        cloudinaryPublicId: typeof body.cloudinaryPublicId === 'string' ? body.cloudinaryPublicId : undefined,
        posterPublicId: typeof body.posterPublicId === 'string' ? body.posterPublicId : undefined,
        videoPublicId: typeof body.videoPublicId === 'string' ? body.videoPublicId : undefined,
        cloudinaryUploaded: true,
        createdAt: new Date().toISOString(),
      };

      const existingIdx = db.movies.findIndex((m) => m.id === movie.id);
      if (existingIdx !== -1) {
        db.movies[existingIdx] = movie;
      } else {
        db.movies.unshift(movie);
      }

      const dropMessage: ChatMessage = {
        id: `drop-${movie.id}`,
        room: 'drops',
        userId: verifiedUser?.uid || 'system-drops',
        username: uploader,
        text: `Uploaded "${movie.title}" (${movie.quality}) to the vault.`,
        timestamp: new Date().toISOString(),
        isSystem: true,
        movieRef: {
          id: movie.id,
          title: movie.title,
          genre: movie.genre,
          year: movie.year,
          quality: movie.quality,
          posterUrl: movie.posterUrl,
        },
      };
      if (!db.messages.some((m) => m.id === dropMessage.id)) {
        db.messages.push(dropMessage);
      }
      saveDatabase(db);

      broadcast({ type: 'movie:created', movie });
      broadcast({ type: 'chat:message', message: dropMessage });

      res.status(201).json({ movie });
    } catch (err) {
      console.error('[Upload Error] POST /api/movies/cloudinary failed:', err);
      res.status(500).json({ error: 'Failed to save Cloudinary movie metadata.' });
    }
  });

  // Update movie metadata (admin content management only)
  app.patch('/api/movies/:id', requireAdmin, (req, res) => {
    const movie = db.movies.find((m) => m.id === req.params.id);
    if (!movie) {
      res.status(404).json({ error: 'Movie not found.' });
      return;
    }

    const nextTitle = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    if (nextTitle) movie.title = nextTitle.slice(0, 140);
    if (typeof req.body.genre === 'string' && VALID_GENRES.includes(req.body.genre as MovieGenre)) {
      movie.genre = req.body.genre as MovieGenre;
    }
    if (typeof req.body.quality === 'string' && VALID_QUALITIES.includes(req.body.quality as MovieQuality)) {
      movie.quality = req.body.quality as MovieQuality;
    }
    if (typeof req.body.synopsis === 'string') {
      movie.synopsis = req.body.synopsis.trim().slice(0, 1000) || movie.synopsis;
    }
    if (typeof req.body.director === 'string' && req.body.director.trim()) {
      movie.director = req.body.director.trim().slice(0, 80);
    }
    if (typeof req.body.country === 'string') {
      const nextCountry = req.body.country.trim().slice(0, 60);
      movie.country = nextCountry || undefined;
    }
    if (typeof req.body.category === 'string') {
      const validCategories = ['Movies', 'Series', 'Music', 'Anime', 'Nollywood', 'K-Drama'];
      if (validCategories.includes(req.body.category.trim())) {
        movie.category = req.body.category.trim() as Movie['category'];
      }
    }
    if (req.body.imdbRating !== undefined) {
      const parsedImdb = Number(req.body.imdbRating);
      if (Number.isFinite(parsedImdb)) {
        movie.imdbRating = Math.round(Math.min(10, Math.max(1, parsedImdb)) * 10) / 10;
      }
    }
    if (req.body.trailerUrl !== undefined) {
      movie.trailerUrl = sanitizeHttpUrl(req.body.trailerUrl);
    }

    saveDatabase(db);
    res.json({ movie });
  });

  app.get('/api/movies/:id/download', async (req, res) => {
    const movie = db.movies.find((m) => m.id === req.params.id);
    if (!movie) {
      res.status(404).json({ error: 'Movie not found.' });
      return;
    }

    const storedName = path.basename(movie.videoUrl);
    const fullPath = path.join(MOVIES_DIR, storedName);
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).size < 1024) {
      // Ensure starter MP4 exists if requested before background seed finished
      const posterPath = path.join(POSTERS_DIR, path.basename(movie.posterUrl));
      if (movie.isSeeded && fs.existsSync(posterPath)) {
        await generateMp4FromPoster(posterPath, fullPath);
      }
    }

    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Movie file missing from server storage.' });
      return;
    }

    const requestedQuality =
      typeof req.query.quality === 'string' &&
      ['360p', '480p', '720p', '1080p', '4K'].includes(req.query.quality)
        ? req.query.quality
        : '480p';
    res.setHeader('X-Download-Quality', requestedQuality);

    const downloadName = sanitizeFilename(movie.fileName || `${movie.title}.mp4`);
    const stat = fs.statSync(fullPath);
    const totalSize = stat.size;
    const rangeHeader = req.headers.range;

    if (!rangeHeader) {
      movie.downloads += 1;
      saveDatabase(db);
      broadcast({
        type: 'movie:download_updated',
        movieId: movie.id,
        downloads: movie.downloads,
      });
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('Content-Type', movie.mimeType || 'video/mp4');

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = Math.min(Number(match[1]) || 0, Math.max(0, totalSize - 1));
        const end = match[2] ? Math.min(Number(match[2]), totalSize - 1) : totalSize - 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
        res.setHeader('Content-Length', String(end - start + 1));
        fs.createReadStream(fullPath, { start, end }).pipe(res);
        return;
      }
    }

    res.setHeader('Content-Length', String(totalSize));
    fs.createReadStream(fullPath).pipe(res);
  });

  app.delete('/api/movies/:id', requireAdmin, (req, res) => {
    const idx = db.movies.findIndex((m) => m.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Movie not found.' });
      return;
    }

    const [removed] = db.movies.splice(idx, 1);
    if (!removed.isSeeded) {
      const videoPath = path.join(MOVIES_DIR, path.basename(removed.videoUrl));
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
      }
      if (removed.posterUrl.startsWith('/storage/posters/poster-')) {
        const posterPath = path.join(POSTERS_DIR, path.basename(removed.posterUrl));
        if (fs.existsSync(posterPath)) {
          fs.unlinkSync(posterPath);
        }
      }
    }

    saveDatabase(db);
    broadcast({ type: 'movie:deleted', movieId: removed.id });
    res.json({ ok: true });
  });

  app.get('/api/chat/messages', (req, res) => {
    const room = req.query.room as ChatRoomId | undefined;
    const messages = room ? db.messages.filter((m) => m.room === room) : db.messages;
    res.json({ messages: messages.slice(-200) });
  });

  app.post('/api/chat/messages', (req, res) => {
    const allowedRooms: ChatRoomId[] = ['general', 'requests', 'drops'];
    const rawRoom = String(req.body?.room || 'general').trim() as ChatRoomId;
    const room: ChatRoomId = allowedRooms.includes(rawRoom) ? rawRoom : 'general';
    const text = String(req.body?.text || '').trim().slice(0, 1000);
    const movieRef = req.body?.movieRef && typeof req.body.movieRef === 'object'
      ? req.body.movieRef
      : undefined;

    if (!text && !movieRef) {
      res.status(400).json({ error: 'Message text is required.' });
      return;
    }

    const messageId = String(req.body?.id || randomUUID()).trim().slice(0, 80);
    const existing = db.messages.find((m) => m.id === messageId);
    if (existing) {
      res.json({ message: existing });
      return;
    }

    const userId = String(req.body?.userId || `guest-${randomUUID().slice(0, 8)}`).trim().slice(0, 64);
    const username = String(req.body?.username || 'MovieFan').trim().slice(0, 32) || 'MovieFan';

    const message: ChatMessage = {
      id: messageId,
      room,
      userId,
      username,
      text: text || `Shared ${movieRef?.title ?? 'a movie'}`,
      timestamp: new Date().toISOString(),
      ...(movieRef ? { movieRef } : {}),
      likedBy: [],
      reactions: {},
    };

    db.messages.push(message);
    if (db.messages.length > 500) {
      db.messages = db.messages.slice(-500);
    }
    saveDatabase(db);
    broadcast({ type: 'chat:message', message });
    res.status(201).json({ message });
  });

  app.post('/api/chat/messages/:id/like', (req, res) => {
    const messageId = String(req.params.id || '').trim();
    const actorId = String(req.body?.userId || '').trim().slice(0, 64);
    if (!actorId) {
      res.status(400).json({ error: 'User ID is required to react to a message.' });
      return;
    }

    const target = db.messages.find((m) => m.id === messageId);
    if (!target) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }
    if (target.userId === actorId) {
      res.status(400).json({ error: 'Cannot like your own message.' });
      return;
    }

    const existingLikes = Array.isArray(target.likedBy) ? target.likedBy : [];
    const hasLiked = existingLikes.includes(actorId);
    target.likedBy = hasLiked
      ? existingLikes.filter((id) => id !== actorId)
      : [...existingLikes, actorId];

    saveDatabase(db);
    broadcast({
      type: 'chat:like_updated',
      messageId: target.id,
      likedBy: target.likedBy,
    });
    res.json({ ok: true, messageId: target.id, likedBy: target.likedBy });
  });

  app.post('/api/chat/messages/:id/react', (req, res) => {
    const messageId = String(req.params.id || '').trim();
    const actorId = String(req.body?.userId || '').trim().slice(0, 64);
    const emoji = String(req.body?.emoji || '').trim();
    if (!actorId) {
      res.status(400).json({ error: 'User ID is required to react to a message.' });
      return;
    }
    if (!emoji || emoji.length > 16 || /\s/.test(emoji)) {
      res.status(400).json({ error: 'Valid emoji reaction is required.' });
      return;
    }

    const target = db.messages.find((m) => m.id === messageId);
    if (!target) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }

    const nextReactions: Record<string, string[]> = { ...(target.reactions || {}) };
    const currentReactors = Array.isArray(nextReactions[emoji]) ? nextReactions[emoji] : [];
    if (currentReactors.includes(actorId)) {
      const filtered = currentReactors.filter((id) => id !== actorId);
      if (filtered.length > 0) {
        nextReactions[emoji] = filtered;
      } else {
        delete nextReactions[emoji];
      }
    } else {
      nextReactions[emoji] = [...currentReactors, actorId];
    }
    target.reactions = nextReactions;

    saveDatabase(db);
    broadcast({
      type: 'chat:reaction_updated',
      messageId: target.id,
      reactions: target.reactions,
    });
    res.json({ ok: true, messageId: target.id, reactions: target.reactions });
  });

  function computeSubscriberCount(upcoming: StoredUpcomingMovie): number {
    const activeSubs = db.releaseSubscriptions.filter(
      (s) => s.releaseId === upcoming.id
    ).length;
    return upcoming.baseSubscribers + activeSubs;
  }

  function toPublicUpcoming(upcoming: StoredUpcomingMovie): UpcomingMovie {
    return {
      id: upcoming.id,
      title: upcoming.title,
      genre: upcoming.genre,
      releaseDate: upcoming.releaseDate,
      duration: upcoming.duration,
      quality: upcoming.quality,
      director: upcoming.director,
      synopsis: upcoming.synopsis,
      posterUrl: upcoming.posterUrl,
      subscriberCount: computeSubscriberCount(upcoming),
      createdAt: upcoming.createdAt,
    };
  }

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  app.get('/api/upcoming', (req, res) => {
    if (!cachedUpcomingPayload) {
      const sorted = [...db.upcomingMovies]
        .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))
        .map(toPublicUpcoming);
      cachedUpcomingPayload = buildSerializedJsonCache({ upcoming: sorted });
    }
    sendCachedJsonEntry(req, res, cachedUpcomingPayload);
  });

  app.post('/api/upcoming/notify-all', async (req, res) => {
    const verifiedUser = await verifyFirebaseIdToken(req.headers.authorization);
    const rawEmail = String(req.body?.email || verifiedUser?.email || '')
      .trim()
      .toLowerCase()
      .slice(0, 160);

    if (!EMAIL_REGEX.test(rawEmail)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }

    const subscribedIds: string[] = [];
    for (const item of db.upcomingMovies) {
      const exists = db.releaseSubscriptions.some(
        (s) => s.releaseId === item.id && s.email === rawEmail
      );
      if (!exists) {
        db.releaseSubscriptions.push({
          releaseId: item.id,
          email: rawEmail,
          userId: verifiedUser?.uid,
          createdAt: new Date().toISOString(),
        });
      }
      subscribedIds.push(item.id);
      broadcast({
        type: 'upcoming:subscriber_updated',
        releaseId: item.id,
        subscriberCount: computeSubscriberCount(item),
      });
    }

    saveDatabase(db);
    res.json({ ok: true, email: rawEmail, subscribedIds });
  });

  app.post('/api/upcoming/:id/notify', async (req, res) => {
    const item = db.upcomingMovies.find((u) => u.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Upcoming release not found.' });
      return;
    }

    const verifiedUser = await verifyFirebaseIdToken(req.headers.authorization);
    const rawEmail = String(req.body?.email || verifiedUser?.email || '')
      .trim()
      .toLowerCase()
      .slice(0, 160);

    if (!EMAIL_REGEX.test(rawEmail)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }

    const action = req.body?.action === 'unsubscribe' ? 'unsubscribe' : 'subscribe';
    const existingIdx = db.releaseSubscriptions.findIndex(
      (s) => s.releaseId === item.id && s.email === rawEmail
    );

    let subscribed = true;
    if (action === 'unsubscribe') {
      if (existingIdx !== -1) {
        db.releaseSubscriptions.splice(existingIdx, 1);
      }
      subscribed = false;
    } else if (existingIdx === -1) {
      db.releaseSubscriptions.push({
        releaseId: item.id,
        email: rawEmail,
        userId: verifiedUser?.uid,
        createdAt: new Date().toISOString(),
      });
    }

    saveDatabase(db);
    const subscriberCount = computeSubscriberCount(item);
    broadcast({
      type: 'upcoming:subscriber_updated',
      releaseId: item.id,
      subscriberCount,
    });

    res.json({ ok: true, subscribed, subscriberCount, email: rawEmail });
  });

  app.post(
    '/api/upcoming',
    requireAdmin,
    upload.single('poster'),
    async (req, res) => {
      try {
        const title = String(req.body?.title || '').trim().slice(0, 140);
        if (!title) {
          if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
          res.status(400).json({ error: 'Title is required.' });
          return;
        }

        const rawGenre = String(req.body?.genre || 'Drama') as MovieGenre;
        const genre: MovieGenre = VALID_GENRES.includes(rawGenre) ? rawGenre : 'Drama';
        const rawQuality = String(req.body?.quality || '4K UHD') as MovieQuality;
        const quality: MovieQuality = VALID_QUALITIES.includes(rawQuality) ? rawQuality : '4K UHD';
        const rawDate = String(req.body?.releaseDate || '').trim();
        const releaseDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
          ? rawDate
          : new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
        const duration = String(req.body?.duration || '2h 00m').trim().slice(0, 24) || '2h 00m';
        const director = String(req.body?.director || 'TempleSolo Studio').trim().slice(0, 80) || 'TempleSolo Studio';
        const synopsis =
          String(req.body?.synopsis || '').trim().slice(0, 1000) ||
          `${title} is scheduled to arrive in the templesolosmovies.com vault on ${releaseDate}.`;

        let posterUrl = '/storage/posters/upcoming_glass_monsoon.jpg';
        if (req.file) {
          const optimizedPath = await compressPosterImage(req.file.path, 540);
          posterUrl = `/storage/posters/${path.basename(optimizedPath)}`;
        }

        const created: StoredUpcomingMovie = {
          id: `upcoming-${randomUUID().slice(0, 8)}`,
          title,
          genre,
          releaseDate,
          duration,
          quality,
          director,
          synopsis,
          posterUrl,
          baseSubscribers: 1,
          createdAt: new Date().toISOString(),
        };

        db.upcomingMovies.push(created);
        saveDatabase(db);

        const publicItem = toPublicUpcoming(created);
        broadcast({ type: 'upcoming:created', upcoming: publicItem });
        res.status(201).json({ upcoming: publicItem });
      } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error('[Upcoming Error] Failed to create upcoming release:', err);
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to create upcoming release.',
        });
      }
    }
  );

  app.delete('/api/upcoming/:id', requireAdmin, (req, res) => {
    const idx = db.upcomingMovies.findIndex((u) => u.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Upcoming release not found.' });
      return;
    }
    const [removed] = db.upcomingMovies.splice(idx, 1);
    db.releaseSubscriptions = db.releaseSubscriptions.filter(
      (s) => s.releaseId !== removed.id
    );
    saveDatabase(db);
    broadcast({ type: 'upcoming:deleted', releaseId: removed.id });
    res.json({ ok: true });
  });

  // Request a Movie endpoints
  app.get('/api/requests', (_req, res) => {
    res.json({ requests: db.movieRequests });
  });

  app.post('/api/requests', (req, res) => {
    const title = String(req.body?.title || '').trim().slice(0, 140);
    if (!title) {
      res.status(400).json({ error: 'Movie or series title is required.' });
      return;
    }
    const rawYear = Number(req.body?.year);
    const year =
      Number.isFinite(rawYear) && rawYear >= 1900 && rawYear <= 2030 ? rawYear : undefined;
    const country = String(req.body?.country || '').trim().slice(0, 60) || undefined;
    const notes = String(req.body?.notes || '').trim().slice(0, 400) || undefined;
    const requestedBy = String(req.body?.requestedBy || 'Guest Viewer').trim().slice(0, 60);

    const entry: MovieRequestItem = {
      id: `req-${randomUUID().slice(0, 8)}`,
      title,
      ...(year ? { year } : {}),
      ...(country ? { country } : {}),
      ...(notes ? { notes } : {}),
      requestedBy,
      upvotes: 1,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    db.movieRequests.unshift(entry);
    if (db.movieRequests.length > 100) {
      db.movieRequests = db.movieRequests.slice(0, 100);
    }
    saveDatabase(db);
    res.status(201).json({ request: entry });
  });

  app.post('/api/requests/:id/upvote', (req, res) => {
    const item = db.movieRequests.find((r) => r.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Request not found.' });
      return;
    }
    item.upvotes += 1;
    saveDatabase(db);
    res.json({ request: item });
  });

  // Report Broken Link endpoints
  app.get('/api/reports', requireAdmin, (_req, res) => {
    res.json({ reports: db.brokenLinkReports });
  });

  app.post('/api/reports', (req, res) => {
    const movieId = String(req.body?.movieId || '').trim().slice(0, 80);
    const movieTitle = String(req.body?.movieTitle || '').trim().slice(0, 140);
    const reason = String(req.body?.reason || '').trim().slice(0, 120);
    const details = String(req.body?.details || '').trim().slice(0, 400) || undefined;
    const reportedBy = String(req.body?.reportedBy || 'Viewer').trim().slice(0, 60);

    if (!movieId || !movieTitle || !reason) {
      res.status(400).json({ error: 'Movie and report reason are required.' });
      return;
    }

    const report: BrokenLinkReport = {
      id: `rep-${randomUUID().slice(0, 8)}`,
      movieId,
      movieTitle,
      reason,
      ...(details ? { details } : {}),
      reportedBy,
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    db.brokenLinkReports.unshift(report);
    if (db.brokenLinkReports.length > 100) {
      db.brokenLinkReports = db.brokenLinkReports.slice(0, 100);
    }
    saveDatabase(db);
    res.status(201).json({ report });
  });

  app.patch('/api/reports/:id', requireAdmin, (req, res) => {
    const report = db.brokenLinkReports.find((r) => r.id === req.params.id);
    if (!report) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }
    report.status = req.body?.status === 'open' ? 'open' : 'resolved';
    saveDatabase(db);
    res.json({ report });
  });

  function getGeminiClient(apiVersion?: 'v1' | 'v1beta'): GoogleGenAI | null {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    return new GoogleGenAI({
      apiKey,
      ...(apiVersion ? { apiVersion } : {}),
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  function extractGeminiError(err: unknown): { status: number; message: string } {
    const rawMsg = err instanceof Error ? err.message : String(err || 'Gemini request failed.');
    let parsedCode: number | undefined;
    let parsedStatus = '';
    let parsedMessage = rawMsg;

    const jsonStart = rawMsg.indexOf('{');
    if (jsonStart !== -1) {
      try {
        const parsed = JSON.parse(rawMsg.slice(jsonStart)) as {
          error?: { code?: number; message?: string; status?: string };
        };
        if (parsed?.error) {
          parsedCode = parsed.error.code;
          parsedStatus = parsed.error.status || '';
          if (parsed.error.message) {
            parsedMessage = parsed.error.message;
          }
        }
      } catch {
        // Not valid JSON payload
      }
    }

    const errStatus =
      typeof (err as { status?: number })?.status === 'number'
        ? (err as { status: number }).status
        : parsedCode;

    if (
      errStatus === 429 ||
      parsedStatus === 'RESOURCE_EXHAUSTED' ||
      /RESOURCE_EXHAUSTED|quota exceeded/i.test(rawMsg)
    ) {
      return {
        status: 429,
        message:
          'Gemini API quota exceeded for the current project key. Please check your Gemini API billing/quota in Settings > Secrets and try again.',
      };
    }

    if (
      errStatus === 403 ||
      parsedStatus === 'PERMISSION_DENIED' ||
      /API_KEY_INVALID|permission/i.test(rawMsg)
    ) {
      return {
        status: 403,
        message:
          'Gemini API key does not have permission or is invalid. Verify GEMINI_API_KEY in Settings > Secrets.',
      };
    }

    if (errStatus === 404 || parsedStatus === 'NOT_FOUND') {
      return { status: 404, message: parsedMessage };
    }

    return {
      status: errStatus && errStatus >= 400 && errStatus < 600 ? errStatus : 502,
      message: parsedMessage.slice(0, 320),
    };
  }

  const audioUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  const AUDIO_EXT_MIME_MAP: Record<string, string> = {
    '.mp3': 'audio/mp3',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.flac': 'audio/flac',
    '.webm': 'audio/webm',
    '.weba': 'audio/webm',
  };

  const GEMINI_NATIVE_AUDIO_MIMES = new Set([
    'audio/mp3',
    'audio/mpeg',
    'audio/wav',
    'audio/aac',
    'audio/ogg',
    'audio/flac',
    'audio/webm',
    'audio/mp4',
  ]);

  function resolveAudioMimeType(rawMime: string | undefined, fileName: string | undefined): string {
    const clean = (rawMime || '').split(';')[0].trim().toLowerCase();
    const aliasMap: Record<string, string> = {
      'audio/mpeg': 'audio/mp3',
      'audio/mp3': 'audio/mp3',
      'audio/x-mpeg': 'audio/mp3',
      'audio/x-wav': 'audio/wav',
      'audio/wave': 'audio/wav',
      'audio/vnd.wave': 'audio/wav',
      'audio/x-m4a': 'audio/mp4',
      'audio/m4a': 'audio/mp4',
      'video/mp4': 'audio/mp4',
      'audio/x-aac': 'audio/aac',
      'audio/opus': 'audio/ogg',
      'video/ogg': 'audio/ogg',
      'video/webm': 'audio/webm',
      'audio/x-flac': 'audio/flac',
    };
    if (clean && aliasMap[clean]) return aliasMap[clean];
    if (clean && clean.startsWith('audio/') && GEMINI_NATIVE_AUDIO_MIMES.has(clean)) {
      return clean;
    }
    const ext = path.extname(fileName || '').toLowerCase();
    if (ext && AUDIO_EXT_MIME_MAP[ext]) {
      return AUDIO_EXT_MIME_MAP[ext];
    }
    if (clean && clean.startsWith('audio/')) return clean;
    return 'application/octet-stream';
  }

  async function transcodeAudioBufferToMp3(inputBuffer: Buffer, fileName: string): Promise<Buffer> {
    const ext = path.extname(fileName || '') || '.bin';
    const id = randomUUID();
    const inPath = path.join('/tmp', `transcribe-in-${id}${ext}`);
    const outPath = path.join('/tmp', `transcribe-out-${id}.mp3`);
    try {
      fs.writeFileSync(inPath, inputBuffer);
      await execFileAsync('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-i',
        inPath,
        '-vn',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-b:a',
        '64k',
        outPath,
      ]);
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        return fs.readFileSync(outPath);
      }
      throw new Error('Normalized audio output was empty.');
    } finally {
      if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    }
  }

  app.get('/api/maps-config', (_req, res) => {
    res.json({
      apiKey: process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '',
    });
  });

  app.post('/api/ai/chat', async (req, res) => {
    const aiV1 = getGeminiClient();
    const aiBeta = getGeminiClient('v1beta');
    if (!aiV1 || !aiBeta) {
      res.status(503).json({
        error: 'Gemini API key is not configured on the server yet. Please check Settings > Secrets.',
      });
      return;
    }

    const message = String(req.body?.message || '').trim().slice(0, 4000);
    if (!message) {
      res.status(400).json({ error: 'Please enter a message.' });
      return;
    }

    const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
    for (const item of rawHistory.slice(-12)) {
      if (
        item &&
        (item.role === 'user' || item.role === 'model') &&
        typeof item.text === 'string' &&
        item.text.trim()
      ) {
        contents.push({
          role: item.role,
          parts: [{ text: item.text.trim().slice(0, 4000) }],
        });
      }
    }
    contents.push({ role: 'user', parts: [{ text: message }] });

    const vaultSummary = db.movies
      .slice(0, 20)
      .map((m) => `${m.title} (${m.year}, ${m.genre}, Dir. ${m.director})`)
      .join('; ');

    const systemInstruction =
      `You are the Temple Cinema Concierge on templesolosmovies.com. Answer film, music, box-office, cast, cinema history, chess strategy, and movie-vault questions concisely and accurately, citing live web facts from Google Search when available. Current Temple Cinema vault highlights: ${vaultSummary}.`;

    const attempts: Array<{
      client: GoogleGenAI;
      model: string;
      useSearch: boolean;
    }> = [
      { client: aiV1, model: 'gemini-4-hydrogen', useSearch: true },
      { client: aiV1, model: 'gemini-4-hydrogen', useSearch: false },
      { client: aiBeta, model: 'gemini-3.1-flash-lite', useSearch: false },
    ];

    let lastErr: unknown = null;
    for (const attempt of attempts) {
      try {
        const response = await attempt.client.models.generateContent({
          model: attempt.model,
          contents,
          config: {
            systemInstruction,
            ...(attempt.useSearch ? { tools: [{ googleSearch: {} }] } : {}),
          },
        });

        const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
        const seenUris = new Set<string>();
        const sources: Array<{ title: string; uri: string }> = [];
        for (const chunk of chunks) {
          const uri = chunk?.web?.uri;
          const title = chunk?.web?.title;
          if (uri && !seenUris.has(uri)) {
            seenUris.add(uri);
            sources.push({
              title: title || uri,
              uri,
            });
          }
        }

        res.json({
          reply: response.text || 'I could not generate a response for that query.',
          sources,
        });
        return;
      } catch (err) {
        lastErr = err;
        const parsed = extractGeminiError(err);
        // Stop retrying only on invalid key / permission errors
        if (parsed.status === 403) {
          break;
        }
      }
    }

    console.error('Gemini Search Chat error:', lastErr);
    const extracted = extractGeminiError(lastErr);
    res.status(extracted.status).json({ error: extracted.message });
  });

  app.post('/api/ai/transcribe', audioUpload.single('audio'), async (req, res) => {
    const aiV1 = getGeminiClient();
    const aiBeta = getGeminiClient('v1beta');
    if (!aiBeta && !aiV1) {
      res.status(503).json({
        error: 'Gemini API key is not configured on the server yet. Please check Settings > Secrets.',
      });
      return;
    }

    let rawBuffer: Buffer | null = null;
    let rawMimeType = 'audio/webm';
    let originalName = 'audio-clip.webm';

    if (req.file) {
      rawBuffer = req.file.buffer;
      rawMimeType = req.file.mimetype || 'audio/webm';
      originalName = req.file.originalname || 'audio-clip.webm';
    } else if (typeof req.body?.audioBase64 === 'string' && req.body.audioBase64.trim()) {
      const cleanedB64 = req.body.audioBase64.trim().replace(/^data:[^;]+;base64,/, '');
      rawBuffer = Buffer.from(cleanedB64, 'base64');
      rawMimeType = typeof req.body.mimeType === 'string' ? req.body.mimeType : 'audio/webm';
      originalName = typeof req.body.fileName === 'string' ? req.body.fileName : 'audio-clip.webm';
    }

    if (!rawBuffer || rawBuffer.length === 0) {
      res.status(400).json({ error: 'Please upload or record an audio clip to transcribe.' });
      return;
    }

    let resolvedMime = resolveAudioMimeType(rawMimeType, originalName);
    let payloadBuffer = rawBuffer;
    const extLower = path.extname(originalName).toLowerCase();
    const needsTranscode =
      payloadBuffer.length > 8 * 1024 * 1024 ||
      !GEMINI_NATIVE_AUDIO_MIMES.has(resolvedMime) ||
      ['.wma', '.amr', '.3gp', '.mkv', '.mov', '.avi'].includes(extLower);

    if (needsTranscode) {
      try {
        payloadBuffer = await transcodeAudioBufferToMp3(rawBuffer, originalName);
        resolvedMime = 'audio/mp3';
      } catch (ffmpegErr) {
        if (!GEMINI_NATIVE_AUDIO_MIMES.has(resolvedMime)) {
          res.status(400).json({
            error:
              ffmpegErr instanceof Error
                ? `Unsupported audio format (${resolvedMime}): ${ffmpegErr.message}`
                : 'Unsupported or unreadable audio file.',
          });
          return;
        }
      }
    }

    const base64Audio = payloadBuffer.toString('base64');
    const promptText =
      typeof req.body?.prompt === 'string' && req.body.prompt.trim()
        ? req.body.prompt.trim().slice(0, 500)
        : 'Transcribe this audio accurately, preserving punctuation and speaker turns if discernible.';

    const clients = [aiBeta, aiV1].filter((c): c is GoogleGenAI => Boolean(c));
    const transcribeModels = ['gemini-3.5-transcribe', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
    let lastErr: unknown = null;

    for (const model of transcribeModels) {
      for (const client of clients) {
        try {
          const response = await client.models.generateContent({
            model,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: resolvedMime,
                    data: base64Audio,
                  },
                },
                { text: promptText },
              ],
            },
          });

          res.json({
            transcript: response.text || '',
            model,
          });
          return;
        } catch (err) {
          lastErr = err;
          const parsed = extractGeminiError(err);
          if (parsed.status === 403) {
            break;
          }
        }
      }
    }

    console.error('Gemini Audio Transcription error:', lastErr);
    const extracted = extractGeminiError(lastErr);
    res.status(extracted.status).json({ error: extracted.message });
  });

  const ALLOWED_LIVE_VOICES = new Set(['Zephyr', 'Kore', 'Puck', 'Charon', 'Fenrir']);

  liveWss.on('connection', async (clientWs, req) => {
    const ai = getGeminiClient('v1beta');
    if (!ai) {
      clientWs.send(
        JSON.stringify({
          type: 'error',
          message: 'Gemini API key is not configured on the server yet.',
        })
      );
      clientWs.close();
      return;
    }

    let requestedVoice = 'Zephyr';
    try {
      const url = new URL(req.url || '/ws/live', 'http://localhost');
      const v = url.searchParams.get('voice');
      if (v && ALLOWED_LIVE_VOICES.has(v)) {
        requestedVoice = v;
      }
    } catch {
      // keep default
    }

    let closed = false;
    let liveSession: Awaited<ReturnType<typeof ai.live.connect>> | null = null;

    try {
      liveSession = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: requestedVoice },
            },
          },
          systemInstruction:
            'You are a friendly, expressive cinema host and trivia companion on templesolosmovies.com. Keep spoken replies conversational, clear, and concise.',
        },
        callbacks: {
          onopen: () => {
            if (!closed && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: 'ready', voice: requestedVoice }));
            }
          },
          onmessage: (message: LiveServerMessage) => {
            if (closed || clientWs.readyState !== WebSocket.OPEN) return;
            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              clientWs.send(
                JSON.stringify({
                  type: 'input_transcript',
                  text: content.inputTranscription.text,
                })
              );
            }
            if (content?.outputTranscription?.text) {
              clientWs.send(
                JSON.stringify({
                  type: 'output_transcript',
                  text: content.outputTranscription.text,
                })
              );
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(
                  JSON.stringify({
                    type: 'audio',
                    data: part.inlineData.data,
                  })
                );
              }
            }
            if (content?.interrupted) {
              clientWs.send(JSON.stringify({ type: 'interrupted' }));
            }
            if (content?.turnComplete) {
              clientWs.send(JSON.stringify({ type: 'turn_complete' }));
            }
          },
          onerror: (err) => {
            console.error('Gemini Live session error:', err);
            const extracted = extractGeminiError(
              (err as { error?: unknown })?.error ?? (err as { message?: string })?.message ?? err
            );
            if (!closed && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(
                JSON.stringify({
                  type: 'error',
                  message: extracted.message || 'Live voice session encountered a connection error.',
                })
              );
            }
          },
          onclose: (event) => {
            if (!closed && clientWs.readyState === WebSocket.OPEN) {
              const reason = (event as { reason?: string })?.reason;
              if (reason && /quota|resource_exhausted|permission|not found|unsupported/i.test(reason)) {
                clientWs.send(
                  JSON.stringify({
                    type: 'error',
                    message: extractGeminiError(reason).message,
                  })
                );
              }
              clientWs.send(JSON.stringify({ type: 'closed' }));
              clientWs.close();
            }
          },
        },
      });
    } catch (err) {
      console.error('Failed to start Gemini Live session:', err);
      const extracted = extractGeminiError(err);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            type: 'error',
            message: extracted.message || 'Unable to start live voice session.',
          })
        );
        clientWs.close();
      }
      return;
    }

    clientWs.on('message', (raw) => {
      if (closed || !liveSession) return;
      try {
        const msg = JSON.parse(raw.toString()) as { audio?: string; text?: string };
        if (typeof msg.audio === 'string' && msg.audio.length > 0) {
          liveSession.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (typeof msg.text === 'string' && msg.text.trim()) {
          liveSession.sendRealtimeInput({
            text: msg.text.trim().slice(0, 1000),
          });
        }
      } catch {
        // Ignore malformed client audio packets
      }
    });

    clientWs.on('close', () => {
      closed = true;
      try {
        liveSession?.close();
      } catch {
        // Ignore cleanup errors
      }
      liveSession = null;
    });
  });

  function sanitizePdfAscii(text: string): string {
    return text.replace(/[^\x20-\x7E]/g, '-');
  }

  function escapePdfText(text: string): string {
    return sanitizePdfAscii(text)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  function wrapLines(text: string, maxChars = 88): string[] {
    const clean = sanitizePdfAscii(text).trim();
    if (!clean) return [''];
    const words = clean.split(/\s+/);
    const out: string[] = [];
    let current = '';
    for (const word of words) {
      if (!current) {
        current = word;
      } else if (current.length + 1 + word.length <= maxChars) {
        current += ` ${word}`;
      } else {
        out.push(current);
        current = word;
      }
    }
    if (current) out.push(current);
    return out;
  }

  interface PdfLine {
    text: string;
    bold?: boolean;
    size?: number;
    gap?: number;
  }

  function buildHostingGuidePdf(lines: PdfLine[]): Buffer {
    const pageHeight = 792;
    const marginTop = 742;
    const marginBottom = 54;
    const marginLeft = 48;

    const pages: string[][] = [];
    let currentCommands: string[] = [];
    let y = marginTop;

    const pushPage = () => {
      if (currentCommands.length > 0) {
        pages.push(currentCommands);
        currentCommands = [];
      }
      y = marginTop;
    };

    for (const entry of lines) {
      const size = entry.size ?? 10;
      const lineHeight = size + 5;
      const maxChars = size >= 14 ? 64 : size >= 11 ? 82 : 90;
      const wrapped = entry.text === '' ? [''] : wrapLines(entry.text, maxChars);

      for (const line of wrapped) {
        if (y - lineHeight < marginBottom) {
          pushPage();
        }
        if (line !== '') {
          const fontKey = entry.bold ? '/F2' : '/F1';
          currentCommands.push(
            `BT ${fontKey} ${size} Tf 1 0 0 1 ${marginLeft} ${y} Tm (${escapePdfText(line)}) Tj ET`
          );
        }
        y -= lineHeight;
      }
      if (entry.gap) {
        y -= entry.gap;
      }
    }
    pushPage();

    const objects: string[] = [];
    // 1 = Catalog, 2 = Pages, 3 = F1 Helvetica, 4 = F2 Helvetica-Bold
    objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    const pageIds: number[] = [];
    const startObjNum = 5;
    for (let i = 0; i < pages.length; i++) {
      pageIds.push(startObjNum + i * 2);
    }
    objects.push(
      `2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`
    );
    objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
    objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');

    pages.forEach((cmds, idx) => {
      const pageObjNum = startObjNum + idx * 2;
      const contentObjNum = pageObjNum + 1;
      const streamBody = cmds.join('\n');
      const streamLen = Buffer.byteLength(streamBody, 'utf8');
      objects.push(
        `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjNum} 0 R >>\nendobj\n`
      );
      objects.push(
        `${contentObjNum} 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamBody}\nendstream\nendobj\n`
      );
    });

    const header = '%PDF-1.4\n';
    let byteOffset = Buffer.byteLength(header, 'utf8');
    const offsets: number[] = [];
    for (const obj of objects) {
      offsets.push(byteOffset);
      byteOffset += Buffer.byteLength(obj, 'utf8');
    }

    const xrefStart = byteOffset;
    const totalObjs = objects.length + 1;
    let xref = `xref\n0 ${totalObjs}\n0000000000 65535 f \n`;
    for (const off of offsets) {
      xref += `${String(off).padStart(10, '0')} 00000 n \n`;
    }
    const trailer = `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

    return Buffer.from(header + objects.join('') + xref + trailer, 'utf8');
  }

  app.get('/api/admin/hosting-guide.pdf', requireAdmin, (_req, res) => {
    const cfg = getFirebaseConfig();
    const totalDownloads = db.movies.reduce((sum, m) => sum + m.downloads, 0);

    const lines: PdfLine[] = [
      { text: 'templesolosmovies.com - Website Architecture, Hosting & App Data', bold: true, size: 16, gap: 4 },
      { text: `Generated: ${new Date().toISOString()}   |   Admin: ${ADMIN_EMAIL}`, size: 9, gap: 10 },

      { text: '1. OVERVIEW & TECH STACK', bold: true, size: 12, gap: 3 },
      { text: '- Frontend: React 19 + TypeScript + Vite 8 + Tailwind CSS v4 + PWA (vite-plugin-pwa)' },
      { text: '- Backend Server: Node.js v22 + Express 4 + WebSocket (ws) + Multer + FFmpeg' },
      { text: '- Auth & Database: Firebase Authentication (Google + Email/Password) & Cloud Firestore' },
      { text: '- Persistent Movie Storage: ./storage/movies (MP4/MKV/WEBM/MOV), ./storage/posters, ./storage/db.json', gap: 8 },

      { text: '2. HOW TO SELF-HOST ON ANY VPS, CLOUD RUN, RENDER, OR RAILWAY', bold: true, size: 12, gap: 3 },
      { text: 'Step 1: Export or clone the complete project folder (via AI Studio Download App / GitHub).' },
      { text: 'Step 2: Ensure Node.js 22+ and ffmpeg are installed on the target host.' },
      { text: 'Step 3: Configure environment variables (.env):' },
      { text: '   PORT=3000' },
      { text: `   ADMIN_EMAIL=${ADMIN_EMAIL}` },
      { text: '   NODE_ENV=production' },
      { text: 'Step 4: Install dependencies and build the production frontend + PWA service worker:' },
      { text: '   npm install' },
      { text: '   npm run build' },
      { text: 'Step 5: Start the full-stack server (serves dist/, /api/*, /storage/*, and /ws):' },
      { text: '   npm start   (runs: node server.ts)' },
      { text: 'Step 6: Mount persistent disk volume on ./storage so uploaded movies and db.json survive restarts.' },
      { text: 'Step 7: In Firebase Console -> Authentication -> Settings -> Authorized Domains, add your custom domain (e.g. templesolosmovies.com).', gap: 8 },

      { text: '3. FIREBASE PROJECT & FIRESTORE COLLECTIONS', bold: true, size: 12, gap: 3 },
      { text: `- Firebase Project ID: ${cfg.projectId || 'configured-in-firebase-applet-config.json'}` },
      { text: `- Auth Domain: ${cfg.authDomain || 'configured-in-firebase-applet-config.json'}` },
      { text: `- Firestore Database ID: ${cfg.firestoreDatabaseId || '(default)'}` },
      { text: '- Collections secured by firestore.rules:' },
      { text: '   * /users/{userId}/public/profile (uid, displayName, favoriteGenre, createdAt, updatedAt)' },
      { text: '   * /users/{userId}/private/account (uid, email, createdAt, updatedAt - owner/admin only)' },
      { text: '   * /users/{userId}/savedMovies/{movieId} (personal watchlist bookmarks)' },
      { text: '   * /movieRatings/{ratingId} (1-5 star user ratings; ratingId = movieId__userId)' },
      { text: '   * /admins/{userId} (admin role registry; deploy rules via: firebase deploy --only firestore:rules)', gap: 8 },

      { text: '4. ROLE-BASED ACCESS CONTROL & API ENDPOINTS', bold: true, size: 12, gap: 3 },
      { text: '- GET /api/movies -> Public catalog JSON' },
      { text: '- GET /api/movies/:id/download -> Direct file download + increments download counter' },
      { text: '- GET /api/chat/messages -> Recent community lounge messages (rooms: general, requests, drops)' },
      { text: '- WS /ws -> Real-time chat, presence, and live catalog updates' },
      { text: '- POST /api/movies -> ADMIN ONLY (requires Firebase Bearer token for admin email or /admins/{uid})' },
      { text: '- PATCH /api/movies/:id -> ADMIN ONLY (edit movie title, genre, quality, director, synopsis)' },
      { text: '- DELETE /api/movies/:id -> ADMIN ONLY (remove movie and delete non-seeded files)' },
      { text: '- GET /api/admin/hosting-guide.pdf -> ADMIN ONLY (exports this PDF)', gap: 8 },

      { text: `5. CURRENT MOVIE CATALOG DATA (${db.movies.length} Titles | ${totalDownloads} Total Downloads)`, bold: true, size: 12, gap: 3 },
    ];

    db.movies.forEach((m, index) => {
      const sizeMb = (m.fileSizeBytes / (1024 * 1024)).toFixed(2);
      lines.push({
        text: `${index + 1}. ${m.title} (${m.year}) - ${m.genre} | ${m.quality} | ${m.duration} | Dir: ${m.director}`,
        bold: true,
        size: 10,
      });
      lines.push({
        text: `   ID: ${m.id} | File: ${m.fileName} (${sizeMb} MB) | Downloads: ${m.downloads} | Video: ${m.videoUrl}`,
        size: 9,
      });
      lines.push({
        text: `   Synopsis: ${m.synopsis}`,
        size: 9,
        gap: 4,
      });
    });

    lines.push({ text: '', gap: 4 });
    lines.push({ text: `6. RECENT COMMUNITY CHAT SNAPSHOT (${db.messages.length} Stored Messages)`, bold: true, size: 12, gap: 3 });
    db.messages.slice(-15).forEach((msg) => {
      lines.push({
        text: `[${msg.room}] ${msg.username} (${msg.timestamp}): ${msg.text}`,
        size: 9,
      });
    });

    const pdfBuffer = buildHostingGuidePdf(lines);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="templesolosmovies-hosting-and-data.pdf"'
    );
    res.setHeader('Content-Length', String(pdfBuffer.length));
    res.send(pdfBuffer);
  });

  app.get('/api/app-zip', async (_req, res) => {
    const tmpZipPath = path.join('/tmp', `templesolosmovies-app-${randomUUID()}.zip`);
    const pythonScript = `
import os, sys, zipfile

root_dir = sys.argv[1]
out_zip = sys.argv[2]
exclude_dirs = {'node_modules', 'dist', '.git', '.next', '.cache', '.gmp_cache', '__pycache__'}
exclude_files = {'.env', '.env.local', '.env.production'}

with zipfile.ZipFile(out_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
    for current_root, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        for fname in files:
            if fname in exclude_files or fname.endswith('.zip') or fname.endswith('.tmp.mp4'):
                continue
            full_path = os.path.join(current_root, fname)
            rel_path = os.path.relpath(full_path, root_dir)
            zf.write(full_path, arcname=os.path.join('templesolosmovies-app', rel_path))
`;
    try {
      await execFileAsync('python3', ['-c', pythonScript, ROOT_DIR, tmpZipPath]);
      res.download(tmpZipPath, 'templesolosmovies-app.zip', () => {
        if (fs.existsSync(tmpZipPath)) {
          fs.unlink(tmpZipPath, () => {});
        }
      });
    } catch (err) {
      console.error('Failed to build app zip:', err);
      if (fs.existsSync(tmpZipPath)) {
        fs.unlinkSync(tmpZipPath);
      }
      res.status(500).json({ error: 'Could not generate app zip archive.' });
    }
  });

  // Guarantee every /api/* route returns JSON (never HTML fallback or Multer HTML error pages)
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use(
    '/api',
    (
      err: Error & { code?: string; status?: number; statusCode?: number },
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error(`[API Error] ${req.method} ${req.originalUrl}:`, err);
      if (res.headersSent) return;

      let status = err.status || err.statusCode || 500;
      let message = err.message || 'Internal server error.';

      if (err.code === 'LIMIT_FILE_SIZE') {
        status = 413;
        message = 'File is too large for this endpoint (max 2 GB for videos).';
      } else if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_PART_COUNT' || err.code === 'LIMIT_FIELD_COUNT') {
        status = 400;
        message = 'Unexpected or malformed multipart upload form fields.';
      } else if (err.code === 'EACCES' || err.code === 'EROFS') {
        status = 500;
        message = 'Upload storage directory is not writable (permission denied).';
      } else if (err.code === 'ENOSPC') {
        status = 507;
        message = 'Server storage disk is full. Free space before uploading.';
      } else if (err.name === 'MulterError') {
        status = 400;
      } else if (err instanceof SyntaxError && 'body' in err) {
        status = 400;
        message = 'Invalid JSON request payload.';
      }

      res.status(status).json({ error: message });
    }
  );

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const isHmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: { server, path: '/vite-hmr' },
        watch: isHmrDisabled ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(ROOT_DIR, 'dist');
    app.use('/assets', express.static(path.join(distDir, 'assets'), { maxAge: '30d', immutable: true }));
    app.use('/assets', (_req, res) => {
      res.status(404).end();
    });
    app.use(
      express.static(distDir, {
        maxAge: '1h',
        etag: true,
        setHeaders: (res, filePath) => {
          const base = path.basename(filePath);
          if (
            base === 'index.html' ||
            base === 'sw.js' ||
            base === 'manifest.webmanifest' ||
            base === 'manifest.json'
          ) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          }
        },
      })
    );
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/__')) {
        res.status(404).end();
        return;
      }
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`templesolosmovies.com running on http://localhost:${PORT}`);
    // Generate starter preview MP4 clips asynchronously without delaying port 3000 binding
    void seedStarterVideosInBackground(db);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
