import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, FileText } from "lucide-react";
import { format, parseISO } from "date-fns";
import type { Report } from "@/types/reports";

interface Props {
  reports: Report[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onGenerateClick: () => void;
}

export function ReportSidebar({ reports, selectedId, onSelect, onGenerateClick }: Props) {
  const grouped = useMemo(() => {
    const byMonth = new Map<string, Report[]>();
    for (const r of reports) {
      const key = format(parseISO(r.period_start), "MMMM yyyy");
      const arr = byMonth.get(key) ?? [];
      arr.push(r);
      byMonth.set(key, arr);
    }
    return Array.from(byMonth.entries());
  }, [reports]);

  return (
    <aside className="w-72 shrink-0 border-r border-border bg-card flex flex-col">
      <div className="p-4 border-b border-border">
        <Button onClick={onGenerateClick} className="w-full" size="sm">
          <Plus className="w-4 h-4 mr-2" /> Generate report
        </Button>
      </div>
      <ScrollArea className="flex-1">
        {grouped.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
            No reports yet. Your first weekly report will arrive Saturday morning, or generate one now.
          </div>
        ) : (
          <div className="p-2">
            {grouped.map(([month, items]) => (
              <div key={month} className="mb-3">
                <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{month}</div>
                {items.map(r => (
                  <button
                    key={r.id}
                    onClick={() => onSelect(r.id)}
                    className={`w-full text-left px-2 py-2 rounded-md hover:bg-accent transition-colors ${
                      selectedId === r.id ? "bg-accent" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {r.report_type === "weekly" ? "Week of " : r.report_type === "monthly" ? "Monthly " : "Custom "}
                          {format(parseISO(r.period_start), "MMM d")}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {r.verdict?.slice(0, 50) || "No verdict"}…
                        </div>
                      </div>
                      {r.grade && <Badge variant="outline" className="shrink-0 text-xs font-bold">{r.grade}</Badge>}
                      {r.status === "failed" && <Badge variant="destructive" className="shrink-0 text-xs">!</Badge>}
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}
