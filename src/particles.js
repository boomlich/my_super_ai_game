// ZONE ZERO: Tactical FX — pooled GPU particles, tracers, shockwaves, fire, smoke & damage numbers
import * as THREE from 'three';

const POINT_VERTEX = /* glsl */`
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  uniform float uHeight;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vColor = aColor;
    vAlpha = aAlpha;
    gl_PointSize = clamp(aSize * projectionMatrix[1][1] * uHeight * 0.5 / max(-mv.z, 0.05), 0.0, 220.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const POINT_FRAGMENT = /* glsl */`
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.15, d);
    if (a * vAlpha < 0.003) discard;
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`;

// One draw call per blend mode; per-particle colour/size/alpha live in vertex attributes.
class ParticlePool {
  constructor(scene, capacity, additive, uniforms) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: POINT_VERTEX,
      fragmentShader: POINT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 4 : 3;
    scene.add(this.points);
    this.geo = geo;
  }

  flush(count) {
    this.geo.setDrawRange(0, count);
    for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) {
      this.geo.attributes[name].needsUpdate = true;
    }
  }
}

const TRACER_GEO = new THREE.BoxGeometry(0.018, 0.018, 1).translate(0, 0, 0.5);

export class ParticleManager {
  constructor(scene) {
    this.scene = scene;
    this.terrain = null;

    this.particles = [];
    this.tracers = [];
    this.casings = [];
    this.shockwaves = [];
    this.damageNumbers = [];

    const uniforms = { uHeight: { value: window.innerHeight * Math.min(window.devicePixelRatio, 2) } };
    this.uniforms = uniforms;
    this.softPool = new ParticlePool(scene, 4000, false, uniforms);
    this.glowPool = new ParticlePool(scene, 4000, true, uniforms);

    this.casingGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.045, 6);
    this.casingMat = new THREE.MeshStandardMaterial({ color: 0xc8892b, metalness: 1.0, roughness: 0.3 });
    this.shockGeo = new THREE.RingGeometry(0.72, 1.0, 40).rotateX(-Math.PI / 2);

    // A single permanent light for explosion flashes (avoids shader recompiles from adding lights at runtime)
    this.flashLight = new THREE.PointLight(0xffa24a, 0, 40, 2);
    scene.add(this.flashLight);
    this.flashTime = 0;

    this.fireAccum = 0;
    this.ambientAccum = 0;
    this._c = new THREE.Color();
  }

  setTerrain(terrain) {
    this.terrain = terrain;
  }

  resize(heightPx) {
    this.uniforms.uHeight.value = heightPx;
  }

  spawn(opts) {
    const pool = opts.additive ? this.glowPool : this.softPool;
    if (this.particles.length >= this.softPool.capacity + this.glowPool.capacity) return null;
    const c = this._c.set(opts.color);
    const glow = opts.glow || 1;
    const p = {
      x: opts.x, y: opts.y, z: opts.z,
      vx: opts.vx || 0, vy: opts.vy || 0, vz: opts.vz || 0,
      life: opts.life, maxLife: opts.life,
      size0: opts.size0, size1: opts.size1 ?? opts.size0,
      r: c.r * glow, g: c.g * glow, b: c.b * glow,
      alpha: opts.alpha ?? 1,
      gravity: opts.gravity ?? 0,
      drag: opts.drag ?? 0,
      fadeIn: opts.fadeIn ?? 0,
      fadePow: opts.fadePow ?? 1,
      buoyant: opts.buoyant || false,
      pool
    };
    this.particles.push(p);
    return p;
  }

  // Water splash: foam ring + spray droplets + mist
  createWaterSplash(pos, size = 1.0) {
    this.createShockwave(pos, 3.2 * size, 0xcfeeff);

    const drops = Math.round(18 * size);
    for (let i = 0; i < drops; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 2.6 * size;
      this.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: Math.cos(a) * sp, vy: 2.5 + Math.random() * 3.8, vz: Math.sin(a) * sp,
        life: 0.55 + Math.random() * 0.4, size0: 0.11 * size, size1: 0.05 * size,
        color: i % 3 === 0 ? 0xffffff : 0xa9dcff, alpha: 0.9, gravity: 9.8, fadePow: 0.6
      });
    }
    for (let i = 0; i < 5; i++) {
      this.spawn({
        x: pos.x + (Math.random() - 0.5) * 0.6, y: pos.y + 0.1, z: pos.z + (Math.random() - 0.5) * 0.6,
        vx: (Math.random() - 0.5) * 0.8, vy: 0.6 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 0.8,
        life: 0.9, size0: 0.5 * size, size1: 1.5 * size, color: 0xe8f6ff, alpha: 0.35, drag: 1.5, fadeIn: 0.15
      });
    }
  }

  createUnderwaterBubbles(pos, count = 5) {
    for (let i = 0; i < count; i++) {
      this.spawn({
        x: pos.x + (Math.random() - 0.5) * 0.9,
        y: pos.y - 0.3 - Math.random() * 0.4,
        z: pos.z + (Math.random() - 0.5) * 0.9,
        vx: (Math.random() - 0.5) * 0.4, vy: 1.0 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 0.4,
        life: 1.0 + Math.random() * 0.7,
        size0: 0.05 + Math.random() * 0.06, size1: 0.07 + Math.random() * 0.06,
        color: i % 2 ? 0xffffff : 0xbae6fd, alpha: 0.55, buoyant: true
      });
    }
  }

  createDamageNumber(pos, amount, isCrit = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    const text = `${Math.round(amount)}${isCrit ? '!' : ''}`;

    ctx.font = `700 ${isCrit ? 58 : 46}px Teko, Rajdhani, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, 80, 42);
    const grad = ctx.createLinearGradient(0, 14, 0, 70);
    if (isCrit) {
      grad.addColorStop(0, '#fff7c2');
      grad.addColorStop(1, '#f59e0b');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#cbd5e1');
    }
    ctx.fillStyle = grad;
    ctx.fillText(text, 80, 42);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, fog: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.8, (Math.random() - 0.5) * 0.4));
    const baseW = isCrit ? 1.5 : 1.1;
    const baseH = isCrit ? 0.75 : 0.55;
    sprite.scale.set(baseW, baseH, 1.0);
    sprite.renderOrder = 10;

    this.scene.add(sprite);
    this.damageNumbers.push({ sprite, baseW, baseH, life: 0.9, maxLife: 0.9, velY: 1.8, pop: isCrit ? 1.35 : 1.15 });
  }

  createShockwave(pos, maxRadius = 12, color = 0x38bdf8) {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const mesh = new THREE.Mesh(this.shockGeo, mat);
    mesh.position.copy(pos);
    mesh.position.y += 0.08;
    mesh.scale.set(0.2, 1, 0.2);
    mesh.renderOrder = 4;
    this.scene.add(mesh);

    this.shockwaves.push({ mesh, maxRadius, life: 0.65, maxLife: 0.65 });
  }

  // Glowing tracer round that races from the muzzle to the impact point
  createTracer(start, end) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    mat.color.multiplyScalar(3);
    const mesh = new THREE.Mesh(TRACER_GEO, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    this.scene.add(mesh);

    const dir = new THREE.Vector3().subVectors(end, start);
    const length = dir.length();
    dir.normalize();
    this.tracers.push({ mesh, start: start.clone(), dir, length, travelled: 0, speed: 420, segment: Math.min(7, length) });
  }

  createMuzzleSmoke(pos, dir, big = false) {
    const n = big ? 5 : 2;
    for (let i = 0; i < n; i++) {
      this.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: dir.x * (1.2 + Math.random()) + (Math.random() - 0.5) * 0.5,
        vy: dir.y * 1.2 + 0.35 + Math.random() * 0.3,
        vz: dir.z * (1.2 + Math.random()) + (Math.random() - 0.5) * 0.5,
        life: 0.7 + Math.random() * 0.4, size0: 0.08, size1: big ? 0.55 : 0.34,
        color: 0xb8bcc4, alpha: 0.28, drag: 2.2, fadeIn: 0.1
      });
    }
  }

  createExplosionFX(pos) {
    this.createShockwave(pos, 16, 0xff8a3c);
    this.flashTime = 0.35;
    this.flashLight.position.copy(pos);
    this.flashLight.position.y += 1.5;

    // Fireball
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      const sp = 1.5 + Math.random() * 5.5;
      this.spawn({
        x: pos.x, y: pos.y + 0.3, z: pos.z,
        vx: Math.cos(a) * sp, vy: 1.5 + up * 5.5, vz: Math.sin(a) * sp,
        life: 0.45 + Math.random() * 0.35, size0: 0.9, size1: 2.6 + Math.random() * 1.2,
        color: Math.random() < 0.5 ? 0xff7a1a : 0xffc24a, glow: 2.2, alpha: 0.85,
        additive: true, drag: 2.2, fadePow: 1.4
      });
    }
    // Rolling smoke
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.8 + Math.random() * 3.2;
      this.spawn({
        x: pos.x, y: pos.y + 0.5, z: pos.z,
        vx: Math.cos(a) * sp, vy: 2 + Math.random() * 4, vz: Math.sin(a) * sp,
        life: 1.6 + Math.random() * 1.2, size0: 1.0, size1: 4.2 + Math.random() * 2.2,
        color: 0x2c2f36, alpha: 0.55, drag: 1.8, fadeIn: 0.12
      });
    }
    // Flying sparks + debris
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 12;
      this.spawn({
        x: pos.x, y: pos.y + 0.4, z: pos.z,
        vx: Math.cos(a) * sp, vy: 3 + Math.random() * 10, vz: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.7, size0: 0.09, size1: 0.03,
        color: 0xffb347, glow: 3, alpha: 1, additive: true, gravity: 12, fadePow: 0.7
      });
    }
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 7;
      this.spawn({
        x: pos.x, y: pos.y + 0.3, z: pos.z,
        vx: Math.cos(a) * sp, vy: 4 + Math.random() * 7, vz: Math.sin(a) * sp,
        life: 0.9 + Math.random() * 0.6, size0: 0.16, size1: 0.12,
        color: 0x4b3a2a, alpha: 0.95, gravity: 14
      });
    }
  }

  createImpact(pos, normal, type = 'sparks') {
    const n = normal.clone();
    if (n.lengthSq() < 0.01) n.set(0, 1, 0);
    n.normalize();
    const spread = (v) => (Math.random() - 0.5) * v;

    if (type === 'blood') {
      for (let i = 0; i < 12; i++) {
        this.spawn({
          x: pos.x, y: pos.y, z: pos.z,
          vx: n.x * (1 + Math.random() * 3) + spread(3), vy: n.y * 2 + Math.random() * 2.5, vz: n.z * (1 + Math.random() * 3) + spread(3),
          life: 0.45 + Math.random() * 0.4, size0: 0.075, size1: 0.045,
          color: Math.random() < 0.5 ? 0xa31616 : 0x6d0f12, alpha: 0.95, gravity: 11
        });
      }
      this.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: n.x, vy: n.y + 0.3, vz: n.z, life: 0.5, size0: 0.2, size1: 0.8, color: 0x7a1414, alpha: 0.35, drag: 3 });
      return;
    }

    if (type === 'wood') {
      for (let i = 0; i < 12; i++) {
        this.spawn({
          x: pos.x, y: pos.y, z: pos.z,
          vx: n.x * (1.5 + Math.random() * 3) + spread(3.5), vy: n.y * 2 + Math.random() * 3, vz: n.z * (1.5 + Math.random() * 3) + spread(3.5),
          life: 0.5 + Math.random() * 0.4, size0: 0.1, size1: 0.07,
          color: Math.random() < 0.5 ? 0x9a6a33 : 0x6b4a26, alpha: 1, gravity: 12
        });
      }
      this.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: n.x * 0.5, vy: n.y * 0.5 + 0.3, vz: n.z * 0.5, life: 0.7, size0: 0.25, size1: 1.0, color: 0xa88c62, alpha: 0.3, drag: 3 });
      return;
    }

    // Sparks + dust puff
    for (let i = 0; i < 9; i++) {
      this.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: n.x * (2 + Math.random() * 5) + spread(3.5), vy: n.y * (2 + Math.random() * 5) + Math.random() * 1.5, vz: n.z * (2 + Math.random() * 5) + spread(3.5),
        life: 0.22 + Math.random() * 0.28, size0: 0.065, size1: 0.02,
        color: 0xffc660, glow: 2.8, alpha: 1, additive: true, gravity: 9
      });
    }
    for (let i = 0; i < 2; i++) {
      this.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: n.x * 0.6 + spread(0.5), vy: n.y * 0.6 + 0.35, vz: n.z * 0.6 + spread(0.5),
        life: 0.7 + Math.random() * 0.4, size0: 0.15, size1: 0.9,
        color: 0x8a8070, alpha: 0.3, drag: 2.5, fadeIn: 0.08
      });
    }
  }

  // Burning campfire: call every frame for each active fire
  emitCampfire(pos, delta) {
    this.fireAccum += delta * 55;
    while (this.fireAccum >= 1) {
      this.fireAccum -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.28;
      this.spawn({
        x: pos.x + Math.cos(a) * r, y: pos.y + 0.12, z: pos.z + Math.sin(a) * r,
        vx: (Math.random() - 0.5) * 0.25, vy: 0.9 + Math.random() * 1.0, vz: (Math.random() - 0.5) * 0.25,
        life: 0.45 + Math.random() * 0.3, size0: 0.42, size1: 0.06,
        color: Math.random() < 0.55 ? 0xff6a14 : 0xffb43a, glow: 2.0, alpha: 0.9, additive: true, fadePow: 0.8, drag: 0.6
      });
      if (Math.random() < 0.14) {
        this.spawn({
          x: pos.x + (Math.random() - 0.5) * 0.3, y: pos.y + 0.5, z: pos.z + (Math.random() - 0.5) * 0.3,
          vx: (Math.random() - 0.5) * 0.8, vy: 1.4 + Math.random() * 1.4, vz: (Math.random() - 0.5) * 0.8,
          life: 0.9 + Math.random() * 0.8, size0: 0.04, size1: 0.015,
          color: 0xffa040, glow: 3, alpha: 1, additive: true, gravity: -0.4
        });
      }
      if (Math.random() < 0.08) {
        this.spawn({
          x: pos.x, y: pos.y + 0.9, z: pos.z,
          vx: (Math.random() - 0.5) * 0.4, vy: 0.9 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.4,
          life: 2.2 + Math.random(), size0: 0.3, size1: 1.5,
          color: 0x555a63, alpha: 0.22, drag: 0.4, fadeIn: 0.2
        });
      }
    }
  }

  // Fireflies at night, drifting pollen & dust motes by day
  emitAmbient(playerPos, delta, night, raining) {
    if (raining) return;
    this.ambientAccum += delta * (night ? 5 : 3);
    while (this.ambientAccum >= 1) {
      this.ambientAccum -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 18;
      const x = playerPos.x + Math.cos(a) * r;
      const z = playerPos.z + Math.sin(a) * r;
      const ground = this.terrain ? this.terrain.getHeightAt(x, z) : playerPos.y - 1.7;
      if (this.terrain && ground < this.terrain.waterLevel + 0.5) continue;
      const y = ground + 0.6 + Math.random() * 2.2;
      if (night) {
        this.spawn({
          x, y, z, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.25, vz: (Math.random() - 0.5) * 0.5,
          life: 5 + Math.random() * 4, size0: 0.09, size1: 0.07,
          color: Math.random() < 0.6 ? 0xc8ff5a : 0x8affc8, glow: 2.4, alpha: 0.95, additive: true, fadeIn: 0.2, fadePow: 0.6
        });
      } else {
        this.spawn({
          x, y, z, vx: 0.5 + Math.random() * 0.4, vy: (Math.random() - 0.3) * 0.15, vz: (Math.random() - 0.5) * 0.3,
          life: 6 + Math.random() * 4, size0: 0.035, size1: 0.03,
          color: 0xfff6d8, alpha: 0.55, fadeIn: 0.25, fadePow: 0.5
        });
      }
    }
  }

  ejectCasing(pos, gunRight) {
    const casing = new THREE.Mesh(this.casingGeo, this.casingMat);
    casing.position.copy(pos);

    const vel = gunRight.clone().multiplyScalar(2.0 + Math.random() * 0.9);
    vel.y += 1.4 + Math.random() * 0.6;

    this.scene.add(casing);
    this.casings.push({
      mesh: casing,
      vel,
      rotVel: new THREE.Vector3(Math.random() * 24, Math.random() * 24, Math.random() * 24),
      life: 3.0,
      grounded: false
    });
  }

  update(delta) {
    // Explosion light flash
    if (this.flashTime > 0) {
      this.flashTime = Math.max(0, this.flashTime - delta);
      this.flashLight.intensity = 260 * Math.pow(this.flashTime / 0.35, 2);
    } else if (this.flashLight.intensity !== 0) {
      this.flashLight.intensity = 0;
    }

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.travelled += t.speed * delta;
      const head = Math.min(t.travelled, t.length);
      const tail = Math.max(0, t.travelled - t.segment);
      if (tail >= t.length) {
        this.scene.remove(t.mesh);
        t.mesh.material.dispose();
        this.tracers.splice(i, 1);
        continue;
      }
      t.mesh.position.copy(t.start).addScaledVector(t.dir, tail);
      t.mesh.lookAt(t.mesh.position.x + t.dir.x, t.mesh.position.y + t.dir.y, t.mesh.position.z + t.dir.z);
      t.mesh.scale.z = Math.max(0.01, head - tail);
      t.mesh.material.opacity = 1 - Math.max(0, (t.travelled - t.length) / t.segment) * 0.8;
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.life -= delta;
      const progress = 1 - s.life / s.maxLife;
      const eased = 1 - Math.pow(1 - progress, 3);
      const radius = Math.max(0.2, s.maxRadius * eased);
      s.mesh.scale.set(radius, 1, radius);
      s.mesh.material.opacity = Math.max(0, 1 - progress) * 0.85;
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.material.dispose();
        this.shockwaves.splice(i, 1);
      }
    }

    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const dn = this.damageNumbers[i];
      dn.life -= delta;
      dn.sprite.position.y += dn.velY * delta;
      dn.velY *= 0.94;
      const k = dn.life / dn.maxLife;
      dn.sprite.material.opacity = Math.min(1, k * 2.2);
      const pop = 1 + Math.max(0, k - 0.8) * 5 * (dn.pop - 1);
      dn.sprite.scale.set(dn.baseW * pop, dn.baseH * pop, 1);
      if (dn.life <= 0) {
        this.scene.remove(dn.sprite);
        dn.sprite.material.map.dispose();
        dn.sprite.material.dispose();
        this.damageNumbers.splice(i, 1);
      }
    }

    this.updateParticles(delta);

    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.life -= delta;
      if (!c.grounded) {
        c.vel.y -= 12.0 * delta;
        c.mesh.position.addScaledVector(c.vel, delta);
        c.mesh.rotation.x += c.rotVel.x * delta;
        c.mesh.rotation.y += c.rotVel.y * delta;

        if (this.terrain) {
          const gy = this.terrain.getHeightAt(c.mesh.position.x, c.mesh.position.z) + 0.01;
          if (c.mesh.position.y <= gy) {
            c.mesh.position.y = gy;
            if (Math.abs(c.vel.y) > 1.2) {
              c.vel.y *= -0.35;
              c.vel.x *= 0.5;
              c.vel.z *= 0.5;
            } else {
              c.grounded = true;
            }
          }
        }
      }
      if (c.life <= 0) {
        this.scene.remove(c.mesh);
        this.casings.splice(i, 1);
      }
    }
  }

  updateParticles(delta) {
    const soft = this.softPool;
    const glow = this.glowPool;
    let sCount = 0;
    let gCount = 0;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= delta;
      if (p.life <= 0) {
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
        continue;
      }

      p.vy -= p.gravity * delta;
      if (p.buoyant) {
        p.vy = Math.min(2.5, p.vy + 0.5 * delta);
        p.vx += (Math.random() - 0.5) * 0.2 * delta;
        p.vz += (Math.random() - 0.5) * 0.2 * delta;
      }
      if (p.drag > 0) {
        const k = Math.max(0, 1 - p.drag * delta);
        p.vx *= k; p.vy *= k; p.vz *= k;
      }
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.z += p.vz * delta;

      const progress = 1 - p.life / p.maxLife;
      let a = p.alpha * Math.pow(1 - progress, p.fadePow);
      if (p.fadeIn > 0) a *= Math.min(1, progress / p.fadeIn);
      const size = p.size0 + (p.size1 - p.size0) * progress;

      const pool = p.pool;
      if ((pool === soft ? sCount : gCount) >= pool.capacity) continue;
      const idx = pool === soft ? sCount++ : gCount++;
      const i3 = idx * 3;
      pool.positions[i3] = p.x;
      pool.positions[i3 + 1] = p.y;
      pool.positions[i3 + 2] = p.z;
      pool.colors[i3] = p.r;
      pool.colors[i3 + 1] = p.g;
      pool.colors[i3 + 2] = p.b;
      pool.sizes[idx] = size;
      pool.alphas[idx] = a;
    }

    soft.flush(sCount);
    glow.flush(gCount);
  }
}
