import * as React from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSharedReports, useCreateSharedReport, useDeleteSharedReport } from "@/hooks/useSharedReports";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ChevronDown, Plus, Share2, Globe, Lock, Trash2, Eye, ExternalLink, Calendar, CalendarRange, CalendarDays } from "lucide-react";
import { format, parseISO, subDays } from "date-fns";

const SharedReportsPage = React.forwardRef<HTMLDivElement, object>(function SharedReportsPage(_p, _r) {
  const navigate = useNavigate();
  const { data: reports = [], isLoading } = useSharedReports();
  const create = useCreateSharedReport();
  const del = useDeleteSharedReport();

  const [customOpen, setCustomOpen] = useState(false);
  const [customStart, setCustomStart] = useState(format(subDays(new Date(), 6), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState(format(new Date(), "yyyy-MM-dd"));
  const [customTitle, setCustomTitle] = useState("");

  const createDaily = async () => {
    const today = new Date();
    const result = await create.mutateAsync({
      title: format(today, "EEEE, MMM d, yyyy"),
      period_start: format(today, "yyyy-MM-dd"),
      period_end: format(today, "yyyy-MM-dd"),
    });
    navigate(`/shared-reports/${result.id}`);
  };

  const createWeekly = async () => {
    const today = new Date();
    const result = await create.mutateAsync({
      title: `Week of ${format(subDays(today, 6), "MMM d")} – ${format(today, "MMM d, yyyy")}`,
      period_start: format(subDays(today, 6), "yyyy-MM-dd"),
      period_end: format(today, "yyyy-MM-dd"),
    });
    navigate(`/shared-reports/${result.id}`);
  };

  const createCustom = async () => {
    if (!customStart || !customEnd) return;
    const start = parseISO(customStart);
    const end = parseISO(customEnd);
    const fallbackTitle =
      customStart === customEnd
        ? format(start, "EEEE, MMM d, yyyy")
        : `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
    const result = await create.mutateAsync({
      title: customTitle.trim() || fallbackTitle,
      period_start: customStart,
      period_end: customEnd,
    });
    setCustomOpen(false);
    setCustomTitle("");
    navigate(`/shared-reports/${result.id}`);
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shared Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Build educational daily, weekly, or custom recaps of your trades and share via link. Money amounts and risk are always hidden.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button disabled={create.isPending}>
              <Plus className="w-4 h-4 mr-1" /> New report <ChevronDown className="w-3.5 h-3.5 ml-1.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={createDaily}>
              <CalendarDays className="w-4 h-4 mr-2" /> Daily (today)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={createWeekly}>
              <Calendar className="w-4 h-4 mr-2" /> Weekly (last 7 days)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setCustomOpen(true)}>
              <CalendarRange className="w-4 h-4 mr-2" /> Custom range…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-12 text-center">Loading…</div>
      ) : reports.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Share2 className="w-10 h-10 mx-auto text-muted-foreground mb-4" />
          <h2 className="font-serif text-xl mb-2">No shared reports yet</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            Create a daily debrief or weekly recap with educational captions. Perfect for sharing with your community on X, Discord, or email.
          </p>
          <Button onClick={createWeekly}><Plus className="w-4 h-4 mr-1" /> Create first report</Button>
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
                        {r.period_start === r.period_end
                          ? format(parseISO(r.period_start), "EEE, MMM d, yyyy")
                          : `${format(parseISO(r.period_start), "MMM d")} – ${format(parseISO(r.period_end), "MMM d, yyyy")}`}
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

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Custom range report</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="custom-title">Title (optional)</Label>
              <Input
                id="custom-title"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="Leave blank to auto-generate"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="custom-start">From</Label>
                <Input id="custom-start" type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="custom-end">To</Label>
                <Input id="custom-end" type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomOpen(false)} disabled={create.isPending}>Cancel</Button>
            <Button onClick={createCustom} disabled={create.isPending || !customStart || !customEnd}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

export default SharedReportsPage;
