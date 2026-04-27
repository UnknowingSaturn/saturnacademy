import * as React from "react";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles } from "lucide-react";
import { ReportSidebar } from "@/components/reports/ReportSidebar";
import { ReportView } from "@/components/reports/ReportView";
import { useReportsList, useReport, useGenerateReport, useDeleteReport } from "@/hooks/useSenseiReports";
import { format, subDays } from "date-fns";

const StrategyLabPage = React.forwardRef<HTMLDivElement, object>(function ReportsPage(_props, _ref) {
  const { data: reports = [], isLoading } = useReportsList();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: selected } = useReport(selectedId);
  const generate = useGenerateReport();
  const del = useDeleteReport();
  const [genOpen, setGenOpen] = useState(false);
  const [start, setStart] = useState(format(subDays(new Date(), 7), "yyyy-MM-dd"));
  const [end, setEnd] = useState(format(new Date(), "yyyy-MM-dd"));

  const handleDelete = async (id: string) => {
    await del.mutateAsync(id);
    if (selectedId === id) setSelectedId(null);
  };

  useEffect(() => {
    if (!selectedId && reports.length > 0) setSelectedId(reports[0].id);
  }, [reports, selectedId]);

  const handleGenerate = async () => {
    const result = await generate.mutateAsync({
      period_start: new Date(start).toISOString(),
      period_end: new Date(end + "T23:59:59").toISOString(),
      report_type: "custom",
    });
    setGenOpen(false);
    setSelectedId(result.id);
  };

  return (
    <div className="flex h-full overflow-hidden">
      <ReportSidebar
        reports={reports}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onGenerateClick={() => setGenOpen(true)}
        onDelete={handleDelete}
      />
      <main className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
        ) : selected ? (
          <ReportView report={selected} />
        ) : reports.length === 0 ? (
          <div className="h-full flex items-center justify-center px-6">
            <div className="max-w-lg text-center border-l-4 border-primary pl-8 py-6">
              <p className="font-serif italic text-2xl leading-snug text-foreground mb-3">
                "Reviewing tape is what separates pros from gamblers."
              </p>
              <p className="text-sm text-muted-foreground mb-6">
                Every Saturday morning a weekly report will be waiting here, with a monthly recap on the 1st. Generate one now from any custom range to try it out.
              </p>
              <Button onClick={() => setGenOpen(true)}><Sparkles className="w-4 h-4 mr-2" /> Generate your first report</Button>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">Select a report</div>
        )}
      </main>

      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate report</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="start">Period start</Label>
              <Input id="start" type="date" value={start} onChange={e => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end">Period end</Label>
              <Input id="end" type="date" value={end} onChange={e => setEnd(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Generation takes 15-45s while we crunch your trades and consult your sensei.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenOpen(false)} disabled={generate.isPending}>Cancel</Button>
            <Button onClick={handleGenerate} disabled={generate.isPending}>
              {generate.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

export default StrategyLabPage;
