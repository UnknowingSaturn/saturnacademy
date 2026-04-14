import * as React from "react";
import { useRef } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface ReportUploadProps {
  onMetricsParsed: (metrics: string) => void;
  disabled?: boolean;
}

function parseHtmlReport(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const lines: string[] = [];

  // Extract title
  const title = doc.querySelector("title")?.textContent;
  if (title) lines.push(`# ${title}`);

  // Extract all tables and format them
  const tables = doc.querySelectorAll("table");
  tables.forEach((table, idx) => {
    const rows = table.querySelectorAll("tr");
    if (rows.length === 0) return;

    if (idx < 3) {
      // First few tables usually contain summary metrics
      rows.forEach((row) => {
        const cells = row.querySelectorAll("td, th");
        const cellTexts = Array.from(cells).map((c) => c.textContent?.trim() || "");
        if (cellTexts.length === 2 && cellTexts[0] && cellTexts[1]) {
          lines.push(`- **${cellTexts[0]}**: ${cellTexts[1]}`);
        } else if (cellTexts.some(Boolean)) {
          lines.push(cellTexts.filter(Boolean).join(" | "));
        }
      });
      lines.push("");
    }
  });

  // Look for specific metric patterns in raw text if tables didn't capture much
  const bodyText = doc.body?.textContent || "";
  const patterns = [
    /Total Net Profit\s*[:\s]+([^\n]+)/i,
    /Gross Profit\s*[:\s]+([^\n]+)/i,
    /Gross Loss\s*[:\s]+([^\n]+)/i,
    /Profit Factor\s*[:\s]+([^\n]+)/i,
    /Expected Payoff\s*[:\s]+([^\n]+)/i,
    /Maximal Drawdown\s*[:\s]+([^\n]+)/i,
    /Relative Drawdown\s*[:\s]+([^\n]+)/i,
    /Total Trades\s*[:\s]+([^\n]+)/i,
    /Short Positions.*?won\s*[:\s]+([^\n]+)/i,
    /Long Positions.*?won\s*[:\s]+([^\n]+)/i,
    /Largest profit trade\s*[:\s]+([^\n]+)/i,
    /Largest loss trade\s*[:\s]+([^\n]+)/i,
    /Average profit trade\s*[:\s]+([^\n]+)/i,
    /Average loss trade\s*[:\s]+([^\n]+)/i,
    /Sharpe Ratio\s*[:\s]+([^\n]+)/i,
    /Recovery Factor\s*[:\s]+([^\n]+)/i,
  ];

  const extracted: string[] = [];
  for (const p of patterns) {
    const m = bodyText.match(p);
    if (m) extracted.push(`- ${m[0].trim()}`);
  }

  if (extracted.length > 0 && lines.length < 5) {
    lines.push("## Extracted Metrics");
    lines.push(...extracted);
  }

  return lines.join("\n") || "Could not parse report metrics. Please paste the key metrics manually.";
}

export function ReportUpload({ onMetricsParsed, disabled }: ReportUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".html") && !file.name.endsWith(".htm")) {
      toast({ title: "Unsupported file", description: "Please upload an MT5 HTML report file.", variant: "destructive" });
      return;
    }

    try {
      const text = await file.text();
      const metrics = parseHtmlReport(text);
      onMetricsParsed(metrics);
      toast({ title: "Report parsed", description: "Backtest metrics extracted and ready for analysis." });
    } catch {
      toast({ title: "Parse error", description: "Could not parse the report file.", variant: "destructive" });
    }

    // Reset input
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".html,.htm"
        className="hidden"
        onChange={handleFile}
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-[44px] w-[44px] shrink-0"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        title="Upload MT5 backtest report"
      >
        <FileUp className="h-4 w-4" />
      </Button>
    </>
  );
}
