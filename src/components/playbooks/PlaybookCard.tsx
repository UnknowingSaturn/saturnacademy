import { useNavigate } from "react-router-dom";
import { Playbook } from "@/types/trading";
import { PlaybookStats } from "@/hooks/usePlaybookStats";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Edit, Trash2, ExternalLink, TrendingUp, TrendingDown, Target, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

interface PlaybookCardProps {
  playbook: Playbook;
  stats?: PlaybookStats;
  onEdit: (playbook: Playbook) => void;
  onDelete: (id: string) => void;
}

export function PlaybookCard({ playbook, stats, onEdit, onDelete }: PlaybookCardProps) {
  const navigate = useNavigate();
  
  const handleViewTrades = () => {
    navigate(`/journal?model=${encodeURIComponent(playbook.name)}`);
  };

  const handleCardClick = (e: React.MouseEvent) => {
    // Only navigate if not clicking on buttons
    if ((e.target as HTMLElement).closest('button')) return;
    handleViewTrades();
  };

  const winRate = stats?.winRate ?? 0;
  const totalPnl = stats?.totalPnl ?? 0;
  const isProfit = totalPnl >= 0;

  return (
    <Card 
      className={cn(
        "group relative border-border/50 hover:border-primary/50 transition-all cursor-pointer overflow-hidden",
        stats && stats.totalTrades > 0 && (isProfit ? "hover:shadow-profit/10" : "hover:shadow-destructive/10")
      )}
      onClick={handleCardClick}
    >
      {/* Win rate indicator bar at top */}
      {stats && stats.totalTrades > 0 && (
        <div className="absolute top-0 left-0 right-0 h-1">
          <div 
            className={cn(
              "h-full transition-all",
              winRate >= 50 ? "bg-profit" : "bg-destructive"
            )}
            style={{ width: `${Math.min(winRate, 100)}%` }}
          />
        </div>
      )}
      
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1 min-w-0">
            <CardTitle className="flex items-center gap-2 text-lg">
              <span className="truncate">{playbook.name}</span>
            </CardTitle>
            {playbook.description && (
              <CardDescription className="line-clamp-2">{playbook.description}</CardDescription>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => { e.stopPropagation(); onEdit(playbook); }}
            >
              <Edit className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); onDelete(playbook.id); }}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Session and Symbol Badges */}
        <div className="flex flex-wrap gap-1.5">
          {playbook.session_filter?.map((session) => (
            <Badge key={session} variant="secondary" className="text-xs">
              {session.replace(/_/g, ' ')}
            </Badge>
          ))}
          {playbook.symbol_filter?.map((symbol) => (
            <Badge key={symbol} variant="outline" className="text-xs">
              {symbol}
            </Badge>
          ))}
        </div>

        {/* Stats Grid */}
        {stats && stats.totalTrades > 0 ? (
          <div className="grid grid-cols-3 gap-3 p-3 rounded-lg bg-muted/50">
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-0.5">Trades</div>
              <div className="font-semibold text-foreground">{stats.totalTrades}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-0.5">Win Rate</div>
              <div className={cn(
                "font-semibold",
                winRate >= 50 ? "text-profit" : "text-destructive"
              )}>
                {winRate.toFixed(0)}%
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-0.5">P&L</div>
              <div className={cn(
                "font-semibold flex items-center justify-center gap-0.5",
                isProfit ? "text-profit" : "text-destructive"
              )}>
                {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                ${Math.abs(totalPnl).toFixed(0)}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-lg bg-muted/30 text-center text-sm text-muted-foreground">
            <BarChart3 className="w-5 h-5 mx-auto mb-1 opacity-40" />
            No trades yet
          </div>
        )}

        {/* Quick Stats Row */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            {stats && stats.avgR !== 0 && (
              <span>
                Avg R: <span className={cn(
                  "font-medium",
                  stats.avgR >= 0 ? "text-profit" : "text-destructive"
                )}>{stats.avgR.toFixed(2)}</span>
              </span>
            )}
            {stats && stats.profitFactor > 0 && stats.profitFactor !== Infinity && (
              <span>
                PF: <span className="font-medium text-foreground">{stats.profitFactor.toFixed(2)}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-primary opacity-0 group-hover:opacity-100 transition-opacity">
            <span>View Trades</span>
            <ExternalLink className="w-3 h-3" />
          </div>
        </div>

        {/* Checklist Questions Count */}
        {playbook.checklist_questions.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Target className="w-3.5 h-3.5" />
            <span>{playbook.checklist_questions.length} checklist items</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
