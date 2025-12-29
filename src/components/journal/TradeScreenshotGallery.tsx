import { useState } from "react";
import { TradeScreenshot, ChartTimeframe } from "@/types/trading";
import { AddScreenshotDialog } from "./AddScreenshotDialog";
import { useScreenshots } from "@/hooks/useScreenshots";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Trash2, Maximize2, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface TradeScreenshotGalleryProps {
  tradeId: string;
  screenshots: TradeScreenshot[];
  onScreenshotsChange: (screenshots: TradeScreenshot[]) => void;
}

const TIMEFRAME_ORDER: ChartTimeframe[] = ["M", "W", "D", "4H", "1H", "30m", "15m", "5m", "1m"];

const TIMEFRAME_COLORS: Record<ChartTimeframe, string> = {
  "M": "bg-purple-500/20 text-purple-400 border-purple-500/30",
  "W": "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  "D": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "4H": "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  "1H": "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  "30m": "bg-green-500/20 text-green-400 border-green-500/30",
  "15m": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  "5m": "bg-orange-500/20 text-orange-400 border-orange-500/30",
  "1m": "bg-red-500/20 text-red-400 border-red-500/30",
};

export function TradeScreenshotGallery({
  tradeId,
  screenshots,
  onScreenshotsChange,
}: TradeScreenshotGalleryProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [expandedImage, setExpandedImage] = useState<TradeScreenshot | null>(null);
  const { deleteScreenshot } = useScreenshots();

  // Sort screenshots by timeframe (HTF to LTF)
  const sortedScreenshots = [...screenshots].sort((a, b) => {
    return TIMEFRAME_ORDER.indexOf(a.timeframe) - TIMEFRAME_ORDER.indexOf(b.timeframe);
  });

  const handleAdd = (screenshot: TradeScreenshot) => {
    onScreenshotsChange([...screenshots, screenshot]);
  };

  const handleDelete = async (screenshot: TradeScreenshot) => {
    const success = await deleteScreenshot(screenshot.url);
    if (success) {
      onScreenshotsChange(screenshots.filter((s) => s.id !== screenshot.id));
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ImageIcon className="h-4 w-4" />
          Trade Screenshots
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsAddDialogOpen(true)}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Screenshot
        </Button>
      </div>

      {/* Gallery Grid */}
      {sortedScreenshots.length > 0 ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedScreenshots.map((screenshot) => (
            <div
              key={screenshot.id}
              className="group relative rounded-lg overflow-hidden border border-border bg-card/50"
            >
              {/* Timeframe Badge */}
              <Badge
                variant="outline"
                className={cn(
                  "absolute top-2 left-2 z-10 font-mono text-xs",
                  TIMEFRAME_COLORS[screenshot.timeframe]
                )}
              >
                {screenshot.timeframe}
              </Badge>

              {/* Image */}
              <div className="aspect-video overflow-hidden bg-muted/30">
                <img
                  src={screenshot.url}
                  alt={`${screenshot.timeframe} chart`}
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                />
              </div>

              {/* Overlay with actions */}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setExpandedImage(screenshot)}
                >
                  <Maximize2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="destructive"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => handleDelete(screenshot)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {/* Description */}
              {screenshot.description && (
                <div className="p-3 border-t border-border">
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {screenshot.description}
                  </p>
                </div>
              )}
            </div>
          ))}

          {/* Add Card */}
          <div
            className={cn(
              "aspect-video rounded-lg border-2 border-dashed border-border/50 flex flex-col items-center justify-center cursor-pointer",
              "hover:border-primary/30 hover:bg-muted/20 transition-colors"
            )}
            onClick={() => setIsAddDialogOpen(true)}
          >
            <Plus className="h-8 w-8 text-muted-foreground mb-2" />
            <span className="text-sm text-muted-foreground">Add Screenshot</span>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "border-2 border-dashed border-border/50 rounded-lg p-8 text-center cursor-pointer",
            "hover:border-primary/30 hover:bg-muted/20 transition-colors"
          )}
          onClick={() => setIsAddDialogOpen(true)}
        >
          <ImageIcon className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-1">
            No screenshots yet
          </p>
          <p className="text-xs text-muted-foreground">
            Add screenshots from different timeframes to document your trade analysis
          </p>
        </div>
      )}

      {/* Add Screenshot Dialog */}
      <AddScreenshotDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        tradeId={tradeId}
        onAdd={handleAdd}
      />

      {/* Expanded Image Dialog */}
      <Dialog open={!!expandedImage} onOpenChange={() => setExpandedImage(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <Badge
                variant="outline"
                className={cn(
                  "font-mono",
                  expandedImage && TIMEFRAME_COLORS[expandedImage.timeframe]
                )}
              >
                {expandedImage?.timeframe}
              </Badge>
              Chart Screenshot
            </DialogTitle>
          </DialogHeader>
          {expandedImage && (
            <div className="space-y-4">
              <img
                src={expandedImage.url}
                alt={`${expandedImage.timeframe} chart`}
                className="w-full rounded-lg"
              />
              {expandedImage.description && (
                <p className="text-sm text-muted-foreground">
                  {expandedImage.description}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
