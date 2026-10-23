import type { Props, World } from '../world/world';

export interface DemoInfo {
  id: string;
  name: string;
  description: string;
  afk?: [number, number, number];
  baseY?: number;
}

type Put = (x: number, y: number, z: number, name: string, props?: Props) => void;

function writer(world: World): { put: Put; fill: (a: number[], b: number[], name: string, props?: Props) => void } {
  const put: Put = (x, y, z, name, props = {}) => world.setRaw(x, y, z, world.state(name, props));
  const fill = (a: number[], b: number[], name: string, props: Props = {}) => {
    for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++)
      for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++)
        for (let z = Math.min(a[2], b[2]); z <= Math.max(a[2], b[2]); z++) put(x, y, z, name, props);
  };
  return { put, fill };
}

function house(world: World) {
  const { put, fill } = writer(world);
  fill([-5, 0, -5], [13, 0, 12], 'grass_block', { snowy: 'false' });
  fill([0, 1, 0], [8, 1, 6], 'cobblestone');
  for (let y = 2; y <= 4; y++) {
    for (let x = 0; x <= 8; x++) { put(x, y, 0, 'oak_planks'); put(x, y, 6, 'oak_planks'); }
    for (let z = 0; z <= 6; z++) { put(0, y, z, 'oak_planks'); put(8, y, z, 'oak_planks'); }
    for (const [x, z] of [[0, 0], [8, 0], [0, 6], [8, 6]]) put(x, y, z, 'oak_log', { axis: 'y' });
  }
  fill([1, 2, 1], [7, 4, 5], 'air');
  fill([1, 1, 1], [7, 1, 5], 'spruce_planks');
  for (const x of [2, 6]) { put(x, 3, 0, 'glass_pane', { east: 'true', west: 'true', north: 'false', south: 'false', waterlogged: 'false' }); put(x, 3, 6, 'glass_pane', { east: 'true', west: 'true', north: 'false', south: 'false', waterlogged: 'false' }); }
  for (const z of [2, 4]) { put(0, 3, z, 'glass_pane', { north: 'true', south: 'true', east: 'false', west: 'false', waterlogged: 'false' }); put(8, 3, z, 'glass_pane', { north: 'true', south: 'true', east: 'false', west: 'false', waterlogged: 'false' }); }
  put(4, 2, 6, 'oak_door', { half: 'lower', facing: 'north', hinge: 'left', open: 'false', powered: 'false' });
  put(4, 3, 6, 'oak_door', { half: 'upper', facing: 'north', hinge: 'left', open: 'false', powered: 'false' });
  // gable roof along x
  for (let i = 0; i <= 3; i++) {
    const y = 5 + i;
    for (let x = -1; x <= 9; x++) {
      put(x, y, -1 + i, 'spruce_stairs', { facing: 'south', half: 'bottom', shape: 'straight', waterlogged: 'false' });
      put(x, y, 7 - i, 'spruce_stairs', { facing: 'north', half: 'bottom', shape: 'straight', waterlogged: 'false' });
    }
    for (let z = i; z <= 6 - i; z++) { put(0, y, z, 'oak_planks'); put(8, y, z, 'oak_planks'); }
  }
  for (let x = -1; x <= 9; x++) put(x, 9, 3, 'spruce_slab', { type: 'bottom', waterlogged: 'false' });
  fill([6, 5, 1], [6, 10, 1], 'bricks');
  put(6, 11, 1, 'campfire', { lit: 'true', facing: 'north', signal_fire: 'false', waterlogged: 'false' });
  put(4, 4, 3, 'lantern', { hanging: 'false', waterlogged: 'false' });
  put(2, 2, 1, 'crafting_table'); put(3, 2, 1, 'furnace', { facing: 'south', lit: 'true' }); put(1, 2, 1, 'chest', { facing: 'south', type: 'single', waterlogged: 'false' });
  put(6, 2, 4, 'red_bed', { facing: 'east', part: 'head', occupied: 'false' }); put(5, 2, 4, 'red_bed', { facing: 'east', part: 'foot', occupied: 'false' });
  put(7, 2, 1, 'bookshelf'); put(7, 3, 1, 'bookshelf');
  put(3, 3, 7, 'wall_torch', { facing: 'south' }); put(5, 3, 7, 'wall_torch', { facing: 'south' });
  for (let z = 7; z <= 12; z++) put(4, 0, z, 'dirt_path');
  for (const [x, z, f] of [[2, 8, 'poppy'], [6, 8, 'dandelion'], [1, 9, 'cornflower'], [7, 9, 'azure_bluet'], [-2, 3, 'oxeye_daisy'], [10, 2, 'allium']] as [number, number, string][]) put(x, 1, z, f);
  for (let x = -3; x <= 11; x++) { if (x === 4) continue; put(x, 1, 11, 'oak_fence', { east: x < 11 && x !== 3 ? 'true' : 'false', west: x > -3 && x !== 5 ? 'true' : 'false', north: 'false', south: 'false', waterlogged: 'false' }); }
  put(4, 1, 11, 'oak_fence_gate', { facing: 'south', in_wall: 'false', open: 'false', powered: 'false' });
  // tree
  fill([-3, 1, -3], [-3, 5, -3], 'oak_log', { axis: 'y' });
  for (let x = -5; x <= -1; x++) for (let z = -5; z <= -1; z++) for (let y = 4; y <= 7; y++) {
    const d = Math.abs(x + 3) + Math.abs(z + 3) + Math.max(0, y - 5) * 2;
    if (d <= 4 && !(x === -3 && z === -3 && y <= 5)) put(x, y, z, 'oak_leaves', { distance: '1', persistent: 'true', waterlogged: 'false' });
  }
  for (const [x, z] of [[11, -2], [11, 5], [-4, 6]]) put(x, 1, z, 'short_grass');
  fill([9, 0, 6], [11, 0, 8], 'water', { level: '0' });
  put(10, 1, 7, 'lily_pad');
}

function sugarcane(world: World) {
  const { put, fill } = writer(world);
  // Cane faces south (towards the default camera); pistons + observers sit behind it.
  const L = 14;
  fill([-1, 0, -1], [L, 0, 4], 'stone_bricks');
  for (let x = 0; x < L; x++) {
    put(x, 1, 3, 'water', { level: '0' });
    put(x, 1, 2, 'sand');
    put(x, 2, 2, 'sugar_cane', { age: '0' });
    if (x % 3 === 1) put(x, 3, 2, 'sugar_cane', { age: '0' });
    put(x, 3, 1, 'piston', { facing: 'south', extended: 'false' });
    put(x, 4, 1, 'observer', { facing: 'south', powered: 'false' });
    put(x, 1, 1, 'hopper', { facing: x === L - 1 ? 'down' : 'east', enabled: 'true' });
    put(x, 2, 1, 'smooth_stone');
    put(x, 1, 4, 'glass');
  }
  for (const x of [-1, L]) { fill([x, 1, 1], [x, 4, 3], 'stone_bricks'); }
  put(L, 1, 0, 'chest', { facing: 'north', type: 'single', waterlogged: 'false' });
  for (let x = 0; x < L; x += 4) put(x, 5, 1, 'lantern', { hanging: 'false', waterlogged: 'false' });
}

function fields(world: World) {
  const { put, fill } = writer(world);
  const field = (ox: number, kind: 'all' | 'rows' | 'dry') => {
    fill([ox - 1, 0, -1], [ox + 9, 0, 9], 'stone_bricks');
    for (let x = 0; x < 9; x++) for (let z = 0; z < 9; z++) {
      if (x === 4 && z === 4 && kind !== 'dry') { put(ox + x, 0, z, 'water', { level: '0' }); continue; }
      put(ox + x, 0, z, 'farmland', { moisture: kind === 'dry' ? '0' : '7' });
      const crop = kind === 'rows' && z % 2 === 1 ? 'carrots' : 'wheat';
      put(ox + x, 1, z, crop, { age: String(Math.min(7, (x * 3 + z * 5) % 8)) });
    }
    if (kind === 'dry') put(ox + 4, 1, 4, 'wheat', { age: '3' });
    for (const [x, z] of [[-1, -1], [9, -1], [-1, 9], [9, 9]]) { put(ox + x, 1, z, 'oak_fence', { north: 'false', south: 'false', east: 'false', west: 'false', waterlogged: 'false' }); put(ox + x, 2, z, 'torch'); }
  };
  field(0, 'all');
  field(13, 'rows');
  field(26, 'dry');
}

function pumpkins(world: World) {
  const { put, fill } = writer(world);
  const L = 12;
  fill([-1, 0, -1], [L, 0, 5], 'stone_bricks');
  for (let x = 0; x < L; x++) {
    put(x, 1, 0, 'dirt'); put(x, 1, 1, 'farmland', { moisture: '7' }); put(x, 1, 2, 'water', { level: '0' });
    put(x, 1, 3, 'farmland', { moisture: '7' }); put(x, 1, 4, 'dirt');
    put(x, 2, 1, 'pumpkin_stem', { age: '7' }); put(x, 2, 3, 'melon_stem', { age: '7' });
    if (x % 3 === 0) { put(x, 2, 0, 'pumpkin'); put(x, 2, 1, 'attached_pumpkin_stem', { facing: 'north' }); }
    if (x % 4 === 1) { put(x, 2, 4, 'melon'); put(x, 2, 3, 'attached_melon_stem', { facing: 'south' }); }
    put(x, 3, 0, 'observer', { facing: 'down', powered: 'false' });
    put(x, 3, 4, 'observer', { facing: 'down', powered: 'false' });
    put(x, 2, -1, 'piston', { facing: 'south', extended: 'false' });
    put(x, 2, 5, 'piston', { facing: 'north', extended: 'false' });
  }
  for (let x = 0; x < L; x += 3) put(x, 3, 2, 'glowstone');
}

function mobfarm(world: World) {
  const { put, fill } = writer(world);
  const R = 10;
  // kill chamber + AFK room
  fill([-3, 0, -3], [6, 0, 3], 'stone_bricks');
  fill([-3, 1, -3], [6, 3, -3], 'stone_bricks'); fill([-3, 1, 3], [6, 3, 3], 'stone_bricks');
  fill([-3, 1, -3], [-3, 3, 3], 'stone_bricks'); fill([6, 1, -3], [6, 3, 3], 'stone_bricks');
  fill([-3, 4, -3], [6, 4, 3], 'stone_brick_slab', { type: 'bottom', waterlogged: 'false' });
  put(0, 1, 0, 'hopper', { facing: 'east', enabled: 'true' }); put(1, 1, 0, 'chest', { facing: 'west', type: 'single', waterlogged: 'false' });
  put(4, 1, 0, 'torch'); put(4, 1, 2, 'crafting_table');
  fill([-1, 1, -1], [1, 3, -1], 'glass'); fill([-1, 1, 1], [1, 3, 1], 'glass'); put(-1, 2, 0, 'glass');
  put(2, 2, 0, 'stone_brick_slab', { type: 'top', waterlogged: 'false' });
  // drop shaft (1×1) from y=4 to the platforms
  for (let y = 4; y <= 23; y++) for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) put(dx, y, dz, 'cobblestone');
  // two spawning floors
  for (const floor of [24, 27]) {
    fill([-R - 1, floor, -R - 1], [R + 1, floor, R + 1], 'cobblestone');
    put(0, floor, 0, 'air');
    fill([-R - 1, floor + 1, -R - 1], [R + 1, floor + 2, -R - 1], 'cobblestone');
    fill([-R - 1, floor + 1, R + 1], [R + 1, floor + 2, R + 1], 'cobblestone');
    fill([-R - 1, floor + 1, -R - 1], [-R - 1, floor + 2, R + 1], 'cobblestone');
    fill([R + 1, floor + 1, -R - 1], [R + 1, floor + 2, R + 1], 'cobblestone');
    // Sources at the outer end, flowing towards the drop hole (level = distance from the source).
    for (let i = 1; i <= R; i++) {
      const level = i >= R - 1 ? '0' : String(Math.min(7, R - 1 - i));
      for (const [x, z] of [[i, 0], [-i, 0], [0, i], [0, -i]]) put(x, floor + 1, z, 'water', { level });
    }
  }
  fill([-R - 1, 30, -R - 1], [R + 1, 30, R + 1], 'cobblestone');
  fill([-R - 1, 31, -R - 1], [R + 1, 31, R + 1], 'stone_brick_slab', { type: 'bottom', waterlogged: 'false' });
}

export const DEMOS: (DemoInfo & { build: (w: World) => void })[] = [
  { id: 'house', name: 'Kleines Haus', description: 'Fachwerkhäuschen mit Satteldach, Möbeln und Garten. Zeigt Treppen, Zäune, Türen und Pflanzen.', build: house },
  { id: 'sugarcane', name: 'Zuckerrohr-Farm', description: 'Observer-/Kolben-Farm mit 14 Pflanzen. Starte die Pflanzen-Simulation und schau dir die Rate an.', build: sugarcane },
  { id: 'fields', name: 'Felder-Vergleich', description: 'Drei 9×9-Felder: alles Weizen, abwechselnde Reihen, trocken. Die Simulation zeigt, warum Reihen schneller wachsen.', build: fields },
  { id: 'pumpkins', name: 'Kürbis- & Melonenfarm', description: 'Stängel auf bewässertem Ackerboden mit freien Fruchtplätzen.', build: pumpkins },
  { id: 'mobfarm', name: 'Mob-Farm (Dark Room)', description: 'Zwei dunkle Spawnflächen mit Wasserkanälen und Fallschacht. AFK-Punkt in der Killkammer.', afk: [3, 1, 0], baseY: 160, build: mobfarm },
];
