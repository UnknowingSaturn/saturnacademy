// ============================================================================
// Setup tab — tabbed settings surface for everything that isn't analysis.
// Sub-tabs: Simulator profile · Symbol groups · Symbol aliases.
// ============================================================================

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { SymbolAliasManager } from "@/components/pair-lab/SymbolAliasManager";
import { SymbolGroupManager } from "@/components/pair-lab/SymbolGroupManager";
import { SimulatorProfileSettings } from "@/components/pair-lab/SimulatorProfileSettings";
import type { usePairLab } from "@/hooks/usePairLab";

interface Props {
  data: ReturnType<typeof usePairLab>;
  /** Audit U-B5: URL-persisted sub-tab so the choice survives reloads / shares. */
  setupTab?: string;
  setSetupTab?: (v: string) => void;
}

export function SetupTab({ data, setupTab = "simulator", setSetupTab }: Props) {
  return (
    <Tabs value={setupTab} onValueChange={(v) => setSetupTab?.(v)}>
      <TabsList>
        <TabsTrigger value="simulator">Simulator profile</TabsTrigger>
        <TabsTrigger value="groups">Symbol groups</TabsTrigger>
        <TabsTrigger value="aliases">Symbol aliases</TabsTrigger>
      </TabsList>

      <TabsContent value="simulator" className="mt-4">
        <Card className="p-6 space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Simulator profile</h3>
            <p className="text-xs text-muted-foreground">
              Sets the notional balance, default risk %, and prop-firm
              constraints used to convert R into $ everywhere in Pair Lab.
            </p>
          </div>
          <SimulatorProfileSettings />
          <div className="text-[11px] text-muted-foreground border-t border-border/40 pt-3">
            Source in use:{" "}
            <span className="font-medium text-foreground">
              {data.simSource === "active_account"
                ? "active account"
                : "simulator profile"}
            </span>{" "}
            · ${data.simBalance.toLocaleString()} ·{" "}
            {data.defaultSimRiskPct?.toFixed(2) ?? "—"}% default risk
          </div>
        </Card>
      </TabsContent>

      <TabsContent value="groups" className="mt-4">
        <SymbolGroupManager availableSymbols={data.symbols} />
      </TabsContent>

      <TabsContent value="aliases" className="mt-4">
        <SymbolAliasManager trades={data.trades} isLoading={data.isLoading} />
      </TabsContent>
    </Tabs>
  );
}
