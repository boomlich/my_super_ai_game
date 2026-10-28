// ZONE ZERO: Procedural model library — flora, rocks, props, loot, grenade, helicopter
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { atmo } from './sky.js';
import { barkTexture, plankTexture, metalTexture, burlapTexture, concreteTexture, fabricTexture, glowTexture } from './textures.js';

// ---------- geometry helpers ----------

export function rand01(x, y, z, seed = 0) {
  const s = Math.sin((Math.round(x * 500) / 500) * 12.9898 + (Math.round(y * 500) / 500) * 78.233 + (Math.round(z * 500) / 500) * 37.719 + seed * 17.13) * 43758.5453;
  return s - Math.floor(s);
}

// Displaces vertices by position hash so duplicated seam vertices stay welded
export function jitterGeometry(geo, amount, seed = 0) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    p.setXYZ(
      i,
      x + (rand01(x, y, z, seed + 1) - 0.5) * 2 * amount,
      y + (rand01(x, y, z, seed + 2) - 0.5) * 2 * amount,
      z + (rand01(x, y, z, seed + 3) - 0.5) * 2 * amount
    );
  }
  p.needsUpdate = true;
  return geo;
}

export function paintGeometry(geo, colorFn) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const out = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    colorFn(c, p.getX(i), p.getY(i), p.getZ(i), n ? n.getY(i) : 1, i);
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return geo;
}

function flat(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

export function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.0, ...opts });
}

export function emissiveMat(color, intensity = 3) {
  const m = new THREE.MeshBasicMaterial({ color });
  m.color.multiplyScalar(intensity);
  return m;
}

function addSway(mat, key, amp) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = atmo.uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        float swayH = max(position.y, 0.0);
        float swayK = swayH * swayH * ${amp};
        float swayPh = uTime * 1.3 + modelMatrix[3][0] * 0.21 + modelMatrix[3][2] * 0.17;
        transformed.x += sin(swayPh) * swayK;
        transformed.z += cos(swayPh * 0.83) * swayK * 0.7;
      `);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

export function shadowed(mesh, cast = true, receive = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

// ---------- pine trees ----------

function spikyCone(radius, height, points, droop, seed, snow) {
  const verts = [];
  const ring = [];
  for (let k = 0; k < points * 2; k++) {
    const a = (k / (points * 2)) * Math.PI * 2 + (seed % 7) * 0.3;
    const outer = k % 2 === 0;
    const r = (outer ? radius : radius * 0.58) * (0.9 + rand01(k, seed, 3) * 0.2);
    ring.push([Math.cos(a) * r, outer ? -droop : 0, Math.sin(a) * r]);
  }
  const tip = [0, height, 0];
  const total = ring.length;
  for (let k = 0; k < total; k++) {
    const b = ring[k];
    const c = ring[(k + 1) % total];
    verts.push(...tip, ...c, ...b); // outer surface
    verts.push(0, -droop * 0.3, 0, ...b, ...c); // underside
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  paintGeometry(geo, (c, x, y, z, ny, i) => {
    const t = Math.min(1, Math.max(0, (y + droop) / (height + droop)));
    c.setRGB(0.05 + t * 0.07, 0.17 + t * 0.2, 0.06 + t * 0.05);
    const face = rand01(Math.floor(i / 3), seed, 9);
    c.multiplyScalar(0.8 + face * 0.4);
    if (snow && ny > 0.35) c.lerp(new THREE.Color(0.9, 0.95, 1.0), Math.min(1, (ny - 0.35) * 1.6) * 0.85);
  });
  return geo;
}

function buildPineFoliage(snow) {
  const parts = [];
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const g = spikyCone(2.55 - i * 0.43, 2.5 - i * 0.12, 8 + (i % 2), 0.35, i + 1, snow);
    g.rotateY(i * 0.7);
    g.translate(0, 1.9 + i * 1.5, 0);
    parts.push(g);
  }
  const top = spikyCone(0.4, 1.1, 5, 0.1, 9, snow);
  top.translate(0, 9.1, 0);
  parts.push(top);
  return mergeGeometries(parts);
}

function buildPineTrunk() {
  const geo = new THREE.CylinderGeometry(0.17, 0.5, 8.4, 8, 5);
  geo.translate(0, 4.2, 0);
  // Root flare
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < 0.9) {
      const k = 1 + (0.9 - y) * 0.55;
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
  }
  jitterGeometry(geo, 0.025);
  geo.computeVertexNormals();
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 3);
  return geo;
}

let pineKit = null;
export function getPineKit() {
  if (pineKit) return pineKit;
  const trunkMat = addSway(new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 0.95 }), 'zz-trunk', 0.0004);
  const foliageTints = [0xffffff, 0xe4ffd6, 0xffeedd].map((tint) => addSway(
    new THREE.MeshStandardMaterial({ vertexColors: true, color: tint, roughness: 0.85, side: THREE.DoubleSide }),
    'zz-foliage', 0.0011
  ));
  pineKit = {
    trunkGeo: buildPineTrunk(),
    foliageGeo: buildPineFoliage(false),
    snowFoliageGeo: buildPineFoliage(true),
    trunkMat,
    foliageMats: foliageTints
  };
  return pineKit;
}

export function createPine(snowy = false) {
  const kit = getPineKit();
  const group = new THREE.Group();
  const trunk = shadowed(new THREE.Mesh(kit.trunkGeo, kit.trunkMat));
  const foliage = shadowed(new THREE.Mesh(snowy ? kit.snowFoliageGeo : kit.foliageGeo, kit.foliageMats[Math.floor(Math.random() * kit.foliageMats.length)]), true, false);
  group.add(trunk, foliage);
  return group;
}

// ---------- rocks, bushes, grass ----------

export function buildRockGeometry(seed = 0) {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = 1 + 0.22 * Math.sin(x * 3.1 + seed) * Math.sin(y * 2.7 + seed * 2) + 0.16 * Math.sin(z * 4.3 + x * 2 + seed)
      + (rand01(x, y, z, seed) - 0.5) * 0.12;
    p.setXYZ(i, x * n, y * n * 0.78, z * n);
  }
  const g = flat(geo);
  paintGeometry(g, (c, x, y, z, ny, i) => {
    const v = 0.2 + rand01(Math.floor(i / 3), seed, 1) * 0.09;
    c.setRGB(v, v * 0.97, v * 0.92);
    if (ny > 0.55) c.lerp(new THREE.Color(0.1, 0.2, 0.07), Math.min(1, (ny - 0.55) * 2) * 0.6);
  });
  return g;
}

export function buildBushGeometry() {
  const parts = [];
  const blobs = [[0, 0.45, 0, 0.62], [0.45, 0.35, 0.1, 0.45], [-0.4, 0.38, 0.2, 0.48], [0.1, 0.4, -0.45, 0.46], [-0.1, 0.8, 0.05, 0.4]];
  blobs.forEach(([x, y, z, r], i) => {
    const g = new THREE.IcosahedronGeometry(r, 1);
    jitterGeometry(g, r * 0.14, i);
    g.translate(x, y, z);
    parts.push(flat(g));
  });
  const merged = mergeGeometries(parts);
  paintGeometry(merged, (c, x, y, z, ny, i) => {
    const t = Math.min(1, Math.max(0, y / 1.1));
    c.setRGB(0.07 + t * 0.07, 0.24 + t * 0.2, 0.07 + t * 0.03);
    c.multiplyScalar(0.82 + rand01(Math.floor(i / 3), 5, 2) * 0.36);
  });
  return merged;
}

let bushKit = null;
function getBushKit() {
  if (!bushKit) {
    bushKit = {
      geo: buildBushGeometry(),
      mat: std(0xffffff, { vertexColors: true, roughness: 0.9 }),
      berryGeo: new THREE.IcosahedronGeometry(0.075, 1),
      berryMat: std(0x7c3aed, { roughness: 0.25, emissive: 0x2a0f66, emissiveIntensity: 0.6 })
    };
  }
  return bushKit;
}

export function createBerryBush() {
  const kit = getBushKit();
  const group = new THREE.Group();
  group.add(shadowed(new THREE.Mesh(kit.geo, kit.mat), true, true));
  for (let b = 0; b < 9; b++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.45 + Math.random() * 0.2;
    const berry = new THREE.Mesh(kit.berryGeo, kit.berryMat);
    berry.position.set(Math.cos(a) * r, 0.35 + Math.random() * 0.55, Math.sin(a) * r);
    group.add(berry);
  }
  return group;
}

export function buildGrassTuft() {
  const blades = 8;
  const pos = [];
  const nrm = [];
  const col = [];
  const base = new THREE.Color(0.08, 0.2, 0.05);
  const tip = new THREE.Color(0.5, 0.72, 0.22);
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rand01(b, 1, 1) * 0.8;
    const ox = Math.cos(a) * 0.11;
    const oz = Math.sin(a) * 0.11;
    const h = 0.32 + rand01(b, 2, 2) * 0.36;
    const w = 0.026 + rand01(b, 3, 3) * 0.015;
    const lean = 0.08 + rand01(b, 4, 4) * 0.1;
    const dx = Math.cos(a + Math.PI / 2);
    const dz = Math.sin(a + Math.PI / 2);
    const lx = Math.cos(a) * lean;
    const lz = Math.sin(a) * lean;
    const tri = [
      [ox - dx * w, 0, oz - dz * w], [ox + dx * w, 0, oz + dz * w], [ox + lx, h, oz + lz]
    ];
    for (const winding of [[0, 1, 2], [0, 2, 1]]) {
      for (const idx of winding) {
        pos.push(...tri[idx]);
        nrm.push(0, 1, 0);
        const c = idx === 2 ? tip : base;
        col.push(c.r, c.g, c.b);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

export function createGrassMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = atmo.uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 iOrigin = vec3(0.0);
        #endif
        float bend = position.y * position.y;
        float ph = uTime * 1.7 + iOrigin.x * 0.35 + iOrigin.z * 0.27;
        transformed.x += (sin(ph) * 0.14 + sin(uTime * 3.1 + iOrigin.z) * 0.03) * bend;
        transformed.z += cos(ph * 0.8) * 0.09 * bend;
      `);
  };
  mat.customProgramCacheKey = () => 'zz-grass';
  return mat;
}

export function buildFlowerGeometry() {
  const g = flat(new THREE.IcosahedronGeometry(0.065, 0));
  g.translate(0, 0.3, 0);
  const stem = new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4);
  stem.translate(0, 0.15, 0);
  paintGeometry(g, (c) => c.setRGB(1, 1, 1));
  const s = flat(stem);
  paintGeometry(s, (c) => c.setRGB(0.5, 0.6, 0.3));
  return mergeGeometries([g, s]);
}

// ---------- props ----------

export function createScrapPile() {
  const group = new THREE.Group();
  const metal = std(0xffffff, { map: metalTexture('#6a7684'), metalness: 0.75, roughness: 0.5 });
  const rust = std(0xffffff, { map: metalTexture('#7a4a2a'), metalness: 0.6, roughness: 0.65 });

  const plate = (w, h, d, mat, x, y, z, rx, ry, rz) => {
    const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  };
  plate(1.2, 0.08, 0.9, metal, 0, 0.35, 0, 0.12, 0.3, 0.05);
  plate(0.9, 0.06, 0.7, rust, 0.2, 0.18, -0.15, -0.1, -0.5, 0.2);
  plate(0.7, 0.55, 0.05, metal, -0.35, 0.3, 0.3, 0.1, 0.6, 0.15);

  const barrel = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.75, 14), rust));
  barrel.position.set(0.4, 0.38, 0.25);
  group.add(barrel);
  for (const y of [0.15, 0.6]) {
    const ring = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.285, 0.025, 6, 16), metal));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0.4, y, 0.25);
    group.add(ring);
  }
  const pipe = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 8), metal));
  pipe.rotation.set(0.2, 0.4, Math.PI / 2 - 0.3);
  pipe.position.set(-0.1, 0.45, -0.3);
  group.add(pipe);
  const gear = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 6, 10), metal));
  gear.rotation.set(1.2, 0, 0.4);
  gear.position.set(-0.45, 0.14, -0.2);
  group.add(gear);
  return group;
}

export function createCrate(size = 0.9) {
  const group = new THREE.Group();
  const wood = std(0xffffff, { map: plankTexture('#8a6a3a'), roughness: 0.85 });
  const box = shadowed(new THREE.Mesh(new THREE.BoxGeometry(size, size, size), wood));
  box.position.y = size / 2;
  group.add(box);
  const strap = std(0x2a2e33, { metalness: 0.7, roughness: 0.5 });
  for (const s of [-1, 1]) {
    const band = shadowed(new THREE.Mesh(new THREE.BoxGeometry(size * 1.02, size * 0.08, size * 1.02), strap));
    band.position.y = size / 2 + s * size * 0.36;
    group.add(band);
  }
  return group;
}

export function createTent(color = '#4b5d3a') {
  const group = new THREE.Group();
  const fabric = std(0xffffff, { map: fabricTexture(color), roughness: 0.95, side: THREE.DoubleSide });
  const geo = new THREE.CylinderGeometry(1.5, 1.5, 3.2, 3, 1).rotateX(-Math.PI / 2);
  geo.translate(0, 0.75, 0);
  const prism = shadowed(new THREE.Mesh(geo, fabric));
  group.add(prism);
  const pole = std(0x3a2a1a);
  for (const z of [-1.6, 1.6]) {
    const p = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.3, 6), pole));
    p.position.set(0, 1.15, z);
    group.add(p);
  }
  return group;
}

// Cylinder strut between two points (used for lattice towers)
export function strut(a, b, radius, mat) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 5), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return shadowed(m);
}

export function bunkerMaterial() {
  return std(0xffffff, { map: concreteTexture(), roughness: 0.92 });
}

export function sandbagMaterial() {
  return std(0xffffff, { map: burlapTexture(), roughness: 1.0 });
}

// ---------- loot ----------

const glowSprites = new Map();
function glowSprite(color, scale) {
  const key = `${color}`;
  if (!glowSprites.has(key)) {
    glowSprites.set(key, new THREE.SpriteMaterial({
      map: glowTexture(), color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    }));
  }
  const s = new THREE.Sprite(glowSprites.get(key));
  s.scale.setScalar(scale);
  s.raycast = () => {};
  return s;
}

export function createLootMesh(itemId) {
  const group = new THREE.Group();
  let glow = 0x7dd3fc;
  let body;

  if (itemId === 'raw_meat') {
    glow = 0xf87171;
    body = new THREE.Mesh(
      flat(jitterGeometry(new THREE.IcosahedronGeometry(0.2, 1), 0.04, 3)),
      std(0xc2413f, { roughness: 0.35, emissive: 0x3a0808, emissiveIntensity: 0.6 })
    );
    body.scale.set(1.2, 0.75, 0.9);
    const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.38, 6), std(0xf3ead3));
    bone.rotation.z = 1.1;
    bone.position.set(0.15, 0.04, 0);
    body.add(bone);
  } else if (itemId === 'behemoth_core') {
    glow = 0x22d3ee;
    body = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.3, 1),
      std(0x0891b2, { metalness: 0.4, roughness: 0.15, emissive: 0x22d3ee, emissiveIntensity: 2.5 })
    );
    const cage = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.025, 6, 20), std(0x1e293b, { metalness: 0.9, roughness: 0.3 }));
    cage.rotation.x = Math.PI / 2;
    body.add(cage);
  } else if (itemId === 'wood') {
    glow = 0xfbbf24;
    body = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 1.5, 10), std(0xffffff, { map: barkTexture(), roughness: 0.95 }));
    body.rotation.z = Math.PI / 2;
    const cap = std(0xc89a5c);
    for (const s of [-1, 1]) {
      const end = new THREE.Mesh(new THREE.CircleGeometry(0.185, 10), cap);
      end.position.y = s * 0.751;
      end.rotation.x = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      body.add(end);
    }
  } else if (itemId.startsWith('ammo')) {
    glow = 0xfde047;
    body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.22), std(0x4a5a3a, { roughness: 0.6, metalness: 0.4 }));
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.345, 0.05, 0.225), std(0xfbbf24, { emissive: 0xfbbf24, emissiveIntensity: 0.6 }));
    body.add(stripe);
  } else if (itemId === 'scrap') {
    glow = 0x94a3b8;
    body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.26), std(0xffffff, { map: metalTexture('#6a7684'), metalness: 0.8, roughness: 0.4 }));
    body.rotation.set(0.3, 0.4, 0.1);
  } else {
    body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), std(0x38bdf8, { metalness: 0.8, roughness: 0.3, emissive: 0x0b4a6a, emissiveIntensity: 0.6 }));
  }

  shadowed(body, true, false);
  group.add(body);
  group.add(glowSprite(glow, 1.5));
  return group;
}

// ---------- grenade ----------

export function createGrenadeMesh() {
  const group = new THREE.Group();
  const olive = std(0x3e5a2a, { metalness: 0.6, roughness: 0.45 });
  const steel = std(0x9aa3ad, { metalness: 0.9, roughness: 0.3 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), olive);
  body.scale.y = 1.2;
  group.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.05, 10), steel);
  cap.position.y = 0.1;
  group.add(cap);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.1, 0.03), steel);
  lever.position.set(0.045, 0.06, 0);
  lever.rotation.z = -0.25;
  group.add(lever);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.004, 6, 10), steel);
  ring.position.set(-0.03, 0.13, 0);
  group.add(ring);
  group.children.forEach((c) => { c.castShadow = true; });
  return group;
}

// ---------- extraction helicopter ----------

export function createHelicopter() {
  const group = new THREE.Group();
  const hull = std(0x2b3440, { metalness: 0.75, roughness: 0.38 });
  const dark = std(0x10151b, { metalness: 0.8, roughness: 0.4 });
  const glass = std(0x0a2a3a, { metalness: 1, roughness: 0.05, emissive: 0x0b4f6c, emissiveIntensity: 0.6 });

  const fuselage = shadowed(new THREE.Mesh(new THREE.CapsuleGeometry(1.5, 4.4, 8, 16), hull));
  fuselage.rotation.x = Math.PI / 2;
  fuselage.scale.set(1, 1, 0.95);
  group.add(fuselage);

  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.15, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), glass);
  cockpit.position.set(0, 0.45, 2.6);
  cockpit.rotation.x = 0.7;
  group.add(cockpit);

  const boom = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.2, 5.6, 10), hull));
  boom.rotation.x = Math.PI / 2;
  boom.position.set(0, 0.5, -6);
  group.add(boom);
  const fin = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.8, 1.2), hull));
  fin.position.set(0, 1.3, -8.4);
  fin.rotation.x = -0.25;
  group.add(fin);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 0.9, 8), dark);
  mast.position.y = 1.9;
  group.add(mast);

  const rotor = new THREE.Group();
  rotor.position.y = 2.4;
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 6.6), dark);
    blade.position.z = 3.3;
    const arm = new THREE.Group();
    arm.rotation.y = (i / 4) * Math.PI * 2;
    arm.add(blade);
    rotor.add(arm);
  }
  group.add(rotor);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.25, 1.3, -8.5);
  for (let i = 0; i < 2; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.8, 0.2), dark);
    blade.rotation.x = i * Math.PI / 2;
    tailRotor.add(blade);
  }
  group.add(tailRotor);

  for (const x of [-1.5, 1.5]) {
    const skid = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5.2, 8), dark));
    skid.rotation.x = Math.PI / 2;
    skid.position.set(x, -1.7, 0.2);
    group.add(skid);
    for (const z of [-1.2, 1.4]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6), dark);
      leg.position.set(x * 0.92, -1.2, z);
      group.add(leg);
    }
  }

  const navRed = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), emissiveMat(0xff2222, 4));
  navRed.position.set(-1.6, 0.2, 0.2);
  const navGreen = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), emissiveMat(0x22ff66, 4));
  navGreen.position.set(1.6, 0.2, 0.2);
  group.add(navRed, navGreen);

  return { group, rotor, tailRotor };
}

// ---------- minable deposits ----------

const nodeGeoCache = new Map();
function nodeGeometry(kind, seed) {
  const key = `${kind}:${seed}`;
  if (nodeGeoCache.has(key)) return nodeGeoCache.get(key);
  const geo = buildRockGeometry(seed);
  if (kind === 'iron') {
    // Dark rock streaked with rust-orange ore veins
    paintGeometry(geo, (c, x, y, z, ny, i) => {
      const base = 0.17 + rand01(Math.floor(i / 3), seed, 4) * 0.07;
      c.setRGB(base, base * 0.95, base * 0.9);
      const vein = Math.sin(x * 5.2 + y * 3.1 + z * 4.4 + seed) + Math.sin(z * 7.3 - x * 2.2);
      if (vein > 1.15) c.setRGB(0.62, 0.26, 0.08);
      else if (vein > 0.85) c.setRGB(0.35, 0.17, 0.08);
    });
  } else if (kind === 'crystal') {
    paintGeometry(geo, (c, x, y, z, ny, i) => {
      const base = 0.14 + rand01(Math.floor(i / 3), seed, 6) * 0.06;
      c.setRGB(base * 0.9, base, base * 1.2);
    });
  } else {
    paintGeometry(geo, (c, x, y, z, ny, i) => {
      const v = 0.3 + rand01(Math.floor(i / 3), seed, 8) * 0.1;
      c.setRGB(v, v * 0.98, v * 0.94);
      if (ny > 0.6) c.lerp(new THREE.Color(0.14, 0.26, 0.1), 0.35);
    });
  }
  nodeGeoCache.set(key, geo);
  return geo;
}

let nodeMat = null;
let crystalMat = null;
export function createMineNode(kind, seed = 0) {
  if (!nodeMat) {
    nodeMat = std(0xffffff, { vertexColors: true, roughness: 0.92 });
    crystalMat = std(0x22d3ee, { roughness: 0.15, metalness: 0.2, emissive: 0x0ab4d6, emissiveIntensity: 1.8 });
  }
  const group = new THREE.Group();
  const rock = shadowed(new THREE.Mesh(nodeGeometry(kind, seed % 5), nodeMat));
  group.add(rock);
  if (kind === 'crystal') {
    for (let i = 0; i < 7; i++) {
      const h = 0.7 + Math.random() * 0.9;
      const spike = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.16 + Math.random() * 0.1, h, 5), crystalMat), true, false);
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.45;
      spike.position.set(Math.cos(a) * r, 0.45 + h * 0.4, Math.sin(a) * r);
      spike.rotation.set((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6);
      group.add(spike);
    }
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: new THREE.Color(0.2, 0.9, 1.0), transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    }));
    halo.scale.setScalar(3.2);
    halo.position.y = 1.0;
    halo.raycast = () => {};
    group.add(halo);
  }
  return group;
}
