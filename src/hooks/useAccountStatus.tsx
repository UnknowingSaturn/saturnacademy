import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface AccountStatus {
  lastEventAt: Date | null;
  eventCount: number;
  tradeCount: number;
}

export function useAccountStatus(accountId: string | undefined) {
  return useQuery({
    queryKey: ['account-status', accountId],
    queryFn: async (): Promise<AccountStatus> => {
      if (!accountId) {
        return { lastEventAt: null, eventCount: 0, tradeCount: 0 };
      }

      // Get latest event for this account
      const { data: latestEvent } = await supabase
        .from('events')
        .select('ingested_at')
        .eq('account_id', accountId)
        .order('ingested_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Get event count (last 30 days for performance)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { count: eventCount } = await supabase
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .gte('ingested_at', thirtyDaysAgo.toISOString());

      // Get trade count for this account
      const { count: tradeCount } = await supabase
        .from('trades')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('is_archived', false);

      return {
        lastEventAt: latestEvent?.ingested_at ? new Date(latestEvent.ingested_at) : null,
        eventCount: eventCount || 0,
        tradeCount: tradeCount || 0,
      };
    },
    enabled: !!accountId,
    refetchInterval: 30000, // Refetch every 30 seconds
  });
}
