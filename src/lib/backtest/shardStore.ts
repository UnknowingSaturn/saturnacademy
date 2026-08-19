// ============================================================================
// Sweep checkpointing.
//
// A 10k-config sweep runs for tens of minutes; a reload must not throw the
// work away. Completed config rows are written to IndexedDB in shards keyed by
// the run key (symbol + range + grid version + sample seed + N). On restart the
// pool loads the stored hashes and skips them, exactly as the process-pool
// design in the spec does with parquet shards.
//
// IndexedDB rather than localStorage: 10k rows of canonical parameters is
// several MB, well past the 5MB string quota.
// ============================================================================

import type { ConfigRow } from "../../../shared/quant/ict/sweep";

const DB_NAME = "ict-sweep";
const DB_VERSION = 1;
const STORE = "rows";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("runKey", "runKey", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
  return dbPromise;
}

interface StoredRow {
  key: string;
  runKey: string;
  row: ConfigRow;
}

export function runKeyFor(parts: {
  symbol: string;
  fromMonth: string;
  toMonth: string;
  seed: number;
  n: number;
  gridSize: number;
}): string {
  return [parts.symbol, parts.fromMonth, parts.toMonth, parts.seed, parts.n, parts.gridSize].join("|");
}

export async function saveShard(runKey: string, rows: ConfigRow[]): Promise<void> {
  if (!rows.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const row of rows) {
      const rec: StoredRow = { key: `${runKey}::${row.hash}`, runKey, row };
      store.put(rec);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not write sweep shard"));
  });
}

export async function loadShards(runKey: string): Promise<ConfigRow[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const index = tx.objectStore(STORE).index("runKey");
    const req = index.getAll(IDBKeyRange.only(runKey));
    req.onsuccess = () => resolve((req.result as StoredRow[]).map((r) => r.row));
    req.onerror = () => reject(req.error ?? new Error("Could not read sweep shards"));
  });
}

export async function clearShards(runKey: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.index("runKey").openCursor(IDBKeyRange.only(runKey));
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) {
        cur.delete();
        cur.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not clear sweep shards"));
  });
}
