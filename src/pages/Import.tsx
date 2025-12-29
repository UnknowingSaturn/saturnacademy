import { useState, useCallback } from "react";
import { useCreateTrade } from "@/hooks/useTrades";
import { Trade, SessionType, TradeDirection } from "@/types/trading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileSpreadsheet, ArrowRight, Loader2, Check, AlertCircle } from "lucide-react";
import { format, parse } from "date-fns";

interface CSVRow {
  [key: string]: string;
}

interface ColumnMapping {
  csvColumn: string;
  dbField: string;
}

const dbFields = [
  { value: "skip", label: "Skip this column" },
  { value: "symbol", label: "Symbol (e.g., EURUSD)" },
  { value: "direction", label: "Direction (buy/sell)" },
  { value: "entry_time", label: "Entry Date/Time" },
  { value: "exit_time", label: "Exit Date/Time" },
  { value: "entry_price", label: "Entry Price" },
  { value: "exit_price", label: "Exit Price" },
  { value: "total_lots", label: "Lot Size" },
  { value: "sl_initial", label: "Stop Loss" },
  { value: "tp_initial", label: "Take Profit" },
  { value: "net_pnl", label: "P&L" },
  { value: "r_multiple_actual", label: "RR (Risk-Reward)" },
  { value: "session", label: "Session" },
];

function detectSession(dateStr: string): SessionType {
  try {
    const date = new Date(dateStr);
    // Convert UTC to EST (UTC-5)
    const estHour = (date.getUTCHours() - 5 + 24) % 24;
    const estMinutes = date.getUTCMinutes();
    const estTime = estHour + estMinutes / 60;
    
    // Tokyo: 20:00 - 00:00 EST
    if (estTime >= 20 || estTime < 0) return "tokyo";
    // London: 02:00 - 05:00 EST
    if (estTime >= 2 && estTime < 5) return "london";
    // New York AM: 08:30 - 11:00 EST
    if (estTime >= 8.5 && estTime < 11) return "new_york_am";
    // New York PM: 13:00 - 16:00 EST
    if (estTime >= 13 && estTime < 16) return "new_york_pm";
    
    return "off_hours";
  } catch {
    return "off_hours";
  }
}

function parseDirection(value: string): TradeDirection {
  const lower = value.toLowerCase().trim();
  if (lower === "buy" || lower === "long" || lower === "b") return "buy";
  return "sell";
}

function parseSession(value: string): SessionType | null {
  const lower = value.toLowerCase().trim();
  if (lower.includes("tokyo") || lower.includes("asia")) return "tokyo";
  if (lower.includes("london") || lower.includes("ldn")) return "london";
  if (lower.includes("ny am") || lower.includes("new york am")) return "new_york_am";
  if (lower.includes("ny pm") || lower.includes("new york pm")) return "new_york_pm";
  if (lower.includes("new york") || lower.includes("ny") || lower.includes("us")) return "new_york_am";
  return null;
}

export default function Import() {
  const [step, setStep] = useState<"upload" | "mapping" | "preview" | "importing">("upload");
  const [csvData, setCsvData] = useState<CSVRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const { toast } = useToast();
  const createTrade = useCreateTrade();

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n").filter(line => line.trim());
      
      if (lines.length < 2) {
        toast({ title: "Invalid CSV", description: "File must have at least a header row and one data row", variant: "destructive" });
        return;
      }

      // Parse headers
      const headerLine = lines[0];
      const parsedHeaders = headerLine.split(",").map(h => h.trim().replace(/"/g, ""));
      setHeaders(parsedHeaders);

      // Auto-detect mappings
      const autoMappings: ColumnMapping[] = parsedHeaders.map(header => {
        const lower = header.toLowerCase();
        let dbField = "skip";
        
        if (lower.includes("pair") || lower.includes("symbol") || lower.includes("instrument")) dbField = "symbol";
        else if (lower.includes("direction") || lower.includes("side") || lower.includes("type")) dbField = "direction";
        else if (lower.includes("entry") && lower.includes("time")) dbField = "entry_time";
        else if (lower.includes("exit") && lower.includes("time")) dbField = "exit_time";
        else if (lower.includes("entry") && lower.includes("price")) dbField = "entry_price";
        else if (lower.includes("exit") && lower.includes("price")) dbField = "exit_price";
        else if (lower.includes("lot") || lower.includes("size") || lower.includes("volume")) dbField = "total_lots";
        else if (lower.includes("sl") || lower.includes("stop")) dbField = "sl_initial";
        else if (lower.includes("tp") || lower.includes("take profit") || lower.includes("target")) dbField = "tp_initial";
        else if (lower.includes("pnl") || lower.includes("profit") || lower.includes("p&l") || lower.includes("result")) dbField = "net_pnl";
        else if (lower.includes("r/r") || lower.includes("rr") || lower.includes("r:r") || lower.includes("r-multiple")) dbField = "r_multiple_actual";
        else if (lower.includes("session")) dbField = "session";
        else if (lower === "date" || lower === "time" || lower === "datetime") dbField = "entry_time";
        
        return { csvColumn: header, dbField };
      });
      setMappings(autoMappings);

      // Parse data rows
      const dataRows: CSVRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(",").map(v => v.trim().replace(/"/g, ""));
        const row: CSVRow = {};
        parsedHeaders.forEach((header, idx) => {
          row[header] = values[idx] || "";
        });
        dataRows.push(row);
      }
      setCsvData(dataRows);
      setStep("mapping");
    };
    reader.readAsText(file);
  }, [toast]);

  const updateMapping = (csvColumn: string, dbField: string) => {
    setMappings(prev => prev.map(m => 
      m.csvColumn === csvColumn ? { ...m, dbField } : m
    ));
  };

  const transformRow = (row: CSVRow): Partial<Trade> | null => {
    const trade: Partial<Trade> = {};
    
    mappings.forEach(({ csvColumn, dbField }) => {
      if (dbField === "skip") return;
      const value = row[csvColumn];
      if (!value) return;

      switch (dbField) {
        case "symbol":
          trade.symbol = value.toUpperCase().replace(/[^A-Z]/g, "");
          break;
        case "direction":
          trade.direction = parseDirection(value);
          break;
        case "entry_time":
          try {
            trade.entry_time = new Date(value).toISOString();
          } catch {
            trade.entry_time = new Date().toISOString();
          }
          break;
        case "exit_time":
          try {
            trade.exit_time = new Date(value).toISOString();
          } catch {}
          break;
        case "entry_price":
          trade.entry_price = parseFloat(value.replace(/[^0-9.-]/g, "")) || 0;
          break;
        case "exit_price":
          trade.exit_price = parseFloat(value.replace(/[^0-9.-]/g, "")) || undefined;
          break;
        case "total_lots":
          trade.total_lots = parseFloat(value.replace(/[^0-9.-]/g, "")) || 0.01;
          break;
        case "sl_initial":
          trade.sl_initial = parseFloat(value.replace(/[^0-9.-]/g, "")) || undefined;
          break;
        case "tp_initial":
          trade.tp_initial = parseFloat(value.replace(/[^0-9.-]/g, "")) || undefined;
          break;
        case "net_pnl":
          const pnlMatch = value.match(/-?[\d.]+/);
          trade.net_pnl = pnlMatch ? parseFloat(pnlMatch[0]) : undefined;
          break;
        case "r_multiple_actual":
          const rMatch = value.match(/-?[\d.]+/);
          trade.r_multiple_actual = rMatch ? parseFloat(rMatch[0]) : undefined;
          break;
        case "session":
          trade.session = parseSession(value) || undefined;
          break;
      }
    });

    // Validate required fields
    if (!trade.symbol || !trade.direction || !trade.entry_time) {
      return null;
    }

    // Set defaults
    if (!trade.total_lots) trade.total_lots = 0.01;
    if (!trade.entry_price) trade.entry_price = 0;
    
    // Auto-detect session from entry time if not mapped
    if (!trade.session && trade.entry_time) {
      trade.session = detectSession(trade.entry_time);
    }

    // Determine if trade is open or closed
    trade.is_open = !trade.exit_time && !trade.exit_price;

    return trade;
  };

  const handleImport = async () => {
    setStep("importing");
    setImportProgress(0);

    let imported = 0;
    let failed = 0;

    for (let i = 0; i < csvData.length; i++) {
      const trade = transformRow(csvData[i]);
      
      if (trade && trade.symbol && trade.direction && trade.entry_time && trade.total_lots !== undefined && trade.entry_price !== undefined) {
        try {
          await createTrade.mutateAsync({
            symbol: trade.symbol,
            direction: trade.direction,
            total_lots: trade.total_lots,
            entry_price: trade.entry_price,
            entry_time: trade.entry_time,
            exit_price: trade.exit_price,
            exit_time: trade.exit_time,
            sl_initial: trade.sl_initial,
            tp_initial: trade.tp_initial,
            net_pnl: trade.net_pnl,
            r_multiple_actual: trade.r_multiple_actual,
            session: trade.session,
            is_open: trade.is_open,
          });
          imported++;
        } catch (err) {
          failed++;
          console.error("Failed to import trade:", err);
        }
      } else {
        failed++;
      }

      setImportProgress(((i + 1) / csvData.length) * 100);
    }

    toast({
      title: "Import complete",
      description: `${imported} trades imported, ${failed} failed`,
    });

    setStep("upload");
    setCsvData([]);
    setHeaders([]);
    setMappings([]);
  };

  const previewTrades = csvData.slice(0, 5).map(row => transformRow(row)).filter(Boolean);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Import Trades</h1>
        <p className="text-muted-foreground">Import your historical trades from a CSV file</p>
      </div>

      <Tabs value={step} className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="upload" disabled={step !== "upload"}>
            1. Upload
          </TabsTrigger>
          <TabsTrigger value="mapping" disabled={step === "upload"}>
            2. Map Columns
          </TabsTrigger>
          <TabsTrigger value="preview" disabled={step === "upload" || step === "mapping"}>
            3. Import
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload">
          <Card>
            <CardHeader>
              <CardTitle>Upload CSV File</CardTitle>
              <CardDescription>
                Upload a CSV file with your trade history. The file should have column headers.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border-2 border-dashed border-border rounded-lg p-12 text-center">
                <FileSpreadsheet className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground mb-4">
                  Drag and drop your CSV file here, or click to browse
                </p>
                <Label htmlFor="csv-upload" className="cursor-pointer">
                  <Input
                    id="csv-upload"
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <Button asChild>
                    <span>
                      <Upload className="w-4 h-4 mr-2" />
                      Select File
                    </span>
                  </Button>
                </Label>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mapping">
          <Card>
            <CardHeader>
              <CardTitle>Map Columns</CardTitle>
              <CardDescription>
                Match your CSV columns to trade fields. We've auto-detected some mappings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                {mappings.map((mapping) => (
                  <div key={mapping.csvColumn} className="flex items-center gap-3">
                    <div className="flex-1 p-2 bg-muted rounded text-sm font-medium truncate">
                      {mapping.csvColumn}
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    <Select
                      value={mapping.dbField}
                      onValueChange={(v) => updateMapping(mapping.csvColumn, v)}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {dbFields.map((field) => (
                          <SelectItem key={field.value} value={field.value}>
                            {field.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button variant="outline" onClick={() => setStep("upload")}>
                  Back
                </Button>
                <Button onClick={() => setStep("preview")}>
                  Continue to Preview
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preview">
          <Card>
            <CardHeader>
              <CardTitle>Preview & Import</CardTitle>
              <CardDescription>
                Review how your trades will be imported. Showing first 5 of {csvData.length} trades.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border rounded-lg overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Direction</TableHead>
                      <TableHead>Entry</TableHead>
                      <TableHead>Exit</TableHead>
                      <TableHead>Lots</TableHead>
                      <TableHead>P&L</TableHead>
                      <TableHead>Session</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewTrades.map((trade, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{trade?.symbol}</TableCell>
                        <TableCell className={trade?.direction === "buy" ? "text-profit" : "text-loss"}>
                          {trade?.direction?.toUpperCase()}
                        </TableCell>
                        <TableCell className="font-mono-numbers text-sm">
                          {trade?.entry_time ? format(new Date(trade.entry_time), "MMM d, HH:mm") : "—"}
                        </TableCell>
                        <TableCell className="font-mono-numbers text-sm">
                          {trade?.exit_time ? format(new Date(trade.exit_time), "MMM d, HH:mm") : "—"}
                        </TableCell>
                        <TableCell className="font-mono-numbers">{trade?.total_lots}</TableCell>
                        <TableCell className={`font-mono-numbers ${(trade?.net_pnl || 0) >= 0 ? "text-profit" : "text-loss"}`}>
                          {trade?.net_pnl ? `$${trade.net_pnl.toFixed(2)}` : "—"}
                        </TableCell>
                        <TableCell className="capitalize">{trade?.session?.replace("_", " ")}</TableCell>
                        <TableCell>
                          <Check className="w-4 h-4 text-profit" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-between items-center pt-4">
                <Button variant="outline" onClick={() => setStep("mapping")}>
                  Back
                </Button>
                <Button onClick={handleImport} className="gap-2">
                  <Upload className="w-4 h-4" />
                  Import {csvData.length} Trades
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="importing">
          <Card>
            <CardContent className="py-12 text-center">
              <Loader2 className="w-12 h-12 mx-auto animate-spin text-primary mb-4" />
              <p className="text-lg font-medium">Importing trades...</p>
              <p className="text-muted-foreground">{Math.round(importProgress)}% complete</p>
              <div className="w-full max-w-xs mx-auto mt-4 h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}