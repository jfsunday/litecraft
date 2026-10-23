import type { Props } from '../world/world';

export interface Colormaps { grass?: number; foliage?: number; dryFoliage?: number }

const GRASS_TINTED = new Set(['grass_block', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'potted_fern', 'sugar_cane', 'bush']);
const FOLIAGE_TINTED = new Set(['oak_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'vine']);

export function redstoneColor(power: number): number {
  const f = power / 15;
  const r = power === 0 ? 0.3 : f * 0.6 + 0.4;
  const g = Math.max(0, f * f * 0.7 - 0.5);
  const b = Math.max(0, f * f * 0.6 - 0.7);
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

/** Minecraft block colour provider (plains biome). Returns -1 for "no tint". */
export function blockTint(short: string, props: Props, tintindex: number, maps: Colormaps = {}): number {
  if (tintindex < 0) return -1;
  const grass = maps.grass ?? 0x91bd59;
  if (short === 'pink_petals' || short === 'wildflowers') return tintindex === 0 ? -1 : grass;
  if (GRASS_TINTED.has(short)) return grass;
  if (FOLIAGE_TINTED.has(short)) return maps.foliage ?? 0x77ab2f;
  if (short === 'spruce_leaves') return 0x619961;
  if (short === 'birch_leaves') return 0x80a755;
  if (short === 'mangrove_leaves') return 0x92c648;
  if (short === 'leaf_litter') return maps.dryFoliage ?? 0xa0a65c;
  if (short === 'water' || short === 'bubble_column' || short === 'water_cauldron') return 0x3f76e4;
  if (short === 'redstone_wire') return redstoneColor(Number(props.power ?? 0));
  if (short === 'pumpkin_stem' || short === 'melon_stem') {
    const age = Number(props.age ?? 0);
    return ((age * 32) << 16) | ((255 - age * 8) << 8) | (age * 4);
  }
  if (short === 'attached_pumpkin_stem' || short === 'attached_melon_stem') return 0xe0c71c;
  if (short === 'lily_pad') return 0x208030;
  return -1;
}
