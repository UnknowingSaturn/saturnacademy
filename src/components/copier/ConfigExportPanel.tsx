import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  AlertCircle, 
  Download, 
  Copy, 
  Check, 
  RefreshCw,
  FileJson,
  Clock,
  Hash,
  ExternalLink,
  FileCode
} from 'lucide-react';
import { toast } from 'sonner';
import { 
  useSymbolMappings, 
  useReceiverSettings,
  useConfigVersions,
  useCreateConfigVersion 
} from '@/hooks/useCopier';
import { generateCopierConfig, downloadConfigFile } from '@/lib/copierConfigGenerator';
import type { Account } from '@/types/trading';
import type { CopierConfigFile } from '@/types/copier';

interface ConfigExportPanelProps {
  masterAccount?: Account;
  receiverAccounts: Account[];
}

export function ConfigExportPanel({ masterAccount, receiverAccounts }: ConfigExportPanelProps) {
  const [config, setConfig] = React.useState<CopierConfigFile | null>(null);
  const [copied, setCopied] = React.useState(false);
  
  const { data: mappings } = useSymbolMappings(masterAccount?.id);
  const { data: settings } = useReceiverSettings();
  const { data: versions } = useConfigVersions();
  const createVersion = useCreateConfigVersion();
  
  const latestVersion = versions?.[0];
  
  const handleGenerate = () => {
    if (!masterAccount) return;
    
    const newVersion = (latestVersion?.version || 0) + 1;
    const generatedConfig = generateCopierConfig(
      masterAccount,
      receiverAccounts,
      mappings || [],
      settings || [],
      newVersion
    );
    
    setConfig(generatedConfig);
  };
  
  const handleDownload = () => {
    if (!config) return;
    
    // Save version to database
    createVersion.mutate({ configHash: config.config_hash });
    
    // Download file
    downloadConfigFile(config);
    toast.success('Config file downloaded');
  };
  
  const handleCopy = async () => {
    if (!config) return;
    
    await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    setCopied(true);
    toast.success('Copied to clipboard');
    
    setTimeout(() => setCopied(false), 2000);
  };
  
  if (!masterAccount) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>Set a master account first</p>
        <p className="text-sm">Go to the Accounts tab and assign a master account</p>
      </div>
    );
  }
  
  if (receiverAccounts.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No receiver accounts</p>
        <p className="text-sm">Add receiver accounts before exporting config</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard 
          label="Master" 
          value={masterAccount.name} 
          icon={<Badge className="bg-primary/20 text-primary">1</Badge>}
        />
        <SummaryCard 
          label="Receivers" 
          value={receiverAccounts.length.toString()} 
          icon={<Badge variant="secondary">{receiverAccounts.length}</Badge>}
        />
        <SummaryCard 
          label="Mappings" 
          value={(mappings?.length || 0).toString()}
          icon={<Badge variant="outline">{mappings?.length || 0}</Badge>}
        />
        <SummaryCard 
          label="Version" 
          value={latestVersion ? `v${latestVersion.version}` : 'New'}
          icon={<Hash className="h-4 w-4 text-muted-foreground" />}
        />
      </div>
      
      {/* Generate Button */}
      <div className="flex justify-center">
        <Button onClick={handleGenerate} size="lg" className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Generate Config
        </Button>
      </div>
      
      {/* Config Preview */}
      {config && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileJson className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">copier-config-v{config.version}.json</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              {new Date(config.generated_at).toLocaleString()}
            </div>
          </div>
          
          <Card className="bg-muted/50">
            <ScrollArea className="h-[300px]">
              <pre className="p-4 text-sm font-mono whitespace-pre-wrap">
                {JSON.stringify(config, null, 2)}
              </pre>
            </ScrollArea>
          </Card>
          
          <div className="flex gap-2">
            <Button onClick={handleDownload} className="flex-1 gap-2">
              <Download className="h-4 w-4" />
              Download
            </Button>
            <Button variant="outline" onClick={handleCopy} className="gap-2">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      )}
      
      {/* EA Downloads */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h4 className="font-medium flex items-center gap-2">
            <FileCode className="h-4 w-4" />
            Download Expert Advisors
          </h4>
          <p className="text-sm text-muted-foreground">
            Each EA includes built-in cloud journaling. No need for TradeJournalBridge on copier accounts.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <a 
              href="/TradeCopierMaster.mq5" 
              download
              className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg hover:bg-primary/10 transition-colors group"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm">TradeCopierMaster.mq5</p>
                  <span className="text-xs bg-primary/20 text-primary px-1.5 rounded">Master</span>
                </div>
                <p className="text-xs text-muted-foreground">Journals + writes copier queue</p>
              </div>
              <Download className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
            </a>
            <a 
              href="/TradeCopierReceiver.mq5" 
              download
              className="flex items-center justify-between p-3 bg-green-500/5 border border-green-500/20 rounded-lg hover:bg-green-500/10 transition-colors group"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm">TradeCopierReceiver.mq5</p>
                  <span className="text-xs bg-green-500/20 text-green-600 dark:text-green-400 px-1.5 rounded">Receiver</span>
                </div>
                <p className="text-xs text-muted-foreground">Executes trades + journals</p>
              </div>
              <Download className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
            </a>
            <a 
              href="/TradeJournalBridge.mq5" 
              download
              className="flex items-center justify-between p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors group"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm">TradeJournalBridge.mq5</p>
                  <span className="text-xs bg-muted text-muted-foreground px-1.5 rounded">Independent</span>
                </div>
                <p className="text-xs text-muted-foreground">Journal only (no copying)</p>
              </div>
              <Download className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
            </a>
          </div>
        </CardContent>
      </Card>
      
      {/* Setup Instructions */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <h4 className="font-medium">Setup Instructions</h4>
          <ol className="list-decimal list-inside space-y-3 text-sm text-muted-foreground">
            <li>
              <span className="text-foreground font-medium">Download EAs above</span> and place in your MT5's{' '}
              <code className="bg-muted px-1 rounded">MQL5/Experts/</code> folder
            </li>
            <li>
              <span className="text-foreground font-medium">Generate and download config</span> above, then place in{' '}
              <code className="bg-muted px-1 rounded">MQL5/Files/</code> folder on <strong>both</strong> terminals
            </li>
            <li>
              <span className="text-foreground font-medium">Compile EAs</span> in MetaEditor (F7) on each terminal
            </li>
            <li>
              <span className="text-foreground font-medium">Attach Master EA</span> to any chart on your master terminal
            </li>
            <li>
              <span className="text-foreground font-medium">Attach Receiver EA</span> to any chart on receiver terminal(s)
            </li>
            <li>
              <span className="text-foreground font-medium">Verify connection</span> by checking the Activity tab above
            </li>
          </ol>
          
          <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-600 dark:text-yellow-400 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Important Notes:</p>
              <ul className="list-disc list-inside mt-1 space-y-1 text-xs">
                <li>Re-download config after making any changes to update your EAs</li>
                <li>Ensure both terminals have <strong>Allow DLL imports</strong> enabled</li>
                <li>Master and receiver terminals must be running simultaneously</li>
                <li>File polling is used - ensure both terminals access the same config file path</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Version History */}
      {versions && versions.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium">Recent Versions</h4>
          <div className="space-y-1">
            {versions.slice(0, 5).map(v => (
              <div key={v.id} className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded text-sm">
                <div className="flex items-center gap-2">
                  <span>Version {v.version}</span>
                  <Badge variant="outline" className="font-mono text-xs">
                    {v.config_hash.slice(0, 8)}...
                  </Badge>
                </div>
                <span className="text-muted-foreground">
                  {new Date(v.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="font-medium truncate">{value}</p>
        </div>
        {icon}
      </CardContent>
    </Card>
  );
}
