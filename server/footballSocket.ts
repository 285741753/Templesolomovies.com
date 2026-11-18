import fs from 'fs';
import path from 'path';
import type http from 'http';
import type express from 'express';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import {
  createRandomFreeKickSpot,
  getKeeperDivePlan,
  getPenaltySpot,
  sanitizeShotInput,
  simulateKick,
} from '../src/games/football/physics.ts';
import type {
  FootballGameMode,
  FootballLeaderboardEntry,
  FootballPlayerProfile,
  FreeKickSpot,
  KeeperDiveDirection,
  OnlineMatchRoomState,
  OnlinePlayerState,
  ShotInput,
} from '../src/games/football/types.ts';

interface InternalRoom extends OnlineMatchRoomState {
  turnId: number;
  pendingShot: ShotInput | null;
  pendingDive: KeeperDiveDirection | null;
  turnTimer: ReturnType<typeof setTimeout> | null;
  advanceTimer: ReturnType<typeof setTimeout> | null;
  disconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
}

interface FootballStatsStore {
  profiles: Record<string, FootballPlayerProfile>;
}

const VALID_DIVES = new Set<KeeperDiveDirection>([
  'left',
  'up-left',
  'center',
  'up',
  'right',
  'up-right',
]);

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const TURN_DURATION_MS = 10_000;
const RECONNECT_WINDOW_MS = 30_000;
const POST_KICK_PAUSE_MS = 4_200;

function makeRoomCode(existing: Map<string, InternalRoom>): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    if (!existing.has(code)) return code;
  }
  return `T${Math.floor(100 + Math.random() * 899)}`;
}

function serializeRoom(room: InternalRoom): OnlineMatchRoomState {
  return {
    roomCode: room.roomCode,
    mode: room.mode,
    status: room.status,
    players: room.players.map((p) => ({ ...p, penaltyHistory: [...p.penaltyHistory] })),
    roundNumber: room.roundNumber,
    maxRounds: room.maxRounds,
    suddenDeath: room.suddenDeath,
    shooterIndex: room.shooterIndex,
    keeperIndex: room.keeperIndex,
    spot: { ...room.spot },
    turnDeadlineAt: room.turnDeadlineAt,
    shooterSubmitted: room.shooterSubmitted,
    keeperSubmitted: room.keeperSubmitted,
    winnerPlayerId: room.winnerPlayerId,
    winReason: room.winReason,
    lastResolution: room.lastResolution,
  };
}

export function attachFootballServer(
  app: express.Express,
  httpServer: http.Server,
  storageDir: string
): SocketIOServer {
  const statsPath = path.join(storageDir, 'football-leaderboard.json');

  const loadStats = (): FootballStatsStore => {
    try {
      if (fs.existsSync(statsPath)) {
        const parsed = JSON.parse(fs.readFileSync(statsPath, 'utf-8')) as FootballStatsStore;
        if (parsed && typeof parsed.profiles === 'object') {
          return parsed;
        }
      }
    } catch {
      // Fall back to fresh store
    }
    return {
      profiles: {
        'seed-temple-legend': {
          playerId: 'seed-temple-legend',
          name: 'Solo Striker',
          avatarId: 'crown-gold',
          wins: 14,
          losses: 3,
          goals: 58,
          saves: 24,
          bestFreeKickScore: 685,
          updatedAt: new Date().toISOString(),
        },
        'seed-golden-glove': {
          playerId: 'seed-golden-glove',
          name: 'Kofi Keeper',
          avatarId: 'titan-keeper',
          wins: 11,
          losses: 5,
          goals: 39,
          saves: 41,
          bestFreeKickScore: 540,
          updatedAt: new Date().toISOString(),
        },
        'seed-curler-9': {
          playerId: 'seed-curler-9',
          name: 'Amara Curve',
          avatarId: 'lion-crest',
          wins: 9,
          losses: 4,
          goals: 44,
          saves: 19,
          bestFreeKickScore: 620,
          updatedAt: new Date().toISOString(),
        },
      },
    };
  };

  let statsStore = loadStats();

  const saveStats = () => {
    try {
      const tmp = `${statsPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(statsStore, null, 2), 'utf-8');
      fs.renameSync(tmp, statsPath);
    } catch (err) {
      console.error('[Football Stats] Failed saving leaderboard:', err);
    }
  };

  const ensureProfile = (
    playerId: string,
    name?: string,
    avatarId?: string
  ): FootballPlayerProfile => {
    const cleanId = playerId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'guest';
    const existing = statsStore.profiles[cleanId];
    const cleanName = (name || existing?.name || 'Striker').trim().slice(0, 28) || 'Striker';
    const cleanAvatar = (avatarId || existing?.avatarId || 'crown-gold').slice(0, 32);

    const profile: FootballPlayerProfile = existing
      ? {
          ...existing,
          name: name ? cleanName : existing.name,
          avatarId: avatarId ? cleanAvatar : existing.avatarId,
          updatedAt: new Date().toISOString(),
        }
      : {
          playerId: cleanId,
          name: cleanName,
          avatarId: cleanAvatar,
          wins: 0,
          losses: 0,
          goals: 0,
          saves: 0,
          bestFreeKickScore: 0,
          updatedAt: new Date().toISOString(),
        };

    statsStore.profiles[cleanId] = profile;
    saveStats();
    return profile;
  };

  const getSortedLeaderboard = (): FootballLeaderboardEntry[] => {
    return Object.values(statsStore.profiles)
      .sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.goals !== a.goals) return b.goals - a.goals;
        return b.bestFreeKickScore - a.bestFreeKickScore;
      })
      .slice(0, 25);
  };

  // REST Endpoints
  app.get('/api/games/football/leaderboard', (_req, res) => {
    res.json({ leaderboard: getSortedLeaderboard() });
  });

  app.get('/api/games/football/profile/:playerId', (req, res) => {
    const profile = ensureProfile(req.params.playerId);
    res.json({ profile });
  });

  app.post('/api/games/football/profile', (req, res) => {
    const body = req.body as { playerId?: string; name?: string; avatarId?: string };
    if (!body?.playerId) {
      res.status(400).json({ error: 'playerId is required.' });
      return;
    }
    const profile = ensureProfile(body.playerId, body.name, body.avatarId);
    res.json({ profile, leaderboard: getSortedLeaderboard() });
  });

  app.post('/api/games/football/record-result', (req, res) => {
    const body = req.body as {
      playerId?: string;
      name?: string;
      avatarId?: string;
      won?: boolean;
      goals?: number;
      saves?: number;
      freeKickScore?: number;
    };
    if (!body?.playerId) {
      res.status(400).json({ error: 'playerId is required.' });
      return;
    }
    const profile = ensureProfile(body.playerId, body.name, body.avatarId);
    if (typeof body.won === 'boolean') {
      if (body.won) profile.wins += 1;
      else profile.losses += 1;
    }
    if (typeof body.goals === 'number' && body.goals > 0) {
      profile.goals += Math.min(25, Math.round(body.goals));
    }
    if (typeof body.saves === 'number' && body.saves > 0) {
      profile.saves += Math.min(25, Math.round(body.saves));
    }
    if (typeof body.freeKickScore === 'number' && body.freeKickScore > profile.bestFreeKickScore) {
      profile.bestFreeKickScore = Math.round(body.freeKickScore);
    }
    profile.updatedAt = new Date().toISOString();
    statsStore.profiles[profile.playerId] = profile;
    saveStats();
    res.json({ profile, leaderboard: getSortedLeaderboard() });
  });

  // Socket.IO Server attached to same HTTP port 3000
  const io = new SocketIOServer(httpServer, {
    path: '/socket.io/',
    cors: { origin: true, credentials: true },
    transports: ['websocket', 'polling'],
  });

  const nsp = io.of('/football');
  const rooms = new Map<string, InternalRoom>();
  const playerSocketMap = new Map<string, Socket>(); // playerId -> active socket
  const socketIdentity = new Map<string, { playerId: string; name: string; avatarId: string }>();
  const playerRoomMap = new Map<string, string>(); // playerId -> roomCode
  const matchmakingQueues: Record<FootballGameMode, string[]> = {
    penalty: [],
    freekick: [],
  };

  function clearRoomTimers(room: InternalRoom) {
    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }
    if (room.advanceTimer) {
      clearTimeout(room.advanceTimer);
      room.advanceTimer = null;
    }
  }

  function removeFromMatchmaking(playerId: string) {
    matchmakingQueues.penalty = matchmakingQueues.penalty.filter((id) => id !== playerId);
    matchmakingQueues.freekick = matchmakingQueues.freekick.filter((id) => id !== playerId);
  }

  function nextSpotForMode(mode: FootballGameMode): FreeKickSpot {
    return mode === 'penalty' ? getPenaltySpot() : createRandomFreeKickSpot();
  }

  function broadcastRoom(room: InternalRoom) {
    nsp.to(room.roomCode).emit('room:state', serializeRoom(room));
  }

  function finalizeMatch(
    room: InternalRoom,
    winnerPlayerId: string | null,
    reason: 'score' | 'opponent_forfeit'
  ) {
    clearRoomTimers(room);
    for (const timer of room.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    room.disconnectTimers.clear();
    room.status = 'finished';
    room.turnDeadlineAt = null;
    room.winnerPlayerId = winnerPlayerId;
    room.winReason = reason;

    // Persist authoritative stats to leaderboard
    for (const p of room.players) {
      const prof = ensureProfile(p.playerId, p.name, p.avatarId);
      if (winnerPlayerId) {
        if (p.playerId === winnerPlayerId) prof.wins += 1;
        else prof.losses += 1;
      }
      prof.goals += p.goals;
      if (room.mode === 'freekick' && p.freeKickScore > prof.bestFreeKickScore) {
        prof.bestFreeKickScore = p.freeKickScore;
      }
      prof.updatedAt = new Date().toISOString();
      statsStore.profiles[prof.playerId] = prof;
    }
    saveStats();

    broadcastRoom(room);
    nsp.to(room.roomCode).emit('match:finished', {
      roomCode: room.roomCode,
      winnerPlayerId,
      reason,
      roomState: serializeRoom(room),
      leaderboard: getSortedLeaderboard(),
    });
  }

  function checkMatchWinnerAfterTurn(room: InternalRoom): string | null | undefined {
    const [p0, p1] = room.players;
    if (!p0 || !p1) return undefined;

    if (room.mode === 'penalty') {
      const k0 = p0.penaltyHistory.length;
      const k1 = p1.penaltyHistory.length;
      const g0 = p0.goals;
      const g1 = p1.goals;

      if (!room.suddenDeath) {
        const rem0 = Math.max(0, 5 - k0);
        const rem1 = Math.max(0, 5 - k1);
        // Uncatchable lead check
        if (g0 - g1 > rem1) return p0.playerId;
        if (g1 - g0 > rem0) return p1.playerId;
        if (k0 === 5 && k1 === 5) {
          if (g0 > g1) return p0.playerId;
          if (g1 > g0) return p1.playerId;
          room.suddenDeath = true;
        }
        return undefined;
      } else {
        // Sudden death settles only when both players have taken equal kicks
        if (k0 === k1) {
          if (g0 > g1) return p0.playerId;
          if (g1 > g0) return p1.playerId;
        }
        return undefined;
      }
    } else {
      // Free Kick Challenge: 5 rounds each, sudden death on tie
      const equalTurns = room.shooterIndex === 1; // P0 took first, P1 finishes pair
      if (!equalTurns) return undefined;

      if (room.roundNumber >= room.maxRounds) {
        if (p0.freeKickScore > p1.freeKickScore) return p0.playerId;
        if (p1.freeKickScore > p0.freeKickScore) return p1.playerId;
        room.suddenDeath = true;
        return undefined;
      }
      return undefined;
    }
  }

  function startTurn(room: InternalRoom) {
    clearRoomTimers(room);
    if (room.status !== 'active') return;
    room.turnId += 1;
    room.pendingShot = null;
    room.pendingDive = null;
    room.shooterSubmitted = false;
    room.keeperSubmitted = false;
    room.turnDeadlineAt = Date.now() + TURN_DURATION_MS;

    const currentTurnId = room.turnId;
    broadcastRoom(room);

    room.turnTimer = setTimeout(() => {
      if (room.status !== 'active' || room.turnId !== currentTurnId) return;
      // Auto-resolve timed-out turn cleanly so match never stalls
      if (!room.pendingShot) {
        room.pendingShot = { aimX: 0, aimY: 0.35, power: 0.55, curve: 0, dip: 0.15 };
      }
      if (!room.pendingDive) {
        room.pendingDive = 'center';
      }
      resolveCurrentTurn(room);
    }, TURN_DURATION_MS);
  }

  function resolveCurrentTurn(room: InternalRoom) {
    if (room.status !== 'active') return;
    clearRoomTimers(room);

    const shot = sanitizeShotInput(
      room.pendingShot || { aimX: 0, aimY: 0.35, power: 0.55, curve: 0, dip: 0.15 }
    );
    const diveDir: KeeperDiveDirection = room.pendingDive || 'center';
    const keeperStartX =
      room.mode === 'freekick'
        ? Math.max(-0.85, Math.min(0.85, -Math.sign(room.spot.x || 1) * 0.65))
        : 0;
    const keeperPlan = getKeeperDivePlan(diveDir, keeperStartX, 0.04, 1.05);

    const simulation = simulateKick({
      mode: room.mode,
      spot: room.spot,
      shotInput: shot,
      keeperPlan,
    });

    const shooter = room.players[room.shooterIndex];
    const keeper = room.players[room.keeperIndex];

    if (shooter) {
      if (room.mode === 'penalty') {
        shooter.penaltyHistory.push(simulation.scored ? 'goal' : 'miss');
      } else {
        shooter.freeKickScore += simulation.pointsAwarded;
      }
      if (simulation.scored) {
        shooter.goals += 1;
      }
    }

    if (keeper && simulation.outcome === 'saved') {
      const kProf = ensureProfile(keeper.playerId, keeper.name, keeper.avatarId);
      kProf.saves += 1;
      statsStore.profiles[kProf.playerId] = kProf;
      saveStats();
    }

    room.turnDeadlineAt = null;
    room.lastResolution = {
      roundId: room.turnId,
      shooterId: shooter?.playerId || '',
      keeperId: keeper?.playerId || '',
      simulation,
    };

    const winnerId = checkMatchWinnerAfterTurn(room);
    broadcastRoom(room);
    nsp.to(room.roomCode).emit('match:kick_resolved', {
      roomCode: room.roomCode,
      roundId: room.turnId,
      shooterId: shooter?.playerId || '',
      keeperId: keeper?.playerId || '',
      simulation,
      roomState: serializeRoom(room),
    });

    room.advanceTimer = setTimeout(() => {
      if (room.status !== 'active') return;
      if (winnerId) {
        finalizeMatch(room, winnerId, 'score');
        return;
      }
      // Alternate shooter & keeper turns
      const prevShooter = room.shooterIndex;
      room.shooterIndex = room.keeperIndex;
      room.keeperIndex = prevShooter;

      if (room.shooterIndex === 0) {
        room.roundNumber += 1;
      }
      room.spot = nextSpotForMode(room.mode);
      startTurn(room);
    }, POST_KICK_PAUSE_MS);
  }

  function joinRoomInternal(
    socket: Socket,
    room: InternalRoom,
    playerInfo: { playerId: string; name: string; avatarId: string }
  ) {
    // Check if player is reconnecting to existing slot
    const existingIdx = room.players.findIndex((p) => p.playerId === playerInfo.playerId);
    if (existingIdx !== -1) {
      const existingPlayer = room.players[existingIdx];
      existingPlayer.connected = true;
      existingPlayer.disconnectedAt = null;
      existingPlayer.reconnectDeadlineAt = null;
      existingPlayer.name = playerInfo.name;
      existingPlayer.avatarId = playerInfo.avatarId;

      const timer = room.disconnectTimers.get(playerInfo.playerId);
      if (timer) {
        clearTimeout(timer);
        room.disconnectTimers.delete(playerInfo.playerId);
      }

      socket.join(room.roomCode);
      playerRoomMap.set(playerInfo.playerId, room.roomCode);
      nsp.to(room.roomCode).emit('opponent:reconnected', { playerId: playerInfo.playerId });
      broadcastRoom(room);
      return;
    }

    if (room.players.length >= 2) {
      socket.emit('room:error', { message: 'Room is already full.' });
      return;
    }

    const newPlayer: OnlinePlayerState = {
      playerId: playerInfo.playerId,
      name: playerInfo.name,
      avatarId: playerInfo.avatarId,
      goals: 0,
      freeKickScore: 0,
      penaltyHistory: [],
      connected: true,
      disconnectedAt: null,
      reconnectDeadlineAt: null,
    };

    room.players.push(newPlayer);
    socket.join(room.roomCode);
    playerRoomMap.set(playerInfo.playerId, room.roomCode);

    if (room.players.length === 2 && room.status === 'waiting') {
      room.status = 'active';
      room.roundNumber = 1;
      room.shooterIndex = 0;
      room.keeperIndex = 1;
      room.spot = nextSpotForMode(room.mode);
      startTurn(room);
    } else {
      broadcastRoom(room);
    }
  }

  function leavePlayerFromRoom(playerId: string, voluntary: boolean) {
    const code = playerRoomMap.get(playerId);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) {
      playerRoomMap.delete(playerId);
      return;
    }

    if (voluntary) {
      playerRoomMap.delete(playerId);
      const sock = playerSocketMap.get(playerId);
      if (sock) sock.leave(code);

      if (room.status === 'active') {
        const opponent = room.players.find((p) => p.playerId !== playerId);
        finalizeMatch(room, opponent?.playerId || null, 'opponent_forfeit');
        return;
      }

      room.players = room.players.filter((p) => p.playerId !== playerId);
      if (room.players.length === 0) {
        clearRoomTimers(room);
        rooms.delete(code);
      } else {
        broadcastRoom(room);
      }
      return;
    }

    // Unexpected disconnect: 30s reconnect window if active match
    const p = room.players.find((pl) => pl.playerId === playerId);
    if (!p) return;
    p.connected = false;
    p.disconnectedAt = Date.now();
    p.reconnectDeadlineAt = Date.now() + RECONNECT_WINDOW_MS;

    if (room.status === 'waiting') {
      room.players = room.players.filter((pl) => pl.playerId !== playerId);
      playerRoomMap.delete(playerId);
      if (room.players.length === 0) {
        clearRoomTimers(room);
        rooms.delete(code);
      }
      return;
    }

    if (room.status === 'active') {
      broadcastRoom(room);
      nsp.to(code).emit('opponent:disconnected', {
        playerId,
        reconnectDeadlineAt: p.reconnectDeadlineAt,
      });

      const existingTimer = room.disconnectTimers.get(playerId);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(() => {
        room.disconnectTimers.delete(playerId);
        if (room.status !== 'active') return;
        const playerAfter = room.players.find((pl) => pl.playerId === playerId);
        if (playerAfter && !playerAfter.connected) {
          const opponent = room.players.find((pl) => pl.playerId !== playerId);
          finalizeMatch(room, opponent?.playerId || null, 'opponent_forfeit');
        }
      }, RECONNECT_WINDOW_MS);

      room.disconnectTimers.set(playerId, timer);
    }
  }

  nsp.on('connection', (socket) => {
    socket.on(
      'player:register',
      (payload: { playerId?: string; name?: string; avatarId?: string }) => {
        const playerId =
          (payload?.playerId || socket.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) ||
          socket.id;
        const prof = ensureProfile(playerId, payload?.name, payload?.avatarId);
        socketIdentity.set(socket.id, {
          playerId: prof.playerId,
          name: prof.name,
          avatarId: prof.avatarId,
        });
        playerSocketMap.set(prof.playerId, socket);
        socket.emit('player:registered', { profile: prof, leaderboard: getSortedLeaderboard() });

        // Auto-restore if player was inside a room during a brief disconnect
        const activeCode = playerRoomMap.get(prof.playerId);
        if (activeCode) {
          const room = rooms.get(activeCode);
          if (room && room.status !== 'finished') {
            joinRoomInternal(socket, room, {
              playerId: prof.playerId,
              name: prof.name,
              avatarId: prof.avatarId,
            });
          } else {
            playerRoomMap.delete(prof.playerId);
          }
        }
      }
    );

    socket.on('room:create', (payload: { mode?: FootballGameMode }) => {
      const ident = socketIdentity.get(socket.id);
      if (!ident) {
        socket.emit('room:error', { message: 'Register player first.' });
        return;
      }
      removeFromMatchmaking(ident.playerId);
      leavePlayerFromRoom(ident.playerId, true);

      const mode: FootballGameMode = payload?.mode === 'freekick' ? 'freekick' : 'penalty';
      const roomCode = makeRoomCode(rooms);
      const room: InternalRoom = {
        roomCode,
        mode,
        status: 'waiting',
        players: [],
        roundNumber: 1,
        maxRounds: 5,
        suddenDeath: false,
        shooterIndex: 0,
        keeperIndex: 1,
        spot: nextSpotForMode(mode),
        turnDeadlineAt: null,
        shooterSubmitted: false,
        keeperSubmitted: false,
        winnerPlayerId: null,
        winReason: null,
        lastResolution: null,
        turnId: 0,
        pendingShot: null,
        pendingDive: null,
        turnTimer: null,
        advanceTimer: null,
        disconnectTimers: new Map(),
      };
      rooms.set(roomCode, room);
      joinRoomInternal(socket, room, ident);
      socket.emit('room:created', { roomCode });
    });

    socket.on('room:join', (payload: { code?: string }) => {
      const ident = socketIdentity.get(socket.id);
      if (!ident) {
        socket.emit('room:error', { message: 'Register player first.' });
        return;
      }
      const code = (payload?.code || '').trim().toUpperCase();
      if (!code || code.length !== 4) {
        socket.emit('room:error', { message: 'Enter a valid 4-letter room code.' });
        return;
      }
      const room = rooms.get(code);
      if (!room || room.status === 'finished') {
        socket.emit('room:error', { message: `Room "${code}" was not found or has ended.` });
        return;
      }

      removeFromMatchmaking(ident.playerId);
      const prevCode = playerRoomMap.get(ident.playerId);
      if (prevCode && prevCode !== code) {
        leavePlayerFromRoom(ident.playerId, true);
      }

      joinRoomInternal(socket, room, ident);
    });

    socket.on('room:leave', () => {
      const ident = socketIdentity.get(socket.id);
      if (!ident) return;
      removeFromMatchmaking(ident.playerId);
      leavePlayerFromRoom(ident.playerId, true);
    });

    socket.on('matchmaking:join', (payload: { mode?: FootballGameMode }) => {
      const ident = socketIdentity.get(socket.id);
      if (!ident) return;
      const mode: FootballGameMode = payload?.mode === 'freekick' ? 'freekick' : 'penalty';
      removeFromMatchmaking(ident.playerId);
      leavePlayerFromRoom(ident.playerId, true);

      const queue = matchmakingQueues[mode];
      // Pair with first connected player waiting
      let matchedId: string | null = null;
      while (queue.length > 0) {
        const candidateId = queue.shift()!;
        if (candidateId === ident.playerId) continue;
        const candidateSock = playerSocketMap.get(candidateId);
        if (candidateSock && candidateSock.connected) {
          matchedId = candidateId;
          break;
        }
      }

      if (!matchedId) {
        queue.push(ident.playerId);
        socket.emit('matchmaking:searching', { mode });
        return;
      }

      const candidateSock = playerSocketMap.get(matchedId)!;
      const candidateIdent = socketIdentity.get(candidateSock.id);
      if (!candidateIdent) {
        queue.push(ident.playerId);
        socket.emit('matchmaking:searching', { mode });
        return;
      }

      const roomCode = makeRoomCode(rooms);
      const room: InternalRoom = {
        roomCode,
        mode,
        status: 'waiting',
        players: [],
        roundNumber: 1,
        maxRounds: 5,
        suddenDeath: false,
        shooterIndex: 0,
        keeperIndex: 1,
        spot: nextSpotForMode(mode),
        turnDeadlineAt: null,
        shooterSubmitted: false,
        keeperSubmitted: false,
        winnerPlayerId: null,
        winReason: null,
        lastResolution: null,
        turnId: 0,
        pendingShot: null,
        pendingDive: null,
        turnTimer: null,
        advanceTimer: null,
        disconnectTimers: new Map(),
      };
      rooms.set(roomCode, room);

      joinRoomInternal(candidateSock, room, candidateIdent);
      joinRoomInternal(socket, room, ident);
      nsp.to(roomCode).emit('matchmaking:matched', { roomCode, mode });
    });

    socket.on('matchmaking:cancel', () => {
      const ident = socketIdentity.get(socket.id);
      if (!ident) return;
      removeFromMatchmaking(ident.playerId);
      socket.emit('matchmaking:cancelled');
    });

    socket.on(
      'match:submit_shot',
      (payload: {
        roomCode?: string;
        aimX?: number;
        aimY?: number;
        power?: number;
        curve?: number;
        dip?: number;
      }) => {
        const ident = socketIdentity.get(socket.id);
        if (!ident) return;
        const room = rooms.get((payload?.roomCode || '').toUpperCase());
        if (!room || room.status !== 'active') return;
        const shooter = room.players[room.shooterIndex];
        if (!shooter || shooter.playerId !== ident.playerId) return;
        if (room.shooterSubmitted) return;

        room.pendingShot = sanitizeShotInput(payload);
        room.shooterSubmitted = true;

        if (room.keeperSubmitted) {
          resolveCurrentTurn(room);
        } else {
          broadcastRoom(room);
        }
      }
    );

    socket.on(
      'match:submit_dive',
      (payload: { roomCode?: string; dive?: KeeperDiveDirection }) => {
        const ident = socketIdentity.get(socket.id);
        if (!ident) return;
        const room = rooms.get((payload?.roomCode || '').toUpperCase());
        if (!room || room.status !== 'active') return;
        const keeper = room.players[room.keeperIndex];
        if (!keeper || keeper.playerId !== ident.playerId) return;
        if (room.keeperSubmitted) return;

        const dive: KeeperDiveDirection =
          payload?.dive && VALID_DIVES.has(payload.dive) ? payload.dive : 'center';
        room.pendingDive = dive;
        room.keeperSubmitted = true;

        if (room.shooterSubmitted) {
          resolveCurrentTurn(room);
        } else {
          broadcastRoom(room);
        }
      }
    );

    socket.on('disconnect', () => {
      const ident = socketIdentity.get(socket.id);
      socketIdentity.delete(socket.id);
      if (!ident) return;
      // Only trigger disconnect if this socket is still the active one for playerId
      if (playerSocketMap.get(ident.playerId)?.id === socket.id) {
        playerSocketMap.delete(ident.playerId);
        removeFromMatchmaking(ident.playerId);
        leavePlayerFromRoom(ident.playerId, false);
      }
    });
  });

  return io;
}
