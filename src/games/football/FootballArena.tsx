import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  ArrowLeft,
  Award,
  Copy,
  Check,
  HelpCircle,
  Pause,
  Play,
  RotateCcw,
  Shield,
  Target,
  Trophy,
  User as UserIcon,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  Zap,
} from 'lucide-react';
import { stadiumAudio } from './audio';
import {
  createRandomFreeKickSpot,
  decideBotKeeperPlan,
  generateBotShot,
  getKeeperDivePlan,
  getPenaltySpot,
  sanitizeShotInput,
  simulateKick,
} from './physics';
import { StadiumScene } from './StadiumScene';
import {
  FOOTBALL_AVATARS,
  type BotDifficulty,
  type FootballGameMode,
  type FootballLeaderboardEntry,
  type FootballPlayerProfile,
  type FreeKickSpot,
  type KeeperDiveDirection,
  type KickSimulationResult,
  type OnlineMatchRoomState,
  type PlayMode,
  type PlayerRoleTurn,
  type ShotInput,
} from './types';

interface FootballArenaProps {
  defaultPlayerId: string;
  defaultPlayerName: string;
  onBackToCinema: () => void;
}

const TUTORIAL_SEEN_KEY = 'tsm_football_tutorial_v1';
const PROFILE_STORAGE_KEY = 'tsm_football_profile_v1';

type ScreenPhase = 'lobby' | 'playing' | 'paused' | 'result';
type LobbyTab = 'play' | 'leaderboard' | 'profile';

interface BotMatchState {
  mode: FootballGameMode;
  difficulty: BotDifficulty;
  roundNumber: number; // 1..5+
  turnRole: PlayerRoleTurn; // In freekick always 'shooter'
  playerGoals: number;
  botGoals: number;
  playerHistory: Array<'goal' | 'miss'>;
  botHistory: Array<'goal' | 'miss'>;
  freeKickScore: number;
  suddenDeath: boolean;
  spot: FreeKickSpot;
  winner: 'player' | 'bot' | 'draw' | null;
}

interface SwipeTracePoint {
  x: number;
  y: number;
  t: number;
}

function AvatarBadge({
  avatarId,
  size = 'md',
}: {
  avatarId: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const option = FOOTBALL_AVATARS.find((a) => a.id === avatarId) || FOOTBALL_AVATARS[0];
  const dims =
    size === 'sm' ? 'h-7 w-7 text-[10px]' : size === 'lg' ? 'h-12 w-12 text-sm' : 'h-9 w-9 text-xs';
  return (
    <span
      className={`${dims} inline-flex items-center justify-center rounded-xl border font-mono font-bold shrink-0`}
      style={{
        borderColor: option.accentHex,
        backgroundColor: '#111114',
        color: option.accentHex,
      }}
    >
      {option.monogram}
    </span>
  );
}

export function FootballArena({
  defaultPlayerId,
  defaultPlayerName,
  onBackToCinema,
}: FootballArenaProps) {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<StadiumScene | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const [phase, setPhase] = useState<ScreenPhase>('lobby');
  const [lobbyTab, setLobbyTab] = useState<LobbyTab>('play');

  const [gameMode, setGameMode] = useState<FootballGameMode>('penalty');
  const [playMode, setPlayMode] = useState<PlayMode>('bot');
  const [difficulty, setDifficulty] = useState<BotDifficulty>('medium');

  const [muted, setMuted] = useState(false);
  const [showTutorial, setShowTutorial] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(TUTORIAL_SEEN_KEY) !== '1';
    } catch {
      return false;
    }
  });

  // Profile & Leaderboard
  const [profile, setProfile] = useState<FootballPlayerProfile>(() => {
    try {
      const saved = window.localStorage.getItem(PROFILE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<FootballPlayerProfile>;
        return {
          playerId: defaultPlayerId,
          name: parsed.name || defaultPlayerName || 'Striker',
          avatarId: parsed.avatarId || 'crown-gold',
          wins: parsed.wins || 0,
          losses: parsed.losses || 0,
          goals: parsed.goals || 0,
          saves: parsed.saves || 0,
          bestFreeKickScore: parsed.bestFreeKickScore || 0,
          updatedAt: new Date().toISOString(),
        };
      }
    } catch {
      // ignore
    }
    return {
      playerId: defaultPlayerId,
      name: defaultPlayerName || 'Striker',
      avatarId: 'crown-gold',
      wins: 0,
      losses: 0,
      goals: 0,
      saves: 0,
      bestFreeKickScore: 0,
      updatedAt: new Date().toISOString(),
    };
  });
  const [profileNameDraft, setProfileNameDraft] = useState(profile.name);
  const [profileAvatarDraft, setProfileAvatarDraft] = useState(profile.avatarId);
  const [profileSavedToast, setProfileSavedToast] = useState(false);
  const [leaderboard, setLeaderboard] = useState<FootballLeaderboardEntry[]>([]);

  // Bot Match State
  const [botMatch, setBotMatch] = useState<BotMatchState | null>(null);
  const botMatchRef = useRef<BotMatchState | null>(null);
  botMatchRef.current = botMatch;

  // Online Multiplayer Socket.IO State
  const [socketConnected, setSocketConnected] = useState(false);
  const [onlineRoom, setOnlineRoom] = useState<OnlineMatchRoomState | null>(null);
  const onlineRoomRef = useRef<OnlineMatchRoomState | null>(null);
  onlineRoomRef.current = onlineRoom;

  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [matchmakingActive, setMatchmakingActive] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [turnSecondsLeft, setTurnSecondsLeft] = useState<number>(10);
  const [opponentReconnectLeft, setOpponentReconnectLeft] = useState<number | null>(null);

  // Playback / Event Overlay State
  const [isAnimatingKick, setIsAnimatingKick] = useState(false);
  const [isSlowMoReplay, setIsSlowMoReplay] = useState(false);
  const [lastSim, setLastSim] = useState<KickSimulationResult | null>(null);
  const lastSimRef = useRef<KickSimulationResult | null>(null);
  lastSimRef.current = lastSim;

  const [bannerText, setBannerText] = useState<{ title: string; sub: string; tone: 'gold' | 'red' | 'zinc' } | null>(null);
  const [qualityNotice, setQualityNotice] = useState<string | null>(null);
  const [shotReadout, setShotReadout] = useState<{ power: number; curve: number } | null>(null);

  // Swipe pointer state
  const swipeTraceRef = useRef<SwipeTracePoint[]>([]);
  const isPointerDownRef = useRef(false);
  const replayTimeoutRef = useRef<number | null>(null);
  const nextTurnTimeoutRef = useRef<number | null>(null);

  const loadLeaderboard = useCallback(async () => {
    try {
      const resp = await fetch('/api/games/football/leaderboard');
      if (resp.ok) {
        const data = (await resp.json()) as { leaderboard?: FootballLeaderboardEntry[] };
        if (Array.isArray(data.leaderboard)) {
          setLeaderboard(data.leaderboard);
        }
      }
    } catch {
      // Quietly handle offline fallback
    }
  }, []);

  useEffect(() => {
    void loadLeaderboard();
  }, [loadLeaderboard]);

  const dismissTutorial = useCallback(() => {
    setShowTutorial(false);
    try {
      window.localStorage.setItem(TUTORIAL_SEEN_KEY, '1');
    } catch {
      // ignore
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      stadiumAudio.setMuted(next);
      return next;
    });
  }, []);

  const saveProfile = async () => {
    const cleanName = profileNameDraft.trim().slice(0, 28) || 'Striker';
    const nextProf: FootballPlayerProfile = {
      ...profile,
      name: cleanName,
      avatarId: profileAvatarDraft,
      updatedAt: new Date().toISOString(),
    };
    setProfile(nextProf);
    try {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(nextProf));
    } catch {
      // ignore
    }

    if (socketRef.current?.connected) {
      socketRef.current.emit('player:register', {
        playerId: nextProf.playerId,
        name: nextProf.name,
        avatarId: nextProf.avatarId,
      });
    }

    try {
      const resp = await fetch('/api/games/football/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: nextProf.playerId,
          name: nextProf.name,
          avatarId: nextProf.avatarId,
        }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          profile?: FootballPlayerProfile;
          leaderboard?: FootballLeaderboardEntry[];
        };
        if (data.profile) setProfile(data.profile);
        if (Array.isArray(data.leaderboard)) setLeaderboard(data.leaderboard);
      }
    } catch {
      // Offline local save already applied
    }

    setProfileSavedToast(true);
    window.setTimeout(() => setProfileSavedToast(false), 2000);
  };

  const recordBotResultToServer = useCallback(
    async (won: boolean, goals: number, saves: number, freeKickScore: number) => {
      try {
        const resp = await fetch('/api/games/football/record-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerId: profile.playerId,
            name: profile.name,
            avatarId: profile.avatarId,
            won,
            goals,
            saves,
            freeKickScore,
          }),
        });
        if (resp.ok) {
          const data = (await resp.json()) as {
            profile?: FootballPlayerProfile;
            leaderboard?: FootballLeaderboardEntry[];
          };
          if (data.profile) setProfile(data.profile);
          if (Array.isArray(data.leaderboard)) setLeaderboard(data.leaderboard);
        }
      } catch {
        // Ignore offline errors
      }
    },
    [profile.playerId, profile.name, profile.avatarId]
  );

  // Advance Bot Match after kick animation & replay conclude
  const advanceBotAfterKick = useCallback(
    (sim: KickSimulationResult) => {
      const cur = botMatchRef.current;
      if (!cur) return;

      if (cur.mode === 'freekick') {
        const nextScore = cur.freeKickScore + sim.pointsAwarded;
        const nextGoals = cur.playerGoals + (sim.scored ? 1 : 0);
        const nextHistory = [...cur.playerHistory, sim.scored ? ('goal' as const) : ('miss' as const)];

        if (cur.roundNumber >= 5) {
          const updated: BotMatchState = {
            ...cur,
            freeKickScore: nextScore,
            playerGoals: nextGoals,
            playerHistory: nextHistory,
            winner: nextScore >= 250 ? 'player' : 'bot',
          };
          setBotMatch(updated);
          setPhase('result');
          void recordBotResultToServer(nextScore >= 250, nextGoals, 0, nextScore);
          return;
        }

        const nextSpot = createRandomFreeKickSpot();
        setBotMatch({
          ...cur,
          roundNumber: cur.roundNumber + 1,
          freeKickScore: nextScore,
          playerGoals: nextGoals,
          playerHistory: nextHistory,
          spot: nextSpot,
        });
        sceneRef.current?.setRoundSetup('freekick', nextSpot);
        setBannerText(null);
        setIsAnimatingKick(false);
        setIsSlowMoReplay(false);
        stadiumAudio.playWhistle();
        return;
      }

      // Penalty Shootout Bot Turn Logic
      const next = { ...cur };
      if (cur.turnRole === 'shooter') {
        next.playerHistory = [...cur.playerHistory, sim.scored ? 'goal' : 'miss'];
        if (sim.scored) next.playerGoals += 1;
      } else {
        next.botHistory = [...cur.botHistory, sim.scored ? 'goal' : 'miss'];
        if (sim.scored) next.botGoals += 1;
      }

      const pKicks = next.playerHistory.length;
      const bKicks = next.botHistory.length;

      let winner: 'player' | 'bot' | null = null;
      if (!next.suddenDeath) {
        const remP = Math.max(0, 5 - pKicks);
        const remB = Math.max(0, 5 - bKicks);
        if (next.playerGoals - next.botGoals > remB) winner = 'player';
        else if (next.botGoals - next.playerGoals > remP) winner = 'bot';
        else if (pKicks === 5 && bKicks === 5) {
          if (next.playerGoals > next.botGoals) winner = 'player';
          else if (next.botGoals > next.playerGoals) winner = 'bot';
          else next.suddenDeath = true;
        }
      } else if (pKicks === bKicks) {
        if (next.playerGoals > next.botGoals) winner = 'player';
        else if (next.botGoals > next.playerGoals) winner = 'bot';
      }

      if (winner) {
        next.winner = winner;
        setBotMatch(next);
        setPhase('result');
        void recordBotResultToServer(winner === 'player', next.playerGoals, 0, 0);
        return;
      }

      next.turnRole = cur.turnRole === 'shooter' ? 'keeper' : 'shooter';
      if (next.turnRole === 'shooter') {
        next.roundNumber += 1;
      }
      const spot = getPenaltySpot();
      next.spot = spot;
      setBotMatch(next);
      sceneRef.current?.setRoundSetup('penalty', spot);
      setBannerText(null);
      setIsAnimatingKick(false);
      setIsSlowMoReplay(false);
      stadiumAudio.playWhistle();
    },
    [recordBotResultToServer]
  );

  // Trigger live kick animation + slow-mo replay + sound choreography
  const playKickSequence = useCallback(
    (sim: KickSimulationResult, onComplete?: () => void) => {
      if (replayTimeoutRef.current) clearTimeout(replayTimeoutRef.current);
      if (nextTurnTimeoutRef.current) clearTimeout(nextTurnTimeoutRef.current);

      setIsAnimatingKick(true);
      setIsSlowMoReplay(false);
      setLastSim(sim);
      stadiumAudio.playKick(sim.shotInput.power);
      sceneRef.current?.playSimulation(sim, false);

      const bannerDelay = 760;
      window.setTimeout(() => {
        if (sim.outcome === 'goal') {
          setBannerText({
            title: 'GOAL!',
            sub: sim.bonusLabels.join(' · ') || 'Back of the net!',
            tone: 'gold',
          });
          stadiumAudio.playCrowdCheer();
        } else if (sim.outcome === 'saved') {
          setBannerText({
            title: 'SAVED!',
            sub: 'Brilliant fingertip stop by the keeper!',
            tone: 'red',
          });
          stadiumAudio.playMissGroan();
        } else if (sim.outcome === 'post') {
          setBannerText({
            title: 'OFF THE WOODWORK!',
            sub: 'Inches away from glory!',
            tone: 'zinc',
          });
          stadiumAudio.playMissGroan();
        } else if (sim.outcome === 'wall_block') {
          setBannerText({
            title: 'WALL BLOCK!',
            sub: 'The jumping wall deflected the strike!',
            tone: 'zinc',
          });
          stadiumAudio.playMissGroan();
        } else {
          setBannerText({
            title: 'WIDE OF THE TARGET',
            sub: 'Keep your curve tighter next kick.',
            tone: 'zinc',
          });
          stadiumAudio.playMissGroan();
        }
      }, bannerDelay);

      // Slow-motion replay for dramatic highlights
      replayTimeoutRef.current = window.setTimeout(() => {
        setIsSlowMoReplay(true);
        sceneRef.current?.playSimulation(sim, true);
      }, 1750);

      nextTurnTimeoutRef.current = window.setTimeout(() => {
        setIsSlowMoReplay(false);
        setIsAnimatingKick(false);
        setBannerText(null);
        onComplete?.();
      }, 3950);
    },
    []
  );

  // Initialize Three.js Stadium Scene cleanly once
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const stadium = new StadiumScene(mount, {
      onAnimationEvent: (ev) => {
        if (ev === 'woodwork') stadiumAudio.playPostClang();
        else if (ev === 'save') stadiumAudio.playSaveThud();
        else if (ev === 'wall') stadiumAudio.playSaveThud();
        else if (ev === 'net') stadiumAudio.playNetSwish();
      },
      onQualityAdjusted: () => {
        setQualityNotice('Balanced graphics enabled to keep 60fps smooth.');
        window.setTimeout(() => setQualityNotice(null), 3500);
      },
    });
    sceneRef.current = stadium;

    return () => {
      if (replayTimeoutRef.current) clearTimeout(replayTimeoutRef.current);
      if (nextTurnTimeoutRef.current) clearTimeout(nextTurnTimeoutRef.current);
      stadium.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Sync paused state with Three.js render loop
  useEffect(() => {
    sceneRef.current?.setPaused(phase === 'paused');
  }, [phase]);

  // Connect Socket.IO client when user selects Online mode (and clean up on unmount)
  useEffect(() => {
    const rawGameBase = (import.meta.env.VITE_GAME_SERVER_URL || '').trim().replace(/\/+$/, '');
    const socketTarget = rawGameBase ? `${rawGameBase}/football` : '/football';
    const socket = io(socketTarget, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      socket.emit('player:register', {
        playerId: profile.playerId,
        name: profile.name,
        avatarId: profile.avatarId,
      });
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socket.on('room:error', (payload: { message?: string }) => {
      setOnlineError(payload?.message || 'Room error occurred.');
      setMatchmakingActive(false);
    });

    socket.on('matchmaking:searching', () => {
      setMatchmakingActive(true);
      setOnlineError(null);
    });

    socket.on('matchmaking:matched', () => {
      setMatchmakingActive(false);
      setOnlineError(null);
    });

    socket.on('matchmaking:cancelled', () => {
      setMatchmakingActive(false);
    });

    socket.on('room:state', (room: OnlineMatchRoomState) => {
      setOnlineRoom(room);
      setOnlineError(null);
      if (room.status === 'active') {
        setPhase('playing');
        setGameMode(room.mode);
        setPlayMode('online');
        // Update spot only when no kick is currently animating
        if (!room.lastResolution || room.shooterSubmitted === false && room.keeperSubmitted === false) {
          sceneRef.current?.setRoundSetup(room.mode, room.spot);
        }
      } else if (room.status === 'finished') {
        setPhase('result');
      }
    });

    socket.on(
      'match:kick_resolved',
      (payload: { simulation: KickSimulationResult; roomState: OnlineMatchRoomState }) => {
        setOnlineRoom(payload.roomState);
        playKickSequence(payload.simulation, () => {
          const latest = onlineRoomRef.current;
          if (latest && latest.status === 'active') {
            sceneRef.current?.setRoundSetup(latest.mode, latest.spot);
          }
        });
      }
    );

    socket.on(
      'opponent:disconnected',
      (payload: { reconnectDeadlineAt?: number }) => {
        if (payload?.reconnectDeadlineAt) {
          setOpponentReconnectLeft(
            Math.max(0, Math.ceil((payload.reconnectDeadlineAt - Date.now()) / 1000))
          );
        }
      }
    );

    socket.on('opponent:reconnected', () => {
      setOpponentReconnectLeft(null);
    });

    socket.on(
      'match:finished',
      (payload: {
        roomState: OnlineMatchRoomState;
        leaderboard?: FootballLeaderboardEntry[];
      }) => {
        setOnlineRoom(payload.roomState);
        if (Array.isArray(payload.leaderboard)) {
          setLeaderboard(payload.leaderboard);
        }
        setOpponentReconnectLeft(null);
        setPhase('result');
      }
    );

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [profile.playerId, playKickSequence]);

  // Countdown tickers for 10s turn timer & 30s reconnect window
  useEffect(() => {
    const id = window.setInterval(() => {
      const room = onlineRoomRef.current;
      if (room?.status === 'active' && room.turnDeadlineAt) {
        setTurnSecondsLeft(Math.max(0, Math.ceil((room.turnDeadlineAt - Date.now()) / 1000)));
      } else {
        setTurnSecondsLeft(10);
      }

      const disc = room?.players.find((p) => !p.connected && p.reconnectDeadlineAt);
      if (disc?.reconnectDeadlineAt) {
        setOpponentReconnectLeft(
          Math.max(0, Math.ceil((disc.reconnectDeadlineAt - Date.now()) / 1000))
        );
      } else {
        setOpponentReconnectLeft(null);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  // Start a Bot Match
  const startBotMatch = (modeToStart: FootballGameMode, diffToStart: BotDifficulty) => {
    stadiumAudio.unlock();
    const initialSpot =
      modeToStart === 'penalty' ? getPenaltySpot() : createRandomFreeKickSpot();
    const initialState: BotMatchState = {
      mode: modeToStart,
      difficulty: diffToStart,
      roundNumber: 1,
      turnRole: 'shooter',
      playerGoals: 0,
      botGoals: 0,
      playerHistory: [],
      botHistory: [],
      freeKickScore: 0,
      suddenDeath: false,
      spot: initialSpot,
      winner: null,
    };
    setPlayMode('bot');
    setGameMode(modeToStart);
    setDifficulty(diffToStart);
    setBotMatch(initialState);
    setOnlineRoom(null);
    setBannerText(null);
    setIsAnimatingKick(false);
    setIsSlowMoReplay(false);
    setPhase('playing');
    sceneRef.current?.setRoundSetup(modeToStart, initialSpot);
    stadiumAudio.playWhistle();
  };

  const executeShot = useCallback(
    (shotInput: ShotInput) => {
      if (isAnimatingKick || phase !== 'playing') return;
      stadiumAudio.unlock();

      if (playMode === 'online') {
        const room = onlineRoomRef.current;
        if (!room || room.status !== 'active' || room.shooterSubmitted) return;
        const shooter = room.players[room.shooterIndex];
        if (shooter?.playerId !== profile.playerId) return;

        socketRef.current?.emit('match:submit_shot', {
          roomCode: room.roomCode,
          ...shotInput,
        });
        setBannerText({
          title: 'SHOT LOCKED!',
          sub: room.keeperSubmitted ? 'Simulating strike...' : 'Waiting for keeper dive...',
          tone: 'gold',
        });
        return;
      }

      const cur = botMatchRef.current;
      if (!cur || cur.turnRole !== 'shooter') return;
      const keeperPlan = decideBotKeeperPlan(shotInput, cur.difficulty, cur.spot, cur.mode);
      const sim = simulateKick({
        mode: cur.mode,
        spot: cur.spot,
        shotInput,
        keeperPlan,
      });
      playKickSequence(sim, () => advanceBotAfterKick(sim));
    },
    [isAnimatingKick, phase, playMode, profile.playerId, playKickSequence, advanceBotAfterKick]
  );

  const executeKeeperDive = useCallback(
    (diveDir: KeeperDiveDirection) => {
      if (isAnimatingKick || phase !== 'playing') return;
      stadiumAudio.unlock();

      if (playMode === 'online') {
        const room = onlineRoomRef.current;
        if (!room || room.status !== 'active' || room.keeperSubmitted) return;
        const keeper = room.players[room.keeperIndex];
        if (keeper?.playerId !== profile.playerId) return;

        socketRef.current?.emit('match:submit_dive', {
          roomCode: room.roomCode,
          dive: diveDir,
        });
        setBannerText({
          title: 'DIVE READY!',
          sub: room.shooterSubmitted ? 'Here comes the kick...' : 'Waiting for striker to shoot...',
          tone: 'gold',
        });
        return;
      }

      const cur = botMatchRef.current;
      if (!cur || cur.turnRole !== 'keeper') return;
      const botShot = generateBotShot(cur.difficulty, cur.mode, cur.spot);
      const keeperPlan = getKeeperDivePlan(diveDir, 0, 0.04, 1.08);
      const sim = simulateKick({
        mode: cur.mode,
        spot: cur.spot,
        shotInput: botShot,
        keeperPlan,
      });
      playKickSequence(sim, () => advanceBotAfterKick(sim));
    },
    [isAnimatingKick, phase, playMode, profile.playerId, playKickSequence, advanceBotAfterKick]
  );

  // Determine active user turn role
  const currentTurnRole: PlayerRoleTurn | 'waiting' = (() => {
    if (playMode === 'bot') {
      return botMatch?.turnRole || 'shooter';
    }
    const room = onlineRoom;
    if (!room || room.status !== 'active') return 'waiting';
    if (room.players[room.shooterIndex]?.playerId === profile.playerId) return 'shooter';
    if (room.players[room.keeperIndex]?.playerId === profile.playerId) return 'keeper';
    return 'waiting';
  })();

  // Convert swipe trace into realistic ShotInput (direction -> aim, speed -> power, lateral bow -> curve)
  const computeShotFromTrace = (
    trace: SwipeTracePoint[],
    rect: DOMRect
  ): { shot: ShotInput; powerPct: number; curveVal: number } | null => {
    if (trace.length < 2) return null;
    const first = trace[0];
    const last = trace[trace.length - 1];
    const dy = first.y - last.y; // Upward swipe is positive
    const dx = last.x - first.x;
    if (dy < 22) return null; // Too short / not upward

    const durationSec = Math.max(0.08, (last.t - first.t) / 1000);
    const distPx = Math.hypot(dx, dy);
    const velocityPx = distPx / durationSec;

    const power = Math.max(0.38, Math.min(1.0, (velocityPx - 160) / 1350 + (dy / rect.height) * 0.45));
    const aimX = Math.max(-1.25, Math.min(1.25, (dx / (rect.width * 0.34))));
    const aimY = Math.max(0.08, Math.min(1.18, (dy / (rect.height * 0.52))));

    // Measure lateral bow at swipe midpoint for realistic curved swerve!
    const mid = trace[Math.floor(trace.length / 2)];
    const expectedMidX = (first.x + last.x) / 2;
    const bowPx = mid.x - expectedMidX;
    const curve = Math.max(-1.0, Math.min(1.0, -bowPx / Math.max(24, rect.width * 0.085)));
    const dip = Math.max(0.1, Math.min(0.9, power * 0.65));

    return {
      shot: sanitizeShotInput({ aimX, aimY, power, curve, dip }),
      powerPct: Math.round(power * 100),
      curveVal: Number(curve.toFixed(2)),
    };
  };

  // Pointer handlers on the 3D canvas (touch-action: none)
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (phase !== 'playing' || isAnimatingKick || showTutorial) return;
    stadiumAudio.unlock();
    isPointerDownRef.current = true;
    swipeTraceRef.current = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current || phase !== 'playing' || isAnimatingKick) return;
    const trace = swipeTraceRef.current;
    trace.push({ x: e.clientX, y: e.clientY, t: performance.now() });

    if (currentTurnRole === 'shooter') {
      const rect = e.currentTarget.getBoundingClientRect();
      const computed = computeShotFromTrace(trace, rect);
      if (computed) {
        sceneRef.current?.updateAimPreview(
          computed.shot.aimX,
          computed.shot.aimY,
          computed.shot.curve,
          true
        );
        setShotReadout({ power: computed.powerPct, curve: computed.curveVal });
      }
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current) return;
    isPointerDownRef.current = false;
    sceneRef.current?.updateAimPreview(0, 0, 0, false);
    setShotReadout(null);

    if (phase !== 'playing' || isAnimatingKick || showTutorial) return;

    const trace = swipeTraceRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    trace.push({ x: e.clientX, y: e.clientY, t: performance.now() });

    if (currentTurnRole === 'shooter') {
      const computed = computeShotFromTrace(trace, rect);
      if (computed) {
        executeShot(computed.shot);
      }
    } else if (currentTurnRole === 'keeper') {
      const first = trace[0];
      const last = trace[trace.length - 1];
      const dx = last.x - first.x;
      const dy = first.y - last.y;
      const moved = Math.hypot(dx, dy);

      if (moved > 28) {
        // Swipe dive direction
        const isHigh = dy > 36;
        if (Math.abs(dx) < 28) {
          executeKeeperDive(isHigh ? 'up' : 'center');
        } else if (dx < 0) {
          executeKeeperDive(isHigh ? 'up-left' : 'left');
        } else {
          executeKeeperDive(isHigh ? 'up-right' : 'right');
        }
      } else {
        // Tap zone on goal
        const relX = (e.clientX - rect.left) / Math.max(1, rect.width);
        const relY = (e.clientY - rect.top) / Math.max(1, rect.height);
        const isHigh = relY < 0.45;
        if (relX < 0.37) executeKeeperDive(isHigh ? 'up-left' : 'left');
        else if (relX > 0.63) executeKeeperDive(isHigh ? 'up-right' : 'right');
        else executeKeeperDive(isHigh ? 'up' : 'center');
      }
    }
    swipeTraceRef.current = [];
  };

  const handleCopyCode = () => {
    if (!onlineRoom?.roomCode) return;
    void navigator.clipboard?.writeText(onlineRoom.roomCode);
    setCopiedCode(true);
    window.setTimeout(() => setCopiedCode(false), 1800);
  };

  const handleLeaveToLobby = () => {
    if (playMode === 'online' && onlineRoom) {
      socketRef.current?.emit('room:leave');
      setOnlineRoom(null);
    }
    setMatchmakingActive(false);
    setBotMatch(null);
    setBannerText(null);
    setIsAnimatingKick(false);
    setIsSlowMoReplay(false);
    setPhase('lobby');
  };

  // Match HUD scores
  const hudLeft = (() => {
    if (playMode === 'bot' && botMatch) {
      return {
        name: profile.name,
        avatarId: profile.avatarId,
        score: botMatch.mode === 'penalty' ? botMatch.playerGoals : botMatch.freeKickScore,
        history: botMatch.playerHistory,
      };
    }
    const p0 = onlineRoom?.players[0];
    return {
      name: p0?.name || 'Player 1',
      avatarId: p0?.avatarId || 'crown-gold',
      score: onlineRoom?.mode === 'penalty' ? p0?.goals || 0 : p0?.freeKickScore || 0,
      history: p0?.penaltyHistory || [],
    };
  })();

  const hudRight = (() => {
    if (playMode === 'bot' && botMatch) {
      return {
        name:
          botMatch.mode === 'freekick'
            ? `Target 250`
            : `Bot (${botMatch.difficulty.toUpperCase()})`,
        avatarId: 'titan-keeper',
        score: botMatch.mode === 'penalty' ? botMatch.botGoals : 250,
        history: botMatch.botHistory,
      };
    }
    const p1 = onlineRoom?.players[1];
    return {
      name: p1?.name || 'Opponent',
      avatarId: p1?.avatarId || 'titan-keeper',
      score: onlineRoom?.mode === 'penalty' ? p1?.goals || 0 : p1?.freeKickScore || 0,
      history: p1?.penaltyHistory || [],
    };
  })();

  const currentRoundDisplay =
    playMode === 'bot'
      ? `${botMatch?.suddenDeath ? 'SD ' : ''}Rd ${botMatch?.roundNumber || 1}/5`
      : `${onlineRoom?.suddenDeath ? 'SD ' : ''}Rd ${onlineRoom?.roundNumber || 1}/5`;

  return (
    <div className="relative w-full max-w-full overflow-hidden rounded-2xl border border-[#27272A] bg-[#09090B] shadow-2xl select-none">
      {/* Top Compact Arena Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#27272A] bg-[#0A0A0C] px-3 sm:px-5 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => {
              if (phase === 'playing') setPhase('paused');
              else onBackToCinema();
            }}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#111114] px-3 py-1.5 text-xs font-semibold text-[#FAFAFA] hover:border-[#E5A93B] hover:text-[#E5A93B] transition-colors cursor-pointer shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Back to Temple Cinema</span>
            <span className="sm:hidden">Cinema</span>
          </button>

          <div className="min-w-0">
            <h2 className="font-display text-sm sm:text-base font-bold text-[#E5A93B] truncate">
              Temple Football Arena
            </h2>
            <p className="text-[11px] text-[#A1A1AA] truncate">
              {gameMode === 'penalty' ? 'Penalty Shootout' : 'Free Kick Challenge'} ·{' '}
              {playMode === 'online' ? 'Online 2P' : `Vs ${difficulty} Bot`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute game sound' : 'Mute game sound'}
            title={muted ? 'Unmute' : 'Mute'}
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg border border-[#27272A] bg-[#111114] text-[#D4D4D8] hover:border-[#E5A93B] hover:text-[#FAFAFA] cursor-pointer"
          >
            {muted ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4 text-[#E5A93B]" />}
          </button>

          <button
            type="button"
            onClick={() => setShowTutorial(true)}
            aria-label="How to play"
            title="How to play"
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg border border-[#27272A] bg-[#111114] text-[#D4D4D8] hover:border-[#E5A93B] hover:text-[#FAFAFA] cursor-pointer"
          >
            <HelpCircle className="h-4 w-4" />
          </button>

          {phase === 'playing' && (
            <button
              type="button"
              onClick={() => setPhase('paused')}
              aria-label="Pause game"
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#111114] px-3 py-1.5 text-xs font-semibold text-[#FAFAFA] hover:border-[#E5A93B] cursor-pointer"
            >
              <Pause className="h-3.5 w-3.5 text-[#E5A93B]" />
              <span className="hidden sm:inline">Pause</span>
            </button>
          )}
        </div>
      </div>

      {/* 3D Stadium Viewport Container (supports both portrait & landscape smoothly) */}
      <div
        className="relative w-full h-[64dvh] min-h-[430px] max-h-[680px] sm:h-[580px] overflow-hidden bg-[#06080d]"
        style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
      >
        {/* Dedicated Three.js Canvas Mount */}
        <div
          ref={canvasMountRef}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerCancel={() => {
            isPointerDownRef.current = false;
            sceneRef.current?.updateAimPreview(0, 0, 0, false);
            setShotReadout(null);
          }}
          className="absolute inset-0 w-full h-full cursor-crosshair"
          style={{ touchAction: 'none' }}
        />

        {/* PLAYING HUD OVERLAY */}
        {phase === 'playing' && (
          <>
            {/* Top Scoreboard Overlay */}
            <div className="pointer-events-none absolute top-3 inset-x-3 z-10 flex flex-col items-center gap-2">
              <div className="pointer-events-auto flex items-center justify-between gap-2 sm:gap-4 w-full max-w-xl rounded-xl border border-[#27272A] bg-[#09090B]/88 px-3 py-2 shadow-xl">
                {/* Left Player */}
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <AvatarBadge avatarId={hudLeft.avatarId} size="sm" />
                  <div className="min-w-0">
                    <p className="text-[11px] sm:text-xs font-semibold text-[#FAFAFA] truncate">
                      {hudLeft.name}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {hudLeft.history.slice(-5).map((r, i) => (
                        <span
                          key={i}
                          className={`h-2 w-2 rounded-full ${r === 'goal' ? 'bg-[#E5A93B]' : 'bg-rose-500/80'}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Center Score + Round */}
                <div className="flex flex-col items-center shrink-0 px-2 border-x border-[#27272A]">
                  <span className="font-mono text-base sm:text-lg font-bold tabular-nums text-[#E5A93B] leading-none">
                    {hudLeft.score} - {hudRight.score}
                  </span>
                  <span className="font-mono text-[10px] text-[#A1A1AA] mt-1">
                    {currentRoundDisplay}
                  </span>
                </div>

                {/* Right Player / Target */}
                <div className="flex items-center justify-end gap-2 min-w-0 flex-1 text-right">
                  <div className="min-w-0">
                    <p className="text-[11px] sm:text-xs font-semibold text-[#FAFAFA] truncate">
                      {hudRight.name}
                    </p>
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      {hudRight.history.slice(-5).map((r, i) => (
                        <span
                          key={i}
                          className={`h-2 w-2 rounded-full ${r === 'goal' ? 'bg-[#E5A93B]' : 'bg-rose-500/80'}`}
                        />
                      ))}
                    </div>
                  </div>
                  <AvatarBadge avatarId={hudRight.avatarId} size="sm" />
                </div>
              </div>

              {/* Turn indicator + 10s online timer */}
              <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] font-medium">
                <span className="rounded-lg border border-[#E5A93B]/40 bg-[#09090B]/90 px-3 py-1 text-[#E5A93B]">
                  {isSlowMoReplay
                    ? 'SLOW-MO REPLAY'
                    : currentTurnRole === 'shooter'
                      ? 'YOUR KICK · Swipe upward to shoot (curve sideways for bend!)'
                      : currentTurnRole === 'keeper'
                        ? 'YOUR SAVE · Tap or swipe left, right, or up to dive!'
                        : 'Waiting for players...'}
                </span>

                {playMode === 'online' && onlineRoom?.status === 'active' && !isAnimatingKick && (
                  <span
                    className={`rounded-lg border px-2.5 py-1 font-mono font-bold tabular-nums ${
                      turnSecondsLeft <= 3
                        ? 'border-rose-500 bg-rose-950/90 text-rose-200'
                        : 'border-[#27272A] bg-[#09090B]/90 text-[#FAFAFA]'
                    }`}
                  >
                    {turnSecondsLeft}s
                  </span>
                )}

                {gameMode === 'freekick' && (
                  <span className="rounded-lg border border-[#27272A] bg-[#09090B]/90 px-2.5 py-1 font-mono text-[#D4D4D8]">
                    {(playMode === 'online' ? onlineRoom?.spot.distance : botMatch?.spot.distance)?.toFixed(1)}m out
                  </span>
                )}
              </div>

              {opponentReconnectLeft !== null && (
                <div className="rounded-lg border border-amber-500/60 bg-[#09090B]/95 px-3 py-1.5 text-xs font-medium text-amber-300">
                  Opponent disconnected — waiting {opponentReconnectLeft}s before forfeit win
                </div>
              )}

              {qualityNotice && (
                <div className="rounded-lg border border-[#27272A] bg-[#09090B]/90 px-3 py-1 text-[11px] text-[#A1A1AA]">
                  {qualityNotice}
                </div>
              )}
            </div>

            {/* Live Swipe Power/Curve Telemetry */}
            {shotReadout && (
              <div className="pointer-events-none absolute left-1/2 bottom-20 -translate-x-1/2 z-10 rounded-lg border border-[#E5A93B]/50 bg-[#09090B]/90 px-3 py-1.5 font-mono text-xs text-[#FAFAFA]">
                Power <span className="text-[#E5A93B] font-bold">{shotReadout.power}%</span> · Curve{' '}
                <span className="text-[#E5A93B] font-bold">{shotReadout.curve > 0 ? `+${shotReadout.curve}` : shotReadout.curve}</span>
              </div>
            )}

            {/* Kick Result Callout Banner */}
            {bannerText && (
              <div className="pointer-events-none absolute inset-x-4 top-1/3 -translate-y-1/2 z-20 flex justify-center">
                <div
                  className={`max-w-sm rounded-2xl border px-5 py-3 text-center shadow-2xl ${
                    bannerText.tone === 'gold'
                      ? 'border-[#E5A93B] bg-[#09090B]/95 text-[#E5A93B]'
                      : bannerText.tone === 'red'
                        ? 'border-rose-500/70 bg-[#09090B]/95 text-rose-300'
                        : 'border-[#3F3F46] bg-[#09090B]/95 text-[#FAFAFA]'
                  }`}
                >
                  <p className="font-display text-xl sm:text-2xl font-bold tracking-tight">
                    {bannerText.title}
                  </p>
                  <p className="mt-1 text-xs text-[#D4D4D8]">{bannerText.sub}</p>
                </div>
              </div>
            )}

            {/* Bottom Thumb Controls Dock (Goalkeeper dive buttons when keeping + Free Kick curve quick tip) */}
            {currentTurnRole === 'keeper' && !isAnimatingKick && (
              <div className="absolute bottom-3 inset-x-3 z-20 flex flex-col items-center gap-2">
                <div className="grid grid-cols-3 gap-2 w-full max-w-md rounded-xl border border-[#27272A] bg-[#09090B]/90 p-2">
                  {(
                    [
                      { dir: 'up-left', label: 'Top Left' },
                      { dir: 'up', label: 'Jump' },
                      { dir: 'up-right', label: 'Top Right' },
                      { dir: 'left', label: 'Dive Left' },
                      { dir: 'center', label: 'Hold' },
                      { dir: 'right', label: 'Dive Right' },
                    ] as Array<{ dir: KeeperDiveDirection; label: string }>
                  ).map((btn) => (
                    <button
                      key={btn.dir}
                      type="button"
                      onClick={() => executeKeeperDive(btn.dir)}
                      className="min-h-[44px] rounded-lg border border-[#27272A] bg-[#18181B] px-2 py-2 text-xs font-semibold text-[#FAFAFA] hover:border-[#E5A93B] hover:bg-[#E5A93B] hover:text-[#09090B] active:scale-[0.97] transition-all cursor-pointer"
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* LOBBY OVERLAY */}
        {phase === 'lobby' && (
          <div className="absolute inset-0 z-20 overflow-y-auto bg-[#09090B]/88 p-4 sm:p-6">
            <div className="mx-auto max-w-3xl space-y-5">
              {/* Sub-Navigation Tabs */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 rounded-xl border border-[#27272A] bg-[#111114] p-1">
                  {[
                    { id: 'play', label: 'Kick Off', icon: Play },
                    { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
                    { id: 'profile', label: 'Profile', icon: UserIcon },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const active = lobbyTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setLobbyTab(tab.id as LobbyTab);
                          if (tab.id === 'leaderboard') void loadLeaderboard();
                        }}
                        className={`min-h-[40px] inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#E5A93B] text-[#09090B]'
                            : 'text-[#A1A1AA] hover:text-[#FAFAFA]'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2 text-xs text-[#A1A1AA]">
                  <Wifi
                    className={`h-3.5 w-3.5 ${socketConnected ? 'text-emerald-400' : 'text-zinc-500'}`}
                    aria-hidden="true"
                  />
                  <span>{socketConnected ? 'Multiplayer Live' : 'Offline Bot Ready'}</span>
                </div>
              </div>

              {lobbyTab === 'play' && (
                <div className="space-y-4">
                  {/* Game Mode Picker */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setGameMode('penalty')}
                      className={`text-left rounded-xl border p-4 transition-all cursor-pointer ${
                        gameMode === 'penalty'
                          ? 'border-[#E5A93B] bg-[#E5A93B]/10'
                          : 'border-[#27272A] bg-[#111114] hover:border-[#3F3F46]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-display text-base font-bold text-[#FAFAFA]">
                          Penalty Shootout
                        </span>
                        <Target className="h-4 w-4 text-[#E5A93B]" aria-hidden="true" />
                      </div>
                      <p className="text-xs text-[#A1A1AA] leading-relaxed">
                        5 kicks each, alternating as shooter &amp; goalkeeper, with sudden death on ties.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setGameMode('freekick')}
                      className={`text-left rounded-xl border p-4 transition-all cursor-pointer ${
                        gameMode === 'freekick'
                          ? 'border-[#E5A93B] bg-[#E5A93B]/10'
                          : 'border-[#27272A] bg-[#111114] hover:border-[#3F3F46]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-display text-base font-bold text-[#FAFAFA]">
                          Free Kick Challenge
                        </span>
                        <Zap className="h-4 w-4 text-[#E5A93B]" aria-hidden="true" />
                      </div>
                      <p className="text-xs text-[#A1A1AA] leading-relaxed">
                        5 attempts from random angles &amp; distances. Curl past the jumping wall &amp; keeper!
                      </p>
                    </button>
                  </div>

                  {/* Play Options: Vs Bot OR Online 2P */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* VS BOT CARD */}
                    <div className="rounded-xl border border-[#27272A] bg-[#111114] p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-display text-sm font-bold text-[#FAFAFA] flex items-center gap-2">
                          <Shield className="h-4 w-4 text-[#E5A93B]" aria-hidden="true" />
                          <span>Play vs AI Bot</span>
                        </h3>
                        <span className="text-[11px] font-mono text-[#A1A1AA]">Instant Start</span>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        {(['easy', 'medium', 'hard'] as BotDifficulty[]).map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setDifficulty(d)}
                            className={`min-h-[40px] rounded-lg border text-xs font-semibold capitalize cursor-pointer transition-colors ${
                              difficulty === d
                                ? 'border-[#E5A93B] bg-[#E5A93B] text-[#09090B]'
                                : 'border-[#27272A] bg-[#18181B] text-[#D4D4D8] hover:border-[#3F3F46]'
                            }`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => startBotMatch(gameMode, difficulty)}
                        className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#E5A93B] px-4 py-2.5 text-sm font-bold text-[#09090B] hover:bg-[#F0B84F] active:scale-[0.98] transition-all cursor-pointer"
                      >
                        <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                        <span>
                          Start {gameMode === 'penalty' ? 'Shootout' : 'Free Kicks'} vs Bot
                        </span>
                      </button>
                    </div>

                    {/* ONLINE 2P MULTIPLAYER CARD */}
                    <div className="rounded-xl border border-[#27272A] bg-[#111114] p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-display text-sm font-bold text-[#FAFAFA] flex items-center gap-2">
                          <Users className="h-4 w-4 text-[#E5A93B]" aria-hidden="true" />
                          <span>Online 2-Player</span>
                        </h3>
                        <span className="text-[11px] font-mono text-[#A1A1AA]">10s Turns</span>
                      </div>

                      {onlineRoom && onlineRoom.status === 'waiting' ? (
                        <div className="rounded-xl border border-[#E5A93B]/40 bg-[#09090B] p-3 space-y-2.5">
                          <p className="text-xs text-[#D4D4D8]">
                            Share this 4-letter room code with your friend:
                          </p>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-2xl font-bold tracking-[0.25em] text-[#E5A93B]">
                              {onlineRoom.roomCode}
                            </span>
                            <button
                              type="button"
                              onClick={handleCopyCode}
                              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#18181B] px-3 py-1.5 text-xs font-semibold text-[#FAFAFA] hover:border-[#E5A93B] cursor-pointer"
                            >
                              {copiedCode ? (
                                <>
                                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3.5 w-3.5 text-[#E5A93B]" />
                                  <span>Copy Code</span>
                                </>
                              )}
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={handleLeaveToLobby}
                            className="w-full min-h-[38px] rounded-lg border border-[#27272A] text-xs font-medium text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer"
                          >
                            Cancel Room
                          </button>
                        </div>
                      ) : matchmakingActive ? (
                        <div className="rounded-xl border border-[#E5A93B]/40 bg-[#09090B] p-3 space-y-2.5 text-center">
                          <p className="text-xs font-semibold text-[#E5A93B]">
                            Searching for an online opponent ({gameMode === 'penalty' ? 'Penalty' : 'Free Kick'})...
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              socketRef.current?.emit('matchmaking:cancel');
                              setMatchmakingActive(false);
                            }}
                            className="min-h-[38px] rounded-lg border border-[#27272A] px-4 text-xs font-semibold text-[#FAFAFA] hover:border-rose-500 cursor-pointer"
                          >
                            Cancel Search
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              disabled={!socketConnected}
                              onClick={() => {
                                setOnlineError(null);
                                socketRef.current?.emit('room:create', { mode: gameMode });
                              }}
                              className="min-h-[42px] rounded-lg border border-[#E5A93B]/60 bg-[#E5A93B]/15 px-3 py-2 text-xs font-bold text-[#E5A93B] hover:bg-[#E5A93B] hover:text-[#09090B] disabled:opacity-45 transition-colors cursor-pointer"
                            >
                              Create Room
                            </button>

                            <button
                              type="button"
                              disabled={!socketConnected}
                              onClick={() => {
                                setOnlineError(null);
                                socketRef.current?.emit('matchmaking:join', { mode: gameMode });
                              }}
                              className="min-h-[42px] rounded-lg bg-[#E5A93B] px-3 py-2 text-xs font-bold text-[#09090B] hover:bg-[#F0B84F] disabled:opacity-45 transition-colors cursor-pointer"
                            >
                              Quick Match
                            </button>
                          </div>

                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              setOnlineError(null);
                              socketRef.current?.emit('room:join', { code: joinCodeInput });
                            }}
                            className="flex items-center gap-2"
                          >
                            <input
                              type="text"
                              maxLength={4}
                              value={joinCodeInput}
                              onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                              placeholder="4-letter code"
                              aria-label="4-letter room code"
                              className="flex-1 min-w-0 min-h-[42px] rounded-lg border border-[#3F3F46] bg-[#09090B] px-3 py-2 font-mono text-base uppercase tracking-widest text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
                            />
                            <button
                              type="submit"
                              disabled={!socketConnected || joinCodeInput.trim().length !== 4}
                              className="min-h-[42px] rounded-lg border border-[#27272A] bg-[#18181B] px-4 py-2 text-xs font-bold text-[#FAFAFA] hover:border-[#E5A93B] disabled:opacity-45 cursor-pointer shrink-0"
                            >
                              Join
                            </button>
                          </form>

                          {onlineError && (
                            <p className="text-xs text-rose-400 font-medium">{onlineError}</p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* LEADERBOARD TAB */}
              {lobbyTab === 'leaderboard' && (
                <div className="rounded-xl border border-[#27272A] bg-[#111114] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-base font-bold text-[#FAFAFA] flex items-center gap-2">
                      <Award className="h-4 w-4 text-[#E5A93B]" aria-hidden="true" />
                      <span>Wins &amp; Goals Leaderboard</span>
                    </h3>
                    <button
                      type="button"
                      onClick={() => void loadLeaderboard()}
                      className="text-xs font-medium text-[#E5A93B] hover:underline cursor-pointer"
                    >
                      Refresh
                    </button>
                  </div>

                  <div className="divide-y divide-[#27272A]">
                    {leaderboard.length === 0 ? (
                      <p className="py-6 text-center text-xs text-[#71717A]">
                        Play a match to claim #1 on the Temple Arena board!
                      </p>
                    ) : (
                      leaderboard.slice(0, 10).map((entry, idx) => (
                        <div
                          key={entry.playerId}
                          className="flex items-center justify-between gap-3 py-2.5 text-xs"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="font-mono text-xs font-bold text-[#E5A93B] w-6 shrink-0">
                              #{idx + 1}
                            </span>
                            <AvatarBadge avatarId={entry.avatarId} size="sm" />
                            <span className="font-semibold text-[#FAFAFA] truncate">
                              {entry.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 font-mono tabular-nums text-[11px] text-[#D4D4D8] shrink-0">
                            <span>
                              <strong className="text-[#E5A93B]">{entry.wins}</strong> W
                            </span>
                            <span>
                              <strong>{entry.goals}</strong> G
                            </span>
                            <span className="hidden sm:inline text-[#A1A1AA]">
                              FK {entry.bestFreeKickScore}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* PROFILE TAB */}
              {lobbyTab === 'profile' && (
                <div className="rounded-xl border border-[#27272A] bg-[#111114] p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <AvatarBadge avatarId={profileAvatarDraft} size="lg" />
                      <div>
                        <p className="font-display text-base font-bold text-[#FAFAFA]">
                          {profile.name}
                        </p>
                        <p className="font-mono text-xs text-[#A1A1AA]">
                          {profile.wins} Wins · {profile.goals} Goals · Best FK {profile.bestFreeKickScore}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="football-player-name"
                      className="block text-xs font-medium text-[#D4D4D8]"
                    >
                      Player Display Name
                    </label>
                    <input
                      id="football-player-name"
                      type="text"
                      maxLength={28}
                      value={profileNameDraft}
                      onChange={(e) => setProfileNameDraft(e.target.value)}
                      className="w-full min-h-[42px] rounded-lg border border-[#3F3F46] bg-[#09090B] px-3 py-2 text-base text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-[#D4D4D8]">Club Crest Avatar</p>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {FOOTBALL_AVATARS.map((av) => (
                        <button
                          key={av.id}
                          type="button"
                          onClick={() => setProfileAvatarDraft(av.id)}
                          className={`flex flex-col items-center gap-1 rounded-xl border p-2 cursor-pointer transition-colors ${
                            profileAvatarDraft === av.id
                              ? 'border-[#E5A93B] bg-[#E5A93B]/10'
                              : 'border-[#27272A] bg-[#09090B] hover:border-[#3F3F46]'
                          }`}
                        >
                          <AvatarBadge avatarId={av.id} size="sm" />
                          <span className="text-[10px] text-[#D4D4D8] truncate w-full text-center">
                            {av.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void saveProfile()}
                      className="min-h-[42px] rounded-xl bg-[#E5A93B] px-5 py-2 text-xs font-bold text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
                    >
                      Save Player Profile
                    </button>
                    {profileSavedToast && (
                      <span className="text-xs font-medium text-emerald-400">Saved!</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* PAUSE OVERLAY */}
        {phase === 'paused' && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#09090B]/90 p-4">
            <div className="w-full max-w-sm rounded-2xl border border-[#27272A] bg-[#111114] p-6 space-y-3 text-center">
              <h3 className="font-display text-xl font-bold text-[#E5A93B]">Match Paused</h3>
              <p className="text-xs text-[#A1A1AA]">
                {playMode === 'online'
                  ? 'Note: Server turn clock keeps running in online matches.'
                  : 'Take a breather before your next strike.'}
              </p>

              <div className="space-y-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPhase('playing')}
                  className="w-full min-h-[44px] rounded-xl bg-[#E5A93B] text-sm font-bold text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
                >
                  Resume Match
                </button>
                {playMode === 'bot' && (
                  <button
                    type="button"
                    onClick={() => startBotMatch(gameMode, difficulty)}
                    className="w-full min-h-[44px] rounded-xl border border-[#27272A] bg-[#18181B] text-xs font-semibold text-[#FAFAFA] hover:border-[#E5A93B] cursor-pointer"
                  >
                    Restart Match
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowTutorial(true)}
                  className="w-full min-h-[44px] rounded-xl border border-[#27272A] bg-[#18181B] text-xs font-semibold text-[#FAFAFA] hover:border-[#E5A93B] cursor-pointer"
                >
                  Controls Tutorial
                </button>
                <button
                  type="button"
                  onClick={handleLeaveToLobby}
                  className="w-full min-h-[44px] rounded-xl border border-[#27272A] bg-[#18181B] text-xs font-semibold text-[#D4D4D8] hover:text-[#FAFAFA] cursor-pointer"
                >
                  Quit to Game Lobby
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleLeaveToLobby();
                    onBackToCinema();
                  }}
                  className="w-full min-h-[44px] rounded-xl border border-[#27272A] text-xs font-semibold text-[#E5A93B] hover:bg-[#E5A93B]/10 cursor-pointer"
                >
                  Back to Temple Cinema
                </button>
              </div>
            </div>
          </div>
        )}

        {/* RESULT SCREEN */}
        {phase === 'result' && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#09090B]/92 p-4">
            <div className="w-full max-w-md rounded-2xl border border-[#E5A93B]/50 bg-[#111114] p-6 text-center space-y-4 shadow-2xl">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E5A93B]/15 text-[#E5A93B]">
                <Trophy className="h-6 w-6" aria-hidden="true" />
              </div>

              {(() => {
                const isOnline = playMode === 'online';
                const won = isOnline
                  ? onlineRoom?.winnerPlayerId === profile.playerId
                  : botMatch?.winner === 'player';
                return (
                  <>
                    <div>
                      <h3 className="font-display text-2xl font-bold text-[#FAFAFA]">
                        {won ? 'Victory in Temple Arena!' : 'Full Time'}
                      </h3>
                      <p className="mt-1 text-xs text-[#A1A1AA]">
                        {isOnline && onlineRoom?.winReason === 'opponent_forfeit'
                          ? 'Match settled after 30s reconnect window.'
                          : gameMode === 'penalty'
                            ? `Final Score: ${hudLeft.name} ${hudLeft.score} - ${hudRight.score} ${hudRight.name}`
                            : `Total Free Kick Points: ${hudLeft.score}`}
                      </p>
                    </div>
                  </>
                );
              })()}

              <div className="grid grid-cols-2 gap-2 pt-2">
                {playMode === 'bot' ? (
                  <button
                    type="button"
                    onClick={() => startBotMatch(gameMode, difficulty)}
                    className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#E5A93B] px-4 py-2 text-xs font-bold text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Play Again</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleLeaveToLobby}
                    className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#E5A93B] px-4 py-2 text-xs font-bold text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
                  >
                    <span>Rematch Lobby</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    handleLeaveToLobby();
                    onBackToCinema();
                  }}
                  className="min-h-[44px] rounded-xl border border-[#27272A] bg-[#18181B] px-4 py-2 text-xs font-semibold text-[#FAFAFA] hover:border-[#E5A93B] cursor-pointer"
                >
                  Back to Temple Cinema
                </button>
              </div>
            </div>
          </div>
        )}

        {/* FIRST-PLAY TUTORIAL MODAL */}
        {showTutorial && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#09090B]/92 p-4">
            <div className="w-full max-w-md rounded-2xl border border-[#E5A93B]/60 bg-[#111114] p-5 sm:p-6 space-y-4 shadow-2xl">
              <h3 className="font-display text-lg font-bold text-[#E5A93B]">
                How to Play Temple Football 3D
              </h3>
              <ul className="space-y-2.5 text-xs text-[#D4D4D8] leading-relaxed">
                <li>
                  <strong className="text-[#FAFAFA]">1. Swipe to Shoot:</strong> Touch near the ball and swipe upward toward the goal. Fast swipes blast harder; curving your swipe left or right bends the ball around the wall!
                </li>
                <li>
                  <strong className="text-[#FAFAFA]">2. Goalkeeper Dives:</strong> When defending, tap or swipe Left, Right, or Up (or use the bottom glove buttons) to parry the shot.
                </li>
                <li>
                  <strong className="text-[#FAFAFA]">3. Game Modes:</strong> Play 5-kick Penalty Shootouts (+ Sudden Death) or 5-attempt Free Kick Challenges vs AI Bot (Easy/Med/Hard) or Online 2P Friends!
                </li>
              </ul>
              <button
                type="button"
                onClick={dismissTutorial}
                className="w-full min-h-[44px] rounded-xl bg-[#E5A93B] px-4 py-2.5 text-sm font-bold text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
              >
                Got It — Step Onto the Pitch
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
