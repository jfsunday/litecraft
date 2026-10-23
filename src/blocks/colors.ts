export type RGB = [number, number, number];

export const DYES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'] as const;
export type Dye = (typeof DYES)[number];

const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const table = (vals: number[]) => Object.fromEntries(DYES.map((d, i) => [d, hex(vals[i])])) as Record<Dye, RGB>;

export const WOOL = table([0xe9ecec, 0xf07613, 0xbd44b3, 0x3aafd9, 0xf8c527, 0x70b919, 0xed8dac, 0x3e4447, 0x8e8e86, 0x158991, 0x792aac, 0x35399d, 0x724728, 0x546d1b, 0xa12722, 0x141519]);
export const CONCRETE = table([0xcfd5d6, 0xe06100, 0xa9309f, 0x2389c6, 0xf0af15, 0x5ea818, 0xd5658e, 0x36393d, 0x7d7d73, 0x157788, 0x64209c, 0x2c2e8f, 0x603b1f, 0x495b24, 0x8e2020, 0x080a0f]);
export const TERRACOTTA = table([0xd1b2a1, 0xa15325, 0x95576c, 0x716c89, 0xba8523, 0x677534, 0xa04d4e, 0x392a23, 0x876a61, 0x575b5b, 0x764656, 0x4a3b5b, 0x4d3323, 0x4c532a, 0x8f3d2e, 0x251610]);
export const GLASS = table([0xf8f8f8, 0xd87f33, 0xb24cd8, 0x6699d8, 0xe5e533, 0x7fcc19, 0xf27fa5, 0x4c4c4c, 0x999999, 0x4c7f99, 0x7f3fb2, 0x334cb2, 0x664c33, 0x667f33, 0x993333, 0x191919]);

export const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped'] as const;
export type Wood = (typeof WOODS)[number];
export interface WoodColors { planks: RGB; bark: RGB; inner: RGB; leaves: RGB; mark?: RGB }
export const WOOD: Record<Wood, WoodColors> = {
  oak: { planks: hex(0xa2824e), bark: hex(0x6d5532), inner: hex(0xb4915a), leaves: hex(0x4a8c26) },
  spruce: { planks: hex(0x725430), bark: hex(0x3a2510), inner: hex(0x735934), leaves: hex(0x3d5e3d) },
  birch: { planks: hex(0xc4b37b), bark: hex(0xd8d7d2), inner: hex(0xc5b076), leaves: hex(0x62873c), mark: hex(0x2f2a26) },
  jungle: { planks: hex(0xa07350), bark: hex(0x554319), inner: hex(0xab8454), leaves: hex(0x378c19) },
  acacia: { planks: hex(0xa85a32), bark: hex(0x676157), inner: hex(0xae5c3b), leaves: hex(0x5a7823) },
  dark_oak: { planks: hex(0x422b14), bark: hex(0x3c2e1a), inner: hex(0x604c31), leaves: hex(0x3e6e1e) },
  mangrove: { planks: hex(0x753630), bark: hex(0x544229), inner: hex(0x77362f), leaves: hex(0x648c28) },
  cherry: { planks: hex(0xe2b2ac), bark: hex(0x351920), inner: hex(0xd79194), leaves: hex(0xe8afcd) },
  pale_oak: { planks: hex(0xe2d6ce), bark: hex(0x5c5550), inner: hex(0xe6dcd4), leaves: hex(0x767a6c) },
  bamboo: { planks: hex(0xc2ad50), bark: hex(0x7a8a2c), inner: hex(0xc9b35a), leaves: hex(0x6b9a2a) },
  crimson: { planks: hex(0x653046), bark: hex(0x5c191d), inner: hex(0x89395a), leaves: hex(0x8a1b1b) },
  warped: { planks: hex(0x2b6863), bark: hex(0x3a3a4d), inner: hex(0x399693), leaves: hex(0x167e86) },
};

/** Base colours for material keywords (first match wins, order matters). */
export const MATERIALS: [string, RGB][] = ([
  ['cobbled_deepslate', 0x4d4d51], ['deepslate', 0x505055], ['polished_blackstone', 0x35303a], ['blackstone', 0x2a2328],
  ['smooth_basalt', 0x48484e], ['basalt', 0x515156], ['red_nether', 0x460709], ['nether_brick', 0x2c161a], ['netherrack', 0x622626],
  ['nether_wart_block', 0x730302], ['warped_wart', 0x167e86], ['soul_soil', 0x4b392e], ['soul_sand', 0x513e32],
  ['end_stone', 0xdbde9e], ['purpur', 0xa97ea9], ['dark_prismarine', 0x335b4b], ['prismarine', 0x63a09a],
  ['quartz', 0xebe5de], ['red_sandstone', 0xba631d], ['red_sand', 0xbe6621], ['sandstone', 0xd8cb9b], ['sand', 0xdbd3a0],
  ['mossy_cobblestone', 0x6e7a5e], ['mossy_stone', 0x737a68], ['cobblestone', 0x7a7a7a], ['smooth_stone', 0x9e9e9e],
  ['stone_brick', 0x7a797a], ['granite', 0x956755], ['diorite', 0xbcbcbc], ['andesite', 0x888889], ['calcite', 0xdfe0dc],
  ['tuff', 0x6c6d66], ['dripstone', 0x866b5c], ['mud_brick', 0x89684f], ['packed_mud', 0x8e6b50], ['muddy', 0x463b2d], ['mud', 0x3c3a3d],
  ['brick', 0x966253], ['terracotta', 0x985e43], ['clay', 0xa0a6b3], ['gravel', 0x837f7e], ['coarse_dirt', 0x77553b],
  ['rooted_dirt', 0x90674c], ['podzol', 0x5b3f18], ['mycelium', 0x6f6265], ['dirt', 0x866043], ['farmland', 0x5c3c22],
  ['moss', 0x596d2d], ['grass', 0x6a9a3c], ['snow', 0xf2f8f8], ['blue_ice', 0x74a8fd], ['packed_ice', 0x8db4fa], ['ice', 0x91b7fd],
  ['obsidian', 0x0f0b19], ['bedrock', 0x555555], ['oxidized', 0x52a385], ['weathered', 0x6c9f6b], ['exposed', 0xa17e68], ['copper', 0xc06c50],
  ['iron', 0xdcdcdc], ['gold', 0xf6d03d], ['diamond', 0x62ede4], ['emerald', 0x2ad15f], ['lapis', 0x1f43a6], ['redstone', 0xaf1805],
  ['coal', 0x1c1c1c], ['netherite', 0x42393d], ['amethyst', 0x8561bf], ['glowstone', 0xe5c07a], ['sea_lantern', 0xb3cfc8],
  ['shroomlight', 0xf19347], ['froglight', 0xf3e9b5], ['magma', 0x8e3f1f], ['sculk', 0x0c2a33], ['slime', 0x6fc05b], ['honey', 0xf0a020],
  ['hay', 0xa68a0f], ['bone', 0xe1ddc9], ['kelp', 0x384029], ['sponge', 0xc4b34c], ['pumpkin', 0xc07615], ['melon', 0x6f9118],
  ['tnt', 0xb5301f], ['bookshelf', 0x7a5c37], ['resin', 0xd7651e], ['creaking', 0x5c5550], ['pale_moss', 0x9aa18e], ['stone', 0x7d7d7d],
] as [string, number][]).map(([k, v]) => [k, hex(v)]);

export function dyeOf(name: string): Dye | undefined {
  // light_blue/light_gray must win over blue/gray
  for (const d of ['light_blue', 'light_gray'] as Dye[]) if (name.startsWith(d + '_') || name.includes('_' + d + '_')) return d;
  for (const d of DYES) if (name.startsWith(d + '_')) return d;
  return undefined;
}

export function woodOf(name: string): Wood | undefined {
  for (const w of ['dark_oak', 'pale_oak'] as Wood[]) if (name.includes(w)) return w;
  for (const w of WOODS) if (name.startsWith(w + '_') || name.includes('_' + w + '_') || name.endsWith('_' + w) || name.includes('stripped_' + w)) return w;
  return undefined;
}

export function materialColor(name: string): RGB | undefined {
  for (const [k, c] of MATERIALS) if (name.includes(k)) return c;
  return undefined;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function hsl(h: number, s: number, l: number): RGB {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h * 12) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}

/** Best-effort representative colour for any block name. */
export function colorFor(name: string): RGB {
  const dye = dyeOf(name);
  if (dye) {
    if (name.includes('concrete')) return CONCRETE[dye];
    if (name.includes('terracotta')) return TERRACOTTA[dye];
    if (name.includes('glass')) return GLASS[dye];
    return WOOL[dye];
  }
  const m = materialColor(name);
  const wood = woodOf(name);
  if (wood && !m) {
    if (name.includes('leaves')) return WOOD[wood].leaves;
    if (/_log|_wood|_stem|_hyphae/.test(name)) return name.startsWith('stripped') ? WOOD[wood].inner : WOOD[wood].bark;
    return WOOD[wood].planks;
  }
  if (m) return m;
  return hsl((hashString(name) % 360) / 360, 0.35, 0.55);
}

export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scale = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];

export function prettyName(short: string): string {
  return short.split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}
