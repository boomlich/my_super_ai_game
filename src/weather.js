// ZONE ZERO: Day/Night Cycle, Sky Palette, Lighting & Rain
import * as THREE from 'three';
import { atmo, SkyDome } from './sky.js';

const PALETTE = {
  day:   { zenith: new THREE.Color(0x2c6bd0), horizon: new THREE.Color(0xa8d0f2) },
  dusk:  { zenith: new THREE.Color(0x2b3668), horizon: new THREE.Color(0xff8a50) },
  night: { zenith: new THREE.Color(0x040919), horizon: new THREE.Color(0x0f1a33) },
  storm: { zenith: new THREE.Color(0x4a525c), horizon: new THREE.Color(0x8a95a0) }
};

const SUN_LOW = new THREE.Color(0xffc487);
const SUN_HIGH = new THREE.Color(0xfff2dc);
const MOON = new THREE.Color(0x8fa8ff);
const HEMI_SKY_DAY = new THREE.Color(0xcfe6ff);
const HEMI_SKY_NIGHT = new THREE.Color(0x1d2c52);
const HEMI_GROUND_DAY = new THREE.Color(0x5b4c36);
const HEMI_GROUND_NIGHT = new THREE.Color(0x090d16);

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const RAIN_COUNT = 2600;
const RAIN_VERTEX = /* glsl */`
  attribute float aEnd;
  uniform float uTime;
  uniform float uIntensity;
  varying float vAlpha;
  void main() {
    float y = mod(position.y - uTime * 26.0, 32.0);
    vec3 p = vec3(position.x + y * 0.07 + aEnd * 0.22, y + aEnd * 0.95, position.z);
    vAlpha = (0.12 + 0.5 * aEnd) * uIntensity;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const RAIN_FRAGMENT = /* glsl */`
  uniform vec3 uColor;
  varying float vAlpha;
  void main() { gl_FragColor = vec4(uColor, vAlpha); }
`;

export class WeatherSystem {
  constructor(scene) {
    this.scene = scene;

    // Time: 0 to 24 hours. Starts at 08:00 (morning)
    this.timeOfDay = 8.0;
    this.dayCount = 1;
    this.timeSpeed = 0.05; // 1 second real time = 0.05 hours (~8 min full day/night cycle)

    this.sunLight = null;
    this.hemiLight = null;
    this.sky = null;

    this.flashlight = null;
    this.flashlightOn = false;

    this.rainMesh = null;
    this.isRaining = false;
    this.rainTimer = 0;
    this.overcast = 0;
    this.lightning = 0;
    this.lightningTimer = 12;

    this.domTimeIcon = document.getElementById('time-icon');
    this.domDayCounter = document.getElementById('day-counter');
    this.domTimeCounter = document.getElementById('time-counter');

    this._sunDir = new THREE.Vector3();
    this._moonDir = new THREE.Vector3();
    this._lightDir = new THREE.Vector3();
    this._tmpA = new THREE.Color();
    this._tmpB = new THREE.Color();
    this._forward = new THREE.Vector3();

    this.initSkyAndLighting();
    this.initRain();
    this.initControls();
  }

  initSkyAndLighting() {
    this.sky = new SkyDome();
    this.scene.add(this.sky.mesh);

    this.scene.fog = new THREE.FogExp2(0xa8d0f2, 0.006);

    this.hemiLight = new THREE.HemisphereLight(0xcfe6ff, 0x5b4c36, 0.6);
    this.scene.add(this.hemiLight);

    // Directional Sun / Moon (single shadow caster that swaps between the two)
    this.sunLight = new THREE.DirectionalLight(0xfff2dc, 3);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 320;
    const shadowDist = 85;
    this.sunLight.shadow.camera.left = -shadowDist;
    this.sunLight.shadow.camera.right = shadowDist;
    this.sunLight.shadow.camera.top = shadowDist;
    this.sunLight.shadow.camera.bottom = -shadowDist;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.06;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Flashlight (Toggle 'F')
    this.flashlight = new THREE.SpotLight(0xfff4e0, 0, 60, Math.PI / 6, 0.55, 1.0);
    this.flashlight.castShadow = false;
    this.scene.add(this.flashlight);
    this.scene.add(this.flashlight.target);
  }

  initRain() {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(RAIN_COUNT * 2 * 3);
    const ends = new Float32Array(RAIN_COUNT * 2);
    for (let i = 0; i < RAIN_COUNT; i++) {
      const x = (Math.random() - 0.5) * 70;
      const y = Math.random() * 32;
      const z = (Math.random() - 0.5) * 70;
      for (let v = 0; v < 2; v++) {
        positions.set([x, y, z], (i * 2 + v) * 3);
        ends[i * 2 + v] = v;
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));

    this.rainMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uColor: { value: new THREE.Color(0xc6d6e8) }
      },
      vertexShader: RAIN_VERTEX,
      fragmentShader: RAIN_FRAGMENT,
      transparent: true,
      depthWrite: false
    });

    this.rainMesh = new THREE.LineSegments(geo, this.rainMaterial);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    this.scene.add(this.rainMesh);
  }

  initControls() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF') {
        this.toggleFlashlight();
      }
    });
  }

  toggleFlashlight() {
    this.flashlightOn = !this.flashlightOn;
    this.flashlight.intensity = this.flashlightOn ? 60.0 : 0.0;
  }

  isNight() {
    return this.timeOfDay < 5.0 || this.timeOfDay > 20.5;
  }

  update(delta, playerPos, playerCam) {
    this.timeOfDay += this.timeSpeed * delta;
    if (this.timeOfDay >= 24.0) {
      this.timeOfDay -= 24.0;
      this.dayCount++;
    }

    // Rain state machine (toggles every 3 minutes) with a smooth overcast blend
    this.rainTimer += delta;
    if (this.rainTimer > 180) {
      this.isRaining = !this.isRaining;
      this.rainTimer = 0;
    }
    const overcastTarget = this.isRaining ? 1 : 0;
    this.overcast += (overcastTarget - this.overcast) * Math.min(1, delta * 0.35);

    this.updateCelestials(delta);
    this.updateLighting(playerPos);
    this.updateRain(delta, playerPos);
    this.updateFlashlight(playerCam);

    if (playerCam) this.sky.follow(playerCam.position);
    this.updateHUD();
  }

  updateCelestials(delta) {
    const u = atmo.uniforms;
    u.uTime.value += delta;

    // Sun rises at 06:00, sets at 18:00
    const a = ((this.timeOfDay - 6.0) / 24.0) * Math.PI * 2;
    this._sunDir.set(Math.cos(a), Math.sin(a), Math.sin(a * 0.5) * 0.4).normalize();
    this._moonDir.set(-this._sunDir.x, -this._sunDir.y, -this._sunDir.z * 0.6 + 0.2).normalize();
    u.uSunDir.value.copy(this._sunDir);
    u.uMoonDir.value.copy(this._moonDir);

    const e = this._sunDir.y;
    const day = smooth(-0.1, 0.3, e);
    const twilight = Math.exp(-Math.pow(e / 0.17, 2));
    u.uDay.value = day;
    u.uNight.value = 1 - smooth(-0.22, 0.02, e);

    // Sky palette: night -> day, pushed toward dusk reds near the horizon crossing
    const zenith = this._tmpA.copy(PALETTE.night.zenith).lerp(PALETTE.day.zenith, day).lerp(PALETTE.dusk.zenith, twilight * 0.65);
    const horizon = this._tmpB.copy(PALETTE.night.horizon).lerp(PALETTE.day.horizon, day).lerp(PALETTE.dusk.horizon, twilight * 0.9);

    // Storm overcast greys everything out
    const stormLight = 0.25 + 0.75 * day;
    zenith.lerp(PALETTE.storm.zenith.clone().multiplyScalar(stormLight), this.overcast * 0.85);
    horizon.lerp(PALETTE.storm.horizon.clone().multiplyScalar(stormLight), this.overcast * 0.85);

    // Lightning flashes brighten the whole sky
    this.lightningTimer -= delta;
    if (this.isRaining && this.overcast > 0.7 && this.lightningTimer <= 0) {
      this.lightning = 1;
      this.lightningTimer = 9 + Math.random() * 22;
    }
    this.lightning = Math.max(0, this.lightning - delta * 2.6);
    const flash = this.lightning * (Math.random() < 0.35 ? 0.4 : 1);
    if (flash > 0) {
      zenith.lerp(new THREE.Color(0xdbe6ff), flash * 0.5);
      horizon.lerp(new THREE.Color(0xeef3ff), flash * 0.6);
    }

    u.uZenith.value.copy(zenith);
    u.uHorizon.value.copy(horizon);
    u.uGround.value.copy(horizon).multiplyScalar(0.35);
    u.uCloud.value = 0.42 + this.overcast * 0.5;
    u.uOvercast.value = this.overcast;

    // Fog tracks the horizon colour so distant terrain melts into the sky
    u.uFogColor.value.copy(horizon);
    u.uFogDensity.value = 0.0058 + this.overcast * 0.0085 + (1 - day) * 0.003;
    this.scene.fog.color.copy(u.uFogColor.value);
    this.scene.fog.density = u.uFogDensity.value;
  }

  updateLighting(playerPos) {
    const u = atmo.uniforms;
    const e = this._sunDir.y;
    const day = u.uDay.value;
    const dim = 1 - 0.65 * this.overcast;

    const sunStrength = 3.4 * smooth(-0.02, 0.3, e) * dim;
    const moonStrength = 0.95 * clamp01((-e - 0.02) / 0.2) * (1 - 0.5 * this.overcast);

    const sunTint = this._tmpA.copy(SUN_LOW).lerp(SUN_HIGH, smooth(0.05, 0.5, e));
    if (e > -0.02) {
      this._lightDir.copy(this._sunDir);
      this.sunLight.color.copy(sunTint);
      this.sunLight.intensity = sunStrength;
      u.uSunColor.value.copy(sunTint);
    } else {
      this._lightDir.copy(this._moonDir);
      this.sunLight.color.copy(MOON);
      this.sunLight.intensity = moonStrength;
      u.uSunColor.value.copy(MOON);
    }

    this.sunLight.position.copy(playerPos).addScaledVector(this._lightDir, 130);
    this.sunLight.target.position.copy(playerPos);
    this.sunLight.target.updateMatrixWorld();

    this.hemiLight.color.copy(HEMI_SKY_NIGHT).lerp(HEMI_SKY_DAY, day);
    this.hemiLight.groundColor.copy(HEMI_GROUND_NIGHT).lerp(HEMI_GROUND_DAY, day);
    this.hemiLight.intensity = (0.3 + 0.7 * day) * (1 - 0.25 * this.overcast) + this.lightning * 2.5;

    this.scene.environmentIntensity = 0.1 + 0.75 * day * (1 - 0.35 * this.overcast);
  }

  updateRain(delta, playerPos) {
    const intensity = clamp01((this.overcast - 0.15) / 0.6);
    this.rainMesh.visible = intensity > 0.01;
    if (!this.rainMesh.visible) return;
    this.rainMaterial.uniforms.uTime.value += delta;
    this.rainMaterial.uniforms.uIntensity.value = intensity;
    this.rainMesh.position.set(playerPos.x, playerPos.y - 8, playerPos.z);
  }

  updateFlashlight(playerCam) {
    if (!this.flashlight || !playerCam) return;
    this.flashlight.position.copy(playerCam.position);
    playerCam.getWorldDirection(this._forward);
    this.flashlight.target.position.copy(playerCam.position).addScaledVector(this._forward, 15);
    this.flashlight.target.updateMatrixWorld();
  }

  updateHUD() {
    const hours = Math.floor(this.timeOfDay);
    const minutes = Math.floor((this.timeOfDay % 1) * 60);
    const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

    if (this.domTimeCounter) this.domTimeCounter.textContent = timeStr;
    if (this.domDayCounter) this.domDayCounter.textContent = `DAY ${this.dayCount}`;
    if (this.domTimeIcon) this.domTimeIcon.textContent = this.isNight() ? '🌙' : (this.isRaining ? '🌧️' : '☀️');
  }
}
