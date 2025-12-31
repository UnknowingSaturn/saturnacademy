import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Download, MonitorSmartphone, ArrowRight, Crown, Radio } from 'lucide-react';
import { useCopierAccounts } from '@/hooks/useCopier';

export function CopierOverview() {
  const { data: accounts, isLoading } = useCopierAccounts();
  
  const masterAccount = accounts?.find(a => a.copier_role === 'master');
  const receiverAccounts = accounts?.filter(a => a.copier_role === 'receiver') || [];
  const hasCopierSetup = masterAccount || receiverAccounts.length > 0;

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
                The app will guide you through the setup process.
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
              <li>The app will automatically install EAs and configure everything</li>
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
                  <div
                    key={receiver.id}
                    className="p-4 bg-purple-500/10 border-2 border-purple-500 rounded-lg text-center"
                  >
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <Radio className="w-4 h-4 text-purple-500" />
                      <span className="text-xs font-medium text-purple-600 uppercase">Receiver</span>
                    </div>
                    <p className="font-medium">{receiver.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {receiver.broker} • {receiver.account_number}
                    </p>
                  </div>
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
    </div>
  );
}
