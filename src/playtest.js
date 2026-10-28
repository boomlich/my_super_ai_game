// ZONE ZERO: Automated playtesting harness (dev only — load with /?playtest)
//
// The game loop is split into simulation (GameEngine.tick) and rendering, so this harness can fast-forward the
// real game logic: a scripted "bot" player walks, shoots and mines while invariant checks run every tick.
// Scenarios cover collision, AI fairness, mining, raids, extraction, water, audio, economy, performance and a long
// random-walk soak test. Results are shown in an overlay and exposed as window.__playtestReport.
import * as THREE from 'three';
import { sounds } from './audio.js';
import { BUILD_RECIPES } from './building.js';
import { SAFE_ZONE_RADIUS } from './enemies.js';

const DT = 1 / 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Yields to the event loop without the 1 s timer clamp browsers apply to background tabs
const yieldNow = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : String(n));

export class Playtest {
  constructor(game) {
    this.g = game;
    this.violations = new Map();
    this.tickMs = [];
    this.results = [];
    this.rng = 12345;
    this.lastYield = 0;
  }

  get p() { return this.g.player; }
  get terrain() { return this.g.terrain; }

  rand() {
    // Deterministic LCG so a failing scenario can be replayed
    this.rng = (this.rng * 1664525 + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  // ---------- harness primitives ----------

  ensureRunning() {
    const g = this.g;
    if (!g.isRunning) {
      document.getElementById('start-screen').style.display = 'none';
      g.hud && (g.hud.style.visibility = '');
      g.camera.rotation.set(0, 0, 0);
      g.isRunning = true;
    }
  }

  ground(x, z) { return this.terrain.getHeightAt(x, z); }

  reset() {
    const g = this.g;
    this.ensureRunning();
    for (const e of [...g.enemies.enemies]) { g.scene.remove(e.mesh); g.enemies.disposeModel(e.mesh); }
    g.enemies.enemies.length = 0;
    for (const d of g.enemies.dying) g.scene.remove(d.mesh);
    g.enemies.dying.length = 0;
    for (const pr of g.enemies.projectiles) g.scene.remove(pr.mesh);
    g.enemies.projectiles.length = 0;
    g.enemies.raidActive = false;
    g.enemies.raidWarned = false;
    g.enemies.timeUntilNextRaid = 99999;
    g.enemies.wildlifeTimer = 99999;
    g.enemies.hideBossBar();
    if (g.enemies.domRaidBanner) g.enemies.domRaidBanner.style.display = 'none';

    for (const s of [...g.building.structures]) { g.scene.remove(s.mesh); g.collision.remove(s.collider); }
    g.building.structures.length = 0;
    for (const pk of g.world.pickups) g.scene.remove(pk.mesh);
    g.world.pickups.length = 0;

    const p = this.p;
    p.keys = {};
    p.velocity.set(0, 0, 0);
    p.isSwimming = false;
    p.isReloading = false;
    p.fireTimer = 0;
    p.switchWeapon(0);
    for (const w of p.weapons) if (typeof w.clip === 'number') w.clip = w.maxClip;
    this.feed();
    this.heal();
    this.place(0, 10, { yaw: 0 });

    const w = g.weather;
    w.timeOfDay = 11; w.timeSpeed = 0; w.isRaining = false; w.overcast = 0; w.rainTimer = -1e9;
  }

  feed() {
    const s = this.g.survival;
    for (const f of s.activeFoods) f.remaining = f.totalDuration;
    for (const id of ['cooked_meat', 'mre', 'stew']) s.eatFood(id);
  }

  heal() {
    const s = this.g.survival;
    s.isDead = false;
    s.currentHp = s.getMaxHp();
    s.currentStamina = s.getMaxStamina();
  }

  place(x, z, { yaw = 0, pitch = 0, height = 1.75 } = {}) {
    const p = this.p;
    p.position.set(x, this.ground(x, z) + height + 0.05, z);
    p.velocity.set(0, 0, 0);
    p.yaw = yaw;
    p.pitch = pitch;
  }

  aimAt(x, y, z) {
    const p = this.p;
    const dx = x - p.position.x;
    const dy = y - p.position.y;
    const dz = z - p.position.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }

  faceFrom(a, b) { return Math.atan2(-(b.x - a.x), -(b.z - a.z)); }

  step(n = 1) {
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      this.g.tick(DT);
      // Rendering normally refreshes world matrices; raycasts (bullets, mining) need them current in headless runs
      this.g.scene.updateMatrixWorld(true);
      this.tickMs.push(performance.now() - t0);
      this.checkInvariants();
    }
  }

  // Runs fn(t) every tick; yields to the browser regularly so the page stays alive. fn may return false to stop early.
  async simulate(seconds, fn) {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) {
      if (fn && fn(i * DT) === false) return i * DT;
      this.step();
      if (i % 240 === 239) await yieldNow();
    }
    return seconds;
  }

  violate(id, detail) {
    const v = this.violations.get(id) || { count: 0, first: null };
    v.count++;
    if (!v.first) v.first = detail;
    this.violations.set(id, v);
  }

  checkInvariants() {
    const g = this.g;
    const p = this.p;
    const pos = p.position;
    if (![pos.x, pos.y, pos.z, p.velocity.x, p.velocity.y, p.velocity.z, g.camera.position.x].every(Number.isFinite)) {
      this.violate('player-nonfinite', `${pos.x},${pos.y},${pos.z}`);
      return;
    }
    const gy = this.ground(pos.x, pos.z);
    if (!p.isSwimming && pos.y < gy + 0.8) this.violate('player-below-ground', `y=${fmt(pos.y)} ground=${fmt(gy)} at ${fmt(pos.x)},${fmt(pos.z)}`);
    if (pos.y > gy + 60 && !g.world.extractionActive) this.violate('player-flying', `y=${fmt(pos.y)}`);

    const eye = p.keys['KeyC'] ? 1.0 : 1.75;
    const probe = pos.clone();
    g.collision.resolve(probe, 0.42, pos.y - eye, eye + 0.2);
    if (dist2(probe, pos) > 0.2) this.violate('player-in-solid', `pushed ${fmt(dist2(probe, pos), 2)}m at ${fmt(pos.x)},${fmt(pos.z)}`);

    for (const e of g.enemies.enemies) {
      const ep = e.mesh.position;
      if (![ep.x, ep.y, ep.z].every(Number.isFinite)) { this.violate('enemy-nonfinite', e.type); continue; }
      const h = this.ground(ep.x, ep.z);
      if (h < this.terrain.waterLevel - 0.9) this.violate('enemy-in-water', `${e.type} ${e.state} at ${fmt(ep.x)},${fmt(ep.z)}`);
      if (Math.abs(ep.y - h) > 0.6) this.violate('enemy-off-ground', `${e.type} y=${fmt(ep.y)} ground=${fmt(h)}`);
      const ep2 = ep.clone();
      g.collision.resolve(ep2, e.stats.radius, h, e.stats.height, e.stats.ignore);
      if (dist2(ep2, ep) > 0.25) this.violate('enemy-in-solid', `${e.type} ${e.state} pushed ${fmt(dist2(ep2, ep), 2)}m`);
      if (!e.raider && Math.hypot(ep.x, ep.z) < SAFE_ZONE_RADIUS - 2) this.violate('enemy-in-safe-zone', `${e.type} ${e.state} at ${fmt(ep.x)},${fmt(ep.z)}`);
    }
    const ps = g.particles;
    if (ps.particles.length > ps.softPool.capacity + ps.glowPool.capacity) this.violate('particle-overflow', ps.particles.length);
  }

  // Walks toward (x, z) with naive obstacle sidestepping. Returns { arrived, time, stuck }.
  async walkTo(x, z, { timeout = 60, sprint = false, tolerance = 1.5 } = {}) {
    const p = this.p;
    let stuck = 0;
    let lastCheck = { x: p.position.x, z: p.position.z, t: 0 };
    let sidestep = 0;
    let t = 0;
    const done = await this.simulate(timeout, (time) => {
      t = time;
      const dx = x - p.position.x;
      const dz = z - p.position.z;
      if (Math.hypot(dx, dz) < tolerance) return false;
      const baseYaw = Math.atan2(-dx, -dz);
      p.yaw = baseYaw + (sidestep > 0 ? 1.1 : 0);
      p.keys['KeyW'] = true;
      p.keys['ShiftLeft'] = sprint;
      if (sidestep > 0) sidestep -= DT;
      if (time - lastCheck.t > 1.5) {
        if (Math.hypot(p.position.x - lastCheck.x, p.position.z - lastCheck.z) < 0.4 && !p.isSwimming) {
          stuck++;
          sidestep = 1.2;
          p.keys['Space'] = true;
        } else p.keys['Space'] = false;
        lastCheck = { x: p.position.x, z: p.position.z, t: time };
      }
    });
    p.keys = {};
    return { arrived: Math.hypot(x - p.position.x, z - p.position.z) < tolerance + 0.5, time: t || done, stuck };
  }

  // Dry, unobstructed pair of points `distance` apart, both outside the safe zone, with line of sight between them
  findOpenPair(distance, { minFromCamp = SAFE_ZONE_RADIUS + 8, los = distance < 100 } = {}) {
    const g = this.g;
    const dummy = { mesh: { position: new THREE.Vector3() }, stats: { eye: 1.0 } };
    for (let attempt = 0; attempt < 4000; attempt++) {
      const a = this.rand() * Math.PI * 2;
      const r = minFromCamp + this.rand() * 150;
      const ax = Math.cos(a) * r;
      const az = Math.sin(a) * r;
      const b = this.rand() * Math.PI * 2;
      const bx = ax + Math.cos(b) * distance;
      const bz = az + Math.sin(b) * distance;
      if (Math.hypot(bx, bz) < minFromCamp || Math.hypot(bx, bz) > 225) continue;
      const ok = (x, z) => this.terrain.isWalkable(x, z) && this.ground(x, z) > this.terrain.waterLevel + 1.2 && !g.collision.blockedAt(x, z, this.ground(x, z) + 1, 1.8);
      if (!ok(ax, az) || !ok(bx, bz)) continue;
      if (los) {
        let clear = true;
        for (let i = 1; i < 12 && clear; i++) clear = ok(ax + (bx - ax) * (i / 12), az + (bz - az) * (i / 12));
        if (!clear) continue;
        dummy.mesh.position.set(ax, this.ground(ax, az), az);
        if (!g.enemies.hasLineOfSight(dummy, new THREE.Vector3(bx, this.ground(bx, bz) + 1.6, bz))) continue;
      }
      return { a: { x: ax, z: az }, b: { x: bx, z: bz } };
    }
    return null;
  }

  buildPiece(key, x, z, rotY = 0) {
    const b = this.g.building;
    const recipe = BUILD_RECIPES[key];
    const pos = new THREE.Vector3(x, this.ground(x, z) + recipe.size[1] / 2, z);
    const piece = b.instantiateStructure(recipe, pos, rotY);
    piece.collider = b.addStructureCollider(piece);
    b.structures.push(piece);
    this.g.scene.add(piece.mesh);
    return piece;
  }

  stats(values) {
    if (!values.length) return { avg: 0, p95: 0, max: 0 };
    const s = [...values].sort((a, b) => a - b);
    return { avg: s.reduce((a, b) => a + b, 0) / s.length, p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] };
  }

  // ---------- scenario runner ----------

  async runScenario(name, fn) {
    this.violations.clear();
    const t0 = performance.now();
    const res = { name, ok: true, notes: [], warnings: [], metrics: {} };
    const note = (msg) => res.notes.push(msg);
    const warn = (msg) => res.warnings.push(msg);
    const expect = (cond, msg) => { if (!cond) { res.ok = false; res.notes.push(`FAIL: ${msg}`); } };
    try {
      await fn({ note, warn, expect, metrics: res.metrics });
    } catch (err) {
      res.ok = false;
      res.notes.push(`EXCEPTION: ${err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err}`);
    }
    for (const [id, v] of this.violations) {
      res.ok = false;
      res.notes.push(`INVARIANT ${id} ×${v.count} — first: ${v.first}`);
    }
    res.ms = Math.round(performance.now() - t0);
    this.results.push(res);
    this.renderOverlay();
    await yieldNow();
    return res;
  }

  async run(filter = null) {
    this.results = [];
    const scenarios = this.scenarios();
    for (const [name, fn] of scenarios) {
      if (filter && !name.toLowerCase().includes(filter.toLowerCase())) continue;
      await this.runScenario(name, fn);
    }
    window.__playtestReport = this.results;
    const failed = this.results.filter((r) => !r.ok).length;
    this.summary = `${this.results.length - failed}/${this.results.length} scenarios passed`;
    this.renderOverlay();
    return this.results;
  }

  // ---------- scenarios ----------

  scenarios() {
    const g = this.g;
    return [
      ['World & population sanity', async ({ note, warn, expect }) => {
        // Run on the pristine world: this is what a player actually spawns into
        const trees = g.world.trees.length;
        const nodes = { stone: 0, iron: 0, crystal: 0 };
        for (const n of g.world.mineNodes) nodes[n.kind]++;
        note(`trees=${trees} nodes=${JSON.stringify(nodes)} enemies=${g.enemies.enemies.length}`);
        expect(trees > 150, 'enough trees');
        expect(nodes.stone >= 20 && nodes.iron >= 8 && nodes.crystal >= 4, 'enough ore deposits of each kind');

        const spawn = { x: 0, z: 0 };
        const near = g.enemies.enemies.map((e) => dist2(e.mesh.position, spawn)).sort((a, b) => a - b)[0];
        note(`nearest initial enemy to spawn: ${fmt(near)} m`);
        expect(near > 55, 'no enemy close enough to rush the player at start');
        expect(g.enemies.enemies.every((e) => e.state === 'idle' || e.state === 'wander'), 'nobody starts out hunting the player');

        for (const n of g.world.mineNodes) if (Math.hypot(n.position.x, n.position.z) < 12) warn('ore node inside camp area');
        for (const t of g.world.trees) if (Math.hypot(t.position.x, t.position.z) < 12) expect(false, 'tree inside camp area');

        const camp = g.collision.blockedAt(0, 0, this.ground(0, 0) + 0.5, 0);
        note(`fire pit collider at camp centre: ${!!camp}`);

        // Everything the player needs must be reachable on foot from the starter camp
        const tower = g.world.landmarks.find((l) => l.isObjective);
        const reachable = this.terrain.isWalkable(tower.position.x, tower.position.z);
        const strandedEnemies = g.enemies.enemies.filter((e) => !this.terrain.isWalkable(e.mesh.position.x, e.mesh.position.z)).length;
        const strandedNodes = g.world.mineNodes.filter((n) => !this.terrain.isWalkable(n.position.x, n.position.z)).length;
        note(`radio tower reachable on foot: ${reachable}; enemies on unreachable ground: ${strandedEnemies}; ore deposits on unreachable ground: ${strandedNodes}`);
        expect(reachable, 'the extraction objective is reachable on foot');
        expect(strandedEnemies === 0, 'no enemy spawns on an island it cannot leave');
        expect(strandedNodes === 0, 'no ore deposit is stranded');

        let walkable = 0;
        let total = 0;
        for (let x = -230; x <= 230; x += 10) {
          for (let z = -230; z <= 230; z += 10) {
            if (this.ground(x, z) > this.terrain.waterLevel + 0.2) { total++; if (this.terrain.isWalkable(x, z)) walkable++; }
          }
        }
        note(`land cells connected to the camp: ${walkable}/${total}`);
        expect(walkable / total > 0.9, 'over 90% of the land belongs to the main landmass');
      }],

      ['Player collision', async ({ note, expect }) => {
        this.reset();
        const p = this.p;
        const walkInto = async (target, radius, label, seconds = 4) => {
          let dir = null;
          for (let k = 0; k < 24 && !dir; k++) {
            const a = (k / 24) * Math.PI * 2;
            const sx = target.x + Math.cos(a) * 6;
            const sz = target.z + Math.sin(a) * 6;
            if (this.ground(sx, sz) > this.terrain.waterLevel + 1 && !g.collision.blockedAt(sx, sz, this.ground(sx, sz) + 1, 0.5)) dir = [sx, sz];
          }
          if (!dir) { note(`${label}: no clear approach, skipped`); return; }
          this.place(dir[0], dir[1], { yaw: this.faceFrom({ x: dir[0], z: dir[1] }, target) });
          p.keys['KeyW'] = true;
          await this.simulate(seconds);
          p.keys = {};
          const d = dist2(p.position, target);
          note(`${label}: stopped ${fmt(d, 2)} m from centre (needs ≥ ${fmt(radius + 0.34, 2)})`);
          expect(d >= radius + 0.34, `${label} blocks the player`);
        };

        const tree = [...g.world.trees].sort((a, b) => Math.hypot(a.position.x, a.position.z) - Math.hypot(b.position.x, b.position.z))[10];
        await walkInto(tree.position, tree.collider.r, 'tree');
        const node = g.world.mineNodes[0];
        await walkInto(node.position, node.radius, 'ore boulder');
        await walkInto({ x: 60, z: -40 }, 5.3, 'bunker wall (short side)');

        // Built pieces
        const open = this.findOpenPair(30);
        const cx = open.a.x;
        const cz = open.a.z;
        this.buildPiece('wood_wall', cx, cz, 0);
        this.place(cx, cz + 6, { yaw: 0 });
        p.keys['KeyW'] = true;
        await this.simulate(4);
        p.keys = {};
        expect(Math.abs(p.position.z - cz) >= 0.55, 'log wall blocks the player');
        note(`wall: stopped at dz=${fmt(p.position.z - cz, 2)}`);

        const door = this.buildPiece('wood_door', cx + 6, cz, 0);
        this.place(cx + 6, cz + 6, { yaw: 0 });
        p.keys['KeyW'] = true;
        await this.simulate(3);
        const closedZ = p.position.z - cz;
        expect(closedZ > 0.3, 'closed door blocks');
        g.building.toggleDoor(door);
        this.place(cx + 6, cz + 4, { yaw: 0 });
        p.keys['KeyW'] = true;
        await this.simulate(4);
        p.keys = {};
        note(`door: closed stops at dz=${fmt(closedZ, 2)}, opened lets player reach dz=${fmt(p.position.z - cz, 2)}`);
        expect(p.position.z - cz < -0.8, 'open door lets the player through');

        this.buildPiece('sandbag', cx - 6, cz, 0);
        this.place(cx - 6, cz + 5, { yaw: 0 });
        p.keys['KeyW'] = true;
        await this.simulate(3);
        const blockedZ = p.position.z - cz;
        expect(blockedZ > 0.4, 'sandbags block a walking player');
        await this.simulate(5, () => { p.keys['Space'] = true; this.heal(); });
        p.keys = {};
        note(`sandbag: walking stops at dz=${fmt(blockedZ, 2)}, jumping gets to dz=${fmt(p.position.z - cz, 2)}`);
        expect(p.position.z - cz < -0.4, 'a jump clears a sandbag row');

        const stairs = this.buildPiece('wood_stairs', cx + 12, cz, 0);
        this.place(cx + 12, cz - 4.5, { yaw: Math.PI });
        let maxRise = 0;
        p.keys['KeyW'] = true;
        await this.simulate(4, () => { maxRise = Math.max(maxRise, p.position.y - 1.75 - this.ground(p.position.x, p.position.z)); });
        p.keys = {};
        note(`stairs: climbed ${fmt(maxRise, 2)} m above ground (steps are 2 m tall)`);
        expect(maxRise > 1.3, 'stairs are walkable');
        expect(!!stairs, 'stairs built');
      }],

      ['Enemy perception & stealth', async ({ note, expect, warn }) => {
        const react = async (distance, { crouch = false, night = false, safe = false } = {}) => {
          this.reset();
          g.weather.timeOfDay = night ? 23 : 11;
          const pair = this.findOpenPair(distance);
          if (!pair) return null;
          const e = g.enemies.spawnStalker(pair.a.x, pair.a.z);
          e.mesh.rotation.y = Math.atan2(pair.b.x - pair.a.x, pair.b.z - pair.a.z);
          e.home.set(pair.a.x, 0, pair.a.z);
          e.wanderWait = 999;
          this.place(pair.b.x, pair.b.z, { yaw: this.faceFrom(pair.b, pair.a) });
          this.p.keys['KeyC'] = crouch;
          let alertAt = null;
          const t = await this.simulate(25, (time) => {
            if (e.state === 'alert' && alertAt === null) alertAt = time;
            if (e.state === 'chase') return false;
          });
          this.p.keys = {};
          return { chased: e.state === 'chase', alertAt, t };
        };
        const r15 = await react(15);
        const r28 = await react(28);
        const r45 = await react(45);
        const r28c = await react(28, { crouch: true });
        const r28n = await react(28, { night: true });
        const fmtR = (r) => (r ? (r.chased ? `chase after ${fmt(r.t)}s (alert at ${r.alertAt === null ? 'n/a' : fmt(r.alertAt)}s)` : 'never noticed') : 'no test site');
        note(`stalker standing in the open — 15 m: ${fmtR(r15)}; 28 m: ${fmtR(r28)}; 45 m: ${fmtR(r45)}`);
        note(`28 m crouching: ${fmtR(r28c)}; 28 m at night: ${fmtR(r28n)}`);
        if (r15) expect(r15.chased, 'a stalker 15 m away and facing the player notices them');
        if (r15 && r15.t < 0.8) warn(`aggro at 15 m takes only ${fmt(r15.t)} s — little room to react`);
        if (r45) expect(!r45.chased, 'a stalker 45 m away does not notice a standing player');
        if (r28 && r28c) expect(!(r28c.chased && !r28.chased), 'crouching never makes detection easier');
        if (r28c) note(`crouching vs standing at 28 m: ${r28c.chased ? 'still spotted' : 'unseen'} / ${r28 && r28.chased ? 'spotted' : 'unseen'}`);

        // Safe zone: enemies ignore the player inside the meadow
        this.reset();
        const e = g.enemies.spawnStalker(33, 0);
        e.mesh.rotation.y = -Math.PI / 2;
        e.home.set(33, 0, 0);
        this.place(0, 0, { yaw: -Math.PI / 2 });
        const tStab = await this.simulate(20);
        note(`stalker 33 m from the camp centre, in plain sight, after 20 s: state=${e.state}`);
        expect(e.state !== 'chase', 'enemies do not hunt a player who stays in the safe zone');
        expect(Math.hypot(e.mesh.position.x, e.mesh.position.z) > SAFE_ZONE_RADIUS - 1, 'enemies do not walk into the safe zone');
        expect(tStab > 0, 'sim ran');
      }],

      ['Noise & hearing', async ({ note, expect }) => {
        const trial = async (distance, radiusLabel, action) => {
          this.reset();
          const pair = this.findOpenPair(distance, { los: false });
          if (!pair) return null;
          const e = g.enemies.spawnStalker(pair.a.x, pair.a.z);
          e.home.set(pair.a.x, 0, pair.a.z);
          e.wanderWait = 999;
          e.mesh.rotation.y = Math.atan2(pair.a.x - pair.b.x, pair.a.z - pair.b.z); // facing away: sight can't help
          this.place(pair.b.x, pair.b.z, { yaw: 0 });
          action();
          await this.simulate(1.5);
          const reacted = e.awareness >= 0.35 || ['alert', 'chase', 'search'].includes(e.state);
          return { reacted, state: e.state, aw: e.awareness };
        };
        const shot = await trial(55, 'rifle', () => { this.p.fireTimer = 0; this.p.onPrimaryAction(); });
        const farShot = await trial(140, 'rifle far', () => { this.p.fireTimer = 0; this.p.onPrimaryAction(); });
        this.reset();
        const quiet = await trial(55, 'walking', () => {});
        note(`rifle shot at ~55 m: ${shot ? `${shot.state} (awareness ${fmt(shot.aw, 2)})` : 'no site'}; ~140 m: ${farShot ? farShot.state : 'no site'}; no noise: ${quiet ? quiet.state : 'no site'}`);
        if (shot) expect(shot.reacted, 'a rifle shot 55 m away alerts a stalker');
        if (farShot) expect(!['chase'].includes(farShot.state), 'a shot 140 m away does not instantly start a chase');
        if (quiet) expect(!quiet.reacted, 'enemies do not react to silence');
      }],

      ['Combat fairness', async ({ note, expect, warn, metrics }) => {
        // Time to first damage and time-to-kill for packs of stalkers that have already noticed the player
        const fight = async (count, distance = 18) => {
          this.reset();
          const pair = this.findOpenPair(distance);
          const first = { t: null };
          for (let i = 0; i < count; i++) {
            const e = g.enemies.spawnStalker(pair.a.x + i * 1.5, pair.a.z + i);
            e.awareness = 1.3;
            e.lastKnown.set(pair.b.x, 0, pair.b.z);
            g.enemies.setState(e, 'chase');
          }
          this.place(pair.b.x, pair.b.z, { yaw: this.faceFrom(pair.b, pair.a) });
          const hp0 = g.survival.currentHp;
          let died = null;
          await this.simulate(40, (t) => {
            if (first.t === null && g.survival.currentHp < hp0) first.t = t;
            if (g.survival.isDead && died === null) { died = t; return false; }
          });
          return { firstHit: first.t, ttk: died, hpLeft: g.survival.currentHp, hp0 };
        };
        const one = await fight(1);
        const three = await fight(3);
        metrics.stalker1 = one; metrics.stalker3 = three;
        note(`1 stalker running at a passive player from 18 m: first bite after ${fmt(one.firstHit)} s, player ${one.ttk ? `dead after ${fmt(one.ttk)} s` : `survives (${fmt(one.hpLeft, 0)}/${fmt(one.hp0, 0)} HP) in 40 s`}`);
        note(`3 stalkers: first bite after ${fmt(three.firstHit)} s, ${three.ttk ? `dead after ${fmt(three.ttk)} s` : `survives (${fmt(three.hpLeft, 0)}/${fmt(three.hp0, 0)} HP)`}`);
        expect(one.firstHit === null || one.firstHit > 1.5, 'player gets at least 1.5 s before the first bite from 18 m');
        if (three.ttk && three.ttk < 8) warn(`3 stalkers kill an unresponsive player in ${fmt(three.ttk)} s — harsh without a way to fight back`);

        // Telegraph: windup before damage lands
        this.reset();
        const duel = this.findOpenPair(20);
        this.place(duel.b.x, duel.b.z, { yaw: 0 });
        const e = g.enemies.spawnStalker(duel.b.x + 2.0, duel.b.z);
        e.awareness = 1.3;
        e.lastKnown.copy(this.p.position);
        g.enemies.setState(e, 'chase');
        let windupSeen = false;
        const hp = g.survival.currentHp;
        let hitAt = null;
        let windupAt = null;
        await this.simulate(4, (t) => {
          if (e.windup > 0 && windupAt === null) { windupSeen = true; windupAt = t; }
          if (g.survival.currentHp < hp && hitAt === null) { hitAt = t; return false; }
        });
        note(`stalker attack windup ${windupSeen ? 'seen' : 'missing'}; windup→damage delay ${hitAt !== null && windupAt !== null ? fmt(hitAt - windupAt, 2) : 'n/a'} s`);
        expect(windupSeen, 'melee attacks have a visible windup');

        // Trooper: damage rate against a standing player at 24 m
        this.reset();
        const pair = this.findOpenPair(24);
        const tr = g.enemies.spawnTrooper(pair.a.x, pair.a.z);
        tr.awareness = 1.3;
        tr.lastKnown.set(pair.b.x, 0, pair.b.z);
        g.enemies.setState(tr, 'chase');
        this.place(pair.b.x, pair.b.z, { yaw: this.faceFrom(pair.b, pair.a) });
        const hp1 = g.survival.currentHp;
        await this.simulate(30, () => { g.survival.currentHp = Math.max(g.survival.currentHp, 1); });
        note(`trooper vs standing player at ~24 m over 30 s: state=${tr.state}`);
        expect(['chase', 'alert', 'search'].includes(tr.state), 'trooper stays engaged');
        expect(hp1 > 0, 'player alive');
      }],

      ['Enemy pathing', async ({ note, expect, warn }) => {
        // A wall line between hunter and prey: it must go around or break through, not stand still forever
        this.reset();
        // The detour around the wall line must itself be dry, connected ground
        let pair = null;
        let mid = null;
        let ang = 0;
        for (let tries = 0; tries < 20 && !pair; tries++) {
          const cand = this.findOpenPair(34);
          const m = { x: (cand.a.x + cand.b.x) / 2, z: (cand.a.z + cand.b.z) / 2 };
          const an = Math.atan2(cand.b.x - cand.a.x, cand.b.z - cand.a.z);
          const lateralOk = [-22, -14, 14, 22].every((k) => {
            const x = m.x + Math.cos(an) * k;
            const z = m.z - Math.sin(an) * k;
            return this.terrain.isWalkable(x, z) && this.ground(x, z) > this.terrain.waterLevel + 0.8;
          });
          if (lateralOk) { pair = cand; mid = m; ang = an; }
        }
        const walls = [];
        for (let k = -5; k <= 5; k++) {
          walls.push(this.buildPiece('wood_wall', mid.x + Math.cos(ang) * k * 3, mid.z - Math.sin(ang) * k * 3, ang));
        }
        const e = g.enemies.spawnStalker(pair.a.x, pair.a.z);
        e.awareness = 1.3;
        e.lastKnown.set(pair.b.x, 0, pair.b.z);
        g.enemies.setState(e, 'chase');
        this.place(pair.b.x, pair.b.z, { yaw: this.faceFrom(pair.b, pair.a) });
        let arrived = null;
        await this.simulate(60, (t) => {
          this.heal();
          if (dist2(e.mesh.position, this.p.position) < 3 && arrived === null) { arrived = t; return false; }
        });
        const damaged = walls.filter((w) => w.hp < w.maxHp || !g.building.structures.includes(w)).length;
        note(`stalker vs 33 m wall: ${arrived === null ? 'did NOT get through' : `arrived after ${fmt(arrived)} s`}; walls damaged/destroyed: ${damaged}`);
        if (arrived === null) {
          const ep = e.mesh.position;
          const u = (ep.x - mid.x) * Math.cos(ang) - (ep.z - mid.z) * Math.sin(ang);
          const v = (ep.x - mid.x) * Math.sin(ang) + (ep.z - mid.z) * Math.cos(ang);
          const rises = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([ox, oz]) => fmt(this.ground(ep.x + ox * 1.5, ep.z + oz * 1.5) - ep.y, 2)).join(',');
          note(`stuck at wall-local (${fmt(u)}, ${fmt(v)}) state=${e.state} slide=${e.slideDir}/${fmt(e.slideFail, 2)} steer=${fmt(e.steerTimer)}/${e.steerSign} slopes(±x,±z)=${rises} height over water ${fmt(this.ground(ep.x, ep.z) - this.terrain.waterLevel)} walkable=${this.terrain.isWalkable(ep.x, ep.z)}`);
        }
        expect(arrived !== null, 'stalker gets around or through a wall line');

        // Forest chase: arrival time vs ideal
        this.reset();
        const open = this.findOpenPair(70, { minFromCamp: 60 });
        const f = g.enemies.spawnStalker(open.a.x, open.a.z);
        f.awareness = 1.3;
        f.lastKnown.set(open.b.x, 0, open.b.z);
        g.enemies.setState(f, 'chase');
        this.place(open.b.x, open.b.z, { yaw: 0 });
        let reach = null;
        await this.simulate(40, (t) => { this.heal(); if (dist2(f.mesh.position, this.p.position) < 3 && reach === null) { reach = t; return false; } });
        const ideal = 70 / f.stats.run;
        note(`70 m chase: arrived ${reach === null ? 'never' : fmt(reach) + ' s'} (straight-line ideal ${fmt(ideal)} s)`);
        expect(reach !== null, 'stalker closes a 70 m gap within 40 s');
        if (reach && reach > ideal * 2.2) warn('pathing detours more than 2x the straight line');
      }],

      ['Water avoidance & swimming', async ({ note, expect }) => {
        this.reset();
        // Wave sampler sanity
        let min = 1e9, max = -1e9, bad = 0, shoreMax = 0, shoreN = 0;
        for (let i = 0; i < 4000; i++) {
          const x = (this.rand() - 0.5) * 480;
          const z = (this.rand() - 0.5) * 480;
          const h = this.terrain.getWaterHeightAt(x, z);
          if (!Number.isFinite(h)) bad++;
          min = Math.min(min, h); max = Math.max(max, h);
          const depth = this.terrain.waterLevel - this.ground(x, z);
          if (depth > 0 && depth < 0.3) { shoreMax = Math.max(shoreMax, Math.abs(h - this.terrain.waterLevel)); shoreN++; }
        }
        note(`wave heights span ${fmt(min, 2)}…${fmt(max, 2)} (level ${this.terrain.waterLevel}); shoreline waves max ${fmt(shoreMax, 2)} m over ${shoreN} samples`);
        expect(bad === 0, 'wave heights are finite everywhere');
        expect(max - min > 0.8, 'waves have real amplitude');
        expect(shoreMax < 0.3, 'waves are damped in the shallows');

        // Swim in the deepest lake spot
        const p = this.p;
        let lake = null;
        for (let x = -220; x <= 220; x += 6) {
          for (let z = -220; z <= 220; z += 6) {
            const depth = this.terrain.waterLevel - this.ground(x, z);
            if (depth < 3 || Math.hypot(x, z) > 200) continue;
            let ring = 99;
            for (let k = 0; k < 8; k++) ring = Math.min(ring, this.terrain.waterLevel - this.ground(x + Math.cos(k) * 8, z + Math.sin(k * 1.3) * 8));
            if (ring > 1.5 && (!lake || depth > lake.depth)) lake = { x, z, depth };
          }
        }
        note(`deepest lake spot: ${lake ? `${fmt(lake.x, 0)},${fmt(lake.z, 0)} depth ${fmt(lake.depth, 1)} m` : 'none found'}`);
        expect(!!lake, 'the map has a lake deep enough to swim in');
        if (!lake) return;
        p.position.set(lake.x, this.terrain.waterLevel + 2.5, lake.z);
        p.yaw = 0;
        p.keys['KeyW'] = true;
        let swam = false;
        await this.simulate(6, () => { if (p.isSwimming) swam = true; this.heal(); });
        const wy = this.terrain.getWaterHeightAt(p.position.x, p.position.z);
        note(`swimming: ${swam}, eye height above surface ${fmt(p.position.y - wy, 2)} m`);
        expect(swam, 'player swims in the lake');
        expect(Math.abs(p.position.y - wy) < 1.2, 'swimmer rides the wave surface');
        p.keys['KeyC'] = true;
        await this.simulate(4, () => this.heal());
        note(`diving: underwater=${p.isUnderwater}`);
        expect(p.isUnderwater, 'player can dive');
        p.keys = {};

        // Enemy hunting across the lake must not wade in
        this.reset();
        const shoreSpot = this.findOpenPair(30, { los: false }).a;
        const e = g.enemies.spawnStalker(shoreSpot.x, shoreSpot.z);
        e.awareness = 1.3;
        e.raider = true;
        e.lastKnown.set(lake.x, 0, lake.z);
        g.enemies.setState(e, 'chase');
        await this.simulate(25, () => this.heal());
        note(`stalker told to hunt a target in the middle of the lake ended at ${fmt(e.mesh.position.x, 0)},${fmt(e.mesh.position.z, 0)} (${e.state}); invariants watch for wading`);
      }],

      ['Mining & resources', async ({ note, expect, warn }) => {
        this.reset();
        const p = this.p;
        p.switchWeapon(5);
        for (const kind of ['stone', 'iron', 'crystal']) {
          const node = g.world.mineNodes.find((n) => n.kind === kind && n.mesh.visible);
          if (!node) { expect(false, `a ${kind} deposit exists`); continue; }
          const item = node.def.item;
          const before = g.inventory.getItemCount(item);
          const standAt = { x: node.position.x + node.radius + 1.6, z: node.position.z };
          this.place(standAt.x, standAt.z);
          this.aimAt(node.position.x, node.position.y + node.baseScale * 0.6, node.position.z);
          let swings = 0;
          let promptShown = false;
          const stam0 = g.survival.currentStamina;
          await this.simulate(12, () => {
            this.aimAt(node.position.x, node.position.y + node.baseScale * 0.6, node.position.z);
            if (p.domInteractPrompt && p.domInteractPrompt.style.display === 'flex' && /Mine/.test(p.domInteractText.textContent)) promptShown = true;
            if (p.fireTimer <= 0 && node.mesh.visible) { p.onPrimaryAction(); swings++; }
            this.g.survival.currentStamina = Math.max(this.g.survival.currentStamina, 20);
            if (!node.mesh.visible) return false;
          });
          const gained = g.inventory.getItemCount(item) - before;
          note(`${kind}: broke in ${swings} swings, +${gained} ${item}${promptShown ? ', prompt shown' : ', NO prompt'}`);
          expect(!node.mesh.visible, `${kind} deposit breaks`);
          expect(gained >= node.def.bonus + 2, `${kind} yields items`);
          expect(promptShown, `${kind} shows a mining prompt`);
          expect(swings <= 8, `${kind} takes a sane number of swings`);
          if (stam0 - 8 * swings < 0) warn(`${kind}: stamina would run dry mid-node (${swings} swings × 8)`);
          // Respawn
          await this.simulate(245);
          expect(node.mesh.visible && !!node.collider, `${kind} deposit respawns after ~4 min`);
        }

        // Bullets and the hatchet must not crash on rock, and axe gives guidance
        const node = g.world.mineNodes[0];
        this.place(node.position.x + node.radius + 4, node.position.z);
        this.aimAt(node.position.x, node.position.y + 1, node.position.z);
        p.switchWeapon(0);
        p.fireTimer = 0;
        p.onPrimaryAction();
        p.switchWeapon(4);
        p.fireTimer = 0;
        this.place(node.position.x + node.radius + 1.6, node.position.z);
        this.aimAt(node.position.x, node.position.y + 1, node.position.z);
        p.onPrimaryAction();
        await this.simulate(1);
        note('rifle and hatchet strikes on ore are handled without errors');
      }],

      ['Economy & ammo', async ({ note, expect, warn }) => {
        this.reset();
        const p = this.p;
        const inv = g.inventory;
        const rifle = p.weapons[0];
        const reserve0 = p.reserveRounds(rifle);
        note(`starting rifle reserve: ${reserve0} rounds`);
        expect(reserve0 >= 60, 'starting ammunition for the rifle');
        expect(p.reserveRounds(p.weapons[1]) > 0 && p.reserveRounds(p.weapons[2]) > 0, 'shotgun and sniper have ammo');

        // Fire 10 rounds, reload, check the reserve drops by exactly what was refilled
        for (let i = 0; i < 10; i++) { p.fireTimer = 0; p.onPrimaryAction(); this.step(); }
        const clipAfter = rifle.clip;
        const reserveBefore = p.reserveRounds(rifle);
        p.reload();
        await this.simulate(2);
        const refilled = rifle.clip - clipAfter;
        const spent = reserveBefore - p.reserveRounds(rifle);
        note(`reload refilled ${refilled}, reserve dropped by ${spent}`);
        expect(refilled === 10 && spent === 10, 'reloading consumes reserve ammunition (no free infinite ammo)');

        // Out of ammo behaviour
        inv.consumeItem('ammo_sniper', inv.getItemCount('ammo_sniper'));
        p.weapons[2].looseRounds = 0;
        p.weapons[2].clip = 0;
        p.switchWeapon(2);
        p.reload();
        expect(!p.isReloading, 'cannot reload without ammunition');

        // Can the player build the basics straight away?
        const afford = (k) => g.building.canAfford(BUILD_RECIPES[k]);
        note(`starting kit affords: campfire=${afford('campfire')} wall=${afford('wood_wall')} sandbag=${afford('sandbag')} door=${afford('wood_door')} workbench=${afford('workbench')}`);
        expect(afford('campfire') && afford('wood_wall'), 'campfire and log wall affordable at start');
        if (!afford('sandbag')) warn('sandbags (8 stone, 2 scrap) not affordable at start — pushes players to the pickaxe early (intended)');

        // Extraction material budget
        const comps = inv.getItemCount('component');
        const scrap = inv.getItemCount('scrap');
        note(`extraction alternative needs 8 components + 8 scrap; start has ${comps} + ${scrap} (crystals give ${g.world.mineNodes.filter((n) => n.kind === 'crystal').length} clusters × ~8)`);
        expect(g.world.mineNodes.filter((n) => n.kind === 'crystal').length * 8 + comps >= 8, 'enough crystal in the world for the extraction recipe');
      }],

      ['Build tool', async ({ note, expect }) => {
        this.reset();
        const p = this.p;
        ['wood', 'stone', 'scrap', 'cloth'].forEach((i) => g.inventory.addItem(i, 200));
        p.switchWeapon(3);
        this.place(0, 18, { yaw: 0, pitch: -0.5 });
        let placed = 0;
        for (const key of Object.keys(BUILD_RECIPES)) {
          g.building.selectPiece(key);
          this.place(-10 + placed * 3.5, 25, { yaw: 0, pitch: -0.55 });
          this.step(2);
          p.fireTimer = 0;
          if (g.building.placePiece()) placed++;
          this.step(2);
        }
        note(`placed ${placed}/${Object.keys(BUILD_RECIPES).length} pieces; colliders registered for ${g.building.structures.filter((s) => s.collider).length}`);
        expect(placed === Object.keys(BUILD_RECIPES).length, 'every blueprint can be placed');
        const campfire = g.building.structures.find((s) => s.type === 'campfire');
        expect(!!campfire?.mesh.userData.fireLight, 'campfire has a light');

        // Dismantle everything: colliders must go too
        const colliders = g.building.structures.map((s) => s.collider).filter(Boolean);
        for (const s of [...g.building.structures]) g.building.damageStructure(s, 99999);
        const stuck = colliders.filter((c) => c.cells).length;
        note(`after destroying all pieces ${stuck} colliders remained`);
        expect(stuck === 0, 'destroyed structures release their colliders');
        p.switchWeapon(0);
      }],

      ['Raid flow & survivability', async ({ note, expect, warn, metrics }) => {
        this.reset();
        const p = this.p;
        g.enemies.timeUntilNextRaid = 30;
        g.enemies.raidCount = 0;
        const warnedAt = { t: null };
        const raidAt = { t: null };
        await this.simulate(40, (t) => {
          if (g.enemies.raidWarned && warnedAt.t === null) warnedAt.t = t;
          if (g.enemies.raidActive && raidAt.t === null) { raidAt.t = t; return false; }
        });
        note(`raid warning at ${fmt(warnedAt.t)} s, raid arrives at ${fmt(raidAt.t)} s`);
        expect(warnedAt.t !== null && raidAt.t !== null && raidAt.t - warnedAt.t > 15, 'player gets 15+ s of warning');
        const raiders = g.enemies.enemies.filter((e) => e.raider);
        const types = raiders.reduce((m, e) => ({ ...m, [e.type]: (m[e.type] || 0) + 1 }), {});
        note(`raid composition: ${JSON.stringify(types)}; nearest ${fmt(Math.min(...raiders.map((e) => dist2(e.mesh.position, p.position))))} m`);
        expect(raiders.length >= 4, 'a raid has substance');
        expect(types.behemoth === 1, 'raid brings the boss');
        expect(raiders.every((e) => dist2(e.mesh.position, p.position) > 50), 'raiders spawn far enough away not to feel like a spawn-camp');

        // A sensible bot: shotgun up close, rifle at range, only fires with a clear sightline, reloads when dry
        const losFrom = (target) => g.enemies.hasLineOfSight(
          { mesh: { position: new THREE.Vector3(p.position.x, p.position.y - 1.7, p.position.z) }, stats: { eye: 1.7 } },
          new THREE.Vector3(target.mesh.position.x, target.mesh.position.y + 1.0, target.mesh.position.z)
        );
        let shots = 0;
        let hpMin = g.survival.currentHp;
        const t0 = g.survival.currentHp;
        let killsBefore = g.enemies.enemies.length;
        const dur = await this.simulate(150, () => {
          hpMin = Math.min(hpMin, g.survival.currentHp);
          if (g.survival.isDead) return false;
          const target = [...g.enemies.enemies].filter((e) => e.state === 'chase').sort((a, b) => dist2(a.mesh.position, p.position) - dist2(b.mesh.position, p.position))[0];
          if (!target) return;
          const d = dist2(target.mesh.position, p.position);
          const slot = d < 13 && target.type !== 'behemoth' ? 1 : 0;
          if (p.currentSlot !== slot && !p.isReloading) p.switchWeapon(slot);
          const weapon = p.weapons[p.currentSlot];
          if (d > 70) return;
          const aimY = target.mesh.position.y + (target.type === 'behemoth' ? 3.2 : 1.0);
          this.aimAt(target.mesh.position.x, aimY, target.mesh.position.z);
          if (weapon.clip <= 0 && !p.isReloading) p.reload();
          if (p.fireTimer <= 0 && !p.isReloading && weapon.clip > 0 && losFrom(target)) { p.onPrimaryAction(); shots++; }
        });
        killsBefore -= g.enemies.enemies.length;
        void killsBefore;
        const left = g.enemies.enemies.filter((e) => e.raider).length;
        metrics.raid = { shots, hpMin, raidersLeft: left, dead: g.survival.isDead };
        note(`shooting bot (rifle + shotgun, no cover, no grenades) over ${fmt(dur, 0)} s: ${shots} shots, HP ${fmt(t0, 0)}→min ${fmt(hpMin, 0)}, raiders left ${left}, ${g.survival.isDead ? 'PLAYER DIED' : 'player alive'}`);
        if (g.survival.isDead) warn('a naive standing defence dies to the first raid — consider tuning or confirm intended difficulty');
        if (left > 0 && !g.survival.isDead) warn(`${left} raiders still alive after 150 s of shooting`);
      }],

      ['Extraction flow', async ({ note, expect }) => {
        this.reset();
        const w = g.world;
        const tower = w.landmarks.find((l) => l.isObjective);
        g.inventory.addItem('behemoth_core', 1);
        this.place(tower.position.x + 4, tower.position.z + 4);
        const before = g.won;
        w.activateExtraction(g.inventory);
        expect(w.extractionActive, 'extraction starts with the core');
        await this.simulate(3);
        note(`3 s after calling the VTOL: ready=${w.extractionReady} heli y=${fmt(w.rescueHelicopter.position.y)}; raid triggered=${g.enemies.raidActive}`);
        expect(!w.extractionReady && !g.won, 'standing at the tower does not win instantly');
        expect(g.enemies.raidActive, 'calling the VTOL triggers a defence wave');
        for (const e of [...g.enemies.enemies]) { g.scene.remove(e.mesh); }
        g.enemies.enemies.length = 0;
        await this.simulate(80, () => { this.heal(); this.place(tower.position.x + 4, tower.position.z + 4); });
        note(`after 80 s: ready=${w.extractionReady} heli y=${fmt(w.rescueHelicopter.position.y)} (hover ${fmt(w.heliHoverY)}) won=${g.won}`);
        expect(w.extractionReady, 'VTOL lands after its countdown');
        expect(g.won && !before, 'boarding the landed VTOL completes the mission');
      }],

      ['Audio smoke test', async ({ note, expect }) => {
        if (!(window.AudioContext || window.webkitAudioContext)) { note('no Web Audio in this browser, skipped'); return; }
        sounds.init();
        await sleep(50);
        const pos = { x: 20, y: 3, z: 10 };
        const calls = [
          ['playRifleShot'], ['playRifleShot', pos, true], ['playShotgunShot'], ['playSniperShot'], ['playExplosion', pos, 1],
          ['playThunder', 0.2], ['playImpact', 'flesh', pos], ['playImpact', 'wood'], ['playImpact', 'rock', pos], ['playImpact', 'metal'],
          ['playImpact', 'water'], ['playImpact', 'dirt'], ['playSwing'], ['playAxeChop', pos], ['playMineHit', 'stone', pos], ['playMineHit', 'iron'],
          ['playMineHit', 'crystal'], ['playMineBreak', 'crystal', pos], ['playTreeFall', pos], ['playBuildSnap'], ['playDismantle'], ['playPickup'],
          ['playHarvest'], ['playDoorSound', true], ['playDoorSound', false], ['playMechanicalClick', 1.2], ['playHitMarker', true], ['playHitMarker', false],
          ['playPlayerHurt', 25], ['playSplash', 0.8, pos], ['playSwimStroke'], ['playFootstep', 'grass', 1], ['playFootstep', 'sand', 0.4],
          ['playFootstep', 'wood', 1.2], ['playFootstep', 'rock', 1], ['playFootstep', 'snow', 1], ['playFootstep', 'water', 1], ['playFootstep', 'dirt', 1],
          ['playSizzle'], ['playEatSound'], ['playRestedChime'], ['playMonsterGrowl', false, pos], ['playMonsterGrowl', true, pos],
          ['playAlert', pos], ['playRaidAlarm'], ['playBulletWhizz', pos], ['playDryFire'], ['playPinPull'], ['playReload', 'rifle'], ['playReload', 'shotgun'],
          ['playReload', 'sniper'], ['playBird'], ['playOwl']
        ];
        let failures = 0;
        for (const [name, ...args] of calls) {
          try {
            if (typeof sounds[name] !== 'function') throw new Error('missing method');
            sounds[name](...args);
          } catch (err) {
            failures++;
            note(`${name} threw: ${err.message}`);
          }
        }
        for (const env of [
          { isNight: false, rain: 0, altitude: 0, shore: 0, hpFrac: 1, fire: null },
          { isNight: true, rain: 1, altitude: 1, shore: 1, hpFrac: 0.1, fire: { pos, dist: 5 } }
        ]) {
          try { for (let i = 0; i < 30; i++) sounds.update(0.1, env); } catch (err) { failures++; note(`update threw: ${err.message}`); }
        }
        sounds.setListener(0, 2, 0, 0, 0, -1);
        sounds.setUnderwater(true); sounds.setUnderwater(false);
        note(`${calls.length} sound calls + ambience updates: ${failures} failures; context state=${sounds.ctx.state}`);
        expect(failures === 0, 'every sound method runs without throwing');
      }],

      ['Leaks & performance budget', async ({ note, expect, warn, metrics }) => {
        this.reset();
        const info = g.renderer.info;
        const g0 = info.memory.geometries;
        const t0 = info.memory.textures;
        const children0 = g.scene.children.length;
        for (let i = 0; i < 25; i++) {
          const e = g.enemies.spawnStalker(40 + i, 30);
          g.enemies.damageEnemy(e, 9999);
        }
        for (let i = 0; i < 3; i++) { const e = g.enemies.spawnTrooper(50 + i, 30); g.enemies.damageEnemy(e, 9999); }
        await this.simulate(6);
        for (const pk of g.world.pickups) g.scene.remove(pk.mesh);
        g.world.pickups.length = 0;
        this.step();
        const dg = info.memory.geometries - g0;
        const dt = info.memory.textures - t0;
        const dc = g.scene.children.length - children0;
        note(`after spawning and killing 28 enemies: geometries ${dg >= 0 ? '+' : ''}${dg}, textures ${dt >= 0 ? '+' : ''}${dt}, scene children ${dc >= 0 ? '+' : ''}${dc} (geometry counts only drop once rendered)`);
        expect(dc <= 4, 'dead enemies leave the scene graph');

        // Tick cost under a full raid
        this.reset();
        g.enemies.timeUntilNextRaid = 0;
        this.tickMs.length = 0;
        await this.simulate(20, () => this.heal());
        const s = this.stats(this.tickMs);
        metrics.tick = s;
        note(`simulation tick during a raid: avg ${fmt(s.avg, 2)} ms, p95 ${fmt(s.p95, 2)} ms, max ${fmt(s.max, 2)} ms (budget at 60 fps is ~16 ms incl. rendering)`);
        expect(s.p95 < 14, 'tick p95 under 14 ms');
        if (s.avg > 6) warn('simulation alone uses over a third of a 60 fps frame');
      }],

      ['Soak: random walk with enemies', async ({ note, expect, warn, metrics }) => {
        // Pristine population, player wanders for a few minutes; collisions, AI and pacing are watched throughout
        const fresh = this.g.enemies;
        this.reset();
        fresh.timeUntilNextRaid = 99999;
        fresh.wildlifeTimer = 40;
        fresh.spawnInitialPopulation();
        const p = this.p;
        this.place(0, 6);
        this.tickMs.length = 0;
        let heading = 0;
        let headingTimer = 0;
        let stuckEvents = 0;
        let checkpoint = { x: p.position.x, z: p.position.z, t: 0 };
        const first = { alert: null, chase: null, damage: null };
        let hpTaken = 0;
        let lastHp = g.survival.currentHp;
        const seconds = 240;
        await this.simulate(seconds, (t) => {
          headingTimer -= DT;
          const r = Math.hypot(p.position.x, p.position.z);
          if (headingTimer <= 0) {
            headingTimer = 3 + this.rand() * 5;
            heading = r > 170 ? Math.atan2(p.position.x, p.position.z) : heading + (this.rand() - 0.5) * 2.2;
          }
          p.yaw = heading;
          p.keys['KeyW'] = true;
          p.keys['ShiftLeft'] = this.rand() < 0.002 ? !p.keys['ShiftLeft'] : p.keys['ShiftLeft'];
          p.keys['Space'] = this.rand() < 0.01;
          if (t - checkpoint.t > 3) {
            if (Math.hypot(p.position.x - checkpoint.x, p.position.z - checkpoint.z) < 0.6 && !p.isSwimming) {
              stuckEvents++;
              heading += Math.PI * (0.6 + this.rand() * 0.8);
              headingTimer = 4;
            }
            checkpoint = { x: p.position.x, z: p.position.z, t };
          }
          for (const e of g.enemies.enemies) {
            if (first.alert === null && (e.state === 'alert' || e.state === 'search')) first.alert = t;
            if (first.chase === null && e.state === 'chase') first.chase = t;
          }
          if (g.survival.currentHp < lastHp) { hpTaken += lastHp - g.survival.currentHp; if (first.damage === null) first.damage = t; }
          lastHp = g.survival.currentHp;
          if (lastHp < g.survival.getMaxHp() * 0.5) { this.heal(); lastHp = g.survival.currentHp; }
        });
        p.keys = {};
        const s = this.stats(this.tickMs);
        const states = g.enemies.enemies.reduce((m, e) => ({ ...m, [e.state]: (m[e.state] || 0) + 1 }), {});
        metrics.soak = { stuckEvents, first, hpTaken, states, tick: s };
        note(`${seconds} s random walk covering to ${fmt(Math.hypot(p.position.x, p.position.z), 0)} m from camp: stuck events ${stuckEvents}, enemy states ${JSON.stringify(states)}`);
        note(`pacing — first enemy noticed at ${first.alert === null ? 'never' : fmt(first.alert, 0) + ' s'}, first chase ${first.chase === null ? 'never' : fmt(first.chase, 0) + ' s'}, first damage ${first.damage === null ? 'never' : fmt(first.damage, 0) + ' s'}; damage taken ${fmt(hpTaken, 0)}`);
        note(`tick avg ${fmt(s.avg, 2)} ms, p95 ${fmt(s.p95, 2)} ms`);
        expect(stuckEvents <= 4, `player rarely gets stuck on scenery (${stuckEvents} events)`);
        if (first.damage !== null && first.damage < 30) warn(`first damage after only ${fmt(first.damage, 0)} s — early game may be too hostile`);
        if (first.alert === null) warn('a 4-minute walk never alerted an enemy — world may feel empty');
      }]
    ];
  }

  // ---------- overlay ----------

  mountOverlay() {
    const el = document.createElement('div');
    el.id = 'playtest-overlay';
    el.style.cssText = 'position:fixed;top:8px;left:8px;width:560px;max-height:92vh;overflow:auto;z-index:99999;background:rgba(6,10,16,.94);color:#cbd5e1;font:12px/1.45 ui-monospace,Consolas,monospace;border:1px solid #38bdf8;border-radius:6px;padding:10px;pointer-events:auto;user-select:text';
    el.innerHTML = '<b style="color:#38bdf8">ZONE ZERO PLAYTEST</b> <button id="pt-run" style="margin-left:8px">Run all</button> <button id="pt-copy">Copy JSON</button> <button id="pt-hide">Hide</button><div id="pt-body" style="margin-top:6px">Ready. Run all to simulate the game headlessly.</div>';
    document.body.appendChild(el);
    this.overlay = el;
    el.querySelector('#pt-run').onclick = () => this.run();
    el.querySelector('#pt-copy').onclick = () => navigator.clipboard?.writeText(JSON.stringify(this.results, null, 2));
    el.querySelector('#pt-hide').onclick = () => { el.style.display = 'none'; };
  }

  renderOverlay() {
    if (!this.overlay) return;
    const body = this.overlay.querySelector('#pt-body');
    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    body.innerHTML = (this.summary ? `<div style="color:#fde047">${this.summary}</div>` : '') + this.results.map((r) => `
      <div style="margin-top:6px;border-left:3px solid ${r.ok ? '#4ade80' : '#f87171'};padding-left:6px">
        <b style="color:${r.ok ? '#4ade80' : '#f87171'}">${r.ok ? 'PASS' : 'FAIL'}</b> ${esc(r.name)} <span style="color:#64748b">(${r.ms} ms)</span>
        ${r.notes.map((n) => `<div style="color:${n.startsWith('FAIL') || n.startsWith('INVARIANT') || n.startsWith('EXCEPTION') ? '#fca5a5' : '#94a3b8'}">${esc(n)}</div>`).join('')}
        ${r.warnings.map((n) => `<div style="color:#fde047">⚠ ${esc(n)}</div>`).join('')}
      </div>`).join('');
  }
}
