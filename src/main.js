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

class GameEngine {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.startScreen = document.getElementById('start-screen');
    this.deployBtn = document.getElementById('deploy-btn');
    this.biomeDisplay = document.getElementById('biome-display');

    this.radarCanvas = document.getElementById('radar-canvas');
    this.radarCtx = this.radarCanvas ? this.radarCanvas.getContext('2d') : null;

    this.clock = new THREE.Clock();
    this.isRunning = false;

    this.initScene();
    this.initSystems();
    this.initEvents();
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x38bdf8);
    this.scene.fog = new THREE.FogExp2(0x38bdf8, 0.007);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  initSystems() {
    this.terrain = new Terrain(this.scene, 500, 160);
    this.weather = new WeatherSystem(this.scene);
    this.particles = new ParticleManager(this.scene);
    this.survival = new SurvivalSystem();
    this.inventory = new InventorySystem(this.survival);
    this.building = new BuildingSystem(this.scene, this.inventory);
    this.world = new WorldManager(this.scene, this.terrain, this.inventory);
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
  }

  initEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this.deployBtn.addEventListener('click', () => {
      sounds.init();
      sounds.resume();
      this.startScreen.style.display = 'none';
      this.canvas.requestPointerLock();
      this.isRunning = true;
      this.animate();
    });
  }

  updateBiomeDisplay(playerPos) {
    if (!this.biomeDisplay) return;
    const distToPeak = Math.hypot(playerPos.x - (-120), playerPos.z - (-140));

    if (distToPeak < 70) {
      this.biomeDisplay.textContent = 'ALPINE CRAGS &bull; EXTRACTION RELAY';
      this.biomeDisplay.style.color = '#38bdf8';
    } else if (playerPos.length() < 35) {
      this.biomeDisplay.textContent = 'SURVIVOR MEADOWS &bull; SAFE ZONE';
      this.biomeDisplay.style.color = '#4ade80';
    } else {
      this.biomeDisplay.textContent = 'BLACK FOREST &bull; HOSTILE SECTOR';
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

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = Math.min(0.08, this.clock.getDelta());

    if (this.isRunning) {
      const playerPos = this.player.position;

      this.player.update(delta);
      this.survival.update(delta, playerPos, this.building.structures, this.weather.isNight(), this.weather.isRaining);
      this.weather.update(delta, playerPos, this.camera);

      // Deep aquatic fog and background ambiance when submerged
      if (this.player.isUnderwater) {
        this.scene.fog.color.setHex(0x064e3b);
        this.scene.fog.density = 0.048;
        this.scene.background = new THREE.Color(0x042f2e);
      }
      this.world.update(delta);
      this.terrain.update(delta);
      this.enemies.update(delta, playerPos, this.building.structures);
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
    }

    this.renderer.render(this.scene, this.camera);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new GameEngine();
});
