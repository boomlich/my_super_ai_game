// ZONE ZERO: Valheim Survival Mechanics (Food, Cooking, Vitals, Shelter & Comfort)
import { sounds } from './audio.js';

export const FOOD_DATABASE = {
  cooked_meat: {
    id: 'cooked_meat',
    name: 'Charbroiled Steak',
    icon: '🥩',
    maxHp: 65,
    maxStam: 30,
    hpRegen: 1.8,
    stamRegen: 1.2,
    duration: 220
  },
  mre: {
    id: 'mre',
    name: 'Tactical MRE',
    icon: '🍖',
    maxHp: 45,
    maxStam: 20,
    hpRegen: 1.2,
    stamRegen: 1.0,
    duration: 180
  },
  stew: {
    id: 'stew',
    name: 'Canned Beef Stew',
    icon: '🥫',
    maxHp: 35,
    maxStam: 30,
    hpRegen: 0.8,
    stamRegen: 1.5,
    duration: 160
  },
  energy_drink: {
    id: 'energy_drink',
    name: 'Hyper-Energy Drink',
    icon: '⚡',
    maxHp: 10,
    maxStam: 70,
    hpRegen: 0.2,
    stamRegen: 4.0,
    duration: 140
  },
  berries: {
    id: 'berries',
    name: 'Wild Bio-Berries',
    icon: '🫐',
    maxHp: 18,
    maxStam: 18,
    hpRegen: 0.5,
    stamRegen: 0.8,
    duration: 100
  },
  synth_ration: {
    id: 'synth_ration',
    name: 'Synthesized Ration',
    icon: '🥪',
    maxHp: 55,
    maxStam: 35,
    hpRegen: 1.5,
    stamRegen: 2.0,
    duration: 200
  }
};

// Meals should last a few in-game hours, not seconds: the first raid arrives after ~7 minutes
const FOOD_TIME_SCALE = 3.5;

export class SurvivalSystem {
  constructor() {
    this.baseMaxHp = 25;
    this.baseMaxStam = 50;

    this.currentHp = 25;
    this.currentStamina = 50;

    this.activeFoods = [];

    // Shelter & Comfort
    this.isSheltered = false;
    this.nearFire = false;
    this.comfortLevel = 1;
    this.restingTimer = 0;
    this.isRested = false;
    this.restedDuration = 0;

    // Campfire cooking station
    this.activeCooking = null; // { timer: number, status: string }

    // Environment
    this.isCold = false;
    this.isWet = false;
    this.isDead = false;

    // Cache DOM Elements
    this.domHealthBar = document.getElementById('health-bar');
    this.domHealthText = document.getElementById('health-text');
    this.domHealthTrack = document.getElementById('health-track');

    this.domStamBar = document.getElementById('stamina-bar');
    this.domStamText = document.getElementById('stamina-text');
    this.domStamTrack = document.getElementById('stamina-track');

    this.domBadgeRested = document.getElementById('badge-rested');
    this.domComfortLevel = document.getElementById('comfort-level');
    this.domBadgeShelter = document.getElementById('badge-shelter');
    this.domBadgeCold = document.getElementById('badge-cold');
    this.domBadgeWet = document.getElementById('badge-wet');
    this.domDamageVignette = document.getElementById('damage-vignette');

    this.foodSlots = [
      document.getElementById('food-slot-1'),
      document.getElementById('food-slot-2'),
      document.getElementById('food-slot-3'),
    ];

    // Seed initial food
    this.eatFood('cooked_meat');
    this.eatFood('berries');
  }

  eatFood(foodKey) {
    const foodDef = FOOD_DATABASE[foodKey];
    if (!foodDef) return false;

    const existingIndex = this.activeFoods.findIndex(f => f.id === foodDef.id);
    if (existingIndex !== -1) return false;

    if (this.activeFoods.length >= 3) {
      this.activeFoods.shift();
    }

    const foodItem = {
      ...foodDef,
      remaining: foodDef.duration * FOOD_TIME_SCALE,
      totalDuration: foodDef.duration * FOOD_TIME_SCALE
    };

    this.activeFoods.push(foodItem);
    sounds.playEatSound();

    this.currentHp = Math.min(this.getMaxHp(), this.currentHp + foodDef.maxHp * 0.4);
    this.currentStamina = Math.min(this.getMaxStamina(), this.currentStamina + foodDef.maxStam * 0.5);

    this.updateHUD();
    return true;
  }

  startCampfireCooking() {
    if (this.activeCooking) return false;
    this.activeCooking = { timer: 0, status: 'cooking' };
    sounds.playSizzle();
    window.showTacticalNotification?.('SIZZLING: Raw Game Meat cooking on spit...', 'info');
    return true;
  }

  // Claim cooked meat safely without prematurely destroying cooking item
  claimCookedItem() {
    if (!this.activeCooking) return null;
    const t = this.activeCooking.timer;

    if (t < 4.5) {
      // Still cooking! Do not cancel!
      return null;
    }

    this.activeCooking = null;

    if (t >= 4.5 && t <= 10.0) {
      sounds.playBuildSnap();
      window.showTacticalNotification?.('CHEF: Charbroiled Steak cooked to perfection!', 'success');
      return 'cooked_meat';
    } else {
      sounds.playMechanicalClick(0.6);
      window.showTacticalNotification?.('BURNT: Meat charred into Charcoal (useful for gunpowder)!', 'warning');
      return 'charcoal';
    }
  }

  getMaxHp() {
    let total = this.baseMaxHp;
    for (const f of this.activeFoods) {
      const ratio = f.remaining / f.totalDuration;
      const decay = ratio < 0.2 ? (ratio / 0.2) : 1.0;
      total += f.maxHp * (0.5 + 0.5 * decay);
    }
    return Math.max(25, Math.round(total) || 25);
  }

  getMaxStamina() {
    let total = this.baseMaxStam;
    for (const f of this.activeFoods) {
      const ratio = f.remaining / f.totalDuration;
      const decay = ratio < 0.2 ? (ratio / 0.2) : 1.0;
      total += f.maxStam * (0.5 + 0.5 * decay);
    }
    return Math.max(50, Math.round(total) || 50);
  }

  takeDamage(amount) {
    if (this.isDead) return;
    this.currentHp = Math.max(0, this.currentHp - amount);

    if (this.domDamageVignette) {
      this.domDamageVignette.style.boxShadow = 'inset 0 0 100px rgba(239, 68, 68, 0.7)';
      setTimeout(() => {
        if (this.domDamageVignette) {
          this.domDamageVignette.style.boxShadow = 'inset 0 0 80px rgba(239, 68, 68, 0)';
        }
      }, 250);
    }

    if (this.currentHp <= 0) {
      this.die();
    }
    this.updateHUD();
  }

  die() {
    this.isDead = true;
    sounds.playMonsterGrowl(true);
    window.showTacticalNotification?.('CRITICAL: KIA &bull; RESPAWNING AT BASE CAMP', 'danger');
    setTimeout(() => {
      this.respawn();
    }, 1500);
  }

  respawn() {
    this.isDead = false;
    this.activeFoods = [];
    this.eatFood('cooked_meat');
    this.currentHp = this.getMaxHp();
    this.currentStamina = this.getMaxStamina();
    this.updateHUD();
  }

  consumeStamina(amount) {
    if (this.currentStamina >= amount) {
      this.currentStamina -= amount;
      this.updateHUD();
      return true;
    }
    return false;
  }

  update(delta, playerPos, worldStructures, isNight, isRaining) {
    if (this.isDead) return;

    if (this.activeCooking) {
      this.activeCooking.timer += delta;
    }

    for (let i = this.activeFoods.length - 1; i >= 0; i--) {
      const f = this.activeFoods[i];
      f.remaining -= delta;
      if (f.remaining <= 0) {
        this.activeFoods.splice(i, 1);
      }
    }

    const maxHp = this.getMaxHp();
    const maxStam = this.getMaxStamina();

    this.checkShelterAndComfort(playerPos, worldStructures);

    this.isCold = isNight && !this.nearFire;
    this.isWet = isRaining || (playerPos.y <= 2.2);

    if (this.isSheltered && this.nearFire) {
      this.restingTimer += delta;
      if (this.restingTimer >= 2.5 && !this.isRested) {
        this.isRested = true;
        this.restedDuration = 300 + (this.comfortLevel * 90);
        sounds.playRestedChime();
        window.showTacticalNotification?.(`RESTED BUFF ACQUIRED (COMFORT ${this.comfortLevel}) &bull; +100% STAMINA RECOVERY`, 'success');
      }
    } else {
      this.restingTimer = 0;
    }

    if (this.isRested) {
      this.restedDuration -= delta;
      if (this.restedDuration <= 0) {
        this.isRested = false;
      }
    }

    let baseHpRegen = 0.5;
    for (const f of this.activeFoods) {
      baseHpRegen += f.hpRegen;
    }
    if (this.isSheltered && this.nearFire) {
      baseHpRegen *= 2.2;
    }
    this.currentHp = Math.min(maxHp, this.currentHp + baseHpRegen * delta);

    let baseStamRegen = 15.0;
    for (const f of this.activeFoods) {
      baseStamRegen += f.stamRegen;
    }
    if (this.isRested) {
      baseStamRegen *= 2.0;
    }
    if (this.isCold) {
      baseStamRegen *= 0.7;
    }
    if (this.isWet) {
      baseStamRegen *= 0.8;
    }

    this.currentStamina = Math.min(maxStam, this.currentStamina + baseStamRegen * delta);
    this.updateHUD();
  }

  checkShelterAndComfort(pos, structures) {
    let nearFire = false;
    let hasRoof = false;
    const uniqueComfortPieces = new Set();

    if (structures && structures.length > 0) {
      for (const piece of structures) {
        const dist = piece.position.distanceTo(pos);
        if (dist < 7.5) {
          uniqueComfortPieces.add(piece.type);
          if (piece.type === 'campfire' && dist < 6.5) {
            nearFire = true;
          }
          if (piece.type === 'wood_roof' && dist < 5.5 && piece.position.y > pos.y) {
            hasRoof = true;
          }
        }
      }
    }

    this.nearFire = nearFire;
    this.isSheltered = hasRoof || (uniqueComfortPieces.size >= 3);

    let comfort = 1;
    if (this.nearFire) comfort++;
    if (this.isSheltered) comfort++;
    if (uniqueComfortPieces.has('wooden_bed')) comfort++;
    if (uniqueComfortPieces.has('workbench')) comfort++;
    if (uniqueComfortPieces.has('storage_chest')) comfort++;
    this.comfortLevel = Math.min(6, comfort);
  }

  updateHUD() {
    const maxHp = Math.max(1, this.getMaxHp());
    const maxStam = Math.max(1, this.getMaxStamina());

    if (this.domHealthTrack) {
      const targetWidth = Math.min(360, Math.max(180, (maxHp / 100) * 220));
      this.domHealthTrack.style.width = `${targetWidth}px`;
    }
    if (this.domStamTrack) {
      const targetWidth = Math.min(320, Math.max(160, (maxStam / 100) * 190));
      this.domStamTrack.style.width = `${targetWidth}px`;
    }

    if (this.domHealthBar) {
      const hpPct = Math.max(0, Math.min(100, (this.currentHp / maxHp) * 100));
      this.domHealthBar.style.width = `${hpPct}%`;
    }
    if (this.domHealthText) {
      this.domHealthText.textContent = `${Math.ceil(this.currentHp)} / ${maxHp} HP`;
    }

    if (this.domStamBar) {
      const stamPct = Math.max(0, Math.min(100, (this.currentStamina / maxStam) * 100));
      this.domStamBar.style.width = `${stamPct}%`;
    }
    if (this.domStamText) {
      this.domStamText.textContent = `${Math.ceil(this.currentStamina)} / ${maxStam} STAM`;
    }

    for (let i = 0; i < 3; i++) {
      const slotEl = this.foodSlots[i];
      if (!slotEl) continue;

      const food = this.activeFoods[i];
      if (food) {
        slotEl.classList.add('active');
        const iconEl = slotEl.querySelector('.food-slot-icon');
        const timerEl = slotEl.querySelector('.food-timer-bar');
        if (iconEl) iconEl.textContent = food.icon;
        if (timerEl) {
          const ratio = Math.max(0, Math.min(1, food.remaining / food.totalDuration));
          timerEl.style.width = `${ratio * 100}%`;
          timerEl.style.background = ratio < 0.2 ? '#ef4444' : '#f59e0b';
        }
      } else {
        slotEl.classList.remove('active');
        const iconEl = slotEl.querySelector('.food-slot-icon');
        const timerEl = slotEl.querySelector('.food-timer-bar');
        if (iconEl) iconEl.textContent = '—';
        if (timerEl) timerEl.style.width = '0%';
      }
    }

    if (this.domBadgeRested) {
      this.domBadgeRested.style.display = this.isRested ? 'flex' : 'none';
      if (this.domComfortLevel) this.domComfortLevel.textContent = this.comfortLevel;
    }
    if (this.domBadgeShelter) {
      this.domBadgeShelter.style.display = this.isSheltered ? 'flex' : 'none';
    }
    if (this.domBadgeCold) {
      this.domBadgeCold.style.display = this.isCold ? 'flex' : 'none';
    }
    if (this.domBadgeWet) {
      this.domBadgeWet.style.display = this.isWet ? 'flex' : 'none';
    }
  }
}
