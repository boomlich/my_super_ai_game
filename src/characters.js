// ZONE ZERO: Procedural enemy models with skeletal-style walk animation
// All models face +Z so Object3D.lookAt() on the root turns them toward the player.
import * as THREE from 'three';
import { std, emissiveMat, shadowed } from './models.js';

function add(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = shadowed(new THREE.Mesh(geo, mat));
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

function pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

const sphere = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s);

// ---------- Forest Stalker (mutant wolf) ----------

export function createStalker() {
  const root = new THREE.Group();
  const rig = pivot(root, 0, 0, 0);
  const fur = std(0x1b2330, { roughness: 0.95 });
  const furDark = std(0x10151d, { roughness: 1.0 });
  const spineMat = std(0x45161a, { emissive: 0xff2020, emissiveIntensity: 0.45, roughness: 0.6 });
  const eyeMat = emissiveMat(0xff2a2a, 6);
  const teethMat = std(0xe8e2d0, { roughness: 0.4 });

  add(rig, sphere(0.5), fur, 0, 0.82, 0).scale.set(0.85, 0.8, 1.7);
  add(rig, sphere(0.5), fur, 0, 0.88, 0.5).scale.set(0.85, 0.98, 0.95);
  add(rig, sphere(0.5), furDark, 0, 0.8, -0.5).scale.set(0.95, 0.9, 0.95);
  add(rig, sphere(0.5), fur, 0, 0.98, 0.9, 0.5).scale.set(0.5, 0.55, 0.8);

  for (let i = 0; i < 7; i++) {
    const z = -0.7 + i * 0.28;
    add(rig, cone(0.045, 0.2 + (i % 2) * 0.08, 5), spineMat, 0, 1.22 - Math.abs(z) * 0.05, z, -0.3);
  }

  const head = pivot(rig, 0, 1.02, 1.1);
  add(head, sphere(0.5), fur, 0, 0, 0).scale.set(0.58, 0.52, 0.72);
  add(head, box(0.21, 0.17, 0.42), fur, 0, -0.05, 0.42);
  add(head, sphere(0.05, 8, 6), furDark, 0, 0.0, 0.64);
  const jaw = pivot(head, 0, -0.12, 0.28);
  add(jaw, box(0.17, 0.05, 0.36), furDark, 0, 0, 0.17);
  for (let i = 0; i < 4; i++) {
    const x = i < 2 ? -0.07 : 0.07;
    add(jaw, cone(0.02, 0.09, 4), teethMat, x, 0.06, 0.1 + (i % 2) * 0.16);
    add(head, cone(0.02, 0.09, 4), teethMat, x, -0.14, 0.3 + (i % 2) * 0.16, Math.PI);
  }
  add(head, cone(0.07, 0.24, 5), furDark, -0.15, 0.27, -0.12, -0.2, 0, 0.2);
  add(head, cone(0.07, 0.24, 5), furDark, 0.15, 0.27, -0.12, -0.2, 0, -0.2);
  add(head, sphere(0.05, 8, 6), eyeMat, -0.14, 0.08, 0.27);
  add(head, sphere(0.05, 8, 6), eyeMat, 0.14, 0.08, 0.27);
  add(head, box(0.17, 0.05, 0.1), furDark, -0.14, 0.14, 0.28, 0.2, 0, -0.55);
  add(head, box(0.17, 0.05, 0.1), furDark, 0.14, 0.14, 0.28, 0.2, 0, 0.55);
  add(head, box(0.13, 0.03, 0.3), emissiveMat(0x8a0000, 1.8), 0, -0.1, 0.38);

  const tail = pivot(rig, 0, 0.88, -0.85);
  add(tail, cyl(0.02, 0.1, 0.75, 6), fur, 0, -0.15, -0.28, -1.0);

  const legs = [];
  const legDefs = [[-0.27, 0.5, 0], [0.27, 0.5, Math.PI], [-0.27, -0.5, Math.PI], [0.27, -0.5, 0]];
  for (const [x, z, off] of legDefs) {
    const leg = pivot(rig, x, 0.74, z);
    add(leg, cyl(0.1, 0.07, 0.42, 7), fur, 0, -0.2, 0);
    add(leg, cyl(0.06, 0.045, 0.42, 7), furDark, 0, -0.52, 0.03, 0.2);
    add(leg, box(0.1, 0.07, 0.17), furDark, 0, -0.72, 0.08);
    legs.push({ node: leg, off, amp: 0.75 });
  }

  root.userData.anim = {
    phase: 0, walk: 0, stride: 1.9, legs, arms: [],
    bob: { node: rig, amp: 0.045 },
    extra: (t, walk) => {
      tail.rotation.y = Math.sin(t * 5) * 0.45;
      jaw.rotation.x = 0.22 + Math.max(0, Math.sin(t * 7)) * 0.2 * (1 - walk * 0.6);
      head.rotation.x = Math.sin(t * 3) * 0.05;
    }
  };
  return root;
}

// ---------- Rogue PMC Trooper ----------

export function createTrooper() {
  const root = new THREE.Group();
  const rig = pivot(root, 0, 0, 0);
  const fatigue = std(0x384132, { roughness: 0.85 });
  const vest = std(0x232a22, { roughness: 0.75 });
  const plate = std(0x161a1d, { roughness: 0.5, metalness: 0.4 });
  const skin = std(0x15181c, { roughness: 0.9 });
  const helmet = std(0x4a5440, { roughness: 0.6, metalness: 0.2 });
  const boots = std(0x0e0f10, { roughness: 0.7 });
  const gun = std(0x0b0d10, { roughness: 0.4, metalness: 0.85 });
  const visor = emissiveMat(0x26e5ff, 3.5);

  const legs = [];
  for (const x of [-0.12, 0.12]) {
    const leg = pivot(rig, x, 0.96, 0);
    add(leg, box(0.17, 0.48, 0.2), fatigue, 0, -0.24, 0);
    add(leg, box(0.15, 0.46, 0.17), fatigue, 0, -0.68, 0.01);
    add(leg, box(0.12, 0.12, 0.05), plate, 0, -0.5, 0.11);
    add(leg, box(0.16, 0.14, 0.28), boots, 0, -0.9, 0.05);
    legs.push({ node: leg, off: x < 0 ? 0 : Math.PI, amp: 0.7 });
  }

  add(rig, box(0.38, 0.22, 0.24), fatigue, 0, 1.03, 0);
  add(rig, box(0.42, 0.5, 0.26), fatigue, 0, 1.38, 0);
  add(rig, box(0.48, 0.42, 0.31), vest, 0, 1.4, 0);
  add(rig, box(0.3, 0.3, 0.04), plate, 0, 1.42, 0.17);
  add(rig, box(0.32, 0.2, 0.18), vest, 0, 1.38, -0.24);
  for (const x of [-0.14, 0, 0.14]) add(rig, box(0.1, 0.14, 0.07), vest, x, 1.14, 0.16);
  add(rig, cyl(0.06, 0.07, 0.1, 8), skin, 0, 1.68, 0);

  const head = pivot(rig, 0, 1.78, 0);
  add(head, sphere(0.15), skin, 0, 0, 0);
  const helm = add(head, new THREE.SphereGeometry(0.19, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), helmet, 0, 0.02, 0);
  helm.scale.set(1, 1.0, 1.1);
  add(head, box(0.3, 0.025, 0.34), helmet, 0, 0.0, 0.0);
  add(head, box(0.22, 0.06, 0.05), visor, 0, 0.0, 0.15);
  add(head, box(0.05, 0.05, 0.06), plate, 0, 0.14, 0.16);

  const arms = [];
  const rifle = pivot(rig, 0.09, 1.36, 0.42);
  add(rifle, box(0.055, 0.1, 0.5), gun, 0, 0, 0);
  add(rifle, box(0.04, 0.05, 0.3), gun, 0, 0.03, 0.34);
  add(rifle, cyl(0.014, 0.014, 0.28, 8), gun, 0, 0.02, 0.62, Math.PI / 2);
  add(rifle, box(0.045, 0.14, 0.05), gun, 0, -0.1, 0.02, 0.2);
  add(rifle, box(0.04, 0.09, 0.2), gun, 0, -0.01, -0.34);
  add(rifle, box(0.04, 0.04, 0.08), plate, 0, 0.08, -0.02);
  add(rifle, box(0.025, 0.025, 0.04), emissiveMat(0xff2222, 5), 0.04, 0.0, 0.5);

  for (const side of [-1, 1]) {
    const arm = pivot(rig, side * 0.29, 1.58, 0);
    arm.rotation.set(-1.15, 0, side * (side > 0 ? 0.0 : 0.18));
    add(arm, box(0.12, 0.54, 0.13), fatigue, 0, -0.27, 0);
    add(arm, box(0.11, 0.1, 0.12), plate, 0, -0.56, 0);
    arms.push({ node: arm, off: 0, amp: 0.0, base: arm.rotation.x });
  }

  const laserMat = new THREE.LineBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const laserGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.13, 1.36, 0.95), new THREE.Vector3(0.13, 1.36, 26.0)]);
  const laser = new THREE.Line(laserGeo, laserMat);
  laser.raycast = () => {}; // never let the sight beam swallow the player's bullets
  root.add(laser);

  root.userData.anim = {
    phase: 0, walk: 0, stride: 1.5, legs, arms,
    bob: { node: rig, amp: 0.03 },
    extra: (t, walk) => {
      head.rotation.y = Math.sin(t * 1.3) * 0.25 * (1 - walk * 0.5);
      rig.rotation.y = Math.sin(t * 0.9) * 0.04;
    }
  };
  return root;
}

// ---------- The Iron Behemoth (cyber-mutant boss) ----------

export function createBehemoth() {
  const root = new THREE.Group();
  const rig = pivot(root, 0, 0, 0);
  const armor = std(0x34445f, { roughness: 0.4, metalness: 0.8 });
  const armorDark = std(0x1c2536, { roughness: 0.5, metalness: 0.75 });
  const iron = std(0x2a2f38, { roughness: 0.55, metalness: 0.85 });
  const rust = std(0x6b3a1e, { roughness: 0.7, metalness: 0.6 });
  const flesh = std(0x3a2f36, { roughness: 0.85 });
  const core = emissiveMat(0x22d3ee, 5);
  const wood = std(0x5a3a1c, { roughness: 0.95 });
  const glowOrange = emissiveMat(0xff7a1a, 3.5);

  const legs = [];
  for (const x of [-0.72, 0.72]) {
    const leg = pivot(rig, x, 2.05, 0);
    add(leg, box(0.78, 1.1, 0.82), armorDark, 0, -0.55, 0);
    add(leg, sphere(0.42), armor, 0, -1.12, 0.3).scale.set(1, 0.8, 0.7);
    add(leg, box(0.66, 1.0, 0.72), flesh, 0, -1.4, 0);
    add(leg, box(0.72, 0.5, 0.2), armor, 0, -1.3, 0.4);
    add(leg, box(0.82, 0.38, 1.25), iron, 0, -1.9, 0.22);
    legs.push({ node: leg, off: x < 0 ? 0 : Math.PI, amp: 0.55 });
  }

  add(rig, box(1.95, 0.7, 1.25), iron, 0, 2.15, 0);
  const torso = pivot(rig, 0, 3.4, 0);
  add(torso, cyl(1.45, 1.05, 2.5, 10), armor, 0, 0, 0).scale.z = 0.78;
  add(torso, box(2.1, 0.6, 1.1), armorDark, 0, 0.95, 0.1);
  add(torso, box(1.4, 1.1, 0.25), armor, 0, 0.1, 0.92, -0.12);
  for (const x of [-0.5, 0.5]) add(torso, box(0.12, 0.9, 0.08), glowOrange, x, 0.15, 1.05, -0.12);
  const coreMesh = add(torso, sphere(0.34, 16, 12), core, 0, 0.12, 1.07);
  add(torso, new THREE.TorusGeometry(0.46, 0.07, 8, 20), iron, 0, 0.12, 1.02);
  for (const x of [-0.6, 0, 0.6]) add(torso, cyl(0.14, 0.14, 1.9, 8), rust, x, 0.3, -0.85);
  add(torso, cyl(0.2, 0.2, 0.6, 8), iron, -0.6, 1.5, -0.85);
  add(torso, cyl(0.2, 0.2, 0.6, 8), iron, 0.6, 1.5, -0.85);
  add(torso, cyl(0.12, 0.12, 0.08, 8), glowOrange, -0.6, 1.82, -0.85);
  add(torso, cyl(0.12, 0.12, 0.08, 8), glowOrange, 0.6, 1.82, -0.85);

  const head = pivot(torso, 0, 1.55, 0.1);
  add(head, box(0.95, 0.82, 0.92), armorDark, 0, 0, 0);
  add(head, box(0.8, 0.14, 0.06), core, 0, 0.05, 0.47);
  add(head, box(1.05, 0.25, 0.95), armor, 0, 0.5, -0.02);
  add(head, box(0.7, 0.3, 0.3), iron, 0, -0.45, 0.35);
  add(head, cone(0.12, 0.75, 6), iron, -0.55, 0.65, 0, 0, 0, 0.5);
  add(head, cone(0.12, 0.75, 6), iron, 0.55, 0.65, 0, 0, 0, -0.5);

  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = pivot(torso, side * 1.7, 0.85, 0);
    add(shoulder, sphere(0.68), armor, 0, 0.1, 0);
    for (let i = 0; i < 3; i++) add(shoulder, cone(0.12, 0.45, 5), iron, side * 0.1, 0.55 + i * 0.05, -0.3 + i * 0.3, 0, 0, side * -0.15);
    add(shoulder, cyl(0.52, 0.44, 1.5, 9), flesh, 0, -0.85, 0);
    const fore = pivot(shoulder, 0, -1.55, 0);
    add(fore, cyl(0.5, 0.4, 1.3, 9), armorDark, 0, -0.55, 0);
    add(fore, box(0.95, 0.85, 0.95), iron, 0, -1.4, 0);
    arms.push({ node: shoulder, off: side > 0 ? 0 : Math.PI, amp: 0.4, base: side > 0 ? -0.55 : 0 });

    if (side > 0) {
      const club = pivot(fore, 0, -1.4, 0);
      club.rotation.x = -0.6;
      add(club, cyl(0.28, 0.5, 3.8, 8), wood, 0, 0.5, 0.2);
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4;
        const dir = new THREE.Vector3(Math.cos(a), 0.2, Math.sin(a)).normalize();
        const spike = add(club, cone(0.09, 0.4, 5), iron, Math.cos(a) * 0.46, 1.1 + (i % 4) * 0.3, 0.2 + Math.sin(a) * 0.46);
        spike.quaternion.setFromUnitVectors(up, dir);
      }
      add(club, new THREE.TorusGeometry(0.42, 0.06, 6, 14), iron, 0, 1.0, 0.2, Math.PI / 2);
      add(club, new THREE.TorusGeometry(0.4, 0.06, 6, 14), iron, 0, 2.0, 0.2, Math.PI / 2);
    }
  }

  root.userData.anim = {
    phase: 0, walk: 0, stride: 1.05, legs, arms,
    bob: { node: rig, amp: 0.09 },
    extra: (t, walk) => {
      coreMesh.scale.setScalar(1 + Math.sin(t * 4) * 0.14);
      torso.rotation.y = Math.sin(t * 1.9) * 0.08 * walk;
      head.rotation.y = Math.sin(t * 0.8) * 0.15;
    }
  };
  return root;
}

// Advances the procedural walk cycle. `speed` is the real ground speed in m/s.
export function animateEnemy(enemy, delta, speed, time) {
  const a = enemy.mesh.userData.anim;
  if (!a) return;

  const targetWalk = Math.min(1, speed / 3.5);
  a.walk += (targetWalk - a.walk) * Math.min(1, delta * 8);
  a.phase += speed * delta * a.stride;

  for (const leg of a.legs) {
    leg.node.rotation.x = Math.sin(a.phase + leg.off) * leg.amp * a.walk;
  }
  for (const arm of a.arms) {
    arm.node.rotation.x = (arm.base ?? 0) + Math.sin(a.phase + arm.off) * arm.amp * a.walk;
  }
  if (a.bob) {
    a.bob.node.position.y = Math.abs(Math.sin(a.phase * 1)) * a.bob.amp * a.walk;
  }
  a.extra?.(time, a.walk);
}
