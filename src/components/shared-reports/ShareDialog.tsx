import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Copy, Check, Globe, Lock } from "lucide-react";
import { useUpdateSharedReport } from "@/hooks/useSharedReports";
import type { SharedReport } from "@/types/sharedReports";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  report: SharedReport;
}

export function ShareDialog({ open, onOpenChange, report }: Props) {
  const update = useUpdateSharedReport();
  const [copied, setCopied] = useState(false);
  const isPublic = report.visibility === "public_link";
  const isPublished = !!report.published_at;
  const url = `${window.location.origin}/r/${report.slug}`;

  const handleVisibilityToggle = (checked: boolean) => {
    update.mutate({ id: report.id, patch: { visibility: checked ? "public_link" : "private" } });
  };

  const handlePublish = () => {
    update.mutate({
      id: report.id,
      patch: { published_at: isPublished ? null : new Date().toISOString() },
    });
  };

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share report</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="flex items-start justify-between gap-4 p-3 rounded-md border border-border bg-muted/30">
            <div className="flex items-start gap-3">
              {isPublic ? <Globe className="w-4 h-4 mt-0.5 text-primary" /> : <Lock className="w-4 h-4 mt-0.5 text-muted-foreground" />}
              <div>
                <div className="text-sm font-medium">{isPublic ? "Public link" : "Private"}</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isPublic
                    ? "Anyone with the link can view this report."
                    : "Only you can view this report when signed in."}
                </p>
              </div>
            </div>
            <Switch checked={isPublic} onCheckedChange={handleVisibilityToggle} disabled={update.isPending} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="share-url">Share URL</Label>
            <div className="flex gap-2">
              <Input id="share-url" value={url} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={copy}>
                {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            {!isPublished && (
              <p className="text-xs text-warning">This report is a draft. Publish it to share publicly.</p>
            )}
            {isPublished && isPublic && (
              <p className="text-xs text-muted-foreground">
                {report.view_count} {report.view_count === 1 ? "view" : "views"}
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={handlePublish} disabled={update.isPending}>
            {isPublished ? "Unpublish" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
