// ZONE ZERO: Valheim World Generation, Physical Pickups & Extraction Finale
import * as THREE from 'three';
import { sounds } from './audio.js';

export class WorldManager {
  constructor(scene, terrain, inventory) {
    this.scene = scene;
    this.terrain = terrain;
    this.inventory = inventory;

    this.trees = [];
    this.fallingTrees = [];
    this.resourceNodes = [];
    this.pickups = [];
    this.landmarks = [];

    this.extractionActive = false;
    this.extractionTimer = 0;
    this.rescueHelicopter = null;

    this.spawnFloraAndResources();
    this.spawnLandmarks();
    this.initLootListener();
  }

  initLootListener() {
    window.addEventListener('enemy_dropped_loot', (e) => {
      const { pos, itemId, count } = e.detail;
      this.spawnLootItem(pos, itemId, count);
    });
  }

  spawnFloraAndResources() {
    const treeGeo = new THREE.CylinderGeometry(0.35, 0.5, 7.5, 6);
    const foliageGeo = new THREE.ConeGeometry(2.4, 6.0, 5);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x422006, roughness: 0.9, flatShading: true });
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.8, flatShading: true });

    for (let i = 0; i < 140; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 18 + Math.random() * 220;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = this.terrain.getHeightAt(x, z);

      if (y > 2.5 && y < 24) {
        const treeGroup = new THREE.Group();

        const trunk = new THREE.Mesh(treeGeo, trunkMat);
        trunk.position.y = 3.75;
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        treeGroup.add(trunk);

        const foliage = new THREE.Mesh(foliageGeo, foliageMat);
        foliage.position.y = 6.8;
        foliage.castShadow = true;
        treeGroup.add(foliage);

        treeGroup.position.set(x, y, z);
        const scale = 0.8 + Math.random() * 0.5;
        treeGroup.scale.set(scale, scale, scale);
        treeGroup.rotation.y = Math.random() * Math.PI * 2;

        this.scene.add(treeGroup);

        this.trees.push({
          mesh: treeGroup,
          hp: 100,
          maxHp: 100,
          position: new THREE.Vector3(x, y, z),
          scale: scale,
          height: 7.5 * scale,
          fallDirection: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize()
        });
      }
    }

    const bushGeo = new THREE.DodecahedronGeometry(0.8, 1);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.8 });
    const berryMat = new THREE.MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.3 });

    for (let i = 0; i < 35; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 10 + Math.random() * 140;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = this.terrain.getHeightAt(x, z);

      if (y > 2.5 && y < 18) {
        const bush = new THREE.Mesh(bushGeo, bushMat);
        bush.position.set(x, y + 0.4, z);

        for (let b = 0; b < 4; b++) {
          const berry = new THREE.Mesh(new THREE.SphereGeometry(0.15, 4, 4), berryMat);
          berry.position.set((Math.random() - 0.5) * 0.7, 0.4 + Math.random() * 0.3, (Math.random() - 0.5) * 0.7);
          bush.add(berry);
        }

        this.scene.add(bush);
        this.resourceNodes.push({
          mesh: bush,
          type: 'berries',
          name: 'Wild Bio-Berries',
          yieldId: 'berries',
          yieldCount: 3
        });
      }
    }

    const scrapGeo = new THREE.BoxGeometry(1.2, 0.8, 1.0);
    const scrapMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.7, roughness: 0.4 });

    for (let i = 0; i < 25; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 25 + Math.random() * 180;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = this.terrain.getHeightAt(x, z);

      if (y > 2.5 && y < 26) {
        const scrap = new THREE.Mesh(scrapGeo, scrapMat);
        scrap.position.set(x, y + 0.4, z);
        scrap.rotation.set(Math.random() * 0.3, Math.random() * Math.PI, Math.random() * 0.2);
        scrap.castShadow = true;
        this.scene.add(scrap);

        this.resourceNodes.push({
          mesh: scrap,
          type: 'scrap',
          name: 'Salvageable Metal Cache',
          yieldId: 'scrap',
          yieldCount: 4
        });
      }
    }
  }

  spawnLandmarks() {
    const baseCamp = new THREE.Group();
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(6, 0.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 })
    );
    floor.position.set(0, this.terrain.getHeightAt(0, 0) + 0.1, 0);
    baseCamp.add(floor);

    const campFire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.8, 0.3, 8),
      new THREE.MeshStandardMaterial({ color: 0x475569 })
    );
    campFire.position.set(0, this.terrain.getHeightAt(0, 0) + 0.2, 0);
    const fireLight = new THREE.PointLight(0xf97316, 2.5, 12);
    fireLight.position.y = 0.5;
    campFire.add(fireLight);
    baseCamp.add(campFire);
    this.scene.add(baseCamp);

    const bunker = new THREE.Group();
    const bunkerY = this.terrain.getHeightAt(60, -40);
    const bunkerMesh = new THREE.Mesh(
      new THREE.BoxGeometry(12, 4, 10),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 })
    );
    bunkerMesh.position.set(60, bunkerY + 2, -40);
    bunkerMesh.castShadow = true;
    bunkerMesh.receiveShadow = true;
    bunker.add(bunkerMesh);
    this.scene.add(bunker);

    const towerGroup = new THREE.Group();
    const towerX = -120;
    const towerZ = -140;
    const towerY = this.terrain.getHeightAt(towerX, towerZ);

    const mastGeo = new THREE.CylinderGeometry(0.4, 1.2, 28, 4);
    const mastMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.8, roughness: 0.3 });
    const mast = new THREE.Mesh(mastGeo, mastMat);
    mast.position.set(towerX, towerY + 14, towerZ);
    mast.castShadow = true;
    towerGroup.add(mast);

    const consoleMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.4, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.6 })
    );
    consoleMesh.position.set(towerX, towerY + 0.7, towerZ + 2);
    towerGroup.add(consoleMesh);

    const beaconLight = new THREE.PointLight(0xef4444, 3.5, 60);
    beaconLight.position.set(towerX, towerY + 28, towerZ);
    towerGroup.add(beaconLight);

    this.scene.add(towerGroup);
    this.landmarks.push({
      name: 'RADIO RELAY STATION',
      position: new THREE.Vector3(towerX, towerY, towerZ),
      isObjective: true
    });
  }

  damageTree(tree, damage, hitPoint, forwardDir) {
    tree.hp -= damage;
    sounds.playAxeChop();

    if (tree.hp <= 0) {
      this.fellTree(tree, forwardDir);
    }
  }

  fellTree(tree, pushDir) {
    this.trees = this.trees.filter(t => t !== tree);
    const fallDir = pushDir ? new THREE.Vector3(pushDir.x, 0, pushDir.z).normalize() : tree.fallDirection;

    sounds.playTreeFall();

    this.fallingTrees.push({
      mesh: tree.mesh,
      position: tree.position,
      fallDir: fallDir,
      fallAngle: 0,
      angularVelocity: 0.02,
      scale: tree.scale
    });
  }

  update(delta) {
    for (let i = this.fallingTrees.length - 1; i >= 0; i--) {
      const ft = this.fallingTrees[i];
      ft.angularVelocity += 1.8 * delta;
      ft.fallAngle += ft.angularVelocity * delta;

      const rotAxis = new THREE.Vector3(-ft.fallDir.z, 0, ft.fallDir.x);
      if (rotAxis.lengthSq() < 0.001) rotAxis.set(1, 0, 0);
      rotAxis.normalize();

      ft.mesh.rotateOnWorldAxis(rotAxis, ft.angularVelocity * delta);

      if (ft.fallAngle >= Math.PI * 0.48) {
        this.spawnWoodLogs(ft.position, ft.scale);
        this.scene.remove(ft.mesh);
        this.fallingTrees.splice(i, 1);
      }
    }

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.mesh.rotation.y += 1.6 * delta;
      p.mesh.position.y = p.baseY + Math.sin(Date.now() * 0.003 + p.seed) * 0.15;
    }

    if (this.extractionActive && this.rescueHelicopter) {
      this.extractionTimer -= delta;
      if (this.rescueHelicopter.position.y > 18.0) {
        this.rescueHelicopter.position.y -= 4.0 * delta;
      }
    }
  }

  spawnWoodLogs(pos, scale) {
    const logGeo = new THREE.CylinderGeometry(0.25, 0.25, 1.8, 6);
    const logMat = new THREE.MeshStandardMaterial({ color: 0x854d0e, roughness: 0.9 });

    for (let i = 0; i < 4; i++) {
      const log = new THREE.Mesh(logGeo, logMat);
      const offsetX = (Math.random() - 0.5) * 2.5;
      const offsetZ = (Math.random() - 0.5) * 2.5;
      const groundY = this.terrain.getHeightAt(pos.x + offsetX, pos.z + offsetZ);

      log.position.set(pos.x + offsetX, groundY + 0.3, pos.z + offsetZ);
      log.rotation.z = Math.PI * 0.5;
      log.rotation.y = Math.random() * Math.PI;
      this.scene.add(log);

      this.pickups.push({
        mesh: log,
        itemId: 'wood',
        count: 2,
        baseY: groundY + 0.3,
        seed: Math.random() * 10
      });
    }
  }

  spawnLootItem(pos, itemId, count) {
    let geo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
    let color = 0x38bdf8;
    if (itemId === 'raw_meat') color = 0xef4444;
    else if (itemId === 'behemoth_core') {
      geo = new THREE.DodecahedronGeometry(0.4, 1);
      color = 0x06b6d4;
    }

    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: color, metalness: 0.8 }));
    mesh.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.5, (Math.random() - 0.5) * 1.5));
    this.scene.add(mesh);

    this.pickups.push({
      mesh: mesh,
      itemId: itemId,
      count: count,
      baseY: mesh.position.y,
      seed: Math.random() * 10
    });
  }

  checkPickups(playerPos, inventory) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (p.mesh.position.distanceTo(playerPos) < 2.4) {
        inventory.addItem(p.itemId, p.count);
        sounds.playBuildSnap();
        this.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
      }
    }
  }

  harvestNode(node) {
    if (node.yieldId) {
      this.inventory.addItem(node.yieldId, node.yieldCount);
      sounds.playBuildSnap();
      this.scene.remove(node.mesh);
      this.resourceNodes = this.resourceNodes.filter(n => n !== node);
      return true;
    }
    return false;
  }

  activateExtraction(inventory) {
    if (this.extractionActive) return;

    const hasCore = inventory.getItemCount('behemoth_core') > 0;
    const hasComponents = inventory.getItemCount('component') >= 8 && inventory.getItemCount('scrap') >= 8;

    if (!hasCore && !hasComponents) {
      sounds.playMechanicalClick(0.6);
      window.showTacticalNotification?.('EXTRACTION LOCKED: Requires 1 Behemoth Power Core or 8 Components + 8 Scrap Metal!', 'warning');
      return;
    }

    if (hasCore) {
      inventory.consumeItem('behemoth_core', 1);
    } else {
      inventory.consumeItem('component', 8);
      inventory.consumeItem('scrap', 8);
    }

    this.extractionActive = true;
    this.extractionTimer = 60.0;
    sounds.playRaidAlarm();

    const heliGroup = new THREE.Group();
    const heliBody = new THREE.Mesh(
      new THREE.BoxGeometry(6, 3, 10),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9 })
    );
    heliGroup.add(heliBody);

    const searchlight = new THREE.SpotLight(0x38bdf8, 8, 80, Math.PI / 4, 0.4);
    searchlight.position.set(0, 0, 0);
    searchlight.target.position.set(0, -30, 0);
    heliGroup.add(searchlight);
    heliGroup.add(searchlight.target);

    const tower = this.landmarks.find(l => l.isObjective);
    heliGroup.position.set(tower.position.x, tower.position.y + 40, tower.position.z);
    this.scene.add(heliGroup);
    this.rescueHelicopter = heliGroup;

    window.showTacticalNotification?.('TRANSMISSION SENT! EXTRACTION VTOL INBOUND! SURVIVE AND REACH THE SUMMIT SEARCHLIGHT!', 'success');
  }
}
