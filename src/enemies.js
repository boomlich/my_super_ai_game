// ZONE ZERO: Enemy AI — perception, patrol/chase/search states, packs, raids & breaching
import * as THREE from 'three';
import { sounds } from './audio.js';
import { createStalker, createTrooper, createBehemoth, animateEnemy } from './characters.js';
import { buildRockGeometry } from './models.js';

export const SAFE_ZONE_RADIUS = 28;
const SAFE_CENTER = { x: 0, z: 0 };

// fov is the full viewing cone in degrees; vision/closeSense in metres
const STATS = {
  stalker: {
    name: 'Forest Stalker', hp: 75, walk: 2.3, run: 6.6, radius: 0.5, height: 1.2, eye: 0.9,
    vision: 34, closeSense: 6, fov: 140, attackRange: 2.2, damage: 14, windup: 0.55, cooldown: 1.7,
    wander: 16, leash: 85, turn: 9, breach: 20, hearing: 1.0
  },
  trooper: {
    name: 'Rogue PMC Trooper', hp: 100, walk: 2.0, run: 4.6, radius: 0.4, height: 1.9, eye: 1.7,
    vision: 55, closeSense: 10, fov: 125, attackRange: 36, damage: 9, windup: 0, cooldown: 1.0,
    wander: 7, leash: 70, turn: 6, breach: 12, hearing: 1.15
  },
  behemoth: {
    name: 'THE IRON BEHEMOTH', hp: 850, walk: 2.4, run: 4.4, radius: 1.4, height: 5, eye: 4,
    vision: 90, closeSense: 25, fov: 300, attackRange: 4.6, damage: 55, windup: 0.9, cooldown: 2.4,
    wander: 10, leash: 9999, turn: 2.6, breach: 120, hearing: 0.8, ignore: ['tree']
  }
};

const rand = (a, b) => a + Math.random() * (b - a);
const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

function makeIndicator(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '700 50px Teko, Rajdhani, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, 32, 34);
  ctx.fillStyle = color;
  ctx.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false });
}

export class EnemyManager {
  constructor(scene, terrain, survival, building, particles, collision = null) {
    this.scene = scene;
    this.terrain = terrain;
    this.survival = survival;
    this.building = building;
    this.particles = particles;
    this.collision = collision;

    this.enemies = [];
    this.projectiles = [];
    this.dying = [];
    this.time = 0;
    this.nextGroupId = 1;

    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.boulderGeo = buildRockGeometry(11);
    this.boulderMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    this.alertMat = makeIndicator('?', '#fde047');
    this.chaseMat = makeIndicator('!', '#f87171');

    // Raids: first one arrives after a long quiet start, always with a warning
    this.raidActive = false;
    this.raidWarned = false;
    this.raidTimer = 0;
    this.raidCount = 0;
    this.timeUntilNextRaid = 420;
    this.wildlifeTimer = 70;

    this.day = 1;
    this.domRaidBanner = document.getElementById('raid-banner');
    this.domRaidTitle = document.getElementById('raid-title');
    this.domRaidSubtitle = document.getElementById('raid-subtitle');
    this.domBossBar = document.getElementById('boss-bar-container');
    this.domBossHp = document.getElementById('boss-hp-fill');
    this.domBossName = document.getElementById('boss-name-label');

    // Calling in the VTOL draws an assault on the summit
    window.addEventListener('extraction_started', () => {
      const tower = { x: -120, y: 0, z: -140 };
      if (!this.raidActive) {
        this.raidWarned = false;
        this.triggerRaid(new THREE.Vector3(tower.x, this.terrain.getHeightAt(tower.x, tower.z), tower.z));
      }
    });

    this.spawnInitialPopulation();
  }

  // ---------- spawning ----------

  isDryGround(x, z) {
    return this.terrain.getHeightAt(x, z) > this.terrain.waterLevel + 1.0 && this.terrain.isWalkable(x, z);
  }

  findSpawnPoint(minR, maxR, around = SAFE_CENTER, tries = 40) {
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(minR, maxR);
      const x = around.x + Math.cos(a) * r;
      const z = around.z + Math.sin(a) * r;
      if (this.isDryGround(x, z) && !this.collision?.blockedAt(x, z, this.terrain.getHeightAt(x, z) + 1, 1.5)) return { x, z };
    }
    return null;
  }

  spawnInitialPopulation() {
    // Stalker packs lair out in the forest, well away from the safe meadow
    for (let pack = 0; pack < 3; pack++) {
      const den = this.findSpawnPoint(105 + pack * 22, 150 + pack * 25);
      if (den) this.spawnStalkerPack(den.x, den.z, 2 + (pack % 2));
    }
    // PMC troopers hold the bunker
    for (let i = 0; i < 4; i++) {
      const e = this.spawnTrooper(62 + rand(0, 10), -26 + rand(-4, 4));
      e.home.set(60, 0, -28);
    }
  }

  spawnStalkerPack(x, z, count, opts = {}) {
    const group = this.nextGroupId++;
    const members = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      members.push(this.spawnStalker(x + Math.cos(a) * 3, z + Math.sin(a) * 3, { ...opts, group }));
    }
    return members;
  }

  createEnemy(type, mesh, x, z, extra = {}) {
    const S = STATS[type];
    const y = this.terrain.getHeightAt(x, z);
    mesh.position.set(x, y, z);
    this.collision?.resolve(mesh.position, S.radius + 0.2, y, S.height, S.ignore);
    this.collision?.resolve(mesh.position, S.radius + 0.2, y, S.height, S.ignore);
    mesh.position.y = this.terrain.getHeightAt(mesh.position.x, mesh.position.z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(mesh);

    const indicator = new THREE.Sprite(this.alertMat);
    indicator.position.y = S.height + 0.7;
    indicator.scale.set(0.8, 0.8, 1);
    indicator.renderOrder = 12;
    indicator.visible = false;
    indicator.raycast = () => {};
    mesh.add(indicator);

    const enemy = {
      type, name: S.name, mesh, stats: S,
      hp: S.hp, maxHp: S.hp,
      group: 0, raider: false,
      state: 'idle', stateTime: 0,
      awareness: 0, lastSeen: 0, canSeePlayer: false, hasLos: false, losTimer: 0,
      lastKnown: new THREE.Vector3(x, y, z),
      home: new THREE.Vector3(x, y, z),
      wanderTarget: null, wanderWait: rand(1, 5),
      attackCooldown: rand(0, 1), windup: 0, shootCd: rand(0.5, 1.5), boulderCooldown: 5,
      strafeDir: Math.random() < 0.5 ? -1 : 1, strafeTimer: rand(1, 3),
      flank: (Math.random() - 0.5) * 2,
      steerTimer: 0, steerSign: 1, steerCooldown: 0, slideDir: 0, slideTimer: 0, slideFail: 0, slideFlips: 0, slideFlipTimer: 0, backoff: 0, lastNormal: null, stuckTimer: 0, breachTimer: 0, blockedFor: 0,
      speed: 0, indicator,
      ...extra
    };
    this.enemies.push(enemy);
    return enemy;
  }

  spawnStalker(x, z, opts = {}) {
    const e = this.createEnemy('stalker', createStalker(), x, z, { drops: [{ id: 'raw_meat', count: 1 }], ...opts });
    if (opts.raider) this.setState(e, 'chase');
    return e;
  }

  spawnTrooper(x, z, opts = {}) {
    const e = this.createEnemy('trooper', createTrooper(), x, z, {
      drops: [{ id: 'ammo_rifle', count: 1 }, { id: 'scrap', count: 2 }], ...opts
    });
    return e;
  }

  spawnIronBehemoth(x, z) {
    const e = this.createEnemy('behemoth', createBehemoth(), x, z, {
      raider: true,
      boulderCooldown: 5.0,
      drops: [{ id: 'behemoth_core', count: 1 }, { id: 'raw_meat', count: 3 }, { id: 'scrap', count: 4 }]
    });
    this.setState(e, 'chase');
    sounds.playMonsterGrowl(true, e.mesh.position);
    this.showBossBar(e);
    return e;
  }

  showBossBar(boss) {
    if (this.domBossBar) {
      this.domBossBar.style.display = 'flex';
      if (this.domBossName) this.domBossName.textContent = boss.name;
      if (this.domBossHp) this.domBossHp.style.width = '100%';
    }
  }

  hideBossBar() {
    if (this.domBossBar) {
      this.domBossBar.style.display = 'none';
    }
  }

  // ---------- raids ----------

  warnRaid() {
    this.raidWarned = true;
    sounds.playRaidAlarm();
    if (this.domRaidBanner) {
      this.domRaidBanner.style.display = 'block';
      if (this.domRaidTitle) this.domRaidTitle.textContent = 'SOMETHING IS COMING...';
      if (this.domRaidSubtitle) this.domRaidSubtitle.textContent = 'THE FOREST GOES SILENT. FORTIFY YOUR POSITION!';
    }
    window.showTacticalNotification?.('RAID INCOMING IN ~25 SECONDS — build walls, load up and hold the camp!', 'warning');
  }

  triggerRaid(playerPos) {
    this.raidActive = true;
    this.raidWarned = false;
    this.raidCount++;
    this.raidTimer = 150;

    if (this.domRaidBanner) {
      this.domRaidBanner.style.display = 'block';
      if (this.domRaidTitle) this.domRaidTitle.textContent = 'THE WILDS ARE STIRRING...';
      if (this.domRaidSubtitle) this.domRaidSubtitle.textContent = 'A HOSTILE HORDE IS ASSAULTING YOUR OUTPOST!';
    }

    const stalkers = Math.min(8, 1 + this.day + this.raidCount);
    for (let i = 0; i < stalkers; i++) {
      const spot = this.findSpawnPoint(58 + i * 6, 72 + i * 8, playerPos);
      if (spot) this.spawnStalker(spot.x, spot.z, { raider: true }).lastKnown.copy(playerPos);
    }

    if (!this.enemies.some(e => e.type === 'behemoth')) {
      const spot = this.findSpawnPoint(85, 100, playerPos);
      if (spot) this.spawnIronBehemoth(spot.x, spot.z).lastKnown.copy(playerPos);
    }
  }

  endRaid() {
    this.raidActive = false;
    this.timeUntilNextRaid = 360;
    for (const e of this.enemies) e.raider = e.type === 'behemoth' ? e.raider : false;
    if (this.domRaidBanner) {
      this.domRaidBanner.style.display = 'none';
    }
  }

  // ---------- noise & damage ----------

  // Gunfire, explosions and tool hits alert everything that could plausibly hear them
  makeNoise(pos, radius) {
    for (const e of this.enemies) {
      if (e.state === 'chase') continue;
      if (!e.raider && this.inSafeZone(pos.x, pos.z) && Math.hypot(e.mesh.position.x, e.mesh.position.z) > SAFE_ZONE_RADIUS + 10) continue;
      const d = Math.hypot(pos.x - e.mesh.position.x, pos.z - e.mesh.position.z);
      const reach = radius * e.stats.hearing;
      if (d > reach) continue;
      const loud = 1 - d / reach;
      e.awareness = Math.max(e.awareness, 0.4 + loud * 0.65);
      // Imprecise at range: they investigate the area, not the exact spot
      const err = d * 0.12;
      e.lastKnown.set(pos.x + rand(-err, err), pos.y, pos.z + rand(-err, err));
      if (e.state === 'idle' || e.state === 'wander' || e.state === 'return') this.setState(e, 'alert');
    }
  }

  inSafeZone(x, z) {
    return Math.hypot(x - SAFE_CENTER.x, z - SAFE_CENTER.z) < SAFE_ZONE_RADIUS;
  }

  damageEnemy(enemy, damage) {
    enemy.hp -= damage;

    // Getting shot wakes the target and its pack
    if (enemy.state !== 'chase' && enemy.hp > 0) {
      enemy.awareness = 1.3;
      this.enterChase(enemy);
    }

    if (enemy.type === 'behemoth' && this.domBossHp) {
      const pct = Math.max(0, (enemy.hp / enemy.maxHp) * 100);
      this.domBossHp.style.width = `${pct}%`;
    }

    if (enemy.mesh) {
      const flashMat = this.flashMat;
      enemy.mesh.traverse(child => {
        if (child.isMesh && !child.origMat) {
          child.origMat = child.material;
          child.material = flashMat;
        }
      });
      setTimeout(() => {
        if (enemy.mesh) {
          enemy.mesh.traverse(child => {
            if (child.isMesh && child.origMat) {
              child.material = child.origMat;
              delete child.origMat;
            }
          });
        }
      }, 70);
    }

    if (enemy.hp <= 0) {
      this.killEnemy(enemy);
      return true;
    }
    return false;
  }

  killEnemy(enemy) {
    if (enemy.dead) return;
    enemy.dead = true;
    sounds.playMonsterGrowl(enemy.type === 'behemoth', enemy.mesh.position);
    enemy.indicator.visible = false;

    if (enemy.type === 'behemoth') {
      this.hideBossBar();
    }

    if (enemy.drops) {
      for (const d of enemy.drops) {
        window.dispatchEvent(new CustomEvent('enemy_dropped_loot', {
          detail: { pos: enemy.mesh.position.clone(), itemId: d.id, count: d.count }
        }));
      }
    }

    const big = enemy.type === 'behemoth';
    const p = enemy.mesh.position;
    this.particles.createImpact(new THREE.Vector3(p.x, p.y + (big ? 3 : 1), p.z), new THREE.Vector3(0, 1, 0), 'blood');
    for (let i = 0; i < (big ? 18 : 6); i++) {
      this.particles.spawn({
        x: p.x + (Math.random() - 0.5) * (big ? 3 : 1), y: p.y + 0.2, z: p.z + (Math.random() - 0.5) * (big ? 3 : 1),
        vx: (Math.random() - 0.5) * 1.5, vy: 0.4 + Math.random(), vz: (Math.random() - 0.5) * 1.5,
        life: 1.2 + Math.random() * 0.8, size0: big ? 1.0 : 0.4, size1: big ? 4.0 : 1.6,
        color: 0x6a6258, alpha: 0.35, drag: 1.2, fadeIn: 0.1
      });
    }
    this.dying.push({ mesh: enemy.mesh, t: 0, tiltAxis: Math.random() < 0.5 ? 1 : -1, big });
    this.enemies = this.enemies.filter(e => e !== enemy);
  }

  // Enemy models own their geometry and materials, so free the GPU memory once a corpse is gone
  disposeModel(root) {
    root.traverse((child) => {
      if (child.isSprite) return; // indicator materials are shared
      child.geometry?.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) if (m && m !== this.flashMat) m.dispose();
    });
  }

  updateDying(delta) {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.t += delta;
      const fall = Math.min(1, d.t / (d.big ? 1.1 : 0.45));
      const eased = 1 - Math.pow(1 - fall, 3);
      d.mesh.rotation.z = d.tiltAxis * eased * Math.PI * 0.5;
      if (d.t > 2.0) d.mesh.position.y -= delta * (d.big ? 1.6 : 0.9);
      if (d.t > 3.2) {
        this.scene.remove(d.mesh);
        this.disposeModel(d.mesh);
        this.dying.splice(i, 1);
      }
    }
  }

  // ---------- state machine ----------

  setState(e, state) {
    if (e.state === state) return;
    e.state = state;
    e.stateTime = 0;
    if (state === 'wander') e.wanderTarget = null;
    if (state === 'alert') {
      e.steerTimer = 0;
    }
  }

  enterChase(e) {
    if (e.state === 'chase') return;
    this.setState(e, 'chase');
    e.awareness = Math.max(e.awareness, 1.3);
    e.lastSeen = 0;
    if (e.type === 'trooper') sounds.playAlert(e.mesh.position);
    else sounds.playMonsterGrowl(e.type === 'behemoth', e.mesh.position);

    // The whole pack piles in
    if (e.group) {
      for (const o of this.enemies) {
        if (o === e || o.group !== e.group || o.state === 'chase') continue;
        if (o.mesh.position.distanceTo(e.mesh.position) < 45) {
          o.awareness = 1.3;
          o.lastKnown.copy(e.lastKnown);
          this.setState(o, 'chase');
        }
      }
    }
    if (e.type === 'trooper') {
      for (const o of this.enemies) {
        if (o === e || o.type !== 'trooper' || o.state === 'chase') continue;
        if (o.mesh.position.distanceTo(e.mesh.position) < 40) {
          o.awareness = Math.max(o.awareness, 0.8);
          o.lastKnown.copy(e.lastKnown);
          this.setState(o, 'alert');
        }
      }
    }
  }

  hasLineOfSight(e, target) {
    const from = e.mesh.position;
    const sy = from.y + e.stats.eye;
    const ty = target.y;
    const dx = target.x - from.x;
    const dz = target.z - from.z;
    const dist = Math.hypot(dx, dz);
    const steps = Math.min(30, Math.ceil(dist / 2));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = from.x + dx * t;
      const z = from.z + dz * t;
      const y = sy + (ty - sy) * t;
      if (this.terrain.getHeightAt(x, z) > y - 0.15) return false;
      if (this.collision?.blockedAt(x, z, y, 0.05)) return false;
    }
    return true;
  }

  perceive(e, dt, env) {
    const S = e.stats;
    const pos = e.mesh.position;
    const P = env.playerPos;
    const dx = P.x - pos.x;
    const dz = P.z - pos.z;
    const dist = Math.hypot(dx, dz);
    e.distToPlayer = dist;

    let seen = false;
    let range = 1;
    const safe = !e.raider && env.playerInSafe;
    if (!safe) {
      range = S.vision;
      if (env.isNight) range *= 0.65;
      if (env.isRaining) range *= 0.8;
      if (env.crouching) range *= 0.55;
      if (env.sprinting) range *= 1.25;
      if (!env.moving && !env.sprinting) range *= 0.75; // standing still is harder to spot
      if (e.raider) range = Math.max(range, 70);

      if (dist < range) {
        const fx = Math.sin(e.mesh.rotation.y);
        const fz = Math.cos(e.mesh.rotation.y);
        const dot = (fx * dx + fz * dz) / (dist || 1);
        const inCone = dist < S.closeSense || dot > Math.cos((S.fov * Math.PI) / 360);
        if (inCone) {
          e.losTimer -= dt;
          if (e.losTimer <= 0) {
            e.losTimer = 0.15;
            e.hasLos = this.hasLineOfSight(e, P);
          }
          seen = e.hasLos;
        }
      }
    }
    e.canSeePlayer = seen;

    if (seen) {
      const closeness = 1 - Math.min(1, dist / range);
      const rate = e.raider ? 4 : 0.22 + 1.1 * Math.pow(closeness, 1.5);
      e.awareness = Math.min(1.3, e.awareness + rate * dt);
      e.lastKnown.copy(P);
      e.lastSeen = 0;
    } else {
      e.lastSeen += dt;
      if (e.state !== 'chase') e.awareness = Math.max(0, e.awareness - 0.1 * dt);
    }
    return { dist, safe };
  }

  // ---------- movement ----------

  moveToward(e, target, speed, dt) {
    const S = e.stats;
    const pos = e.mesh.position;
    let dx = target.x - pos.x;
    let dz = target.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return { arrived: true, blocker: null };
    dx /= dist;
    dz /= dist;

    if (e.steerTimer > 0) {
      e.steerTimer -= dt;
      const a = e.steerSign * 1.15;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const nx = dx * c - dz * s;
      dz = dx * s + dz * c;
      dx = nx;
    }

    const step = speed * dt;
    const curGround = pos.y;

    // Trapped in a pocket (both ways along the obstacle are blocked): back straight out first
    if (e.backoff > 0 && e.lastNormal) {
      e.backoff -= dt;
      const out = new THREE.Vector3(pos.x + e.lastNormal.x * step, 0, pos.z + e.lastNormal.z * step);
      this.collision?.resolve(out, S.radius, curGround, S.height, S.ignore);
      pos.x = out.x;
      pos.z = out.z;
      e.lastProgress = 1;
      return { arrived: false, blocker: null };
    }
    e.slideFlipTimer = Math.max(0, (e.slideFlipTimer || 0) - dt);
    if (e.slideFlipTimer === 0) e.slideFlips = 0;
    const cand = new THREE.Vector3(pos.x + dx * step, 0, pos.z + dz * step);
    let blocked = false;

    // Keep out of deep water and off cliff faces; try sliding along each axis before giving up
    const passable = (x, z) => {
      const h = this.terrain.getHeightAt(x, z);
      if (h < this.terrain.waterLevel - 0.3) return false;
      if ((h - curGround) / Math.max(step, 0.001) > 1.7) return false;
      if (!e.raider && this.inSafeZone(x, z)) return false;
      return true;
    };
    if (!passable(cand.x, cand.z)) {
      if (passable(cand.x, pos.z)) cand.z = pos.z;
      else if (passable(pos.x, cand.z)) cand.x = pos.x;
      else {
        // Water or a cliff dead ahead: fan out to the nearest walkable heading, preferring the side we already chose
        cand.x = pos.x;
        cand.z = pos.z;
        blocked = true;
        for (const a of [0.8, 1.6, 2.4]) {
          let found = false;
          for (const sgn of [e.steerSign, -e.steerSign]) {
            const c = Math.cos(a * sgn);
            const sn = Math.sin(a * sgn);
            const cx = pos.x + (dx * c - dz * sn) * step;
            const cz = pos.z + (dx * sn + dz * c) * step;
            if (passable(cx, cz)) {
              cand.x = cx;
              cand.z = cz;
              blocked = false;
              found = true;
              e.steerSign = sgn;
              break;
            }
          }
          if (found) break;
        }
      }
    }

    const before = { x: cand.x, z: cand.z };
    let blocker = this.collision?.resolve(cand, S.radius, curGround, S.height, S.ignore) ?? null;

    // Pressed flat against something: slide along it instead of grinding into it
    if (blocker) {
      const nx = cand.x - before.x;
      const nz = cand.z - before.z;
      const nl = Math.hypot(nx, nz);
      if (nl > step * 0.15) {
        const tx = -nz / nl;
        const tz = nx / nl;
        e.lastNormal = { x: nx / nl, z: nz / nl };
        // Commit to one way around the obstacle; re-deciding every frame makes actors oscillate in front of it
        if (e.slideTimer <= 0 || e.slideDir === 0) {
          const along = tx * dx + tz * dz;
          e.slideDir = Math.abs(along) > 0.15 ? Math.sign(along) : e.steerSign;
        }
        e.slideTimer = 1.6;
        cand.x = pos.x + tx * e.slideDir * step;
        cand.z = pos.z + tz * e.slideDir * step;
        blocker = this.collision.resolve(cand, S.radius, curGround, S.height, S.ignore) ?? blocker;

        // Wedged into a concave corner (e.g. wall meets tree): back out the other way
        if (Math.hypot(cand.x - pos.x, cand.z - pos.z) < step * 0.3) {
          e.slideFail += dt;
          if (e.slideFail > 0.3) {
            e.slideDir *= -1;
            e.slideFail = 0;
            e.slideTimer = 2.4;
            e.slideFlips = (e.slideFlips || 0) + 1;
            e.slideFlipTimer = 3;
            if (e.slideFlips >= 2) {
              e.slideFlips = 0;
              e.backoff = 1.2;
              e.steerSign *= -1;
              e.steerTimer = 3;
            }
          }
        } else {
          e.slideFail = 0;
        }
      }
    }

    // Soft separation from other enemies so packs spread instead of stacking
    for (const o of this.enemies) {
      if (o === e) continue;
      const ox = cand.x - o.mesh.position.x;
      const oz = cand.z - o.mesh.position.z;
      const min = S.radius + o.stats.radius;
      const d2 = ox * ox + oz * oz;
      if (d2 < min * min && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        cand.x += (ox / d) * (min - d) * 0.5;
        cand.z += (oz / d) * (min - d) * 0.5;
      }
    }

    blocker = this.collision?.resolve(cand, S.radius, curGround, S.height, S.ignore) ?? blocker;

    // Titans trample whatever trees they walk into
    if (S.ignore && this.collision) {
      const hit = this.collision.blockedAt(cand.x, cand.z, curGround + 1, S.radius + 0.4);
      if (hit && hit.owner?.type === 'tree' && hit.owner.tree) {
        window.dispatchEvent(new CustomEvent('trample_tree', { detail: { tree: hit.owner.tree, dir: { x: dx, z: dz } } }));
      }
    }

    e.slideTimer = Math.max(0, e.slideTimer - dt);
    const moved = Math.hypot(cand.x - pos.x, cand.z - pos.z);
    e.lastProgress = moved / Math.max(step, 0.0001);
    if (moved < step * 0.3) e.stuckTimer += dt;
    else e.stuckTimer = Math.max(0, e.stuckTimer - dt * 2);
    e.steerCooldown = Math.max(0, e.steerCooldown - dt);
    if (e.stuckTimer > 0.4) {
      e.stuckTimer = 0;
      e.steerTimer = 2.4 + Math.random() * 0.8;
      if (e.steerCooldown <= 0) e.steerSign = Math.random() < 0.5 ? -1 : 1;
      e.steerCooldown = 7; // keep the same side while still working on the same obstacle
    }

    pos.x = cand.x;
    pos.z = cand.z;
    return { arrived: false, blocker };
  }

  faceToward(e, tx, tz, dt) {
    const pos = e.mesh.position;
    const want = Math.atan2(tx - pos.x, tz - pos.z);
    const diff = angleDelta(e.mesh.rotation.y, want);
    const maxTurn = e.stats.turn * dt;
    e.mesh.rotation.y += Math.max(-maxTurn, Math.min(maxTurn, diff));
  }

  // Walls in the way get smashed
  breach(e, blocker, dt) {
    const owner = blocker?.owner;
    if (!owner || owner.hp === undefined || !this.building.structures.includes(owner)) {
      e.breachTimer = 0;
      e.blockedFor = Math.max(0, e.blockedFor - dt * 2);
      return;
    }
    if (e.lastProgress > 0.55) {
      e.blockedFor = Math.max(0, e.blockedFor - dt); // still making headway along the obstacle
      return;
    }
    e.blockedFor += dt;
    if (e.blockedFor < 3.5) return; // try going around first
    e.breachTimer += dt;
    if (e.breachTimer > 1.0) {
      e.breachTimer = 0;
      this.building.damageStructure(owner, e.stats.breach);
      sounds.playImpact('wood', e.mesh.position);
      const p = owner.position;
      this.particles.createImpact(new THREE.Vector3(p.x, p.y, p.z), new THREE.Vector3(0, 1, 0), 'wood');
    }
  }

  // ---------- per-type combat ----------

  strikePlayer(e, env, reachMult = 1.35) {
    const S = e.stats;
    if (e.distToPlayer < S.attackRange * reachMult) {
      this.survival.takeDamage(S.damage);
      window.dispatchEvent(new CustomEvent('player_hit', { detail: { from: e.mesh.position.clone(), amount: S.damage } }));
      sounds.playImpact('flesh', env.playerPos);
      if (e.type === 'behemoth') {
        sounds.playTreeFall(e.mesh.position);
        this.particles.createShockwave(e.mesh.position, 10, 0xef4444);
      }
    } else if (e.type === 'behemoth') {
      sounds.playTreeFall(e.mesh.position);
      this.particles.createShockwave(e.mesh.position, 8, 0xef4444);
    }
  }

  chaseStalker(e, dt, env) {
    const S = e.stats;
    const P = env.playerPos;
    if (e.windup > 0) {
      e.windup -= dt;
      e.speed = 0;
      this.faceToward(e, P.x, P.z, dt);
      if (e.windup <= 0) this.strikePlayer(e, env);
      return;
    }

    if (e.canSeePlayer && e.distToPlayer <= S.attackRange) {
      this.faceToward(e, P.x, P.z, dt);
      if (e.attackCooldown <= 0) {
        e.windup = S.windup;
        e.attackCooldown = S.cooldown;
        sounds.playMonsterGrowl(false, e.mesh.position);
      }
      return;
    }

    // Pack members approach from different angles instead of in a single file
    let tx = e.canSeePlayer ? P.x : e.lastKnown.x;
    let tz = e.canSeePlayer ? P.z : e.lastKnown.z;
    if (e.canSeePlayer && e.distToPlayer > 7) {
      const dx = e.mesh.position.x - tx;
      const dz = e.mesh.position.z - tz;
      const d = Math.hypot(dx, dz) || 1;
      tx += (-dz / d) * e.flank * 5;
      tz += (dx / d) * e.flank * 5;
    }
    const before = e.mesh.position.clone();
    const res = this.moveToward(e, { x: tx, z: tz }, S.run, dt);
    if (res.blocker) this.breach(e, res.blocker, dt);
    this.faceToward(e, tx, tz, dt);
    e.speed = before.distanceTo(e.mesh.position) / dt;
  }

  chaseTrooper(e, dt, env) {
    const S = e.stats;
    const P = env.playerPos;
    const pos = e.mesh.position;
    const before = pos.clone();

    if (e.canSeePlayer && e.distToPlayer < S.attackRange) {
      this.faceToward(e, P.x, P.z, dt);
      e.strafeTimer -= dt;
      if (e.strafeTimer <= 0) {
        e.strafeTimer = rand(1.5, 3.5);
        e.strafeDir *= -1;
      }
      const dx = P.x - pos.x;
      const dz = P.z - pos.z;
      const d = e.distToPlayer || 1;
      let target;
      let speed;
      if (e.distToPlayer > 26) {
        target = { x: P.x, z: P.z };
        speed = S.run;
      } else if (e.distToPlayer < 11) {
        target = { x: pos.x - dx, z: pos.z - dz };
        speed = S.walk * 1.4;
      } else {
        target = { x: pos.x + (-dz / d) * e.strafeDir * 5, z: pos.z + (dx / d) * e.strafeDir * 5 };
        speed = S.walk;
      }
      const res = this.moveToward(e, target, speed, dt);
      if (res.blocker) this.breach(e, res.blocker, dt);

      e.shootCd -= dt;
      if (e.shootCd <= 0) {
        e.shootCd = rand(0.9, 1.7);
        this.trooperShoot(e, env);
      }
    } else {
      const res = this.moveToward(e, e.lastKnown, S.run, dt);
      if (res.blocker) this.breach(e, res.blocker, dt);
      this.faceToward(e, e.lastKnown.x, e.lastKnown.z, dt);
    }
    e.speed = before.distanceTo(pos) / dt;
  }

  trooperShoot(e, env) {
    const S = e.stats;
    const P = env.playerPos;
    const muzzle = e.mesh.localToWorld(new THREE.Vector3(0.13, 1.38, 0.95));
    sounds.playRifleShot(e.mesh.position, true);

    // Accuracy falls off with distance; crouching and sprinting both help the player
    let chance = 0.72 - e.distToPlayer / 55;
    if (env.crouching) chance *= 0.75;
    if (env.sprinting) chance *= 0.8;
    chance = Math.max(0.1, Math.min(0.6, chance));
    const hit = Math.random() < chance;

    const aim = new THREE.Vector3(P.x, P.y - 0.3, P.z);
    if (hit) {
      this.survival.takeDamage(S.damage);
      window.dispatchEvent(new CustomEvent('player_hit', { detail: { from: e.mesh.position.clone(), amount: S.damage } }));
      sounds.playImpact('flesh', P);
    } else {
      aim.x += rand(-1.6, 1.6);
      aim.y += rand(-1.2, 1.0);
      aim.z += rand(-1.6, 1.6);
      sounds.playBulletWhizz(aim);
      this.particles.createImpact(aim, new THREE.Vector3(0, 1, 0), 'sparks');
    }
    // Extend the tracer past the target so it reads as a shot, not a laser pointer
    const dir = aim.clone().sub(muzzle).normalize();
    this.particles.createTracer(muzzle, aim.clone().addScaledVector(dir, hit ? 0 : 25));
    this.particles.createMuzzleSmoke(muzzle, dir, false);
  }

  chaseBehemoth(e, dt, env) {
    const S = e.stats;
    const P = env.playerPos;
    const pos = e.mesh.position;

    if (e.windup > 0) {
      e.windup -= dt;
      e.speed = 0;
      this.faceToward(e, P.x, P.z, dt);
      if (e.windup <= 0) this.strikePlayer(e, env, 1.25);
      return;
    }

    e.boulderCooldown -= dt;
    if (e.boulderCooldown <= 0 && e.canSeePlayer && e.distToPlayer > 12 && e.distToPlayer < 50) {
      e.boulderCooldown = 8.0;
      this.hurlBoulder(pos, P);
    }

    if (e.canSeePlayer && e.distToPlayer <= S.attackRange) {
      this.faceToward(e, P.x, P.z, dt);
      if (e.attackCooldown <= 0) {
        e.windup = S.windup;
        e.attackCooldown = S.cooldown;
        sounds.playMonsterGrowl(true, pos);
      }
      return;
    }

    const before = pos.clone();
    const tx = e.canSeePlayer ? P.x : e.lastKnown.x;
    const tz = e.canSeePlayer ? P.z : e.lastKnown.z;
    const res = this.moveToward(e, { x: tx, z: tz }, S.run, dt);
    if (res.blocker) this.breach(e, res.blocker, dt);
    this.faceToward(e, tx, tz, dt);
    e.speed = before.distanceTo(pos) / dt;
  }

  // ---------- idle behaviours ----------

  wander(e, dt) {
    const S = e.stats;
    const pos = e.mesh.position;
    const before = pos.clone();

    if (!e.wanderTarget) {
      e.wanderWait -= dt;
      e.speed = 0;
      if (e.wanderWait <= 0) {
        for (let i = 0; i < 8 && !e.wanderTarget; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = rand(S.wander * 0.3, S.wander);
          const x = e.home.x + Math.cos(a) * r;
          const z = e.home.z + Math.sin(a) * r;
          if (this.isDryGround(x, z) && (e.raider || !this.inSafeZone(x, z))) e.wanderTarget = { x, z };
        }
        e.wanderWait = rand(3, 9);
      }
      return;
    }
    const res = this.moveToward(e, e.wanderTarget, S.walk, dt);
    this.faceToward(e, e.wanderTarget.x, e.wanderTarget.z, dt);
    if (res.arrived || Math.hypot(e.wanderTarget.x - pos.x, e.wanderTarget.z - pos.z) < 1.2 || e.stateTime > 14) {
      e.wanderTarget = null;
      e.stateTime = 0;
    }
    e.speed = before.distanceTo(pos) / dt;
  }

  // ---------- main update ----------

  updateEnemy(e, dt, env, worldStructures) {
    const S = e.stats;
    const pos = e.mesh.position;
    e.stateTime += dt;
    e.attackCooldown = Math.max(0, e.attackCooldown - dt);
    e.speed = 0;

    // Metal spikes hurt anything that wanders into them
    if (worldStructures) {
      for (const s of worldStructures) {
        if (s.type === 'metal_spikes' && s.position.distanceTo(pos) < 2.2) {
          this.damageEnemy(e, 35 * dt);
          if (Math.random() < 0.3) this.particles.createImpact(pos, new THREE.Vector3(0, 1, 0), 'sparks');
          if (e.dead) return;
        }
      }
    }

    const { safe } = this.perceive(e, dt, env);

    switch (e.state) {
      case 'idle':
      case 'wander':
        if (e.awareness >= 1) this.enterChase(e);
        else if (e.awareness >= 0.35) this.setState(e, 'alert');
        else if (e.stateTime > 0.1) {
          if (e.state === 'idle') this.setState(e, 'wander');
          this.wander(e, dt);
        }
        break;

      case 'alert': {
        // Freeze, turn toward the disturbance, then go and look if it was real
        this.faceToward(e, e.lastKnown.x, e.lastKnown.z, dt);
        if (e.awareness >= 1) this.enterChase(e);
        else if (e.canSeePlayer) e.stateTime = Math.min(e.stateTime, 1.5); // keep staring while the meter fills
        else if (e.stateTime > 2.2) this.setState(e, e.awareness > 0.3 ? 'search' : 'return');
        break;
      }

      case 'chase': {
        const tooFar = !e.raider && Math.hypot(pos.x - e.home.x, pos.z - e.home.z) > S.leash;
        if (safe && e.stateTime > 3) { this.setState(e, 'return'); break; }
        if (tooFar) { this.setState(e, 'return'); break; }
        if (!e.canSeePlayer && e.lastSeen > (e.raider ? 25 : 7)) { this.setState(e, 'search'); break; }
        if (e.type === 'stalker') this.chaseStalker(e, dt, env);
        else if (e.type === 'trooper') this.chaseTrooper(e, dt, env);
        else this.chaseBehemoth(e, dt, env);
        break;
      }

      case 'search': {
        const before = pos.clone();
        const dist = Math.hypot(e.lastKnown.x - pos.x, e.lastKnown.z - pos.z);
        if (e.awareness >= 1) { this.enterChase(e); break; }
        if (dist > 2.5 && e.stateTime < 20) {
          const res = this.moveToward(e, e.lastKnown, S.walk * 1.7, dt);
          if (res.blocker) this.breach(e, res.blocker, dt);
          this.faceToward(e, e.lastKnown.x, e.lastKnown.z, dt);
          e.speed = before.distanceTo(pos) / dt;
        } else {
          // Look around for a few seconds, then give up
          e.mesh.rotation.y += Math.sin(this.time * 2.2 + e.group) * dt * 1.5;
          if (!e.searchLooking) { e.searchLooking = true; e.searchStart = e.stateTime; }
          if (e.stateTime - e.searchStart > 5) { e.searchLooking = false; this.setState(e, 'return'); }
        }
        break;
      }

      case 'return': {
        const before = pos.clone();
        if (e.awareness >= 1) { this.enterChase(e); break; }
        const dist = Math.hypot(e.home.x - pos.x, e.home.z - pos.z);
        if (dist < 3) { e.awareness = 0; this.setState(e, 'idle'); break; }
        const res = this.moveToward(e, e.home, S.walk * 1.4, dt);
        if (res.blocker) this.breach(e, res.blocker, dt);
        this.faceToward(e, e.home.x, e.home.z, dt);
        e.speed = before.distanceTo(pos) / dt;
        break;
      }
    }

    // Follow the ground (and any ramps) after moving
    pos.y = this.terrain.getHeightAt(pos.x, pos.z);

    const showIndicator = (e.state === 'alert' || e.state === 'chase' || e.state === 'search') && e.distToPlayer < 75;
    e.indicator.visible = showIndicator;
    if (showIndicator) e.indicator.material = e.state === 'chase' ? this.chaseMat : this.alertMat;

    animateEnemy(e, dt, e.speed, this.time);
  }

  update(delta, playerPos, worldStructures, env = {}) {
    this.time += delta;
    this.day = env.day ?? this.day;
    this.updateDying(delta);

    const ctx = {
      playerPos,
      isNight: !!env.isNight,
      isRaining: !!env.isRaining,
      crouching: !!env.crouching,
      sprinting: !!env.sprinting,
      moving: !!env.moving,
      playerInSafe: this.inSafeZone(playerPos.x, playerPos.z)
    };

    // Raid scheduling: warning, then arrival
    if (!this.raidActive) {
      this.timeUntilNextRaid -= delta;
      if (!this.raidWarned && this.timeUntilNextRaid <= 25) this.warnRaid();
      if (this.timeUntilNextRaid <= 0) this.triggerRaid(playerPos);
    } else {
      this.raidTimer -= delta;
      const raidersLeft = this.enemies.some(e => e.raider);
      if (this.raidTimer <= 0 || !raidersLeft) this.endRaid();
    }

    // Wildlife slowly repopulates the forest
    this.wildlifeTimer -= delta;
    if (this.wildlifeTimer <= 0) {
      this.wildlifeTimer = 90;
      const wild = this.enemies.filter(e => e.type === 'stalker' && !e.raider).length;
      if (wild < 6) {
        const spot = this.findSpawnPoint(95, 150, SAFE_CENTER);
        if (spot && Math.hypot(spot.x - playerPos.x, spot.z - playerPos.z) > 80) this.spawnStalkerPack(spot.x, spot.z, 2);
      }
    }

    // Boulders
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.vel.y -= 14.0 * delta;
      p.mesh.position.addScaledVector(p.vel, delta);
      p.mesh.rotation.x += 4.0 * delta;
      p.mesh.rotation.z += 2.5 * delta;
      this.particles.spawn({
        x: p.mesh.position.x, y: p.mesh.position.y, z: p.mesh.position.z,
        vx: (Math.random() - 0.5) * 0.4, vy: 0.2, vz: (Math.random() - 0.5) * 0.4,
        life: 0.8, size0: 0.3, size1: 1.0, color: 0x6a6258, alpha: 0.3, drag: 1.5, fadeIn: 0.1
      });

      const groundY = this.terrain.getHeightAt(p.mesh.position.x, p.mesh.position.z);
      const hitsWall = this.collision?.blockedAt(p.mesh.position.x, p.mesh.position.z, p.mesh.position.y, 0.4);
      if (p.mesh.position.y <= groundY + 0.5 || hitsWall) {
        sounds.playExplosion(p.mesh.position, 0.7);
        this.particles.createExplosionFX(p.mesh.position);

        if (p.mesh.position.distanceTo(playerPos) < 6.0) {
          this.survival.takeDamage(35);
          window.dispatchEvent(new CustomEvent('player_hit', { detail: { from: p.mesh.position.clone(), amount: 35 } }));
        }

        if (worldStructures) {
          for (const s of [...worldStructures]) {
            if (s.position.distanceTo(p.mesh.position) < 6.0) {
              this.building.damageStructure(s, 120);
            }
          }
        }

        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }

    for (const enemy of [...this.enemies]) {
      if (!enemy.dead) this.updateEnemy(enemy, delta, ctx, worldStructures);
    }
  }

  hurlBoulder(fromPos, toPos) {
    sounds.playMonsterGrowl(true, fromPos);

    const bMesh = new THREE.Mesh(this.boulderGeo, this.boulderMat);
    bMesh.castShadow = true;
    bMesh.scale.setScalar(0.85);
    bMesh.position.set(fromPos.x, fromPos.y + 4.0, fromPos.z);
    this.scene.add(bMesh);

    const dir = new THREE.Vector3().subVectors(toPos, fromPos).normalize();
    const vel = dir.multiplyScalar(22.0);
    vel.y += 6.0;

    this.projectiles.push({
      mesh: bMesh,
      vel: vel
    });
  }
}
