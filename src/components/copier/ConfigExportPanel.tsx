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
  Hash 
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
      
      {/* Setup Instructions */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h4 className="font-medium">Setup Instructions</h4>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Download the config file above</li>
            <li>Place it in your MT5's <code className="bg-muted px-1 rounded">MQL5/Files/</code> folder</li>
            <li>Install <code className="bg-muted px-1 rounded">TradeCopierMaster.mq5</code> on your master terminal</li>
            <li>Install <code className="bg-muted px-1 rounded">TradeCopierReceiver.mq5</code> on receiver terminal(s)</li>
            <li>Trades on master will be copied locally to receivers</li>
          </ol>
          
          <div className="flex items-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-600 dark:text-yellow-400 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <p>Re-download config after making changes to update your EAs</p>
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
                <span>Version {v.version}</span>
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
          <p className="font-medium">{value}</p>
        </div>
        {icon}
      </CardContent>
    </Card>
  );
}
