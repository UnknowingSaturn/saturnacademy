import { Copy, ExternalLink } from 'lucide-react';
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

export function MT5SetupDialog({ account, onOpenChange }: MT5SetupDialogProps) {
  const { toast } = useToast();

  if (!account) return null;

  const copyToClipboard = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast({ title: `${label} copied to clipboard` });
  };

  const relayServerUrl = 'http://127.0.0.1:8080';
  const terminalId = account.terminal_id || account.id.slice(0, 8);

  return (
    <Dialog open={!!account} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>MT5 Setup Instructions</DialogTitle>
          <DialogDescription>
            Follow these steps to connect MetaTrader 5 to your Trade Journal
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
              <p>Copy <code className="bg-muted px-1 rounded">TradeJournalBridge.mq5</code> from the <code className="bg-muted px-1 rounded">mt5-bridge</code> folder to:</p>
              <code className="block bg-muted p-2 rounded text-xs">
                %APPDATA%\MetaQuotes\Terminal\[YOUR_TERMINAL]\MQL5\Experts\
              </code>
              <p>Then compile it in MetaEditor (press F7).</p>
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
                <li>Add: <code className="bg-muted px-1 rounded">http://127.0.0.1</code></li>
              </ul>
            </div>
          </div>

          {/* Step 3 */}
          <div className="space-y-2">
            <h3 className="font-semibold flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">3</span>
              Start the Relay Server
            </h3>
            <div className="pl-8 space-y-2 text-sm text-muted-foreground">
              <p>Open a terminal in the <code className="bg-muted px-1 rounded">mt5-bridge</code> folder and run:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted p-2 rounded text-xs">cd mt5-bridge && npm install && npm start</code>
                <Button variant="ghost" size="icon" onClick={() => copyToClipboard('cd mt5-bridge && npm install && npm start', 'Command')}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs">The server will listen on port 8080 and forward events to the journal.</p>
            </div>
          </div>

          {/* Step 4 */}
          <div className="space-y-2">
            <h3 className="font-semibold flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">4</span>
              Attach the EA to a Chart
            </h3>
            <div className="pl-8 space-y-2 text-sm text-muted-foreground">
              <p>Drag the <strong>TradeJournalBridge</strong> EA onto any chart and configure these parameters:</p>
              
              <div className="bg-muted rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Terminal ID</span>
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-background px-2 py-1 rounded">{terminalId}</code>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyToClipboard(terminalId, 'Terminal ID')}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-medium">API Key</span>
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-background px-2 py-1 rounded max-w-[200px] truncate">
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
                  <span className="font-medium">Server URL</span>
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-background px-2 py-1 rounded">{relayServerUrl}</code>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyToClipboard(relayServerUrl, 'Server URL')}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Step 5 */}
          <div className="space-y-2">
            <h3 className="font-semibold flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">5</span>
              Verify Connection
            </h3>
            <div className="pl-8 space-y-2 text-sm text-muted-foreground">
              <p>Once attached, the EA will log connection status in the Experts tab. Open or close a trade to verify events are being recorded in your journal.</p>
            </div>
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
