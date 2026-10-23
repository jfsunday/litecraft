import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BlockRegistry } from '../blocks/info';
import { chunkCoords, type Bounds, type World } from '../world/world';
import { type ClipRange, type GeomData, meshChunk, ModelLibrary } from './mesher';
import { TextureBank } from './textures';

const VERT = /* glsl */ `
in float aLayer;
in vec4 aColor;
out vec2 vUv;
out float vLayer;
out vec4 vColor;
out float vDepth;
void main() {
  vUv = uv;
  vLayer = aLayer;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform float uAlphaTest;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
in vec2 vUv;
in float vLayer;
in vec4 vColor;
in float vDepth;
out vec4 fragColor;
void main() {
  vec4 t = texture(uTex, vec3(vUv, floor(vLayer + 0.5)));
  if (t.a < uAlphaTest) discard;
  vec3 c = t.rgb * vColor.rgb;
  float f = clamp((vDepth - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
  fragColor = vec4(mix(c, uFogColor, f * f), t.a);
}`;

const SKY_VERT = /* glsl */ `
out vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKY_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
in vec3 vDir;
out vec4 fragColor;
void main() {
  float y = vDir.y;
  vec3 c = y > 0.0 ? mix(uHorizon, uTop, pow(clamp(y, 0.0, 1.0), 0.55)) : mix(uHorizon, uBottom, clamp(-y * 2.5, 0.0, 1.0));
  fragColor = vec4(c, 1.0);
}`;

export type Theme = 'night' | 'day';
const THEMES: Record<Theme, { top: number; horizon: number; bottom: number; grid: number; gridMajor: number }> = {
  night: { top: 0x0b0e15, horizon: 0x232a38, bottom: 0x101319, grid: 0x3a4252, gridMajor: 0x58637a },
  day: { top: 0x5f93e8, horizon: 0xbfd6f7, bottom: 0x8a9bb5, grid: 0x7a8aa6, gridMajor: 0x4d5b78 },
};

const srgb = (hex: number) => new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

interface ChunkMeshes { solid?: THREE.Mesh; trans?: THREE.Mesh }

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly bank: TextureBank;
  readonly lib: ModelLibrary;
  readonly overlay = new THREE.Group();
  readonly keys = new Set<string>();
  private solidMat: THREE.ShaderMaterial;
  private transMat: THREE.ShaderMaterial;
  private sky: THREE.Mesh;
  private chunkGroup = new THREE.Group();
  private meshes = new Map<number, ChunkMeshes>();
  private queue = new Set<number>();
  private grid: THREE.LineSegments | null = null;
  private gridKey = '';
  readonly hover: THREE.LineSegments;
  readonly ghost: THREE.Mesh;
  readonly selection: THREE.Group;
  clip: ClipRange | null = null;
  ao = true;
  showGrid = true;
  theme: Theme = 'night';
  gridY = 0;
  private last = performance.now();
  private needsRender = true;
  onFrame?: (dt: number) => void;
  pendingChunks = 0;

  constructor(readonly canvas: HTMLCanvasElement, readonly world: World, readonly reg: BlockRegistry) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
    this.bank = new TextureBank(Math.min(maxLayers, 4096));
    this.lib = new ModelLibrary(reg, this.bank);
    this.bank.onTextureReplaced = (t) => { this.solidMat.uniforms.uTex.value = t; this.transMat.uniforms.uTex.value = t; };

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 4000);
    this.camera.position.set(20, 16, 26);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.14;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.maxDistance = 1500;
    this.controls.minDistance = 0.5;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

    const mk = (translucent: boolean) => new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uTex: { value: this.bank.texture },
        uAlphaTest: { value: translucent ? 0.01 : 0.5 },
        uFogColor: { value: new THREE.Vector3() },
        uFogNear: { value: 300 },
        uFogFar: { value: 900 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: translucent,
      depthWrite: !translucent,
    });
    this.solidMat = mk(false);
    this.transMat = mk(true);

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(3000, 32, 16),
      new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, uniforms: { uTop: { value: new THREE.Vector3() }, uHorizon: { value: new THREE.Vector3() }, uBottom: { value: new THREE.Vector3() } } }),
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky, this.chunkGroup, this.overlay);

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.hover = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x0b0b0b, transparent: true, opacity: 0.8 }));
    this.hover.visible = false;
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
    this.ghost.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })));
    this.ghost.visible = false;
    this.selection = new THREE.Group();
    const selBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x4fd1c5, transparent: true, opacity: 0.12, depthWrite: false }));
    const selEdges = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x4fd1c5 }));
    this.selection.add(selBox, selEdges);
    this.selection.visible = false;
    this.overlay.add(this.hover, this.ghost, this.selection);
    this.setTheme('night');

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  /** Rendering happens on demand: camera movement, world changes or an explicit request. */
  requestRender() { this.needsRender = true; }

  setTheme(t: Theme) {
    this.theme = t;
    this.needsRender = true;
    const th = THEMES[t];
    const u = (this.sky.material as THREE.ShaderMaterial).uniforms;
    u.uTop.value = srgb(th.top); u.uHorizon.value = srgb(th.horizon); u.uBottom.value = srgb(th.bottom);
    this.solidMat.uniforms.uFogColor.value = srgb(th.horizon);
    this.transMat.uniforms.uFogColor.value = srgb(th.horizon);
    this.gridKey = '';
  }

  resize() {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  /** Re-mesh everything (e.g. after switching textures). */
  rebuildAll() {
    for (const k of this.world.chunks.keys()) this.queue.add(k);
    for (const k of this.meshes.keys()) this.queue.add(k);
  }

  setClip(next: ClipRange | null) {
    const b = this.world.bounds();
    const lo = b ? b.min[1] : 0, hi = b ? b.max[1] : 0;
    const prev = this.clip;
    this.clip = next;
    const pMin = prev?.min ?? lo, pMax = prev?.max ?? hi, nMin = next?.min ?? lo, nMax = next?.max ?? hi;
    const ranges = [[Math.min(pMax, nMax) - 1, Math.max(pMax, nMax) + 1], [Math.min(pMin, nMin) - 1, Math.max(pMin, nMin) + 1]];
    for (const k of new Set([...this.world.chunks.keys(), ...this.meshes.keys()])) {
      const cy = chunkCoords(k)[1], y0 = cy * 16 - 1, y1 = cy * 16 + 16;
      if (ranges.some(([a, c]) => y1 >= a && y0 <= c)) this.queue.add(k);
    }
  }

  private toMesh(g: GeomData, mat: THREE.ShaderMaterial, origin: [number, number, number]): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
    geo.setAttribute('aLayer', new THREE.BufferAttribute(g.layer, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(g.color, 4, true));
    geo.setIndex(new THREE.BufferAttribute(g.index, 1));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat);
    m.position.set(origin[0], origin[1], origin[2]);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }

  private remesh(key: number) {
    const old = this.meshes.get(key);
    if (old) {
      for (const m of [old.solid, old.trans]) if (m) { this.chunkGroup.remove(m); m.geometry.dispose(); }
      this.meshes.delete(key);
    }
    if (!this.world.chunks.has(key)) return;
    const [cx, cy, cz] = chunkCoords(key);
    const { solid, trans } = meshChunk(this.world, this.lib, cx, cy, cz, this.clip, this.ao);
    if (!solid && !trans) return;
    const origin: [number, number, number] = [cx * 16, cy * 16, cz * 16];
    const entry: ChunkMeshes = {};
    if (solid) { entry.solid = this.toMesh(solid, this.solidMat, origin); this.chunkGroup.add(entry.solid); }
    if (trans) { entry.trans = this.toMesh(trans, this.transMat, origin); this.chunkGroup.add(entry.trans); }
    this.meshes.set(key, entry);
  }

  private processQueue(budgetMs: number) {
    for (const k of this.world.dirty) this.queue.add(k);
    this.world.dirty.clear();
    if (!this.queue.size) { this.pendingChunks = 0; return; }
    const t0 = performance.now();
    const target = this.controls.target;
    const keys = [...this.queue];
    if (keys.length > 8) {
      keys.sort((a, b) => {
        const ca = chunkCoords(a), cb = chunkCoords(b);
        const da = (ca[0] * 16 + 8 - target.x) ** 2 + (ca[1] * 16 + 8 - target.y) ** 2 + (ca[2] * 16 + 8 - target.z) ** 2;
        const db = (cb[0] * 16 + 8 - target.x) ** 2 + (cb[1] * 16 + 8 - target.y) ** 2 + (cb[2] * 16 + 8 - target.z) ** 2;
        return da - db;
      });
    }
    for (const k of keys) {
      this.queue.delete(k);
      this.remesh(k);
      this.needsRender = true;
      if (performance.now() - t0 > budgetMs) break;
    }
    this.pendingChunks = this.queue.size;
  }

  private updateGrid() {
    const b = this.world.bounds();
    const x0 = (b ? b.min[0] : -16) - 8, x1 = (b ? b.max[0] + 1 : 16) + 8;
    const z0 = (b ? b.min[2] : -16) - 8, z1 = (b ? b.max[2] + 1 : 16) + 8;
    const y = this.gridY;
    const key = `${x0},${x1},${z0},${z1},${y},${this.theme},${this.showGrid}`;
    if (key === this.gridKey) return;
    this.gridKey = key;
    if (this.grid) { this.overlay.remove(this.grid); this.grid.geometry.dispose(); this.grid = null; }
    if (!this.showGrid) return;
    const th = THEMES[this.theme];
    const pos: number[] = [], col: number[] = [];
    const minor = new THREE.Color(th.grid), major = new THREE.Color(th.gridMajor);
    const add = (ax: number, az: number, bx: number, bz: number, c: THREE.Color) => { pos.push(ax, y, az, bx, y, bz); col.push(c.r, c.g, c.b, c.r, c.g, c.b); };
    for (let x = x0; x <= x1; x++) add(x, z0, x, z1, x % 16 === 0 ? major : minor);
    for (let z = z0; z <= z1; z++) add(x0, z, x1, z, z % 16 === 0 ? major : minor);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.grid = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }));
    this.grid.renderOrder = -1;
    this.overlay.add(this.grid);
    this.needsRender = true;
  }

  fit(b: Bounds | null, keepDirection = false) {
    const min = b ? new THREE.Vector3(...b.min) : new THREE.Vector3(-8, 0, -8);
    const max = b ? new THREE.Vector3(...b.max).addScalar(1) : new THREE.Vector3(8, 4, 8);
    const center = min.clone().add(max).multiplyScalar(0.5);
    const radius = Math.max(4, min.distanceTo(max) / 2);
    const dir = keepDirection ? this.camera.position.clone().sub(this.controls.target).normalize() : new THREE.Vector3(1, 0.85, 1.4).normalize();
    const dist = radius / Math.sin((this.camera.fov * Math.PI) / 360) * 1.05;
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.05, dist / 2000);
    this.camera.far = Math.max(4000, dist * 10);
    this.camera.updateProjectionMatrix();
    this.setFog(dist);
    this.controls.update();
    this.needsRender = true;
  }

  private setFog(dist: number) {
    for (const m of [this.solidMat, this.transMat]) { m.uniforms.uFogNear.value = dist * 1.6; m.uniforms.uFogFar.value = dist * 5; }
  }

  private moveWithKeys(dt: number) {
    if (!this.keys.size) return;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    const move = new THREE.Vector3();
    if (this.keys.has('w')) move.add(fwd);
    if (this.keys.has('s')) move.sub(fwd);
    if (this.keys.has('d')) move.add(right);
    if (this.keys.has('a')) move.sub(right);
    if (this.keys.has(' ')) move.y += 1;
    if (this.keys.has('shift')) move.y -= 1;
    if (!move.lengthSq()) return;
    this.needsRender = true;
    const dist = this.camera.position.distanceTo(this.controls.target);
    const speed = Math.max(6, dist * 0.9) * (this.keys.has('control') ? 3 : 1);
    move.normalize().multiplyScalar(speed * dt);
    this.camera.position.add(move);
    this.controls.target.add(move);
  }

  frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.moveWithKeys(dt);
    if (this.controls.update()) this.needsRender = true;
    this.onFrame?.(dt);
    this.processQueue(12);
    if (this.bank.flush()) this.needsRender = true;
    this.updateGrid();
    if (!this.needsRender) return;
    this.needsRender = false;
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  async screenshot(): Promise<Blob> {
    this.hover.visible = false;
    this.ghost.visible = false;
    this.renderer.render(this.scene, this.camera);
    return new Promise((resolve, reject) => this.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Screenshot fehlgeschlagen'))), 'image/png'));
  }

  /** Yaw of the camera in degrees (0 = looking north). */
  yaw(): number {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    return (Math.atan2(d.x, -d.z) * 180) / Math.PI;
  }
}
