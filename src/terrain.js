// ZONE ZERO: Procedural Terrain (biome-shaded, bump-detailed) & GPU Wave Water
import * as THREE from 'three';
import { atmo } from './sky.js';

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

const clamp01 = (v) => Math.min(1, Math.max(0, v));
// GLSL-style smoothstep that also works for descending edges (a > b)
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const NOISE_GLSL = /* glsl */`
  float th21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float tn(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(th21(i), th21(i + vec2(1, 0)), f.x), mix(th21(i + vec2(0, 1)), th21(i + vec2(1, 1)), f.x), f.y);
  }
`;

const TERRAIN_FRAGMENT_PARS = /* glsl */`
  varying vec3 vWPos;
  varying vec3 vWNrm;
  uniform float uTime;
  uniform float uWaterLevel;
  ${NOISE_GLSL}
  vec3 perturbNormalDetail(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
    vec3 vSigmaX = normalize(dFdx(surf_pos));
    vec3 vSigmaY = normalize(dFdy(surf_pos));
    vec3 R1 = cross(vSigmaY, surf_norm);
    vec3 R2 = cross(surf_norm, vSigmaX);
    float fDet = dot(vSigmaX, R1) * faceDirection;
    vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
    return normalize(abs(fDet) * surf_norm - vGrad);
  }
`;

const WATER_VERTEX = /* glsl */`
  uniform float uWaterTime;
  varying vec3 vWPos;
  varying vec3 vNrm;
  varying float vWave;

  // Must match Terrain.getWaterHeightAt() so swimming buoyancy lines up with the visuals.
  vec3 waveField(vec2 p, float t) {
    float a1 = p.x * 0.08 + t * 2.2;
    float b1 = p.y * 0.06 + t * 1.8;
    float c = (p.x + p.y) * 0.05 + t * 1.5;
    float d = p.x * 0.16 - p.y * 0.12 + t * 2.8;
    float h = sin(a1) * cos(b1) * 0.32 + sin(c) * 0.22 + cos(d) * 0.12;
    float dx = cos(a1) * cos(b1) * 0.32 * 0.08 + cos(c) * 0.22 * 0.05 - sin(d) * 0.12 * 0.16;
    float dz = -sin(a1) * sin(b1) * 0.32 * 0.06 + cos(c) * 0.22 * 0.05 + sin(d) * 0.12 * 0.12;
    return vec3(h, dx, dz);
  }

  void main() {
    vec3 p = position;
    vec3 w = waveField(p.xz, uWaterTime);
    p.y += w.x;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWPos = wp.xyz;
    vWave = w.x;
    vNrm = normalize(vec3(-w.y, 1.0, -w.z));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WATER_FRAGMENT = /* glsl */`
  uniform float uWaterTime, uWaterLevel, uTerrainSize;
  uniform sampler2D uHeightTex;
  uniform vec3 uSunDir, uMoonDir, uSunColor, uZenith, uHorizon, uFogColor;
  uniform float uFogDensity, uDay, uNight, uOvercast;
  varying vec3 vWPos;
  varying vec3 vNrm;
  varying float vWave;
  ${NOISE_GLSL}

  vec2 ripples(vec2 p, float t) {
    vec2 g = vec2(0.0);
    g += vec2( 0.8,  0.6) * cos(dot(p, vec2( 0.8,  0.6)) * 1.9  + t * 1.7) * 0.050;
    g += vec2(-0.6,  0.8) * cos(dot(p, vec2(-0.6,  0.8)) * 2.7  + t * 2.3) * 0.040;
    g += vec2( 0.3, -0.95) * cos(dot(p, vec2( 0.3, -0.95)) * 4.1 - t * 2.9) * 0.030;
    g += vec2(-0.95,-0.3) * cos(dot(p, vec2(-0.95,-0.3)) * 6.3  + t * 3.7) * 0.022;
    g += vec2( 0.7, -0.7) * cos(dot(p, vec2( 0.7, -0.7)) * 9.7  - t * 4.4) * 0.015;
    g += vec2(-0.2,  0.98) * cos(dot(p, vec2(-0.2,  0.98)) * 14.3 + t * 5.5) * 0.010;
    return g;
  }

  void main() {
    vec3 toCam = cameraPosition - vWPos;
    float dist = length(toCam);
    vec3 V = toCam / dist;
    vec2 xz = vWPos.xz;

    vec3 ambient = mix(vec3(0.012, 0.022, 0.045), vec3(0.85, 0.93, 1.0), uDay) * (1.0 - 0.35 * uOvercast);
    vec3 N = normalize(vNrm);
    vec2 rg = ripples(xz, uWaterTime) * (1.0 - smoothstep(50.0, 220.0, dist));
    N = normalize(vec3(N.x - rg.x, N.y, N.z - rg.y));

    // Depth from the baked terrain height grid
    float terrH = texture2D(uHeightTex, xz / uTerrainSize + 0.5).r;
    float d = max(uWaterLevel - terrH + vWave * 0.5, 0.0);
    float depthFac = 1.0 - exp(-d * 0.26);

    if (cameraPosition.y < vWPos.y) {
      // Seen from below: dim teal ceiling
      vec3 under = vec3(0.04, 0.2, 0.26) * (0.25 + 0.75 * uDay) + uSunColor * 0.05;
      float fogB = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
      gl_FragColor = vec4(mix(under, uFogColor, fogB * 0.4), 0.72);
      return;
    }

    vec3 shallow = vec3(0.12, 0.55, 0.52);
    vec3 deep = vec3(0.012, 0.10, 0.20);
    vec3 body = mix(shallow, deep, pow(depthFac, 0.75)) * ambient;
    body += uSunColor * max(uSunDir.y, 0.0) * 0.05 * (1.0 - depthFac) * (1.0 - uOvercast);

    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.5));
    float fres = clamp(0.02 + 0.98 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0), 0.0, 1.0);
    vec3 col = mix(body, sky, fres * 0.9);

    // Sun / moon glitter (HDR so bloom blooms it)
    float sunUp = smoothstep(-0.05, 0.1, uSunDir.y);
    float spec = pow(max(dot(R, uSunDir), 0.0), 700.0) * 30.0 + pow(max(dot(R, uSunDir), 0.0), 55.0) * 0.5;
    col += uSunColor * spec * sunUp * (1.0 - uOvercast * 0.8);
    col += vec3(0.5, 0.65, 1.0) * pow(max(dot(R, uMoonDir), 0.0), 500.0) * 6.0 * uNight;

    // Foam: shoreline lace + wave crests
    float fn = tn(xz * 0.9 + uWaterTime * 0.4) * 0.6 + tn(xz * 3.1 - uWaterTime * 0.7) * 0.4;
    float shoreFoam = smoothstep(0.7, 0.0, d + (fn - 0.5) * 0.55 + sin(uWaterTime * 1.6 + xz.x * 0.4 + xz.y * 0.3) * 0.14);
    shoreFoam *= smoothstep(0.0, 0.05, d);
    float crest = smoothstep(0.32, 0.56, vWave + fn * 0.14);
    float foam = clamp(max(shoreFoam, crest * 0.55), 0.0, 1.0);
    vec3 foamCol = vec3(0.92, 0.97, 1.0) * (ambient * 0.9 + 0.08);
    col = mix(col, foamCol, foam * 0.85);

    float alpha = mix(0.5, 0.96, depthFac);
    alpha = max(alpha, fres);
    alpha = mix(alpha, 1.0, foam * 0.85);
    alpha *= smoothstep(0.0, 0.22, d + 0.04);

    float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFogColor, fog);
    gl_FragColor = vec4(col, alpha);
  }
`;

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
    this.waterMaterial = null;
    this.heightGrid = null;

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

  getNormalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.6;
    const hl = this.getHeightAt(x - e, z);
    const hr = this.getHeightAt(x + e, z);
    const hd = this.getHeightAt(x, z - e);
    const hu = this.getHeightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  // Dynamic wave height sampler (matches the water vertex shader for swimming buoyancy)
  getWaterHeightAt(x, z) {
    const t = this.waterTime;
    const wave1 = Math.sin(x * 0.08 + t * 2.2) * Math.cos(z * 0.06 + t * 1.8) * 0.32;
    const wave2 = Math.sin((x + z) * 0.05 + t * 1.5) * 0.22;
    const wave3 = Math.cos(x * 0.16 - z * 0.12 + t * 2.8) * 0.12;
    return this.waterLevel + wave1 + wave2 + wave3;
  }

  // Marches a ray against the analytic heightfield (far cheaper than raycasting the mesh).
  raycast(origin, direction, maxDist = 300) {
    if (origin.y < this.getHeightAt(origin.x, origin.z)) return null;

    const p = new THREE.Vector3();
    let prevT = 0;
    let t = 0;
    while (t < maxDist) {
      t = Math.min(maxDist, t + 0.6 + t * 0.012);
      p.copy(origin).addScaledVector(direction, t);
      if (p.y <= this.getHeightAt(p.x, p.z)) {
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 10; i++) {
          const mid = (lo + hi) * 0.5;
          p.copy(origin).addScaledVector(direction, mid);
          if (p.y <= this.getHeightAt(p.x, p.z)) hi = mid; else lo = mid;
        }
        p.copy(origin).addScaledVector(direction, hi);
        return { point: p.clone(), distance: hi, normal: this.getNormalAt(p.x, p.z) };
      }
      prevT = t;
    }
    return null;
  }

  initTerrain() {
    const geometry = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position;
    this.heightGrid = new Float32Array(positions.count);

    for (let i = 0; i < positions.count; i++) {
      const y = this.getHeightAt(positions.getX(i), positions.getZ(i));
      positions.setY(i, y);
      this.heightGrid[i] = y;
    }
    geometry.computeVertexNormals();
    geometry.setAttribute('color', new THREE.BufferAttribute(this.computeVertexColors(geometry), 3));

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0.0
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = atmo.uniforms.uTime;
      shader.uniforms.uWaterLevel = { value: this.waterLevel };

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${TERRAIN_FRAGMENT_PARS}`)
        .replace('#include <color_fragment>', /* glsl */`
          #include <color_fragment>
          vec2 wxz = vWPos.xz;
          float nL = tn(wxz * 0.06);
          float nM = tn(wxz * 0.7);
          float nS = tn(wxz * 3.7);
          float nT = tn(wxz * 15.0);
          float streak = tn(vec2(wxz.x * 22.0, wxz.y * 6.0));
          float rockiness = 1.0 - smoothstep(0.6, 0.85, normalize(vWNrm).y);
          float detail = 0.72 + 0.22 * nL + 0.16 * nM + 0.12 * nS + 0.08 * nT;
          detail *= mix(0.9 + 0.2 * streak, 0.85 + 0.3 * nS, rockiness);
          diffuseColor.rgb *= detail;

          // Underwater: tint and animated caustics on the lake bed
          float under = smoothstep(uWaterLevel + 0.3, uWaterLevel - 1.2, vWPos.y);
          float c1 = 1.0 - abs(tn(wxz * 0.55 + vec2(uTime * 0.16, uTime * 0.10)) * 2.0 - 1.0);
          float c2 = 1.0 - abs(tn(wxz * 0.9 - vec2(uTime * 0.12, -uTime * 0.14)) * 2.0 - 1.0);
          float caustic = pow(c1 * c2, 4.0) * 2.5;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.45, 0.8, 0.9), under * 0.8) + vec3(0.1, 0.35, 0.4) * caustic * under;
        `)
        .replace('#include <normal_fragment_maps>', /* glsl */`
          #include <normal_fragment_maps>
          float bumpH = nM * 0.55 + nS * 0.3 + nT * 0.18;
          float bumpFade = 1.0 - smoothstep(18.0, 65.0, length(vViewPosition));
          vec2 dH = vec2(dFdx(bumpH), dFdy(bumpH)) * (0.8 + rockiness * 1.8) * bumpFade;
          normal = perturbNormalDetail(-vViewPosition, normal, dH, faceDirection);
        `);
    };
    material.customProgramCacheKey = () => 'zz-terrain';

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.scene.add(this.mesh);
  }

  computeVertexColors(geometry) {
    const pos = geometry.attributes.position;
    const nrm = geometry.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    const wl = this.waterLevel;

    const cMeadow = new THREE.Color(0x5b9a3c);
    const cForest = new THREE.Color(0x2f5f2b);
    const cDry = new THREE.Color(0x8c9a4b);
    const cDirt = new THREE.Color(0x6e5439);
    const cPath = new THREE.Color(0x7d6a4c);
    const cSand = new THREE.Color(0xd2c08c);
    const cBed = new THREE.Color(0x34545a);
    const cRock = new THREE.Color(0x77736c);
    const cRockDark = new THREE.Color(0x4d4a46);
    const cSnow = new THREE.Color(0xf2f8ff);
    const c = new THREE.Color();
    const rock = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const ny = nrm.getY(i);
      const dist = Math.hypot(x, z);

      const forest = clamp01(smooth(25, 95, dist) * 0.8 + this.noise.noise2D(x * 0.02, z * 0.02) * 0.35);
      c.copy(cMeadow).lerp(cForest, forest);

      const patch = this.noise.noise2D(x * 0.035 + 40, z * 0.035 - 12);
      if (patch > 0.15) c.lerp(cDry, clamp01((patch - 0.15) * 2.2) * 0.65);
      const dirt = this.noise.noise2D(x * 0.07 - 9, z * 0.07 + 31);
      if (dirt > 0.3) c.lerp(cDirt, clamp01((dirt - 0.3) * 2.5) * 0.55);

      // Trampled clearings around the starter camp and the bunker
      const campD = Math.min(dist / 9, Math.hypot(x - 60, z + 40) / 10);
      if (campD < 1) c.lerp(cPath, (1 - campD) * 0.85);

      // Shoreline sand and lake bed
      c.lerp(cSand, smooth(wl + 1.3, wl - 0.1, y) * 0.95);
      c.lerp(cBed, smooth(wl - 0.3, wl - 3.5, y));

      // Cliffs and altitude
      const rockMix = this.noise.noise2D(x * 0.09, z * 0.09) * 0.5 + 0.5;
      rock.copy(cRock).lerp(cRockDark, rockMix * 0.8);
      c.lerp(rock,Math.max(smooth(0.84, 0.64, ny), smooth(14, 24, y) * 0.9));

      const snow = smooth(27 + this.noise.noise2D(x * 0.05, z * 0.05) * 3, 34, y) * (0.35 + 0.65 * smooth(0.55, 0.8, ny));
      c.lerp(cSnow, snow);

      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    return colors;
  }

  initWater() {
    // Bake terrain heights into a half-float texture so the water shader can find the shoreline per pixel.
    const n = this.segments + 1;
    const halfData = new Uint16Array(n * n);
    for (let i = 0; i < this.heightGrid.length; i++) {
      halfData[i] = THREE.DataUtils.toHalfFloat(this.heightGrid[i]);
    }
    const heightTex = new THREE.DataTexture(halfData, n, n, THREE.RedFormat, THREE.HalfFloatType);
    heightTex.minFilter = heightTex.magFilter = THREE.LinearFilter;
    heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
    heightTex.generateMipmaps = false;
    heightTex.needsUpdate = true;

    const waterSize = this.size * 1.35;
    const geo = new THREE.PlaneGeometry(waterSize, waterSize, 200, 200);
    geo.rotateX(-Math.PI / 2);
    geo.deleteAttribute('normal');
    geo.deleteAttribute('uv');

    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...atmo.uniforms,
        uWaterTime: { value: 0 },
        uWaterLevel: { value: this.waterLevel },
        uTerrainSize: { value: this.size },
        uHeightTex: { value: heightTex }
      },
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.waterMesh = new THREE.Mesh(geo, this.waterMaterial);
    this.waterMesh.position.y = this.waterLevel;
    this.waterMesh.frustumCulled = false;
    this.waterMesh.renderOrder = 2;
    this.scene.add(this.waterMesh);
  }

  update(delta) {
    this.waterTime += delta * 1.25;
    this.waterMaterial.uniforms.uWaterTime.value = this.waterTime;
  }
}
