// ZONE ZERO: Procedural Valheim-Style Terrain & Dynamic Gerstner Wave Water Engine
import * as THREE from 'three';

class FastNoise {
  constructor(seed = 1337) {
    this.p = new Uint8Array(512);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    let s = seed % 2147483647;
    for (let i = 255; i > 0; i--) {
      s = (s * 16807) % 2147483647;
      const j = s % (i + 1);
      const tmp = perm[i];
      perm[i] = perm[j];
      perm[j] = tmp;
    }
    for (let i = 0; i < 512; i++) {
      this.p[i] = perm[i & 255];
    }
  }

  fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  lerp(t, a, b) {
    return a + t * (b - a);
  }

  grad(hash, x, y) {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  noise2D(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = this.fade(xf);
    const v = this.fade(yf);

    const aa = this.p[this.p[X] + Y];
    const ab = this.p[this.p[X] + Y + 1];
    const ba = this.p[this.p[X + 1] + Y];
    const bb = this.p[this.p[X + 1] + Y + 1];

    const x1 = this.lerp(u, this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf));
    const x2 = this.lerp(u, this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1));
    return this.lerp(v, x1, x2);
  }

  fbm(x, y, octaves = 4, persistence = 0.5, lacunarity = 2.0) {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return total / maxValue;
  }
}

export class Terrain {
  constructor(scene, size = 600, segments = 180) {
    this.scene = scene;
    this.size = size;
    this.segments = segments;
    this.noise = new FastNoise(4242);
    this.waterLevel = 1.8;
    this.waterTime = 0;

    this.mesh = null;
    this.waterMesh = null;
    this.waterGeo = null;
    this.waterBasePositions = null;
    this.waterShimmerMesh = null;
    this.waterShimmerGeo = null;

    this.initTerrain();
    this.initWater();
  }

  getHeightAt(x, z) {
    const dist = Math.hypot(x, z);
    const rad = this.size * 0.48;

    const peakX = -120;
    const peakZ = -140;
    const distToPeak = Math.hypot(x - peakX, z - peakZ);
    const mountainFactor = Math.max(0, 1 - distToPeak / 160);
    const mountainElevation = Math.pow(mountainFactor, 1.8) * 38.0;

    const n1 = this.noise.fbm(x * 0.004, z * 0.004, 4);
    const n2 = this.noise.noise2D(x * 0.02, z * 0.02) * 2.5;
    const nHills = this.noise.fbm(x * 0.012, z * 0.012, 3) * 6.0;

    let height = (n1 * 18.0) + nHills + n2 + mountainElevation;

    // Lake depression in South-East quadrant
    const lakeDist = Math.hypot(x - 80, z - 70);
    if (lakeDist < 60) {
      const lakeFactor = Math.cos((lakeDist / 60) * (Math.PI * 0.5));
      height -= lakeFactor * 8.5; // Deeper lake for true swimming!
    }

    if (dist < 40) {
      const flatten = 1 - (dist / 40);
      height = height * (1 - flatten) + 3.0 * flatten;
    }

    if (dist > rad * 0.75) {
      const falloff = (dist - rad * 0.75) / (rad * 0.25);
      height -= falloff * 25.0;
    }

    return Math.max(-10, height);
  }

  // Dynamic Gerstner Wave Water Height Sampler (matches visuals for swimming buoyancy!)
  getWaterHeightAt(x, z) {
    const t = this.waterTime;
    // Multi-directional wave harmonics
    const wave1 = Math.sin(x * 0.08 + t * 2.2) * Math.cos(z * 0.06 + t * 1.8) * 0.32;
    const wave2 = Math.sin((x + z) * 0.05 + t * 1.5) * 0.22;
    const wave3 = Math.cos(x * 0.16 - z * 0.12 + t * 2.8) * 0.12;
    return this.waterLevel + wave1 + wave2 + wave3;
  }

  initTerrain() {
    const geometry = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position;
    const colors = [];

    const cWaterShallow = new THREE.Color(0x3b82a6);
    const cGrassMeadow = new THREE.Color(0x3e7732);
    const cForestSoil = new THREE.Color(0x274e20);
    const cRockCliff = new THREE.Color(0x57534e);
    const cHighSnow = new THREE.Color(0xecfeff);

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const y = this.getHeightAt(x, z);
      positions.setY(i, y);

      let color = cGrassMeadow.clone();
      if (y < this.waterLevel + 0.8) {
        color.lerp(cWaterShallow, 0.6);
      } else if (y > 28) {
        color.lerp(cHighSnow, Math.min(1, (y - 28) / 10));
      } else if (y > 16) {
        color.lerp(cRockCliff, Math.min(1, (y - 16) / 8));
      } else {
        const dirtNoise = this.noise.noise2D(x * 0.05, z * 0.05);
        if (dirtNoise > 0.1) {
          color.lerp(cForestSoil, 0.7);
        }
      }
      colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.05,
      flatShading: true
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.scene.add(this.mesh);
  }

  initWater() {
    // High-resolution wave mesh (120 x 120 segments)
    this.waterGeo = new THREE.PlaneGeometry(this.size * 1.3, this.size * 1.3, 120, 120);
    this.waterGeo.rotateX(-Math.PI / 2);

    // Save initial coordinates for mathematical wave modulation
    const count = this.waterGeo.attributes.position.count;
    this.waterBasePositions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count * 3; i++) {
      this.waterBasePositions[i] = this.waterGeo.attributes.position.array[i];
    }

    for (let i = 0; i < count; i++) {
      colors[i * 3] = 0.02;     // R
      colors[i * 3 + 1] = 0.52; // G
      colors[i * 3 + 2] = 0.78; // B
    }

    this.waterGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Modern translucent ocean material with dynamic vertex foam crests and double-sided rendering
    const waterMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.08,
      metalness: 0.65,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
      flatShading: true // Stylized Valheim wave facets
    });

    this.waterMesh = new THREE.Mesh(this.waterGeo, waterMat);
    this.waterMesh.position.y = this.waterLevel;
    this.waterMesh.receiveShadow = true;
    this.scene.add(this.waterMesh);

    // Secondary shimmer mesh — tiny additive specular foam caps
    this.waterShimmerGeo = new THREE.PlaneGeometry(this.size * 1.3, this.size * 1.3, 60, 60);
    this.waterShimmerGeo.rotateX(-Math.PI / 2);
    this.shimmerBasePositions = new Float32Array(this.waterShimmerGeo.attributes.position.array.length);
    for (let i = 0; i < this.shimmerBasePositions.length; i++) {
      this.shimmerBasePositions[i] = this.waterShimmerGeo.attributes.position.array[i];
    }
    const shimmerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.waterShimmerMesh = new THREE.Mesh(this.waterShimmerGeo, shimmerMat);
    this.waterShimmerMesh.position.y = this.waterLevel + 0.06;
    this.scene.add(this.waterShimmerMesh);
  }

  update(delta) {
    this.waterTime += delta * 1.25;
    const t = this.waterTime;

    if (this.waterMesh && this.waterGeo && this.waterBasePositions) {
      const pos = this.waterGeo.attributes.position;
      const colAttr = this.waterGeo.attributes.color;
      const base = this.waterBasePositions;

      // Displace each vertex with real-time multi-frequency waves and compute foam crests
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        const z = base[i * 3 + 2];

        const w1 = Math.sin(x * 0.08 + t * 2.2) * Math.cos(z * 0.06 + t * 1.8) * 0.32;
        const wave2 = Math.sin((x + z) * 0.05 + t * 1.5) * 0.22;
        const wave3 = Math.cos(x * 0.16 - z * 0.12 + t * 2.8) * 0.12;
        const totalWave = w1 + wave2 + wave3;

        pos.setY(i, base[i * 3 + 1] + totalWave);

        // Dynamic Crest Foam: Rising peaks shimmer with white foam crests!
        if (colAttr) {
          if (totalWave > 0.18) {
            const foam = Math.min(1.0, (totalWave - 0.18) / 0.32);
            colAttr.setXYZ(i, 0.04 + foam * 0.92, 0.55 + foam * 0.42, 0.76 + foam * 0.22);
          } else {
            const depth = Math.max(0, (totalWave + 0.42) / 0.6);
            colAttr.setXYZ(i, 0.01 + depth * 0.03, 0.24 + depth * 0.31, 0.45 + depth * 0.31);
          }
        }
      }

      pos.needsUpdate = true;
      if (colAttr) colAttr.needsUpdate = true;
      this.waterGeo.computeVertexNormals();
    }

    // Animate shimmer mesh — offset wave phase to create interference glitter pattern
    if (this.waterShimmerMesh && this.waterShimmerGeo && this.shimmerBasePositions) {
      const sp = this.waterShimmerGeo.attributes.position;
      const sb = this.shimmerBasePositions;
      for (let i = 0; i < sp.count; i++) {
        const x = sb[i * 3];
        const z = sb[i * 3 + 2];
        const shimmer = Math.sin(x * 0.12 + t * 3.1) * Math.cos(z * 0.09 + t * 2.4) * 0.18;
        sp.setY(i, sb[i * 3 + 1] + shimmer);
      }
      sp.needsUpdate = true;
      // Pulse shimmer opacity for twinkling reflection
      this.waterShimmerMesh.material.opacity = 0.05 + Math.abs(Math.sin(t * 0.8)) * 0.10;
    }
  }
}
