import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { 
  Download, 
  MonitorSmartphone, 
  ArrowRight, 
  Crown, 
  Radio, 
  Shield,
  ArrowLeftRight,
  Monitor,
  Settings
} from 'lucide-react';
import { useCopierAccounts, useReceiverSettings, useSymbolMappings } from '@/hooks/useCopier';

export function CopierOverview() {
  const { data: accounts, isLoading } = useCopierAccounts();
  
  // Only show accounts where the actual copier EA is running (ea_type matches copier_role)
  const masterAccount = accounts?.find(a => 
    a.copier_role === 'master' && a.ea_type === 'master'
  );
  const receiverAccounts = accounts?.filter(a => 
    a.copier_role === 'receiver' && a.ea_type === 'receiver'
  ) || [];
  const hasCopierSetup = masterAccount || receiverAccounts.length > 0;

  // Fetch settings for read-only display
  const { data: symbolMappings } = useSymbolMappings(masterAccount?.id);
  const enabledMappingsCount = symbolMappings?.filter(m => m.is_enabled).length || 0;
  const totalMappingsCount = symbolMappings?.length || 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!hasCopierSetup) {
    return (
      <div className="space-y-6">
        <Card className="border-dashed">
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
                <MonitorSmartphone className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Get Started with Trade Copier</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Download the Saturn Desktop App to set up your master and receiver accounts. 
                The app will guide you through the complete setup process including risk settings and symbol mappings.
              </p>
              <div className="flex justify-center gap-3">
                <Button asChild>
                  <a href="https://github.com/saturn-copier/releases" target="_blank" rel="noopener noreferrer">
                    <Download className="w-4 h-4 mr-2" />
                    Download Desktop App
                  </a>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Alert>
          <MonitorSmartphone className="h-4 w-4" />
          <AlertTitle>How it works</AlertTitle>
          <AlertDescription>
            <ol className="mt-2 space-y-1 list-decimal list-inside text-sm">
              <li>Download and install the Saturn Desktop App</li>
              <li>Open all MT5 terminals you want to use</li>
              <li>Follow the wizard to select Master and Receiver accounts</li>
              <li>Configure risk settings and symbol mappings in the wizard</li>
              <li>The app will automatically install EAs and start copying</li>
            </ol>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Connection Diagram */}
      <Card>
        <CardHeader>
          <CardTitle>Current Setup</CardTitle>
          <CardDescription>Your trade copier configuration</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-4">
            {/* Master Account */}
            {masterAccount ? (
              <div className="w-full max-w-sm p-4 bg-blue-500/10 border-2 border-blue-500 rounded-lg text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Crown className="w-4 h-4 text-blue-500" />
                  <span className="text-xs font-medium text-blue-600 uppercase">Master</span>
                </div>
                <p className="font-medium">{masterAccount.name}</p>
                <p className="text-xs text-muted-foreground">
                  {masterAccount.broker} • {masterAccount.account_number}
                </p>
              </div>
            ) : (
              <div className="w-full max-w-sm p-4 border-2 border-dashed border-muted-foreground/30 rounded-lg text-center">
                <p className="text-sm text-muted-foreground">No master account configured</p>
              </div>
            )}

            {/* Arrow */}
            {receiverAccounts.length > 0 && (
              <div className="flex flex-col items-center text-muted-foreground">
                <ArrowRight className="w-4 h-4 rotate-90" />
                <span className="text-xs">copies to</span>
              </div>
            )}

            {/* Receiver Accounts */}
            {receiverAccounts.length > 0 ? (
              <div className="w-full max-w-sm space-y-2">
                {receiverAccounts.map((receiver) => (
                  <ReceiverCard key={receiver.id} receiver={receiver} />
                ))}
              </div>
            ) : masterAccount ? (
              <div className="w-full max-w-sm p-4 border-2 border-dashed border-muted-foreground/30 rounded-lg text-center">
                <p className="text-sm text-muted-foreground">No receiver accounts configured</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Add receivers using the Desktop App
                </p>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Configuration Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Symbol Mappings Summary */}
        <Card className="bg-muted/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4" />
              Symbol Mappings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{enabledMappingsCount}</p>
                <p className="text-xs text-muted-foreground">
                  of {totalMappingsCount} mappings enabled
                </p>
              </div>
              <Badge variant="outline" className="gap-1">
                <Monitor className="h-3 w-3" />
                Edit in Desktop App
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Risk Settings Summary */}
        <Card className="bg-muted/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Risk Settings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{receiverAccounts.length}</p>
                <p className="text-xs text-muted-foreground">
                  receiver{receiverAccounts.length !== 1 ? 's' : ''} configured
                </p>
              </div>
              <Badge variant="outline" className="gap-1">
                <Monitor className="h-3 w-3" />
                Edit in Desktop App
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Desktop App Prompt */}
      <Alert className="border-primary/30 bg-primary/5">
        <Settings className="h-4 w-4" />
        <AlertTitle>Configuration via Desktop App</AlertTitle>
        <AlertDescription>
          Risk settings and symbol mappings are configured through the Saturn Desktop App for a 
          streamlined experience. The settings sync automatically to your accounts.
        </AlertDescription>
      </Alert>
    </div>
  );
}

// Sub-component for receiver cards with risk settings summary
function ReceiverCard({ receiver }: { receiver: any }) {
  const { data: settingsArray } = useReceiverSettings(receiver.id);
  const settings = settingsArray?.[0]; // Get the first (and only) settings for this receiver
  
  const riskModeLabels: Record<string, string> = {
    balance_multiplier: 'Balance Mult',
    fixed_lot: 'Fixed Lot',
    lot_multiplier: 'Lot Mult',
    risk_percent: 'Risk %',
    risk_usd: 'Risk $',
  };

  return (
    <div className="p-4 bg-purple-500/10 border-2 border-purple-500 rounded-lg">
      <div className="flex items-center justify-center gap-2 mb-2">
        <Radio className="w-4 h-4 text-purple-500" />
        <span className="text-xs font-medium text-purple-600 uppercase">Receiver</span>
      </div>
      <p className="font-medium text-center">{receiver.name}</p>
      <p className="text-xs text-muted-foreground text-center">
        {receiver.broker} • {receiver.account_number}
      </p>
      
      {settings && (
        <div className="mt-3 pt-3 border-t border-purple-500/30">
          <div className="flex flex-wrap gap-1 justify-center">
            <Badge variant="secondary" className="text-xs">
              {riskModeLabels[settings.risk_mode] || settings.risk_mode}: {settings.risk_value}
            </Badge>
            {settings.prop_firm_safe_mode && (
              <Badge variant="secondary" className="text-xs bg-yellow-500/20 text-yellow-700">
                Prop Safe
              </Badge>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
