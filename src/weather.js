// ZONE ZERO: Valheim Day/Night Cycle & Atmospheric Weather System
import * as THREE from 'three';

export class WeatherSystem {
  constructor(scene) {
    this.scene = scene;

    // Time: 0 to 24 hours. Starts at 08:00 (morning)
    this.timeOfDay = 8.0;
    this.dayCount = 1;
    this.timeSpeed = 0.05; // 1 second real time = 0.05 hours (~8 min full day/night cycle)

    // Lighting
    this.sunLight = null;
    this.ambientLight = null;
    this.hemiLight = null;
    this.skyDome = null;

    // Tactical Flashlight attached to player camera
    this.flashlight = null;
    this.flashlightOn = false;

    // Rain particles
    this.rainMesh = null;
    this.isRaining = false;
    this.rainTimer = 0;

    // DOM UI elements
    this.domTimeIcon = document.getElementById('time-icon');
    this.domDayCounter = document.getElementById('day-counter');
    this.domTimeCounter = document.getElementById('time-counter');

    this.initSkyAndLighting();
    this.initRain();
    this.initControls();
  }

  initSkyAndLighting() {
    // Hemispheric ambient light (sky/ground)
    this.hemiLight = new THREE.HemisphereLight(0xb1e1ff, 0x1f2937, 0.4);
    this.scene.add(this.hemiLight);

    // Directional Sun / Moon
    this.sunLight = new THREE.DirectionalLight(0xfffaed, 1.2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 300;
    const shadowDist = 80;
    this.sunLight.shadow.camera.left = -shadowDist;
    this.sunLight.shadow.camera.right = shadowDist;
    this.sunLight.shadow.camera.top = shadowDist;
    this.sunLight.shadow.camera.bottom = -shadowDist;
    this.scene.add(this.sunLight);

    // Flashlight (Toggle 'F')
    this.flashlight = new THREE.SpotLight(0xffffff, 0, 45, Math.PI / 5, 0.4, 1.2);
    this.flashlight.castShadow = false;
    this.scene.add(this.flashlight);
  }

  initRain() {
    const count = 1200;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 80;
      positions[i * 3 + 1] = Math.random() * 30;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x93c5fd,
      size: 0.15,
      transparent: true,
      opacity: 0.6
    });

    this.rainMesh = new THREE.Points(geo, mat);
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
    this.flashlight.intensity = this.flashlightOn ? 4.0 : 0.0;
  }

  isNight() {
    return this.timeOfDay < 5.0 || this.timeOfDay > 20.5;
  }

  update(delta, playerPos, playerCam) {
    // Advance time
    this.timeOfDay += this.timeSpeed * delta;
    if (this.timeOfDay >= 24.0) {
      this.timeOfDay -= 24.0;
      this.dayCount++;
    }

    // Sun angle calculation (sun rises at 6am, sets at 8pm)
    const sunAngle = ((this.timeOfDay - 6.0) / 24.0) * Math.PI * 2;
    const sunDist = 120;
    const sunX = Math.cos(sunAngle) * sunDist;
    const sunY = Math.sin(sunAngle) * sunDist;
    const sunZ = Math.sin(sunAngle * 0.5) * (sunDist * 0.4);

    this.sunLight.position.set(playerPos.x + sunX, playerPos.y + sunY, playerPos.z + sunZ);
    this.sunLight.target.position.copy(playerPos);
    this.sunLight.target.updateMatrixWorld();

    // Lighting tone based on time
    if (!this.scene.fog) {
      this.scene.fog = new THREE.FogExp2(0x38bdf8, 0.006);
    }

    if (sunY > 0) {
      // Day
      const daylightFactor = Math.min(1, Math.max(0.1, sunY / 60));
      this.sunLight.intensity = daylightFactor * 1.3;
      this.sunLight.color.setRGB(1.0, 0.95, 0.88);
      this.hemiLight.intensity = 0.35 + daylightFactor * 0.35;
      const dayColor = new THREE.Color(0x38bdf8).lerp(new THREE.Color(0x0f172a), 1 - daylightFactor);
      this.scene.background = dayColor;
      this.scene.fog.color.copy(dayColor);
      this.scene.fog.density = 0.006;
    } else {
      // Night (Valheim-style eerie dark night)
      this.sunLight.intensity = 0.08; // Dim moonlight
      this.sunLight.color.setRGB(0.2, 0.3, 0.6);
      this.hemiLight.intensity = 0.12;
      const nightColor = new THREE.Color(0x030712);
      this.scene.background = nightColor;
      this.scene.fog.color.copy(nightColor);
      this.scene.fog.density = 0.012;
    }

    // Update Flashlight position & target
    if (this.flashlight && playerCam) {
      this.flashlight.position.copy(playerCam.position);
      const forward = new THREE.Vector3();
      playerCam.getWorldDirection(forward);
      this.flashlight.target.position.copy(playerCam.position).addScaledVector(forward, 15);
      this.flashlight.target.updateMatrixWorld();
    }

    // Rain logic
    this.rainTimer += delta;
    if (this.rainTimer > 180) { // Toggle rain every 3 minutes
      this.isRaining = !this.isRaining;
      this.rainMesh.visible = this.isRaining;
      this.rainTimer = 0;
    }

    if (this.isRaining && this.rainMesh) {
      this.rainMesh.position.set(playerPos.x, playerPos.y, playerPos.z);
      const posAttr = this.rainMesh.geometry.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        let y = posAttr.getY(i) - 22 * delta;
        if (y < 0) y = 30;
        posAttr.setY(i, y);
      }
      posAttr.needsUpdate = true;
    }

    // Update UI
    this.updateHUD();
  }

  updateHUD() {
    const hours = Math.floor(this.timeOfDay);
    const minutes = Math.floor((this.timeOfDay % 1) * 60);
    const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

    if (this.domTimeCounter) this.domTimeCounter.textContent = timeStr;
    if (this.domDayCounter) this.domDayCounter.textContent = `DAY ${this.dayCount}`;
    if (this.domTimeIcon) this.domTimeIcon.textContent = this.isNight() ? '🌙' : '☀️';
  }
}
