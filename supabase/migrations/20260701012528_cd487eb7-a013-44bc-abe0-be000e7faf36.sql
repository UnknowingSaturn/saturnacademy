revoke execute on function public.match_user_trades(vector, integer) from public;
revoke execute on function public.enqueue_trade_embed(uuid, uuid) from public;
revoke execute on function public.trg_enqueue_trade_embed() from public;
grant execute on function public.enqueue_trade_embed(uuid, uuid) to service_role;