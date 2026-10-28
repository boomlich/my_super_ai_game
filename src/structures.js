// ZONE ZERO: Modular construction pieces. Every piece is a Group centred on its recipe bounding box.
import * as THREE from 'three';
import { plankTexture, metalTexture, burlapTexture, fabricTexture } from './textures.js';
import { std, emissiveMat, shadowed, buildRockGeometry } from './models.js';

const matCache = new Map();
function cachedMat(key, make) {
  if (!matCache.has(key)) matCache.set(key, make());
  return matCache.get(key);
}

const woodMat = (base, rx, ry) => cachedMat(`wood:${base}:${rx}:${ry}`, () => {
  const tex = plankTexture(base).clone();
  tex.repeat.set(rx, ry);
  tex.needsUpdate = true;
  return std(0xffffff, { map: tex, roughness: 0.88 });
});
const logMat = () => cachedMat('log', () => {
  const tex = plankTexture('#6b4526').clone();
  tex.repeat.set(3, 1);
  tex.needsUpdate = true;
  return std(0xffffff, { map: tex, roughness: 0.92 });
});
const ironMat = () => cachedMat('iron', () => std(0xffffff, { map: metalTexture('#4d5762'), metalness: 0.85, roughness: 0.45 }));
const steelMat = () => cachedMat('steel', () => std(0xb8c0c8, { metalness: 1.0, roughness: 0.25 }));
const rockMat = () => cachedMat('rock', () => std(0xffffff, { vertexColors: true, roughness: 0.95 }));
const bagMat = () => cachedMat('bag', () => {
  const tex = burlapTexture().clone();
  tex.repeat.set(2, 2);
  tex.needsUpdate = true;
  return std(0xffffff, { map: tex, roughness: 1 });
});

function mesh(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = shadowed(new THREE.Mesh(geo, mat));
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const logAlongX = (len, r) => new THREE.CylinderGeometry(r, r, len, 10).rotateZ(Math.PI / 2);

function logWall(group, w, h, rows, skipRows = []) {
  const r = h / rows / 2;
  for (let i = 0; i < rows; i++) {
    if (skipRows.includes(i)) continue;
    mesh(group, logAlongX(w, r * 1.02), logMat(), 0, -h / 2 + r + i * r * 2, 0, (i % 3) * 0.7);
  }
  for (const side of [-1, 1]) {
    mesh(group, new THREE.CylinderGeometry(r * 0.8, r * 0.8, h, 8), logMat(), side * (w / 2 - r * 0.4), 0, r * 0.3);
  }
}

function buildCampfire(group, size, forGhost) {
  const groundY = -size[1] / 2;
  const stoneGeo = buildRockGeometry(5);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const s = mesh(group, stoneGeo, rockMat(), Math.cos(a) * 0.55, groundY + 0.08, Math.sin(a) * 0.55);
    s.scale.set(0.17, 0.14, 0.17);
    s.rotation.y = a * 3;
  }
  const ash = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), std(0x131211, { roughness: 1 }));
  ash.rotation.x = -Math.PI / 2;
  ash.position.y = groundY + 0.04;
  group.add(ash);
  for (let i = 0; i < 4; i++) {
    const log = mesh(group, new THREE.CylinderGeometry(0.06, 0.07, 0.85, 7), logMat(), 0, groundY + 0.17, 0, Math.PI / 2 - 0.4);
    log.rotation.set(Math.PI / 2 - 0.4, (i / 4) * Math.PI * 2, 0, 'YXZ');
  }
  const embers = new THREE.Mesh(new THREE.CircleGeometry(0.34, 14), emissiveMat(0xff5a14, 1.5));
  embers.rotation.x = -Math.PI / 2;
  embers.position.y = groundY + 0.06;
  group.add(embers);

  // Cooking spit
  for (const side of [-1, 1]) mesh(group, new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6), ironMat(), side * 0.65, groundY + 0.5, 0);
  mesh(group, new THREE.CylinderGeometry(0.025, 0.025, 1.4, 6).rotateZ(Math.PI / 2), ironMat(), 0, groundY + 0.95, 0);

  if (!forGhost) {
    const light = new THREE.PointLight(0xff8a3a, 26, 15, 2);
    light.position.set(0, 0.7, 0);
    group.add(light);
    group.userData.fireLight = light;
    group.userData.fireBase = 26;
    group.userData.fireOffset = new THREE.Vector3(0, groundY + 0.1, 0);
  }
}

function buildBarricade(group, size) {
  const [w, h] = size;
  for (const y of [-0.42, 0.0, 0.42]) mesh(group, logAlongX(w, 0.18), logMat(), 0, y, 0, y * 3);
  for (const side of [-1, 1]) mesh(group, new THREE.CylinderGeometry(0.12, 0.12, h, 8), logMat(), side * (w / 2 - 0.1), 0, 0);
  for (const s of [-1, 1]) {
    const stake = mesh(group, new THREE.ConeGeometry(0.09, 1.7, 6), logMat(), s * 0.5, 0, 0.26, 0, 0, s * 0.55);
    stake.rotation.x = 0.2;
  }
}

function buildWoodDoor(group, size) {
  const [w, h, d] = size;
  mesh(group, box(w, h, d * 0.75), woodMat('#5a3a22', 2, 2), 0, 0, 0);
  for (const y of [-0.7, 0.7]) {
    mesh(group, box(w * 1.0, 0.14, d * 0.9), ironMat(), 0, y, 0);
    for (const x of [-0.8, 0.8]) mesh(group, new THREE.SphereGeometry(0.05, 6, 6), steelMat(), x, y, d * 0.46);
  }
  mesh(group, box(0.1, h, d * 0.85), woodMat('#4a2e1a', 1, 2), 0, 0, 0);
  mesh(group, new THREE.TorusGeometry(0.1, 0.02, 6, 14), steelMat(), 0.6, -0.1, d * 0.45);
  mesh(group, new THREE.SphereGeometry(0.08, 8, 6), steelMat(), 0.6, 0.0, d * 0.48);
}

function buildStairs(group, size) {
  const [w, h, d] = size;
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const stepH = (h / steps) * (i + 1);
    mesh(group, box(w, stepH, d / steps), woodMat('#9a6a2a', 1, 1), 0, -h / 2 + stepH / 2, -d / 2 + (i + 0.5) * (d / steps));
  }
  for (const side of [-1, 1]) {
    const len = Math.hypot(h, d);
    mesh(group, box(0.1, 0.22, len), logMat(), side * (w / 2 + 0.02), 0, 0, Math.atan2(h, d), 0, 0);
  }
}

function buildRoof(group) {
  const geo = new THREE.ConeGeometry(2.5, 1.1, 4, 1).rotateY(Math.PI / 4);
  mesh(group, geo, woodMat('#5b3a1d', 3, 1), 0, 0.4, 0);
  for (const [x, z, ry] of [[0, 1.6, 0], [0, -1.6, 0], [1.6, 0, Math.PI / 2], [-1.6, 0, Math.PI / 2]]) {
    mesh(group, box(3.4, 0.18, 0.18), logMat(), x, -0.1, z, 0, ry, 0);
  }
  mesh(group, new THREE.ConeGeometry(0.1, 0.35, 6), steelMat(), 0, 1.12, 0);
}

function buildSpikes(group) {
  mesh(group, box(2.4, 0.2, 0.34), logMat(), 0, -0.4, 0);
  for (let i = 0; i < 7; i++) {
    const x = -1.05 + i * 0.35;
    const spike = mesh(group, new THREE.ConeGeometry(0.075, 1.25, 6), steelMat(), x, 0.1, 0.1);
    spike.rotation.x = 0.55;
    spike.rotation.z = (i % 2 ? 1 : -1) * 0.08;
  }
  for (const s of [-1, 1]) mesh(group, new THREE.CylinderGeometry(0.07, 0.07, 1.1, 6), logMat(), s * 1.0, -0.05, -0.3, -0.5);
}

function buildSandbags(group, size) {
  const [w, h, d] = size;
  const geo = new THREE.SphereGeometry(0.4, 12, 8);
  const rows = [4, 3, 2];
  rows.forEach((count, row) => {
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * 0.74;
      const bag = mesh(group, geo, bagMat(), x, -h / 2 + 0.16 + row * 0.34, 0, 0, (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.1);
      bag.scale.set(0.95, 0.44, 0.6);
    }
  });
}

function buildWorkbench(group) {
  mesh(group, box(2.0, 0.12, 1.0), woodMat('#8a5a2b', 2, 1), 0, 0.42, 0);
  mesh(group, box(1.9, 0.08, 0.9), woodMat('#6b4526', 2, 1), 0, -0.25, 0);
  for (const x of [-0.9, 0.9]) for (const z of [-0.4, 0.4]) mesh(group, box(0.12, 1.0, 0.12), logMat(), x, -0.1, z);
  mesh(group, box(0.22, 0.2, 0.26), ironMat(), 0.8, 0.58, 0.3);
  mesh(group, box(0.06, 0.3, 0.08), steelMat(), 0.8, 0.7, 0.3);
  mesh(group, new THREE.CylinderGeometry(0.02, 0.02, 0.34, 6).rotateZ(Math.PI / 2), logMat(), -0.5, 0.52, 0.1, 0, 0.5, 0);
  mesh(group, box(0.18, 0.08, 0.1), steelMat(), -0.65, 0.54, 0.17, 0, 0.5, 0);
  mesh(group, box(0.32, 0.06, 0.2), ironMat(), 0.0, 0.51, -0.2);
}

function buildBed(group) {
  mesh(group, box(1.4, 0.18, 2.4), woodMat('#6b4526', 1, 2), 0, -0.2, 0);
  for (const x of [-0.65, 0.65]) for (const z of [-1.1, 1.1]) mesh(group, box(0.14, 0.3, 0.14), logMat(), x, -0.15, z);
  mesh(group, box(1.4, 0.7, 0.1), woodMat('#5a3a22', 1, 1), 0, 0.0, -1.2);
  const fabric = std(0xffffff, { map: fabricTexture('#2f6f8f'), roughness: 1 });
  mesh(group, box(1.3, 0.2, 2.2), fabric, 0, 0.0, 0.05);
  mesh(group, box(1.32, 0.05, 1.3), std(0xffffff, { map: fabricTexture('#4b5d3a'), roughness: 1 }), 0, 0.13, 0.5);
  const pillow = mesh(group, new THREE.SphereGeometry(0.3, 12, 8), std(0xe8e4d8, { roughness: 1 }), 0, 0.16, -0.85);
  pillow.scale.set(1.5, 0.45, 0.9);
}

function buildChest(group, size) {
  const [w, h, d] = size;
  mesh(group, box(w, h * 0.6, d), woodMat('#8a5a2b', 2, 1), 0, -h * 0.2, 0);
  mesh(group, new THREE.CylinderGeometry(d / 2, d / 2, w, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), woodMat('#7a4c24', 2, 1), 0, h * 0.1, 0);
  for (const x of [-0.5, 0.5]) mesh(group, box(0.1, h * 0.62, d * 1.04), ironMat(), x, -h * 0.2, 0);
  mesh(group, box(0.2, 0.16, 0.06), steelMat(), 0, h * 0.02, d / 2);
}

export function buildStructure(recipe, { forGhost = false } = {}) {
  const group = new THREE.Group();
  const size = recipe.size;
  switch (recipe.id) {
    case 'campfire': buildCampfire(group, size, forGhost); break;
    case 'wood_barricade': buildBarricade(group, size); break;
    case 'wood_wall': logWall(group, size[0], size[1], 6); break;
    case 'wood_window': logWall(group, size[0], size[1], 6, [3]); break;
    case 'wood_door': buildWoodDoor(group, size); break;
    case 'wood_stairs': buildStairs(group, size); break;
    case 'wood_roof': buildRoof(group); break;
    case 'metal_spikes': buildSpikes(group); break;
    case 'sandbag': buildSandbags(group, size); break;
    case 'workbench': buildWorkbench(group); break;
    case 'wooden_bed': buildBed(group); break;
    case 'storage_chest': buildChest(group, size); break;
    default: group.add(shadowed(new THREE.Mesh(box(...size), std(recipe.color))));
  }
  return group;
}
