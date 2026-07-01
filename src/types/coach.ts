export type CoachRole = "user" | "assistant" | "system" | "tool";

export interface CoachAttachment {
  storage_path: string;
  signed_url?: string;
  kind: "image";
}

export interface CoachToolCallLog {
  name: string;
  args: unknown;
  ok: boolean;
  error?: string | null;
}

export interface CoachMessage {
  id: string;
  thread_id: string;
  user_id: string;
  role: CoachRole;
  parts: Array<{ type: "text"; text: string }> | { text: string } | string;
  attachments: CoachAttachment[] | null;
  tool_calls: CoachToolCallLog[] | null;
  token_usage: Record<string, unknown> | null;
  created_at: string;
}

export interface CoachThread {
  id: string;
  user_id: string;
  title: string;
  context_trade_id: string | null;
  context_route: string | null;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoachContextTarget {
  trade_id?: string;
  label?: string; // e.g. "Journal › GBPUSD 2026-06-30"
  route?: string;
}
