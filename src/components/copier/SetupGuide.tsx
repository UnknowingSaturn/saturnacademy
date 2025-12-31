import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { 
  Download, 
  Monitor, 
  Zap, 
  RefreshCw, 
  Shield, 
  Copy, 
  Check,
  Github,
  HardDrive,
  Clock,
  Package,
  Calendar,
  Sparkles,
  ChevronRight,
  CheckCircle2,
  MousePointer,
  Key,
  Play,
  Search,
  Settings,
  ArrowLeftRight,
  AlertTriangle,
  HelpCircle,
  Terminal,
  FileCode,
  MonitorSmartphone,
  Scan,
  Crown,
  Radio
} from "lucide-react";
import { Account } from "@/types/trading";
import { toast } from "sonner";

interface SetupGuideProps {
  masterAccount: Account | undefined;
  receiverAccounts: Account[];
}

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

export function SetupGuide({ masterAccount, receiverAccounts }: SetupGuideProps) {
  const [copied, setCopied] = useState(false);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  const [releaseInfo, setReleaseInfo] = useState<ReleaseInfo>(DEFAULT_RELEASE);
  const [downloadUrlInput, setDownloadUrlInput] = useState("");
  const [isEditingUrl, setIsEditingUrl] = useState(false);

  const receiverWithApiKey = receiverAccounts.find(a => a.api_key);
  const configEndpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/copier-config`;

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

  const features = [
    {
      icon: Zap,
      title: "Ultra-Low Latency",
      description: "20-50ms execution speed"
    },
    {
      icon: HardDrive,
      title: "Lightweight",
      description: "~5MB, runs in system tray"
    },
    {
      icon: Settings,
      title: "All-in-One Setup",
      description: "Risk & symbols configured in wizard"
    },
    {
      icon: Shield,
      title: "Offline Capable",
      description: "Syncs when connected"
    }
  ];

  const wizardSteps = [
    {
      step: 1,
      icon: Scan,
      title: "Scan for MT5 Terminals",
      description: "The app automatically detects all running MT5 terminals on your computer"
    },
    {
      step: 2,
      icon: Crown,
      title: "Select Master Account",
      description: "Choose which MT5 account will be your master (source of trades)"
    },
    {
      step: 3,
      icon: Radio,
      title: "Select Receiver Accounts",
      description: "Choose one or more accounts to receive copied trades"
    },
    {
      step: 4,
      icon: Shield,
      title: "Configure Risk Settings",
      description: "Set lot sizing mode, max slippage, daily loss limits, and prop firm safe mode"
    },
    {
      step: 5,
      icon: ArrowLeftRight,
      title: "Set Up Symbol Mappings",
      description: "Map symbols between brokers (e.g., EURUSD → EURUSDm) with auto-mapping"
    },
    {
      step: 6,
      icon: Play,
      title: "Start Copying",
      description: "The app installs EAs and begins copying trades automatically"
    }
  ];

  const troubleshootingItems = [
    {
      problem: "No terminals detected",
      solution: "Ensure MT5 is running before launching the desktop app. The app scans for active MT5 processes."
    },
    {
      problem: "Trades not copying",
      solution: "Check that symbol mappings are configured correctly. If the master trades EURUSD but the receiver has EURUSDm, you need a mapping."
    },
    {
      problem: "High slippage warnings",
      solution: "Reduce the poll interval in risk settings, or ensure both terminals have stable internet connections."
    },
    {
      problem: "API key not working",
      solution: "Go to the Accounts page, select your receiver account, and generate a new API key. Then re-enter it in the desktop app."
    },
    {
      problem: "Desktop app not starting",
      solution: "On Windows, you may need to click 'More info' → 'Run anyway' when SmartScreen appears. The app is safe but not yet signed."
    },
    {
      problem: "Config not syncing",
      solution: "Check your internet connection. The app needs connectivity to sync settings from the cloud."
    }
  ];

  const faqItems = [
    {
      question: "Can I run multiple receiver accounts?",
      answer: "Yes! You can select multiple receiver accounts in the wizard. Each receiver can have its own risk settings and symbol mappings."
    },
    {
      question: "What happens if the desktop app closes?",
      answer: "Trade copying will stop until you restart the app. Consider adding it to Windows startup for automatic launch."
    },
    {
      question: "How do I update the app?",
      answer: "Download the latest version from the same link and install it. Your settings are preserved in the cloud."
    },
    {
      question: "Do I need to install EAs manually?",
      answer: "No! The desktop app automatically installs the required EAs when you complete the wizard."
    },
    {
      question: "Can I edit settings after initial setup?",
      answer: "Yes, open the desktop app and access the settings panel to modify risk settings, symbol mappings, or change accounts."
    },
    {
      question: "Is my API key secure?",
      answer: "Yes, your API key is stored locally and only used to authenticate with the cloud service. Never share it publicly."
    }
  ];

  const buildSteps = [
    {
      step: 1,
      title: "Clone the Repository",
      code: "git clone https://github.com/UnknowingSaturn/saturnacademy.git\ncd saturnacademy/copier-desktop"
    },
    {
      step: 2,
      title: "Install Dependencies",
      code: "npm install\nrustup update stable"
    },
    {
      step: 3,
      title: "Build & Run",
      code: "npm run tauri dev    # Development\nnpm run tauri build  # Production"
    }
  ];

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Download Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Download className="h-5 w-5" />
                  Download Desktop App
                </CardTitle>
                <CardDescription>
                  Get the pre-built installer for Windows
                </CardDescription>
              </div>
              <Badge variant="outline" className="text-xs">
                <Package className="h-3 w-3 mr-1" />
                v{releaseInfo.version}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Version Info */}
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

            {/* Download buttons */}
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

              {/* Download URL Configuration */}
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
                  Internet connection (for initial setup)
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* API Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Connection Details
            </CardTitle>
            <CardDescription>
              Required for the desktop app to sync with your account
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!masterAccount ? (
              <Alert>
                <MonitorSmartphone className="h-4 w-4" />
                <AlertDescription>
                  Complete the desktop app wizard first. These details will be available after you set up your accounts.
                </AlertDescription>
              </Alert>
            ) : !receiverWithApiKey ? (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Generate an API key for your receiver account. Go to the <strong>Accounts</strong> page and add an API key.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Config Endpoint</Label>
                  <div className="flex gap-2">
                    <Input value={configEndpoint} readOnly className="font-mono text-xs" />
                    <Button variant="outline" size="icon" onClick={handleCopyEndpoint}>
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Receiver API Key</Label>
                  <div className="flex gap-2">
                    <Input 
                      value={receiverWithApiKey.api_key ? `${receiverWithApiKey.api_key.slice(0, 8)}...${receiverWithApiKey.api_key.slice(-4)}` : ''} 
                      readOnly 
                      className="font-mono text-xs"
                    />
                    <Button variant="outline" size="icon" onClick={handleCopyApiKey}>
                      {apiKeyCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">From account: {receiverWithApiKey.name}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Wizard Steps */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MonitorSmartphone className="h-5 w-5" />
            Desktop App Wizard
          </CardTitle>
          <CardDescription>
            The desktop app guides you through these steps
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {wizardSteps.map((step) => (
              <div key={step.step} className="flex gap-3 p-3 rounded-lg bg-muted/30">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-bold text-primary">{step.step}</span>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <step.icon className="h-4 w-4 text-primary" />
                    <h4 className="font-medium text-sm">{step.title}</h4>
                  </div>
                  <p className="text-xs text-muted-foreground">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Troubleshooting & FAQ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Troubleshooting */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Troubleshooting
            </CardTitle>
            <CardDescription>Common issues and solutions</CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="w-full">
              {troubleshootingItems.map((item, index) => (
                <AccordionItem key={index} value={`trouble-${index}`}>
                  <AccordionTrigger className="text-sm text-left">
                    {item.problem}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">
                    {item.solution}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>

        {/* FAQ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5" />
              Frequently Asked Questions
            </CardTitle>
            <CardDescription>Quick answers to common questions</CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="w-full">
              {faqItems.map((item, index) => (
                <AccordionItem key={index} value={`faq-${index}`}>
                  <AccordionTrigger className="text-sm text-left">
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      </div>

      {/* Build from Source */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            Build from Source
          </CardTitle>
          <CardDescription>
            For developers who want to build or customize the desktop app
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 rounded-lg bg-muted/50 border">
            <h4 className="text-sm font-medium mb-3">Prerequisites</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li className="flex items-center gap-2">
                <Check className="h-3 w-3 text-green-500" />
                Node.js 18+ and npm
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-3 w-3 text-green-500" />
                Rust toolchain (rustup)
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-3 w-3 text-green-500" />
                Visual Studio Build Tools (Windows)
              </li>
            </ul>
          </div>
          
          <div className="space-y-4">
            {buildSteps.map((step) => (
              <div key={step.step} className="flex gap-4">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-xs font-bold text-primary">{step.step}</span>
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-medium mb-2">{step.title}</h4>
                  {step.code && (
                    <pre className="p-3 rounded-lg bg-muted text-xs font-mono overflow-x-auto">
                      {step.code}
                    </pre>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
