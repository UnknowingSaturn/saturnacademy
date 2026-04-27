import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, FileText, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import type { Report } from "@/types/reports";

interface Props {
  reports: Report[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onGenerateClick: () => void;
  onDelete?: (id: string) => void;
}

function gradeColorClasses(grade: string | null | undefined): string {
  if (!grade) return "bg-muted text-muted-foreground border-border";
  const letter = grade[0];
  if (letter === "A") return "bg-success/15 text-success border-success/40";
  if (letter === "B") return "bg-primary/15 text-primary border-primary/40";
  if (letter === "C") return "bg-warning/15 text-warning border-warning/40";
  return "bg-destructive/15 text-destructive border-destructive/40";
}

export function ReportSidebar({ reports, selectedId, onSelect, onGenerateClick, onDelete }: Props) {
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
    <aside className="w-80 shrink-0 border-r border-border bg-card flex flex-col">
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
              <div key={month} className="mb-4">
                <div className="px-2 py-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    {month}
                  </span>
                  <span className="text-[10px] text-muted-foreground/70 tabular-nums">
                    {items.length} {items.length === 1 ? "report" : "reports"}
                  </span>
                </div>
                {items.map(r => {
                  const active = selectedId === r.id;
                  const typeLabel =
                    r.report_type === "weekly" ? "Week of" :
                    r.report_type === "monthly" ? "Monthly" : "Custom";
                  const period = `${format(parseISO(r.period_start), "MMM d")} – ${format(parseISO(r.period_end), "MMM d")}`;
                  return (
                    <div
                      key={r.id}
                      className={`group relative mb-1 rounded-md border-l-2 transition-colors ${
                        active
                          ? "bg-accent border-l-primary"
                          : "border-l-transparent hover:bg-accent/50"
                      }`}
                    >
                      <button
                        onClick={() => onSelect(r.id)}
                        className="w-full text-left"
                      >
                        <div className="flex items-stretch gap-3 p-2.5 pr-9">
                          {/* Grade pill */}
                          <div className={`shrink-0 w-11 rounded-md border flex items-center justify-center text-base font-bold tabular-nums ${gradeColorClasses(r.grade)}`}>
                            {r.status === "failed" ? "!" : (r.grade || "—")}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-muted-foreground">
                              {typeLabel} <span className="text-foreground/80">{period}</span>
                            </div>
                            <div className="text-[13px] leading-snug mt-0.5 line-clamp-2 text-foreground/90">
                              {r.verdict || "Generating…"}
                            </div>
                          </div>
                        </div>
                      </button>
                      {onDelete && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:bg-destructive/10"
                          aria-label={`Delete report ${period}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete this ${typeLabel.toLowerCase()} report (${period})?`)) {
                              onDelete(r.id);
                            }
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}
