import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  Download, 
  Monitor, 
  Cpu, 
  Zap, 
  RefreshCw, 
  Shield, 
  Copy, 
  Check,
  ExternalLink,
  Github,
  Terminal,
  FileCode,
  HardDrive,
  Clock
} from "lucide-react";
import { Account } from "@/types/trading";
import { toast } from "sonner";

interface DesktopAppPanelProps {
  masterAccount: Account | undefined;
  receiverAccounts: Account[];
}

export function DesktopAppPanel({ masterAccount, receiverAccounts }: DesktopAppPanelProps) {
  const [copied, setCopied] = useState(false);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);

  const receiverWithApiKey = receiverAccounts.find(a => a.api_key);
  const configEndpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/copier-config`;

  const handleCopyEndpoint = async () => {
    await navigator.clipboard.writeText(configEndpoint);
    setCopied(true);
    toast.success("Config endpoint copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyApiKey = async () => {
    if (receiverWithApiKey?.api_key) {
      await navigator.clipboard.writeText(receiverWithApiKey.api_key);
      setApiKeyCopied(true);
      toast.success("API key copied!");
      setTimeout(() => setApiKeyCopied(false), 2000);
    }
  };

  const features = [
    {
      icon: Zap,
      title: "Ultra-Low Latency",
      description: "20-50ms execution vs 100-500ms with EA-only approach"
    },
    {
      icon: HardDrive,
      title: "Lightweight",
      description: "Only ~3-5MB download, runs silently in system tray"
    },
    {
      icon: RefreshCw,
      title: "Auto-Updates",
      description: "Automatic updates when new versions are released"
    },
    {
      icon: Shield,
      title: "Offline Capable",
      description: "Works offline, syncs execution history when connected"
    }
  ];

  const setupSteps = [
    {
      step: 1,
      title: "Clone the Repository",
      code: "git clone https://github.com/your-org/saturn-copier-desktop.git\ncd saturn-copier-desktop"
    },
    {
      step: 2,
      title: "Install Dependencies",
      code: "npm install\nrustup update stable"
    },
    {
      step: 3,
      title: "Configure API Key",
      description: "Create a .env file with your receiver account's API key"
    },
    {
      step: 4,
      title: "Build & Run",
      code: "npm run tauri dev    # Development\nnpm run tauri build  # Production"
    }
  ];

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      <Alert className="border-primary/30 bg-primary/5">
        <Monitor className="h-4 w-4" />
        <AlertTitle>Desktop Trade Copier</AlertTitle>
        <AlertDescription>
          A lightweight Tauri-based desktop app that runs in your system tray, monitoring MT5 trades 
          and executing copies with ultra-low latency. Configuration syncs from your web dashboard.
        </AlertDescription>
      </Alert>

      {/* Features Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {features.map((feature) => (
          <Card key={feature.title} className="border-border/50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <feature.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h4 className="font-medium">{feature.title}</h4>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Download Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Download Desktop App
            </CardTitle>
            <CardDescription>
              Get the pre-built installer or build from source
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Download buttons */}
            <div className="space-y-3">
              <Button className="w-full" size="lg" disabled>
                <Download className="mr-2 h-4 w-4" />
                Download for Windows (Coming Soon)
                <Badge variant="secondary" className="ml-2">3.5 MB</Badge>
              </Button>
              
              <div className="flex items-center gap-2">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">or</span>
                <Separator className="flex-1" />
              </div>

              <Button variant="outline" className="w-full" asChild>
                <a 
                  href="https://github.com/your-org/saturn-copier-desktop" 
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  <Github className="mr-2 h-4 w-4" />
                  Build from Source
                  <ExternalLink className="ml-2 h-3 w-3" />
                </a>
              </Button>
            </div>

            {/* System Requirements */}
            <div className="pt-4 border-t">
              <h4 className="text-sm font-medium mb-2">System Requirements</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li className="flex items-center gap-2">
                  <Check className="h-3 w-3 text-green-500" />
                  Windows 10/11 (64-bit)
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-3 w-3 text-green-500" />
                  MetaTrader 5 installed
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-3 w-3 text-green-500" />
                  Internet connection (for config sync)
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Configuration Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5" />
              Desktop App Configuration
            </CardTitle>
            <CardDescription>
              Connection details for the desktop app
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!masterAccount ? (
              <Alert variant="destructive">
                <AlertDescription>
                  Set up a master account first to generate desktop app configuration.
                </AlertDescription>
              </Alert>
            ) : !receiverWithApiKey ? (
              <Alert>
                <AlertDescription>
                  Generate an API key for one of your receiver accounts to enable desktop app sync.
                  Go to the Accounts page and add an API key to your receiver account.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                {/* Config Endpoint */}
                <div className="space-y-2">
                  <Label>Config Endpoint</Label>
                  <div className="flex gap-2">
                    <Input 
                      value={configEndpoint} 
                      readOnly 
                      className="font-mono text-xs"
                    />
                    <Button 
                      variant="outline" 
                      size="icon"
                      onClick={handleCopyEndpoint}
                    >
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {/* API Key */}
                <div className="space-y-2">
                  <Label>Receiver API Key</Label>
                  <div className="flex gap-2">
                    <Input 
                      value={receiverWithApiKey.api_key ? `${receiverWithApiKey.api_key.slice(0, 8)}...${receiverWithApiKey.api_key.slice(-4)}` : ''} 
                      readOnly 
                      className="font-mono text-xs"
                    />
                    <Button 
                      variant="outline" 
                      size="icon"
                      onClick={handleCopyApiKey}
                    >
                      {apiKeyCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    From account: {receiverWithApiKey.name}
                  </p>
                </div>

                {/* Connection Status */}
                <div className="pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Desktop App Status</span>
                    <Badge variant="outline" className="text-muted-foreground">
                      <Clock className="h-3 w-3 mr-1" />
                      Not Connected
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Status will update when the desktop app connects
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Build Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            Build from Source
          </CardTitle>
          <CardDescription>
            Step-by-step instructions for building the desktop app locally
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Prerequisites */}
            <div>
              <h4 className="text-sm font-medium mb-3">Prerequisites</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
                  <FileCode className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Node.js 18+</p>
                    <p className="text-xs text-muted-foreground">JavaScript runtime</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
                  <Terminal className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Rust 1.70+</p>
                    <p className="text-xs text-muted-foreground">via rustup</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
                  <Cpu className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Tauri CLI</p>
                    <p className="text-xs text-muted-foreground">npm install -g @tauri-apps/cli</p>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Steps */}
            <div className="space-y-4">
              {setupSteps.map((item) => (
                <div key={item.step} className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                    {item.step}
                  </div>
                  <div className="flex-1 space-y-2">
                    <h4 className="font-medium">{item.title}</h4>
                    {item.description && (
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                    )}
                    {item.code && (
                      <pre className="p-3 rounded-lg bg-muted text-sm font-mono overflow-x-auto">
                        {item.code}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <Separator />

            {/* Help Links */}
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" size="sm" asChild>
                <a 
                  href="https://tauri.app/v1/guides/getting-started/prerequisites" 
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  Tauri Prerequisites
                  <ExternalLink className="ml-2 h-3 w-3" />
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a 
                  href="https://rustup.rs/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  Install Rust
                  <ExternalLink className="ml-2 h-3 w-3" />
                </a>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
