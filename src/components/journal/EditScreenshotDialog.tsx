import { useEffect, useState } from "react";
import { ChartTimeframe, TradeScreenshot } from "@/types/trading";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Save } from "lucide-react";

interface EditScreenshotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  screenshot: TradeScreenshot | null;
  onSave: (updated: TradeScreenshot) => void;
}

const TIMEFRAME_OPTIONS: { value: ChartTimeframe; label: string }[] = [
  { value: "1m", label: "1 Minute" },
  { value: "5m", label: "5 Minutes" },
  { value: "15m", label: "15 Minutes" },
  { value: "30m", label: "30 Minutes" },
  { value: "1H", label: "1 Hour" },
  { value: "4H", label: "4 Hours" },
  { value: "D", label: "Daily" },
  { value: "W", label: "Weekly" },
  { value: "M", label: "Monthly" },
];

export function EditScreenshotDialog({
  open,
  onOpenChange,
  screenshot,
  onSave,
}: EditScreenshotDialogProps) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("15m");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (screenshot) {
      setTimeframe(screenshot.timeframe);
      setDescription(screenshot.description ?? "");
    }
  }, [screenshot]);

  const handleSave = () => {
    if (!screenshot) return;
    onSave({
      ...screenshot,
      timeframe,
      description: description.trim(),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Screenshot</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {screenshot && (
            <div className="rounded-lg overflow-hidden border border-border bg-muted/30">
              <img
                src={screenshot.url}
                alt="Screenshot preview"
                className="w-full max-h-64 object-contain"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Timeframe</Label>
            <Select value={timeframe} onValueChange={(v) => setTimeframe(v as ChartTimeframe)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEFRAME_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this timeframe show? (e.g., HTF bias, entry zone, structure break)"
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            <Save className="h-4 w-4 mr-2" />
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
