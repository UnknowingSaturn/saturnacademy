CREATE UNIQUE INDEX IF NOT EXISTS accounts_user_install_login_uniq
  ON public.accounts (user_id, mt5_install_id, account_number)
  WHERE mt5_install_id IS NOT NULL AND account_number IS NOT NULL;