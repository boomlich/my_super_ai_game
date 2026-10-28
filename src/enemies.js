// ZONE ZERO: Valheim Enemy AI, Boss Mechanics & Spikes Trap Defense
import * as THREE from 'three';
import { sounds } from './audio.js';

export class EnemyManager {
  constructor(scene, terrain, survival, building, particles) {
    this.scene = scene;
    this.terrain = terrain;
    this.survival = survival;
    this.building = building;
    this.particles = particles;

    this.enemies = [];
    this.projectiles = [];

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
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.7, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 })
    );
    body.position.y = 0.8;
    body.castShadow = true;
    group.add(body);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.08, 4, 4), eyeMat);
    eyeL.position.set(-0.25, 1.1, 0.85);
    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.08, 4, 4), eyeMat);
    eyeR.position.set(0.25, 1.1, 0.85);
    group.add(eyeL);
    group.add(eyeR);

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
    const group = new THREE.Group();

    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.3, 1.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 })
    );
    torso.position.y = 1.1;
    torso.castShadow = true;
    group.add(torso);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 6, 6),
      new THREE.MeshStandardMaterial({ color: 0x475569 })
    );
    head.position.y = 1.85;
    group.add(head);

    const rifle = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.15, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.8 })
    );
    rifle.position.set(0.3, 1.1, 0.4);
    group.add(rifle);

    const laserMat = new THREE.LineBasicMaterial({ color: 0xff0000 });
    const laserGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0.3, 1.1, 0.8),
      new THREE.Vector3(0.3, 1.1, 20.0)
    ]);
    const laser = new THREE.Line(laserGeo, laserMat);
    group.add(laser);

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
    const group = new THREE.Group();

    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(1.3, 1.0, 3.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.9, metalness: 0.5 })
    );
    torso.position.y = 2.6;
    torso.castShadow = true;
    group.add(torso);

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 1.0, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x172554 })
    );
    head.position.y = 4.4;
    group.add(head);

    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );
    eye.position.set(0, 4.4, 0.55);
    group.add(eye);

    const club = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.55, 4.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 })
    );
    club.position.set(1.5, 2.4, 0.5);
    club.rotation.x = Math.PI * 0.25;
    group.add(club);

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
      const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
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

    this.scene.remove(enemy.mesh);
    this.enemies = this.enemies.filter(e => e !== enemy);
  }

  update(delta, playerPos, worldStructures) {
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
    }
  }

  hurlBoulder(fromPos, toPos) {
    sounds.playMonsterGrowl(true);

    const bGeo = new THREE.DodecahedronGeometry(0.8, 1);
    const bMat = new THREE.MeshStandardMaterial({ color: 0x57534e, roughness: 0.9 });
    const bMesh = new THREE.Mesh(bGeo, bMat);
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
