import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
};

interface CopierReceiverConfig {
  receiver_id: string;
  account_name: string;
  broker: string | null;
  terminal_id: string | null;
  risk: {
    mode: string;
    value: number;
  };
  safety: {
    max_slippage_pips: number;
    max_daily_loss_r: number;
    allowed_sessions: string[];
    manual_confirm_mode: boolean;
    prop_firm_safe_mode: boolean;
    poll_interval_ms: number;
  };
  symbol_mappings: Record<string, string>;
}

interface CopierConfigFile {
  version: number;
  generated_at: string;
  config_hash: string;
  master: {
    account_id: string;
    account_name: string;
    broker: string | null;
    terminal_id: string | null;
  };
  receivers: CopierReceiverConfig[];
}

function generateConfigHash(config: Omit<CopierConfigFile, 'config_hash'>): string {
  const content = JSON.stringify({
    master: config.master,
    receivers: config.receivers,
  });
  
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Get API key from header or query param
    const apiKey = req.headers.get('x-api-key') || new URL(req.url).searchParams.get('api_key');
    
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'API key required. Provide via x-api-key header or api_key query param.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find account by API key to get user_id
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('id, user_id, name, broker, terminal_id, copier_role, master_account_id')
      .eq('api_key', apiKey)
      .single();

    if (accountError || !account) {
      console.error('Account lookup error:', accountError);
      return new Response(
        JSON.stringify({ error: 'Invalid API key or account not found.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = account.user_id;
    
    // Determine if this is a receiver requesting config or a general config request
    const isReceiver = account.copier_role === 'receiver';
    const receiverAccountId = isReceiver ? account.id : null;

    // Find the master account for this user
    const { data: masterAccount, error: masterError } = await supabase
      .from('accounts')
      .select('id, name, broker, terminal_id')
      .eq('user_id', userId)
      .eq('copier_role', 'master')
      .eq('copier_enabled', true)
      .single();

    if (masterError || !masterAccount) {
      return new Response(
        JSON.stringify({ error: 'No active master account found for this user.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get all receiver accounts (or just this one if receiver is requesting)
    let receiverQuery = supabase
      .from('accounts')
      .select('id, name, broker, terminal_id, master_account_id')
      .eq('user_id', userId)
      .eq('copier_role', 'receiver')
      .eq('copier_enabled', true)
      .eq('master_account_id', masterAccount.id);

    if (receiverAccountId) {
      receiverQuery = receiverQuery.eq('id', receiverAccountId);
    }

    const { data: receiverAccounts, error: receiversError } = await receiverQuery;

    if (receiversError) {
      console.error('Receivers lookup error:', receiversError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch receiver accounts.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get symbol mappings for this master
    const { data: symbolMappings, error: mappingsError } = await supabase
      .from('copier_symbol_mappings')
      .select('*')
      .eq('user_id', userId)
      .eq('master_account_id', masterAccount.id)
      .eq('is_enabled', true);

    if (mappingsError) {
      console.error('Symbol mappings error:', mappingsError);
    }

    // Get receiver settings
    const receiverIds = receiverAccounts?.map(r => r.id) || [];
    const { data: receiverSettings, error: settingsError } = await supabase
      .from('copier_receiver_settings')
      .select('*')
      .eq('user_id', userId)
      .in('receiver_account_id', receiverIds);

    if (settingsError) {
      console.error('Receiver settings error:', settingsError);
    }

    // Get latest config version
    const { data: latestVersion } = await supabase
      .from('copier_config_versions')
      .select('version')
      .eq('user_id', userId)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    const version = latestVersion?.version || 1;

    // Build receiver configs
    const receivers: CopierReceiverConfig[] = (receiverAccounts || []).map(receiver => {
      const settings = receiverSettings?.find(s => s.receiver_account_id === receiver.id);
      const mappings = (symbolMappings || [])
        .filter(m => m.receiver_account_id === receiver.id)
        .reduce((acc, m) => {
          acc[m.master_symbol] = m.receiver_symbol;
          return acc;
        }, {} as Record<string, string>);

      const allowedSessions = settings?.allowed_sessions 
        ? (Array.isArray(settings.allowed_sessions) ? settings.allowed_sessions : [])
        : ['london', 'new_york', 'tokyo'];

      return {
        receiver_id: receiver.id,
        account_name: receiver.name,
        broker: receiver.broker,
        terminal_id: receiver.terminal_id,
        risk: {
          mode: settings?.risk_mode || 'balance_multiplier',
          value: settings?.risk_value || 1.0,
        },
        safety: {
          max_slippage_pips: settings?.max_slippage_pips || 3.0,
          max_daily_loss_r: settings?.max_daily_loss_r || 3.0,
          allowed_sessions: allowedSessions as string[],
          manual_confirm_mode: settings?.manual_confirm_mode || false,
          prop_firm_safe_mode: settings?.prop_firm_safe_mode || false,
          poll_interval_ms: settings?.poll_interval_ms || 100,
        },
        symbol_mappings: mappings,
      };
    });

    // Build config object
    const configWithoutHash: Omit<CopierConfigFile, 'config_hash'> = {
      version,
      generated_at: new Date().toISOString(),
      master: {
        account_id: masterAccount.id,
        account_name: masterAccount.name,
        broker: masterAccount.broker,
        terminal_id: masterAccount.terminal_id,
      },
      receivers,
    };

    const config: CopierConfigFile = {
      ...configWithoutHash,
      config_hash: generateConfigHash(configWithoutHash),
    };

    console.log(`Generated config for user ${userId}, version ${version}, ${receivers.length} receivers`);

    return new Response(
      JSON.stringify(config),
      { 
        status: 200, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'X-Config-Version': version.toString(),
          'X-Config-Hash': config.config_hash,
        } 
      }
    );

  } catch (error) {
    console.error('Copier config error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
