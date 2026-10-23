# LiteCraft

**Minecraft structure viewer, builder and farm simulator that runs entirely in your browser.**

**Live:** https://jfsunday.github.io/litecraft/

- **View** `.litematic` (Litematica), `.schem` (WorldEdit / Sponge v1–v3) and `.nbt` (structure blocks), with layer slicing like Litematica
- **Build** with Minecraft-like placement rules: stairs, slabs, logs, doors and beds orient themselves, and fences, panes, walls, stairs and redstone dust connect automatically. Also includes box fill/hollow/replace/clear, undo/redo and a hotbar
- **Export** to `.litematic` (schematic version 7 for MC ≥ 1.20.5, version 6 below) or `.schem`, and share builds via a link
- **Official textures & models**: on first visit the official client jar is downloaded straight from Mojang's servers (like the launcher does) and cached in IndexedDB. Add resource packs (`.zip`, up to 64×) via the menu or drag & drop. Nothing is uploaded, and no Mojang files live in this repository. Without them, procedural textures are used
- **Farm simulation**
  - *Plants*: event-driven random-tick simulation using the Java Edition growth rules (hydration, row penalty, light, stems and fruit spots, cane/cactus/bamboo/kelp columns, nether wart, cocoa, berries), observer vs. interval harvesting, an efficiency heatmap and a live 3D timelapse
  - *Mobs*: Monte Carlo of the Java `NaturalSpawner` (pack spawning, 24/128 radius, light rules, per-mob hitboxes, heightmap y-range, mob cap, random despawn) in an ideal world. Mob AI is approximated by an average time-to-kill
- Material list with stacks and shulker boxes, light levels, spawnable-space overlay and spawn heatmap

UI language is German.

## Development

```bash
npm install
npm run dev        # http://localhost:7668
npm test           # NBT / litematic / schem round trips
npm run build
```

Block data (`src/data/blocks.json`: states, light, collision shapes) is generated from
[minecraft-data](https://github.com/PrismarineJS/minecraft-data) (MIT):

```bash
MCDATA=/path/to/node_modules/minecraft-data npm run gen:blocks -- 26.1
```

Pushing to `main` deploys to GitHub Pages via Actions.

## Notes

LiteCraft is not an official Minecraft product and is not affiliated with Mojang or Microsoft.
No Mojang assets are distributed with this repository.
