import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Play, Pause, SkipBack, SkipForward, RotateCcw, Target, RefreshCw } from "lucide-react";

interface ReplayControlsProps {
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onReplay: () => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onJumpToEntry: () => void;
  onReset: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
}

export function ReplayControls({
  isPlaying,
  onPlay,
  onPause,
  onReplay,
  onStepForward,
  onStepBackward,
  onJumpToEntry,
  onReset,
  speed,
  onSpeedChange,
}: ReplayControlsProps) {
  const speeds = [0.5, 1, 2, 5];

  return (
    <div className="flex items-center gap-1">
      {/* Step backward */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onStepBackward}
        title="Step backward"
      >
        <SkipBack className="h-3.5 w-3.5" />
      </Button>

      {/* Play/Pause */}
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7", isPlaying && "text-primary")}
        onClick={isPlaying ? onPause : onPlay}
        title={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>

      {/* Step forward */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onStepForward}
        title="Step forward"
      >
        <SkipForward className="h-3.5 w-3.5" />
      </Button>

      <div className="w-px h-4 bg-border mx-1" />

      {/* Speed selector */}
      <div className="flex items-center gap-0.5">
        {speeds.map((s) => (
          <button
            key={s}
            onClick={() => onSpeedChange(s)}
            className={cn(
              "px-1.5 py-0.5 text-xs rounded transition-colors",
              speed === s ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"
            )}
          >
            {s}x
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-border mx-1" />

      {/* Jump to entry */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onJumpToEntry}
        title="Jump to entry"
      >
        <Target className="h-3.5 w-3.5" />
      </Button>

      {/* Replay from start */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onReplay}
        title="Replay from start"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>

      {/* Reset */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onReset}
        title="Reset to full chart"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
