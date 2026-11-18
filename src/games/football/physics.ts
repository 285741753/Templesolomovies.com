import type {
  BotDifficulty,
  FootballGameMode,
  FreeKickSpot,
  KeeperDiveDirection,
  KeeperPlan,
  KickSimulationResult,
  PhysicsFrame,
  ShotInput,
} from './types.ts';

export const GOAL_HALF_WIDTH = 3.66;
export const GOAL_HEIGHT = 2.44;
export const GOAL_NET_DEPTH = 2.2;
export const POST_RADIUS = 0.06;
export const BALL_RADIUS = 0.115;
export const PENALTY_SPOT_Z = 11.0;

const GRAVITY = -9.81;
const AIR_DRAG = 0.14;
const SUBSTEP_DT = 1 / 120;
const WALL_DEFENDER_OFFSETS = [-1.02, -0.34, 0.34, 1.02];

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function getPenaltySpot(): FreeKickSpot {
  return {
    x: 0,
    z: PENALTY_SPOT_Z,
    distance: PENALTY_SPOT_Z,
    wallCenterX: 0,
    wallCenterZ: 2.0,
    wallAngleY: 0,
  };
}

export function createRandomFreeKickSpot(seed?: number): FreeKickSpot {
  const randA =
    typeof seed === 'number'
      ? Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1
      : Math.random();
  const randB =
    typeof seed === 'number'
      ? Math.abs(Math.sin((seed + 17.3) * 78.233) * 24634.6345) % 1
      : Math.random();

  const distance = 18.5 + randA * 7.2; // 18.5m - 25.7m
  const lateralAngle = (randB - 0.5) * 0.56; // -0.28..+0.28 rad (~±16 deg)
  const x = Number((Math.sin(lateralAngle) * distance).toFixed(2));
  const z = Number((Math.cos(lateralAngle) * distance).toFixed(2));

  const len = Math.hypot(x, z) || 1;
  const dirX = -x / len;
  const dirZ = -z / len;
  const wallDist = 9.15;
  const wallCenterX = Number((x + dirX * wallDist).toFixed(2));
  const wallCenterZ = Number((z + dirZ * wallDist).toFixed(2));
  const wallAngleY = Math.atan2(x, z);

  return {
    x,
    z,
    distance: Number(Math.hypot(x, z).toFixed(1)),
    wallCenterX,
    wallCenterZ,
    wallAngleY,
  };
}

export function sanitizeShotInput(raw: Partial<ShotInput>): ShotInput {
  return {
    aimX: clamp(Number(raw.aimX) || 0, -1.35, 1.35),
    aimY: clamp(Number(raw.aimY) || 0.32, 0.0, 1.35),
    power: clamp(Number(raw.power) || 0.7, 0.35, 1.0),
    curve: clamp(Number(raw.curve) || 0, -1.0, 1.0),
    dip: clamp(Number(raw.dip) || 0.15, 0.0, 1.0),
  };
}

export function getKeeperDivePlan(
  diveDir: KeeperDiveDirection,
  startX: number,
  reactionDelay: number,
  diveSpeedScale: number
): KeeperPlan {
  let targetX = 0;
  let targetY = 0.85;
  switch (diveDir) {
    case 'left':
      targetX = -2.75;
      targetY = 0.72;
      break;
    case 'up-left':
      targetX = -2.85;
      targetY = 1.65;
      break;
    case 'right':
      targetX = 2.75;
      targetY = 0.72;
      break;
    case 'up-right':
      targetX = 2.85;
      targetY = 1.65;
      break;
    case 'up':
      targetX = 0;
      targetY = 1.78;
      break;
    case 'center':
    default:
      targetX = startX * 0.25;
      targetY = 0.92;
      break;
  }

  return {
    diveDir,
    startX,
    targetX,
    targetY,
    reactionDelay: clamp(reactionDelay, 0, 0.45),
    diveDuration: clamp(0.46 / clamp(diveSpeedScale, 0.65, 1.35), 0.32, 0.75),
  };
}

export function sampleKeeperPoseAtTime(
  plan: KeeperPlan,
  t: number
): { x: number; y: number; z: number; progress: number } {
  const activeTime = Math.max(0, t - plan.reactionDelay);
  const rawProgress = clamp(activeTime / plan.diveDuration, 0, 1);
  // Ease out cubic for realistic explosive dive
  const progress = 1 - Math.pow(1 - rawProgress, 3);
  const x = plan.startX + (plan.targetX - plan.startX) * progress;
  const arcLift = plan.diveDir === 'center' ? 0 : Math.sin(rawProgress * Math.PI) * 0.26;
  const y = 0.92 + (plan.targetY - 0.92) * progress + arcLift;
  return { x, y, z: 0.32, progress };
}

export function getWallDefenderHeightOffset(t: number): number {
  if (t < 0.08 || t > 0.78) return 0;
  const u = (t - 0.08) / 0.7;
  return Math.sin(u * Math.PI) * 0.56;
}

export function decideBotKeeperPlan(
  shot: ShotInput,
  difficulty: BotDifficulty,
  spot: FreeKickSpot,
  mode: FootballGameMode
): KeeperPlan {
  // Bias keeper slightly toward the open side on free kicks
  const startX =
    mode === 'freekick' ? clamp(-Math.sign(spot.x || 1) * 0.65, -0.85, 0.85) : 0;

  let readAccuracy = 0.35;
  let reactionDelay = 0.24;
  let diveSpeedScale = 0.82;

  if (difficulty === 'medium') {
    readAccuracy = 0.58;
    reactionDelay = 0.14;
    diveSpeedScale = 1.0;
  } else if (difficulty === 'hard') {
    readAccuracy = 0.76;
    reactionDelay = 0.08;
    diveSpeedScale = 1.18;
  }

  const dirs: KeeperDiveDirection[] = ['left', 'up-left', 'center', 'up', 'right', 'up-right'];
  let chosenDir: KeeperDiveDirection = 'center';

  if (Math.random() < readAccuracy) {
    // Read intended corner (weighted so hard bot still gets fooled by curved kicks!)
    const effectiveAim = shot.aimX + shot.curve * (difficulty === 'hard' ? 0.14 : 0.04);
    if (effectiveAim < -0.3) {
      chosenDir = shot.aimY > 0.52 ? 'up-left' : 'left';
    } else if (effectiveAim > 0.3) {
      chosenDir = shot.aimY > 0.52 ? 'up-right' : 'right';
    } else {
      chosenDir = shot.aimY > 0.6 ? 'up' : 'center';
    }
  } else {
    chosenDir = dirs[Math.floor(Math.random() * dirs.length)];
  }

  return getKeeperDivePlan(chosenDir, startX, reactionDelay, diveSpeedScale);
}

export function generateBotShot(
  difficulty: BotDifficulty,
  mode: FootballGameMode,
  spot: FreeKickSpot
): ShotInput {
  const cornerChoices = [-0.88, -0.72, -0.45, 0.0, 0.45, 0.72, 0.88];
  const baseAim = cornerChoices[Math.floor(Math.random() * cornerChoices.length)];
  const jitter =
    difficulty === 'easy'
      ? (Math.random() - 0.5) * 0.7
      : difficulty === 'medium'
        ? (Math.random() - 0.5) * 0.34
        : (Math.random() - 0.5) * 0.16;

  const aimX = clamp(baseAim + jitter, -1.16, 1.16);
  const aimY = clamp(
    difficulty === 'easy'
      ? 0.22 + Math.random() * 0.65
      : difficulty === 'medium'
        ? 0.18 + Math.random() * 0.68
        : 0.15 + Math.random() * 0.76,
    0.08,
    1.12
  );
  const power =
    difficulty === 'easy'
      ? 0.52 + Math.random() * 0.25
      : difficulty === 'medium'
        ? 0.68 + Math.random() * 0.22
        : 0.78 + Math.random() * 0.2;

  let curve = (Math.random() - 0.5) * (difficulty === 'easy' ? 0.25 : 0.75);
  if (mode === 'freekick') {
    // Curl around the wall on free kicks
    curve = spot.x >= 0 ? -0.55 - Math.random() * 0.35 : 0.55 + Math.random() * 0.35;
  }

  return sanitizeShotInput({
    aimX,
    aimY,
    power,
    curve,
    dip: difficulty === 'hard' ? 0.55 : 0.28,
  });
}

function collideCylinderPost(
  px: number,
  pz: number,
  vx: number,
  vz: number,
  cx: number,
  cz: number,
  combinedR: number
): { hit: boolean; px: number; pz: number; vx: number; vz: number } {
  const dx = px - cx;
  const dz = pz - cz;
  const distSq = dx * dx + dz * dz;
  if (distSq >= combinedR * combinedR || distSq < 1e-8) {
    return { hit: false, px, pz, vx, vz };
  }
  const dist = Math.sqrt(distSq);
  const nx = dx / dist;
  const nz = dz / dist;
  const dot = vx * nx + vz * nz;
  if (dot >= 0) {
    return { hit: false, px, pz, vx, vz };
  }
  const restitution = 0.72;
  return {
    hit: true,
    px: cx + nx * (combinedR + 0.004),
    pz: cz + nz * (combinedR + 0.004),
    vx: vx - (1 + restitution) * dot * nx,
    vz: vz - (1 + restitution) * dot * nz,
  };
}

export function simulateKick(params: {
  mode: FootballGameMode;
  spot: FreeKickSpot;
  shotInput: ShotInput;
  keeperPlan: KeeperPlan;
}): KickSimulationResult {
  const { mode, spot } = params;
  const shot = sanitizeShotInput(params.shotInput);
  const keeperPlan = params.keeperPlan;

  const targetX = shot.aimX * 3.56;
  const targetY = clamp(0.18 + shot.aimY * 2.24, 0.14, 3.6);
  const targetZ = 0;

  const dx = targetX - spot.x;
  const dz = targetZ - spot.z;
  const horizDist = Math.hypot(dx, dz) || 1;
  const dirX = dx / horizDist;
  const dirZ = dz / horizDist;

  // Base launch speed calibrated realistically for penalties vs free kicks
  const minSpeed = mode === 'penalty' ? 21.5 : 23.0;
  const maxSpeed = mode === 'penalty' ? 33.5 : 35.8;
  const speed = minSpeed + shot.power * (maxSpeed - minSpeed);

  const estFlightTime = horizDist / (speed * 0.94);

  // Compensate slightly so the player's aim hits close to target while curve bends noticeably
  const launchVy =
    (targetY - BALL_RADIUS - 0.5 * GRAVITY * estFlightTime * estFlightTime * (0.72 - shot.dip * 0.18)) /
    Math.max(estFlightTime, 0.25);

  const magnusLateralCoeff = (mode === 'freekick' ? 4.8 : 3.2) * shot.curve;
  const magnusDipCoeff = (mode === 'freekick' ? 3.8 : 2.3) * shot.dip;

  let x = spot.x;
  let y = BALL_RADIUS;
  let z = spot.z;

  // Slight curve compensation so curved free kicks bend around the wall back toward target
  let vx = dirX * speed - shot.curve * (mode === 'freekick' ? 1.8 : 0.9);
  let vy = clamp(launchVy, 1.2, 16.5);
  let vz = dirZ * speed;

  const spinX = -speed * 0.7 - shot.dip * 14;
  const spinY = shot.curve * 22;
  const spinZ = -shot.curve * 6;

  // Precompute wall defender centers
  const wallLen = Math.hypot(spot.wallCenterX - spot.x, spot.wallCenterZ - spot.z) || 1;
  const wFwdX = (spot.wallCenterX - spot.x) / wallLen;
  const wFwdZ = (spot.wallCenterZ - spot.z) / wallLen;
  const wRightX = -wFwdZ;
  const wRightZ = wFwdX;

  const wallDefenders = WALL_DEFENDER_OFFSETS.map((offset, idx) => ({
    index: idx,
    x: spot.wallCenterX + wRightX * offset,
    z: spot.wallCenterZ + wRightZ * offset,
  }));

  const frames: PhysicsFrame[] = [
    { t: 0, x, y, z, vx, vy, vz, spinX, spinY, spinZ },
  ];

  let woodworkHit: KickSimulationResult['woodworkHit'] = null;
  let saveHit: KickSimulationResult['saveHit'] = null;
  let wallHit: KickSimulationResult['wallHit'] = null;
  let netImpact: KickSimulationResult['netImpact'] = null;
  let outcome: KickSimulationResult['outcome'] = 'miss';
  let goalScored = false;
  let sampleCounter = 0;

  const maxSimTime = 2.6;
  const totalSteps = Math.round(maxSimTime / SUBSTEP_DT);

  for (let step = 1; step <= totalSteps; step++) {
    const t = step * SUBSTEP_DT;

    // Speed-dependent aerodynamic drag + Magnus forces
    const curSpeed = Math.hypot(vx, vy, vz);
    const dragFactor = Math.max(0, 1 - AIR_DRAG * SUBSTEP_DT * (0.4 + 0.03 * curSpeed));
    vx *= dragFactor;
    vy *= dragFactor;
    vz *= dragFactor;

    const lateralCurveAccel = magnusLateralCoeff * (curSpeed / 26);
    const dipAccel = -magnusDipCoeff * (curSpeed / 26);

    vx += lateralCurveAccel * SUBSTEP_DT;
    vy += (GRAVITY + dipAccel) * SUBSTEP_DT;

    x += vx * SUBSTEP_DT;
    y += vy * SUBSTEP_DT;
    z += vz * SUBSTEP_DT;

    // Ground bounce
    if (y < BALL_RADIUS) {
      y = BALL_RADIUS;
      if (vy < -0.5) {
        vy = -vy * 0.56;
        vx *= 0.88;
        vz *= 0.88;
      } else {
        vy = 0;
        vx *= 0.985;
        vz *= 0.985;
      }
    }

    // 1. Defensive wall collision (Free Kick Challenge only)
    if (mode === 'freekick' && !wallHit && !goalScored && z > 2.0) {
      const jumpHeight = getWallDefenderHeightOffset(t);
      const wallTop = 1.78 + jumpHeight;
      for (const def of wallDefenders) {
        const dxW = x - def.x;
        const dzW = z - def.z;
        const distHoriz = Math.hypot(dxW, dzW);
        if (distHoriz < 0.27 + BALL_RADIUS && y <= wallTop + BALL_RADIUS) {
          const nx = distHoriz > 1e-4 ? dxW / distHoriz : 0;
          const nz = distHoriz > 1e-4 ? dzW / distHoriz : 1;
          const dot = vx * nx + vz * nz;
          if (dot < 0) {
            vx = (vx - 1.55 * dot * nx) * 0.55 + (Math.random() - 0.5) * 1.4;
            vz = (vz - 1.55 * dot * nz) * 0.55;
            vy = Math.abs(vy) * 0.4 + 2.4;
            wallHit = { time: t, x, y, z, defenderIndex: def.index };
            outcome = 'wall_block';
            break;
          }
        }
      }
    }

    // 2. Goalposts & Crossbar collisions
    if (!goalScored) {
      const postCombinedR = POST_RADIUS + BALL_RADIUS;
      if (y <= GOAL_HEIGHT + POST_RADIUS) {
        // Left post
        const leftRes = collideCylinderPost(x, z, vx, vz, -GOAL_HALF_WIDTH, 0, postCombinedR);
        if (leftRes.hit) {
          x = leftRes.px;
          z = leftRes.pz;
          vx = leftRes.vx;
          vz = leftRes.vz;
          if (!woodworkHit) {
            woodworkHit = { time: t, x, y, z, part: 'left_post' };
          }
          if (outcome === 'miss') outcome = 'post';
        }
        // Right post
        const rightRes = collideCylinderPost(x, z, vx, vz, GOAL_HALF_WIDTH, 0, postCombinedR);
        if (rightRes.hit) {
          x = rightRes.px;
          z = rightRes.pz;
          vx = rightRes.vx;
          vz = rightRes.vz;
          if (!woodworkHit) {
            woodworkHit = { time: t, x, y, z, part: 'right_post' };
          }
          if (outcome === 'miss') outcome = 'post';
        }
      }

      // Crossbar cylinder along X at (y = GOAL_HEIGHT, z = 0)
      if (Math.abs(x) <= GOAL_HALF_WIDTH + POST_RADIUS) {
        const dyC = y - GOAL_HEIGHT;
        const dzC = z;
        const distSqC = dyC * dyC + dzC * dzC;
        if (distSqC < postCombinedR * postCombinedR && distSqC > 1e-8) {
          const distC = Math.sqrt(distSqC);
          const ny = dyC / distC;
          const nz = dzC / distC;
          const dot = vy * ny + vz * nz;
          if (dot < 0) {
            y = GOAL_HEIGHT + ny * (postCombinedR + 0.004);
            z = nz * (postCombinedR + 0.004);
            vy = vy - 1.72 * dot * ny;
            vz = vz - 1.72 * dot * nz;
            if (!woodworkHit) {
              woodworkHit = { time: t, x, y, z, part: 'crossbar' };
            }
            if (outcome === 'miss') outcome = 'post';
          }
        }
      }
    }

    // 3. Goalkeeper save collision near goal line (z in [-0.1, 0.72])
    if (!saveHit && !goalScored && z <= 0.68 && z >= -0.05 && vz < 0) {
      const keeper = sampleKeeperPoseAtTime(keeperPlan, t);
      const reachX = keeperPlan.diveDir === 'center' || keeperPlan.diveDir === 'up' ? 0.56 : 0.92;
      const reachY = 0.76;
      const normDistSq =
        Math.pow((x - keeper.x) / reachX, 2) +
        Math.pow((y - keeper.y) / reachY, 2) +
        Math.pow((z - keeper.z) / 0.45, 2);

      if (normDistSq <= 1.0) {
        saveHit = { time: t, x, y, z };
        outcome = 'saved';
        // Parry ball outward & upward realistically
        const parrySignX = x >= keeper.x ? 1 : -1;
        vx = parrySignX * (3.5 + Math.abs(vx) * 0.45);
        vy = Math.max(2.2, Math.abs(vy) * 0.6 + 2.8);
        vz = Math.abs(vz) * 0.42 + 4.5;
      }
    }

    // 4. Check Goal Line Crossing
    if (
      !goalScored &&
      !saveHit &&
      z < -BALL_RADIUS &&
      Math.abs(x) < GOAL_HALF_WIDTH - BALL_RADIUS * 0.5 &&
      y < GOAL_HEIGHT - BALL_RADIUS * 0.35
    ) {
      goalScored = true;
      outcome = 'goal';
    }

    // 5. Net containment & damping inside the goal cage
    if (goalScored) {
      if (z < -GOAL_NET_DEPTH + BALL_RADIUS) {
        z = -GOAL_NET_DEPTH + BALL_RADIUS;
        if (!netImpact) {
          netImpact = { time: t, x, y, z };
        }
        vz = -vz * 0.16;
        vx *= 0.45;
        vy *= 0.45;
      }
      if (x < -GOAL_HALF_WIDTH + BALL_RADIUS) {
        x = -GOAL_HALF_WIDTH + BALL_RADIUS;
        if (!netImpact) {
          netImpact = { time: t, x, y, z };
        }
        vx = -vx * 0.25;
      }
      if (x > GOAL_HALF_WIDTH - BALL_RADIUS) {
        x = GOAL_HALF_WIDTH - BALL_RADIUS;
        if (!netImpact) {
          netImpact = { time: t, x, y, z };
        }
        vx = -vx * 0.25;
      }
      if (y > GOAL_HEIGHT - BALL_RADIUS && z < 0) {
        y = GOAL_HEIGHT - BALL_RADIUS;
        if (!netImpact) {
          netImpact = { time: t, x, y, z };
        }
        vy = -vy * 0.2;
      }
    }

    // Sample every 2 substeps (60Hz)
    sampleCounter++;
    if (sampleCounter % 2 === 0 || step === totalSteps) {
      frames.push({ t, x, y, z, vx, vy, vz, spinX, spinY, spinZ });
    }
  }

  // Points calculation for Free Kick Challenge (and highlight bonus labels)
  const bonusLabels: string[] = [];
  let pointsAwarded = 0;

  if (goalScored) {
    pointsAwarded = 100;
    const impactX = netImpact?.x ?? targetX;
    const impactY = netImpact?.y ?? targetY;

    if (Math.abs(impactX) > 2.4 && impactY > 1.55) {
      pointsAwarded += 50;
      bonusLabels.push('Top Corner +50');
    } else if (Math.abs(impactX) > 2.55) {
      pointsAwarded += 30;
      bonusLabels.push('Side Netting +30');
    }

    if (woodworkHit) {
      pointsAwarded += 35;
      bonusLabels.push('Off the Woodwork +35');
    }

    if (mode === 'freekick') {
      if (Math.abs(shot.curve) >= 0.45) {
        pointsAwarded += 25;
        bonusLabels.push('Banana Curl +25');
      }
      if (spot.distance >= 23) {
        pointsAwarded += 25;
        bonusLabels.push('Long Range +25');
      }
    }
  } else if (woodworkHit) {
    pointsAwarded = mode === 'freekick' ? 15 : 0;
    bonusLabels.push('Hit the Woodwork');
  } else if (outcome === 'saved') {
    bonusLabels.push('Keeper Save');
  } else if (outcome === 'wall_block') {
    bonusLabels.push('Blocked by Wall');
  } else {
    bonusLabels.push('Off Target');
  }

  return {
    outcome,
    scored: goalScored,
    hitWoodwork: Boolean(woodworkHit),
    hitWall: Boolean(wallHit),
    pointsAwarded,
    bonusLabels,
    shotInput: shot,
    keeperPlan,
    frames,
    woodworkHit,
    saveHit,
    wallHit,
    netImpact,
  };
}
