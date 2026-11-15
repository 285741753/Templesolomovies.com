import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  ChatMessage,
  ChatRoomId,
  ClientWsEvent,
  Movie,
  MovieGenre,
  MovieQuality,
  OnlineUser,
  ServerWsEvent,
  UpcomingMovie,
} from './src/types/cinema.ts';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = process.cwd();
const STORAGE_DIR = path.join(ROOT_DIR, 'storage');
const MOVIES_DIR = path.join(STORAGE_DIR, 'movies');
const POSTERS_DIR = path.join(STORAGE_DIR, 'posters');
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
    if (!resp.ok) return null;
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
  } catch {
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
  } catch {
    return false;
  }
}

function ensureDirectories() {
  for (const dir of [STORAGE_DIR, MOVIES_DIR, POSTERS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function loadDatabase(): DatabaseState {
  if (fs.existsSync(DB_PATH)) {
    try {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<DatabaseState>;
      return {
        movies: Array.isArray(parsed.movies) ? parsed.movies : [],
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        upcomingMovies: Array.isArray(parsed.upcomingMovies) ? parsed.upcomingMovies : [],
        releaseSubscriptions: Array.isArray(parsed.releaseSubscriptions)
          ? parsed.releaseSubscriptions
          : [],
      };
    } catch {
      // Fall back to fresh seed if JSON is corrupted
    }
  }
  return { movies: [], messages: [], upcomingMovies: [], releaseSubscriptions: [] };
}

function saveDatabase(state: DatabaseState) {
  const tempPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tempPath, DB_PATH);
}

interface SeedMovieSpec {
  id: string;
  title: string;
  genre: MovieGenre;
  year: number;
  duration: string;
  quality: MovieQuality;
  director: string;
  uploader: string;
  synopsis: string;
  sourcePosterFile: string;
  sourceBackdropFile?: string;
  posterTargetName: string;
  backdropTargetName?: string;
  videoFileName: string;
  downloads: number;
  featured: boolean;
  createdAt: string;
}

const SEED_SPECS: SeedMovieSpec[] = [
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
    sourcePosterFile: 'hero_midnight_meridian_1794734028437.jpg',
    sourceBackdropFile: 'hero_midnight_meridian_1794734028437.jpg',
    posterTargetName: 'midnight_meridian_poster.jpg',
    backdropTargetName: 'midnight_meridian_backdrop.jpg',
    videoFileName: 'the-midnight-meridian-4k.mp4',
    downloads: 1428,
    featured: true,
    createdAt: '2026-11-10T18:00:00.000Z',
  },
  {
    id: 'movie-orbital-drift',
    title: 'Orbital Drift',
    genre: 'Sci-Fi',
    year: 2026,
    duration: '2h 28m',
    quality: '4K UHD',
    director: 'Elena Rostova',
    uploader: 'TempleSolo',
    synopsis:
      'Cut off from deep-space telemetry beyond Saturn’s outer ring, a lone salvage pilot must manually dock with a silent relay station before solar wind tears the orbit apart.',
    sourcePosterFile: 'poster_orbital_drift_1794734028947.jpg',
    posterTargetName: 'orbital_drift_poster.jpg',
    videoFileName: 'orbital-drift-4k.mp4',
    downloads: 1194,
    featured: false,
    createdAt: '2026-11-11T14:30:00.000Z',
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
    sourcePosterFile: 'poster_velvet_echo_1794734030259.jpg',
    posterTargetName: 'velvet_echo_poster.jpg',
    videoFileName: 'velvet-echo-1080p.mp4',
    downloads: 742,
    featured: false,
    createdAt: '2026-11-13T16:45:00.000Z',
  },
  {
    id: 'movie-iron-horizon',
    title: 'Iron Horizon',
    genre: 'Action',
    year: 2025,
    duration: '2h 06m',
    quality: '4K UHD',
    director: 'Devon Kade',
    uploader: 'TempleSolo',
    synopsis:
      'Tasked with escorting a geothermal core across four hundred miles of electrified salt flats, an armored convoy must outrun a supercell storm and rival scavengers.',
    sourcePosterFile: 'poster_iron_horizon_1794734030987.jpg',
    posterTargetName: 'iron_horizon_poster.jpg',
    videoFileName: 'iron-horizon-4k.mp4',
    downloads: 963,
    featured: false,
    createdAt: '2026-11-14T11:20:00.000Z',
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

  if (db.movies.length === 0) {
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

      const videoPath = path.join(MOVIES_DIR, spec.videoFileName);
      const fileSizeBytes = fs.existsSync(videoPath) ? fs.statSync(videoPath).size : 524323;

      db.movies.push({
        id: spec.id,
        title: spec.title,
        genre: spec.genre,
        year: spec.year,
        duration: spec.duration,
        quality: spec.quality,
        director: spec.director,
        uploader: spec.uploader,
        synopsis: spec.synopsis,
        posterUrl: `/storage/posters/${spec.posterTargetName}`,
        backdropUrl,
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
  'Thriller',
  'Sci-Fi',
  'Drama',
  'Action',
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

async function startServer() {
  ensureDirectories();
  const db = seedMetadataFast(loadDatabase());

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Serve public assets (favicon / app icon) and uploaded/seeded media
  if (fs.existsSync(PUBLIC_DIR)) {
    app.use(express.static(PUBLIC_DIR));
  }
  app.use('/storage/posters', express.static(POSTERS_DIR));
  app.use('/storage/movies', express.static(MOVIES_DIR));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    try {
      const pathname = new URL(req.url || '/', 'http://localhost').pathname;
      if (pathname === '/ws') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      }
    } catch {
      socket.destroy();
    }
  });

  interface ConnectedClient {
    ws: WebSocket;
    userId: string;
    username: string;
    room: ChatRoomId;
  }

  const clients = new Map<WebSocket, ConnectedClient>();

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
          broadcast({ type: 'presence:update', onlineUsers: getOnlineUsers() });
        } else if (data.type === 'user:rename') {
          const nextName = String(data.username || '').trim().slice(0, 32);
          if (nextName) {
            client.username = nextName;
            broadcast({ type: 'presence:update', onlineUsers: getOnlineUsers() });
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
          };

          db.messages.push(message);
          if (db.messages.length > 500) {
            db.messages = db.messages.slice(-500);
          }
          saveDatabase(db);
          broadcast({ type: 'chat:message', message });
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      broadcast({ type: 'presence:update', onlineUsers: getOnlineUsers() });
    });
  });

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
      fileSize: 2 * 1024 * 1024 * 1024,
    },
  });

  const requireAdmin: express.RequestHandler = async (req, res, next) => {
    const verifiedUser = await verifyFirebaseIdToken(req.headers.authorization);
    if (!verifiedUser) {
      res.status(401).json({ error: 'Administrator authentication is required.' });
      return;
    }
    const admin = await isAdminUser(verifiedUser);
    if (!admin) {
      res.status(403).json({
        error: 'Only the administrator can upload, edit, or remove movies.',
      });
      return;
    }
    res.locals.verifiedUser = verifiedUser;
    next();
  };

  app.get('/api/movies', (_req, res) => {
    res.json({ movies: db.movies });
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
          res.status(400).json({ error: 'Please select a movie video file to upload.' });
          return;
        }

        const title = String(req.body.title || '').trim();
        if (!title) {
          fs.unlinkSync(videoFile.path);
          if (posterFile) fs.unlinkSync(posterFile.path);
          res.status(400).json({ error: 'Movie title is required.' });
          return;
        }

        const rawGenre = String(req.body.genre || 'Drama') as MovieGenre;
        const genre: MovieGenre = VALID_GENRES.includes(rawGenre) ? rawGenre : 'Drama';
        const rawQuality = String(req.body.quality || '1080p HD') as MovieQuality;
        const quality: MovieQuality = VALID_QUALITIES.includes(rawQuality) ? rawQuality : '1080p HD';
        const year = Math.min(2030, Math.max(1900, Number(req.body.year) || new Date().getFullYear()));
        const duration = String(req.body.duration || '1h 45m').trim() || '1h 45m';
        const director = String(req.body.director || 'Independent').trim() || 'Independent';
        const uploader =
          verifiedUser?.displayName ||
          String(req.body.uploader || 'TempleSolo Admin').trim() ||
          'TempleSolo Admin';
        const synopsis =
          String(req.body.synopsis || '').trim() ||
          `${title} uploaded to templesolosmovies.com by ${uploader}. Ready for instant streaming preview and direct file download.`;

        let posterUrl = '/storage/posters/midnight_meridian_poster.jpg';
        if (posterFile) {
          posterUrl = `/storage/posters/${posterFile.filename}`;
        } else {
          const extractedPosterName = `poster-${Date.now()}.jpg`;
          const extractedPosterPath = path.join(POSTERS_DIR, extractedPosterName);
          try {
            await execFileAsync('ffmpeg', [
              '-y',
              '-ss',
              '00:00:01',
              '-i',
              videoFile.path,
              '-vframes',
              '1',
              '-q:v',
              '2',
              extractedPosterPath,
            ]);
            if (fs.existsSync(extractedPosterPath) && fs.statSync(extractedPosterPath).size > 0) {
              posterUrl = `/storage/posters/${extractedPosterName}`;
            }
          } catch {
            // Fallback silently
          }
        }

        const movie: Movie = {
          id: `movie-${randomUUID().slice(0, 8)}`,
          title,
          genre,
          year,
          duration,
          quality,
          director,
          uploader,
          synopsis,
          posterUrl,
          videoUrl: `/storage/movies/${videoFile.filename}`,
          fileName: videoFile.originalname || videoFile.filename,
          fileSizeBytes: videoFile.size,
          mimeType: videoFile.mimetype || 'video/mp4',
          downloads: 0,
          featured: Boolean(req.body.featured === 'true'),
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

        res.status(201).json({ movie });
      } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: 'Failed to process movie upload.' });
      }
    }
  );

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

    movie.downloads += 1;
    saveDatabase(db);
    broadcast({
      type: 'movie:download_updated',
      movieId: movie.id,
      downloads: movie.downloads,
    });

    const downloadName = sanitizeFilename(movie.fileName || `${movie.title}.mp4`);
    res.download(fullPath, downloadName);
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

  app.get('/api/upcoming', (_req, res) => {
    const sorted = [...db.upcomingMovies]
      .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))
      .map(toPublicUpcoming);
    res.json({ upcoming: sorted });
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
    (req, res) => {
      const title = String(req.body?.title || '').trim().slice(0, 140);
      if (!title) {
        if (req.file) fs.unlinkSync(req.file.path);
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

      const posterUrl = req.file
        ? `/storage/posters/${req.file.filename}`
        : '/storage/posters/upcoming_glass_monsoon.jpg';

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
exclude_dirs = {'node_modules', 'dist', '.git', '.next', '.cache', '__pycache__'}
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
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
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
