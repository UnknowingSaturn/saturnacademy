import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Search, RefreshCw, CheckCircle2, XCircle, ChevronDown, AlertTriangle, Info } from "lucide-react";
import { SymbolMapping, SymbolSpec, SymbolCatalog, Mt5Terminal } from "../../types";

interface SymbolMappingStepV2Props {
  masterTerminal: Mt5Terminal | null;
  receiverTerminals: Mt5Terminal[];
  symbolMappings: SymbolMapping[];
  onMappingsChange: (mappings: SymbolMapping[]) => void;
  onContinue: () => void;
  onBack: () => void;
}

// Get spec match confidence and warnings
function getSpecMatchInfo(
  masterSymbol: string,
  receiverSymbol: string,
  masterSpecs: Record<string, SymbolSpec>,
  receiverSpecs: Record<string, SymbolSpec>
): { confidence: number; warnings: string[]; color: string } {
  const mSpec = masterSpecs[masterSymbol];
  const rSpec = receiverSpecs[receiverSymbol];
  
  if (!mSpec || !rSpec) {
    return { confidence: 50, warnings: ["Specs not available"], color: "text-muted-foreground" };
  }
  
  const warnings: string[] = [];
  let score = 100;
  
  // Contract size check
  const contractDiff = Math.abs((mSpec.contract_size - rSpec.contract_size) / mSpec.contract_size);
  if (contractDiff > 0.01) {
    warnings.push(`Contract size: ${mSpec.contract_size} vs ${rSpec.contract_size}`);
    score -= 25;
  }
  
  // Digits check
  if (mSpec.digits !== rSpec.digits) {
    warnings.push(`Digits: ${mSpec.digits} vs ${rSpec.digits}`);
    score -= 20;
  }
  
  // Tick size check
  const tickDiff = Math.abs((mSpec.tick_size - rSpec.tick_size) / mSpec.tick_size);
  if (tickDiff > 0.1) {
    warnings.push(`Tick size: ${mSpec.tick_size} vs ${rSpec.tick_size}`);
    score -= 15;
  }
  
  // Tick value check (more tolerance due to broker differences)
  const tickValDiff = Math.abs((mSpec.tick_value - rSpec.tick_value) / mSpec.tick_value);
  if (tickValDiff > 0.25) {
    warnings.push(`Tick value differs by ${Math.round(tickValDiff * 100)}%`);
    score -= 10;
  }
  
  // Profit currency check
  if (mSpec.profit_currency && rSpec.profit_currency && 
      mSpec.profit_currency.toUpperCase() !== rSpec.profit_currency.toUpperCase()) {
    warnings.push(`Currency: ${mSpec.profit_currency} vs ${rSpec.profit_currency}`);
    score -= 20;
  }
  
  const color = score >= 90 ? "text-green-500" : score >= 70 ? "text-yellow-500" : "text-red-500";
  
  return { confidence: Math.max(0, score), warnings, color };
}

export default function SymbolMappingStepV2({
  masterTerminal,
  receiverTerminals,
  symbolMappings,
  onMappingsChange,
  onContinue,
  onBack,
}: SymbolMappingStepV2Props) {
  const [mappings, setMappings] = useState<SymbolMapping[]>(symbolMappings);
  const [masterSymbols, setMasterSymbols] = useState<string[]>([]);
  const [receiverCatalog, setReceiverCatalog] = useState<SymbolSpec[]>([]);
  const [masterSpecs, setMasterSpecs] = useState<Record<string, SymbolSpec>>({});
  const [receiverSpecs, setReceiverSpecs] = useState<Record<string, SymbolSpec>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // For adding new mapping
  const [newMasterSymbol, setNewMasterSymbol] = useState("");
  const [newReceiverSymbol, setNewReceiverSymbol] = useState("");
  const [masterSearch, setMasterSearch] = useState("");
  const [receiverSearch, setReceiverSearch] = useState("");
  const [showMasterDropdown, setShowMasterDropdown] = useState(false);
  const [showReceiverDropdown, setShowReceiverDropdown] = useState(false);
  
  // Tooltip state
  const [hoveredMapping, setHoveredMapping] = useState<number | null>(null);

  // Load symbol catalogs
  useEffect(() => {
    const loadCatalogs = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Get master symbols
        if (masterTerminal) {
          try {
            const symbols = await invoke<string[]>("get_master_symbols", {
              terminalId: masterTerminal.terminal_id,
            });
            setMasterSymbols(symbols);
            
            // Try to get master symbol specs
            try {
              const catalog = await invoke<SymbolCatalog>("get_symbol_catalog", {
                terminalId: masterTerminal.terminal_id,
              });
              const specs: Record<string, SymbolSpec> = {};
              catalog.symbols.forEach(s => specs[s.name] = s);
              setMasterSpecs(specs);
            } catch {
              // Master specs not available - that's okay
            }
          } catch (err) {
            console.warn("Could not fetch master symbols:", err);
            setMasterSymbols(COMMON_SYMBOLS);
          }
        }
        
        // Get receiver symbol catalog
        if (receiverTerminals.length > 0) {
          try {
            const catalog = await invoke<SymbolCatalog>("get_symbol_catalog", {
              terminalId: receiverTerminals[0].terminal_id,
            });
            setReceiverCatalog(catalog.symbols);
            
            // Build receiver specs lookup
            const specs: Record<string, SymbolSpec> = {};
            catalog.symbols.forEach(s => specs[s.name] = s);
            setReceiverSpecs(specs);
          } catch (err) {
            console.warn("Could not fetch receiver symbols:", err);
            setReceiverCatalog(COMMON_SYMBOLS.map(s => ({
              name: s,
              normalized_key: s,
              tick_value: 0,
              tick_size: 0,
              contract_size: 0,
              digits: 5,
              min_lot: 0.01,
              lot_step: 0.01,
              max_lot: 100,
            })));
          }
        }
      } catch (err) {
        setError(`Failed to load symbols: ${err}`);
      } finally {
        setLoading(false);
      }
    };
    
    loadCatalogs();
  }, [masterTerminal, receiverTerminals]);

  // Auto-map when catalogs load
  const handleAutoMap = async () => {
    if (masterSymbols.length === 0 || receiverCatalog.length === 0) {
      // Use common symbols as fallback
      const autoMappings: SymbolMapping[] = COMMON_SYMBOLS.map(symbol => ({
        master_symbol: symbol,
        receiver_symbol: symbol,
        enabled: true,
      }));
      setMappings(autoMappings);
      onMappingsChange(autoMappings);
      return;
    }
    
    try {
      const autoMappings = await invoke<SymbolMapping[]>("auto_map_symbols", {
        masterSymbols,
        receiverTerminalId: receiverTerminals[0]?.terminal_id,
      });
      setMappings(autoMappings);
      onMappingsChange(autoMappings);
    } catch (err) {
      console.warn("Auto-map failed, using common symbols:", err);
      const autoMappings: SymbolMapping[] = COMMON_SYMBOLS.map(symbol => ({
        master_symbol: symbol,
        receiver_symbol: symbol,
        enabled: true,
      }));
      setMappings(autoMappings);
      onMappingsChange(autoMappings);
    }
  };

  // Filter symbols for dropdowns
  const filteredMasterSymbols = useMemo(() => {
    const search = masterSearch.toUpperCase();
    const symbols = masterSymbols.length > 0 ? masterSymbols : COMMON_SYMBOLS;
    return symbols.filter(s => s.toUpperCase().includes(search)).slice(0, 50);
  }, [masterSymbols, masterSearch]);

  const filteredReceiverSymbols = useMemo(() => {
    const search = receiverSearch.toUpperCase();
    const symbols = receiverCatalog.length > 0 
      ? receiverCatalog.map(s => s.name) 
      : COMMON_SYMBOLS;
    return symbols.filter(s => s.toUpperCase().includes(search)).slice(0, 50);
  }, [receiverCatalog, receiverSearch]);

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
    setNewMasterSymbol("");
    setNewReceiverSymbol("");
    setMasterSearch("");
    setReceiverSearch("");
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

  const handleClearAll = () => {
    setMappings([]);
    onMappingsChange([]);
  };

  const handleSelectMasterSymbol = (symbol: string) => {
    setNewMasterSymbol(symbol);
    setMasterSearch("");
    setShowMasterDropdown(false);
    
    // Auto-fill receiver with same symbol
    if (!newReceiverSymbol) {
      setNewReceiverSymbol(symbol);
    }
  };

  const handleSelectReceiverSymbol = (symbol: string) => {
    setNewReceiverSymbol(symbol);
    setReceiverSearch("");
    setShowReceiverDropdown(false);
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

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/30 rounded text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground mt-4">Loading symbol catalogs...</p>
        </div>
      ) : (
        <>
          {/* Quick Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleAutoMap}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm bg-primary/10 text-primary border border-primary/20 rounded-lg hover:bg-primary/20"
            >
              ✨ Auto-map symbols
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

          {/* Symbol counts */}
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>Master symbols: {masterSymbols.length || COMMON_SYMBOLS.length}</span>
            <span>•</span>
            <span>Receiver symbols: {receiverCatalog.length || COMMON_SYMBOLS.length}</span>
          </div>

          {/* Add Mapping Form with searchable dropdowns */}
          <div className="p-4 bg-muted/50 rounded-lg space-y-3">
            <h3 className="text-sm font-medium">Add Custom Mapping</h3>
            <div className="flex gap-2 items-end">
              {/* Master Symbol Dropdown */}
              <div className="flex-1 space-y-1 relative">
                <label className="text-xs text-muted-foreground">Master Symbol</label>
                <div className="relative">
                  <input
                    type="text"
                    value={newMasterSymbol || masterSearch}
                    onChange={(e) => {
                      setMasterSearch(e.target.value);
                      setNewMasterSymbol(e.target.value.toUpperCase());
                      setShowMasterDropdown(true);
                    }}
                    onFocus={() => setShowMasterDropdown(true)}
                    onBlur={() => setTimeout(() => setShowMasterDropdown(false), 150)}
                    placeholder="Search or type..."
                    className="w-full px-3 py-2 pr-8 border border-border rounded-lg bg-background text-sm"
                  />
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                </div>
                {showMasterDropdown && filteredMasterSymbols.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-popover border border-border rounded-lg shadow-lg">
                    {filteredMasterSymbols.map((symbol) => (
                      <button
                        key={symbol}
                        onClick={() => handleSelectMasterSymbol(symbol)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        {symbol}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="text-muted-foreground pb-2">→</div>
              
              {/* Receiver Symbol Dropdown */}
              <div className="flex-1 space-y-1 relative">
                <label className="text-xs text-muted-foreground">Receiver Symbol</label>
                <div className="relative">
                  <input
                    type="text"
                    value={newReceiverSymbol || receiverSearch}
                    onChange={(e) => {
                      setReceiverSearch(e.target.value);
                      setNewReceiverSymbol(e.target.value.toUpperCase());
                      setShowReceiverDropdown(true);
                    }}
                    onFocus={() => setShowReceiverDropdown(true)}
                    onBlur={() => setTimeout(() => setShowReceiverDropdown(false), 150)}
                    placeholder="Search or type..."
                    className="w-full px-3 py-2 pr-8 border border-border rounded-lg bg-background text-sm"
                  />
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                </div>
                {showReceiverDropdown && filteredReceiverSymbols.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-popover border border-border rounded-lg shadow-lg">
                    {filteredReceiverSymbols.map((symbol) => (
                      <button
                        key={symbol}
                        onClick={() => handleSelectReceiverSymbol(symbol)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        {symbol}
                      </button>
                    ))}
                  </div>
                )}
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
                {mappings.map((mapping, index) => {
                  const specInfo = getSpecMatchInfo(
                    mapping.master_symbol,
                    mapping.receiver_symbol,
                    masterSpecs,
                    receiverSpecs
                  );
                  
                  return (
                    <div
                      key={index}
                      className={`flex items-center gap-2 p-2 border rounded-lg transition-opacity ${
                        mapping.enabled ? "border-border" : "border-border/50 opacity-50"
                      }`}
                      onMouseEnter={() => setHoveredMapping(index)}
                      onMouseLeave={() => setHoveredMapping(null)}
                    >
                      <button
                        onClick={() => handleToggleMapping(index)}
                        className={`w-4 h-4 rounded border flex items-center justify-center ${
                          mapping.enabled ? "bg-primary border-primary text-primary-foreground" : "border-border"
                        }`}
                      >
                        {mapping.enabled && <span className="text-xs">✓</span>}
                      </button>
                      <span className="text-sm font-mono flex-1">{mapping.master_symbol}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-sm font-mono flex-1">{mapping.receiver_symbol}</span>
                      
                      {/* Spec match indicator */}
                      <div className="relative">
                        {specInfo.warnings.length === 0 ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        ) : specInfo.confidence >= 70 ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-yellow-500">{specInfo.confidence}%</span>
                            <AlertTriangle className="w-4 h-4 text-yellow-500" />
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-red-500">{specInfo.confidence}%</span>
                            <XCircle className="w-4 h-4 text-red-500" />
                          </div>
                        )}
                        
                        {/* Warning tooltip */}
                        {hoveredMapping === index && specInfo.warnings.length > 0 && (
                          <div className="absolute z-50 bottom-full right-0 mb-2 w-64 p-2 bg-popover border border-border rounded-lg shadow-lg text-xs">
                            <div className="font-medium mb-1 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Spec Differences
                            </div>
                            <ul className="space-y-0.5 text-muted-foreground">
                              {specInfo.warnings.map((w, i) => (
                                <li key={i}>• {w}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                      
                      <button
                        onClick={() => handleRemoveMapping(index)}
                        className="w-6 h-6 text-muted-foreground hover:text-destructive"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <p className="text-xs text-blue-600 dark:text-blue-400">
              <strong>Tip:</strong> Symbols are auto-matched by normalized name (removing suffixes like .m, .pro, .cash). 
              Use the dropdown to search available symbols from your terminals.
            </p>
          </div>
        </>
      )}

      <div className="flex gap-3 pt-4">
        <button
          onClick={onBack}
          className="px-4 py-2.5 text-sm border border-border rounded-lg hover:bg-accent"
        >
          Back
        </button>
        <button
          onClick={onContinue}
          disabled={loading}
          className="flex-1 px-4 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// Common symbols fallback
const COMMON_SYMBOLS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD',
  'EURJPY', 'GBPJPY', 'EURGBP', 'XAUUSD', 'XAGUSD', 'US30', 'US100', 'US500',
  'NAS100', 'SPX500', 'BTCUSD', 'ETHUSD', 'EURCAD', 'EURNZD', 'EURAUD',
  'GBPAUD', 'GBPCAD', 'GBPNZD', 'AUDCAD', 'AUDNZD', 'NZDCAD', 'CADJPY',
  'AUDJPY', 'NZDJPY', 'CHFJPY', 'EURCHF', 'GBPCHF', 'AUDCHF', 'CADCHF',
];
