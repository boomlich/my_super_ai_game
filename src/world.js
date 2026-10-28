// ZONE ZERO: World Generation — forests, rocks, grass, landmarks, pickups & Extraction Finale
import * as THREE from 'three';
import { sounds } from './audio.js';
import { plankTexture, metalTexture, glowTexture } from './textures.js';
import { HEIGHT_LIFT } from './terrain.js';
import {
  std, emissiveMat, shadowed, createPine, createBerryBush, createScrapPile, createCrate, createTent, strut,
  bunkerMaterial, sandbagMaterial, buildRockGeometry, buildBushGeometry, buildGrassTuft, createGrassMaterial,
  buildFlowerGeometry, createLootMesh, createHelicopter, createMineNode
} from './models.js';

export const NODE_KINDS = {
  stone: { name: 'Stone Boulder', label: 'Stone', hp: 120, item: 'stone', perHit: [1, 2], bonus: 3, scale: [1.5, 2.2], spark: 0xb8b2a6 },
  iron: { name: 'Iron Ore Vein', label: 'Scrap Metal', hp: 160, item: 'scrap', perHit: [1, 2], bonus: 3, scale: [1.3, 1.9], spark: 0xd9772b },
  crystal: { name: 'Tech Crystal Cluster', label: 'Tech Component', hp: 200, item: 'component', perHit: [1, 1], bonus: 2, scale: [1.2, 1.7], spark: 0x67e8f9 }
};

const TOWER_X = -120;
const TOWER_Z = -140;
const BUNKER_X = 60;
const BUNKER_Z = -40;

export class WorldManager {
  constructor(scene, terrain, inventory, particles = null, collision = null) {
    this.scene = scene;
    this.terrain = terrain;
    this.inventory = inventory;
    this.particles = particles;
    this.collision = collision;

    this.trees = [];
    this.fallingTrees = [];
    this.resourceNodes = [];
    this.pickups = [];
    this.landmarks = [];
    this.fireSources = [];
    this.mineNodes = [];
    this.respawningNodes = [];

    this.extractionActive = false;
    this.extractionTimer = 0;
    this.extractionDuration = 75;
    this.extractionReady = false;
    this.rescueHelicopter = null;
    this.heliParts = null;

    this.time = 0;
    this.beacon = null;

    this.spawnFloraAndResources();
    this.spawnMineNodes();
    this.spawnDecor();
    this.spawnLandmarks();
    this.initLootListener();
    this.initTrampleListener();
  }

  // Large creatures flatten trees they walk into
  initTrampleListener() {
    window.addEventListener('trample_tree', (e) => {
      const { tree, dir } = e.detail;
      if (tree && this.trees.includes(tree)) this.fellTree(tree, dir);
    });
  }

  initLootListener() {
    window.addEventListener('enemy_dropped_loot', (e) => {
      const { pos, itemId, count } = e.detail;
      this.spawnLootItem(pos, itemId, count);
    });
  }

  isFlat(x, z, maxDelta = 1.1) {
    const y = this.terrain.getHeightAt(x, z);
    return Math.abs(this.terrain.getHeightAt(x + 1.2, z) - y) < maxDelta && Math.abs(this.terrain.getHeightAt(x, z + 1.2) - y) < maxDelta;
  }

  nearLandmark(x, z, pad = 0) {
    return Math.hypot(x - BUNKER_X, z - BUNKER_Z) < 12 + pad
      || Math.hypot(x - TOWER_X, z - TOWER_Z) < 9 + pad
      || Math.hypot(x, z) < 10 + pad;
  }

  spawnFloraAndResources() {
    for (let i = 0; i < 900 && this.trees.length < 280; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 18 + Math.random() * 225;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = this.terrain.getHeightAt(x, z);

      if (y > 2.8 && y < 25 + HEIGHT_LIFT && !this.nearLandmark(x, z) && this.isFlat(x, z, 1.4)) {
        const treeGroup = createPine(y > 15 + HEIGHT_LIFT);
        treeGroup.position.set(x, y - 0.15, z);
        const scale = 0.8 + Math.random() * 0.65;
        treeGroup.scale.set(scale, scale * (0.95 + Math.random() * 0.15), scale);
        treeGroup.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(treeGroup);

        const owner = { type: 'tree', tree: null };
        const collider = this.collision?.addCircle({ x, z, r: 0.5 * scale, y0: y - 1, y1: y + 12, owner });
        const record = {
          mesh: treeGroup,
          collider,
          hp: 100,
          maxHp: 100,
          position: new THREE.Vector3(x, y, z),
          scale,
          height: 7.5 * scale,
          fallDirection: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize()
        };
        owner.tree = record;
        this.trees.push(record);
      }
    }

    for (let i = 0; i < 80 && this.resourceNodes.filter(n => n.type === 'berries').length < 35; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 10 + Math.random() * 140;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = this.terrain.getHeightAt(x, z);

      if (y > 2.8 && y < 18 + HEIGHT_LIFT && !this.nearLandmark(x, z)) {
        const bush = createBerryBush();
        bush.position.set(x, y - 0.05, z);
        bush.rotation.y = Math.random() * Math.PI * 2;
        const s = 0.9 + Math.random() * 0.4;
        bush.scale.setScalar(s);
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

    for (let i = 0; i < 70 && this.resourceNodes.filter(n => n.type === 'scrap').length < 25; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 25 + Math.random() * 180;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = this.terrain.getHeightAt(x, z);

      if (y > 2.8 && y < 26 + HEIGHT_LIFT && !this.nearLandmark(x, z)) {
        const scrap = createScrapPile();
        scrap.position.set(x, y - 0.05, z);
        scrap.rotation.y = Math.random() * Math.PI * 2;
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

  // Pickaxe deposits: stone in the lowlands, iron on the slopes, tech crystals near the summit
  spawnMineNodes() {
    const wl = this.terrain.waterLevel;
    const placed = [];
    const place = (kind, count, accept) => {
      let made = 0;
      for (let attempt = 0; attempt < 600 && made < count; attempt++) {
        const ang = Math.random() * Math.PI * 2;
        const r = 14 + Math.random() * 215;
        const x = Math.cos(ang) * r;
        const z = Math.sin(ang) * r;
        const y = this.terrain.getHeightAt(x, z);
        if (y < wl + 0.8 || this.nearLandmark(x, z, 4) || !this.terrain.isWalkable(x, z) || !accept(x, z, y)) continue;
        if (placed.some(p => Math.hypot(p.x - x, p.z - z) < 9)) continue;
        placed.push({ x, z });
        this.addMineNode(kind, x, y, z);
        made++;
      }
    };
    const peakDist = (x, z) => Math.hypot(x - TOWER_X, z - TOWER_Z);
    place('stone', 34, (x, z, y) => y < 22 + HEIGHT_LIFT && this.isFlat(x, z, 1.6));
    place('iron', 16, (x, z, y) => y > 8 + HEIGHT_LIFT && y < 30 + HEIGHT_LIFT && peakDist(x, z) < 150);
    place('crystal', 7, (x, z, y) => y > 15 + HEIGHT_LIFT && peakDist(x, z) < 95);
  }

  addMineNode(kind, x, y, z) {
    const def = NODE_KINDS[kind];
    const mesh = createMineNode(kind, Math.floor(Math.random() * 50));
    const baseScale = def.scale[0] + Math.random() * (def.scale[1] - def.scale[0]);
    mesh.position.set(x, y + 0.1, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.scale.set(baseScale, baseScale * (0.85 + Math.random() * 0.3), baseScale);
    this.scene.add(mesh);

    const radius = baseScale * 0.9;
    const node = {
      mesh, kind, name: def.name, def,
      hp: def.hp, maxHp: def.hp,
      position: new THREE.Vector3(x, y, z),
      radius, baseScale, baseY: mesh.position.y,
      shake: 0, collider: null
    };
    node.collider = this.collision?.addCircle({ x, z, r: radius, y0: y - 1, y1: y + baseScale * 1.4, owner: { type: 'node', node } }) ?? null;
    this.mineNodes.push(node);
    return node;
  }

  // Applies a pickaxe blow. Returns { items: [{id, count}], broken }
  damageNode(node, damage) {
    const def = node.def;
    node.hp -= damage;
    node.shake = 0.3;
    const frac = Math.max(0, node.hp / node.maxHp);
    node.mesh.scale.setScalar(node.baseScale * (0.7 + 0.3 * frac));

    const count = def.perHit[0] + Math.floor(Math.random() * (def.perHit[1] - def.perHit[0] + 1));
    const items = [{ id: def.item, count }];
    let broken = false;
    if (node.hp <= 0) {
      broken = true;
      items.push({ id: def.item, count: def.bonus });
      this.collision?.remove(node.collider);
      node.collider = null;
      node.mesh.visible = false;
      this.respawningNodes.push({ node, timer: 240 });
    }
    return { items, broken };
  }

  updateNodes(delta) {
    for (const n of this.mineNodes) {
      if (n.shake > 0) {
        n.shake = Math.max(0, n.shake - delta * 1.6);
        n.mesh.position.x = n.position.x + (Math.random() - 0.5) * n.shake * 0.12;
        n.mesh.position.z = n.position.z + (Math.random() - 0.5) * n.shake * 0.12;
      }
    }
    for (let i = this.respawningNodes.length - 1; i >= 0; i--) {
      const r = this.respawningNodes[i];
      r.timer -= delta;
      if (r.timer <= 0) {
        const n = r.node;
        n.hp = n.maxHp;
        n.mesh.scale.setScalar(n.baseScale);
        n.mesh.visible = true;
        n.collider = this.collision?.addCircle({
          x: n.position.x, z: n.position.z, r: n.radius,
          y0: n.position.y - 1, y1: n.position.y + n.baseScale * 1.4, owner: { type: 'node', node: n }
        }) ?? null;
        this.respawningNodes.splice(i, 1);
      }
    }
  }

  // Non-interactive set dressing: grass, flowers, boulders, undergrowth
  spawnDecor() {
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const wl = this.terrain.waterLevel;

    // Grass
    const grassCount = 26000;
    const grass = new THREE.InstancedMesh(buildGrassTuft(), createGrassMaterial(), grassCount);
    let n = 0;
    for (let a = 0; a < grassCount * 4 && n < grassCount; a++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 185;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      const y = this.terrain.getHeightAt(x, z);
      if (y < wl + 0.7 || y > 17 + HEIGHT_LIFT) continue;
      if (Math.hypot(x, z) < 5 || Math.hypot(x - BUNKER_X, z - BUNKER_Z) < 8) continue;
      if (!this.isFlat(x, z, 0.9)) continue;

      dummy.position.set(x, y - 0.03, z);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      const s = 0.75 + Math.random() * 0.7;
      dummy.scale.set(s, 0.8 + Math.random() * 0.7, s);
      dummy.updateMatrix();
      grass.setMatrixAt(n, dummy.matrix);
      const forest = Math.min(1, Math.hypot(x, z) / 140);
      const shade = 0.85 + Math.random() * 0.35 - forest * 0.2;
      color.setRGB(shade, shade * (0.95 + Math.random() * 0.1), shade * (0.7 + Math.random() * 0.25));
      grass.setColorAt(n, color);
      n++;
    }
    grass.count = n;
    grass.frustumCulled = false;
    this.scene.add(grass);

    // Flowers dotted through the meadow
    const flowerCount = 900;
    const flowers = new THREE.InstancedMesh(buildFlowerGeometry(), std(0xffffff, { vertexColors: true, roughness: 0.6 }), flowerCount);
    const palette = [0xffffff, 0xfff17a, 0xff7ab6, 0xa78bfa, 0xff8a4c, 0x7dd3fc];
    n = 0;
    for (let a = 0; a < flowerCount * 5 && n < flowerCount; a++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 130;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      const y = this.terrain.getHeightAt(x, z);
      if (y < wl + 0.9 || y > 12 + HEIGHT_LIFT || Math.hypot(x, z) < 6 || !this.isFlat(x, z, 0.8)) continue;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, Math.random() * 6, 0);
      dummy.scale.setScalar(0.8 + Math.random() * 0.6);
      dummy.updateMatrix();
      flowers.setMatrixAt(n, dummy.matrix);
      flowers.setColorAt(n, color.set(palette[Math.floor(Math.random() * palette.length)]));
      n++;
    }
    flowers.count = n;
    flowers.frustumCulled = false;
    this.scene.add(flowers);

    // Boulders (bigger and more frequent near the mountain)
    const rockCount = 150;
    const rocks = new THREE.InstancedMesh(buildRockGeometry(3), std(0xffffff, { vertexColors: true, roughness: 0.95 }), rockCount);
    n = 0;
    for (let a = 0; a < rockCount * 5 && n < rockCount; a++) {
      const nearPeak = Math.random() < 0.4;
      const ang = Math.random() * Math.PI * 2;
      const r = nearPeak ? Math.random() * 130 : 15 + Math.random() * 225;
      const x = (nearPeak ? TOWER_X : 0) + Math.cos(ang) * r;
      const z = (nearPeak ? TOWER_Z : 0) + Math.sin(ang) * r;
      const y = this.terrain.getHeightAt(x, z);
      if (y < wl + 0.2 || this.nearLandmark(x, z)) continue;
      dummy.position.set(x, y + 0.15, z);
      dummy.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.4);
      const s = (nearPeak ? 0.9 : 0.5) + Math.random() * (nearPeak ? 3.2 : 1.6);
      dummy.scale.set(s * (0.8 + Math.random() * 0.5), s * (0.7 + Math.random() * 0.5), s * (0.8 + Math.random() * 0.5));
      dummy.updateMatrix();
      rocks.setMatrixAt(n, dummy.matrix);
      this.collision?.addCircle({
        x, z, r: Math.max(dummy.scale.x, dummy.scale.z) * 0.85,
        y0: y - 1, y1: y + 0.15 + dummy.scale.y * 0.75, owner: { type: 'rock' }
      });
      const v = 0.8 + Math.random() * 0.4;
      rocks.setColorAt(n, color.setRGB(v, v, v));
      n++;
    }
    rocks.count = n;
    rocks.frustumCulled = false;
    shadowed(rocks);
    this.scene.add(rocks);

    // Undergrowth
    const shrubCount = 160;
    const shrubs = new THREE.InstancedMesh(buildBushGeometry(), std(0xffffff, { vertexColors: true, roughness: 0.92 }), shrubCount);
    n = 0;
    for (let a = 0; a < shrubCount * 5 && n < shrubCount; a++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 14 + Math.random() * 190;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      const y = this.terrain.getHeightAt(x, z);
      if (y < wl + 0.8 || y > 18 + HEIGHT_LIFT || this.nearLandmark(x, z)) continue;
      dummy.position.set(x, y - 0.05, z);
      dummy.rotation.set(0, Math.random() * 6, 0);
      dummy.scale.setScalar(0.6 + Math.random() * 1.0);
      dummy.updateMatrix();
      shrubs.setMatrixAt(n, dummy.matrix);
      const v = 0.8 + Math.random() * 0.35;
      shrubs.setColorAt(n, color.setRGB(v * (0.9 + Math.random() * 0.2), v, v * 0.9));
      n++;
    }
    shrubs.count = n;
    shrubs.frustumCulled = false;
    shadowed(shrubs);
    this.scene.add(shrubs);
  }

  spawnLandmarks() {
    this.buildBaseCamp();
    this.buildBunker();
    this.buildRadioTower();
  }

  buildBaseCamp() {
    const ground = this.terrain.getHeightAt(0, 0);
    const camp = new THREE.Group();
    camp.position.set(0, ground, 0);

    const deck = shadowed(new THREE.Mesh(
      new THREE.BoxGeometry(7, 0.16, 7),
      std(0xffffff, { map: plankTexture('#7a5230').clone(), roughness: 0.9 })
    ));
    deck.material.map.repeat.set(3, 3);
    deck.position.y = 0.08;
    camp.add(deck);

    // Fire pit
    const stone = std(0xffffff, { vertexColors: true, roughness: 0.95 });
    const stoneGeo = buildRockGeometry(7);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const rock = shadowed(new THREE.Mesh(stoneGeo, stone));
      rock.position.set(Math.cos(a) * 0.78, 0.2, Math.sin(a) * 0.78);
      rock.scale.set(0.22, 0.2, 0.22);
      rock.rotation.y = a * 3;
      camp.add(rock);
    }
    const ash = new THREE.Mesh(new THREE.CircleGeometry(0.7, 20), std(0x151413, { roughness: 1 }));
    ash.rotation.x = -Math.PI / 2;
    ash.position.y = 0.17;
    camp.add(ash);
    const barkMat = std(0xffffff, { map: plankTexture('#4a3220'), roughness: 0.95 });
    for (let i = 0; i < 4; i++) {
      const log = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.0, 7), barkMat));
      log.rotation.set(Math.PI / 2 - 0.35, (i / 4) * Math.PI * 2, 0);
      log.position.set(0, 0.3, 0);
      camp.add(log);
    }
    const embers = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16), emissiveMat(0xff5a14, 1.4));
    embers.rotation.x = -Math.PI / 2;
    embers.position.y = 0.19;
    camp.add(embers);

    const fireLight = new THREE.PointLight(0xff8a3a, 30, 18, 2);
    fireLight.position.set(0, 1.1, 0);
    camp.add(fireLight);
    this.fireSources.push({ position: new THREE.Vector3(0, ground + 0.2, 0), light: fireLight, base: 30 });

    // Seating logs
    for (const [x, z, ry] of [[2.2, 0, Math.PI / 2], [-2.1, 0.3, Math.PI / 2], [0.2, 2.2, 0]]) {
      const seat = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 1.9, 8), barkMat));
      seat.rotation.set(Math.PI / 2, 0, ry);
      seat.position.set(x, 0.38, z);
      camp.add(seat);
    }

    // Tents, crates, lantern post
    const tentA = createTent('#4b5d3a');
    tentA.position.set(-4.6, 0.1, -3.2);
    tentA.rotation.y = 0.5;
    const tentB = createTent('#5b4a32');
    tentB.position.set(4.9, 0.1, -3.6);
    tentB.rotation.y = -0.4;
    camp.add(tentA, tentB);

    const crateA = createCrate(0.9);
    crateA.position.set(-2.6, 0.16, -3.2);
    const crateB = createCrate(0.7);
    crateB.position.set(-1.6, 0.16, -3.5);
    crateB.rotation.y = 0.5;
    const crateC = createCrate(0.65);
    crateC.position.set(-2.3, 0.86, -3.3);
    crateC.rotation.y = 0.8;
    camp.add(crateA, crateB, crateC);

    const pole = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 8), std(0x2a2a2e, { metalness: 0.7, roughness: 0.5 })));
    pole.position.set(3.0, 1.4, 2.6);
    camp.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), emissiveMat(0xffd28a, 2.6));
    lamp.position.set(3.0, 2.75, 2.6);
    camp.add(lamp);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: new THREE.Color(1.2, 0.8, 0.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    halo.scale.setScalar(1.1);
    halo.position.copy(lamp.position);
    camp.add(halo);

    this.scene.add(camp);

    const col = this.collision;
    if (col) {
      const top = ground + 2.4;
      for (const t of [tentA, tentB]) {
        col.addBox({ x: t.position.x, z: t.position.z, hx: 1.3, hz: 1.6, rot: t.rotation.y, y0: ground, y1: top });
      }
      for (const c of [crateA, crateB, crateC]) {
        col.addBox({ x: c.position.x, z: c.position.z, hx: 0.42, hz: 0.42, rot: c.rotation.y, y0: ground, y1: ground + 1.5 });
      }
      col.addBox({ x: 2.2, z: 0, hx: 0.95, hz: 0.24, rot: 0, y0: ground, y1: ground + 0.9 });
      col.addBox({ x: -2.1, z: 0.3, hx: 0.95, hz: 0.24, rot: 0, y0: ground, y1: ground + 0.9 });
      col.addBox({ x: 0.2, z: 2.2, hx: 0.24, hz: 0.95, rot: 0, y0: ground, y1: ground + 0.9 });
      col.addCircle({ x: 3.0, z: 2.6, r: 0.12, y0: ground, y1: ground + 3 });
      col.addCircle({ x: 0, z: 0, r: 0.5, y0: ground + 0.1, y1: ground + 0.9 });
    }
  }

  buildBunker() {
    const y = this.terrain.getHeightAt(BUNKER_X, BUNKER_Z);
    const group = new THREE.Group();
    group.position.set(BUNKER_X, y, BUNKER_Z);
    const concrete = bunkerMaterial();
    const dark = std(0x0a0c0e, { roughness: 1 });
    const metal = std(0xffffff, { map: metalTexture('#4a5560'), metalness: 0.7, roughness: 0.55 });

    const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(12, 4, 10), concrete));
    body.material.map = body.material.map.clone();
    body.material.map.repeat.set(3, 1);
    body.position.y = 1.7;
    group.add(body);
    const slab = shadowed(new THREE.Mesh(new THREE.BoxGeometry(12.8, 0.45, 10.8), concrete));
    slab.position.y = 3.9;
    group.add(slab);
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.7, 0.3), dark);
    door.position.set(0, 1.35, 5.02);
    group.add(door);
    const frame = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2.7, 3.0, 0.2), metal));
    frame.position.set(0, 1.5, 5.0);
    group.add(frame);
    for (const x of [-4, 4]) {
      const slit = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 0.3), dark);
      slit.position.set(x, 2.4, 5.02);
      group.add(slit);
    }
    for (const x of [-3, 3]) {
      const vent = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.8, 10), metal));
      vent.position.set(x, 4.5, -1);
      group.add(vent);
    }
    const mast = strut(new THREE.Vector3(4, 4.1, 3), new THREE.Vector3(4, 8.5, 3), 0.05, metal);
    group.add(mast);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), emissiveMat(0xff2222, 4));
    bulb.position.set(4, 8.55, 3);
    group.add(bulb);

    const bag = sandbagMaterial();
    const bagGeo = new THREE.SphereGeometry(0.45, 10, 8);
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 5 - row; i++) {
        for (const side of [-1, 1]) {
          const b = shadowed(new THREE.Mesh(bagGeo, bag));
          b.scale.set(1.0, 0.45, 0.62);
          b.position.set(side * (3.8 + i * 0.85 + row * 0.4), 0.2 + row * 0.38, 6.3 + (i % 2) * 0.06);
          b.rotation.y = (Math.random() - 0.5) * 0.2;
          group.add(b);
        }
      }
    }
    const barrel = createScrapPile();
    barrel.position.set(-6.8, 0, 2);
    group.add(barrel);
    this.scene.add(group);

    this.collision?.addBox({ x: BUNKER_X, z: BUNKER_Z, hx: 6.3, hz: 5.3, rot: 0, y0: y, y1: y + 4.3, owner: { type: 'bunker' } });
  }

  buildRadioTower() {
    const y = this.terrain.getHeightAt(TOWER_X, TOWER_Z);
    const group = new THREE.Group();
    group.position.set(TOWER_X, y, TOWER_Z);
    const steel = std(0xffffff, { map: metalTexture('#c2751d'), metalness: 0.75, roughness: 0.45 });
    const darkSteel = std(0x2d333b, { metalness: 0.85, roughness: 0.4 });

    const height = 26;
    const baseHalf = 1.9;
    const topHalf = 0.55;
    const legPoint = (i, h) => {
      const t = h / height;
      const half = baseHalf + (topHalf - baseHalf) * t;
      const sx = i % 2 === 0 ? -1 : 1;
      const sz = i < 2 ? -1 : 1;
      return new THREE.Vector3(sx * half, h, sz * half);
    };
    for (let i = 0; i < 4; i++) group.add(strut(legPoint(i, 0), legPoint(i, height), 0.12, steel));

    const levels = 6;
    for (let l = 0; l < levels; l++) {
      const h0 = (l / levels) * height;
      const h1 = ((l + 1) / levels) * height;
      const ring = [[0, 1], [1, 3], [3, 2], [2, 0]];
      for (const [a, b] of ring) {
        group.add(strut(legPoint(a, h1), legPoint(b, h1), 0.06, steel));
        group.add(strut(legPoint(a, h0), legPoint(b === a ? 0 : b, h1), 0.045, steel));
      }
    }

    const platform = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 2.6), darkSteel));
    platform.position.y = height + 0.1;
    group.add(platform);
    group.add(strut(new THREE.Vector3(0, height, 0), new THREE.Vector3(0, height + 6, 0), 0.07, steel));

    const dish = shadowed(new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.32), std(0xdcdfe4, { metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide })));
    dish.position.set(0.9, height + 1.6, 0.9);
    dish.rotation.set(-1.0, 0.7, 0);
    group.add(dish);
    group.add(strut(new THREE.Vector3(0.9, height + 1.6, 0.9), new THREE.Vector3(0.65, height + 2.3, 0.55), 0.04, darkSteel));

    // Control shed + console
    const shed = shadowed(new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.5, 2.6), bunkerMaterial()));
    shed.position.set(4.2, 1.25, -1.0);
    group.add(shed);
    const roof = shadowed(new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.2, 3.0), darkSteel));
    roof.position.set(4.2, 2.6, -1.0);
    group.add(roof);
    const window_ = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.1), emissiveMat(0x2dd4ff, 1.6));
    window_.position.set(4.2, 1.5, 0.35);
    group.add(window_);

    const consoleMesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 0.8), std(0x1f3c4d, { metalness: 0.6, roughness: 0.4 })));
    consoleMesh.position.set(0, 0.55, 2);
    group.add(consoleMesh);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), emissiveMat(0x38bdf8, 2.2));
    screen.position.set(0, 1.0, 2.41);
    screen.rotation.x = -0.35;
    group.add(screen);
    this.consoleScreen = screen;

    // Aircraft warning beacon
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), emissiveMat(0xff2a2a, 3));
    bulb.position.set(0, height + 6.2, 0);
    group.add(bulb);
    const beaconLight = new THREE.PointLight(0xff3030, 700, 70, 2);
    beaconLight.position.set(0, height + 6.2, 0);
    group.add(beaconLight);
    this.beacon = { bulb, light: beaconLight, base: 700 };

    this.scene.add(group);

    const col = this.collision;
    if (col) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        col.addCircle({ x: TOWER_X + sx * 1.8, z: TOWER_Z + sz * 1.8, r: 0.32, y0: y, y1: y + 30 });
      }
      col.addBox({ x: TOWER_X + 4.2, z: TOWER_Z - 1.0, hx: 1.7, hz: 1.4, rot: 0, y0: y, y1: y + 2.7 });
      col.addBox({ x: TOWER_X, z: TOWER_Z + 2, hx: 0.65, hz: 0.45, rot: 0, y0: y, y1: y + 1.1 });
    }
    this.landmarks.push({
      name: 'RADIO RELAY STATION',
      position: new THREE.Vector3(TOWER_X, y, TOWER_Z),
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
    this.collision?.remove(tree.collider);
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
    this.time += delta;
    this.updateNodes(delta);

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
        this.treeImpactFX(ft);
        this.scene.remove(ft.mesh);
        this.fallingTrees.splice(i, 1);
      }
    }

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.mesh.rotation.y += 1.6 * delta;
      p.mesh.position.y = p.baseY + Math.sin(this.time * 3 + p.seed) * 0.15;
    }

    // Fire flicker
    for (const f of this.fireSources) {
      f.light.intensity = f.base * (0.8 + 0.2 * Math.sin(this.time * 17 + 1.3) + 0.12 * Math.sin(this.time * 41) + (Math.random() - 0.5) * 0.12);
    }

    // Beacon pulse
    if (this.beacon) {
      const pulse = Math.pow(Math.max(0, Math.sin(this.time * 2.0)), 3);
      this.beacon.light.intensity = this.beacon.base * pulse;
      this.beacon.bulb.scale.setScalar(0.6 + pulse * 0.6);
    }
    if (this.consoleScreen) {
      this.consoleScreen.material.color.setRGB(0.15, 0.55 + Math.sin(this.time * 6) * 0.06, 0.95).multiplyScalar(2.2);
    }

    if (this.extractionActive && this.rescueHelicopter) {
      this.extractionTimer = Math.max(0, this.extractionTimer - delta);
      const k = Math.min(1, 1 - this.extractionTimer / this.extractionDuration);
      const eased = 1 - Math.pow(1 - k, 2);
      this.rescueHelicopter.position.y = this.heliStartY + (this.heliHoverY - this.heliStartY) * eased;
      this.extractionReady = this.extractionTimer <= 0;
      if (this.heliParts) {
        this.heliParts.rotor.rotation.y += 38 * delta;
        this.heliParts.tailRotor.rotation.x += 50 * delta;
      }
      this.rescueHelicopter.rotation.z = Math.sin(this.time * 1.4) * 0.025;
    }
  }

  treeImpactFX(ft) {
    if (!this.particles) return;
    const hit = ft.position.clone().addScaledVector(ft.fallDir, 7.5 * ft.scale * 0.85);
    hit.y = this.terrain.getHeightAt(hit.x, hit.z) + 0.2;
    const up = new THREE.Vector3(0, 1, 0);
    this.particles.createImpact(hit, up, 'wood');
    for (let i = 0; i < 14; i++) {
      this.particles.spawn({
        x: hit.x + (Math.random() - 0.5) * 2.5, y: hit.y, z: hit.z + (Math.random() - 0.5) * 2.5,
        vx: (Math.random() - 0.5) * 2.5, vy: 0.5 + Math.random() * 1.5, vz: (Math.random() - 0.5) * 2.5,
        life: 1.2 + Math.random() * 0.8, size0: 0.5, size1: 2.4, color: 0x8a7a5a, alpha: 0.4, drag: 1.4, fadeIn: 0.1
      });
    }
  }

  spawnWoodLogs(pos, scale) {
    for (let i = 0; i < 4; i++) {
      const log = createLootMesh('wood');
      const offsetX = (Math.random() - 0.5) * 2.5;
      const offsetZ = (Math.random() - 0.5) * 2.5;
      const groundY = this.terrain.getHeightAt(pos.x + offsetX, pos.z + offsetZ);

      log.position.set(pos.x + offsetX, groundY + 0.5, pos.z + offsetZ);
      log.rotation.y = Math.random() * Math.PI;
      this.scene.add(log);

      this.pickups.push({
        mesh: log,
        itemId: 'wood',
        count: 2,
        baseY: groundY + 0.5,
        seed: Math.random() * 10
      });
    }
  }

  spawnLootItem(pos, itemId, count) {
    const mesh = createLootMesh(itemId);
    mesh.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.6, (Math.random() - 0.5) * 1.5));
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
    this.extractionReady = false;
    this.extractionAnnounced = false;
    this.extractionDuration = 75.0;
    this.extractionTimer = this.extractionDuration;
    sounds.playRaidAlarm();

    const heli = createHelicopter();
    const heliGroup = heli.group;
    this.heliParts = heli;

    const searchlight = new THREE.SpotLight(0xbfe9ff, 900, 90, Math.PI / 7, 0.5, 1.6);
    searchlight.position.set(0, -1.5, 2);
    searchlight.target.position.set(0, -30, 4);
    heliGroup.add(searchlight);
    heliGroup.add(searchlight.target);

    const tower = this.landmarks.find(l => l.isObjective);
    this.heliStartY = tower.position.y + 45;
    this.heliHoverY = tower.position.y + 7.5;
    heliGroup.position.set(tower.position.x + 3, this.heliStartY, tower.position.z + 3);
    this.scene.add(heliGroup);
    this.rescueHelicopter = heliGroup;
    window.dispatchEvent(new CustomEvent('extraction_started'));

    window.showTacticalNotification?.('TRANSMISSION SENT! VTOL lands in 75 seconds — HOLD THE SUMMIT until it touches down!', 'success');
  }
}
