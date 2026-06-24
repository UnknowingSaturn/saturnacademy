import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Wand2, Check, X, Trash2, Plus } from "lucide-react";
import {
  useSymbolAliases,
  useUpsertSymbolAlias,
  useDeleteSymbolAlias,
  useBulkUpsertSymbolAliases,
} from "@/hooks/useSymbolAliases";
import { detectAliasSuggestions } from "@/lib/symbolAliasing";
import { toast } from "sonner";
import type { Trade } from "@/types/trading";

interface Props {
  /** Trades already loaded by the parent — avoids a redundant useTrades fetch. */
  trades: Trade[];
  isLoading?: boolean;
}

export function SymbolAliasManager({ trades, isLoading = false }: Props) {
  const aliases = useSymbolAliases();
  const upsert = useUpsertSymbolAlias();
  const remove = useDeleteSymbolAlias();
  const bulk = useBulkUpsertSymbolAliases();

  // Local edits keyed by raw symbol.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newRaw, setNewRaw] = useState("");
  const [newCanonical, setNewCanonical] = useState("");

  const distinctSymbols = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of trades) {
      if (!t.symbol || t.is_archived) continue;
      counts.set(t.symbol, (counts.get(t.symbol) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([symbol, count]) => ({ symbol, count }))
      .sort((a, b) => b.count - a.count);
  }, [trades]);

  const suggestions = useMemo(
    () => detectAliasSuggestions(distinctSymbols, aliases.data ?? []),
    [distinctSymbols, aliases.data],
  );

  const aliasMap = useMemo(() => {
    const m = new Map<string, { canonical: string; source: string }>();
    for (const a of aliases.data ?? []) {
      m.set(a.raw_symbol.toUpperCase(), { canonical: a.canonical_symbol, source: a.source });
    }
    return m;
  }, [aliases.data]);

  const acceptAll = async () => {
    if (suggestions.length === 0) return;
    await bulk.mutateAsync(
      suggestions.map((s) => ({
        raw_symbol: s.raw_symbol,
        canonical_symbol: s.canonical_symbol,
        source: "auto",
      })),
    );
  };

  if (isLoading || aliases.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Suggestions */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Suggested aliases</h3>
            <Badge variant="outline" className="text-xs">{suggestions.length}</Badge>
          </div>
          {suggestions.length > 0 && (
            <Button size="sm" onClick={acceptAll} disabled={bulk.isPending}>
              {bulk.isPending ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : null}
              Accept all
            </Button>
          )}
        </div>

        {suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No fragmented symbols detected. Your broker variants are already grouped.
          </p>
        ) : (
          <ScrollArea className="max-h-[280px]">
            <div className="space-y-1.5">
              {suggestions.map((s) => (
                <div
                  key={s.raw_symbol}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono-numbers text-sm font-medium">{s.raw_symbol}</span>
                    <span className="text-xs text-muted-foreground">→</span>
                    <Input
                      value={edits[s.raw_symbol] ?? s.canonical_symbol}
                      onChange={(e) =>
                        setEdits((p) => ({ ...p, [s.raw_symbol]: e.target.value.toUpperCase() }))
                      }
                      className="h-7 w-28 font-mono-numbers text-sm"
                    />
                    <span className="text-xs text-muted-foreground">· {s.trade_count} trades</span>
                    {s.group.length > 1 && (
                      <span className="text-[10px] text-muted-foreground truncate">
                        groups: {s.group.join(", ")}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() =>
                        upsert.mutate({
                          raw_symbol: s.raw_symbol,
                          canonical_symbol: edits[s.raw_symbol] ?? s.canonical_symbol,
                          source: "manual",
                        })
                      }
                      title="Accept"
                    >
                      <Check className="w-3.5 h-3.5 text-profit" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => {
                        // Map raw → itself, marking it manual so the detector stops proposing.
                        upsert.mutate({
                          raw_symbol: s.raw_symbol,
                          canonical_symbol: s.raw_symbol.toUpperCase(),
                          source: "manual",
                        });
                      }}
                      title="Keep separate"
                    >
                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </Card>

      {/* Existing aliases */}
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-semibold">Saved aliases ({aliases.data?.length ?? 0})</h3>

        {(aliases.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing saved yet. Accept a suggestion above or add one manually below.
          </p>
        ) : (
          <div className="space-y-1.5">
            {(aliases.data ?? [])
              .slice()
              .sort((a, b) => a.raw_symbol.localeCompare(b.raw_symbol))
              .map((a) => (
                <div
                  key={a.raw_symbol}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/40 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono-numbers font-medium">{a.raw_symbol}</span>
                    <span className="text-xs text-muted-foreground">→</span>
                    <span className="font-mono-numbers font-medium">{a.canonical_symbol}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">{a.source}</Badge>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => remove.mutate(a.raw_symbol)}
                    title="Remove"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                  </Button>
                </div>
              ))}
          </div>
        )}

        {/* Manual add */}
        <div className="flex items-center gap-2 pt-2 border-t border-border/60">
          <Input
            value={newRaw}
            onChange={(e) => setNewRaw(e.target.value.toUpperCase())}
            placeholder="Raw broker symbol (e.g. EURUSD+)"
            className="h-8 font-mono-numbers text-sm"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            value={newCanonical}
            onChange={(e) => setNewCanonical(e.target.value.toUpperCase())}
            placeholder="Canonical (e.g. EURUSD)"
            className="h-8 font-mono-numbers text-sm"
          />
          <Button
            size="sm"
            onClick={() => {
              if (!newRaw || !newCanonical) {
                toast.error("Both raw and canonical are required.");
                return;
              }
              upsert.mutate(
                { raw_symbol: newRaw, canonical_symbol: newCanonical, source: "manual" },
                {
                  onSuccess: () => {
                    setNewRaw("");
                    setNewCanonical("");
                  },
                },
              );
            }}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add
          </Button>
        </div>
      </Card>
    </div>
  );
}
