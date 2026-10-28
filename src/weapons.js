// ZONE ZERO: First-person viewmodels (weapons, gloved hands, muzzle flash)
// Weapons point down -Z. `sightY` is the height of the sight line above the model origin and
// is used to line the sights up with the crosshair when aiming down sights.
import * as THREE from 'three';
import { std, emissiveMat } from './models.js';
import { flashTexture, glowTexture } from './textures.js';

let kit = null;
function materials() {
  if (!kit) {
    kit = {
      gunmetal: std(0x14171b, { metalness: 0.92, roughness: 0.32 }),
      anodized: std(0x24282e, { metalness: 0.85, roughness: 0.42 }),
      polymer: std(0x1b1e21, { metalness: 0.1, roughness: 0.6 }),
      steel: std(0xaeb5bd, { metalness: 1.0, roughness: 0.22 }),
      olive: std(0x2e3d2c, { metalness: 0.15, roughness: 0.6 }),
      wood: std(0x7a5430, { roughness: 0.75 }),
      leather: std(0x3a2a1c, { roughness: 0.9 }),
      glove: std(0x262b31, { roughness: 0.8 }),
      knuckle: std(0x3d444c, { roughness: 0.5, metalness: 0.3 }),
      sleeve: std(0x46573b, { roughness: 0.95 }),
      lens: new THREE.MeshStandardMaterial({ color: 0x1a4a66, metalness: 0.9, roughness: 0.05, emissive: 0x0b3b57, emissiveIntensity: 1.2, transparent: true, opacity: 0.75 }),
      redDot: emissiveMat(0xff2020, 6)
    };
  }
  return kit;
}

function part(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cylZ = (r, len, seg = 10) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);

// Gloved hand with fingers wrapped around something at the origin (grip along Y or Z)
function hand(parent, x, y, z, { rx = 0, ry = 0, rz = 0, scale = 1 } = {}) {
  const m = materials();
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.set(rx, ry, rz);
  g.scale.setScalar(scale);
  part(g, box(0.07, 0.075, 0.062), m.glove, 0, 0, 0);
  part(g, box(0.062, 0.016, 0.05), m.knuckle, 0, 0.044, 0.0);
  for (let i = 0; i < 4; i++) part(g, box(0.014, 0.05, 0.016), m.glove, -0.025 + i * 0.0167, -0.002, -0.04, 0.2);
  part(g, box(0.018, 0.016, 0.05), m.glove, 0.04, 0.01, -0.012, 0, 0.3, 0);
  parent.add(g);
  return g;
}

function sleeve(parent, from, to, r = 0.042) {
  const m = materials();
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.15, r, len, 10), m.sleeve);
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  parent.add(mesh);
  return mesh;
}

function railSlots(parent, z0, count, step, y, mat, width = 0.024) {
  for (let i = 0; i < count; i++) part(parent, box(width, 0.006, 0.008), mat, 0, y, z0 - i * step);
}

function result(group, extra) {
  group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return { group, ...extra };
}

// ---------- M4A1 carbine ----------

function buildRifle() {
  const m = materials();
  const g = new THREE.Group();

  part(g, box(0.05, 0.07, 0.2), m.anodized, 0, -0.01, 0.03);
  part(g, box(0.052, 0.056, 0.3), m.gunmetal, 0, 0.045, -0.03);
  part(g, box(0.022, 0.01, 0.5), m.gunmetal, 0, 0.079, -0.12);
  railSlots(g, 0.1, 22, 0.022, 0.0845, m.anodized);

  part(g, cylZ(0.031, 0.27), m.polymer, 0, 0.03, -0.31);
  part(g, box(0.02, 0.012, 0.25), m.gunmetal, 0, 0.066, -0.31);
  for (let i = 0; i < 5; i++) {
    part(g, box(0.068, 0.012, 0.012), m.anodized, 0, 0.03, -0.215 - i * 0.045);
  }
  part(g, cylZ(0.0105, 0.22), m.gunmetal, 0, 0.032, -0.55);
  part(g, cylZ(0.0165, 0.065), m.anodized, 0, 0.032, -0.655);
  part(g, box(0.018, 0.052, 0.026), m.gunmetal, 0, 0.073, -0.46);
  part(g, box(0.004, 0.03, 0.004), m.gunmetal, 0, 0.11, -0.46);

  part(g, cylZ(0.019, 0.14), m.anodized, 0, 0.012, 0.2);
  part(g, box(0.046, 0.088, 0.13), m.polymer, 0, 0.0, 0.31);
  part(g, box(0.05, 0.095, 0.012), m.gunmetal, 0, 0.0, 0.378);

  part(g, box(0.036, 0.1, 0.052), m.polymer, 0, -0.085, 0.095, 0.38);
  const mag = new THREE.Group();
  part(mag, box(0.034, 0.1, 0.056), m.anodized, 0, 0, 0);
  part(mag, box(0.034, 0.07, 0.056), m.anodized, 0, -0.07, -0.012, 0.12);
  mag.position.set(0, -0.095, -0.045);
  mag.rotation.x = -0.05;
  g.add(mag);

  part(g, box(0.008, 0.026, 0.07), m.gunmetal, 0.0285, 0.05, -0.02);
  const slide = part(g, box(0.006, 0.02, 0.05), m.steel, 0.0275, 0.05, -0.02);
  part(g, box(0.03, 0.014, 0.03), m.anodized, 0, 0.085, 0.13);

  // Red dot sight
  part(g, box(0.034, 0.014, 0.07), m.anodized, 0, 0.092, -0.01);
  part(g, box(0.034, 0.036, 0.01), m.gunmetal, 0, 0.114, 0.03);
  part(g, box(0.034, 0.036, 0.01), m.gunmetal, 0, 0.114, -0.052);
  part(g, box(0.034, 0.008, 0.074), m.gunmetal, 0, 0.136, -0.01);
  part(g, box(0.005, 0.036, 0.074), m.gunmetal, -0.0195, 0.114, -0.01);
  part(g, box(0.005, 0.036, 0.074), m.gunmetal, 0.0195, 0.114, -0.01);
  part(g, new THREE.PlaneGeometry(0.03, 0.03), m.lens, 0, 0.114, -0.047);
  part(g, new THREE.SphereGeometry(0.0022, 8, 6), m.redDot, 0, 0.114, -0.044);

  // Hands
  const rightHand = hand(g, 0.002, -0.088, 0.1, { rx: -0.2 });
  sleeve(g, new THREE.Vector3(0.02, -0.09, 0.14), new THREE.Vector3(0.1, -0.3, 0.52));
  const leftHand = hand(g, -0.012, -0.012, -0.31, { rz: 0.0, ry: Math.PI });
  sleeve(g, new THREE.Vector3(-0.02, -0.02, -0.27), new THREE.Vector3(-0.2, -0.3, 0.22));
  rightHand.visible = leftHand.visible = true;

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.032, -0.69);
  g.add(muzzle);
  return result(g, { slide, sightY: 0.114, muzzle, flashScale: 1.0 });
}

// ---------- SPAS-12 shotgun ----------

function buildShotgun() {
  const m = materials();
  const g = new THREE.Group();

  part(g, box(0.056, 0.085, 0.34), m.gunmetal, 0, 0.0, 0.0);
  part(g, box(0.05, 0.02, 0.46), m.anodized, 0, 0.052, -0.07);
  part(g, cylZ(0.0175, 0.55), m.gunmetal, 0, 0.02, -0.46);
  part(g, cylZ(0.0145, 0.5), m.anodized, 0, -0.016, -0.42);
  part(g, cylZ(0.021, 0.07), m.gunmetal, 0, 0.02, -0.74);
  part(g, box(0.034, 0.012, 0.3), m.anodized, 0, 0.044, -0.5);
  for (let i = 0; i < 6; i++) part(g, box(0.04, 0.01, 0.012), m.gunmetal, 0, 0.046, -0.4 - i * 0.045);

  // sights
  part(g, box(0.034, 0.03, 0.006), m.gunmetal, 0, 0.082, 0.07);
  part(g, new THREE.TorusGeometry(0.0095, 0.0025, 6, 14), m.steel, 0, 0.088, 0.073);
  part(g, box(0.004, 0.02, 0.004), m.steel, 0, 0.072, -0.72);

  // skeleton stock
  part(g, box(0.014, 0.012, 0.2), m.anodized, 0.018, 0.01, 0.26);
  part(g, box(0.014, 0.012, 0.2), m.anodized, -0.018, 0.01, 0.26);
  part(g, box(0.05, 0.09, 0.02), m.anodized, 0, -0.01, 0.37);
  part(g, box(0.04, 0.012, 0.1), m.polymer, 0, 0.04, 0.32);
  part(g, box(0.036, 0.1, 0.05), m.polymer, 0, -0.08, 0.1, 0.35);
  part(g, box(0.04, 0.03, 0.06), m.anodized, 0, -0.05, -0.02);

  // Pump (moves on every shot) with the left hand attached
  const slide = new THREE.Group();
  slide.position.set(0, -0.018, -0.32);
  part(slide, box(0.064, 0.058, 0.2), m.polymer, 0, 0, 0);
  for (let i = 0; i < 6; i++) part(slide, box(0.068, 0.006, 0.01), m.gunmetal, 0, 0, -0.08 + i * 0.03);
  hand(slide, -0.015, -0.03, 0, { ry: Math.PI });
  sleeve(slide, new THREE.Vector3(-0.02, -0.03, 0.06), new THREE.Vector3(-0.22, -0.3, 0.56));
  g.add(slide);

  hand(g, 0.002, -0.088, 0.105, { rx: -0.2 });
  sleeve(g, new THREE.Vector3(0.02, -0.09, 0.14), new THREE.Vector3(0.1, -0.3, 0.52));

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.78);
  g.add(muzzle);
  return result(g, { slide, sightY: 0.092, muzzle, flashScale: 1.5 });
}

// ---------- AWM sniper ----------

function buildSniper() {
  const m = materials();
  const g = new THREE.Group();

  part(g, box(0.052, 0.09, 0.62), m.olive, 0, -0.015, 0.0);
  part(g, box(0.05, 0.12, 0.2), m.olive, 0, -0.03, 0.4);
  part(g, box(0.042, 0.03, 0.14), m.leather, 0, 0.05, 0.37);
  part(g, box(0.052, 0.11, 0.016), m.anodized, 0, -0.03, 0.505);
  part(g, box(0.034, 0.1, 0.05), m.olive, 0, -0.09, 0.14, 0.3);
  part(g, box(0.04, 0.06, 0.13), m.gunmetal, 0, 0.012, -0.05);
  part(g, cylZ(0.0145, 0.82), m.gunmetal, 0, 0.012, -0.62);
  part(g, cylZ(0.024, 0.09), m.anodized, 0, 0.012, -1.06);
  for (let i = 0; i < 3; i++) part(g, box(0.052, 0.008, 0.012), m.gunmetal, 0, 0.012, -1.03 - i * 0.025);
  part(g, box(0.03, 0.08, 0.06), m.anodized, 0, -0.09, -0.05);
  part(g, box(0.03, 0.04, 0.012), m.steel, 0, -0.04, -0.4);

  // bipod (folded)
  part(g, cylZ(0.006, 0.18), m.anodized, 0.018, -0.04, -0.56, 0, 0, 0.0);
  part(g, cylZ(0.006, 0.18), m.anodized, -0.018, -0.04, -0.56, 0, 0, 0.0);

  // scope
  const scope = new THREE.Group();
  part(scope, cylZ(0.0255, 0.34), m.gunmetal, 0, 0, 0);
  part(scope, new THREE.CylinderGeometry(0.036, 0.0255, 0.1, 14).rotateX(-Math.PI / 2), m.gunmetal, 0, 0, -0.22);
  part(scope, new THREE.CylinderGeometry(0.0255, 0.032, 0.07, 14).rotateX(-Math.PI / 2), m.gunmetal, 0, 0, 0.2);
  part(scope, new THREE.CircleGeometry(0.031, 16), m.lens, 0, 0, -0.272);
  part(scope, new THREE.CircleGeometry(0.026, 16).rotateY(Math.PI), m.lens, 0, 0, 0.236);
  part(scope, cylZ(0.012, 0.03).rotateZ(Math.PI / 2), m.anodized, 0, 0.03, -0.03);
  part(scope, cylZ(0.012, 0.03).rotateX(Math.PI / 2), m.anodized, 0.03, 0, -0.03);
  scope.position.set(0, 0.123, -0.02);
  g.add(scope);
  part(g, box(0.03, 0.04, 0.03), m.anodized, 0, 0.082, -0.1);
  part(g, box(0.03, 0.04, 0.03), m.anodized, 0, 0.082, 0.1);

  // bolt handle
  const slide = new THREE.Group();
  slide.position.set(0.035, 0.03, 0.06);
  part(slide, cylZ(0.006, 0.05).rotateZ(Math.PI / 2), m.steel, 0.01, 0, 0);
  part(slide, new THREE.SphereGeometry(0.015, 10, 8), m.steel, 0.045, -0.01, 0);
  g.add(slide);

  hand(g, 0.002, -0.095, 0.145, { rx: -0.2 });
  sleeve(g, new THREE.Vector3(0.02, -0.1, 0.18), new THREE.Vector3(0.1, -0.32, 0.56));
  hand(g, -0.012, -0.065, -0.24, { ry: Math.PI });
  sleeve(g, new THREE.Vector3(-0.02, -0.07, -0.2), new THREE.Vector3(-0.2, -0.32, 0.3));

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, -1.12);
  g.add(muzzle);
  return result(g, { slide, sightY: 0.123, muzzle, flashScale: 1.9 });
}

// ---------- Hammer ----------

function buildHammer() {
  const m = materials();
  const g = new THREE.Group();
  part(g, new THREE.CylinderGeometry(0.022, 0.026, 0.6, 10), m.wood, 0, 0.0, 0);
  part(g, new THREE.CylinderGeometry(0.028, 0.028, 0.14, 10), m.leather, 0, -0.2, 0);
  part(g, box(0.08, 0.1, 0.24), m.steel, 0, 0.3, 0);
  part(g, box(0.07, 0.12, 0.06), m.anodized, 0, 0.3, -0.13);
  part(g, new THREE.CylinderGeometry(0.036, 0.03, 0.06, 10).rotateX(Math.PI / 2), m.steel, 0, 0.3, 0.14);
  hand(g, 0, -0.18, 0, { rx: Math.PI / 2, ry: 0, rz: 0, scale: 1.0 });
  sleeve(g, new THREE.Vector3(0, -0.2, 0.05), new THREE.Vector3(0.02, -0.3, 0.55));
  g.rotation.x = 0.4;
  return result(g, { slide: null, sightY: 0.1, muzzle: null, flashScale: 0 });
}

// ---------- Hatchet ----------

function buildAxe() {
  const m = materials();
  const g = new THREE.Group();
  part(g, new THREE.CylinderGeometry(0.021, 0.025, 0.58, 10), m.wood, 0, 0.0, 0);
  for (let i = 0; i < 4; i++) part(g, new THREE.CylinderGeometry(0.0265, 0.0265, 0.018, 10), m.leather, 0, -0.17 + i * 0.03, 0);

  const shape = new THREE.Shape();
  shape.moveTo(0, -0.04);
  shape.lineTo(0, 0.05);
  shape.lineTo(0.05, 0.055);
  shape.lineTo(0.1, 0.09);
  shape.quadraticCurveTo(0.122, 0.0, 0.1, -0.09);
  shape.lineTo(0.05, -0.05);
  shape.closePath();
  const blade = new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.004, bevelSegments: 1 });
  blade.translate(0, 0, -0.007);
  blade.rotateY(Math.PI / 2);
  part(g, blade, m.steel, 0, 0.26, 0.0);
  part(g, box(0.04, 0.05, 0.05), m.anodized, 0, 0.26, 0.03);

  hand(g, 0, -0.16, 0, { rx: Math.PI / 2 });
  sleeve(g, new THREE.Vector3(0, -0.18, 0.05), new THREE.Vector3(0.02, -0.3, 0.55));
  return result(g, { slide: null, sightY: 0.1, muzzle: null, flashScale: 0 });
}

export function buildWeaponModel(type) {
  switch (type) {
    case 'rifle': return buildRifle();
    case 'shotgun': return buildShotgun();
    case 'sniper': return buildSniper();
    case 'hammer': return buildHammer();
    case 'axe': return buildAxe();
    default: return buildRifle();
  }
}

// Cross-shaped muzzle flash: front starburst + forward-streaking cone, plus a soft halo
export function createMuzzleFlash() {
  const group = new THREE.Group();
  const tex = flashTexture();
  const makeMat = (r, g, b) => {
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false
    });
    mat.color.setRGB(r, g, b);
    return mat;
  };
  const star = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.17), makeMat(2.6, 2.0, 1.3));
  const sideA = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.1), makeMat(2.4, 1.8, 1.0));
  const sideB = sideA.clone();
  sideA.rotation.y = Math.PI / 2;
  sideA.position.z = -0.12;
  sideB.rotation.set(Math.PI / 2, Math.PI / 2, 0);
  sideB.position.z = -0.12;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: new THREE.Color(1.3, 0.75, 0.35), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  }));
  halo.scale.setScalar(0.38);
  group.add(star, sideA, sideB, halo);
  group.visible = false;
  group.traverse((o) => { o.frustumCulled = false; });
  return group;
}
