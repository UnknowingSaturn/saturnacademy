import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with user's token to verify auth
    const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const { account_id } = await req.json();
    if (!account_id) {
      return new Response(
        JSON.stringify({ error: 'account_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create admin client with service role to bypass RLS
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the account belongs to the user
    const { data: account, error: accountError } = await supabaseAdmin
      .from('accounts')
      .select('id, user_id')
      .eq('id', account_id)
      .single();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: 'Account not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (account.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'Account does not belong to user' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Fresh start for account: ${account_id}, user: ${user.id}`);

    // Delete trade_reviews first (they reference trades)
    const { data: trades } = await supabaseAdmin
      .from('trades')
      .select('id')
      .eq('account_id', account_id);

    const tradeIds = trades?.map(t => t.id) || [];
    let reviewsDeleted = 0;
    let aiReviewsDeleted = 0;
    let featuresDeleted = 0;

    if (tradeIds.length > 0) {
      // Delete trade_reviews
      const { count: reviewCount } = await supabaseAdmin
        .from('trade_reviews')
        .delete({ count: 'exact' })
        .in('trade_id', tradeIds);
      reviewsDeleted = reviewCount || 0;

      // Delete ai_reviews
      const { count: aiCount } = await supabaseAdmin
        .from('ai_reviews')
        .delete({ count: 'exact' })
        .in('trade_id', tradeIds);
      aiReviewsDeleted = aiCount || 0;

      // Delete trade_features
      const { count: featuresCount } = await supabaseAdmin
        .from('trade_features')
        .delete({ count: 'exact' })
        .in('trade_id', tradeIds);
      featuresDeleted = featuresCount || 0;
    }

    // Delete trades for this account
    const { count: tradesDeleted, error: tradesError } = await supabaseAdmin
      .from('trades')
      .delete({ count: 'exact' })
      .eq('account_id', account_id);

    if (tradesError) {
      console.error('Error deleting trades:', tradesError);
      throw tradesError;
    }

    // Delete events for this account (requires service role)
    const { count: eventsDeleted, error: eventsError } = await supabaseAdmin
      .from('events')
      .delete({ count: 'exact' })
      .eq('account_id', account_id);

    if (eventsError) {
      console.error('Error deleting events:', eventsError);
      throw eventsError;
    }

    console.log(`Fresh start complete: ${tradesDeleted} trades, ${eventsDeleted} events, ${reviewsDeleted} reviews, ${aiReviewsDeleted} AI reviews, ${featuresDeleted} features deleted`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Fresh start complete. Deleted ${tradesDeleted || 0} trades and ${eventsDeleted || 0} events.`,
        trades_deleted: tradesDeleted || 0,
        events_deleted: eventsDeleted || 0,
        reviews_deleted: reviewsDeleted,
        ai_reviews_deleted: aiReviewsDeleted,
        features_deleted: featuresDeleted,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Fresh start error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
