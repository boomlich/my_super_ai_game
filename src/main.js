// ZONE ZERO: Outpost Valheim - Modern 3D Tactical Survival Shooter
// Main Game Engine Loop, Tactical Minimap & Orchestration

import * as THREE from 'three';
import { sounds } from './audio.js';
import { Terrain } from './terrain.js';
import { WeatherSystem } from './weather.js';
import { ParticleManager } from './particles.js';
import { SurvivalSystem } from './survival.js';
import { InventorySystem } from './inventory.js';
import { BuildingSystem } from './building.js';
import { WorldManager } from './world.js';
import { EnemyManager } from './enemies.js';
import { PlayerController } from './player.js';
import { PostFX } from './postfx.js';
import { CollisionWorld } from './collision.js';
import { atmo, buildEnvironment } from './sky.js';

const UNDERWATER_FOG = new THREE.Color(0x0b5563);
const NIGHT_TINT = new THREE.Vector3(0.88, 0.96, 1.1);
const DAY_TINT = new THREE.Vector3(1.03, 1.0, 0.96);

class GameEngine {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.startScreen = document.getElementById('start-screen');
    this.deployBtn = document.getElementById('deploy-btn');
    this.biomeDisplay = document.getElementById('biome-display');

    this.radarCanvas = document.getElementById('radar-canvas');
    this.radarCtx = this.radarCanvas ? this.radarCanvas.getContext('2d') : null;

    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.isRunning = false;
    this.quality = new URLSearchParams(window.location.search).get('quality') || 'high';

    this.underwaterBlend = 0;
    this.damageFlash = 0;
    this.lastHp = null;
    this.menuFocus = new THREE.Vector3();
    this.shoreProx = 0;
    this.shoreTimer = 0;
    this.lastLightning = 0;
    this._fwd = new THREE.Vector3();

    this.initScene();
    this.initSystems();
    this.initEvents();
    this.animate();
  }

  initScene() {
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1500);
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.quality === 'low',
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene.environment = buildEnvironment(this.renderer);
  }

  initSystems() {
    this.collision = new CollisionWorld();
    this.terrain = new Terrain(this.scene, 500, 224);
    this.weather = new WeatherSystem(this.scene);
    this.particles = new ParticleManager(this.scene);
    this.particles.setTerrain(this.terrain);
    this.survival = new SurvivalSystem();
    this.inventory = new InventorySystem(this.survival);
    this.building = new BuildingSystem(this.scene, this.inventory, this.collision);
    this.world = new WorldManager(this.scene, this.terrain, this.inventory, this.particles, this.collision);
    this.enemies = new EnemyManager(this.scene, this.terrain, this.survival, this.building, this.particles, this.collision);

    this.player = new PlayerController(
      this.camera,
      this.scene,
      this.terrain,
      this.survival,
      this.inventory,
      this.building,
      this.enemies,
      this.world,
      this.particles,
      this.collision
    );

    // Just beside the camp fire (which sits at the origin), clear of the seats and tents
    const spawnZ = -3.5;
    const spawnY = this.terrain.getHeightAt(0, spawnZ);
    this.player.position.set(0, spawnY + 2.0, spawnZ);
    this.menuFocus.set(0, spawnY + 1.6, 0);

    this.post = new PostFX(this.renderer, this.scene, this.camera, { quality: this.quality });
    this.particles.resize(window.innerHeight * this.renderer.getPixelRatio());
  }

  initEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.post.setSize(window.innerWidth, window.innerHeight);
      this.particles.resize(window.innerHeight * this.renderer.getPixelRatio());
    });

    // The HUD only appears once the briefing screen is dismissed
    this.hud = document.getElementById('hud-overlay');
    if (this.hud) this.hud.style.visibility = 'hidden';

    // Hits from enemies: camera kick and a thump
    window.addEventListener('player_hit', (e) => {
      if (!this.isRunning) return;
      this.player.screenShake = Math.max(this.player.screenShake, 0.12 + Math.min(0.2, e.detail.amount / 150));
      sounds.playPlayerHurt(e.detail.amount);
    });

    this.deployBtn.addEventListener('click', () => {
      if (this.hud) this.hud.style.visibility = '';
      sounds.init();
      sounds.resume();
      this.startScreen.style.display = 'none';
      this.camera.rotation.set(0, 0, 0);
      this.canvas.requestPointerLock();
      this.isRunning = true;
    });
  }

  updateBiomeDisplay(playerPos) {
    if (!this.biomeDisplay) return;
    const distToPeak = Math.hypot(playerPos.x - (-120), playerPos.z - (-140));

    if (distToPeak < 70) {
      this.biomeDisplay.innerHTML = 'ALPINE CRAGS &bull; EXTRACTION RELAY';
      this.biomeDisplay.style.color = '#38bdf8';
    } else if (playerPos.length() < 35) {
      this.biomeDisplay.innerHTML = 'SURVIVOR MEADOWS &bull; SAFE ZONE';
      this.biomeDisplay.style.color = '#4ade80';
    } else {
      this.biomeDisplay.innerHTML = 'BLACK FOREST &bull; HOSTILE SECTOR';
      this.biomeDisplay.style.color = '#f59e0b';
    }
  }

  drawRadar(playerPos, playerYaw) {
    if (!this.radarCtx || !this.radarCanvas) return;
    const ctx = this.radarCtx;
    const w = this.radarCanvas.width;
    const h = this.radarCanvas.height;
    const center = w / 2;
    const radarRange = 85.0;
    const scale = center / radarRange;

    ctx.clearRect(0, 0, w, h);

    ctx.beginPath();
    ctx.arc(center, center, center - 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 15, 22, 0.85)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.stroke();

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.beginPath();
    ctx.arc(center, center, center * 0.5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(center, 4);
    ctx.lineTo(center, h - 4);
    ctx.moveTo(4, center);
    ctx.lineTo(w - 4, center);
    ctx.stroke();

    for (const s of this.building.structures) {
      const dx = s.position.x - playerPos.x;
      const dz = s.position.z - playerPos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < radarRange) {
        const rx = center + dx * scale;
        const ry = center + dz * scale;
        ctx.fillStyle = s.type === 'campfire' ? '#f59e0b' : '#38bdf8';
        ctx.fillRect(rx - 2, ry - 2, 4, 4);
      }
    }

    const tower = this.world.landmarks.find(l => l.isObjective);
    if (tower) {
      const dx = tower.position.x - playerPos.x;
      const dz = tower.position.z - playerPos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < radarRange) {
        const rx = center + dx * scale;
        const ry = center + dz * scale;
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(rx, ry, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (const e of this.enemies.enemies) {
      const dx = e.mesh.position.x - playerPos.x;
      const dz = e.mesh.position.z - playerPos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < radarRange) {
        const rx = center + dx * scale;
        const ry = center + dz * scale;
        ctx.fillStyle = e.state === 'chase' ? '#ef4444' : (e.state === 'alert' || e.state === 'search' ? '#fde047' : 'rgba(148, 163, 184, 0.75)');
        const size = e.type === 'behemoth' ? 5 : 3;
        ctx.beginPath();
        ctx.arc(rx, ry, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(-playerYaw);
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Everything the AI needs to know about how conspicuous the player is
  enemyEnv() {
    const p = this.player;
    return {
      day: this.weather.dayCount,
      isNight: this.weather.isNight(),
      isRaining: this.weather.isRaining,
      crouching: !!p.keys['KeyC'] && !p.isSwimming,
      sprinting: p.isSprinting,
      moving: Math.hypot(p.velocity.x, p.velocity.z) > 0.6
    };
  }

  // Distance-to-water proxy (0 = far, 1 = standing in it) for the shoreline ambience
  computeShore(pos) {
    const wl = this.terrain.waterLevel;
    let best = 999;
    for (const r of [6, 14, 26, 40]) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (this.terrain.getHeightAt(pos.x + Math.cos(a) * r, pos.z + Math.sin(a) * r) < wl + 0.2) best = Math.min(best, r);
      }
    }
    if (this.terrain.getHeightAt(pos.x, pos.z) < wl + 0.2) best = 0;
    return Math.max(0, 1 - best / 40);
  }

  updateAudio(delta, playerPos) {
    if (!sounds.initialized) return;
    this.camera.getWorldDirection(this._fwd);
    sounds.setListener(this.camera.position.x, this.camera.position.y, this.camera.position.z, this._fwd.x, this._fwd.y, this._fwd.z);

    this.shoreTimer -= delta;
    if (this.shoreTimer <= 0) {
      this.shoreTimer = 0.4;
      this.shoreProx = this.computeShore(playerPos);
    }

    // Nearest burning fire drives the crackle layer
    let fire = null;
    const consider = (pos) => {
      const d = pos.distanceTo(playerPos);
      if (!fire || d < fire.dist) fire = { pos, dist: d };
    };
    for (const f of this.world.fireSources) consider(f.position);
    for (const st of this.building.structures) if (st.mesh.userData.fireLight) consider(st.position);

    const w = this.weather;
    sounds.update(delta, {
      isNight: w.isNight(),
      rain: Math.max(0, Math.min(1, (w.overcast - 0.15) / 0.6)),
      altitude: Math.max(0, Math.min(1, (playerPos.y - 16) / 30)),
      shore: this.shoreProx,
      hpFrac: this.survival.currentHp / Math.max(1, this.survival.getMaxHp()),
      fire
    });

    // Thunder rolls in after each lightning flash
    if (w.lightning > 0.95 && this.lastLightning <= 0.95) sounds.playThunder(0.5 + Math.random() * 2.2);
    this.lastLightning = w.lightning;
  }

  // Slow cinematic orbit around the starter camp while the briefing screen is up
  updateMenuCamera() {
    const a = this.elapsed * 0.07 + 0.6;
    const r = 15;
    const groundY = this.terrain.getHeightAt(0, 0);
    this.camera.position.set(Math.cos(a) * r, groundY + 4.2 + Math.sin(this.elapsed * 0.2) * 0.4, Math.sin(a) * r);
    this.camera.lookAt(this.menuFocus);
  }

  // Campfires: flame/smoke particles and flickering light
  updateFires(delta) {
    for (const f of this.world.fireSources) {
      this.particles.emitCampfire(f.position, delta);
    }
    const t = this.elapsed;
    for (const s of this.building.structures) {
      const light = s.mesh.userData.fireLight;
      if (!light) continue;
      const base = s.mesh.userData.fireBase;
      light.intensity = base * (0.8 + 0.2 * Math.sin(t * 17 + s.position.x) + 0.12 * Math.sin(t * 41) + (Math.random() - 0.5) * 0.12);
      this.particles.emitCampfire(s.position.clone().add(s.mesh.userData.fireOffset), delta);
    }
  }

  updatePostFX(delta) {
    const u = this.post.uniforms;
    const under = this.player.isUnderwater && this.isRunning;
    this.underwaterBlend += ((under ? 1 : 0) - this.underwaterBlend) * Math.min(1, delta * 6);

    const hp = this.survival.currentHp;
    if (this.lastHp !== null && hp < this.lastHp) {
      this.damageFlash = Math.min(1, this.damageFlash + 0.35 + (this.lastHp - hp) / 60);
    }
    this.lastHp = hp;
    this.damageFlash = Math.max(0, this.damageFlash - delta * 2.4);

    const day = atmo.uniforms.uDay.value;
    u.uTint.value.lerpVectors(NIGHT_TINT, DAY_TINT, day);
    u.uUnderwater.value = this.underwaterBlend;
    u.uDamage.value = this.damageFlash;
    u.uScope.value = this.isRunning ? this.player.scopeAmount : 0;
    u.uAberration.value = 0.0005 + (this.isRunning ? this.player.screenShake * 0.02 : 0);

    // Low-health desaturation
    const frac = this.survival.currentHp / Math.max(1, this.survival.getMaxHp());
    u.uSaturation.value = 1.08 - (this.isRunning && frac < 0.3 ? (0.3 - frac) * 2.2 : 0);

    if (this.post.bloom) {
      this.post.bloom.strength = 0.42 + (1 - day) * 0.22 - this.underwaterBlend * 0.2;
    }
  }

  // Advances the whole simulation by `delta` seconds (no rendering), used by animate() and the playtest harness
  tick(delta) {
    this.elapsed += delta;

    if (this.isRunning) {
      const playerPos = this.player.position;

      this.player.update(delta);
      this.survival.update(delta, playerPos, this.building.structures, this.weather.isNight(), this.weather.isRaining);
      this.weather.update(delta, playerPos, this.camera);

      // Deep aquatic fog and background ambiance when submerged
      const under = this.player.isUnderwater;
      this.weather.sky.mesh.visible = !under;
      if (under) {
        this.scene.fog.color.copy(UNDERWATER_FOG);
        this.scene.fog.density = 0.045;
        this.scene.background = UNDERWATER_FOG;
      } else {
        this.scene.background = null;
      }

      this.world.update(delta);
      this.terrain.update(delta, this.camera.position);
      this.enemies.update(delta, playerPos, this.building.structures, this.enemyEnv());
      this.updateFires(delta);
      this.updateAudio(delta, playerPos);
      this.particles.emitAmbient(playerPos, delta, this.weather.isNight(), this.weather.isRaining);
      this.particles.update(delta);
      this.updateBiomeDisplay(playerPos);
      this.drawRadar(playerPos, this.player.yaw);
      this.checkExtraction(playerPos);
    } else {
      this.player.weaponGroup.visible = false;
      this.updateMenuCamera();
      this.weather.update(delta, this.menuFocus, this.camera);
      this.world.update(delta);
      this.terrain.update(delta, this.camera.position);
      this.updateFires(delta);
      this.particles.emitAmbient(this.menuFocus, delta, this.weather.isNight(), this.weather.isRaining);
      this.particles.update(delta);
    }
  }

  // The VTOL has to actually land on the summit; standing near the tower early does nothing
  checkExtraction(playerPos) {
    const heli = this.world.rescueHelicopter;
    const tower = this.world.landmarks.find(l => l.isObjective);
    if (!this.world.extractionActive || !heli || !tower) return;

    if (this.world.extractionReady && !this.world.extractionAnnounced) {
      this.world.extractionAnnounced = true;
      window.showTacticalNotification?.('VTOL ON THE PAD — GET TO THE SUMMIT AND BOARD NOW!', 'success');
    }
    const horizontal = Math.hypot(playerPos.x - heli.position.x, playerPos.z - heli.position.z);
    if (this.world.extractionReady && horizontal < 12 && playerPos.y > tower.position.y - 3) {
      window.showTacticalNotification?.('MISSION ACCOMPLISHED! EXTRACTED SUCCESSFULLY WITH BEHEMOTH TELEMETRY!', 'success');
      this.world.extractionActive = false;
      this.won = true;
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = Math.min(0.08, this.clock.getDelta());
    this.tick(delta);
    this.updatePostFX(delta);
    this.post.render(delta, this.elapsed);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const game = new GameEngine();
  if (import.meta.env.DEV) {
    window.__game = game;
    if (new URLSearchParams(window.location.search).has('playtest')) {
      import('./playtest.js').then(({ Playtest }) => {
        window.__playtest = new Playtest(game);
        window.__playtest.mountOverlay();
      });
    }
  }
});
