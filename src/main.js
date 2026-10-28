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
    this.terrain = new Terrain(this.scene, 500, 224);
    this.weather = new WeatherSystem(this.scene);
    this.particles = new ParticleManager(this.scene);
    this.particles.setTerrain(this.terrain);
    this.survival = new SurvivalSystem();
    this.inventory = new InventorySystem(this.survival);
    this.building = new BuildingSystem(this.scene, this.inventory);
    this.world = new WorldManager(this.scene, this.terrain, this.inventory, this.particles);
    this.enemies = new EnemyManager(this.scene, this.terrain, this.survival, this.building, this.particles);

    this.player = new PlayerController(
      this.camera,
      this.scene,
      this.terrain,
      this.survival,
      this.inventory,
      this.building,
      this.enemies,
      this.world,
      this.particles
    );

    const spawnY = this.terrain.getHeightAt(0, 0);
    this.player.position.set(0, spawnY + 2.0, 0);
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
        ctx.fillStyle = e.type === 'behemoth' ? '#ef4444' : '#f87171';
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

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = Math.min(0.08, this.clock.getDelta());
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
      this.terrain.update(delta);
      this.enemies.update(delta, playerPos, this.building.structures);
      this.updateFires(delta);
      this.particles.emitAmbient(playerPos, delta, this.weather.isNight(), this.weather.isRaining);
      this.particles.update(delta);
      this.updateBiomeDisplay(playerPos);
      this.drawRadar(playerPos, this.player.yaw);

      // Check Victory Condition
      if (this.world.extractionActive && this.world.rescueHelicopter) {
        const distToVTOL = Math.hypot(playerPos.x - this.world.rescueHelicopter.position.x, playerPos.z - this.world.rescueHelicopter.position.z);
        if (distToVTOL < 8.0 && playerPos.y > 22.0) {
          window.showTacticalNotification?.('MISSION ACCOMPLISHED! EXTRACTED SUCCESSFULLY WITH BEHEMOTH TELEMETRY!', 'success');
          this.world.extractionActive = false;
        }
      }
    } else {
      this.player.weaponGroup.visible = false;
      this.updateMenuCamera();
      this.weather.update(delta, this.menuFocus, this.camera);
      this.world.update(delta);
      this.terrain.update(delta);
      this.updateFires(delta);
      this.particles.emitAmbient(this.menuFocus, delta, this.weather.isNight(), this.weather.isRaining);
      this.particles.update(delta);
    }

    this.updatePostFX(delta);
    this.post.render(delta, this.elapsed);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const game = new GameEngine();
  if (import.meta.env.DEV) window.__game = game;
});
