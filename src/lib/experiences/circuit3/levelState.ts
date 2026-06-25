import {
  LEVEL_THRESHOLDS,
  LEVEL_TILE_SETS,
  type LevelTileSet,
} from "$lib/config/flight";

// ── Level State & Progression ────────────────────────────────────────────
//
// Central, framework-agnostic state for the Data Room's level progression.
// It tracks how far the journey has come and decides when a level advances.
//
// Advance rule (checked whenever either input changes):
//   level N → N+1  iff  chunksGenerated >= LEVEL_THRESHOLDS[N]
//                  AND  stationVisited[N] === true
//
// The chunk counter is driven by ChunkManager (one tick per newly generated
// chunk); station visits are reported by station-proximity logic elsewhere.

/** Immutable view of the level state, handed to every listener. */
export interface LevelSnapshot {
  /** Zero-based level index (0 = clean data room … LEVEL_TILE_SETS.length-1 = brain). */
  currentLevel: number;
  /** Total number of chunks generated since the experience started. */
  chunksGenerated: number;
  /** Visited flag per level. */
  stationVisited: readonly boolean[];
  /** Generation parameters for the current level. */
  tileSet: LevelTileSet;
}

export type LevelChangeListener = (snapshot: LevelSnapshot) => void;

export class LevelState {
  private _currentLevel = 0;
  private _chunksGenerated = 0;
  private readonly _stationVisited: boolean[];
  private readonly maxLevel: number;
  private readonly listeners = new Set<LevelChangeListener>();

  constructor() {
    this.maxLevel = LEVEL_TILE_SETS.length - 1;
    this._stationVisited = new Array(LEVEL_TILE_SETS.length).fill(false);
  }

  // ── Read accessors ──────────────────────────────────────────────────────

  get currentLevel(): number {
    return this._currentLevel;
  }

  get chunksGenerated(): number {
    return this._chunksGenerated;
  }

  get stationVisited(): readonly boolean[] {
    return this._stationVisited;
  }

  /** Generation parameters for the current level. */
  get tileSet(): LevelTileSet {
    return LEVEL_TILE_SETS[this._currentLevel];
  }

  /** True once the final level has been reached. */
  get isFinalLevel(): boolean {
    return this._currentLevel >= this.maxLevel;
  }

  // ── Inputs that can trigger progression ───────────────────────────────────

  /** Report newly generated chunk(s). Called from the chunk-generation event. */
  notifyChunkGenerated(count = 1): void {
    if (count <= 0) return;
    this._chunksGenerated += count;
    this.tryAdvance();
  }

  /** Mark a station as visited (defaults to the current level). */
  markStationVisited(level: number = this._currentLevel): void {
    if (level < 0 || level >= this._stationVisited.length) return;
    if (this._stationVisited[level]) return;
    this._stationVisited[level] = true;
    this.tryAdvance();
  }

  // ── Subscription ──────────────────────────────────────────────────────────

  /**
   * Listen for level changes. The listener fires only when `currentLevel`
   * actually advances. Returns an unsubscribe function.
   */
  onLevelChange(listener: LevelChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Svelte-store-compatible subscribe: fires immediately with the current
   * snapshot, then on every subsequent level change. Returns an unsubscribe
   * function. (`onLevelChange` is the same minus the immediate emit.)
   */
  subscribe(listener: LevelChangeListener): () => void {
    listener(this.snapshot());
    return this.onLevelChange(listener);
  }

  /** Reset to the initial level state (e.g. on experience restart). */
  reset(): void {
    this._currentLevel = 0;
    this._chunksGenerated = 0;
    this._stationVisited.fill(false);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private tryAdvance(): void {
    // Cascade: a single input change may satisfy several levels at once
    // (only relevant if thresholds/visits were already met out of order).
    let advanced = false;
    while (!this.isFinalLevel) {
      const threshold = LEVEL_THRESHOLDS[this._currentLevel] ?? Number.POSITIVE_INFINITY;
      const ready =
        this._chunksGenerated >= threshold &&
        this._stationVisited[this._currentLevel] === true;
      if (!ready) break;
      this._currentLevel++;
      advanced = true;
    }
    if (advanced) this.emit();
  }

  private snapshot(): LevelSnapshot {
    return {
      currentLevel: this._currentLevel,
      chunksGenerated: this._chunksGenerated,
      stationVisited: this._stationVisited.slice(),
      tileSet: this.tileSet,
    };
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(snap);
  }
}
