import { useState } from "react";
import { Plus, Trash2, Settings2 } from "lucide-react";
import { SymbolOverride } from "../../types";

interface SymbolOverridesPanelProps {
  overrides: SymbolOverride[];
  onChange: (overrides: SymbolOverride[]) => void;
}

export function SymbolOverridesPanel({ overrides, onChange }: SymbolOverridesPanelProps) {
  const [newSymbol, setNewSymbol] = useState("");
  const [newLotMultiplier, setNewLotMultiplier] = useState(1.0);
  const [newMaxLot, setNewMaxLot] = useState<number | undefined>(undefined);

  const handleAddOverride = () => {
    if (!newSymbol.trim()) return;
    
    const newOverride: SymbolOverride = {
      symbol: newSymbol.toUpperCase().trim(),
      lot_multiplier: newLotMultiplier,
      max_lots: newMaxLot,
      enabled: true,
    };
    
    onChange([...overrides, newOverride]);
    setNewSymbol("");
    setNewLotMultiplier(1.0);
    setNewMaxLot(undefined);
  };

  const handleRemoveOverride = (index: number) => {
    onChange(overrides.filter((_, i) => i !== index));
  };

  const handleToggleOverride = (index: number) => {
    const updated = overrides.map((o, i) => 
      i === index ? { ...o, enabled: !o.enabled } : o
    );
    onChange(updated);
  };

  const handleUpdateOverride = (index: number, field: keyof SymbolOverride, value: string | number | boolean | undefined) => {
    const updated = overrides.map((o, i) => 
      i === index ? { ...o, [field]: value } : o
    );
    onChange(updated);
  };

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div className="glass-card p-4 border-primary/30 bg-primary/5">
        <div className="flex items-start gap-3">
          <Settings2 className="w-5 h-5 text-primary mt-0.5" />
          <div>
            <span className="text-sm font-medium">Per-Symbol Risk Overrides</span>
            <p className="text-xs text-muted-foreground mt-1">
              Override lot sizing for specific symbols. For example, use a smaller multiplier for volatile symbols like XAUUSD, or set max lot limits for high-risk instruments.
            </p>
          </div>
        </div>
      </div>

      {/* Add New Override */}
      <div className="glass-card p-4">
        <h3 className="text-sm font-medium mb-3">Add Symbol Override</h3>
        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Symbol</label>
            <input
              type="text"
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              placeholder="e.g., XAUUSD"
              className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Lot Multiplier</label>
            <input
              type="number"
              value={newLotMultiplier}
              onChange={(e) => setNewLotMultiplier(parseFloat(e.target.value) || 1)}
              step={0.1}
              min={0.01}
              className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Max Lot (optional)</label>
            <input
              type="number"
              value={newMaxLot ?? ""}
              onChange={(e) => setNewMaxLot(e.target.value ? parseFloat(e.target.value) : undefined)}
              step={0.01}
              min={0.01}
              placeholder="No limit"
              className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleAddOverride}
              disabled={!newSymbol.trim()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
        </div>
      </div>

      {/* Overrides List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Active Overrides</h3>
          <span className="text-xs text-muted-foreground">
            {overrides.filter(o => o.enabled).length} of {overrides.length} active
          </span>
        </div>
        
        {overrides.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <Settings2 className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground text-sm">No symbol overrides configured</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add overrides for symbols that need different lot sizing
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {overrides.map((override, index) => (
              <div
                key={index}
                className={`glass-card p-3 flex items-center gap-4 transition-all ${
                  !override.enabled ? "opacity-50" : ""
                }`}
              >
                <button
                  onClick={() => handleToggleOverride(index)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    override.enabled ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      override.enabled ? "left-5" : "left-0.5"
                    }`}
                  />
                </button>
                
                <div className="w-24">
                  <input
                    type="text"
                    value={override.symbol}
                    onChange={(e) => handleUpdateOverride(index, 'symbol', e.target.value.toUpperCase())}
                    className="w-full bg-background/50 border border-border rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Multiplier:</span>
                  <input
                    type="number"
                    value={override.lot_multiplier}
                    onChange={(e) => handleUpdateOverride(index, 'lot_multiplier', parseFloat(e.target.value) || 1)}
                    step={0.1}
                    min={0.01}
                    className="w-16 bg-background/50 border border-border rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  <span className="text-xs text-muted-foreground">×</span>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Max:</span>
                  <input
                    type="number"
                    value={override.max_lots ?? ""}
                    onChange={(e) => handleUpdateOverride(index, 'max_lots', e.target.value ? parseFloat(e.target.value) : undefined)}
                    step={0.01}
                    min={0.01}
                    placeholder="∞"
                    className="w-16 bg-background/50 border border-border rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  <span className="text-xs text-muted-foreground">lots</span>
                </div>
                
                <button
                  onClick={() => handleRemoveOverride(index)}
                  className="ml-auto p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Example */}
      <div className="glass-card p-4 bg-muted/30">
        <h4 className="text-xs font-medium text-muted-foreground mb-2">Example Use Cases</h4>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>• <strong>XAUUSD</strong> - Multiplier: 0.5× (half size due to volatility)</li>
          <li>• <strong>US30</strong> - Max Lot: 0.50 (cap position size on indices)</li>
          <li>• <strong>EURUSD</strong> - Multiplier: 2.0× (double size on major pairs)</li>
        </ul>
      </div>
    </div>
  );
}
