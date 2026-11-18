import * as THREE from 'three';

export function createPitchTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const width = 1024;
  const height = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Pitch plane spans width=56m (x in [-28, 28]) and length=56m (z in [-8, 48])
  const pxPerMeterX = width / 56;
  const pxPerMeterZ = height / 56;
  const toX = (mX: number) => (mX + 28) * pxPerMeterX;
  const toY = (mZ: number) => (mZ + 8) * pxPerMeterZ;

  // 1. Mowed alternating turf stripes
  const stripeCount = 14;
  const stripeH = height / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#14532d' : '#166534';
    ctx.fillRect(0, i * stripeH, width, stripeH + 1);
  }

  // 2. Subtle turf grass grain
  for (let i = 0; i < 18000; i++) {
    const gx = Math.random() * width;
    const gy = Math.random() * height;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.045)';
    ctx.fillRect(gx, gy, 2, 2);
  }

  // 3. Regulation Pitch White Markings (goal line at z = 0)
  ctx.strokeStyle = 'rgba(250, 250, 250, 0.92)';
  ctx.lineWidth = 4;

  // Goal line & Touchlines
  ctx.strokeRect(toX(-24), toY(0), 48 * pxPerMeterX, 46 * pxPerMeterZ);

  // Penalty area (40.32m wide x 16.5m deep)
  ctx.strokeRect(toX(-20.16), toY(0), 40.32 * pxPerMeterX, 16.5 * pxPerMeterZ);

  // 6-yard goal area (18.32m wide x 5.5m deep)
  ctx.strokeRect(toX(-9.16), toY(0), 18.32 * pxPerMeterX, 5.5 * pxPerMeterZ);

  // Penalty spot (11m from goal line)
  ctx.fillStyle = '#fafafa';
  ctx.beginPath();
  ctx.arc(toX(0), toY(11), 4.5, 0, Math.PI * 2);
  ctx.fill();

  // Penalty arc ("The D")
  ctx.beginPath();
  ctx.arc(toX(0), toY(11), 9.15 * pxPerMeterX, 0.65, Math.PI - 0.65);
  ctx.stroke();

  // Subtle worn chalk halo around penalty spot
  const spotGlow = ctx.createRadialGradient(toX(0), toY(11), 2, toX(0), toY(11), 26);
  spotGlow.addColorStop(0, 'rgba(234, 179, 8, 0.14)');
  spotGlow.addColorStop(1, 'rgba(234, 179, 8, 0)');
  ctx.fillStyle = spotGlow;
  ctx.beginPath();
  ctx.arc(toX(0), toY(11), 26, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, maxAnisotropy || 1);
  return texture;
}

export function createSoccerBallTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Clean pearl off-white base
  ctx.fillStyle = '#f5f5f4';
  ctx.fillRect(0, 0, size, size);

  // Seams & gold-trimmed black pentagon/panel pattern so rotation is highly legible
  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 5;

  const cols = 6;
  const rows = 4;
  const cellW = size / cols;
  const cellH = size / rows;

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const cx = (c + (r % 2 === 0 ? 0.25 : 0.75)) * cellW;
      const cy = r * cellH;
      const radius = cellH * 0.28;

      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const angle = (k / 5) * Math.PI * 2 - Math.PI / 2;
        const px = cx + Math.cos(angle) * radius;
        const py = cy + Math.sin(angle) * radius;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = '#111114';
      ctx.fill();
      ctx.stroke();
    }
  }

  // Subtle gold Temple Cinema emblem stripe
  ctx.fillStyle = 'rgba(229, 169, 59, 0.22)';
  ctx.fillRect(0, size * 0.48, size, size * 0.04);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, maxAnisotropy || 1);
  return texture;
}

export function createAdBoardTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const width = 1024;
  const height = 128;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#09090B';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#E5A93B';
  ctx.fillRect(0, 0, width, 8);
  ctx.fillRect(0, height - 8, width, 8);

  ctx.font = 'bold 42px Outfit, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#E5A93B';
  ctx.fillText('TEMPLE CINEMA', 48, height / 2);

  ctx.font = '600 28px Plus Jakarta Sans, sans-serif';
  ctx.fillStyle = '#FAFAFA';
  ctx.fillText('PENALTY ARENA  •  TEMPLESOLOSMOVIES.COM', 410, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.set(3, 1);
  texture.anisotropy = Math.min(4, maxAnisotropy || 1);
  return texture;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.65)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
