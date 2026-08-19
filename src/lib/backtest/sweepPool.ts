// ============================================================================
// Worker pool for the Layer-5 sweep.
//
// Each worker holds its own decoded copy of the bar series (memory for speed —
// no structured-clone per config) and is fed batches of candidates. Batching
// matters: postMessage round trips dominate when a single config takes
// milliseconds, so the pool sends work in chunks and keeps every worker busy.
// ============================================================================

import type { InstrumentSpec } from "../../../shared/quant/ict/instruments";
import type { ConfigRow, SweepCandidate } from "../../../shared/quant/ict/sweep";
import type { SweepRequest, SweepResponse } from "@/workers/ictSweep.worker";

type Pending = { resolve: (r: SweepResponse) => void; reject: (e: Error) => void };

/** `Omit` over a union collapses it, so distribute the id removal manually. */
type WithoutId<T> = T extends { id: number } ? Omit<T, "id"> : never;
type SweepMessage = WithoutId<SweepRequest>;

interface Slot {
  worker: Worker;
  pending: Map<number, Pending>;
  busy: boolean;
}

export function defaultWorkerCount(): number {
  const hc = typeof navigator !== "undefined" ? navigator.hardwareConcurrency ?? 4 : 4;
  // Leave one core for the UI thread; never fewer than one worker.
  return Math.max(1, Math.min(8, hc - 1));
}

export class SweepPool {
  private slots: Slot[] = [];
  private nextId = 1;
  private stopped = false;

  constructor(private size: number = defaultWorkerCount()) {}

  get workers(): number {
    return this.slots.length || this.size;
  }

  private spawn(): Slot {
    const worker = new Worker(new URL("../../workers/ictSweep.worker.ts", import.meta.url), {
      type: "module",
    });
    const slot: Slot = { worker, pending: new Map(), busy: false };
    worker.onmessage = (e: MessageEvent<SweepResponse>) => {
      const p = slot.pending.get(e.data.id);
      if (!p) return;
      slot.pending.delete(e.data.id);
      if (e.data.ok === false) p.reject(new Error(e.data.error));
      else p.resolve(e.data);
    };
    const fail = (msg: string) => {
      for (const [, p] of slot.pending) p.reject(new Error(msg));
      slot.pending.clear();
    };
    worker.onerror = (ev) => fail(ev.message || "Sweep worker crashed");
    worker.onmessageerror = () => fail("Sweep worker sent an unreadable message");
    return slot;
  }

  private send(slot: Slot, msg: SweepMessage, transfer?: Transferable[]): Promise<SweepResponse> {
    const id = this.nextId++;
    const full = { ...msg, id } as SweepRequest;
    return new Promise<SweepResponse>((resolve, reject) => {
      slot.pending.set(id, { resolve, reject });
      slot.worker.postMessage(full, transfer ?? []);
    });
  }

  /** `chunkSets[i]` belongs to worker i — one decoded copy each. */
  async init(
    symbol: string,
    chunkSets: ArrayBuffer[][],
    fromMs: number | null,
    toMs: number | null,
    specOverride?: Partial<InstrumentSpec> | null,
  ): Promise<void> {
    this.terminate();
    this.stopped = false;
    this.slots = chunkSets.map(() => this.spawn());
    await Promise.all(
      this.slots.map((slot, i) =>
        this.send(slot, { type: "init", symbol, chunks: chunkSets[i], fromMs, toMs, specOverride }, chunkSets[i]),
      ),
    );
  }

  stop() {
    this.stopped = true;
  }

  terminate() {
    for (const s of this.slots) s.worker.terminate();
    this.slots = [];
  }

  /**
   * Run every candidate, keeping all workers saturated. `onRows` fires per
   * completed batch so the caller can checkpoint before the run finishes.
   */
  async runBatches(
    candidates: SweepCandidate[],
    batchSize: number,
    onRows: (rows: ConfigRow[]) => void | Promise<void>,
  ): Promise<void> {
    let cursor = 0;
    const takeBatch = () => {
      if (cursor >= candidates.length) return null;
      const batch = candidates.slice(cursor, cursor + batchSize);
      cursor += batch.length;
      return batch;
    };

    const drive = async (slot: Slot) => {
      for (;;) {
        if (this.stopped) return;
        const batch = takeBatch();
        if (!batch) return;
        const res = await this.send(slot, { type: "batch", candidates: batch });
        if (res.type === "rows") await onRows(res.rows);
      }
    };

    await Promise.all(this.slots.map((s) => drive(s)));
  }

  /** Single request on the first free worker (used for nulls, trade logs). */
  async one(msg: SweepMessage): Promise<SweepResponse> {
    const slot = this.slots.find((s) => !s.busy) ?? this.slots[0];
    if (!slot) throw new Error("Sweep pool has no workers");
    slot.busy = true;
    try {
      return await this.send(slot, msg);
    } finally {
      slot.busy = false;
    }
  }
}
