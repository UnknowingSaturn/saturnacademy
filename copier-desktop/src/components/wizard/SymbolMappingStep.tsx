import { useState } from "react";
import { SymbolMapping } from "../../types";

interface SymbolMappingStepProps {
  symbolMappings: SymbolMapping[];
  onMappingsChange: (mappings: SymbolMapping[]) => void;
  onContinue: () => void;
  onBack: () => void;
}

// Most commonly traded symbols
const COMMON_SYMBOLS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD',
  'EURJPY', 'GBPJPY', 'EURGBP', 'XAUUSD', 'XAGUSD', 'US30', 'US100', 'US500',
  'NAS100', 'SPX500', 'BTCUSD', 'ETHUSD',
];

export default function SymbolMappingStep({
  symbolMappings,
  onMappingsChange,
  onContinue,
  onBack,
}: SymbolMappingStepProps) {
  const [mappings, setMappings] = useState<SymbolMapping[]>(symbolMappings);
  const [newMasterSymbol, setNewMasterSymbol] = useState('');
  const [newReceiverSymbol, setNewReceiverSymbol] = useState('');

  const handleAddMapping = () => {
    if (!newMasterSymbol.trim()) return;
    
    const mapping: SymbolMapping = {
      master_symbol: newMasterSymbol.toUpperCase().trim(),
      receiver_symbol: (newReceiverSymbol || newMasterSymbol).toUpperCase().trim(),
      enabled: true,
    };
    
    // Check for duplicate
    if (mappings.some(m => m.master_symbol === mapping.master_symbol)) {
      return;
    }
    
    const updated = [...mappings, mapping];
    setMappings(updated);
    onMappingsChange(updated);
    setNewMasterSymbol('');
    setNewReceiverSymbol('');
  };

  const handleRemoveMapping = (index: number) => {
    const updated = mappings.filter((_, i) => i !== index);
    setMappings(updated);
    onMappingsChange(updated);
  };

  const handleToggleMapping = (index: number) => {
    const updated = mappings.map((m, i) => 
      i === index ? { ...m, enabled: !m.enabled } : m
    );
    setMappings(updated);
    onMappingsChange(updated);
  };

  const handleAutoMap = () => {
    // Generate common symbol mappings
    const autoMappings: SymbolMapping[] = COMMON_SYMBOLS.map(symbol => ({
      master_symbol: symbol,
      receiver_symbol: symbol, // Same symbol, broker handles suffix
      enabled: true,
    }));
    
    setMappings(autoMappings);
    onMappingsChange(autoMappings);
  };

  const handleClearAll = () => {
    setMappings([]);
    onMappingsChange([]);
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="text-3xl mb-2">🔄</div>
        <h2 className="text-xl font-semibold mb-1">Symbol Mapping</h2>
        <p className="text-sm text-muted-foreground">
          Map symbols between master and receiver accounts
        </p>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleAutoMap}
          className="flex-1 px-3 py-2 text-sm bg-primary/10 text-primary border border-primary/20 rounded-lg hover:bg-primary/20"
        >
          ✨ Auto-map common symbols
        </button>
        {mappings.length > 0 && (
          <button
            onClick={handleClearAll}
            className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-destructive/10 hover:text-destructive"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Add Mapping Form */}
      <div className="p-4 bg-muted/50 rounded-lg space-y-3">
        <h3 className="text-sm font-medium">Add Custom Mapping</h3>
        <div className="flex gap-2 items-end">
          <div className="flex-1 space-y-1">
            <label className="text-xs text-muted-foreground">Master Symbol</label>
            <input
              type="text"
              value={newMasterSymbol}
              onChange={e => setNewMasterSymbol(e.target.value.toUpperCase())}
              placeholder="e.g. EURUSD"
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm"
            />
          </div>
          <div className="text-muted-foreground">→</div>
          <div className="flex-1 space-y-1">
            <label className="text-xs text-muted-foreground">Receiver Symbol</label>
            <input
              type="text"
              value={newReceiverSymbol}
              onChange={e => setNewReceiverSymbol(e.target.value.toUpperCase())}
              placeholder="e.g. EURUSDm"
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm"
            />
          </div>
          <button
            onClick={handleAddMapping}
            disabled={!newMasterSymbol.trim()}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      {/* Mapping List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Current Mappings</h3>
          <span className="text-xs text-muted-foreground">{mappings.length} symbols</span>
        </div>
        
        {mappings.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-border rounded-lg">
            <p className="text-sm text-muted-foreground">No symbol mappings configured</p>
            <p className="text-xs text-muted-foreground mt-1">Click "Auto-map" or add custom mappings above</p>
          </div>
        ) : (
          <div className="max-h-48 overflow-y-auto space-y-1.5 p-1">
            {mappings.map((mapping, index) => (
              <div
                key={index}
                className={`flex items-center gap-2 p-2 border rounded-lg transition-opacity ${
                  mapping.enabled ? 'border-border' : 'border-border/50 opacity-50'
                }`}
              >
                <button
                  onClick={() => handleToggleMapping(index)}
                  className={`w-4 h-4 rounded border flex items-center justify-center ${
                    mapping.enabled ? 'bg-primary border-primary text-primary-foreground' : 'border-border'
                  }`}
                >
                  {mapping.enabled && <span className="text-xs">✓</span>}
                </button>
                <span className="text-sm font-mono flex-1">{mapping.master_symbol}</span>
                <span className="text-muted-foreground">→</span>
                <span className="text-sm font-mono flex-1">{mapping.receiver_symbol}</span>
                <button
                  onClick={() => handleRemoveMapping(index)}
                  className="w-6 h-6 text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <p className="text-xs text-blue-600 dark:text-blue-400">
          <strong>Tip:</strong> Leave receiver symbol empty to use the same symbol. 
          Most brokers use the same symbol names, but some add suffixes like "m" or ".pro".
        </p>
      </div>

      <div className="flex gap-3 pt-4">
        <button
          onClick={onBack}
          className="px-4 py-2.5 text-sm border border-border rounded-lg hover:bg-accent"
        >
          Back
        </button>
        <button
          onClick={onContinue}
          className="flex-1 px-4 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
