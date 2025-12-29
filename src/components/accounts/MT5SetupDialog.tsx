import { Copy, ExternalLink, CheckCircle2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Account } from '@/types/trading';

interface MT5SetupDialogProps {
  account: Account | null;
  onOpenChange: (open: boolean) => void;
}

const CLOUD_URL = 'https://soosdjmnpcyuqppdjsse.supabase.co';

export function MT5SetupDialog({ account, onOpenChange }: MT5SetupDialogProps) {
  const { toast } = useToast();

  if (!account) return null;

  const copyToClipboard = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast({ title: `${label} copied to clipboard` });
  };

  return (
    <Dialog open={!!account} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>MT5 Setup Instructions</DialogTitle>
          <DialogDescription>
            Connect MetaTrader 5 directly to your Trade Journal — no relay server needed!
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Step 1 */}
          <div className="space-y-2">
            <h3 className="font-semibold flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">1</span>
              Install the Expert Advisor
            </h3>
            <div className="pl-8 space-y-2 text-sm text-muted-foreground">
              <p>Download and copy <code className="bg-muted px-1 rounded">TradeJournalBridge.mq5</code> to:</p>
              <code className="block bg-muted p-2 rounded text-xs">
                %APPDATA%\MetaQuotes\Terminal\[YOUR_TERMINAL]\MQL5\Experts\
              </code>
              <p>Then compile it in MetaEditor (press F7).</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open('/TradeJournalBridge.mq5', '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Download EA File
              </Button>
            </div>
          </div>

          {/* Step 2 */}
          <div className="space-y-2">
            <h3 className="font-semibold flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">2</span>
              Enable WebRequest in MT5
            </h3>
            <div className="pl-8 space-y-2 text-sm text-muted-foreground">
              <p>Go to <strong>Tools → Options → Expert Advisors</strong></p>
              <ul className="list-disc list-inside space-y-1">
                <li>Enable "Allow WebRequest for listed URL"</li>
                <li>Add this URL:</li>
              </ul>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted p-2 rounded text-xs">{CLOUD_URL}</code>
                <Button variant="ghost" size="icon" onClick={() => copyToClipboard(CLOUD_URL, 'Cloud URL')}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="space-y-2">
            <h3 className="font-semibold flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">3</span>
              Attach the EA to a Chart
            </h3>
            <div className="pl-8 space-y-2 text-sm text-muted-foreground">
              <p>Drag the <strong>TradeJournalBridge</strong> EA onto any chart and enter your API Key:</p>
              
              <div className="bg-muted rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">API Key</span>
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-background px-2 py-1 rounded max-w-[250px] truncate">
                      {account.api_key || 'Not generated'}
                    </code>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-7 w-7" 
                      onClick={() => account.api_key && copyToClipboard(account.api_key, 'API Key')}
                      disabled={!account.api_key}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-medium">Broker UTC Offset</span>
                  <span className="text-xs text-muted-foreground">
                    Check your broker's server time (usually UTC+2 or UTC+3)
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Step 4 */}
          <div className="space-y-2">
            <h3 className="font-semibold flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">4</span>
              Verify Connection
            </h3>
            <div className="pl-8 space-y-2 text-sm text-muted-foreground">
              <p>Check the MT5 <strong>Experts</strong> tab for these logs:</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>"Trade Journal Bridge v2.10 - Direct Cloud Connection"</li>
                <li>"Scanning currently open positions..." (syncs existing trades)</li>
              </ul>
              <p>Any existing open positions will be synced automatically on startup!</p>
            </div>
          </div>

          {/* Important Notes */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <h4 className="font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              What gets synced
            </h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>✓ All currently open positions (on EA startup)</li>
              <li>✓ Historical trades from the last 30 days (first run only)</li>
              <li>✓ New trades as they happen (entries, exits, partials)</li>
            </ul>
            <p className="text-xs text-muted-foreground mt-2">
              <strong>Note:</strong> Pending orders won't appear until executed. 
              Netting accounts show one position per symbol.
            </p>
          </div>

          <div className="flex justify-between items-center pt-4 border-t">
            <Button variant="link" className="px-0" asChild>
              <a href="/mt5-bridge/INSTALL.md" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                View Full Documentation
              </a>
            </Button>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
