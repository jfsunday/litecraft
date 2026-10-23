import { BLOCKS, defaultProps } from '../blocks/data';
import { makeKey } from '../world/world';

export interface CatalogEntry { short: string; display: string; key: string; cats: string[] }

export const CATEGORIES = ['Alle', 'Bauen', 'Holz', 'Formen', 'Farben', 'Natur', 'Licht', 'Redstone', 'Farm', 'Deko'] as const;

const EXCLUDE = /^(air|cave_air|void_air|moving_piston|piston_head|bubble_column|frosted_ice|end_gateway|kelp_plant|cave_vines_plant|twisting_vines_plant|weeping_vines_plant|big_dripleaf_stem|tall_seagrass|tripwire|attached_.*|potted_.*|.*_wall_(torch|sign|banner|head|skull|fan|hanging_sign)|wall_torch|redstone_wall_torch|.*_wall_hanging_sign|petrified_oak_slab|bamboo_sapling)$/;

const RULES: [string, RegExp][] = [
  ['Farm', /^(farmland|wheat|carrots|potatoes|beetroots|sugar_cane|cactus|bamboo|kelp|pumpkin_stem|melon_stem|pumpkin|melon|nether_wart|soul_sand|cocoa|sweet_berry_bush|composter|hay_block|water|lava|hopper|chest|barrel|observer|piston|sticky_piston|dirt|grass_block|sand|bone_block|torchflower_crop|pitcher_crop|cave_vines|glass|dropper|rail|powered_rail|campfire|magma_block|slime_block|honey_block|scaffolding)$/],
  ['Redstone', /redstone|repeater|comparator|observer|piston|dispenser|dropper|hopper|^lever$|_button$|pressure_plate|tripwire_hook|daylight|^target$|note_block|^tnt$|slime_block|honey_block|rail$|crafter|lectern|trapped_chest|sculk_sensor|lightning_rod|_door$|_trapdoor$|fence_gate|copper_bulb/],
  ['Licht', /torch|lantern|glowstone|sea_lantern|shroomlight|froglight|jack_o_lantern|redstone_lamp|end_rod|campfire|candle$|^light$|beacon|copper_bulb|conduit/],
  ['Holz', /_planks$|_log$|_wood$|(crimson|warped)_(stem|hyphae)$|bamboo_block|bamboo_mosaic$/],
  ['Formen', /_slab$|_stairs$|_wall$|_fence$|_fence_gate$/],
  ['Farben', /wool$|carpet$|concrete|terracotta$|stained_glass|_bed$|_banner$|shulker_box$|_candle$/],
  ['Natur', /dirt|grass|^sand$|red_sand|gravel|^clay$|^mud$|snow|ice$|_ore$|leaves|sapling|tulip|orchid|allium|bluet|daisy|cornflower|lily|rose|poppy|dandelion|mushroom|fungus|roots|vine|moss|coral|seagrass|kelp|fern|bush|azalea|dripleaf|dripstone|amethyst|netherrack|nylium|end_stone$|obsidian|basalt|^bedrock$|sponge|cactus|petals|eyeblossom|leaf_litter|propagule|cobweb|lichen|sculk|podzol|mycelium|wildflowers|sunflower|lilac|peony|pitcher_plant|torchflower$|spore_blossom|hanging_roots|frogspawn|pale_hanging_moss|cactus_flower|creaking_heart/],
  ['Deko', /anvil|cauldron|bookshelf|crafting_table|furnace|smoker|grindstone|stonecutter|loom|cartography|fletching|smithing|enchanting|brewing|^bell$|chain|ladder|bars$|_pane$|^glass$|tinted_glass|_sign$|_banner$|_head$|_skull$|flower_pot|scaffolding|cake$|decorated_pot|chest|barrel|beehive|bee_nest|jukebox|respawn_anchor|lodestone|vault|spawner|shelf|statue|end_portal_frame|dragon_egg|lantern|candle|carpet|lectern|composter|_door$|_trapdoor$|^bed$|_bed$|heavy_core|trial_spawner|sniffer_egg|turtle_egg|sea_pickle|conduit|beacon|grate$/],
];

const OVERRIDES: Record<string, Record<string, string>> = {
  wheat: { age: '7' }, carrots: { age: '7' }, potatoes: { age: '7' }, beetroots: { age: '3' }, nether_wart: { age: '3' },
  sweet_berry_bush: { age: '3' }, cocoa: { age: '2' }, pumpkin_stem: { age: '7' }, melon_stem: { age: '7' },
  farmland: { moisture: '7' }, torchflower_crop: { age: '1' }, pitcher_crop: { age: '4' },
};

let cached: CatalogEntry[] | null = null;

export function catalog(): CatalogEntry[] {
  if (cached) return cached;
  const out: CatalogEntry[] = [];
  for (const def of BLOCKS.values()) {
    if (EXCLUDE.test(def.name)) continue;
    const props = { ...defaultProps(def), ...(OVERRIDES[def.name] ?? {}) };
    if (props.persistent) props.persistent = 'true';
    if (def.name.endsWith('_leaves')) props.distance = '1';
    const cats = RULES.filter(([, re]) => re.test(def.name)).map(([c]) => c);
    const solidish = def.shape !== undefined && !def.transparent;
    if (!cats.length || (solidish && !cats.includes('Formen') && !cats.includes('Holz') && !cats.includes('Farben') && /stone|brick|deepslate|tuff|quartz|purpur|prismarine|blackstone|sandstone|copper|block$|polished|smooth|cut_|chiseled|tiles|calcite|granite|diorite|andesite|basalt|mud_bricks|packed_mud|resin/.test(def.name))) cats.push('Bauen');
    out.push({ short: def.name, display: def.display, key: makeKey('minecraft:' + def.name, props), cats });
  }
  cached = out;
  return out;
}
