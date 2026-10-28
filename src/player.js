// ZONE ZERO: Modern FPS Controller, Tactical Ballistics, Grenades & Swimming Engine
import * as THREE from 'three';
import { sounds } from './audio.js';
import { buildWeaponModel, createMuzzleFlash } from './weapons.js';
import { createGrenadeMesh } from './models.js';

const VIEWMODEL_SCALE = 0.85;
const PLAYER_RADIUS = 0.42;

export class PlayerController {
  constructor(camera, scene, terrain, survival, inventory, building, enemies, worldManager, particles, collision = null) {
    this.camera = camera;
    this.scene = scene;
    this.terrain = terrain;
    this.survival = survival;
    this.inventory = inventory;
    this.building = building;
    this.enemies = enemies;
    this.world = worldManager;
    this.particles = particles;
    this.collision = collision;

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
      },
      {
        name: 'MINING PICKAXE',
        type: 'pickaxe',
        clip: '—',
        maxClip: '—',
        fireRate: 0.6,
        damage: 40,
        auto: false
      }
    ];

    this.fireTimer = 0;
    this.isReloading = false;
    this.reloadRemaining = 0;
    this.reloadWeapon = null;
    this.recoilOffset = new THREE.Vector3();

    this.weaponGroup = new THREE.Group();
    this.camera.add(this.weaponGroup);
    this.weaponMesh = null;
    this.slideMesh = null;
    this.slideRest = new THREE.Vector3();
    this.slideKick = 0;
    this.muzzleLight = null;
    this.muzzleObject = null;
    this.muzzleFlash = null;
    this.flashTimer = 0;
    this.sightY = 0.1;
    this.meleeSwing = 0;
    this.scopeAmount = 0;
    this.restPose = [0.24, -0.22, -0.5];
    this.weaponRestRotation = new THREE.Euler();
    this._muzzleWorld = new THREE.Vector3();

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
      if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6'].includes(e.code)) {
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
    if (this.isReloading) this.isReloading = false; // switching weapons cancels the reload
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

    const model = buildWeaponModel(weapon.type);
    const group = model.group;

    const restPose = {
      rifle: [0.2, -0.2, -0.46],
      shotgun: [0.19, -0.2, -0.5],
      sniper: [0.19, -0.21, -0.55],
      hammer: [0.24, -0.26, -0.45],
      axe: [0.24, -0.26, -0.45],
      pickaxe: [0.24, -0.26, -0.45]
    }[weapon.type];
    group.position.set(...restPose);
    group.scale.setScalar(VIEWMODEL_SCALE);
    this.restPose = restPose;

    this.slideMesh = model.slide;
    if (model.slide) this.slideRest.copy(model.slide.position);
    this.slideKick = 0;
    this.sightY = model.sightY * VIEWMODEL_SCALE;
    this.muzzleObject = model.muzzle;
    this.meleeSwing = 0;

    this.muzzleLight = new THREE.PointLight(0xffa24a, 0, 9, 2);
    this.muzzleFlash = null;
    if (model.muzzle) {
      this.muzzleLight.position.copy(model.muzzle.position).add(new THREE.Vector3(0, 0, -0.1));
      group.add(this.muzzleLight);
      this.muzzleFlash = createMuzzleFlash();
      this.muzzleFlash.position.copy(model.muzzle.position);
      this.muzzleFlash.scale.setScalar(model.flashScale);
      group.add(this.muzzleFlash);
    } else {
      // Keep the light in the scene graph so the light count (and shader programs) never change
      group.add(this.muzzleLight);
    }

    this.weaponGroup.add(group);
    this.weaponMesh = group;
    this.weaponRestRotation = group.rotation.clone();
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

    const mesh = createGrenadeMesh();

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
      this.meleeSwing = 1;
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

    if (weapon.type === 'pickaxe') {
      if (this.survival.consumeStamina(8)) {
        this.swingPickaxe();
        this.fireTimer = weapon.fireRate;
      } else {
        window.showTacticalNotification?.('OUT OF STAMINA — catch your breath', 'warning');
      }
      return;
    }

    if (weapon.clip <= 0) {
      sounds.playDryFire();
      this.fireTimer = 0.25;
      this.reload();
      return;
    }

    weapon.clip--;
    this.fireTimer = weapon.fireRate;

    this.recoilOffset.z = weapon.recoilKick;
    this.pitch += (weapon.recoilKick * 0.4) * (this.isCrouching ? 0.5 : 1.0);
    this.screenShake = weapon.recoilKick * 0.6;

    this.slideKick = 1;
    this.flashTimer = 0.05;
    if (this.muzzleFlash) {
      this.muzzleFlash.visible = true;
      this.muzzleFlash.rotation.z = Math.random() * Math.PI * 2;
    }
    if (this.muzzleLight) this.muzzleLight.intensity = 10;

    if (weapon.type === 'rifle') sounds.playRifleShot();
    else if (weapon.type === 'shotgun') sounds.playShotgunShot();
    else if (weapon.type === 'sniper') sounds.playSniperShot();

    const gunWorldPos = new THREE.Vector3();
    this.weaponMesh.getWorldPosition(gunWorldPos);
    const gunRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.particles.ejectCasing(gunWorldPos, gunRight);

    const muzzle = this._muzzleWorld;
    if (this.muzzleObject) this.muzzleObject.getWorldPosition(muzzle);
    else muzzle.copy(gunWorldPos);
    const aimDir = this.getCameraRay().direction;
    this.particles.createMuzzleSmoke(muzzle, aimDir, weapon.type !== 'rifle');

    this.enemies.makeNoise(this.position, { rifle: 75, shotgun: 95, sniper: 125 }[weapon.type] ?? 70);

    const pelletCount = weapon.type === 'shotgun' ? 8 : 1;
    for (let p = 0; p < pelletCount; p++) {
      this.fireBallisticRay(weapon, muzzle, p < 3);
    }

    this.updateHUD();
  }

  // Closest hit among enemies, trees, terrain and the lake surface decides what the bullet strikes
  fireBallisticRay(weapon, muzzle, showTracer = true) {
    const ray = this.getCameraRay();
    const spread = this.isADS ? weapon.spread * 0.3 : weapon.spread;
    ray.direction.x += (Math.random() - 0.5) * spread;
    ray.direction.y += (Math.random() - 0.5) * spread;
    ray.direction.z += (Math.random() - 0.5) * spread;
    ray.direction.normalize();

    const raycaster = new THREE.Raycaster(ray.origin, ray.direction, 0.5, 300);

    const enemyMeshes = this.enemies.enemies.map(e => e.mesh);
    const treeMeshes = this.world.trees.map(t => t.mesh);
    const enemyHit = raycaster.intersectObjects(enemyMeshes, true)[0];
    const treeHit = raycaster.intersectObjects(treeMeshes, true)[0];
    const terrainHit = this.terrain.raycast(ray.origin, ray.direction, 300);
    const nodeMeshes = this.world.mineNodes.filter(n => n.mesh.visible).map(n => n.mesh);
    const nodeHit = raycaster.intersectObjects(nodeMeshes, true)[0];

    let waterDist = Infinity;
    if (ray.direction.y < -0.0001 && ray.origin.y > this.terrain.waterLevel) {
      waterDist = (this.terrain.waterLevel - ray.origin.y) / ray.direction.y;
    }

    const candidates = [
      { kind: 'enemy', distance: enemyHit ? enemyHit.distance : Infinity },
      { kind: 'tree', distance: treeHit ? treeHit.distance : Infinity },
      { kind: 'terrain', distance: terrainHit ? terrainHit.distance : Infinity },
      { kind: 'rock', distance: nodeHit ? nodeHit.distance : Infinity },
      { kind: 'water', distance: waterDist < 300 ? waterDist : Infinity }
    ].sort((a, b) => a.distance - b.distance);
    const first = candidates[0];

    const worldNormal = (hit) => (hit.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      : new THREE.Vector3(0, 1, 0));
    const tracerTo = (point) => { if (showTracer) this.particles.createTracer(muzzle, point); };

    if (first.distance === Infinity) {
      tracerTo(ray.origin.clone().addScaledVector(ray.direction, 220));
      return;
    }

    if (first.kind === 'enemy') {
      let root = enemyHit.object;
      while (root.parent && !enemyMeshes.includes(root)) {
        root = root.parent;
      }
      const enemy = this.enemies.enemies.find(e => e.mesh === root);
      if (enemy) {
        const isHeadshot = enemyHit.point.y > (root.position.y + (enemy.type === 'behemoth' ? 3.5 : 1.5));
        const finalDamage = isHeadshot ? weapon.damage * 2.0 : weapon.damage;

        this.enemies.damageEnemy(enemy, finalDamage);
        this.particles.createImpact(enemyHit.point, worldNormal(enemyHit), 'blood');
        sounds.playImpact('flesh', enemyHit.point);
        this.particles.createDamageNumber(enemyHit.point, finalDamage, isHeadshot);
        this.triggerHitMarker(isHeadshot);
        tracerTo(enemyHit.point);
      }
    } else if (first.kind === 'tree') {
      let root = treeHit.object;
      while (root.parent && !treeMeshes.includes(root)) {
        root = root.parent;
      }
      const tree = this.world.trees.find(t => t.mesh === root);
      if (tree) {
        this.world.damageTree(tree, weapon.damage, treeHit.point, ray.direction);
        this.particles.createImpact(treeHit.point, worldNormal(treeHit), 'wood');
        sounds.playImpact('wood', treeHit.point);
        tracerTo(treeHit.point);
      }
    } else if (first.kind === 'rock') {
      this.particles.createImpact(nodeHit.point, worldNormal(nodeHit), 'sparks');
      sounds.playImpact('rock', nodeHit.point);
      tracerTo(nodeHit.point);
    } else if (first.kind === 'water') {
      const splash = ray.origin.clone().addScaledVector(ray.direction, waterDist);
      this.particles.createWaterSplash(splash, 0.55);
      tracerTo(splash);
    } else {
      this.particles.createImpact(terrainHit.point, terrainHit.normal, 'sparks');
      sounds.playImpact('dirt', terrainHit.point);
      tracerTo(terrainHit.point);
    }
  }

  worldNormalOf(hit) {
    return hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
  }

  swingAxe() {
    sounds.playSwing();
    this.meleeSwing = 1;
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
        this.particles.createImpact(hit.point, this.worldNormalOf(hit), 'wood');
        sounds.playAxeChop(hit.point);
        this.enemies.makeNoise(this.position, 32);
        this.screenShake = Math.max(this.screenShake, 0.04);
        return;
      }
    }

    const rockHit = raycaster.intersectObjects(this.world.mineNodes.filter(n => n.mesh.visible).map(n => n.mesh), true)[0];
    if (rockHit) {
      this.particles.createImpact(rockHit.point, this.worldNormalOf(rockHit), 'sparks');
      sounds.playImpact('rock', rockHit.point);
      this.notifyOnce('pickaxe-hint', 'A hatchet cannot break rock — equip the MINING PICKAXE [6]', 'info');
      return;
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
        this.particles.createImpact(hit.point, this.worldNormalOf(hit), 'blood');
        sounds.playImpact('flesh', hit.point);
        this.particles.createDamageNumber(hit.point, 60, false);
        this.triggerHitMarker(false);
      }
    }
  }

  notifyOnce(key, message, type = 'info') {
    this._notified = this._notified || new Set();
    if (this._notified.has(key)) return;
    this._notified.add(key);
    window.showTacticalNotification?.(message, type);
  }

  // Pickaxe: chips ore out of boulders, veins and crystal clusters straight into the backpack
  swingPickaxe() {
    sounds.playSwing();
    this.meleeSwing = 1;
    this.recoilOffset.y = -0.12;
    this.recoilOffset.z = 0.18;

    const ray = this.getCameraRay();
    const raycaster = new THREE.Raycaster(ray.origin, ray.direction, 0.3, 3.9);
    const nodes = this.world.mineNodes.filter(n => n.mesh.visible);
    const hit = raycaster.intersectObjects(nodes.map(n => n.mesh), true)[0];

    if (hit) {
      let root = hit.object;
      while (root.parent && !nodes.some(n => n.mesh === root)) root = root.parent;
      const node = nodes.find(n => n.mesh === root);
      if (node) {
        const normal = this.worldNormalOf(hit);
        const { items, broken } = this.world.damageNode(node, this.weapons[this.currentSlot].damage);
        this.particles.createMineFX(hit.point, normal, node.def.spark, broken);
        sounds.playMineHit(node.kind, hit.point);
        if (broken) sounds.playMineBreak(node.kind, hit.point);
        this.screenShake = Math.max(this.screenShake, broken ? 0.12 : 0.06);
        this.enemies.makeNoise(this.position, 36);

        const total = items.reduce((sum, it) => sum + it.count, 0);
        for (const it of items) this.inventory.addItem(it.id, it.count);
        this.particles.createFloatingText(hit.point, `+${total} ${node.def.label}`, node.def.spark);
        sounds.playPickup();
        this.updateHUD();
        return;
      }
    }

    // Swinging at dirt or a tree: dull thud, no yield
    const ground = this.terrain.raycast(ray.origin, ray.direction, 3.9);
    if (ground) {
      this.particles.createImpact(ground.point, ground.normal, 'wood');
      sounds.playImpact('dirt', ground.point);
    }
  }

  magSize(weapon) {
    return weapon.type === 'rifle' ? 30 : (weapon.type === 'shotgun' ? 8 : 5);
  }

  // Rounds available outside the weapon: loose rounds from partly used magazines plus whole ammo items
  reserveRounds(weapon) {
    if (!weapon.ammoType) return 0;
    return (weapon.looseRounds || 0) + this.inventory.getItemCount(weapon.ammoType) * this.magSize(weapon);
  }

  takeRounds(weapon, need) {
    let taken = 0;
    while (taken < need) {
      if ((weapon.looseRounds || 0) <= 0) {
        if (this.inventory.getItemCount(weapon.ammoType) <= 0) break;
        this.inventory.consumeItem(weapon.ammoType, 1);
        weapon.looseRounds = (weapon.looseRounds || 0) + this.magSize(weapon);
      }
      const use = Math.min(need - taken, weapon.looseRounds);
      weapon.looseRounds -= use;
      taken += use;
    }
    return taken;
  }

  reload() {
    const weapon = this.weapons[this.currentSlot];
    if (!weapon.ammoType || weapon.clip >= weapon.maxClip || this.isReloading) return;

    if (this.reserveRounds(weapon) <= 0) {
      this.notifyOnce(`noammo-${weapon.type}`, 'OUT OF AMMUNITION — salvage scrap + gunpowder and craft more in [Tab]', 'warning');
      return;
    }

    this.isReloading = true;
    this.reloadRemaining = 1.5;
    this.reloadWeapon = weapon;
    sounds.playReload(weapon.type);
  }

  updateReload(delta) {
    if (!this.isReloading) return;
    this.reloadRemaining -= delta;
    if (this.reloadRemaining > 0) return;
    const weapon = this.reloadWeapon;
    weapon.clip += this.takeRounds(weapon, weapon.maxClip - weapon.clip);
    this.isReloading = false;
    this.updateHUD();
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

  // Surface under the player's feet, used to pick footstep sounds
  getSurface() {
    if (this.isSwimming) return 'water';
    const { x, z } = this.position;
    const h = this.terrain.getHeightAt(x, z);
    const wl = this.terrain.waterLevel;
    if (h < wl + 0.25) return 'water';
    if (Math.abs(x) < 3.5 && Math.abs(z) < 3.5) return 'wood';
    for (const s of this.building.structures) {
      if (s.type === 'wood_stairs' && s.position.distanceTo(this.position) < 2.5) return 'wood';
    }
    if (h < wl + 1.2) return 'sand';
    if (h > 32) return 'snow';
    if (h > 21 || this.terrain.getNormalAt(x, z).y < 0.82) return 'rock';
    return Math.hypot(x, z) > 60 && this.terrain.noise.noise2D(x * 0.07 - 9, z * 0.07 + 31) > 0.3 ? 'dirt' : 'grass';
  }

  getCameraRay() {
    const origin = this.camera.position.clone();
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    return { origin, direction };
  }

  update(delta) {
    if (this.fireTimer > 0) this.fireTimer -= delta;
    this.updateReload(delta);

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
        sounds.playExplosion(boomPos);
        this.enemies.makeNoise(boomPos, 135);
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
        this.stepDistance = (this.stepDistance || 0) + speed * delta;
        const stride = this.isSprinting ? 2.5 : (this.keys['KeyC'] ? 1.3 : 1.85);
        if (this.stepDistance >= stride) {
          this.stepDistance = 0;
          sounds.playFootstep(this.getSurface(), this.isSprinting ? 1.25 : (this.keys['KeyC'] ? 0.4 : 0.85));
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

    // Obstacle collision (trees, boulders, ore, buildings, landmarks) and walkable ramps
    const eyeHeight = this.keys['KeyC'] ? 1.0 : 1.75;
    let supportY = this.terrain.getHeightAt(this.position.x, this.position.z);
    if (this.collision) {
      const feetY = this.position.y - eyeHeight;
      this.collision.resolve(this.position, PLAYER_RADIUS, feetY, eyeHeight + 0.2);
      supportY = Math.max(supportY, this.collision.surfaceHeight(this.position.x, this.position.z, feetY));
    }

    // Ground clamping when not swimming
    if (!this.isSwimming) {
      if (this.position.y <= supportY + eyeHeight) {
        if (this.velocity.y < -5.5) {
          sounds.playFootstep(this.getSurface(), 1.6);
          this.screenShake = Math.max(this.screenShake, 0.03);
        }
        this.position.y = supportY + eyeHeight;
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

    const weaponType = this.weapons[this.currentSlot].type;
    const targetFOV = this.isADS ? (weaponType === 'sniper' ? 24 : 52) : 75;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFOV, delta * 12);
    this.camera.updateProjectionMatrix();

    // Sniper scope: hide the viewmodel and let the post-process pass draw the scope mask
    this.scopeAmount = weaponType === 'sniper' ? THREE.MathUtils.clamp((58 - this.camera.fov) / 28, 0, 1) : 0;
    this.weaponGroup.visible = !this.isSwimming && this.scopeAmount < 0.75;

    // Muzzle flash / light decay
    if (this.flashTimer > 0) {
      this.flashTimer -= delta;
      if (this.flashTimer <= 0) {
        if (this.muzzleFlash) this.muzzleFlash.visible = false;
        if (this.muzzleLight) this.muzzleLight.intensity = 0;
      }
    }

    if (this.weaponMesh && !this.isSwimming) {
      const isGun = ['rifle', 'shotgun', 'sniper'].includes(weaponType);
      const aimed = this.isADS && isGun;
      const rest = this.restPose;
      const targetX = aimed ? 0 : rest[0];
      const targetY = aimed ? -this.sightY : rest[1];
      const targetZ = aimed ? -0.4 : rest[2];

      const bobScale = aimed ? 0.25 : 1;
      const bobX = Math.cos(this.bobTimer * 0.5) * 0.012 * bobScale;
      const bobY = Math.abs(Math.sin(this.bobTimer)) * 0.015 * bobScale;

      this.weaponMesh.position.x = THREE.MathUtils.lerp(this.weaponMesh.position.x, targetX + bobX + this.swayOffset.x, delta * 15);
      this.weaponMesh.position.y = THREE.MathUtils.lerp(this.weaponMesh.position.y, targetY - bobY + this.swayOffset.y + this.recoilOffset.y, delta * 15);
      this.weaponMesh.position.z = THREE.MathUtils.lerp(this.weaponMesh.position.z, targetZ + this.recoilOffset.z, delta * 15);

      // Muzzle climb + melee swing
      const swing = this.meleeSwing > 0 ? Math.sin((1 - this.meleeSwing) * Math.PI) : 0;
      this.weaponMesh.rotation.x = this.weaponRestRotation.x + this.recoilOffset.z * (isGun ? 1.8 : 0) - swing * 1.25;
      this.weaponMesh.rotation.z = this.weaponRestRotation.z - swing * 0.35 + this.swayOffset.x * 1.5;
      this.meleeSwing = Math.max(0, this.meleeSwing - delta * 3.6);

      // Bolt / pump kick
      if (this.slideMesh) {
        this.slideKick = Math.max(0, this.slideKick - delta * (weaponType === 'shotgun' ? 4 : 18));
        const kick = weaponType === 'shotgun' ? Math.sin(this.slideKick * Math.PI) : this.slideKick;
        this.slideMesh.position.copy(this.slideRest);
        this.slideMesh.position.z += kick * (weaponType === 'shotgun' ? 0.12 : 0.05);
      }

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

    if (this.weapons[this.currentSlot].type === 'pickaxe') {
      const ray = this.getCameraRay();
      const raycaster = new THREE.Raycaster(ray.origin, ray.direction, 0.3, 4.2);
      const nodes = this.world.mineNodes.filter(n => n.mesh.visible);
      const hit = raycaster.intersectObjects(nodes.map(n => n.mesh), true)[0];
      if (hit) {
        let root = hit.object;
        while (root.parent && !nodes.some(n => n.mesh === root)) root = root.parent;
        const node = nodes.find(n => n.mesh === root);
        if (node) {
          this.domInteractPrompt.style.display = 'flex';
          this.domInteractText.textContent = `Mine ${node.name} (${Math.max(0, Math.ceil(node.hp / node.maxHp * 100))}%)`;
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

    // Tape holds three 360° loops of 24 ticks; park the middle loop's matching heading under the centre marker
    const tickW = 30;
    const loopW = 24 * tickW;
    const offsetPx = 190 - tickW / 2 - (loopW + (deg / 360) * loopW);
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
        this.domAmmoReserve.textContent = this.reserveRounds(weapon);
      } else {
        this.domAmmoReserve.textContent = '—';
      }
    }

    if (this.domFireMode) {
      if (this.isSwimming) this.domFireMode.innerHTML = 'TREADING WATER &bull; [SPACE] SWIM UP &bull; [C] DIVE';
      else if (weapon.type === 'rifle') this.domFireMode.innerHTML = 'FULL AUTO &bull; 5.56x45mm NATO &bull; [G] GRENADE';
      else if (weapon.type === 'shotgun') this.domFireMode.innerHTML = 'PUMP ACTION &bull; 12-GAUGE BUCKSHOT &bull; [G] GRENADE';
      else if (weapon.type === 'sniper') this.domFireMode.innerHTML = 'BOLT ACTION &bull; .338 LAPUA MAGNUM &bull; [G] GRENADE';
      else if (weapon.type === 'hammer') this.domFireMode.innerHTML = 'CONSTRUCTION TOOL &bull; [SCROLL/Q] SELECT &bull; [B] CATALOG &bull; [R] ROTATE';
      else if (weapon.type === 'axe') this.domFireMode.innerHTML = 'TACTICAL HATCHET &bull; FELL PINE TREES';
      else if (weapon.type === 'pickaxe') this.domFireMode.innerHTML = 'MINING PICKAXE &bull; STONE, IRON &amp; CRYSTAL DEPOSITS';
    }
  }
}
