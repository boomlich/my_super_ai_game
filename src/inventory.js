// ZONE ZERO: Tactical Inventory, Storage Chests & Valheim Crafting System
import { sounds } from './audio.js';

export const ITEM_DEFS = {
  wood: { name: 'Timber Log', icon: '🪵', weight: 0.8, type: 'resource' },
  stone: { name: 'Field Stone', icon: '🪨', weight: 1.2, type: 'resource' },
  scrap: { name: 'Scrap Metal', icon: '🔩', weight: 1.0, type: 'resource' },
  charcoal: { name: 'Charcoal Lump', icon: '⬛', weight: 0.4, type: 'resource' },
  gunpowder: { name: 'Gunpowder', icon: '🧨', weight: 0.3, type: 'resource' },
  component: { name: 'Tech Component', icon: '🔌', weight: 0.4, type: 'resource' },
  cloth: { name: 'Tactical Fiber', icon: '🧵', weight: 0.2, type: 'resource' },
  behemoth_core: { name: 'Behemoth Power Core', icon: '💠', weight: 3.5, type: 'special' },

  ammo_rifle: { name: '5.56mm Mag (x30)', icon: '📦', weight: 0.5, type: 'ammo' },
  ammo_shotgun: { name: '12G Shells (x8)', icon: '🔴', weight: 0.4, type: 'ammo' },
  ammo_sniper: { name: '.338 Lapua (x5)', icon: '🟡', weight: 0.6, type: 'ammo' },
  grenade: { name: 'M67 Frag Grenade', icon: '💣', weight: 0.8, type: 'weapon' },

  raw_meat: { name: 'Raw Game Meat', icon: '🥩', weight: 0.6, type: 'food' },
  cooked_meat: { name: 'Charbroiled Steak', icon: '🍖', weight: 0.5, type: 'food' },
  mre: { name: 'Tactical MRE', icon: '🍱', weight: 0.5, type: 'food' },
  stew: { name: 'Canned Beef Stew', icon: '🥫', weight: 0.6, type: 'food' },
  energy_drink: { name: 'Hyper-Energy Drink', icon: '⚡', weight: 0.3, type: 'food' },
  berries: { name: 'Wild Bio-Berries', icon: '🫐', weight: 0.1, type: 'food' },
};

export const CRAFTING_RECIPES = [
  {
    id: 'ammo_rifle',
    name: '5.56mm NATO (x30)',
    icon: '📦',
    result: { id: 'ammo_rifle', count: 1 },
    reqs: { scrap: 2, gunpowder: 2 },
    station: 'field'
  },
  {
    id: 'ammo_shotgun',
    name: '12G Buckshot (x8)',
    icon: '🔴',
    result: { id: 'ammo_shotgun', count: 1 },
    reqs: { scrap: 2, gunpowder: 1, wood: 1 },
    station: 'field'
  },
  {
    id: 'ammo_sniper',
    name: '.338 Lapua Magnum (x5)',
    icon: '🟡',
    result: { id: 'ammo_sniper', count: 1 },
    reqs: { scrap: 3, gunpowder: 2, component: 1 },
    station: 'field'
  },
  {
    id: 'craft_grenade',
    name: 'M67 Frag Grenade (x2)',
    icon: '💣',
    result: { id: 'grenade', count: 2 },
    reqs: { scrap: 2, gunpowder: 2, component: 1 },
    station: 'field'
  },
  {
    id: 'craft_gunpowder',
    name: 'Gunpowder (x3)',
    icon: '🧨',
    result: { id: 'gunpowder', count: 3 },
    reqs: { charcoal: 2, scrap: 1 },
    station: 'field'
  },
  {
    id: 'synth_mre',
    name: 'Tactical MRE Ration',
    icon: '🍱',
    result: { id: 'mre', count: 1 },
    reqs: { stew: 1, berries: 2 },
    station: 'field'
  },
  {
    id: 'craft_energy',
    name: 'Hyper-Energy Drink',
    icon: '⚡',
    result: { id: 'energy_drink', count: 1 },
    reqs: { berries: 3, component: 1 },
    station: 'field'
  }
];

export class InventorySystem {
  constructor(survivalSystem) {
    this.survival = survivalSystem;
    this.maxWeight = 150.0;
    this.isOpen = false;

    this.items = [
      { id: 'wood', count: 24 },
      { id: 'stone', count: 14 },
      { id: 'scrap', count: 10 },
      { id: 'gunpowder', count: 8 },
      { id: 'charcoal', count: 4 },
      { id: 'component', count: 5 },
      { id: 'cloth', count: 6 },
      { id: 'grenade', count: 3 },
      { id: 'ammo_rifle', count: 3 },
      { id: 'ammo_shotgun', count: 2 },
      { id: 'ammo_sniper', count: 2 },
      { id: 'raw_meat', count: 3 },
      { id: 'mre', count: 2 },
      { id: 'energy_drink', count: 2 },
      { id: 'berries', count: 10 },
    ];

    this.domModal = document.getElementById('inventory-modal');
    this.domGrid = document.getElementById('inventory-grid');
    this.domCraftList = document.getElementById('craft-list');
    this.domWeight = document.getElementById('inv-weight-display');

    this.initUI();
  }

  toggle() {
    this.isOpen = !this.isOpen;
    if (this.domModal) {
      this.domModal.style.display = this.isOpen ? 'flex' : 'none';
      if (this.isOpen) {
        document.exitPointerLock?.();
        sounds.playMechanicalClick(1.1);
        this.render();
      } else {
        const canvas = document.getElementById('game-canvas');
        canvas?.requestPointerLock?.();
      }
    }
  }

  close() {
    if (this.isOpen) {
      this.isOpen = false;
      if (this.domModal) this.domModal.style.display = 'none';
      const canvas = document.getElementById('game-canvas');
      canvas?.requestPointerLock?.();
    }
  }

  getItemCount(id) {
    const item = this.items.find(i => i.id === id);
    return item ? item.count : 0;
  }

  addItem(id, count = 1) {
    const existing = this.items.find(i => i.id === id);
    if (existing) {
      existing.count += count;
    } else {
      this.items.push({ id, count });
    }
    this.render();
  }

  consumeItem(id, count = 1) {
    const existing = this.items.find(i => i.id === id);
    if (!existing || existing.count < count) return false;

    existing.count -= count;
    if (existing.count <= 0) {
      this.items = this.items.filter(i => i !== existing);
    }
    this.render();
    return true;
  }

  getWeight() {
    let total = 0;
    for (const item of this.items) {
      const def = ITEM_DEFS[item.id];
      if (def) total += def.weight * item.count;
    }
    return Math.round(total * 10) / 10;
  }

  canCraft(recipe) {
    for (const [resId, amount] of Object.entries(recipe.reqs)) {
      if (this.getItemCount(resId) < amount) {
        return false;
      }
    }
    return true;
  }

  craft(recipe) {
    if (!this.canCraft(recipe)) return false;

    for (const [resId, amount] of Object.entries(recipe.reqs)) {
      this.consumeItem(resId, amount);
    }

    this.addItem(recipe.result.id, recipe.result.count);
    sounds.playBuildSnap();
    window.showTacticalNotification?.(`CRAFTED: ${recipe.name}`, 'success');
    this.render();
    return true;
  }

  initUI() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        this.toggle();
      } else if (e.code === 'Escape' && this.isOpen) {
        this.close();
      }
    });

    if (this.domModal) {
      this.domModal.addEventListener('click', (e) => {
        if (e.target === this.domModal) {
          this.close();
        }
      });
    }

    this.render();
  }

  render() {
    if (this.domWeight) {
      this.domWeight.textContent = `WEIGHT: ${this.getWeight().toFixed(1)} / ${this.maxWeight.toFixed(1)} KG`;
    }

    if (this.domGrid) {
      this.domGrid.innerHTML = '';
      const totalSlots = 20;
      for (let i = 0; i < totalSlots; i++) {
        const item = this.items[i];
        const slotEl = document.createElement('div');
        slotEl.className = 'inv-slot';

        if (item) {
          const def = ITEM_DEFS[item.id];
          if (def) {
            slotEl.innerHTML = `
              <div class="inv-slot-icon">${def.icon}</div>
              <div class="inv-slot-name">${def.name}</div>
              <div class="inv-slot-qty">${item.count}</div>
            `;
            if (def.type === 'food') {
              slotEl.title = `Click to Eat (+Max HP/Stam)`;
              slotEl.style.cursor = 'pointer';
              slotEl.addEventListener('click', () => {
                if (this.survival.eatFood(item.id)) {
                  this.consumeItem(item.id, 1);
                }
              });
            }
          }
        } else {
          slotEl.style.opacity = '0.3';
        }
        this.domGrid.appendChild(slotEl);
      }
    }

    if (this.domCraftList) {
      this.domCraftList.innerHTML = '';
      for (const recipe of CRAFTING_RECIPES) {
        const canAfford = this.canCraft(recipe);
        const card = document.createElement('div');
        card.className = 'craft-card';

        const reqsText = Object.entries(recipe.reqs)
          .map(([res, amt]) => `${amt} ${ITEM_DEFS[res]?.name || res}`)
          .join(', ');

        card.innerHTML = `
          <div class="craft-info">
            <div style="font-size: 26px;">${recipe.icon}</div>
            <div class="craft-details">
              <span class="craft-item-name">${recipe.name}</span>
              <span class="craft-reqs">Requires: ${reqsText}</span>
            </div>
          </div>
          <button class="craft-btn" ${canAfford ? '' : 'disabled'}>CRAFT</button>
        `;

        const btn = card.querySelector('.craft-btn');
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.craft(recipe);
        });

        this.domCraftList.appendChild(card);
      }
    }
  }
}
