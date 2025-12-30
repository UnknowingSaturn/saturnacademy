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
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays, subMonths } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuickConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SyncPreset = '1week' | '2weeks' | '30days' | 'custom';

export function QuickConnectDialog({ open, onOpenChange }: QuickConnectDialogProps) {
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [syncPreset, setSyncPreset] = useState<SyncPreset>('30days');
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const { toast } = useToast();

  // Calculate sync_history_from based on preset
  const getSyncFromDate = (): Date | null => {
    if (!syncEnabled) return null;
    
    const now = new Date();
    switch (syncPreset) {
      case '1week':
        return subDays(now, 7);
      case '2weeks':
        return subDays(now, 14);
      case '30days':
        return subDays(now, 30);
      case 'custom':
        return customDate || subDays(now, 30);
      default:
        return subDays(now, 30);
    }
  };

  // Generate setup token when dialog opens
  useEffect(() => {
    if (open && !setupToken) {
      generateSetupToken();
    }
  }, [open, syncEnabled, syncPreset, customDate]);

  // Regenerate token when sync settings change (if token already exists)
  const regenerateTokenWithSettings = async () => {
    if (!setupToken) return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Delete old token
      await supabase
        .from('setup_tokens')
        .delete()
        .eq('token', setupToken);

      // Generate new one with updated settings
      await generateSetupToken();
    } catch (error) {
      console.error('Failed to update token:', error);
    }
  };

  // Update token when sync settings change
  useEffect(() => {
    if (setupToken) {
      regenerateTokenWithSettings();
    }
  }, [syncEnabled, syncPreset, customDate]);

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

      const syncFromDate = getSyncFromDate();

      const { error } = await supabase
        .from('setup_tokens')
        .insert({
          user_id: user.id,
          token,
          expires_at: expiresAt.toISOString(),
          sync_history_enabled: syncEnabled,
          sync_history_from: syncFromDate?.toISOString() || null,
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
    // Create a download link for the EA file
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
    // Reset state when closing
    setSetupToken(null);
    setCopied(false);
    setSyncEnabled(true);
    setSyncPreset('30days');
    setCustomDate(undefined);
  };

  // Get max date (30 days ago - EA limitation)
  const minDate = subDays(new Date(), 30);

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

          {/* Step 4: Historical Trade Import Settings */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                4
              </div>
              <h3 className="font-medium">Historical Trade Import</h3>
            </div>
            <div className="ml-8 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-muted-foreground" />
                  <Label htmlFor="sync-enabled" className="text-sm">Import past trades</Label>
                </div>
                <Switch
                  id="sync-enabled"
                  checked={syncEnabled}
                  onCheckedChange={setSyncEnabled}
                />
              </div>
              
              {syncEnabled && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {(['1week', '2weeks', '30days'] as const).map((preset) => (
                      <Button
                        key={preset}
                        variant={syncPreset === preset ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setSyncPreset(preset)}
                      >
                        {preset === '1week' && '1 Week'}
                        {preset === '2weeks' && '2 Weeks'}
                        {preset === '30days' && '30 Days'}
                      </Button>
                    ))}
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant={syncPreset === 'custom' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setSyncPreset('custom')}
                          className={cn(syncPreset === 'custom' && customDate && 'gap-1')}
                        >
                          <CalendarIcon className="h-3.5 w-3.5" />
                          {syncPreset === 'custom' && customDate 
                            ? format(customDate, 'MMM d') 
                            : 'Custom'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={customDate}
                          onSelect={(date) => {
                            setCustomDate(date);
                            setSyncPreset('custom');
                          }}
                          disabled={(date) => date < minDate || date > new Date()}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Maximum: 30 days (EA limitation). For older trades, use CSV import.
                  </p>
                </div>
              )}
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
          <div className="ml-8 p-3 bg-muted/50 rounded-lg border">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">That's it!</strong> Your account will appear automatically 
              after your first trade. The EA is read-only and prop-firm compliant.
            </p>
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
}
