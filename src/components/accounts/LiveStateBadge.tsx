import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Radio, Pause, Loader2, AlertCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

type LiveState = 'live' | 'dormant' | 'verifying' | 'stale' | null | undefined;

interface Props {
  state: LiveState;
  lastHeartbeatAt?: string | null;
  accountName?: string;
}

export function LiveStateBadge({ state, lastHeartbeatAt, accountName }: Props) {
  const s = state ?? 'live';
  const map: Record<NonNullable<LiveState>, {
    label: string;
    icon: React.ReactNode;
    className: string;
    tip: string;
  }> = {
    live: {
      label: 'Live',
      icon: <Radio className="h-3 w-3 mr-1" />,
      className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
      tip: 'EA is reporting events for this account right now.',
    },
    dormant: {
      label: 'Dormant',
      icon: <Pause className="h-3 w-3 mr-1" />,
      className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
      tip: `No EA heartbeat for over 10 min — log into ${accountName ?? 'this account'} in MT5 to reconnect.`,
    },
    verifying: {
      label: 'Verifying',
      icon: <Loader2 className="h-3 w-3 mr-1 animate-spin" />,
      className: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30',
      tip: 'Server is reconciling open positions with the EA.',
    },
    stale: {
      label: 'Stale',
      icon: <AlertCircle className="h-3 w-3 mr-1" />,
      className: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
      tip: 'EA has been offline long enough that open trades may not match the broker.',
    },
  };
  const cfg = map[s];
  const subtitle = lastHeartbeatAt
    ? `Last heartbeat ${formatDistanceToNow(new Date(lastHeartbeatAt), { addSuffix: true })}.`
    : 'No heartbeat received yet.';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cfg.className}>
            {cfg.icon}
            {cfg.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="text-xs font-medium mb-1">{cfg.tip}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
