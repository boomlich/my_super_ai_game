// ZONE ZERO: Valheim Enemy AI, Boss Mechanics & Spikes Trap Defense
import * as THREE from 'three';
import { sounds } from './audio.js';
import { createStalker, createTrooper, createBehemoth, animateEnemy } from './characters.js';
import { buildRockGeometry } from './models.js';

export class EnemyManager {
  constructor(scene, terrain, survival, building, particles) {
    this.scene = scene;
    this.terrain = terrain;
    this.survival = survival;
    this.building = building;
    this.particles = particles;

    this.enemies = [];
    this.projectiles = [];
    this.dying = [];
    this.time = 0;

    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.boulderGeo = buildRockGeometry(11);
    this.boulderMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });

    this.raidActive = false;
    this.raidTimer = 0;
    this.timeUntilNextRaid = 220;

    this.domRaidBanner = document.getElementById('raid-banner');
    this.domRaidTitle = document.getElementById('raid-title');
    this.domRaidSubtitle = document.getElementById('raid-subtitle');
    this.domBossBar = document.getElementById('boss-bar-container');
    this.domBossHp = document.getElementById('boss-hp-fill');
    this.domBossName = document.getElementById('boss-name-label');

    this.spawnInitialPatrols();
  }

  spawnInitialPatrols() {
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2;
      const dist = 45 + Math.random() * 55;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      this.spawnStalker(x, z);
    }

    for (let i = 0; i < 4; i++) {
      this.spawnTrooper(45 + (i * 7), -25 - (i * 5));
    }
  }

  spawnStalker(x, z) {
    const y = this.terrain.getHeightAt(x, z);
    const group = createStalker();
    group.position.set(x, y, z);
    this.scene.add(group);

    this.enemies.push({
      type: 'stalker',
      name: 'Forest Stalker',
      mesh: group,
      hp: 75,
      maxHp: 75,
      speed: 6.8,
      attackDamage: 18,
      attackCooldown: 0,
      attackRange: 2.2,
      targetPos: new THREE.Vector3(x, y, z),
      drops: [{ id: 'raw_meat', count: 1 }]
    });
  }

  spawnTrooper(x, z) {
    const y = this.terrain.getHeightAt(x, z);
    const group = createTrooper();
    group.position.set(x, y, z);
    this.scene.add(group);

    this.enemies.push({
      type: 'trooper',
      name: 'Rogue PMC Trooper',
      mesh: group,
      hp: 100,
      maxHp: 100,
      speed: 4.0,
      shootCooldown: 0,
      attackRange: 32.0,
      targetPos: new THREE.Vector3(x, y, z),
      drops: [{ id: 'ammo_rifle', count: 1 }, { id: 'scrap', count: 2 }]
    });
  }

  spawnIronBehemoth(x, z) {
    const y = this.terrain.getHeightAt(x, z);
    const group = createBehemoth();
    group.position.set(x, y, z);
    this.scene.add(group);

    sounds.playMonsterGrowl(true);

    const behemoth = {
      type: 'behemoth',
      name: 'THE IRON BEHEMOTH',
      mesh: group,
      hp: 850,
      maxHp: 850,
      speed: 4.5,
      attackDamage: 55,
      attackCooldown: 0,
      boulderCooldown: 5.0,
      attackRange: 4.5,
      targetPos: new THREE.Vector3(x, y, z),
      drops: [{ id: 'behemoth_core', count: 1 }, { id: 'raw_meat', count: 3 }, { id: 'scrap', count: 4 }]
    };

    this.enemies.push(behemoth);
    this.showBossBar(behemoth);
    return behemoth;
  }

  showBossBar(boss) {
    if (this.domBossBar) {
      this.domBossBar.style.display = 'flex';
      if (this.domBossName) this.domBossName.textContent = boss.name;
      if (this.domBossHp) this.domBossHp.style.width = '100%';
    }
  }

  hideBossBar() {
    if (this.domBossBar) {
      this.domBossBar.style.display = 'none';
    }
  }

  triggerRaid(playerPos) {
    this.raidActive = true;
    this.raidTimer = 80;

    sounds.playRaidAlarm();

    if (this.domRaidBanner) {
      this.domRaidBanner.style.display = 'block';
      if (this.domRaidTitle) this.domRaidTitle.textContent = 'THE WILDS ARE STIRRING...';
      if (this.domRaidSubtitle) this.domRaidSubtitle.textContent = 'A HOSTILE HORDE & BEHEMOTH ARE ASSAULTING YOUR OUTPOST!';
    }

    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + Math.random() * 0.5;
      const x = playerPos.x + Math.cos(angle) * 42;
      const z = playerPos.z + Math.sin(angle) * 42;
      this.spawnStalker(x, z);
    }

    const bAngle = Math.random() * Math.PI * 2;
    this.spawnIronBehemoth(playerPos.x + Math.cos(bAngle) * 48, playerPos.z + Math.sin(bAngle) * 48);
  }

  endRaid() {
    this.raidActive = false;
    this.timeUntilNextRaid = 280;
    if (this.domRaidBanner) {
      this.domRaidBanner.style.display = 'none';
    }
  }

  damageEnemy(enemy, damage) {
    enemy.hp -= damage;

    if (enemy.type === 'behemoth' && this.domBossHp) {
      const pct = Math.max(0, (enemy.hp / enemy.maxHp) * 100);
      this.domBossHp.style.width = `${pct}%`;
    }

    if (enemy.mesh) {
      const flashMat = this.flashMat;
      enemy.mesh.traverse(child => {
        if (child.isMesh && !child.origMat) {
          child.origMat = child.material;
          child.material = flashMat;
        }
      });
      setTimeout(() => {
        if (enemy.mesh) {
          enemy.mesh.traverse(child => {
            if (child.isMesh && child.origMat) {
              child.material = child.origMat;
              delete child.origMat;
            }
          });
        }
      }, 70);
    }

    if (enemy.hp <= 0) {
      this.killEnemy(enemy);
      return true;
    }
    return false;
  }

  killEnemy(enemy) {
    if (enemy.dead) return;
    enemy.dead = true;
    sounds.playMonsterGrowl(enemy.type === 'behemoth');

    if (enemy.type === 'behemoth') {
      this.hideBossBar();
    }

    if (enemy.drops) {
      for (const d of enemy.drops) {
        window.dispatchEvent(new CustomEvent('enemy_dropped_loot', {
          detail: { pos: enemy.mesh.position.clone(), itemId: d.id, count: d.count }
        }));
      }
    }

    // Hand the corpse to the death animation instead of deleting it instantly
    const big = enemy.type === 'behemoth';
    const p = enemy.mesh.position;
    this.particles.createImpact(new THREE.Vector3(p.x, p.y + (big ? 3 : 1), p.z), new THREE.Vector3(0, 1, 0), 'blood');
    for (let i = 0; i < (big ? 18 : 6); i++) {
      this.particles.spawn({
        x: p.x + (Math.random() - 0.5) * (big ? 3 : 1), y: p.y + 0.2, z: p.z + (Math.random() - 0.5) * (big ? 3 : 1),
        vx: (Math.random() - 0.5) * 1.5, vy: 0.4 + Math.random(), vz: (Math.random() - 0.5) * 1.5,
        life: 1.2 + Math.random() * 0.8, size0: big ? 1.0 : 0.4, size1: big ? 4.0 : 1.6,
        color: 0x6a6258, alpha: 0.35, drag: 1.2, fadeIn: 0.1
      });
    }
    this.dying.push({
      mesh: enemy.mesh,
      t: 0,
      tiltAxis: Math.random() < 0.5 ? 1 : -1,
      big
    });
    this.enemies = this.enemies.filter(e => e !== enemy);
  }

  // Enemy models own their geometry and materials, so free the GPU memory once a corpse is gone
  disposeModel(root) {
    root.traverse((child) => {
      child.geometry?.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) if (m && m !== this.flashMat) m.dispose();
    });
  }

  updateDying(delta) {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.t += delta;
      const fall = Math.min(1, d.t / (d.big ? 1.1 : 0.45));
      const eased = 1 - Math.pow(1 - fall, 3);
      d.mesh.rotation.z = d.tiltAxis * eased * Math.PI * 0.5;
      if (d.t > 2.0) d.mesh.position.y -= delta * (d.big ? 1.6 : 0.9);
      if (d.t > 3.2) {
        this.scene.remove(d.mesh);
        this.disposeModel(d.mesh);
        this.dying.splice(i, 1);
      }
    }
  }

  update(delta, playerPos, worldStructures) {
    this.time += delta;
    this.updateDying(delta);

    if (!this.raidActive) {
      this.timeUntilNextRaid -= delta;
      if (this.timeUntilNextRaid <= 0) {
        this.triggerRaid(playerPos);
      }
    } else {
      this.raidTimer -= delta;
      if (this.raidTimer <= 0) {
        this.endRaid();
      }
    }

    // Update Boulders
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.vel.y -= 14.0 * delta;
      p.mesh.position.addScaledVector(p.vel, delta);
      p.mesh.rotation.x += 4.0 * delta;
      p.mesh.rotation.z += 2.5 * delta;
      this.particles.spawn({
        x: p.mesh.position.x, y: p.mesh.position.y, z: p.mesh.position.z,
        vx: (Math.random() - 0.5) * 0.4, vy: 0.2, vz: (Math.random() - 0.5) * 0.4,
        life: 0.8, size0: 0.3, size1: 1.0, color: 0x6a6258, alpha: 0.3, drag: 1.5, fadeIn: 0.1
      });

      const groundY = this.terrain.getHeightAt(p.mesh.position.x, p.mesh.position.z);
      if (p.mesh.position.y <= groundY + 0.5) {
        sounds.playTreeFall();
        this.particles.createExplosionFX(p.mesh.position);

        if (p.mesh.position.distanceTo(playerPos) < 6.0) {
          this.survival.takeDamage(35);
        }

        if (worldStructures) {
          for (const s of worldStructures) {
            if (s.position.distanceTo(p.mesh.position) < 6.0) {
              this.building.damageStructure(s, 120);
            }
          }
        }

        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }

    // Update Enemies
    for (const enemy of this.enemies) {
      const pos = enemy.mesh.position;
      const distToPlayer = pos.distanceTo(playerPos);
      if (enemy.prevX === undefined) {
        enemy.prevX = pos.x;
        enemy.prevZ = pos.z;
      }

      // Check defensive metal spikes trap damage!
      if (worldStructures) {
        for (const s of worldStructures) {
          if (s.type === 'metal_spikes' && s.position.distanceTo(pos) < 2.0) {
            this.damageEnemy(enemy, 35 * delta);
            this.particles.createImpact(pos, new THREE.Vector3(0, 1, 0), 'sparks');
          }
        }
      }

      enemy.mesh.lookAt(playerPos.x, pos.y, playerPos.z);

      if (enemy.type === 'stalker') {
        if (distToPlayer > enemy.attackRange) {
          const moveDir = new THREE.Vector3().subVectors(playerPos, pos).normalize();
          pos.addScaledVector(moveDir, enemy.speed * delta);
        } else {
          enemy.attackCooldown -= delta;
          if (enemy.attackCooldown <= 0) {
            enemy.attackCooldown = 1.4;
            this.survival.takeDamage(enemy.attackDamage);
            sounds.playMonsterGrowl(false);
          }
        }
      } else if (enemy.type === 'trooper') {
        if (distToPlayer > 18) {
          const moveDir = new THREE.Vector3().subVectors(playerPos, pos).normalize();
          pos.addScaledVector(moveDir, enemy.speed * delta);
        } else if (distToPlayer < 9) {
          const retreatDir = new THREE.Vector3().subVectors(pos, playerPos).normalize();
          pos.addScaledVector(retreatDir, enemy.speed * 0.8 * delta);
        }

        enemy.shootCooldown -= delta;
        if (enemy.shootCooldown <= 0 && distToPlayer < enemy.attackRange) {
          enemy.shootCooldown = 2.0;
          sounds.playRifleShot();
          if (Math.random() < 0.45) {
            this.survival.takeDamage(14);
          }
        }
      } else if (enemy.type === 'behemoth') {
        enemy.boulderCooldown -= delta;
        if (enemy.boulderCooldown <= 0 && distToPlayer > 12 && distToPlayer < 45) {
          enemy.boulderCooldown = 8.0;
          this.hurlBoulder(pos, playerPos);
        }

        if (worldStructures && worldStructures.length > 0) {
          for (const s of worldStructures) {
            if (s.position.distanceTo(pos) < 5.2) {
              enemy.attackCooldown -= delta;
              if (enemy.attackCooldown <= 0) {
                enemy.attackCooldown = 2.0;
                this.building.damageStructure(s, 120);
                sounds.playTreeFall();
                this.particles.createShockwave(pos, 8, 0xef4444);
              }
              break;
            }
          }
        }

        if (distToPlayer > enemy.attackRange) {
          const moveDir = new THREE.Vector3().subVectors(playerPos, pos).normalize();
          pos.addScaledVector(moveDir, enemy.speed * delta);
        } else {
          enemy.attackCooldown -= delta;
          if (enemy.attackCooldown <= 0) {
            enemy.attackCooldown = 2.4;
            this.survival.takeDamage(enemy.attackDamage);
            sounds.playTreeFall();
            this.particles.createShockwave(pos, 10, 0xef4444);
          }
        }
      }

      pos.y = this.terrain.getHeightAt(pos.x, pos.z);

      const moved = Math.hypot(pos.x - enemy.prevX, pos.z - enemy.prevZ);
      enemy.prevX = pos.x;
      enemy.prevZ = pos.z;
      animateEnemy(enemy, delta, delta > 0 ? moved / delta : 0, this.time);
    }
  }

  hurlBoulder(fromPos, toPos) {
    sounds.playMonsterGrowl(true);

    const bMesh = new THREE.Mesh(this.boulderGeo, this.boulderMat);
    bMesh.castShadow = true;
    bMesh.scale.setScalar(0.85);
    bMesh.position.set(fromPos.x, fromPos.y + 4.0, fromPos.z);
    this.scene.add(bMesh);

    const dir = new THREE.Vector3().subVectors(toPos, fromPos).normalize();
    const vel = dir.multiplyScalar(22.0);
    vel.y += 6.0;

    this.projectiles.push({
      mesh: bMesh,
      vel: vel
    });
  }
}
