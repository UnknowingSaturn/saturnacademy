import { formatDistanceToNow } from 'date-fns';
import { Activity, AlertTriangle, CircleSlash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  useMt5Installs,
  useSetInstallStatus,
  installHealth,
  type Mt5Install,
} from '@/hooks/useMt5Installs';

const TONE: Record<string, string> = {
  live: 'border-primary/40 bg-primary/10 text-primary',
  quiet: 'border-destructive/30 bg-destructive/5 text-destructive',
  revoked: 'border-destructive/50 bg-destructive/10 text-destructive',
  never: 'border-muted-foreground/30 bg-muted text-muted-foreground',
};

function seenLabel(install: Mt5Install) {
  if (!install.last_seen_at) return 'never connected';
  return `last seen ${formatDistanceToNow(new Date(install.last_seen_at), { addSuffix: true })}`;
}

/**
 * One row per MT5 installation, showing whether its feed is actually alive.
 * A rejected or silent feed used to produce no UI signal at all — this is that
 * signal.
 */
export function ConnectionHealthStrip({ compact = false }: { compact?: boolean }) {
  const { data: installs } = useMt5Installs();
  const setStatus = useSetInstallStatus();

  if (!installs || installs.length === 0) return null;

  const problems = installs.filter((i) => installHealth(i) !== 'live');
  if (compact && problems.length === 0) return null;
  const shown = compact ? problems : installs;

  return (
    <div className="space-y-2">
      {shown.map((install) => {
        const health = installHealth(install);
        const Icon = health === 'live' ? Activity : health === 'revoked' ? CircleSlash : AlertTriangle;
        return (
          <div
            key={install.id}
            className={cn(
              'flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm',
              TONE[health],
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Icon className="h-4 w-4 shrink-0" />
              <span className="font-medium truncate">{install.label || install.install_id}</span>
              <span className="opacity-80 truncate">
                {health === 'live' && `feed healthy — ${seenLabel(install)}`}
                {health === 'quiet' && `no data in a while — ${seenLabel(install)}. Is the terminal open with the EA attached?`}
                {health === 'revoked' && 'access revoked — this terminal is being rejected'}
                {health === 'never' && 'never connected — finish the MT5 setup on this machine'}
              </span>
            </div>
            {health === 'revoked' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setStatus.mutate({ id: install.id, status: 'active' })}
                disabled={setStatus.isPending}
              >
                Re-enable
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
