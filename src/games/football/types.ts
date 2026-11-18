export type FootballGameMode = 'penalty' | 'freekick';
export type BotDifficulty = 'easy' | 'medium' | 'hard';
export type PlayMode = 'bot' | 'online';
export type PlayerRoleTurn = 'shooter' | 'keeper';

export type KeeperDiveDirection =
  | 'left'
  | 'up-left'
  | 'center'
  | 'up'
  | 'right'
  | 'up-right';

export type KickOutcome = 'goal' | 'saved' | 'post' | 'wall_block' | 'miss';

export interface ShotInput {
  aimX: number; // -1.35..1.35 (-1..1 aims inside goalposts)
  aimY: number; // 0..1.35 (0..1 aims ground to crossbar)
  power: number; // 0.35..1.0
  curve: number; // -1.0..1.0 (left/right curl)
  dip: number; // 0..1.0 (topspin dip)
}

export interface FreeKickSpot {
  x: number;
  z: number;
  distance: number;
  wallCenterX: number;
  wallCenterZ: number;
  wallAngleY: number;
}

export interface PhysicsFrame {
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spinX: number;
  spinY: number;
  spinZ: number;
}

export interface KeeperPlan {
  diveDir: KeeperDiveDirection;
  startX: number;
  targetX: number;
  targetY: number;
  reactionDelay: number;
  diveDuration: number;
}

export interface KickSimulationResult {
  outcome: KickOutcome;
  scored: boolean;
  hitWoodwork: boolean;
  hitWall: boolean;
  pointsAwarded: number;
  bonusLabels: string[];
  shotInput: ShotInput;
  keeperPlan: KeeperPlan;
  frames: PhysicsFrame[];
  woodworkHit: {
    time: number;
    x: number;
    y: number;
    z: number;
    part: 'left_post' | 'right_post' | 'crossbar';
  } | null;
  saveHit: { time: number; x: number; y: number; z: number } | null;
  wallHit: { time: number; x: number; y: number; z: number; defenderIndex: number } | null;
  netImpact: { time: number; x: number; y: number; z: number } | null;
}

export interface FootballAvatarOption {
  id: string;
  label: string;
  monogram: string;
  accentHex: string;
}

export const FOOTBALL_AVATARS: FootballAvatarOption[] = [
  { id: 'crown-gold', label: 'Temple Crown', monogram: 'TC', accentHex: '#E5A93B' },
  { id: 'lion-crest', label: 'Golden Lion', monogram: 'GL', accentHex: '#F59E0B' },
  { id: 'star-striker', label: 'Striker 9', monogram: '09', accentHex: '#FBBF24' },
  { id: 'titan-keeper', label: 'Wall 1', monogram: 'GK', accentHex: '#38BDF8' },
  { id: 'panther-dark', label: 'Obsidian XI', monogram: 'XI', accentHex: '#A855F7' },
  { id: 'phoenix-flame', label: 'Solar Flare', monogram: 'SF', accentHex: '#F97316' },
];

export interface FootballPlayerProfile {
  playerId: string;
  name: string;
  avatarId: string;
  wins: number;
  losses: number;
  goals: number;
  saves: number;
  bestFreeKickScore: number;
  updatedAt: string;
}

export interface FootballLeaderboardEntry {
  playerId: string;
  name: string;
  avatarId: string;
  wins: number;
  losses: number;
  goals: number;
  saves: number;
  bestFreeKickScore: number;
  updatedAt: string;
}

export interface OnlinePlayerState {
  playerId: string;
  name: string;
  avatarId: string;
  goals: number;
  freeKickScore: number;
  penaltyHistory: Array<'goal' | 'miss'>;
  connected: boolean;
  disconnectedAt: number | null;
  reconnectDeadlineAt: number | null;
}

export interface OnlineMatchRoomState {
  roomCode: string;
  mode: FootballGameMode;
  status: 'waiting' | 'active' | 'finished';
  players: OnlinePlayerState[];
  roundNumber: number;
  maxRounds: number;
  suddenDeath: boolean;
  shooterIndex: number;
  keeperIndex: number;
  spot: FreeKickSpot;
  turnDeadlineAt: number | null;
  shooterSubmitted: boolean;
  keeperSubmitted: boolean;
  winnerPlayerId: string | null;
  winReason: 'score' | 'opponent_forfeit' | null;
  lastResolution: {
    roundId: number;
    shooterId: string;
    keeperId: string;
    simulation: KickSimulationResult;
  } | null;
}
