import { useState } from "react";
import { Trade, Playbook } from "@/types/trading";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { useUpdateTrade } from "@/hooks/useTrades";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, BookOpen, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModelSelectionPromptProps {
  trade: Trade;
  onModelSelected: (playbook: Playbook) => void;
}

export function ModelSelectionPrompt({ trade, onModelSelected }: ModelSelectionPromptProps) {
  const { data: playbooks = [] } = usePlaybooks();
  const updateTrade = useUpdateTrade();
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  const selectedPlaybook = playbooks.find(p => p.id === selectedPlaybookId);

  const handleConfirm = async () => {
    if (!selectedPlaybook) return;
    
    setIsLoading(true);
    try {
      await updateTrade.mutateAsync({
        id: trade.id,
        model: selectedPlaybook.name,
      });
      onModelSelected(selectedPlaybook);
    } finally {
      setIsLoading(false);
    }
  };

  // Find playbooks that match the trade's session/symbol
  const suggestedPlaybooks = playbooks.filter(p => {
    let matches = true;
    if (p.session_filter && p.session_filter.length > 0 && trade.session) {
      matches = matches && p.session_filter.includes(trade.session);
    }
    if (p.symbol_filter && p.symbol_filter.length > 0) {
      const normalizedSymbol = trade.symbol.replace(/[^A-Za-z]/g, '').toUpperCase();
      const symbolMatch = p.symbol_filter.some(s => 
        normalizedSymbol.includes(s.replace(/[^A-Za-z]/g, '').toUpperCase())
      );
      matches = matches && symbolMatch;
    }
    return matches;
  });

  return (
    <Card className="border-warning/50 bg-warning/5">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 text-warning">
          <AlertCircle className="h-5 w-5" />
          <CardTitle className="text-base">Select a Model</CardTitle>
        </div>
        <CardDescription>
          Choose the playbook/model for this trade to see compliance rules and checklist
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Suggested Playbooks */}
        {suggestedPlaybooks.length > 0 && (
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">
              Suggested for {trade.symbol} • {formatSession(trade.session)}
            </Label>
            <div className="grid gap-2">
              {suggestedPlaybooks.map((playbook) => (
                <button
                  key={playbook.id}
                  onClick={() => setSelectedPlaybookId(playbook.id)}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border text-left transition-all",
                    selectedPlaybookId === playbook.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50 hover:bg-muted/50"
                  )}
                >
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: playbook.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{playbook.name}</div>
                    {playbook.description && (
                      <div className="text-xs text-muted-foreground truncate">
                        {playbook.description}
                      </div>
                    )}
                  </div>
                  {selectedPlaybookId === playbook.id && (
                    <Check className="h-4 w-4 text-primary shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* All Playbooks Dropdown */}
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">
            Or select from all playbooks
          </Label>
          <Select value={selectedPlaybookId} onValueChange={setSelectedPlaybookId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a playbook..." />
            </SelectTrigger>
            <SelectContent>
              {playbooks.map((playbook) => (
                <SelectItem key={playbook.id} value={playbook.id}>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: playbook.color }}
                    />
                    {playbook.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Selected Playbook Preview */}
        {selectedPlaybook && (
          <div className="p-3 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">{selectedPlaybook.name}</span>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              {selectedPlaybook.confirmation_rules.length > 0 && (
                <div>• {selectedPlaybook.confirmation_rules.length} confirmation rules</div>
              )}
              {selectedPlaybook.invalidation_rules.length > 0 && (
                <div>• {selectedPlaybook.invalidation_rules.length} invalidation rules</div>
              )}
              {selectedPlaybook.checklist_questions.length > 0 && (
                <div>• {selectedPlaybook.checklist_questions.length} checklist questions</div>
              )}
              {selectedPlaybook.management_rules.length > 0 && (
                <div>• {selectedPlaybook.management_rules.length} management rules</div>
              )}
            </div>
          </div>
        )}

        <Button 
          onClick={handleConfirm} 
          disabled={!selectedPlaybook || isLoading}
          className="w-full"
        >
          {isLoading ? "Saving..." : "Continue with Compliance Check"}
        </Button>
      </CardContent>
    </Card>
  );
}

function formatSession(session: string | null): string {
  if (!session) return 'Unknown Session';
  const map: Record<string, string> = {
    'tokyo': 'Tokyo',
    'london': 'London',
    'new_york_am': 'NY AM',
    'new_york_pm': 'NY PM',
    'off_hours': 'Off Hours',
  };
  return map[session] || session;
}
