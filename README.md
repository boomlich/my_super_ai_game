# ZONE ZERO: Outpost Valheim
### Modern 3D Tactical Shooter with Valheim Survival Mechanics

**ZONE ZERO** blends the high-stakes tactical gunplay of modern first-person shooters with the survival systems of **Valheim**:
- **Valheim Food Empowerment (No Starvation Death)**: Eat up to 3 distinct meals (Tactical MREs, Canned Stew, Energy Drinks, Wild Bio-Berries) to radically boost your Maximum Health, Maximum Stamina, and passive regeneration rates.
- **Shelter, Comfort & "Rested" Buff**: Build roofs overhead and stay near heat sources to gain the **RESTED** buff (+100% Stamina recovery, tighter weapon control). Suffer penalties from cold nights and rain storms if unprepared.
- **Physical Tree Felling & Woodcutting**: Fell pine trees with your Tactical Hatchet. Watch them tilt, drop with gravity, crash into the earth with massive thuds, and break into collectible timber logs.
- **Modular Field Construction**: Equip the Field Hammer (Slot 4) to snap-build sandbag bunkers, firing slits, full walls, roofs, workbenches, and storage crates with real-time holographic previews.
- **Modern Tactical Arsenal**:
  - **M4A1 Carbine**: Full-auto 5.56mm assault rifle with holographic Aim Down Sights (ADS) and recoil climb.
  - **SPAS-12 Shotgun**: 8-pellet buckshot spread with pump-action stopping power.
  - **AWM Sniper Rifle**: Long-range precision rifle with high-magnification scope and headshot lethality.
  - **Tactical Hatchet / Machete**: Melee swings and wood harvesting.
- **Hostile Biomes & Sector Raids ("The Wilds are Stirring...")**:
  - Face swift Forest Stalkers, armed Rogue PMC troopers taking cover, and **The Iron Behemoth** (a 4-meter cyber-mutant brute that pulverizes fortifications).
  - Periodic Raid Alerts summon waves of enemies that assault your fortified positions.
- **Extraction Objective**:
  - Navigate the dynamic fog-of-war wilderness toward the high Alpine Crags to reach the **Radio Relay Station** and broadcast extraction telemetry.

---

## Graphics

- **Render pipeline**: HDR render with 4x MSAA, bloom, ACES tone mapping and a cinematic grade pass (vignette, chromatic aberration, film grain, damage flash, sniper-scope mask, underwater distortion). Run `http://localhost:5173/?quality=low` to turn the post-processing chain off on weaker GPUs.
- **Sky & weather**: procedural sky dome with sun, moon, stars and animated clouds; dusk/dawn palettes, fog that tracks the horizon colour, rain streaks, overcast storms with lightning flashes.
- **Terrain & water**: biome colouring by slope/height/shoreline with procedural detail and bump in the shader; GPU-animated waves with fresnel reflections, sun glitter, shoreline foam and lake-bed caustics.
- **World**: faceted pine forests that sway in the wind, wind-animated instanced grass, flowers, boulders and undergrowth, a rebuilt base camp, bunker and lattice radio tower with a blinking beacon.
- **Characters & weapons**: animated Forest Stalkers, PMC troopers and the Iron Behemoth with glowing details; first-person weapon models with gloved hands, muzzle flash, tracers and shell casings.
- **FX**: pooled GPU particles (sparks, blood, smoke, fire, fireflies), explosion light flashes and procedural campfires.

---

## Quick Start / How to Run

1. Open a terminal in `c:\Dev\Repos\my_super_shooter`
2. Start the local development server:
   ```bash
   npm run dev
   ```
3. Open your browser at:
   `http://localhost:5173/`
4. Click **"DEPLOY TO OPERATIONAL ZONE"** to enter pointer lock mode and begin playing.

---

## Controls & Keybindings

| Key / Input | Action |
|---|---|
| **W, A, S, D** | Move forward, backward, strafe |
| **Mouse Look** | Aim / Look around |
| **Left Click** | Fire weapon / Swing Axe / Place structure (Hammer) |
| **Right Click (Hold)** | Aim Down Sights (ADS) / Dismantle targeted structure (Hammer) |
| **Shift (Hold)** | Sprint (Consumes Stamina) |
| **Space** | Jump (Consumes Stamina) |
| **C / Ctrl** | Crouch (Stabilizes recoil & weapon spread) |
| **R** | Reload weapon / Rotate building ghost piece 45° (Hammer) |
| **E** | Interact (Harvest berry bushes, salvage scrap caches) |
| **F** | Toggle Tactical Weapon Flashlight |
| **Tab** | Open Tactical Backpack & Field Crafting Menu |
| **1 - 5** | Hotbar: 1: M4A1, 2: Shotgun, 3: Sniper, 4: Hammer, 5: Hatchet |
