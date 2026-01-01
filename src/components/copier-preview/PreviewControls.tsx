import { useState } from "react";
import { 
  ChevronDown, 
  ChevronUp, 
  Wifi, 
  WifiOff, 
  Play, 
  Square, 
  AlertTriangle,
  RefreshCw,
  Plus,
  ArrowLeft
} from "lucide-react";
import { PreviewState } from "@/types/copier-preview";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Link } from "react-router-dom";

interface PreviewControlsProps {
  state: PreviewState;
  onStateChange: (state: PreviewState) => void;
  onSimulateTrade: () => void;
  onReset: () => void;
}

export function PreviewControls({
  state,
  onStateChange,
  onSimulateTrade,
  onReset,
}: PreviewControlsProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="bg-card border border-border rounded-xl shadow-lg overflow-hidden w-72">
        {/* Header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between p-3 bg-muted/50 hover:bg-muted transition-colors"
        >
          <span className="text-sm font-medium">Preview Controls</span>
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          )}
        </button>

        {/* Content */}
        {isExpanded && (
          <div className="p-4 space-y-4">
            {/* Connection Toggle */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {state.isConnected ? (
                  <Wifi className="w-4 h-4 text-green-500" />
                ) : (
                  <WifiOff className="w-4 h-4 text-red-500" />
                )}
                <span className="text-sm">Connected</span>
              </div>
              <Switch
                checked={state.isConnected}
                onCheckedChange={(checked) =>
                  onStateChange({ ...state, isConnected: checked })
                }
              />
            </div>

            {/* Running Toggle */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {state.isRunning ? (
                  <Play className="w-4 h-4 text-green-500" />
                ) : (
                  <Square className="w-4 h-4 text-muted-foreground" />
                )}
                <span className="text-sm">Running</span>
              </div>
              <Switch
                checked={state.isRunning}
                onCheckedChange={(checked) =>
                  onStateChange({ ...state, isRunning: checked })
                }
                disabled={!state.isConnected}
              />
            </div>

            {/* Error Toggle */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className={`w-4 h-4 ${state.showError ? 'text-red-500' : 'text-muted-foreground'}`} />
                <span className="text-sm">Show Error</span>
              </div>
              <Switch
                checked={state.showError}
                onCheckedChange={(checked) =>
                  onStateChange({ ...state, showError: checked })
                }
              />
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                onClick={onSimulateTrade}
                className="text-xs"
              >
                <Plus className="w-3 h-3 mr-1" />
                Add Trade
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onReset}
                className="text-xs"
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Reset
              </Button>
            </div>

            {/* Back to Copier */}
            <Link to="/copier">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
              >
                <ArrowLeft className="w-3 h-3 mr-1" />
                Back to Web Copier
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
