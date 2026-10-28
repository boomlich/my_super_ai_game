// ZONE ZERO: Static/dynamic obstacle collision (circles, oriented boxes, walkable ramps) on a spatial hash.
// Everything works in the XZ plane; each collider carries a vertical range so low obstacles can be stepped
// over and roofs overhead never block the player.
import * as THREE from 'three';

const STEP_HEIGHT = 0.5;

export class CollisionWorld {
  constructor(cellSize = 8) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this._push = new THREE.Vector2();
  }

  _key(cx, cz) {
    return cx * 73856093 ^ cz * 19349663;
  }

  _bounds(c) {
    if (c.kind === 'circle') return [c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r];
    const ext = Math.abs(Math.cos(c.rot)) * c.hx + Math.abs(Math.sin(c.rot)) * c.hz;
    const extZ = Math.abs(Math.sin(c.rot)) * c.hx + Math.abs(Math.cos(c.rot)) * c.hz;
    return [c.x - ext, c.z - extZ, c.x + ext, c.z + extZ];
  }

  _insert(c) {
    const [x0, z0, x1, z1] = this._bounds(c);
    c.cells = [];
    const s = this.cellSize;
    for (let cx = Math.floor(x0 / s); cx <= Math.floor(x1 / s); cx++) {
      for (let cz = Math.floor(z0 / s); cz <= Math.floor(z1 / s); cz++) {
        const key = this._key(cx, cz);
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = new Set();
          this.cells.set(key, bucket);
        }
        bucket.add(c);
        c.cells.push(bucket);
      }
    }
    return c;
  }

  // y0/y1: world-space vertical extent. owner is returned to callers on contact (structure, tree, node...).
  addCircle({ x, z, r, y0 = -Infinity, y1 = Infinity, owner = null, solid = true }) {
    return this._insert({ kind: 'circle', x, z, r, y0, y1, owner, solid });
  }

  addBox({ x, z, hx, hz, rot = 0, y0 = -Infinity, y1 = Infinity, owner = null, solid = true }) {
    return this._insert({ kind: 'box', x, z, hx, hz, rot, y0, y1, owner, solid });
  }

  // Walkable slope. Height rises linearly from `base` at local -z to `base + rise` at local +z.
  addRamp({ x, z, hx, hz, rot = 0, base, rise, owner = null }) {
    return this._insert({ kind: 'ramp', x, z, hx, hz, rot, base, rise, owner, solid: false });
  }

  remove(c) {
    if (!c || !c.cells) return;
    for (const bucket of c.cells) bucket.delete(c);
    c.cells = null;
  }

  _nearby(x, z, radius, fn) {
    const s = this.cellSize;
    const seen = new Set();
    for (let cx = Math.floor((x - radius) / s); cx <= Math.floor((x + radius) / s); cx++) {
      for (let cz = Math.floor((z - radius) / s); cz <= Math.floor((z + radius) / s); cz++) {
        const bucket = this.cells.get(this._key(cx, cz));
        if (!bucket) continue;
        for (const c of bucket) {
          if (seen.has(c)) continue;
          seen.add(c);
          fn(c);
        }
      }
    }
  }

  // Pushes `pos` (x/z) out of every solid obstacle that overlaps the actor's body.
  // Returns the first collider that pushed back (or null) so AI can react to what blocks it.
  resolve(pos, radius, feetY, height = 1.8, ignore = null) {
    let blocker = null;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this._nearby(pos.x, pos.z, radius + 2, (c) => {
        if (!c.solid) return;
        if (ignore && c.owner && ignore.includes(c.owner.type)) return;
        if (feetY >= c.y1 - STEP_HEIGHT || feetY + height <= c.y0) return;
        if (this._pushOut(c, pos, radius)) {
          moved = true;
          blocker = blocker || c;
        }
      });
      if (!moved) break;
    }
    return blocker;
  }

  _pushOut(c, pos, radius) {
    if (c.kind === 'circle') {
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const min = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) return false;
      const d = Math.sqrt(d2) || 0.0001;
      const k = (min - d) / d;
      pos.x += (d2 === 0 ? 1 : dx) * k;
      pos.z += dz * k;
      return true;
    }

    // Oriented box: work in the box's local frame
    const cos = Math.cos(c.rot);
    const sin = Math.sin(c.rot);
    const dx = pos.x - c.x;
    const dz = pos.z - c.z;
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    const cx = Math.max(-c.hx, Math.min(c.hx, lx));
    const cz = Math.max(-c.hz, Math.min(c.hz, lz));
    let px = lx - cx;
    let pz = lz - cz;
    const d2 = px * px + pz * pz;

    if (d2 >= radius * radius && !(d2 === 0)) return false;

    if (d2 === 0) {
      // Centre is inside the box: leave through the nearest face
      const gapX = c.hx - Math.abs(lx);
      const gapZ = c.hz - Math.abs(lz);
      if (gapX < gapZ) {
        px = (lx >= 0 ? 1 : -1) * (gapX + radius);
        pz = 0;
      } else {
        px = 0;
        pz = (lz >= 0 ? 1 : -1) * (gapZ + radius);
      }
    } else {
      const d = Math.sqrt(d2);
      const k = (radius - d) / d;
      px *= k;
      pz *= k;
    }

    // Local push back into world space
    pos.x += px * cos + pz * sin;
    pos.z += -px * sin + pz * cos;
    return true;
  }

  // Highest walkable surface under (x, z) that the actor can step onto from feetY
  surfaceHeight(x, z, feetY) {
    let best = -Infinity;
    this._nearby(x, z, 1, (c) => {
      if (c.kind !== 'ramp') return;
      const cos = Math.cos(c.rot);
      const sin = Math.sin(c.rot);
      const dx = x - c.x;
      const dz = z - c.z;
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      if (Math.abs(lx) > c.hx || Math.abs(lz) > c.hz) return;
      const h = c.base + c.rise * ((lz + c.hz) / (2 * c.hz));
      if (feetY >= h - 0.7 && h > best) best = h;
    });
    return best;
  }

  // First solid collider whose footprint contains (x, z) within `margin`; used for line-of-sight style checks
  blockedAt(x, z, y, margin = 0) {
    let hit = null;
    this._nearby(x, z, margin + 1, (c) => {
      if (hit || !c.solid || y < c.y0 || y > c.y1) return;
      if (c.kind === 'circle') {
        if (Math.hypot(x - c.x, z - c.z) < c.r + margin) hit = c;
      } else {
        const cos = Math.cos(c.rot);
        const sin = Math.sin(c.rot);
        const dx = x - c.x;
        const dz = z - c.z;
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        if (Math.abs(lx) < c.hx + margin && Math.abs(lz) < c.hz + margin) hit = c;
      }
    });
    return hit;
  }
}
