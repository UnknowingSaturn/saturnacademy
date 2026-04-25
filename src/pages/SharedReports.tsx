import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useSharedReports, useCreateSharedReport, useDeleteSharedReport } from "@/hooks/useSharedReports";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Share2, Globe, Lock, Trash2, Eye, ExternalLink } from "lucide-react";
import { format, parseISO } from "date-fns";
import { format as fmt, subDays } from "date-fns";

const SharedReportsPage = React.forwardRef<HTMLDivElement, object>(function SharedReportsPage(_p, _r) {
  const navigate = useNavigate();
  const { data: reports = [], isLoading } = useSharedReports();
  const create = useCreateSharedReport();
  const del = useDeleteSharedReport();

  const handleNew = async () => {
    const today = new Date();
    const result = await create.mutateAsync({
      title: `Week of ${fmt(subDays(today, 6), "MMM d")} – ${fmt(today, "MMM d, yyyy")}`,
      period_start: fmt(subDays(today, 6), "yyyy-MM-dd"),
      period_end: fmt(today, "yyyy-MM-dd"),
    });
    navigate(`/shared-reports/${result.id}`);
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shared Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Build educational weekly recaps of your trades and share via link. Money amounts and risk are always hidden.
          </p>
        </div>
        <Button onClick={handleNew} disabled={create.isPending}>
          <Plus className="w-4 h-4 mr-1" /> New report
        </Button>
      </header>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-12 text-center">Loading…</div>
      ) : reports.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Share2 className="w-10 h-10 mx-auto text-muted-foreground mb-4" />
          <h2 className="font-serif text-xl mb-2">No shared reports yet</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            Create a weekly recap that highlights your best trades with educational captions. Perfect for sharing with your community on X, Discord, or email.
          </p>
          <Button onClick={handleNew}><Plus className="w-4 h-4 mr-1" /> Create first report</Button>
        </Card>
      ) : (
        <div className="grid gap-3">
          {reports.map(r => {
            const isPublic = r.visibility === "public_link";
            const isPublished = !!r.published_at;
            return (
              <Card key={r.id} className="p-4 hover:bg-accent/30 transition-colors group">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/shared-reports/${r.id}`)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-base">{r.title}</h3>
                      <Badge variant="outline" className="text-[10px] gap-1">
                        {isPublic && isPublished ? <><Globe className="w-2.5 h-2.5" /> Public</> :
                         isPublic ? <><Globe className="w-2.5 h-2.5" /> Draft</> :
                         <><Lock className="w-2.5 h-2.5" /> Private</>}
                      </Badge>
                      {isPublished && (
                        <Badge variant="secondary" className="text-[10px] gap-1">
                          <Eye className="w-2.5 h-2.5" /> {r.view_count}
                        </Badge>
                      )}
                    </div>
                    {r.period_start && r.period_end && (
                      <div className="text-xs text-muted-foreground mt-1 tabular-nums">
                        {format(parseISO(r.period_start), "MMM d")} – {format(parseISO(r.period_end), "MMM d, yyyy")}
                      </div>
                    )}
                    {r.intro && <p className="text-xs text-muted-foreground mt-1.5 line-clamp-1">{r.intro}</p>}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {isPublic && isPublished && (
                      <Button variant="ghost" size="icon" onClick={() => window.open(`/r/${r.slug}`, "_blank")}>
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => {
                      if (confirm(`Delete "${r.title}"?`)) del.mutate(r.id);
                    }}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default SharedReportsPage;
