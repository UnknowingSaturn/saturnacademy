import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Layers, X, Check } from "lucide-react";
import { useSymbolGroups, GROUP_TEMPLATES, type SymbolGroup } from "@/hooks/useSymbolGroups";
import { cn } from "@/lib/utils";

interface Props {
  availableSymbols: string[];
}

const COLOR_SWATCHES = ["#3b82f6", "#10b981", "#f59e0b", "#eab308", "#a855f7", "#ef4444", "#06b6d4", "#ec4899"];

export function SymbolGroupManager({ availableSymbols }: Props) {
  const { groups, isLoading, create, update, remove } = useSymbolGroups();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState<string>(COLOR_SWATCHES[0]);
  const [draftSymbols, setDraftSymbols] = useState<string[]>([]);
  const [draftOverrides, setDraftOverrides] = useState<Record<string, number>>({});

  const symbolSet = useMemo(() => new Set(availableSymbols), [availableSymbols]);

  const startCreate = () => {
    setEditingId("new");
    setDraftName("");
    setDraftColor(COLOR_SWATCHES[0]);
    setDraftSymbols([]);
    setDraftOverrides({});
  };

  const startEdit = (g: SymbolGroup) => {
    setEditingId(g.id);
    setDraftName(g.name);
    setDraftColor(g.color ?? COLOR_SWATCHES[0]);
    setDraftSymbols([...g.symbols]);
    setDraftOverrides({ ...(g.tick_size_overrides ?? {}) });
  };

  const cancel = () => {
    setEditingId(null);
    setDraftName("");
    setDraftSymbols([]);
    setDraftOverrides({});
  };

  const save = async () => {
    if (!draftName.trim() || draftSymbols.length === 0) return;
    // Strip empties / non-finite values from overrides before persisting.
    const cleanOverrides: Record<string, number> = {};
    for (const [k, v] of Object.entries(draftOverrides)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) cleanOverrides[k] = v;
    }
    if (editingId === "new") {
      await create.mutateAsync({
        name: draftName.trim(),
        color: draftColor,
        symbols: draftSymbols,
        tick_size_overrides: cleanOverrides,
      });
    } else if (editingId) {
      await update.mutateAsync({
        id: editingId,
        name: draftName.trim(),
        color: draftColor,
        symbols: draftSymbols,
        tick_size_overrides: cleanOverrides,
      });
    }
    cancel();
  };

  const toggleSymbol = (s: string) => {
    setDraftSymbols((cur) =>
      cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s].sort(),
    );
  };

  const setOverride = (sym: string, value: string) => {
    setDraftOverrides((cur) => {
      const next = { ...cur };
      const parsed = Number(value);
      if (!value || !Number.isFinite(parsed) || parsed <= 0) {
        delete next[sym];
      } else {
        next[sym] = parsed;
      }
      return next;
    });
  };

  const useTemplate = (t: typeof GROUP_TEMPLATES[number]) => {
    setEditingId("new");
    setDraftName(t.name);
    setDraftColor(t.color);
    // Only include symbols actually present in user's data
    setDraftSymbols(t.symbols.filter((s) => symbolSet.has(s)));
    setDraftOverrides({});
  };

  return (
    <Card className="p-5 space-y-5">
      <div className="flex items-start gap-2">
        <Layers className="w-4 h-4 text-primary mt-1" />
        <div className="flex-1">
          <h3 className="font-semibold">Pair groups</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Merge multiple symbols into a single analytic unit. Group metrics are recomputed from the
            underlying trades (N-weighted), never averaged from per-pair rates — so merging is lossless
            and you can unmerge any time. Use the view selector on the heatmap to switch between
            individual pairs and grouped.
          </p>
        </div>
        {editingId == null && (
          <Button size="sm" onClick={startCreate}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            New group
          </Button>
        )}
      </div>

      {/* Templates */}
      {editingId == null && (
        <div>
          <Label className="text-xs">Templates</Label>
          <div className="mt-1 flex flex-wrap gap-2">
            {GROUP_TEMPLATES.map((t) => {
              const matched = t.symbols.filter((s) => symbolSet.has(s)).length;
              return (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => useTemplate(t)}
                  disabled={matched === 0}
                  className={cn(
                    "rounded-md border border-border/60 px-3 py-1.5 text-xs flex items-center gap-2 hover:border-foreground/40 transition-colors",
                    matched === 0 && "opacity-40 cursor-not-allowed",
                  )}
                >
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                  <span>{t.name}</span>
                  <span className="text-muted-foreground">({matched}/{t.symbols.length})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Editor */}
      {editingId != null && (
        <div className="rounded-md border border-border/60 p-4 space-y-3 bg-muted/10">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="e.g. EUR majors"
                className="mt-1 h-8 text-xs"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs">Color</Label>
              <div className="mt-1 flex gap-1">
                {COLOR_SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setDraftColor(c)}
                    className={cn(
                      "w-6 h-6 rounded-full border-2 transition-all",
                      draftColor === c ? "border-foreground scale-110" : "border-transparent",
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div>
            <Label className="text-xs">Symbols ({draftSymbols.length} selected)</Label>
            <div className="mt-1 flex flex-wrap gap-1 max-h-48 overflow-y-auto rounded border border-border/40 p-2">
              {availableSymbols.length === 0 ? (
                <span className="text-xs text-muted-foreground">No symbols in your trades yet.</span>
              ) : (
                availableSymbols.map((s) => {
                  const on = draftSymbols.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSymbol(s)}
                      className={cn(
                        "h-7 rounded-md border px-2 text-xs font-mono-numbers transition-colors",
                        on
                          ? "border-primary/60 bg-primary/15 text-foreground"
                          : "border-border/40 text-muted-foreground hover:border-border",
                      )}
                    >
                      {s}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={cancel}>
              <X className="w-3.5 h-3.5 mr-1" />
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={!draftName.trim() || draftSymbols.length === 0 || create.isPending || update.isPending}
            >
              <Check className="w-3.5 h-3.5 mr-1" />
              Save
            </Button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : groups.length === 0 && editingId == null ? (
          <div className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border/40 rounded-md">
            No groups yet. Pick a template above or create one.
          </div>
        ) : (
          groups.map((g) => (
            <div
              key={g.id}
              className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2"
            >
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: g.color ?? "#888" }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{g.name}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {g.symbols.map((s) => (
                    <Badge key={s} variant="outline" className="text-[10px] font-mono-numbers">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => startEdit(g)} disabled={editingId != null}>
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove.mutate(g.id)}
                disabled={remove.isPending}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
