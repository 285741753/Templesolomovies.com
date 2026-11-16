import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

function safeComputeTangents(geometry: THREE.BufferGeometry): void {
  if (
    geometry.index &&
    geometry.attributes.position &&
    geometry.attributes.normal &&
    geometry.attributes.uv
  ) {
    geometry.computeTangents();
  }
}

export type ProjectorFinish = 'brass' | 'obsidian' | 'silver';

export interface ProjectorPartInfo {
  id: string;
  label: string;
  spec: string;
}

export const PROJECTOR_PARTS: Record<string, ProjectorPartInfo> = {
  base: {
    id: 'base',
    label: 'Cast-Iron Plinth & Tilt Yoke',
    spec: 'Precision-damped cast-iron pedestal with calibrated azimuth base.',
  },
  body: {
    id: 'body',
    label: '35mm Gate & Shutter Mechanism',
    spec: 'Geneva-drive intermittent claw mechanism locking each frame at 24 fps.',
  },
  lamp: {
    id: 'lamp',
    label: 'Xenon Arc Lamp Housing',
    spec: 'Finned anodized chimney dissipating 2,500 W of stabilized projection arc heat.',
  },
  lens: {
    id: 'lens',
    label: 'Anamorphic Optical Prime Lens',
    spec: 'Multi-coated sapphire optical assembly (1.85:1 / 2.39:1 scope throw).',
  },
  upperReel: {
    id: 'upperReel',
    label: 'Upper 35mm Feed Reel',
    spec: '2,000 ft perforated acetate print supply spool on sealed bearings.',
  },
  lowerReel: {
    id: 'lowerReel',
    label: 'Lower Take-Up Reel',
    spec: 'Friction-clutched take-up spool maintaining constant film tension.',
  },
  screen: {
    id: 'screen',
    label: 'Silver Vault Projection Screen',
    spec: 'Perforated theatrical screen rendering live celluloid projection.',
  },
};

export interface BuiltProjectorScene {
  root: THREE.Group;
  upperReel: THREE.Group;
  lowerReel: THREE.Group;
  lensGroup: THREE.Group;
  lampGroup: THREE.Group;
  screenGroup: THREE.Group;
  beamMesh: THREE.Mesh;
  screenTexture: THREE.CanvasTexture;
  drawScreenFrame: (elapsedSeconds: number) => void;
  clickableMeshes: THREE.Object3D[];
  applyFinish: (finish: ProjectorFinish) => void;
  setExplodeAmount: (t: number) => void;
  dispose: () => void;
}

function createStageFloorTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0c0c10';
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = 'rgba(229, 169, 59, 0.14)';
  ctx.lineWidth = 1;
  const step = 32;
  for (let i = 0; i <= 512; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(229, 169, 59, 0.28)';
  ctx.beginPath();
  ctx.arc(256, 256, 175, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createFilmReelTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#18181b';
  ctx.fillRect(0, 0, 256, 256);

  // Concentric film wrap rings
  for (let r = 36; r < 116; r += 4) {
    ctx.strokeStyle = r % 8 === 0 ? '#2f271e' : '#121215';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(128, 128, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 16, 128, 128, 124);
  grad.addColorStop(0, 'rgba(0,0,0,0.85)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.38)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildProjectorStage(
  isSoftwareGl: boolean,
  maxAnisotropy: number
): BuiltProjectorScene {
  const root = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const clickableMeshes: THREE.Object3D[] = [];

  const registerPart = (obj: THREE.Object3D, partId: string) => {
    obj.userData.partId = partId;
    obj.layers.enable(1);
    clickableMeshes.push(obj);
  };

  // Materials
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#202229'),
    metalness: 0.72,
    roughness: 0.42,
    clearcoat: 0.25,
    clearcoatRoughness: 0.35,
  });

  const accentMetalMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#e5a93b'),
    metalness: 0.94,
    roughness: 0.16,
    anisotropy: 0.78,
    anisotropyRotation: Math.PI / 4,
  });

  const darkCastIronMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#131418'),
    metalness: 0.45,
    roughness: 0.78,
  });

  const lensBarrelMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#27272f'),
    metalness: 0.88,
    roughness: 0.22,
  });

  const opticalGlassMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#b8dcff'),
    metalness: 0.05,
    roughness: 0.04,
    transmission: isSoftwareGl ? 0 : 0.92,
    transparent: true,
    opacity: isSoftwareGl ? 0.42 : 1,
    ior: 1.58,
    thickness: 0.8,
    clearcoat: 1,
  });

  const filmWrapTex = createFilmReelTexture(maxAnisotropy);
  const floorTex = createStageFloorTexture(maxAnisotropy);
  const contactTex = createContactShadowTexture();
  disposables.push(
    bodyMaterial,
    accentMetalMat,
    darkCastIronMat,
    lensBarrelMat,
    opticalGlassMat,
    filmWrapTex,
    floorTex,
    contactTex
  );

  const filmWrapMat = new THREE.MeshStandardMaterial({
    map: filmWrapTex,
    roughness: 0.55,
    metalness: 0.15,
  });
  disposables.push(filmWrapMat);

  // Studio floor pedestal
  const floorGeo = new THREE.CircleGeometry(7.2, 64);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex,
    roughness: 0.72,
    metalness: 0.18,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = -0.02;
  floorMesh.receiveShadow = true;
  root.add(floorMesh);
  disposables.push(floorGeo, floorMat);

  // Contact shadow grounding plane
  const shadowGeo = new THREE.PlaneGeometry(4.4, 3.4);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: contactTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.55,
  });
  const contactPlane = new THREE.Mesh(shadowGeo, shadowMat);
  contactPlane.rotation.x = -Math.PI / 2;
  contactPlane.position.set(-0.35, 0.005, 0);
  root.add(contactPlane);
  disposables.push(shadowGeo, shadowMat);

  // Projector Assembly Group (grounded at y = 0)
  const projectorGroup = new THREE.Group();
  projectorGroup.position.set(-0.85, 0, 0);
  root.add(projectorGroup);

  // 1. Cast-iron Plinth & Tilt Yoke
  const baseGroup = new THREE.Group();
  const footGeo = new THREE.BoxGeometry(1.55, 0.18, 0.96);
  const footMesh = new THREE.Mesh(footGeo, darkCastIronMat);
  footMesh.position.y = 0.09;
  footMesh.castShadow = true;
  footMesh.receiveShadow = true;
  registerPart(footMesh, 'base');

  const columnGeo = new THREE.CylinderGeometry(0.18, 0.28, 0.78, 24);
  const columnMesh = new THREE.Mesh(columnGeo, darkCastIronMat);
  columnMesh.position.y = 0.54;
  columnMesh.castShadow = true;
  registerPart(columnMesh, 'base');

  const yokeRingGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.16, 24);
  const yokeRing = new THREE.Mesh(yokeRingGeo, accentMetalMat);
  yokeRing.position.y = 0.96;
  yokeRing.castShadow = true;
  registerPart(yokeRing, 'base');

  baseGroup.add(footMesh, columnMesh, yokeRing);
  projectorGroup.add(baseGroup);
  disposables.push(footGeo, columnGeo, yokeRingGeo);

  // 2. Main 35mm Film Gate Housing (beveled ExtrudeGeometry)
  const bodyShape = new THREE.Shape();
  bodyShape.moveTo(-0.52, -0.36);
  bodyShape.lineTo(0.48, -0.36);
  bodyShape.lineTo(0.56, 0.34);
  bodyShape.lineTo(-0.46, 0.42);
  bodyShape.closePath();

  const rawBodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
    depth: 0.48,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.035,
    bevelSegments: 3,
  });
  rawBodyGeo.center();
  const bodyGeo = mergeVertices(rawBodyGeo);
  rawBodyGeo.dispose();
  safeComputeTangents(bodyGeo);
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMaterial);
  bodyMesh.position.set(0.05, 1.38, 0);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  registerPart(bodyMesh, 'body');
  projectorGroup.add(bodyMesh);
  disposables.push(bodyGeo);

  // Side inspection plate + brass thumbscrews
  const plateGeo = new THREE.BoxGeometry(0.62, 0.42, 0.04);
  const sidePlate = new THREE.Mesh(plateGeo, darkCastIronMat);
  sidePlate.position.set(0.04, 1.38, 0.3);
  registerPart(sidePlate, 'body');

  const knobGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.06, 16);
  knobGeo.rotateX(Math.PI / 2);
  const knob1 = new THREE.Mesh(knobGeo, accentMetalMat);
  knob1.position.set(-0.2, 1.5, 0.33);
  const knob2 = new THREE.Mesh(knobGeo, accentMetalMat);
  knob2.position.set(0.28, 1.26, 0.33);
  registerPart(knob1, 'body');
  registerPart(knob2, 'body');
  projectorGroup.add(sidePlate, knob1, knob2);
  disposables.push(plateGeo, knobGeo);

  // 3. Xenon Arc Lamp House & Cooling Chimney
  const lampGroup = new THREE.Group();
  lampGroup.position.set(-0.78, 1.4, 0);

  const lampChamberGeo = new THREE.BoxGeometry(0.68, 0.62, 0.56);
  const lampChamber = new THREE.Mesh(lampChamberGeo, darkCastIronMat);
  lampChamber.castShadow = true;
  registerPart(lampChamber, 'lamp');
  lampGroup.add(lampChamber);

  const ventRingGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.28, 20);
  const ventStack = new THREE.Mesh(ventRingGeo, accentMetalMat);
  ventStack.position.y = 0.44;
  ventStack.castShadow = true;
  registerPart(ventStack, 'lamp');
  lampGroup.add(ventStack);

  const finGeo = new THREE.BoxGeometry(0.56, 0.03, 0.6);
  for (let i = -2; i <= 2; i++) {
    const fin = new THREE.Mesh(finGeo, bodyMaterial);
    fin.position.y = i * 0.1;
    registerPart(fin, 'lamp');
    lampGroup.add(fin);
  }
  projectorGroup.add(lampGroup);
  disposables.push(lampChamberGeo, ventRingGeo, finGeo);

  // 4. Stepped Anamorphic Lens Barrel (LatheGeometry + optical front lens)
  const lensGroup = new THREE.Group();
  lensGroup.position.set(0.78, 1.42, 0);

  const lathePts = [
    new THREE.Vector2(0.01, -0.25),
    new THREE.Vector2(0.19, -0.25),
    new THREE.Vector2(0.19, 0.0),
    new THREE.Vector2(0.22, 0.04),
    new THREE.Vector2(0.22, 0.24),
    new THREE.Vector2(0.26, 0.28),
    new THREE.Vector2(0.26, 0.44),
    new THREE.Vector2(0.21, 0.44),
    new THREE.Vector2(0.21, 0.36),
  ];
  const barrelGeo = new THREE.LatheGeometry(lathePts, 32);
  barrelGeo.rotateZ(-Math.PI / 2);
  safeComputeTangents(barrelGeo);
  const barrelMesh = new THREE.Mesh(barrelGeo, lensBarrelMat);
  barrelMesh.castShadow = true;
  registerPart(barrelMesh, 'lens');

  const focusCollarGeo = new THREE.CylinderGeometry(0.235, 0.235, 0.08, 32);
  focusCollarGeo.rotateZ(Math.PI / 2);
  const focusCollar = new THREE.Mesh(focusCollarGeo, accentMetalMat);
  focusCollar.position.x = 0.14;
  registerPart(focusCollar, 'lens');

  const frontLensGeo = new THREE.SphereGeometry(0.2, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.42);
  frontLensGeo.rotateZ(-Math.PI / 2);
  const frontLens = new THREE.Mesh(frontLensGeo, opticalGlassMat);
  frontLens.position.x = 0.34;
  registerPart(frontLens, 'lens');

  lensGroup.add(barrelMesh, focusCollar, frontLens);
  projectorGroup.add(lensGroup);
  disposables.push(barrelGeo, focusCollarGeo, frontLensGeo);

  // Helper to construct slotted 35mm Reel
  const buildReel = (partId: string): THREE.Group => {
    const reel = new THREE.Group();

    const flangeGeo = new THREE.CylinderGeometry(0.56, 0.56, 0.025, 36);
    flangeGeo.rotateX(Math.PI / 2);

    const frontFlange = new THREE.Mesh(flangeGeo, accentMetalMat);
    frontFlange.position.z = 0.085;
    frontFlange.castShadow = true;
    registerPart(frontFlange, partId);

    const backFlange = new THREE.Mesh(flangeGeo, accentMetalMat);
    backFlange.position.z = -0.085;
    backFlange.castShadow = true;
    registerPart(backFlange, partId);

    const filmRollGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.14, 32);
    filmRollGeo.rotateX(Math.PI / 2);
    const filmRoll = new THREE.Mesh(filmRollGeo, filmWrapMat);
    registerPart(filmRoll, partId);

    const hubGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.22, 20);
    hubGeo.rotateX(Math.PI / 2);
    const hub = new THREE.Mesh(hubGeo, darkCastIronMat);
    registerPart(hub, partId);

    // 4 Radial ribs for unmistakable silhouette spin feedback
    const spokeGeo = new THREE.BoxGeometry(0.92, 0.055, 0.035);
    for (let s = 0; s < 2; s++) {
      const spoke = new THREE.Mesh(spokeGeo, darkCastIronMat);
      spoke.position.z = 0.095;
      spoke.rotation.z = (s * Math.PI) / 2;
      registerPart(spoke, partId);
      reel.add(spoke);
    }

    reel.add(frontFlange, backFlange, filmRoll, hub);
    disposables.push(flangeGeo, filmRollGeo, hubGeo, spokeGeo);
    return reel;
  };

  // 5. Upper & Lower 35mm Reels + Mounting Arms
  const armGeo = new THREE.BoxGeometry(0.1, 0.65, 0.08);
  const upperArm = new THREE.Mesh(armGeo, darkCastIronMat);
  upperArm.position.set(0.02, 2.02, -0.14);
  upperArm.rotation.z = 0.24;
  registerPart(upperArm, 'body');

  const lowerArm = new THREE.Mesh(armGeo, darkCastIronMat);
  lowerArm.position.set(0.28, 0.92, -0.14);
  lowerArm.rotation.z = -0.45;
  registerPart(lowerArm, 'body');
  projectorGroup.add(upperArm, lowerArm);
  disposables.push(armGeo);

  const upperReel = buildReel('upperReel');
  upperReel.position.set(-0.08, 2.34, 0.02);

  const lowerReel = buildReel('lowerReel');
  lowerReel.position.set(0.46, 0.64, 0.02);

  projectorGroup.add(upperReel, lowerReel);

  // 6. Volumetric Light Cone
  const beamGeo = new THREE.ConeGeometry(0.95, 3.05, 32, 1, true);
  beamGeo.rotateZ(Math.PI / 2);
  const beamMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ffd98c'),
    transparent: true,
    opacity: 0.09,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const beamMesh = new THREE.Mesh(beamGeo, beamMat);
  beamMesh.position.set(1.78, 1.42, 0);
  root.add(beamMesh);
  disposables.push(beamGeo, beamMat);

  // 7. Cinema Vault Projection Screen Canvas
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 512;
  screenCanvas.height = 288;
  const sCtx = screenCanvas.getContext('2d')!;
  const screenTexture = new THREE.CanvasTexture(screenCanvas);
  screenTexture.colorSpace = THREE.SRGBColorSpace;
  screenTexture.anisotropy = maxAnisotropy;

  const drawScreenFrame = (elapsedSeconds: number) => {
    const w = 512;
    const h = 288;
    const grad = sCtx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#09090b');
    grad.addColorStop(0.5, '#1b150e');
    grad.addColorStop(1, '#0d111a');
    sCtx.fillStyle = grad;
    sCtx.fillRect(0, 0, w, h);

    // Subtle film sweep lines
    const sweepY = ((elapsedSeconds * 48) % (h + 40)) - 20;
    const sweepGrad = sCtx.createLinearGradient(0, sweepY - 20, 0, sweepY + 20);
    sweepGrad.addColorStop(0, 'rgba(229,169,59,0)');
    sweepGrad.addColorStop(0.5, 'rgba(229,169,59,0.16)');
    sweepGrad.addColorStop(1, 'rgba(229,169,59,0)');
    sCtx.fillStyle = sweepGrad;
    sCtx.fillRect(0, sweepY - 20, w, 40);

    // Letterbox border
    sCtx.strokeStyle = 'rgba(229,169,59,0.75)';
    sCtx.lineWidth = 3;
    sCtx.strokeRect(18, 24, w - 36, h - 48);

    // Film countdown circle
    const cx = w / 2;
    const cy = h / 2 - 8;
    const angle = (elapsedSeconds * 2.2) % (Math.PI * 2);
    sCtx.strokeStyle = 'rgba(229,169,59,0.35)';
    sCtx.lineWidth = 2;
    sCtx.beginPath();
    sCtx.arc(cx, cy, 46, 0, Math.PI * 2);
    sCtx.stroke();

    sCtx.strokeStyle = '#E5A93B';
    sCtx.lineWidth = 3;
    sCtx.beginPath();
    sCtx.arc(cx, cy, 46, -Math.PI / 2, -Math.PI / 2 + angle);
    sCtx.stroke();

    sCtx.fillStyle = '#FAFAFA';
    sCtx.font = 'bold 20px sans-serif';
    sCtx.textAlign = 'center';
    sCtx.fillText('TEMPLE CINEMA VAULT', cx, cy + 6);

    sCtx.fillStyle = '#E5A93B';
    sCtx.font = '12px monospace';
    sCtx.fillText(`24 FPS · 35MM ARCHIVE PROJECTION · T+${elapsedSeconds.toFixed(1)}S`, cx, h - 38);

    screenTexture.needsUpdate = true;
  };
  drawScreenFrame(0);

  const screenGroup = new THREE.Group();
  screenGroup.position.set(2.48, 1.42, 0);
  screenGroup.rotation.y = -Math.PI / 2;

  const frameGeo = new THREE.BoxGeometry(2.65, 1.56, 0.08);
  const frameMesh = new THREE.Mesh(frameGeo, darkCastIronMat);
  frameMesh.castShadow = true;
  registerPart(frameMesh, 'screen');

  const canvasGeo = new THREE.PlaneGeometry(2.45, 1.38);
  const canvasMat = new THREE.MeshBasicMaterial({
    map: screenTexture,
  });
  const canvasMesh = new THREE.Mesh(canvasGeo, canvasMat);
  canvasMesh.position.z = 0.045;
  registerPart(canvasMesh, 'screen');

  const standPostGeo = new THREE.CylinderGeometry(0.04, 0.06, 0.72, 16);
  const standPost = new THREE.Mesh(standPostGeo, darkCastIronMat);
  standPost.position.y = -1.08;
  registerPart(standPost, 'screen');

  screenGroup.add(frameMesh, canvasMesh, standPost);
  root.add(screenGroup);
  disposables.push(screenTexture, frameGeo, canvasGeo, canvasMat, standPostGeo);

  const applyFinish = (finish: ProjectorFinish) => {
    if (finish === 'brass') {
      bodyMaterial.color.set('#202229');
      accentMetalMat.color.set('#e5a93b');
      accentMetalMat.roughness = 0.16;
    } else if (finish === 'obsidian') {
      bodyMaterial.color.set('#121216');
      accentMetalMat.color.set('#9ca3af');
      accentMetalMat.roughness = 0.24;
    } else {
      bodyMaterial.color.set('#4b5563');
      accentMetalMat.color.set('#f8fafc');
      accentMetalMat.roughness = 0.14;
    }
  };

  const setExplodeAmount = (t: number) => {
    lensGroup.position.x = 0.78 + t * 0.62;
    lampGroup.position.x = -0.78 - t * 0.55;
    upperReel.position.y = 2.34 + t * 0.45;
    lowerReel.position.y = 0.64 - t * 0.18;
    sidePlate.position.z = 0.3 + t * 0.45;
    knob1.position.z = 0.33 + t * 0.45;
    knob2.position.z = 0.33 + t * 0.45;
  };

  return {
    root,
    upperReel,
    lowerReel,
    lensGroup,
    lampGroup,
    screenGroup,
    beamMesh,
    screenTexture,
    drawScreenFrame,
    clickableMeshes,
    applyFinish,
    setExplodeAmount,
    dispose: () => {
      for (const item of disposables) {
        item.dispose();
      }
    },
  };
}
