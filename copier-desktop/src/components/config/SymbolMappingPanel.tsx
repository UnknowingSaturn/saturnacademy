import { useState } from "react";
import { Plus, Trash2, RefreshCw, ArrowRight, Check, X } from "lucide-react";
import { SymbolMapping } from "../../types";

interface SymbolMappingPanelProps {
  mappings: SymbolMapping[];
  onChange: (mappings: SymbolMapping[]) => void;
}

const COMMON_SYMBOLS = [
  "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD",
  "EURJPY", "GBPJPY", "EURGBP", "XAUUSD", "XAGUSD", "US30", "US500", "NAS100"
];

export function SymbolMappingPanel({ mappings, onChange }: SymbolMappingPanelProps) {
  const [newMasterSymbol, setNewMasterSymbol] = useState("");
  const [newReceiverSymbol, setNewReceiverSymbol] = useState("");

  const handleAddMapping = () => {
    if (!newMasterSymbol.trim() || !newReceiverSymbol.trim()) return;
    
    const newMapping: SymbolMapping = {
      master_symbol: newMasterSymbol.toUpperCase().trim(),
      receiver_symbol: newReceiverSymbol.toUpperCase().trim(),
      enabled: true,
    };
    
    onChange([...mappings, newMapping]);
    setNewMasterSymbol("");
    setNewReceiverSymbol("");
  };

  const handleRemoveMapping = (index: number) => {
    const updated = mappings.filter((_, i) => i !== index);
    onChange(updated);
  };

  const handleToggleMapping = (index: number) => {
    const updated = mappings.map((m, i) => 
      i === index ? { ...m, enabled: !m.enabled } : m
    );
    onChange(updated);
  };

  const handleAutoMap = () => {
    const existingMasterSymbols = new Set(mappings.map(m => m.master_symbol));
    const newMappings = COMMON_SYMBOLS
      .filter(symbol => !existingMasterSymbols.has(symbol))
      .map(symbol => ({
        master_symbol: symbol,
        receiver_symbol: symbol,
        enabled: true,
      }));
    onChange([...mappings, ...newMappings]);
  };

  const handleClearAll = () => {
    onChange([]);
  };

  const handleUpdateMapping = (index: number, field: 'master_symbol' | 'receiver_symbol', value: string) => {
    const updated = mappings.map((m, i) => 
      i === index ? { ...m, [field]: value.toUpperCase() } : m
    );
    onChange(updated);
  };

  return (
    <div className="space-y-6">
      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleAutoMap}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Auto-Map Common Symbols
        </button>
        <button
          onClick={handleClearAll}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-destructive/10 text-destructive rounded-lg hover:bg-destructive/20 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Clear All
        </button>
      </div>

      {/* Add New Mapping */}
      <div className="glass-card p-4">
        <h3 className="text-sm font-medium mb-3">Add Symbol Mapping</h3>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1 block">Master Symbol</label>
            <input
              type="text"
              value={newMasterSymbol}
              onChange={(e) => setNewMasterSymbol(e.target.value)}
              placeholder="e.g., XAUUSD"
              className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <ArrowRight className="w-5 h-5 text-muted-foreground mt-5" />
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1 block">Receiver Symbol</label>
            <input
              type="text"
              value={newReceiverSymbol}
              onChange={(e) => setNewReceiverSymbol(e.target.value)}
              placeholder="e.g., GOLD"
              className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <button
            onClick={handleAddMapping}
            disabled={!newMasterSymbol.trim() || !newReceiverSymbol.trim()}
            className="mt-5 p-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Mappings List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Symbol Mappings</h3>
          <span className="text-xs text-muted-foreground">
            {mappings.filter(m => m.enabled).length} of {mappings.length} enabled
          </span>
        </div>
        
        {mappings.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <p className="text-muted-foreground text-sm">No symbol mappings configured</p>
            <p className="text-xs text-muted-foreground mt-1">
              Click "Auto-Map Common Symbols" to get started
            </p>
          </div>
        ) : (
          <div className="space-y-1 max-h-[400px] overflow-y-auto">
            {mappings.map((mapping, index) => (
              <div
                key={index}
                className={`glass-card p-3 flex items-center gap-3 transition-all ${
                  !mapping.enabled ? "opacity-50" : ""
                }`}
              >
                <button
                  onClick={() => handleToggleMapping(index)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    mapping.enabled 
                      ? "bg-profit/20 text-profit" 
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {mapping.enabled ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                </button>
                
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="text"
                    value={mapping.master_symbol}
                    onChange={(e) => handleUpdateMapping(index, 'master_symbol', e.target.value)}
                    className="w-24 bg-background/50 border border-border rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <input
                    type="text"
                    value={mapping.receiver_symbol}
                    onChange={(e) => handleUpdateMapping(index, 'receiver_symbol', e.target.value)}
                    className="w-24 bg-background/50 border border-border rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                
                {mapping.master_symbol !== mapping.receiver_symbol && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-500">
                    Remapped
                  </span>
                )}
                
                <button
                  onClick={() => handleRemoveMapping(index)}
                  className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
