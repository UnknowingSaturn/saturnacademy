import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { 
  Download, 
  Zap, 
  Shield, 
  Copy, 
  Check,
  Github,
  HardDrive,
  Package,
  Calendar,
  Sparkles,
  ChevronRight,
  Settings,
  ArrowLeftRight,
  AlertTriangle,
  HelpCircle,
  Terminal,
  MonitorSmartphone,
  Scan,
  Crown,
  Radio,
  Key,
  Play,
  ArrowRight,
  Monitor
} from "lucide-react";
import { useCopierAccounts, useReceiverSettings, useSymbolMappings } from "@/hooks/useCopier";
import { toast } from "sonner";

interface ReleaseInfo {
  version: string;
  releaseDate: string;
  downloadUrl: string;
  downloadSize: string;
  releaseNotes: string[];
}

const DEFAULT_RELEASE: ReleaseInfo = {
  version: "1.0.0",
  releaseDate: new Date().toISOString().split('T')[0],
  downloadUrl: "",
  downloadSize: "~5 MB",
  releaseNotes: [
    "Ultra-low latency trade copying (20-50ms)",
    "Complete wizard for setup configuration",
    "Risk settings and symbol mapping in-app",
    "Auto-sync with your web dashboard"
  ]
};

const DOWNLOAD_URL_KEY = 'saturn_desktop_download_url';

export function CopierDashboardView() {
  const { data: accounts, isLoading } = useCopierAccounts();
  const [copied, setCopied] = useState(false);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  const [releaseInfo, setReleaseInfo] = useState<ReleaseInfo>(DEFAULT_RELEASE);
  const [downloadUrlInput, setDownloadUrlInput] = useState("");
  const [isEditingUrl, setIsEditingUrl] = useState(false);

  // Derive master and receiver accounts
  const masterAccount = accounts?.find(a => 
    a.copier_role === 'master' && a.ea_type === 'master'
  );
  const receiverAccounts = accounts?.filter(a => 
    a.copier_role === 'receiver' && a.ea_type === 'receiver'
  ) || [];
  const hasCopierSetup = masterAccount || receiverAccounts.length > 0;

  // Config details
  const receiverWithApiKey = receiverAccounts.find(a => a.api_key);
  const configEndpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/copier-config`;

  // Symbol mappings for summary
  const { data: symbolMappings } = useSymbolMappings(masterAccount?.id);
  const enabledMappingsCount = symbolMappings?.filter(m => m.is_enabled).length || 0;
  const totalMappingsCount = symbolMappings?.length || 0;

  useEffect(() => {
    const savedUrl = localStorage.getItem(DOWNLOAD_URL_KEY);
    if (savedUrl) {
      setReleaseInfo(prev => ({ ...prev, downloadUrl: savedUrl }));
      setDownloadUrlInput(savedUrl);
    }
  }, []);

  const handleSaveDownloadUrl = () => {
    if (downloadUrlInput.trim()) {
      localStorage.setItem(DOWNLOAD_URL_KEY, downloadUrlInput.trim());
      setReleaseInfo(prev => ({ ...prev, downloadUrl: downloadUrlInput.trim() }));
      toast.success("Download URL saved!");
    }
    setIsEditingUrl(false);
  };

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const features = [
    { icon: Zap, title: "Ultra-Low Latency", description: "20-50ms execution" },
    { icon: HardDrive, title: "Lightweight", description: "~5MB, system tray" },
    { icon: Settings, title: "All-in-One Setup", description: "Risk & symbols in wizard" },
    { icon: Shield, title: "Offline Capable", description: "Syncs when connected" }
  ];

  const wizardSteps = [
    { step: 1, icon: Scan, title: "Scan Terminals", description: "Auto-detect running MT5 terminals" },
    { step: 2, icon: Crown, title: "Select Master", description: "Choose the source account" },
    { step: 3, icon: Radio, title: "Select Receivers", description: "Choose accounts to copy to" },
    { step: 4, icon: Shield, title: "Risk Settings", description: "Lot sizing, slippage, daily limits" },
    { step: 5, icon: ArrowLeftRight, title: "Symbol Mappings", description: "Map symbols between brokers" },
    { step: 6, icon: Play, title: "Start Copying", description: "EAs install & copying begins" }
  ];

  const troubleshootingItems = [
    { problem: "No terminals detected", solution: "Ensure MT5 is running before launching the desktop app." },
    { problem: "Trades not copying", solution: "Check symbol mappings. If master trades EURUSD but receiver has EURUSDm, you need a mapping." },
    { problem: "High slippage warnings", solution: "Reduce poll interval in risk settings or ensure stable internet connections." },
    { problem: "API key not working", solution: "Generate a new API key on the Accounts page and re-enter it in the desktop app." },
    { problem: "Desktop app not starting", solution: "On Windows, click 'More info' → 'Run anyway' when SmartScreen appears." },
    { problem: "Config not syncing", solution: "Check your internet connection. The app needs connectivity to sync settings." }
  ];

  const faqItems = [
    { question: "Can I run multiple receiver accounts?", answer: "Yes! Select multiple receivers in the wizard. Each can have its own risk settings." },
    { question: "What happens if the desktop app closes?", answer: "Copying stops until you restart. Consider adding it to Windows startup." },
    { question: "How do I update the app?", answer: "Download the latest version and install. Your settings are preserved in the cloud." },
    { question: "Do I need to install EAs manually?", answer: "No! The desktop app automatically installs required EAs." },
    { question: "Can I edit settings after initial setup?", answer: "Yes, open the desktop app settings to modify risk settings or symbol mappings." },
    { question: "Is my API key secure?", answer: "Yes, it's stored locally and only used for authentication. Never share it publicly." }
  ];

  const buildSteps = [
    { step: 1, title: "Clone Repository", code: "git clone https://github.com/UnknowingSaturn/saturnacademy.git\ncd saturnacademy/copier-desktop" },
    { step: 2, title: "Install Dependencies", code: "npm install\nrustup update stable" },
    { step: 3, title: "Build & Run", code: "npm run tauri dev    # Development\nnpm run tauri build  # Production" }
  ];

  // When setup exists, show current configuration
  if (hasCopierSetup) {
    return (
      <div className="space-y-6">
        {/* Current Setup Diagram */}
        <Card>
          <CardHeader>
            <CardTitle>Current Setup</CardTitle>
            <CardDescription>Your trade copier configuration</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center gap-4">
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

              {receiverAccounts.length > 0 && (
                <div className="flex flex-col items-center text-muted-foreground">
                  <ArrowRight className="w-4 h-4 rotate-90" />
                  <span className="text-xs">copies to</span>
                </div>
              )}

              {receiverAccounts.length > 0 ? (
                <div className="w-full max-w-sm space-y-2">
                  {receiverAccounts.map((receiver) => (
                    <ReceiverCard key={receiver.id} receiver={receiver} />
                  ))}
                </div>
              ) : masterAccount ? (
                <div className="w-full max-w-sm p-4 border-2 border-dashed border-muted-foreground/30 rounded-lg text-center">
                  <p className="text-sm text-muted-foreground">No receiver accounts configured</p>
                  <p className="text-xs text-muted-foreground mt-1">Add receivers using the Desktop App</p>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* Configuration Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  <p className="text-xs text-muted-foreground">of {totalMappingsCount} mappings enabled</p>
                </div>
                <Badge variant="outline" className="gap-1">
                  <Monitor className="h-3 w-3" />
                  Edit in Desktop App
                </Badge>
              </div>
            </CardContent>
          </Card>

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
                  <p className="text-xs text-muted-foreground">receiver{receiverAccounts.length !== 1 ? 's' : ''} configured</p>
                </div>
                <Badge variant="outline" className="gap-1">
                  <Monitor className="h-3 w-3" />
                  Edit in Desktop App
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Connection Details (if API key exists) */}
        {receiverWithApiKey && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Key className="h-4 w-4" />
                Connection Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Config Endpoint</Label>
                <div className="flex gap-2">
                  <Input value={configEndpoint} readOnly className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={handleCopyEndpoint}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Receiver API Key</Label>
                <div className="flex gap-2">
                  <Input 
                    value={`${receiverWithApiKey.api_key?.slice(0, 8)}...${receiverWithApiKey.api_key?.slice(-4)}`} 
                    readOnly 
                    className="font-mono text-xs"
                  />
                  <Button variant="outline" size="icon" onClick={handleCopyApiKey}>
                    {apiKeyCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">From: {receiverWithApiKey.name}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Collapsible Help Section */}
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="help">
            <AccordionTrigger className="text-base">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4" />
                Help & Troubleshooting
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              {/* Troubleshooting */}
              <div>
                <h4 className="font-medium mb-3">Common Issues</h4>
                <div className="space-y-2">
                  {troubleshootingItems.map((item, i) => (
                    <div key={i} className="p-3 rounded-lg bg-muted/50 border">
                      <p className="font-medium text-sm">{item.problem}</p>
                      <p className="text-xs text-muted-foreground mt-1">{item.solution}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* FAQ */}
              <div>
                <h4 className="font-medium mb-3">FAQ</h4>
                <Accordion type="single" collapsible className="w-full">
                  {faqItems.map((item, i) => (
                    <AccordionItem key={i} value={`faq-${i}`}>
                      <AccordionTrigger className="text-sm">{item.question}</AccordionTrigger>
                      <AccordionContent className="text-sm text-muted-foreground">
                        {item.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>

              {/* Re-download */}
              <div className="pt-4 border-t">
                <h4 className="font-medium mb-2">Need to re-download the app?</h4>
                {releaseInfo.downloadUrl ? (
                  <Button variant="outline" asChild>
                    <a href={releaseInfo.downloadUrl} download>
                      <Download className="mr-2 h-4 w-4" />
                      Download Desktop App
                    </a>
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">No download URL configured.</p>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    );
  }

  // No setup - show getting started guide
  return (
    <div className="space-y-6">
      {/* Features Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {features.map((feature) => (
          <Card key={feature.title} className="border-border/50">
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-col items-center text-center gap-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <feature.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h4 className="font-medium text-sm">{feature.title}</h4>
                  <p className="text-xs text-muted-foreground">{feature.description}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Download Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                Download Desktop App
              </CardTitle>
              <CardDescription>Get the pre-built installer for Windows</CardDescription>
            </div>
            <Badge variant="outline" className="text-xs">
              <Package className="h-3 w-3 mr-1" />
              v{releaseInfo.version}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 rounded-lg bg-muted/50 border space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="font-medium">Latest Release</span>
              </div>
              <span className="text-sm text-muted-foreground">v{releaseInfo.version}</span>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(releaseInfo.releaseDate).toLocaleDateString()}
              </div>
              <div className="flex items-center gap-1">
                <HardDrive className="h-3 w-3" />
                {releaseInfo.downloadSize}
              </div>
            </div>
            <div className="pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-2">What's included:</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                {releaseInfo.releaseNotes.map((note, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <ChevronRight className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="space-y-3">
            {releaseInfo.downloadUrl ? (
              <Button className="w-full" size="lg" asChild>
                <a href={releaseInfo.downloadUrl} download>
                  <Download className="mr-2 h-4 w-4" />
                  Download for Windows
                  <Badge variant="secondary" className="ml-2">{releaseInfo.downloadSize}</Badge>
                </a>
              </Button>
            ) : (
              <div className="p-4 rounded-lg border-2 border-dashed border-muted-foreground/30 text-center">
                <Package className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm font-medium">No download available yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Build via GitHub Actions, then paste the URL below
                </p>
              </div>
            )}

            <div className="p-3 rounded-lg bg-muted/50 border space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">Download URL</Label>
                {!isEditingUrl && releaseInfo.downloadUrl && (
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setIsEditingUrl(true)}>
                    Edit
                  </Button>
                )}
              </div>
              {isEditingUrl || !releaseInfo.downloadUrl ? (
                <div className="flex gap-2">
                  <Input
                    value={downloadUrlInput}
                    onChange={(e) => setDownloadUrlInput(e.target.value)}
                    placeholder="https://github.com/.../releases/download/..."
                    className="text-xs font-mono"
                  />
                  <Button size="sm" onClick={handleSaveDownloadUrl}>Save</Button>
                  {isEditingUrl && (
                    <Button size="sm" variant="outline" onClick={() => {
                      setIsEditingUrl(false);
                      setDownloadUrlInput(releaseInfo.downloadUrl);
                    }}>
                      Cancel
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground font-mono truncate">{releaseInfo.downloadUrl}</p>
              )}
            </div>
            
            <Button variant="outline" className="w-full" asChild>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer">
                <Github className="mr-2 h-4 w-4" />
                View on GitHub
              </a>
            </Button>
          </div>

          <div className="pt-4 border-t">
            <h4 className="text-sm font-medium mb-2">System Requirements</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li className="flex items-center gap-2"><Check className="h-3 w-3 text-green-500" />Windows 10/11 (64-bit)</li>
              <li className="flex items-center gap-2"><Check className="h-3 w-3 text-green-500" />MetaTrader 5 installed</li>
              <li className="flex items-center gap-2"><Check className="h-3 w-3 text-green-500" />Internet connection (for initial setup)</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Wizard Steps */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MonitorSmartphone className="h-5 w-5" />
            Desktop App Wizard
          </CardTitle>
          <CardDescription>The desktop app guides you through these steps</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {wizardSteps.map((ws) => (
              <div key={ws.step} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <ws.icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Step {ws.step}</p>
                  <h4 className="font-medium text-sm">{ws.title}</h4>
                  <p className="text-xs text-muted-foreground">{ws.description}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Troubleshooting & FAQ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5" />
            Troubleshooting & FAQ
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="troubleshooting">
              <AccordionTrigger>Common Issues</AccordionTrigger>
              <AccordionContent className="space-y-2">
                {troubleshootingItems.map((item, i) => (
                  <div key={i} className="p-3 rounded-lg bg-muted/50 border">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">{item.problem}</p>
                        <p className="text-xs text-muted-foreground mt-1">{item.solution}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="faq">
              <AccordionTrigger>Frequently Asked Questions</AccordionTrigger>
              <AccordionContent>
                <Accordion type="single" collapsible className="w-full">
                  {faqItems.map((item, i) => (
                    <AccordionItem key={i} value={`faq-${i}`}>
                      <AccordionTrigger className="text-sm">{item.question}</AccordionTrigger>
                      <AccordionContent className="text-sm text-muted-foreground">
                        {item.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="build">
              <AccordionTrigger>Build from Source</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <Alert>
                  <Terminal className="h-4 w-4" />
                  <AlertTitle>Prerequisites</AlertTitle>
                  <AlertDescription className="text-xs">
                    Node.js 18+, Rust toolchain, Visual Studio Build Tools (Windows)
                  </AlertDescription>
                </Alert>
                {buildSteps.map((bs) => (
                  <div key={bs.step} className="space-y-2">
                    <p className="text-sm font-medium">Step {bs.step}: {bs.title}</p>
                    <pre className="p-3 rounded-lg bg-muted text-xs font-mono overflow-x-auto">{bs.code}</pre>
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}

// Sub-component for receiver cards with risk settings summary
function ReceiverCard({ receiver }: { receiver: any }) {
  const { data: settingsArray } = useReceiverSettings(receiver.id);
  const settings = settingsArray?.[0];
  
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
