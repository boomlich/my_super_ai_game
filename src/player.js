// ZONE ZERO: Modern FPS Controller, Tactical Ballistics, Grenades & Swimming Engine
import * as THREE from 'three';
import { sounds } from './audio.js';

export class PlayerController {
  constructor(camera, scene, terrain, survival, inventory, building, enemies, worldManager, particles) {
    this.camera = camera;
    this.scene = scene;
    this.terrain = terrain;
    this.survival = survival;
    this.inventory = inventory;
    this.building = building;
    this.enemies = enemies;
    this.world = worldManager;
    this.particles = particles;

    this.position = new THREE.Vector3(0, 5, 0);
    this.velocity = new THREE.Vector3();
    this.isGrounded = false;
    this.isCrouching = false;
    this.isSprinting = false;
    this.isADS = false;

    // Swimming & Aquatic State
    this.isSwimming = false;
    this.isUnderwater = false;
    this.swimTimer = 0;
    this.drowningTimer = 0;

    this.pitch = 0;
    this.yaw = 0;
    this.mouseSensitivity = 0.0022;
    this.screenShake = 0;

    this.bobTimer = 0;
    this.swayOffset = new THREE.Vector2();

    this.activeGrenades = [];

    this.currentSlot = 0;
    this.weapons = [
      {
        name: 'M4A1 CARBINE',
        type: 'rifle',
        clip: 30,
        maxClip: 30,
        fireRate: 0.095,
        damage: 36,
        spread: 0.02,
        recoilKick: 0.038,
        auto: true,
        ammoType: 'ammo_rifle'
      },
      {
        name: 'SPAS-12 SHOTGUN',
        type: 'shotgun',
        clip: 8,
        maxClip: 8,
        fireRate: 0.8,
        damage: 24,
        spread: 0.07,
        recoilKick: 0.12,
        auto: false,
        ammoType: 'ammo_shotgun'
      },
      {
        name: 'AWM SNIPER',
        type: 'sniper',
        clip: 5,
        maxClip: 5,
        fireRate: 1.35,
        damage: 190,
        spread: 0.002,
        recoilKick: 0.16,
        auto: false,
        ammoType: 'ammo_sniper'
      },
      {
        name: 'TACTICAL HAMMER',
        type: 'hammer',
        clip: '—',
        maxClip: '—',
        fireRate: 0.35,
        damage: 10,
        auto: false
      },
      {
        name: 'TACTICAL HATCHET',
        type: 'axe',
        clip: '—',
        maxClip: '—',
        fireRate: 0.45,
        damage: 45,
        auto: false
      }
    ];

    this.fireTimer = 0;
    this.isReloading = false;
    this.recoilOffset = new THREE.Vector3();

    this.weaponGroup = new THREE.Group();
    this.camera.add(this.weaponGroup);
    this.weaponMesh = null;
    this.slideMesh = null;
    this.muzzleLight = null;

    this.keys = {};
    this.mouseDown = false;
    this.isLocked = false;

    this.domAmmoClip = document.getElementById('ammo-clip');
    this.domAmmoReserve = document.getElementById('ammo-reserve');
    this.domWeaponName = document.getElementById('weapon-name');
    this.domFireMode = document.getElementById('fire-mode');
    this.domHitMarker = document.getElementById('hit-marker');
    this.domCompassTape = document.getElementById('compass-tape');
    this.domCompassObj = document.getElementById('compass-objective');
    this.domInteractPrompt = document.getElementById('interact-prompt');
    this.domInteractText = document.getElementById('interact-text');
    this.domUnderwaterTint = document.getElementById('underwater-tint');
    this.domBadgeSwimming = document.getElementById('badge-swimming');
    this.domBadgeUnderwater = document.getElementById('badge-underwater');

    this.hotbarSlots = document.querySelectorAll('.hotbar-slot');

    this.initControls();
    this.initCompassTape();
    this.switchWeapon(0);
  }

  initControls() {
    const canvas = document.getElementById('game-canvas');
    canvas.addEventListener('click', () => {
      sounds.resume();
      if (!this.isLocked && !this.inventory.isOpen && !this.building.isMenuModalOpen) {
        canvas.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === canvas;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;
      const sens = this.isADS ? this.mouseSensitivity * 0.5 : this.mouseSensitivity;
      this.yaw -= e.movementX * sens;
      this.pitch -= e.movementY * sens;
      this.pitch = Math.max(-Math.PI * 0.48, Math.min(Math.PI * 0.48, this.pitch));

      this.swayOffset.x = Math.max(-0.04, Math.min(0.04, this.swayOffset.x - e.movementX * 0.0003));
      this.swayOffset.y = Math.max(-0.04, Math.min(0.04, this.swayOffset.y - e.movementY * 0.0003));
    });

    window.addEventListener('mousedown', (e) => {
      if (!this.isLocked) return;
      sounds.resume();
      if (e.button === 0) {
        this.mouseDown = true;
        this.onPrimaryAction();
      } else if (e.button === 2) {
        if (this.currentSlot === 3) {
          // Right-click with Hammer opens Blueprint Catalog modal (Valheim style)
          this.building.toggleBlueprintModal();
        } else {
          this.isADS = true;
        }
      } else if (e.button === 1) {
        // Middle-click dismantles targeted structure
        if (this.currentSlot === 3) {
          const ray = this.getCameraRay();
          const raycaster = new THREE.Raycaster(ray.origin, ray.direction);
          this.building.dismantleTarget(raycaster);
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.isADS = false;
    });

    window.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;

      // 1-5 Hotbar (with Numpad support)
      if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5'].includes(e.code)) {
        const numChar = e.code.replace('Digit', '').replace('Numpad', '');
        const slotIdx = parseInt(numChar) - 1;
        this.switchWeapon(slotIdx);
      }

      if (e.code === 'KeyR' && this.currentSlot !== 3) {
        this.reload();
      }

      if (e.code === 'KeyB') {
        if (this.currentSlot !== 3) {
          this.switchWeapon(3);
        }
        this.building.toggleBlueprintModal();
      }

      if (e.code === 'KeyX' && this.currentSlot === 3) {
        const ray = this.getCameraRay();
        const raycaster = new THREE.Raycaster(ray.origin, ray.direction);
        this.building.dismantleTarget(raycaster);
      }

      if (e.code === 'KeyG') {
        this.throwGrenade();
      }

      if (e.code === 'KeyE') {
        this.tryInteract();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  initCompassTape() {
    if (!this.domCompassTape) return;
    const headings = ['N', '15', '30', 'NE', '60', '75', 'E', '105', '120', 'SE', '150', '165', 'S', '195', '210', 'SW', '240', '255', 'W', '285', '300', 'NW', '330', '345'];
    let tapeHTML = '';
    for (let loop = 0; loop < 3; loop++) {
      for (const h of headings) {
        const isMajor = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].includes(h);
        tapeHTML += `<span class="compass-tick ${isMajor ? 'compass-major' : ''}">${h}</span>`;
      }
    }
    this.domCompassTape.innerHTML = tapeHTML;
  }

  switchWeapon(slotIdx) {
    if (slotIdx < 0 || slotIdx >= this.weapons.length) return;
    this.currentSlot = slotIdx;
    sounds.playMechanicalClick(1.0 + slotIdx * 0.1);

    this.hotbarSlots.forEach((slot, idx) => {
      if (idx === slotIdx) slot.classList.add('selected');
      else slot.classList.remove('selected');
    });

    this.building.setActive(slotIdx === 3);
    this.buildWeaponMesh(this.weapons[slotIdx]);
    this.updateHUD();
  }

  buildWeaponMesh(weapon) {
    while (this.weaponGroup.children.length > 0) {
      this.weaponGroup.remove(this.weaponGroup.children[0]);
    }

    const group = new THREE.Group();

    if (weapon.type === 'rifle') {
      const receiver = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.14, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.3 })
      );
      group.add(receiver);

      const slide = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.05, 0.22),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.9 })
      );
      slide.position.set(0, 0.05, -0.05);
      group.add(slide);
      this.slideMesh = slide;

      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.45, 8),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.9, roughness: 0.2 })
      );
      barrel.rotation.x = Math.PI * 0.5;
      barrel.position.set(0, 0.02, -0.4);
      group.add(barrel);

      const mag = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.22, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7 })
      );
      mag.position.set(0, -0.15, -0.05);
      mag.rotation.x = 0.2;
      group.add(mag);

      const sight = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.08, 0.1),
        new THREE.MeshStandardMaterial({ color: 0x0284c7, transparent: true, opacity: 0.85 })
      );
      sight.position.set(0, 0.1, -0.08);
      group.add(sight);

      group.position.set(0.24, -0.22, -0.5);
    } else if (weapon.type === 'shotgun') {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.12, 0.65),
        new THREE.MeshStandardMaterial({ color: 0x18181b, metalness: 0.8 })
      );
      group.add(body);

      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8),
        new THREE.MeshStandardMaterial({ color: 0x3f3f46, metalness: 0.85 })
      );
      tube.rotation.x = Math.PI * 0.5;
      tube.position.set(0, -0.04, -0.25);
      group.add(tube);

      group.position.set(0.22, -0.22, -0.55);
    } else if (weapon.type === 'sniper') {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.12, 0.85),
        new THREE.MeshStandardMaterial({ color: 0x2e3b2e, metalness: 0.6 })
      );
      group.add(body);

      const scope = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.35, 8),
        new THREE.MeshStandardMaterial({ color: 0x09090b, metalness: 0.9 })
      );
      scope.rotation.x = Math.PI * 0.5;
      scope.position.set(0, 0.11, -0.05);
      group.add(scope);

      group.position.set(0.22, -0.24, -0.6);
    } else if (weapon.type === 'hammer') {
      const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6),
        new THREE.MeshStandardMaterial({ color: 0x78350f })
      );
      group.add(handle);

      const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.14, 0.25),
        new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8 })
      );
      head.position.set(0, 0.28, 0);
      group.add(head);

      group.position.set(0.25, -0.25, -0.45);
      group.rotation.x = 0.4;
    } else if (weapon.type === 'axe') {
      const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6),
        new THREE.MeshStandardMaterial({ color: 0x1e293b })
      );
      group.add(handle);

      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.18, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9 })
      );
      blade.position.set(0, 0.24, 0.08);
      group.add(blade);

      group.position.set(0.25, -0.25, -0.45);
    }

    this.muzzleLight = new THREE.PointLight(0xf59e0b, 0, 8);
    this.muzzleLight.position.set(0, 0.02, -0.6);
    group.add(this.muzzleLight);

    this.weaponGroup.add(group);
    this.weaponMesh = group;
  }

  throwGrenade() {
    if (this.isSwimming) {
      window.showTacticalNotification?.('CANNOT THROW GRENADES WHILE SWIMMING', 'warning');
      return;
    }

    if (this.inventory.getItemCount('grenade') <= 0) {
      sounds.playMechanicalClick(0.6);
      window.showTacticalNotification?.('NO GRENADES REMAINING (Craft in tab menu)', 'warning');
      return;
    }

    this.inventory.consumeItem('grenade', 1);
    sounds.playPinPull();

    const grenadeGeo = new THREE.SphereGeometry(0.12, 8, 8);
    const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.5, metalness: 0.7 });
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);

    const ray = this.getCameraRay();
    mesh.position.copy(ray.origin).addScaledVector(ray.direction, 0.6);

    const forwardVel = ray.direction.clone().multiplyScalar(18.0);
    forwardVel.y += 4.0;

    this.scene.add(mesh);
    this.activeGrenades.push({
      mesh: mesh,
      velocity: forwardVel,
      fuse: 2.2
    });

    this.updateHUD();
  }

  onPrimaryAction() {
    if (this.isSwimming) return; // Cannot shoot while swimming!

    const weapon = this.weapons[this.currentSlot];
    if (this.fireTimer > 0 || this.isReloading) return;

    if (weapon.type === 'hammer') {
      this.building.placePiece();
      this.fireTimer = weapon.fireRate;
      return;
    }

    if (weapon.type === 'axe') {
      if (this.survival.consumeStamina(15)) {
        this.swingAxe();
        this.fireTimer = weapon.fireRate;
      }
      return;
    }

    if (weapon.clip <= 0) {
      sounds.playMechanicalClick(0.8);
      this.reload();
      return;
    }

    weapon.clip--;
    this.fireTimer = weapon.fireRate;

    this.recoilOffset.z = weapon.recoilKick;
    this.pitch += (weapon.recoilKick * 0.4) * (this.isCrouching ? 0.5 : 1.0);
    this.screenShake = weapon.recoilKick * 0.6;

    if (this.slideMesh) {
      this.slideMesh.position.z += 0.06;
      setTimeout(() => { if (this.slideMesh) this.slideMesh.position.z = -0.05; }, 50);
    }

    if (this.muzzleLight) {
      this.muzzleLight.intensity = 3.5;
      setTimeout(() => { if (this.muzzleLight) this.muzzleLight.intensity = 0; }, 40);
    }

    if (weapon.type === 'rifle') sounds.playRifleShot();
    else if (weapon.type === 'shotgun') sounds.playShotgunShot();
    else if (weapon.type === 'sniper') sounds.playSniperShot();

    const gunWorldPos = new THREE.Vector3();
    this.weaponMesh.getWorldPosition(gunWorldPos);
    const gunRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.particles.ejectCasing(gunWorldPos, gunRight);

    const pelletCount = weapon.type === 'shotgun' ? 8 : 1;
    for (let p = 0; p < pelletCount; p++) {
      this.fireBallisticRay(weapon);
    }

    this.updateHUD();
  }

  fireBallisticRay(weapon) {
    const ray = this.getCameraRay();
    const spread = this.isADS ? weapon.spread * 0.3 : weapon.spread;
    ray.direction.x += (Math.random() - 0.5) * spread;
    ray.direction.y += (Math.random() - 0.5) * spread;
    ray.direction.z += (Math.random() - 0.5) * spread;
    ray.direction.normalize();

    const raycaster = new THREE.Raycaster(ray.origin, ray.direction, 0.5, 300);

    const enemyMeshes = this.enemies.enemies.map(e => e.mesh);
    const enemyHits = raycaster.intersectObjects(enemyMeshes, true);

    if (enemyHits.length > 0) {
      const hit = enemyHits[0];
      let root = hit.object;
      while (root.parent && !enemyMeshes.includes(root)) {
        root = root.parent;
      }
      const enemy = this.enemies.enemies.find(e => e.mesh === root);
      if (enemy) {
        const isHeadshot = hit.point.y > (root.position.y + (enemy.type === 'behemoth' ? 3.5 : 1.5));
        const finalDamage = isHeadshot ? weapon.damage * 2.0 : weapon.damage;

        this.enemies.damageEnemy(enemy, finalDamage);
        this.particles.createImpact(hit.point, hit.face.normal, 'blood');
        this.particles.createDamageNumber(hit.point, finalDamage, isHeadshot);
        this.triggerHitMarker(isHeadshot);
        return;
      }
    }

    const treeMeshes = this.world.trees.map(t => t.mesh);
    const treeHits = raycaster.intersectObjects(treeMeshes, true);
    if (treeHits.length > 0) {
      const hit = treeHits[0];
      let root = hit.object;
      while (root.parent && !treeMeshes.includes(root)) {
        root = root.parent;
      }
      const tree = this.world.trees.find(t => t.mesh === root);
      if (tree) {
        this.world.damageTree(tree, weapon.damage, hit.point, ray.direction);
        this.particles.createImpact(hit.point, hit.face.normal, 'wood');
        return;
      }
    }

    const terrainHits = raycaster.intersectObject(this.terrain.mesh);
    if (terrainHits.length > 0) {
      const hit = terrainHits[0];
      this.particles.createTracer(ray.origin, hit.point);
      this.particles.createImpact(hit.point, hit.face.normal, 'sparks');
    }
  }

  swingAxe() {
    sounds.playAxeChop();
    this.recoilOffset.y = -0.15;
    this.recoilOffset.z = 0.2;

    const ray = this.getCameraRay();
    const raycaster = new THREE.Raycaster(ray.origin, ray.direction, 0.5, 3.8);

    const treeMeshes = this.world.trees.map(t => t.mesh);
    const treeHits = raycaster.intersectObjects(treeMeshes, true);
    if (treeHits.length > 0) {
      const hit = treeHits[0];
      let root = hit.object;
      while (root.parent && !treeMeshes.includes(root)) root = root.parent;
      const tree = this.world.trees.find(t => t.mesh === root);
      if (tree) {
        this.world.damageTree(tree, 50, hit.point, ray.direction);
        this.particles.createImpact(hit.point, hit.face.normal, 'wood');
        return;
      }
    }

    const enemyMeshes = this.enemies.enemies.map(e => e.mesh);
    const enemyHits = raycaster.intersectObjects(enemyMeshes, true);
    if (enemyHits.length > 0) {
      const hit = enemyHits[0];
      let root = hit.object;
      while (root.parent && !enemyMeshes.includes(root)) root = root.parent;
      const enemy = this.enemies.enemies.find(e => e.mesh === root);
      if (enemy) {
        this.enemies.damageEnemy(enemy, 60);
        this.particles.createImpact(hit.point, hit.face.normal, 'blood');
        this.particles.createDamageNumber(hit.point, 60, false);
        this.triggerHitMarker(false);
      }
    }
  }

  reload() {
    const weapon = this.weapons[this.currentSlot];
    if (!weapon.ammoType || weapon.clip >= weapon.maxClip || this.isReloading) return;

    const reserveCount = this.inventory.getItemCount(weapon.ammoType) * (weapon.type === 'rifle' ? 30 : (weapon.type === 'shotgun' ? 8 : 5));
    if (reserveCount <= 0) {
      window.showTacticalNotification?.('RELOAD FAILED: Out of Ammunition! Craft more in [Tab]', 'warning');
      return;
    }

    this.isReloading = true;
    sounds.playMechanicalClick(0.9);

    setTimeout(() => {
      weapon.clip = weapon.maxClip;
      this.isReloading = false;
      sounds.playMechanicalClick(1.3);
      this.updateHUD();
    }, 1500);
  }

  triggerHitMarker(isHeadshot = false) {
    sounds.playHitMarker(isHeadshot);
    if (this.domHitMarker) {
      this.domHitMarker.style.opacity = '1';
      this.domHitMarker.style.transform = isHeadshot ? 'translate(-50%, -50%) scale(1.4)' : 'translate(-50%, -50%) scale(1.1)';
      setTimeout(() => {
        if (this.domHitMarker) {
          this.domHitMarker.style.opacity = '0';
          this.domHitMarker.style.transform = 'translate(-50%, -50%) scale(0.8)';
        }
      }, 100);
    }
  }

  tryInteract() {
    const ray = this.getCameraRay();
    const raycaster = new THREE.Raycaster(ray.origin, ray.direction, 0.5, 4.2);

    for (const s of this.building.structures) {
      if (s.position.distanceTo(this.position) < 3.8) {
        if (s.type === 'wood_door') {
          this.building.toggleDoor(s);
          return;
        }
        if (s.type === 'campfire') {
          if (this.survival.activeCooking) {
            const resultItem = this.survival.claimCookedItem();
            if (resultItem) {
              this.inventory.addItem(resultItem, 1);
            }
          } else {
            if (this.inventory.getItemCount('raw_meat') > 0) {
              this.inventory.consumeItem('raw_meat', 1);
              this.survival.startCampfireCooking();
            } else {
              window.showTacticalNotification?.('NEED RAW MEAT: Hunt wolves/stalkers to cook steaks!', 'info');
            }
          }
          return;
        }
        if (s.type === 'storage_chest') {
          this.inventory.toggle();
          return;
        }
      }
    }

    const nodeMeshes = this.world.resourceNodes.map(n => n.mesh);
    const hits = raycaster.intersectObjects(nodeMeshes, true);

    if (hits.length > 0) {
      let root = hits[0].object;
      while (root.parent && !nodeMeshes.includes(root)) root = root.parent;
      const node = this.world.resourceNodes.find(n => n.mesh === root);
      if (node) {
        this.world.harvestNode(node);
        return;
      }
    }

    const tower = this.world.landmarks.find(l => l.isObjective);
    if (tower && this.position.distanceTo(tower.position) < 8.0) {
      this.world.activateExtraction(this.inventory);
    }
  }

  getCameraRay() {
    const origin = this.camera.position.clone();
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    return { origin, direction };
  }

  update(delta) {
    if (this.fireTimer > 0) this.fireTimer -= delta;

    if (this.mouseDown && this.weapons[this.currentSlot].auto && !this.isSwimming) {
      this.onPrimaryAction();
    }

    // Grenade updates
    for (let i = this.activeGrenades.length - 1; i >= 0; i--) {
      const g = this.activeGrenades[i];
      g.fuse -= delta;
      g.velocity.y -= 18.0 * delta;
      g.mesh.position.addScaledVector(g.velocity, delta);

      const groundY = this.terrain.getHeightAt(g.mesh.position.x, g.mesh.position.z);
      if (g.mesh.position.y <= groundY + 0.15) {
        g.mesh.position.y = groundY + 0.15;
        g.velocity.y *= -0.4;
        g.velocity.x *= 0.6;
        g.velocity.z *= 0.6;
      }

      if (g.fuse <= 0) {
        const boomPos = g.mesh.position.clone();
        sounds.playExplosion();
        this.particles.createExplosionFX(boomPos);
        this.screenShake = 0.25;

        for (const enemy of this.enemies.enemies) {
          const dist = enemy.mesh.position.distanceTo(boomPos);
          if (dist < 12.0) {
            const blastDamage = Math.round(220 * (1 - dist / 12.0));
            this.enemies.damageEnemy(enemy, blastDamage);
            this.particles.createDamageNumber(enemy.mesh.position, blastDamage, true);
          }
        }

        for (const tree of this.world.trees) {
          if (tree.position.distanceTo(boomPos) < 9.0) {
            this.world.damageTree(tree, 150, boomPos, new THREE.Vector3().subVectors(tree.position, boomPos).normalize());
          }
        }

        this.scene.remove(g.mesh);
        this.activeGrenades.splice(i, 1);
      }
    }

    // 1. Water & Swimming State Detection
    const waterHeight = this.terrain.getWaterHeightAt(this.position.x, this.position.z);
    const groundY = this.terrain.getHeightAt(this.position.x, this.position.z);
    const waterDepth = waterHeight - groundY;

    const inWater = (waterDepth > 1.1) && (this.position.y <= waterHeight + 0.5);

    if (inWater && !this.isSwimming) {
      this.isSwimming = true;
      sounds.playSplash();
      this.particles.createWaterSplash(new THREE.Vector3(this.position.x, waterHeight, this.position.z), 1.2);
      this.weaponGroup.visible = false;
      window.showTacticalNotification?.('SWIMMING &bull; Drains Stamina &bull; Holstered weapons', 'info');
    } else if (!inWater && this.isSwimming) {
      this.isSwimming = false;
      sounds.playSplash();
      this.particles.createWaterSplash(new THREE.Vector3(this.position.x, waterHeight, this.position.z), 0.8);
      this.weaponGroup.visible = true;
    }

    // 2. Movement Vector
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const moveDir = new THREE.Vector3();
    if (this.keys['KeyW']) moveDir.add(forward);
    if (this.keys['KeyS']) moveDir.sub(forward);
    if (this.keys['KeyD']) moveDir.add(right);
    if (this.keys['KeyA']) moveDir.sub(right);

    const isMoving = moveDir.lengthSq() > 0.001;
    if (isMoving) moveDir.normalize();

    const wantsSprint = this.keys['ShiftLeft'] || this.keys['ShiftRight'];

    if (this.isSwimming) {
      // SWIMMING MECHANICS
      this.isSprinting = wantsSprint && isMoving && (this.survival.currentStamina > 3);
      const swimSpeed = this.isSprinting ? 6.2 : 3.8;

      this.velocity.x = moveDir.x * swimSpeed;
      this.velocity.z = moveDir.z * swimSpeed;

      // Diving vs Surface Breaching vs Natural Buoyancy:
      let targetWaterY = waterHeight + 0.35; // Head at eye-level with surface
      if (this.keys['KeyC']) {
        targetWaterY = waterHeight - 1.15; // Active Diving Submersion!
      } else if (this.keys['Space']) {
        targetWaterY = waterHeight + 0.65; // Active Surface Treading/Breaching!
      }

      this.position.y = THREE.MathUtils.lerp(this.position.y, targetWaterY, delta * 7.5);
      this.velocity.y = 0;
      this.isGrounded = false;

      // Swim strokes & splash particles
      if (isMoving) {
        this.swimTimer += delta;
        if (this.swimTimer >= (this.isSprinting ? 0.42 : 0.68)) {
          this.swimTimer = 0;
          sounds.playSwimStroke();
          this.particles.createWaterSplash(new THREE.Vector3(this.position.x, waterHeight, this.position.z), 0.6);
        }
      }

      // Valheim Stamina Drain while swimming!
      const drainRate = this.isSprinting ? 12.0 : 4.5;
      this.survival.consumeStamina(drainRate * delta);

      // Valheim Drowning when out of stamina!
      if (this.survival.currentStamina <= 0.5) {
        this.drowningTimer += delta;
        if (this.drowningTimer >= 1.0) {
          this.drowningTimer = 0;
          this.survival.takeDamage(12);
          sounds.playSplash();
          window.showTacticalNotification?.('⚠️ DROWNING! NO STAMINA! SWIM TO SHORE!', 'danger');
        }
      } else {
        this.drowningTimer = 0;
      }

      if (this.domBadgeSwimming) this.domBadgeSwimming.style.display = 'flex';
    } else {
      if (this.domBadgeSwimming) this.domBadgeSwimming.style.display = 'none';

      // LAND MOVEMENT MECHANICS
      this.isSprinting = wantsSprint && isMoving && (this.survival.currentStamina > 5);

      let speed = 4.8;
      if (this.isSprinting) {
        speed = 8.5;
        this.survival.consumeStamina(12 * delta);
      } else if (this.isADS) {
        speed = 2.4;
      } else if (this.keys['KeyC']) {
        speed = 2.0;
      }

      if (isMoving && this.isGrounded) {
        this.bobTimer += delta * (this.isSprinting ? 14 : 9);
        if (Math.sin(this.bobTimer) > 0.95 && Math.random() < 0.25) {
          sounds.playFootstep();
        }
      }

      this.velocity.x = moveDir.x * speed;
      this.velocity.z = moveDir.z * speed;

      if (this.keys['Space'] && this.isGrounded) {
        if (this.survival.consumeStamina(16)) {
          this.velocity.y = 7.5;
          this.isGrounded = false;
        }
      }

      this.velocity.y -= 20.0 * delta;
      this.position.y += this.velocity.y * delta;
    }

    this.position.x += this.velocity.x * delta;
    this.position.z += this.velocity.z * delta;

    // Structure horizontal collision
    if (this.building && this.building.structures) {
      for (const s of this.building.structures) {
        if (['wood_wall', 'wood_window', 'sandbag', 'metal_spikes'].includes(s.type) || (s.type === 'wood_door' && !s.isOpen)) {
          const dist = Math.hypot(this.position.x - s.position.x, this.position.z - s.position.z);
          const minDistance = s.type === 'sandbag' ? 1.6 : 1.4;
          if (dist < minDistance && Math.abs(this.position.y - s.position.y) < 2.5) {
            const pushDir = new THREE.Vector3(this.position.x - s.position.x, 0, this.position.z - s.position.z).normalize();
            this.position.x = s.position.x + pushDir.x * minDistance;
            this.position.z = s.position.z + pushDir.z * minDistance;
          }
        }
      }
    }

    // Ground clamping when not swimming
    if (!this.isSwimming) {
      const eyeHeight = this.keys['KeyC'] ? 1.0 : 1.75;
      if (this.position.y <= groundY + eyeHeight) {
        this.position.y = groundY + eyeHeight;
        this.velocity.y = 0;
        this.isGrounded = true;
      }
    }

    // Camera with screen shake
    let shakeX = 0;
    let shakeY = 0;
    if (this.screenShake > 0) {
      shakeX = (Math.random() - 0.5) * this.screenShake;
      shakeY = (Math.random() - 0.5) * this.screenShake;
      this.screenShake = Math.max(0, this.screenShake - delta * 0.8);
    }

    this.camera.position.copy(this.position);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw + shakeX;
    this.camera.rotation.x = this.pitch + shakeY;

    // Underwater camera detection & post-processing
    const under = this.camera.position.y < waterHeight - 0.08;
    if (under !== this.isUnderwater) {
      this.isUnderwater = under;
      sounds.setUnderwater(under);

      if (this.domUnderwaterTint) {
        this.domUnderwaterTint.style.opacity = under ? '0.75' : '0.0';
      }
      if (this.domBadgeUnderwater) {
        this.domBadgeUnderwater.style.display = under ? 'flex' : 'none';
      }

      if (under) {
        sounds.playSplash(0.85);
        this.particles.createUnderwaterBubbles(this.position, 6);
      } else {
        sounds.playSplash(1.1);
        this.particles.createWaterSplash(new THREE.Vector3(this.position.x, waterHeight, this.position.z), 1.0);
      }
    }

    if (this.isUnderwater && Math.random() < 0.2) {
      this.particles.createUnderwaterBubbles(this.position, 2);
    }

    const targetFOV = this.isADS ? (this.weapons[this.currentSlot].type === 'sniper' ? 24 : 52) : 75;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFOV, delta * 12);
    this.camera.updateProjectionMatrix();

    if (this.weaponMesh && !this.isSwimming) {
      const isRifleOrShotgun = ['rifle', 'shotgun', 'sniper'].includes(this.weapons[this.currentSlot].type);
      const targetX = this.isADS && isRifleOrShotgun ? 0 : 0.24;
      const targetY = this.isADS && isRifleOrShotgun ? -0.16 : -0.22;
      const targetZ = this.isADS && isRifleOrShotgun ? -0.4 : -0.5;

      const bobX = Math.cos(this.bobTimer * 0.5) * 0.012;
      const bobY = Math.abs(Math.sin(this.bobTimer)) * 0.015;

      this.weaponMesh.position.x = THREE.MathUtils.lerp(this.weaponMesh.position.x, targetX + bobX + this.swayOffset.x, delta * 15);
      this.weaponMesh.position.y = THREE.MathUtils.lerp(this.weaponMesh.position.y, targetY - bobY + this.swayOffset.y + this.recoilOffset.y, delta * 15);
      this.weaponMesh.position.z = THREE.MathUtils.lerp(this.weaponMesh.position.z, targetZ + this.recoilOffset.z, delta * 15);

      this.recoilOffset.lerp(new THREE.Vector3(0, 0, 0), delta * 12);
      this.swayOffset.lerp(new THREE.Vector2(0, 0), delta * 8);
    }

    if (this.currentSlot === 3) {
      this.building.updateGhost(this.getCameraRay(), this.terrain);
    }

    this.world.checkPickups(this.position, this.inventory);
    this.updateCompass();
    this.updateInteractionPrompt();
  }

  updateInteractionPrompt() {
    if (!this.domInteractPrompt || !this.domInteractText) return;

    for (const s of this.building.structures) {
      if (s.position.distanceTo(this.position) < 3.5) {
        if (s.type === 'campfire') {
          if (this.survival.activeCooking) {
            const t = this.survival.activeCooking.timer;
            if (t >= 4.5 && t <= 10.0) {
              this.domInteractPrompt.style.display = 'flex';
              this.domInteractText.textContent = 'Claim Charbroiled Steak!';
              return;
            } else if (t > 10.0) {
              this.domInteractPrompt.style.display = 'flex';
              this.domInteractText.textContent = 'Take Charcoal (Burnt)';
              return;
            } else {
              this.domInteractPrompt.style.display = 'flex';
              this.domInteractText.textContent = `Sizzling Steak... (${(4.5 - t).toFixed(1)}s)`;
              return;
            }
          } else if (this.inventory.getItemCount('raw_meat') > 0) {
            this.domInteractPrompt.style.display = 'flex';
            this.domInteractText.textContent = 'Cook Raw Game Meat on Spit';
            return;
          }
        } else if (s.type === 'wood_door') {
          this.domInteractPrompt.style.display = 'flex';
          this.domInteractText.textContent = s.isOpen ? 'Close Fort Door' : 'Open Fort Door';
          return;
        } else if (s.type === 'storage_chest') {
          this.domInteractPrompt.style.display = 'flex';
          this.domInteractText.textContent = 'Open Storage Chest';
          return;
        }
      }
    }

    const tower = this.world.landmarks.find(l => l.isObjective);
    if (tower && this.position.distanceTo(tower.position) < 6.0) {
      this.domInteractPrompt.style.display = 'flex';
      this.domInteractText.textContent = 'Transmit Extraction Telemetry (Requires Behemoth Core)';
      return;
    }

    this.domInteractPrompt.style.display = 'none';
  }

  updateCompass() {
    if (!this.domCompassTape) return;
    let deg = (-this.yaw * (180 / Math.PI)) % 360;
    if (deg < 0) deg += 360;

    const offsetPx = -(deg / 360) * 480;
    this.domCompassTape.style.transform = `translateX(${offsetPx}px)`;

    const radioTower = this.world.landmarks.find(l => l.isObjective);
    if (radioTower && this.domCompassObj) {
      const dist = Math.round(this.position.distanceTo(radioTower.position));
      this.domCompassObj.textContent = `OBJ: RADIO RELAY (${dist}m NW)`;
    }
  }

  updateHUD() {
    const weapon = this.weapons[this.currentSlot];
    if (this.domWeaponName) this.domWeaponName.textContent = this.isSwimming ? 'SWIMMING (WEAPONS HOLSTERED)' : weapon.name;

    if (this.domAmmoClip) {
      this.domAmmoClip.textContent = weapon.clip;
      if (typeof weapon.clip === 'number' && weapon.clip <= 5) {
        this.domAmmoClip.classList.add('low');
      } else {
        this.domAmmoClip.classList.remove('low');
      }
    }

    const w1 = this.weapons[0];
    const w2 = this.weapons[1];
    const w3 = this.weapons[2];
    const el1 = document.getElementById('hotbar-count-1');
    const el2 = document.getElementById('hotbar-count-2');
    const el3 = document.getElementById('hotbar-count-3');
    if (el1) el1.textContent = w1.clip;
    if (el2) el2.textContent = w2.clip;
    if (el3) el3.textContent = w3.clip;

    if (this.domAmmoReserve) {
      if (weapon.ammoType) {
        const ammoCount = this.inventory.getItemCount(weapon.ammoType) * (weapon.type === 'rifle' ? 30 : (weapon.type === 'shotgun' ? 8 : 5));
        this.domAmmoReserve.textContent = ammoCount;
      } else {
        this.domAmmoReserve.textContent = '—';
      }
    }

    if (this.domFireMode) {
      if (this.isSwimming) this.domFireMode.textContent = 'TREADING WATER &bull; [SPACE] SWIM UP &bull; [C] DIVE';
      else if (weapon.type === 'rifle') this.domFireMode.textContent = 'FULL AUTO &bull; 5.56x45mm NATO &bull; [G] GRENADE';
      else if (weapon.type === 'shotgun') this.domFireMode.textContent = 'PUMP ACTION &bull; 12-GAUGE BUCKSHOT &bull; [G] GRENADE';
      else if (weapon.type === 'sniper') this.domFireMode.textContent = 'BOLT ACTION &bull; .338 LAPUA MAGNUM &bull; [G] GRENADE';
      else if (weapon.type === 'hammer') this.domFireMode.textContent = 'CONSTRUCTION TOOL &bull; [SCROLL/Q] SELECT &bull; [B] CATALOG &bull; [R] ROTATE';
      else if (weapon.type === 'axe') this.domFireMode.textContent = 'TACTICAL HATCHET &bull; FELL PINE TREES';
    }
  }
}
