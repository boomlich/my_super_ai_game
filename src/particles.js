// ZONE ZERO: Tactical FX, Tracers, Shockwaves, Water Splashes & Damage Numbers
import * as THREE from 'three';

export class ParticleManager {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.tracers = [];
    this.casings = [];
    this.shockwaves = [];
    this.damageNumbers = [];

    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));

    this.casingGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.06, 4);
    this.casingMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.9, roughness: 0.2 });
  }

  // Water Splash Effect (Bubbles, Foam, Droplets)
  createWaterSplash(pos, size = 1.0) {
    this.createShockwave(pos, 3.5 * size, 0x38bdf8);

    const count = Math.round(16 * size);
    for (let i = 0; i < count; i++) {
      const pMat = new THREE.PointsMaterial({
        color: i % 2 === 0 ? 0xecfeff : 0x38bdf8,
        size: 0.18 * size,
        transparent: true,
        opacity: 0.85
      });
      const p = new THREE.Points(this.sparkGeo, pMat);
      p.position.copy(pos);

      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 2.5;
      const vel = new THREE.Vector3(
        Math.cos(angle) * speed,
        2.5 + Math.random() * 3.5,
        Math.sin(angle) * speed
      );

      this.scene.add(p);
      this.particles.push({
        mesh: p,
        velocity: vel,
        life: 0.4 + Math.random() * 0.3,
        maxLife: 0.7
      });
    }
  }

  // Rising Underwater Air Bubbles
  createUnderwaterBubbles(pos, count = 5) {
    for (let i = 0; i < count; i++) {
      const pMat = new THREE.PointsMaterial({
        color: i % 2 === 0 ? 0xffffff : 0xbae6fd,
        size: 0.12 + Math.random() * 0.1,
        transparent: true,
        opacity: 0.75
      });
      const p = new THREE.Points(this.sparkGeo, pMat);
      p.position.set(
        pos.x + (Math.random() - 0.5) * 0.9,
        pos.y - 0.3 - Math.random() * 0.4,
        pos.z + (Math.random() - 0.5) * 0.9
      );
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 0.4,
        1.2 + Math.random() * 0.8,
        (Math.random() - 0.5) * 0.4
      );
      this.scene.add(p);
      this.particles.push({
        mesh: p,
        velocity: vel,
        life: 0.9 + Math.random() * 0.6,
        maxLife: 1.5,
        isBubble: true
      });
    }
  }

  createDamageNumber(pos, amount, isCrit = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    ctx.font = isCrit ? 'bold 44px sans-serif' : 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#000000';
    ctx.fillText(`${Math.round(amount)}${isCrit ? '!' : ''}`, 66, 34);

    ctx.fillStyle = isCrit ? '#fef08a' : '#ffffff';
    ctx.fillText(`${Math.round(amount)}${isCrit ? '!' : ''}`, 64, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.8, (Math.random() - 0.5) * 0.4));
    sprite.scale.set(isCrit ? 1.4 : 1.0, isCrit ? 0.7 : 0.5, 1.0);

    this.scene.add(sprite);
    this.damageNumbers.push({
      sprite: sprite,
      life: 0.85,
      maxLife: 0.85,
      velY: 1.6
    });
  }

  createShockwave(pos, maxRadius = 12, color = 0x38bdf8) {
    const ringGeo = new THREE.RingGeometry(0.2, 0.6, 24);
    ringGeo.rotateX(-Math.PI / 2);

    const ringMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(ringGeo, ringMat);
    mesh.position.copy(pos);
    mesh.position.y += 0.08;
    this.scene.add(mesh);

    this.shockwaves.push({
      mesh: mesh,
      radius: 0.4,
      maxRadius: maxRadius,
      life: 0.65,
      maxLife: 0.65
    });
  }

  createTracer(start, end) {
    const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
    const mat = new THREE.LineBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);

    this.tracers.push({
      mesh: line,
      life: 0.06
    });
  }

  createExplosionFX(pos) {
    this.createShockwave(pos, 16, 0xf97316);

    for (let i = 0; i < 28; i++) {
      const isSmoke = i > 12;
      const color = isSmoke ? 0x334155 : (i % 2 === 0 ? 0xf97316 : 0xfde047);
      const pMat = new THREE.PointsMaterial({
        color: color,
        size: isSmoke ? 0.6 : 0.4,
        transparent: true,
        opacity: 0.8
      });
      const p = new THREE.Points(this.sparkGeo, pMat);
      p.position.copy(pos);

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 12.0,
        3.0 + Math.random() * 8.0,
        (Math.random() - 0.5) * 12.0
      );

      this.scene.add(p);
      this.particles.push({
        mesh: p,
        velocity: vel,
        life: 0.5 + Math.random() * 0.4,
        maxLife: 0.9
      });
    }
  }

  createImpact(pos, normal, type = 'sparks') {
    const count = type === 'wood' ? 14 : (type === 'blood' ? 10 : 8);
    const color = type === 'wood' ? 0x854d0e : (type === 'blood' ? 0xb91c1c : 0xfbbf24);

    for (let i = 0; i < count; i++) {
      const pMat = new THREE.PointsMaterial({ color: color, size: type === 'wood' ? 0.25 : 0.16 });
      const p = new THREE.Points(this.sparkGeo, pMat);
      p.position.copy(pos);

      const vel = normal.clone().multiplyScalar(2.0 + Math.random() * 4.0);
      vel.x += (Math.random() - 0.5) * 3.5;
      vel.y += (Math.random() - 0.5) * 3.5;
      vel.z += (Math.random() - 0.5) * 3.5;

      this.scene.add(p);
      this.particles.push({
        mesh: p,
        velocity: vel,
        life: 0.25 + Math.random() * 0.25,
        maxLife: 0.5
      });
    }
  }

  ejectCasing(pos, gunRight) {
    const casing = new THREE.Mesh(this.casingGeo, this.casingMat);
    casing.position.copy(pos);

    const vel = gunRight.clone().multiplyScalar(1.8 + Math.random() * 0.8);
    vel.y += 1.2 + Math.random() * 0.5;

    this.scene.add(casing);
    this.casings.push({
      mesh: casing,
      vel: vel,
      rotVel: new THREE.Vector3(Math.random() * 20, Math.random() * 20, Math.random() * 20),
      life: 2.5
    });
  }

  update(delta) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= delta;
      if (t.life <= 0) {
        this.scene.remove(t.mesh);
        this.tracers.splice(i, 1);
      }
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.life -= delta;
      const progress = 1 - (s.life / s.maxLife);
      const curRadius = s.maxRadius * progress;
      s.mesh.scale.set(curRadius, curRadius, 1);
      s.mesh.material.opacity = Math.max(0, 1 - progress);

      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        this.shockwaves.splice(i, 1);
      }
    }

    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const dn = this.damageNumbers[i];
      dn.life -= delta;
      dn.sprite.position.y += dn.velY * delta;
      dn.velY *= 0.95;
      const opacity = Math.max(0, dn.life / dn.maxLife);
      dn.sprite.material.opacity = opacity;

      if (dn.life <= 0) {
        this.scene.remove(dn.sprite);
        this.damageNumbers.splice(i, 1);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= delta;

      if (p.isBubble) {
        // Buoyant upward float with slight water current drift
        p.velocity.y = Math.min(2.5, p.velocity.y + 0.5 * delta);
        p.velocity.x += (Math.random() - 0.5) * 0.2 * delta;
        p.velocity.z += (Math.random() - 0.5) * 0.2 * delta;
      } else {
        p.velocity.y -= 9.8 * delta;
      }

      p.mesh.position.addScaledVector(p.velocity, delta);

      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
      }
    }

    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.life -= delta;
      c.vel.y -= 12.0 * delta;
      c.mesh.position.addScaledVector(c.vel, delta);
      c.mesh.rotation.x += c.rotVel.x * delta;
      c.mesh.rotation.y += c.rotVel.y * delta;

      if (c.life <= 0) {
        this.scene.remove(c.mesh);
        this.casings.splice(i, 1);
      }
    }
  }
}
