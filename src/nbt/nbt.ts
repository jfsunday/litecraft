// Minimal, lossless NBT (Java Edition, big-endian) reader/writer.
// LongArray payloads are kept as Uint32Array pairs [lo0, hi0, lo1, hi1, ...] for fast bit access.

export const TAG = {
  End: 0, Byte: 1, Short: 2, Int: 3, Long: 4, Float: 5, Double: 6,
  ByteArray: 7, String: 8, List: 9, Compound: 10, IntArray: 11, LongArray: 12,
} as const;

export type Tag =
  | { t: 1; v: number }
  | { t: 2; v: number }
  | { t: 3; v: number }
  | { t: 4; v: bigint }
  | { t: 5; v: number }
  | { t: 6; v: number }
  | { t: 7; v: Int8Array }
  | { t: 8; v: string }
  | { t: 9; et: number; v: Tag[] }
  | { t: 10; v: Map<string, Tag> }
  | { t: 11; v: Int32Array }
  | { t: 12; v: Uint32Array };

export type Compound = Extract<Tag, { t: 10 }>;
export type ListTag = Extract<Tag, { t: 9 }>;

export const nbt = {
  byte: (v: number): Tag => ({ t: 1, v }),
  short: (v: number): Tag => ({ t: 2, v }),
  int: (v: number): Tag => ({ t: 3, v }),
  long: (v: bigint | number): Tag => ({ t: 4, v: BigInt(v) }),
  float: (v: number): Tag => ({ t: 5, v }),
  double: (v: number): Tag => ({ t: 6, v }),
  string: (v: string): Tag => ({ t: 8, v }),
  list: (et: number, v: Tag[]): Tag => ({ t: 9, et: v.length ? v[0].t : et, v }),
  intArray: (v: Int32Array): Tag => ({ t: 11, v }),
  longArray: (v: Uint32Array): Tag => ({ t: 12, v }),
  compound: (entries: Record<string, Tag | undefined> | Map<string, Tag>): Compound => {
    if (entries instanceof Map) return { t: 10, v: entries };
    const m = new Map<string, Tag>();
    for (const [k, val] of Object.entries(entries)) if (val) m.set(k, val);
    return { t: 10, v: m };
  },
};

// ---- accessors -------------------------------------------------------------

export function get(c: Compound | undefined, key: string): Tag | undefined {
  return c?.v.get(key);
}
export function num(c: Compound | undefined, key: string, def = 0): number {
  const tag = get(c, key);
  if (!tag) return def;
  if (tag.t === 4) return Number(tag.v);
  if (tag.t >= 1 && tag.t <= 6) return tag.v as number;
  return def;
}
export function str(c: Compound | undefined, key: string, def = ''): string {
  const tag = get(c, key);
  return tag?.t === 8 ? tag.v : def;
}
export function comp(c: Compound | undefined, key: string): Compound | undefined {
  const tag = get(c, key);
  return tag?.t === 10 ? tag : undefined;
}
export function list(c: Compound | undefined, key: string): Tag[] {
  const tag = get(c, key);
  return tag?.t === 9 ? tag.v : [];
}
export function compounds(c: Compound | undefined, key: string): Compound[] {
  return list(c, key).filter((t): t is Compound => t.t === 10);
}
export function tagNumber(tag: Tag | undefined, def = 0): number {
  if (!tag) return def;
  if (tag.t === 4) return Number(tag.v);
  if (tag.t >= 1 && tag.t <= 6) return tag.v as number;
  return def;
}

// ---- reading ---------------------------------------------------------------

class Reader {
  private view: DataView;
  pos = 0;
  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  private need(n: number) {
    if (this.pos + n > this.bytes.length) throw new Error('NBT: unexpected end of data');
  }
  u8() { this.need(1); return this.view.getUint8(this.pos++); }
  i8() { this.need(1); return this.view.getInt8(this.pos++); }
  i16() { this.need(2); const v = this.view.getInt16(this.pos); this.pos += 2; return v; }
  u16() { this.need(2); const v = this.view.getUint16(this.pos); this.pos += 2; return v; }
  i32() { this.need(4); const v = this.view.getInt32(this.pos); this.pos += 4; return v; }
  i64() { this.need(8); const v = this.view.getBigInt64(this.pos); this.pos += 8; return v; }
  f32() { this.need(4); const v = this.view.getFloat32(this.pos); this.pos += 4; return v; }
  f64() { this.need(8); const v = this.view.getFloat64(this.pos); this.pos += 8; return v; }
  string() {
    const len = this.u16();
    this.need(len);
    const s = decodeMUTF8(this.bytes, this.pos, len);
    this.pos += len;
    return s;
  }
  arrayLen() {
    const n = this.i32();
    if (n < 0) throw new Error('NBT: negative array length');
    return n;
  }

  payload(type: number, depth: number): Tag {
    if (depth > 512) throw new Error('NBT: nesting too deep');
    switch (type) {
      case 1: return { t: 1, v: this.i8() };
      case 2: return { t: 2, v: this.i16() };
      case 3: return { t: 3, v: this.i32() };
      case 4: return { t: 4, v: this.i64() };
      case 5: return { t: 5, v: this.f32() };
      case 6: return { t: 6, v: this.f64() };
      case 7: {
        const n = this.arrayLen(); this.need(n);
        const v = new Int8Array(this.bytes.buffer.slice(this.bytes.byteOffset + this.pos, this.bytes.byteOffset + this.pos + n));
        this.pos += n;
        return { t: 7, v };
      }
      case 8: return { t: 8, v: this.string() };
      case 9: {
        const et = this.u8();
        const n = this.arrayLen();
        const v: Tag[] = new Array(n);
        for (let i = 0; i < n; i++) v[i] = this.payload(et, depth + 1);
        return { t: 9, et, v };
      }
      case 10: {
        const m = new Map<string, Tag>();
        for (;;) {
          const t = this.u8();
          if (t === 0) break;
          const name = this.string();
          m.set(name, this.payload(t, depth + 1));
        }
        return { t: 10, v: m };
      }
      case 11: {
        const n = this.arrayLen(); this.need(n * 4);
        const v = new Int32Array(n);
        for (let i = 0; i < n; i++) v[i] = this.i32();
        return { t: 11, v };
      }
      case 12: {
        const n = this.arrayLen(); this.need(n * 8);
        const v = new Uint32Array(n * 2);
        for (let i = 0; i < n; i++) {
          const hi = this.view.getUint32(this.pos);
          const lo = this.view.getUint32(this.pos + 4);
          this.pos += 8;
          v[2 * i] = lo;
          v[2 * i + 1] = hi;
        }
        return { t: 12, v };
      }
      default:
        throw new Error(`NBT: unknown tag type ${type}`);
    }
  }
}

export function readNbt(bytes: Uint8Array): { name: string; root: Compound } {
  const r = new Reader(bytes);
  const type = r.u8();
  if (type !== 10) throw new Error('NBT: root is not a compound');
  const name = r.string();
  const root = r.payload(10, 0) as Compound;
  return { name, root };
}

// ---- writing ---------------------------------------------------------------

class Writer {
  private buf = new Uint8Array(1 << 16);
  private view = new DataView(this.buf.buffer);
  pos = 0;
  private ensure(n: number) {
    if (this.pos + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.pos + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number) { this.ensure(1); this.view.setUint8(this.pos++, v); }
  i8(v: number) { this.ensure(1); this.view.setInt8(this.pos++, v); }
  i16(v: number) { this.ensure(2); this.view.setInt16(this.pos, v); this.pos += 2; }
  u16(v: number) { this.ensure(2); this.view.setUint16(this.pos, v); this.pos += 2; }
  i32(v: number) { this.ensure(4); this.view.setInt32(this.pos, v); this.pos += 4; }
  u32(v: number) { this.ensure(4); this.view.setUint32(this.pos, v); this.pos += 4; }
  i64(v: bigint) { this.ensure(8); this.view.setBigInt64(this.pos, BigInt.asIntN(64, v)); this.pos += 8; }
  f32(v: number) { this.ensure(4); this.view.setFloat32(this.pos, v); this.pos += 4; }
  f64(v: number) { this.ensure(8); this.view.setFloat64(this.pos, v); this.pos += 8; }
  bytes(b: Uint8Array) { this.ensure(b.length); this.buf.set(b, this.pos); this.pos += b.length; }
  string(s: string) {
    const enc = encodeMUTF8(s);
    if (enc.length > 65535) throw new Error('NBT: string too long');
    this.u16(enc.length);
    this.bytes(enc);
  }
  payload(tag: Tag) {
    switch (tag.t) {
      case 1: this.i8(tag.v); break;
      case 2: this.i16(tag.v); break;
      case 3: this.i32(tag.v); break;
      case 4: this.i64(tag.v); break;
      case 5: this.f32(tag.v); break;
      case 6: this.f64(tag.v); break;
      case 7: this.i32(tag.v.length); this.bytes(new Uint8Array(tag.v.buffer, tag.v.byteOffset, tag.v.length)); break;
      case 8: this.string(tag.v); break;
      case 9: {
        const et = tag.v.length ? tag.v[0].t : tag.et;
        this.u8(et);
        this.i32(tag.v.length);
        for (const item of tag.v) {
          if (item.t !== et) throw new Error('NBT: mixed list element types');
          this.payload(item);
        }
        break;
      }
      case 10:
        for (const [k, v] of tag.v) {
          this.u8(v.t);
          this.string(k);
          this.payload(v);
        }
        this.u8(0);
        break;
      case 11:
        this.i32(tag.v.length);
        for (let i = 0; i < tag.v.length; i++) this.i32(tag.v[i]);
        break;
      case 12: {
        const n = tag.v.length >> 1;
        this.i32(n);
        for (let i = 0; i < n; i++) {
          this.u32(tag.v[2 * i + 1]);
          this.u32(tag.v[2 * i]);
        }
        break;
      }
    }
  }
  result(): Uint8Array<ArrayBuffer> {
    return this.buf.slice(0, this.pos);
  }
}

export function writeNbt(root: Compound, name = ''): Uint8Array<ArrayBuffer> {
  const w = new Writer();
  w.u8(10);
  w.string(name);
  w.payload(root);
  return w.result();
}

// ---- Modified UTF-8 ----------------------------------------------------------

function decodeMUTF8(b: Uint8Array, start: number, len: number): string {
  const end = start + len;
  let out = '';
  const chunk: number[] = [];
  for (let i = start; i < end;) {
    const a = b[i++];
    let c: number;
    if (a < 0x80) c = a;
    else if ((a & 0xe0) === 0xc0) c = ((a & 0x1f) << 6) | (b[i++] & 0x3f);
    else c = ((a & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
    chunk.push(c);
    if (chunk.length >= 4096) { out += String.fromCharCode(...chunk); chunk.length = 0; }
  }
  return out + String.fromCharCode(...chunk);
}

function encodeMUTF8(s: string): Uint8Array<ArrayBuffer> {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    n += c >= 1 && c <= 0x7f ? 1 : c <= 0x7ff ? 2 : 3;
  }
  const out = new Uint8Array(n);
  let p = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 1 && c <= 0x7f) out[p++] = c;
    else if (c <= 0x7ff) { out[p++] = 0xc0 | (c >> 6); out[p++] = 0x80 | (c & 0x3f); }
    else { out[p++] = 0xe0 | (c >> 12); out[p++] = 0x80 | ((c >> 6) & 0x3f); out[p++] = 0x80 | (c & 0x3f); }
  }
  return out;
}

// ---- gzip ------------------------------------------------------------------

export function isGzip(b: Uint8Array): boolean {
  return b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
export const gzip = (data: Uint8Array) => pipe(data, new CompressionStream('gzip'));
export const gunzip = (data: Uint8Array) => pipe(data, new DecompressionStream('gzip'));
