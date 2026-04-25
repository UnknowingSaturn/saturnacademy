export interface SharedReport {
  id: string;
  user_id: string;
  slug: string;
  title: string;
  intro: string | null;
  visibility: 'public_link' | 'private';
  period_start: string | null;
  period_end: string | null;
  author_display_name: string | null;
  view_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SharedReportTrade {
  id: string;
  shared_report_id: string;
  trade_id: string;
  sort_order: number;
  caption_what_went_well: string | null;
  caption_what_went_wrong: string | null;
  caption_what_to_improve: string | null;
  screenshot_overrides: Array<{ id: string; description?: string }>;
  created_at: string;
  updated_at: string;
}

export interface PublicTradeCard {
  id: string;
  symbol: string;
  direction: string;
  entry_time: string;
  session: string | null;
  playbook_name: string | null;
  screenshots: Array<{ url: string; timeframe: string; description: string | null }>;
  caption_what_went_well: string | null;
  caption_what_went_wrong: string | null;
  caption_what_to_improve: string | null;
}

export interface PublicReportPayload {
  report: {
    id: string;
    slug: string;
    title: string;
    intro: string | null;
    period_start: string | null;
    period_end: string | null;
    author_display_name: string | null;
    published_at: string | null;
    view_count: number;
  };
  trades: PublicTradeCard[];
  is_owner: boolean;
}
