// ZONE ZERO: Procedural sky dome (gradient, sun, moon, stars, clouds) + shared atmosphere uniforms
import * as THREE from 'three';

function makeSkyUniforms() {
  return {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uSunColor: { value: new THREE.Color(0xfff1d6) },
    uZenith: { value: new THREE.Color(0x2f6fd0) },
    uHorizon: { value: new THREE.Color(0xa5cdf0) },
    uGround: { value: new THREE.Color(0x2d3a2b) },
    uFogColor: { value: new THREE.Color(0xa5cdf0) },
    uFogDensity: { value: 0.006 },
    uDay: { value: 1 },
    uNight: { value: 0 },
    uCloud: { value: 0.45 },
    uOvercast: { value: 0 },
    uTime: { value: 0 }
  };
}

// Uniform objects shared between the sky, terrain, vegetation and water so the weather
// system only has to update one place.
export const atmo = { uniforms: makeSkyUniforms() };

const skyVertex = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */`
  varying vec3 vDir;
  uniform vec3 uSunDir, uMoonDir, uSunColor, uZenith, uHorizon, uGround;
  uniform float uDay, uNight, uCloud, uOvercast, uTime;

  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float hash31(vec3 p) { p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    float h = max(y, 0.0);

    vec3 col = mix(uHorizon, uZenith, pow(h, 0.5));
    col = mix(col, uHorizon, exp(-h * 7.0) * 0.4);
    if (y < 0.0) col = mix(uHorizon, uGround, smoothstep(0.0, 0.22, -y));

    float sd = max(dot(d, uSunDir), 0.0);
    float sunUp = smoothstep(-0.14, 0.04, uSunDir.y);
    float clear = 1.0 - uOvercast * 0.85;

    // Atmospheric scattering glow + sun disc (HDR so bloom picks it up)
    col += uSunColor * (pow(sd, 4.0) * 0.16 + pow(sd, 36.0) * 0.4) * sunUp * clear;
    col += uSunColor * (smoothstep(0.99955, 0.99985, sd) * 28.0 + pow(sd, 700.0) * 4.0) * sunUp * clear;

    // Moon with faint maria
    float md = dot(d, uMoonDir);
    float moonDisc = smoothstep(0.99900, 0.99935, md);
    float maria = 0.65 + 0.35 * vnoise((d.xz + d.y) * 55.0);
    col += vec3(0.78, 0.86, 1.0) * moonDisc * maria * 1.8 * uNight * clear;
    col += vec3(0.35, 0.45, 0.8) * pow(max(md, 0.0), 80.0) * 0.28 * uNight * clear;

    // Stars
    vec3 sp = d * 240.0;
    vec3 ip = floor(sp);
    vec3 fp = fract(sp) - 0.5;
    float hs = hash31(ip);
    vec3 jit = (vec3(hash31(ip + 3.1), hash31(ip + 7.7), hash31(ip + 11.3)) - 0.5) * 0.6;
    float star = step(0.9965, hs) * smoothstep(0.35, 0.0, length(fp - jit));
    float twinkle = 0.65 + 0.35 * sin(uTime * 3.0 + hs * 100.0);
    col += vec3(0.8, 0.9, 1.0) * star * twinkle * 2.2 * uNight * smoothstep(0.0, 0.12, y) * clear;

    // Clouds projected on a flat layer
    if (y > 0.004) {
      vec2 uv = d.xz / (y + 0.14) * 0.55 + vec2(uTime * 0.012, uTime * 0.005);
      float f = fbm(uv);
      float thr = 1.0 - uCloud;
      float dens = smoothstep(thr, thr + 0.26, f);
      vec2 toSun = normalize(uSunDir.xz + vec2(1e-4)) * 0.07;
      float f2 = fbm(uv + toSun);
      float shade = clamp((f - f2) * 4.5 + 0.55, 0.0, 1.0);

      vec3 lit = mix(uHorizon * 0.9, uSunColor, 0.65) * 1.15;
      vec3 shadow = uZenith * 0.5 + uHorizon * 0.25;
      vec3 ccol = mix(shadow, lit, shade);
      ccol = mix(ccol, vec3(0.34, 0.37, 0.41) * (0.25 + 0.75 * uDay), uOvercast * 0.7);
      ccol *= mix(0.16, 1.0, uDay);

      float fade = smoothstep(0.0, 0.2, y);
      col = mix(col, ccol, dens * fade * 0.95);
      col += uSunColor * dens * pow(sd, 9.0) * 0.55 * sunUp * fade * clear;
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class SkyDome {
  constructor(uniforms = atmo.uniforms) {
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 40, 24), this.material);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
  }

  follow(cameraPos) {
    this.mesh.position.copy(cameraPos);
  }
}

// Bakes a neutral midday sky into a PMREM so metals and glossy surfaces get believable reflections.
export function buildEnvironment(renderer) {
  const u = makeSkyUniforms();
  u.uSunDir.value.set(0.4, 0.8, 0.3).normalize();
  u.uCloud.value = 0.5;
  const envScene = new THREE.Scene();
  envScene.add(new SkyDome(u).mesh);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(envScene, 0, 0.1, 1500);
  pmrem.dispose();
  return target.texture;
}
