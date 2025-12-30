import * as React from 'react';
import { useState, useEffect } from 'react';
import { Copy, Check, Download, ExternalLink, Loader2, History } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface QuickConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type HistoryPreset = '1week' | '1month' | '3months';

const HISTORY_PRESETS: { value: HistoryPreset; label: string }[] = [
  { value: '1week', label: '1 Week' },
  { value: '1month', label: '1 Month' },
  { value: '3months', label: '3 Months' },
];

function getSyncFromDate(preset: HistoryPreset): Date {
  const now = new Date();
  switch (preset) {
    case '1week':
      return new Date(now.setDate(now.getDate() - 7));
    case '1month':
      return new Date(now.setMonth(now.getMonth() - 1));
    case '3months':
      return new Date(now.setMonth(now.getMonth() - 3));
  }
}

export const QuickConnectDialog = React.forwardRef<HTMLDivElement, QuickConnectDialogProps>(
  function QuickConnectDialog({ open, onOpenChange }, _ref) {
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [importHistory, setImportHistory] = useState(true);
  const [historyPreset, setHistoryPreset] = useState<HistoryPreset>('1month');
  const { toast } = useToast();

  // Generate setup token when dialog opens
  useEffect(() => {
    if (open && !setupToken) {
      generateSetupToken();
    }
  }, [open, importHistory, historyPreset]);

  // Regenerate token when history settings change (only if we already have a token)
  useEffect(() => {
    if (open && setupToken) {
      generateSetupToken();
    }
  }, [importHistory, historyPreset]);

  const generateSetupToken = async () => {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({ title: 'Not authenticated', variant: 'destructive' });
        return;
      }

      // Generate a unique token
      const token = crypto.randomUUID();
      
      // Set expiration to 24 hours from now
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      // Calculate sync from date based on preset
      const syncFrom = importHistory ? getSyncFromDate(historyPreset) : null;

      const { error } = await supabase
        .from('setup_tokens')
        .insert({
          user_id: user.id,
          token,
          expires_at: expiresAt.toISOString(),
          sync_history_enabled: importHistory,
          sync_history_from: syncFrom?.toISOString() ?? null,
        });

      if (error) throw error;
      
      setSetupToken(token);
    } catch (error) {
      console.error('Failed to generate setup token:', error);
      toast({ 
        title: 'Failed to generate setup token', 
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive' 
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async () => {
    if (!setupToken) return;
    
    try {
      await navigator.clipboard.writeText(setupToken);
      setCopied(true);
      toast({ title: 'API Key copied to clipboard' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: 'Failed to copy', variant: 'destructive' });
    }
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = '/TradeJournalBridge.mq5';
    link.download = 'TradeJournalBridge.mq5';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: 'EA file download started' });
  };

  const handleClose = () => {
    onOpenChange(false);
    setSetupToken(null);
    setCopied(false);
    setImportHistory(true);
    setHistoryPreset('1month');
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Connect MT5 Terminal</DialogTitle>
          <DialogDescription>
            Follow these steps to connect your MT5 account. Your account will be created automatically after your first trade.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Step 1: Download EA */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                1
              </div>
              <h3 className="font-medium">Download the Expert Advisor</h3>
            </div>
            <div className="ml-8">
              <Button variant="outline" onClick={handleDownload} className="w-full justify-start">
                <Download className="h-4 w-4 mr-2" />
                Download TradeJournalBridge.mq5
              </Button>
            </div>
          </div>

          {/* Step 2: Install in MT5 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                2
              </div>
              <h3 className="font-medium">Install in MetaTrader 5</h3>
            </div>
            <div className="ml-8 text-sm text-muted-foreground space-y-1">
              <p>1. Open MT5 and go to <strong>File → Open Data Folder</strong></p>
              <p>2. Navigate to <strong>MQL5 → Experts</strong></p>
              <p>3. Copy the downloaded file here</p>
              <p>4. Restart MT5 or right-click Navigator → Refresh</p>
            </div>
          </div>

          {/* Step 3: Enable WebRequest */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                3
              </div>
              <h3 className="font-medium">Enable WebRequest</h3>
            </div>
            <div className="ml-8 text-sm text-muted-foreground space-y-1">
              <p>1. Go to <strong>Tools → Options → Expert Advisors</strong></p>
              <p>2. Check <strong>"Allow WebRequest for listed URL"</strong></p>
              <p>3. Click <strong>Add</strong> and enter:</p>
              <code className="block bg-muted px-2 py-1 rounded text-xs mt-1">
                {import.meta.env.VITE_SUPABASE_URL}
              </code>
            </div>
          </div>

          {/* Step 4: History Import Settings */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                4
              </div>
              <h3 className="font-medium">Import Historical Trades</h3>
            </div>
            <div className="ml-8 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-muted-foreground" />
                  <Label htmlFor="import-history" className="text-sm">
                    Import past trades when connecting
                  </Label>
                </div>
                <Switch
                  id="import-history"
                  checked={importHistory}
                  onCheckedChange={setImportHistory}
                />
              </div>
              
              {importHistory && (
                <div className="flex gap-2">
                  {HISTORY_PRESETS.map((preset) => (
                    <Button
                      key={preset.value}
                      type="button"
                      variant={historyPreset === preset.value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setHistoryPreset(preset.value)}
                      className="flex-1"
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              )}
              
              <p className="text-xs text-muted-foreground">
                {importHistory 
                  ? `Trades from the past ${historyPreset === '1week' ? 'week' : historyPreset === '1month' ? 'month' : '3 months'} will be imported automatically.`
                  : 'Only new trades will be tracked. You can import history later from account settings.'}
              </p>
            </div>
          </div>

          {/* Step 5: Attach EA */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                5
              </div>
              <h3 className="font-medium">Attach EA to any chart</h3>
            </div>
            <div className="ml-8 space-y-2">
              <p className="text-sm text-muted-foreground">
                Drag the EA onto any chart and enter this API Key:
              </p>
              
              {isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Generating API Key...</span>
                </div>
              ) : setupToken ? (
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono truncate">
                    {setupToken}
                  </code>
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={copyToClipboard}
                    className="shrink-0"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ) : (
                <Button variant="outline" onClick={generateSetupToken}>
                  Generate API Key
                </Button>
              )}
            </div>
          </div>

          {/* Info box */}
          <div className="ml-8">
            <div className="p-3 bg-muted/50 rounded-lg border">
              <p className="text-sm text-muted-foreground">
                <strong className="text-foreground">That's it!</strong> Your account will appear automatically 
                after your first trade. The EA is read-only and prop-firm compliant.
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center pt-2 border-t">
          <Button variant="link" size="sm" className="text-muted-foreground px-0" asChild>
            <a 
              href="https://docs.lovable.dev" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Need help?
            </a>
          </Button>
          <Button onClick={handleClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});
