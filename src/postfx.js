// ZONE ZERO: Post-processing chain (MSAA HDR render -> bloom -> ACES tone map -> cinematic grade)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Runs in display space after tone mapping: vignette, chromatic aberration, grain,
// underwater distortion, damage flash and sniper-scope masking.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uVignette: { value: 0.36 },
    uGrain: { value: 0.035 },
    uAberration: { value: 0.0005 },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.06 },
    uTint: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
    uUnderwater: { value: 0 },
    uDamage: { value: 0 },
    uScope: { value: 0 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uAspect, uVignette, uGrain, uAberration, uSaturation, uContrast, uUnderwater, uDamage, uScope;
    uniform vec3 uTint;
    varying vec2 vUv;

    float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p + 19.19); return fract(p.x * p.y); }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // Water distortion while submerged
      uv += uUnderwater * vec2(sin(uv.y * 24.0 + uTime * 2.2), cos(uv.x * 20.0 + uTime * 1.8)) * 0.0045;

      // Chromatic aberration grows toward the screen edge
      float ab = uAberration * (1.0 + r2 * 5.0) + uUnderwater * 0.0012;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ab * 2.0).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ab * 2.0).b;

      // Colour grade
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      col *= uTint;

      // Underwater absorption
      col = mix(col, col * vec3(0.35, 0.8, 0.9) + vec3(0.0, 0.05, 0.07), uUnderwater * 0.7);

      // Vignette
      col *= 1.0 - smoothstep(0.18, 0.85, r2 * 1.9) * uVignette;

      // Damage flash
      float edge = smoothstep(0.05, 0.45, r2);
      col = mix(col, vec3(0.75, 0.04, 0.02), uDamage * (0.18 + edge * 0.55));

      // Sniper scope mask
      if (uScope > 0.001) {
        vec2 p = c * vec2(uAspect, 1.0);
        float d = length(p);
        float mask = smoothstep(0.34, 0.345, d);
        col = mix(col, vec3(0.0), mask * uScope);
        float ring = smoothstep(0.004, 0.0, abs(d - 0.335));
        float hair = smoothstep(0.0012, 0.0, min(abs(p.x), abs(p.y))) * step(d, 0.335);
        col = mix(col, vec3(0.02), (ring * 0.6 + hair * 0.75) * uScope);
      }

      // Film grain
      float g = hash(vUv * 1000.0 + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `
};

export class PostFX {
  constructor(renderer, scene, camera, { quality = 'high' } = {}) {
    this.renderer = renderer;
    this.quality = quality;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();

    const target = new THREE.WebGLRenderTarget(Math.max(1, size.x * pr), Math.max(1, size.y * pr), {
      type: THREE.HalfFloatType,
      samples: quality === 'low' ? 0 : 4
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(size.x, size.y);

    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = null;
    if (quality !== 'low') {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.65, 1.0);
      this.composer.addPass(this.bloom);
    }

    this.composer.addPass(new OutputPass());

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.uniforms = this.grade.uniforms;
    this.uniforms.uAspect.value = size.x / size.y;
  }

  setSize(width, height) {
    this.composer.setSize(width, height);
    this.uniforms.uAspect.value = width / height;
  }

  render(delta, time) {
    this.uniforms.uTime.value = time;
    this.composer.render(delta);
  }
}
