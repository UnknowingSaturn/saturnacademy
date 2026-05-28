import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import {
  Download,
  Copy as CopyIcon,
  Layers,
  MonitorSmartphone,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export type EAGuideTab =
  | "install"
  | "multi-account"
  | "dedicated-chart"
  | "coexist"
  | "prop-firm"
  | "troubleshooting";

interface EASetupGuideProps {
  defaultTab?: EAGuideTab;
}

const CLOUD_URL = import.meta.env.VITE_SUPABASE_URL || "";

function copy(text: string, label = "Copied") {
  navigator.clipboard.writeText(text).then(() => toast.success(label));
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
        {n}
      </div>
      <div className="flex-1 space-y-1.5">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-sm leading-relaxed text-muted-foreground space-y-2">
          {children}
        </div>
      </div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-foreground">
      {children}
    </code>
  );
}

function CodeBlock({ value, label }: { value: string; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs font-mono">
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => copy(value, `${label || "Value"} copied`)}
      >
        <CopyIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function downloadEA(file: string) {
  const link = document.createElement("a");
  link.href = `/${file}`;
  link.download = file;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * The single source of truth for EA setup, multi-account workflows,
 * coexistence with other EAs, prop-firm considerations and troubleshooting.
 * Surfaced from every page that touches MT5 (Accounts, Copier, LiveTrades).
 */
export function EASetupGuide({ defaultTab = "install" }: EASetupGuideProps) {
  return (
    <Tabs defaultValue={defaultTab} className="w-full">
      <TabsList className="grid grid-cols-3 lg:grid-cols-6 gap-1 h-auto">
        <TabsTrigger value="install" className="text-xs">Install</TabsTrigger>
        <TabsTrigger value="multi-account" className="text-xs">Multi-account</TabsTrigger>
        <TabsTrigger value="dedicated-chart" className="text-xs">Chart setup</TabsTrigger>
        <TabsTrigger value="coexist" className="text-xs">Other EAs</TabsTrigger>
        <TabsTrigger value="prop-firm" className="text-xs">Prop firm</TabsTrigger>
        <TabsTrigger value="troubleshooting" className="text-xs">Fix issues</TabsTrigger>
      </TabsList>

      {/* INSTALL */}
      <TabsContent value="install" className="space-y-5 pt-5">
        <Step n={1} title="Download the Expert Advisor">
          <p>Save the EA file to your computer:</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => downloadEA("TradeJournalBridge.mq5")}>
              <Download className="mr-2 h-3.5 w-3.5" />
              TradeJournalBridge
            </Button>
            <Button size="sm" variant="outline" onClick={() => downloadEA("TradeCopierMaster.mq5")}>
              <Download className="mr-2 h-3.5 w-3.5" />
              Copier Master
            </Button>
            <Button size="sm" variant="outline" onClick={() => downloadEA("TradeCopierReceiver.mq5")}>
              <Download className="mr-2 h-3.5 w-3.5" />
              Copier Receiver
            </Button>
          </div>
        </Step>

        <Step n={2} title="Drop it into MT5">
          <p>In MT5, click <Code>File → Open Data Folder</Code>, then navigate to <Code>MQL5 → Experts</Code> and paste the file there.</p>
          <p>In MetaEditor open the file and press <Code>F7</Code> to compile.</p>
        </Step>

        <Step n={3} title="Allow WebRequest">
          <p>Go to <Code>Tools → Options → Expert Advisors</Code>, tick <strong>Allow WebRequest for listed URL</strong>, click <strong>Add</strong> and paste:</p>
          <CodeBlock value={CLOUD_URL} label="Cloud URL" />
        </Step>

        <Step n={4} title="Attach to a chart">
          <p>Drag the EA onto any chart, paste your API key, and tick <strong>Allow Algo Trading</strong> on the <em>Common</em> tab.</p>
          <p>A smiley face on the chart means the EA is live. Check <strong>Experts</strong> tab for the handshake log.</p>
        </Step>
      </TabsContent>

      {/* MULTI-ACCOUNT */}
      <TabsContent value="multi-account" className="space-y-5 pt-5">
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <div className="flex items-start gap-2.5">
            <Layers className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="space-y-1">
              <div className="text-sm font-medium">One terminal can only be logged into one account at a time.</div>
              <p className="text-sm text-muted-foreground">
                To track several accounts in parallel you need <strong>several MT5 installs</strong> — each in its own folder — and an EA instance per install. This is fully supported by MetaQuotes and is the standard prop-firm workflow.
              </p>
            </div>
          </div>
        </div>

        <Step n={1} title="Make a copy of your MT5 install">
          <p>Close MT5. Open the install folder (typically <Code>C:\Program Files\MetaTrader 5</Code> or your broker's branded folder). Copy the entire folder somewhere new, e.g. <Code>C:\MT5-FTMO-12345</Code>.</p>
          <p>Each copy keeps its own settings, charts, and EA state.</p>
        </Step>

        <Step n={2} title="Launch the copy and log in">
          <p>Run <Code>terminal64.exe</Code> from the new folder. Log into the second account. Your first install keeps running its first account in parallel.</p>
        </Step>

        <Step n={3} title="Generate a fresh API key per account">
          <p>Back in Lovable, click <strong>Connect MT5</strong> on the Accounts page — generate a new setup token for this account. Each EA instance must use its own key, never reuse them.</p>
        </Step>

        <Step n={4} title="Attach the EA in the new terminal">
          <p>Follow the same install steps: copy the <Code>.mq5</Code> into the new install's <Code>MQL5\Experts</Code> folder, compile, allow WebRequest, attach to a chart, paste the new API key.</p>
        </Step>

        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <strong className="text-foreground">Tip:</strong> name each desktop shortcut after the account (<Code>MT5 — FTMO 12345</Code>) so you don't mix them up. There's no limit to how many terminals you can run — only RAM.
        </div>
      </TabsContent>

      {/* DEDICATED CHART */}
      <TabsContent value="dedicated-chart" className="space-y-5 pt-5">
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <div className="flex items-start gap-2.5">
            <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="space-y-1">
              <div className="text-sm font-medium">Give the EA its own chart.</div>
              <p className="text-sm text-muted-foreground">
                The EA reads <em>all</em> trades on the account — it doesn't care which symbol the chart is showing. Putting it on a chart you actively trade is risky: change a timeframe or apply a template and you'll detach the EA without noticing.
              </p>
            </div>
          </div>
        </div>

        <Step n={1} title="Open a scratch chart">
          <p>Open a low-volume symbol you never trade — e.g. <Code>EURUSD M1</Code>. Strip the indicators. This is the "EA chart".</p>
        </Step>

        <Step n={2} title="Attach the EA there">
          <p>Drag the EA onto the scratch chart. Confirm the smiley face appears.</p>
        </Step>

        <Step n={3} title="Minimise and forget">
          <p>Minimise the chart inside MT5 or move it to a separate workspace. Never close it. The EA will keep streaming events regardless of which other charts you open or what symbols you analyse.</p>
        </Step>

        <Step n={4} title="Save it as a profile">
          <p>Right-click the chart tab → <Code>Save as Default Template</Code> isn't needed; instead use <Code>File → Profiles → Save As</Code> and name it "Journal". Load it after MT5 updates so you don't lose the EA chart.</p>
        </Step>
      </TabsContent>

      {/* COEXIST */}
      <TabsContent value="coexist" className="space-y-5 pt-5">
        <p className="text-sm text-muted-foreground">
          The bridge EA is <strong>read-only</strong> — it observes deals, it never sends orders. That means it sits safely next to position sizers, news filters, scalper helpers, and other utility EAs. A few rules keep things tidy:
        </p>

        <div className="space-y-3">
          <Card className="p-4 space-y-2">
            <div className="text-sm font-medium">One EA per chart</div>
            <p className="text-sm text-muted-foreground">
              MT5 only allows one EA per chart. Put your position sizer on the chart you trade, and the journal bridge on its own scratch chart (see <em>Chart setup</em> tab).
            </p>
          </Card>

          <Card className="p-4 space-y-2">
            <div className="text-sm font-medium">"Allow Algo Trading" is global</div>
            <p className="text-sm text-muted-foreground">
              The global toggle in the toolbar enables every EA on every chart. You don't need to toggle anything per-EA — just make sure the global button is green.
            </p>
          </Card>

          <Card className="p-4 space-y-2">
            <div className="text-sm font-medium">Magic numbers don't collide</div>
            <p className="text-sm text-muted-foreground">
              The bridge reads every deal regardless of magic number, so your other EAs' trades will still appear in Lovable. Receivers in the copier also accept all deals from the configured master.
            </p>
          </Card>

          <Card className="p-4 space-y-2">
            <div className="text-sm font-medium">Mixing with the Copier</div>
            <p className="text-sm text-muted-foreground">
              On a master account you can run <Code>TradeJournalBridge</Code> and <Code>TradeCopierMaster</Code> at the same time — put each on its own scratch chart. The journal is independent of the copier; neither blocks the other.
            </p>
          </Card>
        </div>
      </TabsContent>

      {/* PROP FIRM */}
      <TabsContent value="prop-firm" className="space-y-5 pt-5">
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="space-y-1">
              <div className="text-sm font-medium">Built for prop-firm rules.</div>
              <p className="text-sm text-muted-foreground">
                The journal bridge is read-only and has been used on FTMO, MyForexFunds, FundedNext and others without flags. The copier adds extra guardrails so receivers stay compliant.
              </p>
            </div>
          </div>
        </div>

        <ul className="space-y-2.5 text-sm">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span><strong>Receiver SL/TP is locked.</strong> Once a copied trade is opened, its stops are managed by the master — the receiver EA refuses manual modification to prevent rule violations.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span><strong>Throttling.</strong> Receivers cap copy rate to avoid the "robotic activity" flag some firms watch for.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span><strong>Risk lot size lives in the desktop app.</strong> The MQL5 EA only clamps the order; sizing is computed centrally so all receivers stay within your defined risk envelope.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span><strong>No pending orders.</strong> Only market executions (<Code>DEAL_ENTRY_IN/OUT</Code>) are copied — limit and stop orders are ignored, mirroring how most prop firms expect EAs to behave.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span><strong>Heartbeats.</strong> The EA pings every 5–10 minutes with account metrics so you spot disconnects fast.</span>
          </li>
        </ul>
      </TabsContent>

      {/* TROUBLESHOOTING */}
      <TabsContent value="troubleshooting" className="space-y-4 pt-5">
        <Card className="p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            EA shows a sad face / no smiley
          </div>
          <p className="text-sm text-muted-foreground">
            Algo Trading is off. Click the <Code>Algo Trading</Code> button in the toolbar (it should turn green), or tick <strong>Allow Algo Trading</strong> on the EA's <em>Common</em> tab.
          </p>
        </Card>

        <Card className="p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            "WebRequest failed" in the Experts tab
          </div>
          <p className="text-sm text-muted-foreground">
            The cloud URL isn't whitelisted. Open <Code>Tools → Options → Expert Advisors</Code>, enable <strong>Allow WebRequest for listed URL</strong>, add:
          </p>
          <CodeBlock value={CLOUD_URL} label="Cloud URL" />
        </Card>

        <Card className="p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Account isn't appearing
          </div>
          <p className="text-sm text-muted-foreground">
            Accounts are created after the first event arrives — either an open trade on attach, or a new deal. If nothing's open, place a small trade or use <strong>Import History</strong>.
          </p>
        </Card>

        <Card className="p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Times look wrong
          </div>
          <p className="text-sm text-muted-foreground">
            The EA auto-detects your broker's UTC offset by comparing <Code>TimeCurrent</Code> to <Code>TimeGMT</Code>. If your broker server is unusual, override the offset in the EA's input parameters and restart it.
          </p>
        </Card>

        <Card className="p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            "Awaiting repair" badge stuck
          </div>
          <p className="text-sm text-muted-foreground">
            Usually a trade that closed while the EA was offline. Click <strong>Try repair</strong> on the row — Lovable will gap-sync. If it stays stuck, mark the trade with <strong>Dismiss as closed</strong>; that records a phase-A acknowledgement and removes it from the queue.
          </p>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
