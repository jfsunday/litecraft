import type { World } from '../world/world';
import type { Change } from './placement';

interface Edit { x: number; y: number; z: number; from: number; to: number }

export class History {
  private undoStack: Edit[][] = [];
  private redoStack: Edit[][] = [];
  onChange?: () => void;
  constructor(private world: World, private limit = 300) {}

  apply(changes: Change[]): number {
    const edits: Edit[] = [];
    this.world.batch(() => {
      for (const c of changes) {
        const from = this.world.get(c.x, c.y, c.z);
        if (from === c.id) continue;
        this.world.set(c.x, c.y, c.z, c.id);
        edits.push({ x: c.x, y: c.y, z: c.z, from, to: c.id });
      }
    });
    if (edits.length) {
      this.undoStack.push(edits);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack = [];
      this.onChange?.();
    }
    return edits.length;
  }

  private replay(edits: Edit[], reverse: boolean) {
    this.world.batch(() => {
      const list = reverse ? [...edits].reverse() : edits;
      for (const e of list) this.world.set(e.x, e.y, e.z, reverse ? e.from : e.to);
    });
  }

  undo(): boolean {
    const e = this.undoStack.pop();
    if (!e) return false;
    this.replay(e, true);
    this.redoStack.push(e);
    this.onChange?.();
    return true;
  }

  redo(): boolean {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.replay(e, false);
    this.undoStack.push(e);
    this.onChange?.();
    return true;
  }

  /** Folds the latest undo step into the previous one (e.g. placement + neighbour shape updates). */
  mergeLast() {
    if (this.undoStack.length < 2) return;
    const last = this.undoStack.pop()!;
    this.undoStack[this.undoStack.length - 1].push(...last);
  }

  clear() { this.undoStack = []; this.redoStack = []; this.onChange?.(); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}
