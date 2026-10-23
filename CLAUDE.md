# LiteCraft – Projektnotizen

Browser-App (Vite + TypeScript + three.js, kein Framework): Minecraft-Strukturen ansehen, bauen, simulieren.
Dev-Port **7668** (per `ports` reserviert). Deploy: GitHub Actions → Pages (`jfsunday/litecraft`).

## Architektur (src/)
- `nbt/nbt.ts` – NBT lesen/schreiben (LongArray als Uint32-Paare lo/hi), gzip via Compression Streams
- `formats/` – litematic (Version 7 ab DataVersion 3837, sonst 6; per javap aus Janoschs Litematica-Jars verifiziert), schem (Sponge v1–v3 Import, v2 Export), nbt (Strukturblock-Import), `clipboard.ts` (generisches JSON `litecraft-structure` v1 für Strg+C/V; optionale `noteblock`-Metadaten vom Notenblock-Generator)
- `world/world.ts` – Palette (State-Key → Uint16-ID, 0 = Luft) + 16³-Chunks, Block-Entities, Dirty-Tracking
- `blocks/` – `data.ts` (generiert aus minecraft-data: States, Licht, Kollisionsformen), `info.ts` (BlockInfo: opaque, Licht, Spawnregeln), `procmodel.ts`/`proctex.ts` (prozedurale Modelle/Texturen), `tint.ts`
- `assets/vanilla.ts` – Jar/Resourcepack-Stack lesen (eigener Zip-Reader), Blockstates (variants/multipart) + Modell-Vererbung; 26.x-Besonderheiten: Texturen als `{sprite, force_translucent}`, `shade_direction_override`, `light_emission`, Mehrachsen-Rotation
- `render/` – `model.ts` (MC-Modell-Baker inkl. uvlock), `mesher.ts` (Chunk-Mesh, AO, Culling, Fluids), `textures.ts` (DataArrayTexture, eine Layer pro Textur), `view.ts` (Szene, Shader, Render on demand)
- `editor/` – Raycast (DDA + Kollisionsboxen), `placement.ts` (MC-Platzierregeln + Verbindungs-Updates), History
- `sim/` – `light.ts` (Sky/Block-Licht BFS), `plants.ts` (Random-Tick-Eventsim), `mobs.ts` (NaturalSpawner-Montecarlo), `controller.ts` (Overlays, Zeitraffer), `redstone.ts` (reine Redstone-Sim nach Java-Regeln in Redstone-Ticks: Dust-Netze, Repeater inkl. Sperre/Pulsverlängerung, Komparator, Fackel, Knopf, Hebel, Notenblock; ändert die Welt nie), `noteaudio.ts` (Notenblock-Sounds: Mojang → Assets-Ordner/Zip → IndexedDB, sonst Synth), `player.ts` (Echtzeit-Abspielen, Glow-Overlay, Audio-Scheduling)
- `ui/` – DOM-Helfer, Panels, Dialoge, isometrische Block-Icons (2D-Canvas, gleiche Modelle)

## Wichtig
- **Keine Mojang-Assets ins Repo!** Texturen kommen nur lokal aus der Jar des Nutzers.
- Tests: `npm test` (Round-Trips). E2E/Screenshots: `python3 scripts/e2e.py` / `scripts/multishot.py` (headless Chrome, braucht laufenden Dev-Server).
- Blockdaten neu erzeugen: `MCDATA=../mc-companion/node_modules/minecraft-data npm run gen:blocks -- 26.1`
- Notenblock-Songs: Akzeptanztest `tests/redstone.test.mjs` (Fixture aus `~/Projekte/noteblock-music`, jeder Ton tick-genau). `resources.download.minecraft.net` sendet kein CORS → Fallback Assets-Ordner/Zip. E2E: `python3 scripts/e2e-noteblock.py`.
- `View.onFrame(fn)` erlaubt mehrere Frame-Listener (Zeitraffer + Redstone-Player).
- Ideen offen: echte Mob-KI/Wegfindung, Rotate beim Einfügen, Kolben/Observer/Behälter im Redstone, Entities rendern, deutsche Blocknamen.
