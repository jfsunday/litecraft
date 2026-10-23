import * as THREE from 'three';
import type { VanillaResolver } from '../assets/vanilla';
import { proceduralTexture } from '../blocks/proctex';

export const KIND_OPAQUE = 0, KIND_CUTOUT = 1, KIND_TRANSLUCENT = 2;

function missing(): Uint8ClampedArray {
  const d = new Uint8ClampedArray(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const i = (y * 16 + x) * 4, on = ((x >> 3) + (y >> 3)) % 2 === 0;
    d[i] = on ? 248 : 0; d[i + 1] = 0; d[i + 2] = on ? 248 : 0; d[i + 3] = 255;
  }
  return d;
}

interface Source { px: Uint8ClampedArray; r: number; pack: boolean }

/** All block textures live in one texture array (one layer per texture; mipmaps without atlas bleeding). */
export class TextureBank {
  texture: THREE.DataArrayTexture;
  res = 16;
  private data: Uint8Array;
  private capacity: number;
  private count = 0;
  private index = new Map<string, number>();
  private kinds: number[] = [];
  private fromPack: boolean[] = [];
  private dirty = false;
  vanilla: VanillaResolver | null = null;
  onTextureReplaced?: (t: THREE.DataArrayTexture) => void;

  constructor(private maxLayers = 2048) {
    this.capacity = Math.min(256, maxLayers);
    this.data = new Uint8Array(this.capacity * this.layerBytes());
    this.texture = this.makeTexture();
  }

  private layerBytes() { return this.res * this.res * 4; }

  private makeTexture(): THREE.DataArrayTexture {
    const t = new THREE.DataArrayTexture(this.data, this.res, this.res, this.capacity);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  }

  private replaceTexture() {
    const old = this.texture;
    this.texture = this.makeTexture();
    old.dispose();
    this.onTextureReplaced?.(this.texture);
  }

  setVanilla(v: VanillaResolver | null) {
    this.vanilla = v;
    this.index.clear();
    this.kinds = [];
    this.fromPack = [];
    this.count = 0;
    const res = v?.resolution ?? 16;
    if (res !== this.res) {
      this.res = res;
      this.data = new Uint8Array(this.capacity * this.layerBytes());
      this.replaceTexture();
    } else this.data.fill(0);
    this.dirty = true;
  }

  private source(key: string): Source {
    if (key.startsWith('proc:')) {
      const name = key.slice(5);
      const packName = name.startsWith('cross:') ? name.slice(6) : name;
      const t = this.vanilla?.texture('block/' + packName);
      if (t) return { px: t.d, r: t.r, pack: true };
      return { px: proceduralTexture(name), r: 16, pack: false };
    }
    if (key.startsWith('minecraft:')) {
      const t = this.vanilla?.texture(key.slice(10));
      if (t) return { px: t.d, r: t.r, pack: true };
    }
    return { px: missing(), r: 16, pack: false };
  }

  layer(key: string): number {
    const hit = this.index.get(key);
    if (hit !== undefined) return hit;
    if (this.count >= this.capacity) {
      if (this.capacity >= this.maxLayers) return 0;
      this.grow();
    }
    const layer = this.count++;
    this.index.set(key, layer);
    const { px, r: sr, pack } = this.source(key);
    const R = this.res, bytes = this.layerBytes();
    const dst = this.data.subarray(layer * bytes, (layer + 1) * bytes);
    let r = 0, g = 0, b = 0, n = 0, semi = 0, holes = 0;
    for (let i = 0; i < sr * sr; i++) {
      const a = px[i * 4 + 3];
      if (a > 8) { r += px[i * 4]; g += px[i * 4 + 1]; b += px[i * 4 + 2]; n++; }
      if (a < 128) holes++;
      if (a > 20 && a < 235) semi++;
    }
    if (n) { r /= n; g /= n; b /= n; }
    for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
      const sx = Math.floor((x * sr) / R), sy = Math.floor((y * sr) / R);
      const si = (sy * sr + sx) * 4, di = ((R - 1 - y) * R + x) * 4;
      const a = px[si + 3];
      if (a > 8) { dst[di] = px[si]; dst[di + 1] = px[si + 1]; dst[di + 2] = px[si + 2]; }
      else { dst[di] = r; dst[di + 1] = g; dst[di + 2] = b; }
      dst[di + 3] = a;
    }
    this.kinds[layer] = semi > sr * sr * 0.1 ? KIND_TRANSLUCENT : holes > 0 ? KIND_CUTOUT : KIND_OPAQUE;
    this.fromPack[layer] = pack;
    this.dirty = true;
    return layer;
  }

  kind(layer: number): number { return this.kinds[layer] ?? KIND_OPAQUE; }
  isPack(layer: number): boolean { return this.fromPack[layer] ?? false; }

  /** Raw RGBA (top row first) of a texture plus its size, for UI icons. */
  rgba(key: string): Source {
    return this.source(key);
  }

  private grow() {
    const cap = Math.min(this.capacity * 2, this.maxLayers);
    const next = new Uint8Array(cap * this.layerBytes());
    next.set(this.data);
    this.data = next;
    this.capacity = cap;
    this.replaceTexture();
  }

  flush(): boolean {
    if (!this.dirty) return false;
    this.dirty = false;
    this.texture.image.data = this.data;
    this.texture.needsUpdate = true;
    return true;
  }
}
