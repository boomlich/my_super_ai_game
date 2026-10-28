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

// Raises the interior so the map is one landmass with a lake and coastline instead of many islands
export const HEIGHT_LIFT = 6;
export const CAMP_HEIGHT = 5.0;

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

// Directional waves: [heading (rad), wavelength (m), amplitude (m), choppiness]. The same table drives the
// vertex shader and Terrain.getWaterHeightAt(), so swimming buoyancy follows the visible surface.
const WAVE_SET = [
  [0.35, 46, 0.62, 0.55],
  [1.15, 29, 0.4, 0.5],
  [-0.55, 18, 0.26, 0.6],
  [2.1, 11.5, 0.15, 0.6],
  [-1.4, 7.2, 0.085, 0.6],
  [0.8, 4.6, 0.05, 0.5],
  [-2.4, 3.1, 0.03, 0.4]
].map(([heading, length, amp, steep]) => {
  const k = (Math.PI * 2) / length;
  return { dx: Math.cos(heading), dz: Math.sin(heading), k, w: Math.sqrt(9.8 * k) * 0.85, amp: amp * 0.72, steep, length };
});
const WAVE_AMP_SUM = WAVE_SET.reduce((sum, w) => sum + w.amp, 0);

const waveA = WAVE_SET.map(w => `vec4(${w.dx.toFixed(5)}, ${w.dz.toFixed(5)}, ${w.k.toFixed(5)}, ${w.w.toFixed(5)})`).join(', ');
const waveB = WAVE_SET.map(w => `vec3(${w.amp.toFixed(4)}, ${w.steep.toFixed(3)}, ${w.length.toFixed(2)})`).join(', ');

const SHORE_NEAR = 0.15;
const SHORE_FAR = 3.2;

const WATER_VERTEX = /* glsl */`
  uniform float uWaterTime, uWaterLevel, uTerrainSize, uOvercast;
  uniform sampler2D uHeightTex;
  varying vec3 vWPos;
  varying vec3 vNrm;
  varying float vWave;
  varying float vCrest;
  varying float vSteep;

  const int WAVE_COUNT = ${WAVE_SET.length};
  const vec4 WAVE_A[WAVE_COUNT] = vec4[WAVE_COUNT](${waveA});
  const vec3 WAVE_B[WAVE_COUNT] = vec3[WAVE_COUNT](${waveB});
  const float AMP_SUM = ${WAVE_AMP_SUM.toFixed(4)};

  // Gerstner-style sum: height, slope and the horizontal pull that sharpens crests.
  void waveField(vec2 p, float t, float ampMul, float camDist, out float h, out vec2 grad, out vec2 disp) {
    h = 0.0;
    grad = vec2(0.0);
    disp = vec2(0.0);
    for (int i = 0; i < WAVE_COUNT; i++) {
      vec4 A = WAVE_A[i];
      vec3 B = WAVE_B[i];
      // Short waves fade out with distance so the coarse far mesh never aliases
      float lod = 1.0 - smoothstep(B.z * 7.0, B.z * 16.0, camDist);
      float a = B.x * ampMul * lod;
      float phase = dot(A.xy, p) * A.z - A.w * t;
      float s = sin(phase);
      float c = cos(phase);
      h += a * s;
      grad += A.xy * (a * A.z * c);
      disp += A.xy * (B.y * a * c);
    }
  }

  void main() {
    vec4 base = modelMatrix * vec4(position, 1.0);
    vec2 p = base.xz;

    // Waves die down in shallows so they never clip through the shoreline
    float th = texture2D(uHeightTex, p / uTerrainSize + 0.5).r;
    float depth = uWaterLevel - th;
    float ampMul = mix(0.1, 1.0, smoothstep(${SHORE_NEAR.toFixed(2)}, ${SHORE_FAR.toFixed(2)}, depth)) * (1.0 + 0.9 * uOvercast);

    float camDist = length(cameraPosition.xz - p);
    float h;
    vec2 grad;
    vec2 disp;
    waveField(p, uWaterTime, ampMul, camDist, h, grad, disp);

    vec3 world = vec3(p.x + disp.x, uWaterLevel + h, p.y + disp.y);
    vWPos = world;
    vWave = h;
    vCrest = h / max(AMP_SUM * ampMul, 0.12);
    vSteep = length(grad);
    vNrm = normalize(vec3(-grad.x, 1.0, -grad.y));
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
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
  varying float vCrest;
  varying float vSteep;
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
    body *= 0.8 + 0.35 * clamp(vCrest * 0.5 + 0.5, 0.0, 1.0);
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
    float crest = smoothstep(0.62, 0.98, vCrest + (fn - 0.5) * 0.3) * smoothstep(0.12, 0.3, vSteep);
    float foam = clamp(max(shoreFoam, crest * 0.8), 0.0, 1.0);
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
    this.buildWalkGrid();
    this.initWater();
  }

  // Flood-fills dry, not-too-steep ground outward from the starter camp. Spawns and deposits use it so nothing is
  // placed on an island the player (or the enemies) can never reach on foot.
  buildWalkGrid(cell = 5) {
    const half = Math.floor(this.size / 2 / cell);
    const n = half * 2 + 1;
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) heights[j * n + i] = this.getHeightAt((i - half) * cell, (j - half) * cell);
    }
    const reach = new Uint8Array(n * n);
    const stack = [half * n + half];
    reach[half * n + half] = 1;
    const wet = this.waterLevel + 0.2;
    while (stack.length) {
      const idx = stack.pop();
      const i = idx % n;
      const j = (idx - i) / n;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const k = nj * n + ni;
        if (reach[k] || heights[k] < wet || Math.abs(heights[k] - heights[idx]) / cell > 1.3) continue;
        reach[k] = 1;
        stack.push(k);
      }
    }
    this.walk = { cell, half, n, reach };
  }

  isWalkable(x, z) {
    const w = this.walk;
    const i = Math.round(x / w.cell) + w.half;
    const j = Math.round(z / w.cell) + w.half;
    return i >= 0 && j >= 0 && i < w.n && j < w.n && w.reach[j * w.n + i] === 1;
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
    height += HEIGHT_LIFT * (1 - smooth(rad * 0.5, rad * 0.8, dist));

    // Lake depression in South-East quadrant
    const lakeDist = Math.hypot(x - 80, z - 70);
    if (lakeDist < 60) {
      const lakeFactor = Math.cos((lakeDist / 60) * (Math.PI * 0.5));
      height -= lakeFactor * 8.5; // Deeper lake for true swimming!
    }

    if (dist < 40) {
      const flatten = 1 - (dist / 40);
      height = height * (1 - flatten) + CAMP_HEIGHT * flatten;
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

  // Mirrors the water vertex shader (heights only) so swimming and splashes sit on the visible surface
  getWaterHeightAt(x, z) {
    const t = this.waterTime;
    const depth = this.waterLevel - this.getHeightAt(x, z);
    const shore = 0.1 + 0.9 * smooth(SHORE_NEAR, SHORE_FAR, depth);
    const ampMul = shore * (1 + 0.9 * atmo.uniforms.uOvercast.value);
    let h = 0;
    for (const w of WAVE_SET) {
      h += w.amp * ampMul * Math.sin((w.dx * x + w.dz * z) * w.k - w.w * t);
    }
    return this.waterLevel + h;
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
      c.lerp(rock, Math.max(smooth(0.84, 0.64, ny), smooth(14 + HEIGHT_LIFT, 24 + HEIGHT_LIFT, y) * 0.9));

      const snow = smooth(27 + HEIGHT_LIFT + this.noise.noise2D(x * 0.05, z * 0.05) * 3, 34 + HEIGHT_LIFT, y) * (0.35 + 0.65 * smooth(0.55, 0.8, ny));
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

    const geo = this.buildWaterGeometry();

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
    this.waterMesh.frustumCulled = false;
    this.waterMesh.renderOrder = 2;
    this.scene.add(this.waterMesh);
  }

  // Polar grid centred on the camera: ~0.7 m cells next to the player, stretching to the horizon
  buildWaterGeometry() {
    const rings = 150;
    const segs = 256;
    const maxR = 720;
    const positions = new Float32Array((rings + 1) * segs * 3);
    for (let i = 0; i <= rings; i++) {
      const r = maxR * Math.pow(i / rings, 2.2);
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const o = (i * segs + j) * 3;
        positions[o] = Math.cos(a) * r;
        positions[o + 1] = 0;
        positions[o + 2] = Math.sin(a) * r;
      }
    }
    const indices = new Uint32Array(rings * segs * 6);
    let n = 0;
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = i * segs + j;
        const b = i * segs + ((j + 1) % segs);
        const c = (i + 1) * segs + j;
        const d = (i + 1) * segs + ((j + 1) % segs);
        indices[n++] = a; indices[n++] = c; indices[n++] = b;
        indices[n++] = b; indices[n++] = c; indices[n++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }

  update(delta, focus = null) {
    this.waterTime += delta * 1.25;
    this.waterMaterial.uniforms.uWaterTime.value = this.waterTime;
    if (focus) this.waterMesh.position.set(focus.x, 0, focus.z);
  }
}
