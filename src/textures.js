// ZONE ZERO: Procedural canvas textures (bark, planks, metal, burlap, concrete, glow sprites)
import * as THREE from 'three';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(size, draw, { srgb = true, repeat = [1, 1] } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function speckle(ctx, size, rand, amount, alpha = 1) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    d[i + 3] = 255 * alpha;
  }
  ctx.putImageData(img, 0, 0);
}

const cache = new Map();
function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

export function barkTexture() {
  return cached('bark', () => canvasTexture(256, (ctx, s) => {
    const rand = mulberry32(11);
    ctx.fillStyle = '#5b4332';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      const x = rand() * s;
      const w = 1 + rand() * 5;
      const dark = rand() < 0.65;
      ctx.fillStyle = dark ? `rgba(28,18,12,${0.25 + rand() * 0.4})` : `rgba(140,108,78,${0.15 + rand() * 0.25})`;
      ctx.fillRect(x, 0, w, s);
      // broken ridges
      ctx.fillStyle = `rgba(20,12,8,${0.3 + rand() * 0.3})`;
      ctx.fillRect(x, rand() * s, w + 1, 6 + rand() * 24);
    }
    speckle(ctx, s, rand, 26);
  }));
}

export function plankTexture(base = '#8a5a2b', gap = '#2a1808') {
  return cached(`plank:${base}`, () => canvasTexture(256, (ctx, s) => {
    const rand = mulberry32(base.length * 31 + base.charCodeAt(1));
    const boards = 4;
    const h = s / boards;
    for (let b = 0; b < boards; b++) {
      const tone = 0.82 + rand() * 0.3;
      ctx.fillStyle = base;
      ctx.fillRect(0, b * h, s, h);
      ctx.fillStyle = `rgba(0,0,0,${(1 - tone) * 0.8})`;
      ctx.fillRect(0, b * h, s, h);
      // wood grain
      for (let g = 0; g < 26; g++) {
        const y = b * h + rand() * h;
        ctx.strokeStyle = rand() < 0.6 ? 'rgba(30,16,6,0.28)' : 'rgba(210,160,100,0.18)';
        ctx.lineWidth = 0.6 + rand() * 1.3;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(s * 0.3, y + (rand() - 0.5) * 6, s * 0.7, y + (rand() - 0.5) * 6, s, y + (rand() - 0.5) * 4);
        ctx.stroke();
      }
      // knot
      if (rand() < 0.7) {
        const kx = rand() * s;
        const ky = b * h + h * 0.5;
        const grad = ctx.createRadialGradient(kx, ky, 1, kx, ky, 9);
        grad.addColorStop(0, 'rgba(20,10,4,0.85)');
        grad.addColorStop(1, 'rgba(20,10,4,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(kx, ky, 12, 7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = gap;
      ctx.fillRect(0, b * h, s, 3);
      // nails
      ctx.fillStyle = 'rgba(15,15,15,0.8)';
      ctx.fillRect(10, b * h + h * 0.5 - 1, 3, 3);
      ctx.fillRect(s - 14, b * h + h * 0.5 - 1, 3, 3);
    }
    speckle(ctx, s, rand, 18);
  }));
}

export function metalTexture(base = '#5d6a78') {
  return cached(`metal:${base}`, () => canvasTexture(256, (ctx, s) => {
    const rand = mulberry32(77 + base.charCodeAt(2));
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    // brushed streaks
    for (let i = 0; i < 400; i++) {
      ctx.strokeStyle = rand() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      const y = rand() * s;
      ctx.beginPath();
      ctx.moveTo(rand() * s * 0.4, y);
      ctx.lineTo(s * 0.4 + rand() * s * 0.6, y + (rand() - 0.5) * 2);
      ctx.stroke();
    }
    // rust blooms
    for (let i = 0; i < 16; i++) {
      const x = rand() * s;
      const y = rand() * s;
      const r = 12 + rand() * 38;
      const grad = ctx.createRadialGradient(x, y, 1, x, y, r);
      grad.addColorStop(0, 'rgba(140,70,25,0.5)');
      grad.addColorStop(0.6, 'rgba(110,55,22,0.2)');
      grad.addColorStop(1, 'rgba(110,55,22,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // panel seams + rivets
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, s - 4, s - 4);
    ctx.fillStyle = 'rgba(210,215,225,0.55)';
    for (const [x, y] of [[12, 12], [s - 12, 12], [12, s - 12], [s - 12, s - 12]]) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    speckle(ctx, s, rand, 20);
  }));
}

export function burlapTexture() {
  return cached('burlap', () => canvasTexture(128, (ctx, s) => {
    const rand = mulberry32(5);
    ctx.fillStyle = '#b39a68';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < s; i += 3) {
      ctx.fillStyle = `rgba(70,50,20,${0.12 + rand() * 0.12})`;
      ctx.fillRect(i, 0, 1, s);
      ctx.fillRect(0, i, s, 1);
    }
    speckle(ctx, s, rand, 30);
  }));
}

export function concreteTexture() {
  return cached('concrete', () => canvasTexture(256, (ctx, s) => {
    const rand = mulberry32(99);
    ctx.fillStyle = '#7b8088';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      const x = rand() * s;
      const y = rand() * s;
      const r = 10 + rand() * 50;
      const grad = ctx.createRadialGradient(x, y, 1, x, y, r);
      const dark = rand() < 0.6;
      grad.addColorStop(0, dark ? 'rgba(20,24,28,0.28)' : 'rgba(200,205,210,0.18)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // water stains running down
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = `rgba(30,36,28,${0.08 + rand() * 0.1})`;
      ctx.fillRect(rand() * s, 0, 2 + rand() * 6, s * (0.3 + rand() * 0.7));
    }
    // panel joints
    ctx.strokeStyle = 'rgba(10,12,14,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, s / 2);
    ctx.lineTo(s, s / 2);
    ctx.moveTo(s / 2, 0);
    ctx.lineTo(s / 2, s);
    ctx.stroke();
    speckle(ctx, s, rand, 34);
  }));
}

export function fabricTexture(base = '#4b5d3a') {
  return cached(`fabric:${base}`, () => canvasTexture(128, (ctx, s) => {
    const rand = mulberry32(base.charCodeAt(3) * 13);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < s; i += 2) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(i, 0, 1, s);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(0, i, s, 1);
    }
    speckle(ctx, s, rand, 24);
  }));
}

// Radial soft glow used for sprites (loot halos, muzzle flash, lens flare)
export function glowTexture() {
  return cached('glow', () => canvasTexture(128, (ctx, s) => {
    const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
  }, { srgb: false }));
}

// Six-pointed starburst for muzzle flashes
export function flashTexture() {
  return cached('flash', () => canvasTexture(128, (ctx, s) => {
    ctx.translate(s / 2, s / 2);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, s / 2);
    grad.addColorStop(0, 'rgba(255,255,240,1)');
    grad.addColorStop(0.3, 'rgba(255,200,110,0.8)');
    grad.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    const spikes = 6;
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? s / 2 : s * 0.12;
      const a = (i / (spikes * 2)) * Math.PI * 2;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.25);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(1, 'rgba(255,220,150,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }, { srgb: false }));
}
