// ZONE ZERO: Valheim Modular Construction & Structural Physics System (Enhanced Selection)
import * as THREE from 'three';
import { sounds } from './audio.js';
import { buildStructure } from './structures.js';

export const BUILD_RECIPES = {
  campfire: {
    id: 'campfire',
    name: 'Campfire & Spit',
    icon: '🔥',
    cost: { wood: 5, stone: 4 },
    hp: 150,
    size: [1.2, 0.4, 1.2],
    color: 0xea580c
  },
  wood_barricade: {
    id: 'wood_barricade',
    name: 'Log Barricade',
    icon: '🪵',
    cost: { wood: 4 },
    hp: 220,
    size: [2.5, 1.2, 0.4],
    color: 0x854d0e
  },
  wood_wall: {
    id: 'wood_wall',
    name: 'Log Wall',
    icon: '🧱',
    cost: { wood: 6 },
    hp: 320,
    size: [3.0, 2.5, 0.4],
    color: 0x78350f
  },
  wood_window: {
    id: 'wood_window',
    name: 'Firing Slit Wall',
    icon: '🪟',
    cost: { wood: 6 },
    hp: 300,
    size: [3.0, 2.5, 0.4],
    color: 0x92400e
  },
  wood_door: {
    id: 'wood_door',
    name: 'Heavy Fort Door',
    icon: '🚪',
    cost: { wood: 6, scrap: 1 },
    hp: 280,
    size: [2.0, 2.4, 0.3],
    color: 0x581c87
  },
  wood_stairs: {
    id: 'wood_stairs',
    name: 'Watchtower Stairs',
    icon: '🪜',
    cost: { wood: 5 },
    hp: 200,
    size: [2.0, 2.0, 2.8],
    color: 0xa16207
  },
  wood_roof: {
    id: 'wood_roof',
    name: 'Roof Tile (Shelter)',
    icon: '🛖',
    cost: { wood: 4 },
    hp: 180,
    size: [3.2, 0.3, 3.2],
    color: 0x451a03
  },
  metal_spikes: {
    id: 'metal_spikes',
    name: 'Defensive Spikes',
    icon: '⚔️',
    cost: { wood: 6, scrap: 2 },
    hp: 250,
    size: [2.4, 1.0, 1.2],
    color: 0x64748b
  },
  sandbag: {
    id: 'sandbag',
    name: 'Sandbag Bunker',
    icon: '🛡️',
    cost: { stone: 8, scrap: 2 },
    hp: 600,
    size: [2.8, 1.1, 0.8],
    color: 0xca8a04
  },
  workbench: {
    id: 'workbench',
    name: 'Field Workbench',
    icon: '⚙️',
    cost: { wood: 10, scrap: 5 },
    hp: 350,
    size: [2.0, 1.2, 1.0],
    color: 0x475569
  },
  wooden_bed: {
    id: 'wooden_bed',
    name: 'Survivor Bed',
    icon: '🛏️',
    cost: { wood: 8, cloth: 2 },
    hp: 200,
    size: [1.4, 0.6, 2.4],
    color: 0x0369a1
  },
  storage_chest: {
    id: 'storage_chest',
    name: 'Storage Chest',
    icon: '📦',
    cost: { wood: 8, scrap: 2 },
    hp: 240,
    size: [1.4, 0.8, 0.9],
    color: 0xb45309
  }
};

export class BuildingSystem {
  constructor(scene, inventory) {
    this.scene = scene;
    this.inventory = inventory;
    this.active = false;
    this.selectedPieceKey = 'campfire';
    this.rotationY = 0;
    this.isMenuModalOpen = false;

    this.structures = [];
    this.ghostMesh = null;

    const ghostMat = (color) => {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.42, depthWrite: false });
      mat.color.multiplyScalar(1.6);
      return mat;
    };
    this.ghostFoundationMat = ghostMat(0x38bdf8);
    this.ghostSupportedMat = ghostMat(0x22c55e);
    this.ghostInvalidMat = ghostMat(0xef4444);
    this.ghostMaterial = this.ghostFoundationMat;

    this.domBuildMenu = document.getElementById('build-menu');
    this.domModal = document.getElementById('blueprint-modal');

    this.initUI();
    this.createGhostMesh();
  }

  initUI() {
    // 1. Mouse Wheel Scroll — cycle blueprints while in build mode (works even with pointer lock!)
    window.addEventListener('wheel', (e) => {
      if (!this.active || this.isMenuModalOpen) return;
      const keys = Object.keys(BUILD_RECIPES);
      const curIdx = keys.indexOf(this.selectedPieceKey);
      const nextIdx = e.deltaY > 0 ? (curIdx + 1) % keys.length : (curIdx - 1 + keys.length) % keys.length;
      this.selectPiece(keys[nextIdx]);
    }, { passive: true });

    // 3. Keyboard shortcuts: [B] opens full Blueprint modal, [R] rotates, [Q] / [Z] cycles, [Escape] closes modal
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isMenuModalOpen) {
        this.closeBlueprintModal();
        return;
      }

      if (!this.active) return;

      if (e.code === 'KeyR') {
        this.rotationY += Math.PI / 4;
        sounds.playMechanicalClick(1.4);
      } else if (e.code === 'KeyB') {
        this.toggleBlueprintModal();
      } else if (e.code === 'KeyQ') {
        const keys = Object.keys(BUILD_RECIPES);
        const curIdx = keys.indexOf(this.selectedPieceKey);
        const nextIdx = (curIdx - 1 + keys.length) % keys.length;
        this.selectPiece(keys[nextIdx]);
      } else if (e.code === 'KeyZ') {
        const keys = Object.keys(BUILD_RECIPES);
        const curIdx = keys.indexOf(this.selectedPieceKey);
        const nextIdx = (curIdx + 1) % keys.length;
        this.selectPiece(keys[nextIdx]);
      }
    });

    // 4. Modal clicks & close button
    const modal = document.getElementById('blueprint-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closeBlueprintModal();
        }
      });
    }

    const closeBtn = document.getElementById('blueprint-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeBlueprintModal();
      });
    }
  }

  toggleBlueprintModal() {
    this.domModal = this.domModal || document.getElementById('blueprint-modal');
    this.isMenuModalOpen = !this.isMenuModalOpen;
    if (this.domModal) {
      this.domModal.style.display = this.isMenuModalOpen ? 'flex' : 'none';
      if (this.isMenuModalOpen) {
        document.exitPointerLock?.();
        this.renderBlueprintModal();
      } else {
        const canvas = document.getElementById('game-canvas');
        canvas?.requestPointerLock?.();
      }
    }
  }

  closeBlueprintModal() {
    this.domModal = this.domModal || document.getElementById('blueprint-modal');
    this.isMenuModalOpen = false;
    if (this.domModal) this.domModal.style.display = 'none';
    const canvas = document.getElementById('game-canvas');
    canvas?.requestPointerLock?.();
  }

  renderBlueprintModal() {
    const grid = document.getElementById('blueprint-grid');
    if (!grid) return;
    grid.innerHTML = '';

    for (const [key, recipe] of Object.entries(BUILD_RECIPES)) {
      const card = document.createElement('div');
      card.className = `blueprint-card ${key === this.selectedPieceKey ? 'selected' : ''}`;
      const canAfford = this.canAfford(recipe);

      const costText = Object.entries(recipe.cost)
        .map(([res, amt]) => `${amt} ${res}`)
        .join(', ');

      card.innerHTML = `
        <div style="font-size: 32px;">${recipe.icon}</div>
        <div style="font-weight: bold; font-size: 14px; margin-top: 4px; color: ${canAfford ? '#f8fafc' : '#94a3b8'};">${recipe.name}</div>
        <div style="font-family: 'Share Tech Mono', monospace; font-size: 11px; color: #38bdf8;">${costText}</div>
        <div style="font-size: 10px; color: #64748b; margin-top: 2px;">HP: ${recipe.hp}</div>
      `;

      card.addEventListener('click', () => {
        this.selectPiece(key);
        this.closeBlueprintModal();
      });

      grid.appendChild(card);
    }
  }

  setActive(active) {
    this.active = active;
    if (this.domBuildMenu) {
      this.domBuildMenu.style.display = active ? 'flex' : 'none';
    }
    if (this.ghostMesh) {
      this.ghostMesh.visible = active;
    }
    if (!active && this.isMenuModalOpen) {
      this.closeBlueprintModal();
    }
  }

  selectPiece(pieceKey) {
    if (!BUILD_RECIPES[pieceKey]) return;
    this.selectedPieceKey = pieceKey;

    // Update bottom UI highlight
    const btns = document.querySelectorAll('.build-item-btn');
    btns.forEach(btn => {
      if (btn.dataset.build === pieceKey) btn.classList.add('active');
      else btn.classList.remove('active');
    });

    this.createGhostMesh();
    sounds.playMechanicalClick(1.25);
    window.showTacticalNotification?.(`BLUEPRINT SELECTED: ${BUILD_RECIPES[pieceKey].name} &bull; [Scroll / Q] to cycle &bull; [R] to rotate`, 'info');
  }

  createGhostMesh() {
    if (this.ghostMesh) {
      this.scene.remove(this.ghostMesh);
    }

    const recipe = BUILD_RECIPES[this.selectedPieceKey];
    if (!recipe) return;

    this.ghostMesh = buildStructure(recipe, { forGhost: true });
    this.ghostMesh.visible = this.active;
    this.setGhostMaterial(this.ghostMaterial);
    this.scene.add(this.ghostMesh);
  }

  setGhostMaterial(mat) {
    this.ghostMaterial = mat;
    this.ghostMesh?.traverse((child) => {
      if (child.isMesh) {
        child.material = mat;
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });
  }

  canAfford(recipe) {
    for (const [res, amt] of Object.entries(recipe.cost)) {
      if (this.inventory.getItemCount(res) < amt) {
        return false;
      }
    }
    return true;
  }

  updateGhost(aimRay, terrain) {
    if (!this.active || !this.ghostMesh) return;

    const recipe = BUILD_RECIPES[this.selectedPieceKey];
    if (!recipe) return;

    const targetPoint = new THREE.Vector3();
    let hitFound = false;

    // Raymarch along aim direction to detect terrain hit accurately
    for (let dist = 1.5; dist <= 10.0; dist += 0.5) {
      const p = aimRay.origin.clone().addScaledVector(aimRay.direction, dist);
      const gy = terrain.getHeightAt(p.x, p.z);
      if (p.y <= gy + 0.35) {
        targetPoint.copy(p);
        targetPoint.y = gy;
        hitFound = true;
        break;
      }
    }

    if (!hitFound) {
      targetPoint.copy(aimRay.origin).addScaledVector(aimRay.direction, 5.0);
      targetPoint.y = terrain.getHeightAt(targetPoint.x, targetPoint.z);
    }

    let snapped = false;
    let isFoundation = true;

    for (const s of this.structures) {
      if (s.position.distanceTo(targetPoint) < 3.2) {
        const offset = new THREE.Vector3().subVectors(targetPoint, s.position);
        if (recipe.id === 'wood_roof') {
          targetPoint.copy(s.position).add(new THREE.Vector3(0, 2.5, 0));
        } else if (recipe.id === 'wood_stairs') {
          targetPoint.copy(s.position).add(new THREE.Vector3(0, 1.8, recipe.size[2] * 0.7));
        } else {
          targetPoint.copy(s.position).add(offset.normalize().multiplyScalar(recipe.size[0]));
        }
        snapped = true;
        isFoundation = false;
        break;
      }
    }

    if (!snapped) {
      targetPoint.y += recipe.size[1] * 0.5;
      isFoundation = true;
    }

    this.ghostMesh.position.copy(targetPoint);
    this.ghostMesh.rotation.y = this.rotationY;

    const affordable = this.canAfford(recipe);
    const wanted = !affordable ? this.ghostInvalidMat : (isFoundation ? this.ghostFoundationMat : this.ghostSupportedMat);
    if (wanted !== this.ghostMaterial) this.setGhostMaterial(wanted);
  }

  placePiece() {
    if (!this.active || !this.ghostMesh || this.isMenuModalOpen) return false;

    const recipe = BUILD_RECIPES[this.selectedPieceKey];
    if (!recipe || !this.canAfford(recipe)) {
      sounds.playMechanicalClick(0.6);
      window.showTacticalNotification?.('INSUFFICIENT RESOURCES FOR BLUEPRINT', 'warning');
      return false;
    }

    for (const [res, amt] of Object.entries(recipe.cost)) {
      this.inventory.consumeItem(res, amt);
    }

    const piece = this.instantiateStructure(recipe, this.ghostMesh.position, this.ghostMesh.rotation.y);
    this.structures.push(piece);
    this.scene.add(piece.mesh);

    sounds.playBuildSnap();
    return true;
  }

  instantiateStructure(recipe, position, rotY) {
    const mesh = buildStructure(recipe);
    mesh.position.copy(position);
    mesh.rotation.y = rotY;

    return {
      type: recipe.id,
      name: recipe.name,
      hp: recipe.hp,
      maxHp: recipe.hp,
      position: mesh.position,
      size: recipe.size,
      mesh: mesh,
      recipe: recipe,
      isOpen: false,
      storage: recipe.id === 'storage_chest' ? [] : null
    };
  }

  toggleDoor(doorStruct) {
    if (doorStruct.type !== 'wood_door') return;
    doorStruct.isOpen = !doorStruct.isOpen;
    doorStruct.mesh.rotation.y += doorStruct.isOpen ? (Math.PI * 0.5) : (-Math.PI * 0.5);
    sounds.playDoorSound(doorStruct.isOpen);
  }

  dismantleTarget(raycaster) {
    if (!this.active || this.isMenuModalOpen) return false;

    const meshes = this.structures.map(s => s.mesh);
    const intersects = raycaster.intersectObjects(meshes, true);

    if (intersects.length > 0) {
      let hitMesh = intersects[0].object;
      while (hitMesh.parent && !meshes.includes(hitMesh)) {
        hitMesh = hitMesh.parent;
      }

      const structIdx = this.structures.findIndex(s => s.mesh === hitMesh);
      if (structIdx !== -1) {
        const s = this.structures[structIdx];
        for (const [res, amt] of Object.entries(s.recipe.cost)) {
          this.inventory.addItem(res, Math.max(1, Math.floor(amt * 0.8)));
        }
        this.scene.remove(s.mesh);
        this.structures.splice(structIdx, 1);
        sounds.playAxeChop();
        window.showTacticalNotification?.(`DISMANTLED: ${s.name} (Materials Reclaimed)`, 'info');
        return true;
      }
    }
    return false;
  }

  damageStructure(struct, amount) {
    struct.hp -= amount;
    if (struct.hp <= 0) {
      this.scene.remove(struct.mesh);
      this.structures = this.structures.filter(s => s !== struct);
      sounds.playTreeFall();
    }
  }
}
