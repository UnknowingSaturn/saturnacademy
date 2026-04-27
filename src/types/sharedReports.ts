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

/**
 * Per-screenshot override.
 * - `id` matches the source TradeScreenshot.id.
 * - When `hidden` is true, the screenshot is omitted from the public card.
 * - `sort_index` controls the order screenshots appear in (lower first).
 *   Screenshots without a sort_index keep their original order, after any with one.
 */
export interface ScreenshotOverride {
  id: string;
  description?: string | null;
  timeframe?: string | null;
  hidden?: boolean;
  sort_index?: number;
}

export interface SharedReportTrade {
  id: string;
  shared_report_id: string;
  trade_id: string;
  sort_order: number;
  caption_what_went_well: string | null;
  caption_what_went_wrong: string | null;
  caption_what_to_improve: string | null;
  /**
   * Header / display overrides — when present, public payload uses these
   * instead of the live trade values. All optional.
   */
  symbol_override?: string | null;
  direction_override?: string | null;
  entry_time_override?: string | null;
  session_override?: string | null;
  playbook_name_override?: string | null;
  screenshot_overrides: ScreenshotOverride[];
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
