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

  // Enhanced regex patterns for all 14 metrics
  const bodyText = doc.body?.textContent || "";
  const patterns = [
    /Total Net Profit\s*[:\s]+([^\n]+)/i,
    /Gross Profit\s*[:\s]+([^\n]+)/i,
    /Gross Loss\s*[:\s]+([^\n]+)/i,
    /Profit Factor\s*[:\s]+([^\n]+)/i,
    /Expected Payoff\s*[:\s]+([^\n]+)/i,
    /Maximal Drawdown\s*[:\s]+([^\n]+)/i,
    /Maximum Drawdown\s*[:\s]+([^\n]+)/i,
    /Relative Drawdown\s*[:\s]+([^\n]+)/i,
    /Total Trades\s*[:\s]+([^\n]+)/i,
    /Short Positions.*?won\s*[:\s]+([^\n]+)/i,
    /Long Positions.*?won\s*[:\s]+([^\n]+)/i,
    /Profit Trades.*?% of total\s*[:\s]+([^\n]+)/i,
    /Loss Trades.*?% of total\s*[:\s]+([^\n]+)/i,
    /Largest profit trade\s*[:\s]+([^\n]+)/i,
    /Largest loss trade\s*[:\s]+([^\n]+)/i,
    /Average profit trade\s*[:\s]+([^\n]+)/i,
    /Average loss trade\s*[:\s]+([^\n]+)/i,
    /Average consecutive wins\s*[:\s]+([^\n]+)/i,
    /Average consecutive losses\s*[:\s]+([^\n]+)/i,
    /Maximum consecutive wins\s*[:\s]+([^\n]+)/i,
    /Maximum consecutive losses\s*[:\s]+([^\n]+)/i,
    /Sharpe Ratio\s*[:\s]+([^\n]+)/i,
    /Recovery Factor\s*[:\s]+([^\n]+)/i,
    /Balance Drawdown Maximal\s*[:\s]+([^\n]+)/i,
    /Equity Drawdown Maximal\s*[:\s]+([^\n]+)/i,
    /Win Rate\s*[:\s]+([^\n]+)/i,
  ];

  const extracted: string[] = [];
  for (const p of patterns) {
    const m = bodyText.match(p);
    if (m) extracted.push(`- ${m[0].trim()}`);
  }

  // Compute win rate from profit/loss trade counts if not directly available
  const profitTradesMatch = bodyText.match(/Profit Trades.*?(\d+)\s*\((\d+\.?\d*)%/i);
  if (profitTradesMatch) {
    extracted.push(`- Win Rate: ${profitTradesMatch[2]}%`);
  }

  if (extracted.length > 0) {
    if (lines.length < 5) {
      lines.push("## Extracted Metrics");
    }
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
        variant="outline"
        size="sm"
        className="text-xs"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        title="Upload MT5 backtest report"
      >
        <FileUp className="h-3.5 w-3.5 mr-1.5" />
        Upload HTML
      </Button>
    </>
  );
}
