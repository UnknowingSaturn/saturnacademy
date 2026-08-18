// ============================================================================
// MT5 history import — drag a 1-minute export in, confirm the broker clock,
// write it to the bar store.
//
// This is the primary data path for the backtest lab: the broker's own M1
// history means backtested fills are comparable with the journal.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Upload, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMt5Import } from "@/hooks/useMt5Import";

interface Props {
  symbol: string;
  onImported?: () => void;
}

const OFFSETS = [-5, -4, 0, 1, 2, 3];

export function Mt5ImportPanel({ symbol, onImported }: Props) {
  const { analyze, commit, reset, preview, isParsing, isUploading, progress, error } =
    useMt5Import();
  const [targetSymbol, setTargetSymbol] = useState(symbol);
  const [offsetHours, setOffsetHours] = useState<number>(0);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setTargetSymbol(symbol), [symbol]);
  useEffect(() => {
    if (preview?.offsetMinutes != null) setOffsetHours(preview.offsetMinutes / 60);
  }, [preview?.offsetMinutes]);

  const onFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      const guess = file.name.replace(/\.[^.]+$/, "").match(/^[A-Za-z0-9._#+-]{2,20}/)?.[0];
      if (guess) setTargetSymbol(guess.toUpperCase().replace(/[_-]?(1|M1|MIN)$/i, ""));
      void analyze(file, null);
    },
    [analyze],
  );

  const stepOk = preview?.stepMs === 60_000;
  const barCount = preview?.months.reduce((a, m) => a + m.barCount, 0) ?? 0;
  const gapMonths = preview?.months.filter((m) => m.missingDays > 3).length ?? 0;
  const symbolOk = /^[A-Z0-9][A-Z0-9._#+-]{1,19}$/.test(targetSymbol);

  return (
    <div className="rounded-lg border border-border/60 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-medium">Import MT5 history</h3>
        <p className="text-xs text-muted-foreground">
          MT5 → View → Symbols → pick the symbol → Bars → M1 → Export. Broker prices,
          so backtests line up with your journal.
        </p>
      </div>

      {!preview && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter") inputRef.current?.click(); }}
          className={`rounded-md border border-dashed p-6 text-center cursor-pointer transition-colors ${
            dragging ? "border-primary bg-primary/5" : "border-border/70 hover:border-primary/50"
          }`}
        >
          {isParsing ? (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Parsing…
            </span>
          ) : (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-2">
              <Upload className="w-3.5 h-3.5" /> Drop a CSV/TSV export, or click to choose
            </span>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.txt,.tsv,text/csv,text/plain"
            className="hidden"
            aria-label="MT5 history file"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {preview && (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{preview.fileName}</span> ·{" "}
              {preview.totalBars?.toLocaleString()} rows ·{" "}
              {preview.months.length} month{preview.months.length === 1 ? "" : "s"}
              {preview.skipped ? ` · ${preview.skipped} skipped` : ""}
              {preview.duplicates ? ` · ${preview.duplicates} duplicate minutes` : ""}
            </div>
            <Button variant="ghost" size="sm" onClick={reset} aria-label="Discard file">
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>

          {!stepOk && (
            <p className="text-xs text-destructive inline-flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              This looks like a {preview.stepMs ? `${Math.round(preview.stepMs / 60_000)}-minute` : "non-M1"} export.
              The lab needs 1-minute bars.
            </p>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="imp-symbol" className="text-xs">Symbol</Label>
              <Input
                id="imp-symbol"
                value={targetSymbol}
                onChange={(e) => setTargetSymbol(e.target.value.toUpperCase())}
                className="h-8 w-32"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="imp-offset" className="text-xs">Broker UTC offset</Label>
              <select
                id="imp-offset"
                value={offsetHours}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setOffsetHours(v);
                  void analyze(null, v * 60);
                }}
                className="h-8 w-32 rounded-md border border-input bg-background px-2 text-xs"
              >
                {[...new Set([...OFFSETS, offsetHours])].sort((a, b) => a - b).map((h) => (
                  <option key={h} value={h}>
                    UTC{h >= 0 ? "+" : ""}{h}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted-foreground pb-1.5">
              {preview.offsetConfident ? (
                <span className="inline-flex items-center gap-1 text-emerald-500">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  detected from {preview.offsetSamples} weekly closes
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-amber-500">
                  <AlertTriangle className="w-3.5 h-3.5" /> couldn't detect — set it yourself
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-1">
            {preview.months.map((m) => {
              const bad = m.missingDays > 3 || m.invalidBars > 0;
              return (
                <span
                  key={m.month}
                  title={`${m.barCount.toLocaleString()} bars · ${m.missingMinutes.toLocaleString()} missing minutes · ${m.missingDays} empty weekdays`}
                  className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    bad
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                      : "border-border/50 bg-muted/20 text-muted-foreground"
                  }`}
                >
                  {m.month}
                </span>
              );
            })}
          </div>

          {gapMonths > 0 && (
            <p className="text-xs text-amber-500">
              {gapMonths} month(s) have more than 3 empty weekdays — your terminal's history
              may be truncated there.
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!stepOk || !symbolOk || isUploading || isParsing}
              onClick={async () => {
                await commit(targetSymbol, offsetHours * 60);
                onImported?.();
              }}
            >
              {isUploading && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Import {preview.months.length} month{preview.months.length === 1 ? "" : "s"} ·{" "}
              {barCount.toLocaleString()} bars
            </Button>
            {isUploading && progress.total > 0 && (
              <span className="text-xs text-muted-foreground">
                {progress.done}/{progress.total} {progress.current ?? ""}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
