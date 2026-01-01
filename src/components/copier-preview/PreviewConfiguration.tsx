import { useState } from "react";
import { 
  Shield, 
  Clock, 
  AlertTriangle, 
  Check,
  ChevronRight,
  Settings2,
  BarChart3,
  Link2
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";

// Mock receiver data
const mockReceivers = [
  {
    id: "rec-1",
    name: "FTMO Challenge",
    broker: "FTMO",
    account: "12345678",
    balance: 100000,
    isOnline: true,
    useGlobal: false,
  },
  {
    id: "rec-2",
    name: "IC Markets Live",
    broker: "IC Markets",
    account: "87654321",
    balance: 25000,
    isOnline: true,
    useGlobal: true,
  },
  {
    id: "rec-3",
    name: "Oanda Demo",
    broker: "Oanda",
    account: "11223344",
    balance: 10000,
    isOnline: false,
    useGlobal: true,
  },
];

type RiskMode = 'balance_multiplier' | 'fixed_lot' | 'risk_percent' | 'risk_dollar';

interface RiskConfig {
  mode: RiskMode;
  value: number;
}

interface SafetyConfig {
  maxSlippagePips: number;
  maxDailyLossR: number;
  propFirmSafeMode: boolean;
  manualConfirmMode: boolean;
}

interface SymbolMapping {
  masterSymbol: string;
  receiverSymbol: string;
  enabled: boolean;
}

interface SessionFilter {
  asian: boolean;
  london: boolean;
  newYork: boolean;
}

const COMMON_SYMBOLS = [
  "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", 
  "USDCAD", "NZDUSD", "XAUUSD", "XAGUSD", "US30"
];

export function PreviewConfiguration() {
  const [selectedReceiver, setSelectedReceiver] = useState<string | null>("rec-1");
  const [activeTab, setActiveTab] = useState("risk");
  
  // Mock config state
  const [riskConfig, setRiskConfig] = useState<RiskConfig>({
    mode: 'balance_multiplier',
    value: 1.0,
  });
  
  const [safetyConfig, setSafetyConfig] = useState<SafetyConfig>({
    maxSlippagePips: 3,
    maxDailyLossR: 3,
    propFirmSafeMode: true,
    manualConfirmMode: false,
  });
  
  const [symbolMappings, setSymbolMappings] = useState<SymbolMapping[]>(
    COMMON_SYMBOLS.map(s => ({ masterSymbol: s, receiverSymbol: s, enabled: true }))
  );
  
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>({
    asian: true,
    london: true,
    newYork: true,
  });

  const selectedReceiverData = mockReceivers.find(r => r.id === selectedReceiver);

  const handleSave = () => {
    toast.success("Configuration Saved", {
      description: `Settings saved for ${selectedReceiverData?.name}`,
    });
  };

  const handleDiscard = () => {
    toast.info("Changes Discarded", {
      description: "Configuration reset to last saved state",
    });
  };

  const riskModes = [
    { mode: 'balance_multiplier' as RiskMode, label: 'Balance Multiplier', description: 'Scale lots based on account balance ratio' },
    { mode: 'fixed_lot' as RiskMode, label: 'Fixed Lot', description: 'Use a fixed lot size for all trades' },
    { mode: 'risk_percent' as RiskMode, label: 'Risk Percent', description: 'Risk a percentage of account balance' },
    { mode: 'risk_dollar' as RiskMode, label: 'Risk Dollar', description: 'Risk a fixed dollar amount per trade' },
  ];

  return (
    <div className="flex h-full">
      {/* Receiver Selector - Left Panel */}
      <div className="w-64 border-r border-border bg-card/50 flex flex-col">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Receivers</h2>
          <p className="text-xs text-muted-foreground mt-1">Select an account to configure</p>
        </div>
        
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {mockReceivers.map((receiver) => (
              <button
                key={receiver.id}
                onClick={() => setSelectedReceiver(receiver.id)}
                className={`w-full p-3 rounded-lg text-left transition-colors ${
                  selectedReceiver === receiver.id
                    ? "bg-primary/10 border border-primary/30"
                    : "hover:bg-secondary/50 border border-transparent"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm text-foreground">{receiver.name}</span>
                  <div className={`w-2 h-2 rounded-full ${receiver.isOnline ? "bg-green-500" : "bg-muted-foreground"}`} />
                </div>
                <div className="text-xs text-muted-foreground">{receiver.broker}</div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-muted-foreground">#{receiver.account}</span>
                  {receiver.useGlobal ? (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">Global</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Custom</Badge>
                  )}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>

        <div className="p-3 border-t border-border">
          <Button variant="outline" size="sm" className="w-full">
            <Settings2 className="w-4 h-4 mr-2" />
            Global Defaults
          </Button>
        </div>
      </div>

      {/* Configuration Panel - Right Panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedReceiverData ? (
          <>
            {/* Header */}
            <div className="p-4 border-b border-border bg-card/30">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-lg font-semibold text-foreground">
                    {selectedReceiverData.name}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    {selectedReceiverData.broker} • #{selectedReceiverData.account} • 
                    ${selectedReceiverData.balance.toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleDiscard}>
                    Discard
                  </Button>
                  <Button size="sm" onClick={handleSave}>
                    Save Changes
                  </Button>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 pt-2 border-b border-border">
                <TabsList className="bg-transparent p-0 h-auto gap-4">
                  <TabsTrigger 
                    value="risk" 
                    className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-1 pb-2"
                  >
                    <BarChart3 className="w-4 h-4 mr-2" />
                    Risk
                  </TabsTrigger>
                  <TabsTrigger 
                    value="symbols"
                    className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-1 pb-2"
                  >
                    <Link2 className="w-4 h-4 mr-2" />
                    Symbols
                  </TabsTrigger>
                  <TabsTrigger 
                    value="safety"
                    className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-1 pb-2"
                  >
                    <Shield className="w-4 h-4 mr-2" />
                    Safety
                  </TabsTrigger>
                  <TabsTrigger 
                    value="sessions"
                    className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-1 pb-2"
                  >
                    <Clock className="w-4 h-4 mr-2" />
                    Sessions
                  </TabsTrigger>
                </TabsList>
              </div>

              <ScrollArea className="flex-1 p-4">
                {/* Risk Tab */}
                <TabsContent value="risk" className="mt-0 space-y-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Risk Mode</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {riskModes.map((rm) => (
                        <button
                          key={rm.mode}
                          onClick={() => setRiskConfig({ ...riskConfig, mode: rm.mode })}
                          className={`w-full p-3 rounded-lg border text-left transition-colors ${
                            riskConfig.mode === rm.mode
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-medium text-sm">{rm.label}</div>
                              <div className="text-xs text-muted-foreground">{rm.description}</div>
                            </div>
                            {riskConfig.mode === rm.mode && (
                              <Check className="w-4 h-4 text-primary" />
                            )}
                          </div>
                        </button>
                      ))}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Risk Value</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div className="flex items-center gap-4">
                          <Input
                            type="number"
                            value={riskConfig.value}
                            onChange={(e) => setRiskConfig({ ...riskConfig, value: parseFloat(e.target.value) || 0 })}
                            className="w-32"
                            step={riskConfig.mode === 'fixed_lot' ? 0.01 : 0.1}
                          />
                          <span className="text-sm text-muted-foreground">
                            {riskConfig.mode === 'balance_multiplier' && 'x balance ratio'}
                            {riskConfig.mode === 'fixed_lot' && 'lots per trade'}
                            {riskConfig.mode === 'risk_percent' && '% of balance'}
                            {riskConfig.mode === 'risk_dollar' && 'USD per trade'}
                          </span>
                        </div>
                        <Slider
                          value={[riskConfig.value]}
                          onValueChange={([v]) => setRiskConfig({ ...riskConfig, value: v })}
                          min={0}
                          max={riskConfig.mode === 'fixed_lot' ? 10 : riskConfig.mode === 'risk_percent' ? 5 : 100}
                          step={riskConfig.mode === 'fixed_lot' ? 0.01 : 0.1}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Symbols Tab */}
                <TabsContent value="symbols" className="mt-0 space-y-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">Symbol Mappings</CardTitle>
                        <Button variant="outline" size="sm">Auto-Map</Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {symbolMappings.slice(0, 6).map((mapping, idx) => (
                          <div key={idx} className="flex items-center gap-3 p-2 rounded-lg bg-secondary/30">
                            <Switch
                              checked={mapping.enabled}
                              onCheckedChange={(checked) => {
                                const updated = [...symbolMappings];
                                updated[idx].enabled = checked;
                                setSymbolMappings(updated);
                              }}
                            />
                            <Input
                              value={mapping.masterSymbol}
                              className="flex-1 h-8 text-sm"
                              readOnly
                            />
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                            <Input
                              value={mapping.receiverSymbol}
                              onChange={(e) => {
                                const updated = [...symbolMappings];
                                updated[idx].receiverSymbol = e.target.value;
                                setSymbolMappings(updated);
                              }}
                              className="flex-1 h-8 text-sm"
                            />
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-3">
                        + {symbolMappings.length - 6} more symbols configured
                      </p>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Safety Tab */}
                <TabsContent value="safety" className="mt-0 space-y-4">
                  <Card className="border-yellow-500/30 bg-yellow-500/5">
                    <CardContent className="pt-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5" />
                        <div>
                          <div className="font-medium text-sm">Prop Firm Safe Mode</div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Enables conservative settings designed for prop firm challenges. 
                            Includes max 3% daily loss, manual confirmation for large trades, and slippage protection.
                          </p>
                          <div className="mt-3">
                            <Switch
                              checked={safetyConfig.propFirmSafeMode}
                              onCheckedChange={(checked) => 
                                setSafetyConfig({ ...safetyConfig, propFirmSafeMode: checked })
                              }
                            />
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Risk Limits</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label className="text-sm">Max Slippage (pips)</Label>
                        <Input
                          type="number"
                          value={safetyConfig.maxSlippagePips}
                          onChange={(e) => 
                            setSafetyConfig({ ...safetyConfig, maxSlippagePips: parseFloat(e.target.value) || 0 })
                          }
                          className="w-32"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm">Max Daily Loss (R)</Label>
                        <Input
                          type="number"
                          value={safetyConfig.maxDailyLossR}
                          onChange={(e) => 
                            setSafetyConfig({ ...safetyConfig, maxDailyLossR: parseFloat(e.target.value) || 0 })
                          }
                          className="w-32"
                        />
                      </div>
                      <div className="flex items-center justify-between pt-2">
                        <div>
                          <Label className="text-sm">Manual Confirmation Mode</Label>
                          <p className="text-xs text-muted-foreground">Require approval before executing trades</p>
                        </div>
                        <Switch
                          checked={safetyConfig.manualConfirmMode}
                          onCheckedChange={(checked) => 
                            setSafetyConfig({ ...safetyConfig, manualConfirmMode: checked })
                          }
                        />
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Sessions Tab */}
                <TabsContent value="sessions" className="mt-0 space-y-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Trading Sessions</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Select which sessions to allow trade copying. Trades outside selected sessions will be ignored.
                      </p>
                      
                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                          <div>
                            <div className="font-medium text-sm">Asian Session</div>
                            <div className="text-xs text-muted-foreground">00:00 - 09:00 UTC</div>
                          </div>
                          <Switch
                            checked={sessionFilter.asian}
                            onCheckedChange={(checked) => 
                              setSessionFilter({ ...sessionFilter, asian: checked })
                            }
                          />
                        </div>
                        
                        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                          <div>
                            <div className="font-medium text-sm">London Session</div>
                            <div className="text-xs text-muted-foreground">07:00 - 16:00 UTC</div>
                          </div>
                          <Switch
                            checked={sessionFilter.london}
                            onCheckedChange={(checked) => 
                              setSessionFilter({ ...sessionFilter, london: checked })
                            }
                          />
                        </div>
                        
                        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                          <div>
                            <div className="font-medium text-sm">New York Session</div>
                            <div className="text-xs text-muted-foreground">12:00 - 21:00 UTC</div>
                          </div>
                          <Switch
                            checked={sessionFilter.newYork}
                            onCheckedChange={(checked) => 
                              setSessionFilter({ ...sessionFilter, newYork: checked })
                            }
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </ScrollArea>
            </Tabs>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Settings2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Select a receiver to configure</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
