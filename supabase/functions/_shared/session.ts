// Shared session classifier used by ingest-events, reprocess-trades, and reclassify-sessions.
// Honors each session's own .timezone field — do NOT hardcode ET.

export interface SessionDefinition {
  key: string;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  timezone: string;
  sort_order: number;
  is_active: boolean;
}

export const DEFAULT_SESSIONS: SessionDefinition[] = [
  { key: "london", start_hour: 3, start_minute: 0, end_hour: 8, end_minute: 0, timezone: "America/New_York", sort_order: 0, is_active: true },
  { key: "new_york_am", start_hour: 8, start_minute: 0, end_hour: 12, end_minute: 0, timezone: "America/New_York", sort_order: 1, is_active: true },
  { key: "new_york_pm", start_hour: 12, start_minute: 0, end_hour: 17, end_minute: 0, timezone: "America/New_York", sort_order: 2, is_active: true },
  { key: "off_hours", start_hour: 17, start_minute: 0, end_hour: 19, end_minute: 0, timezone: "America/New_York", sort_order: 3, is_active: true },
  { key: "tokyo", start_hour: 19, start_minute: 0, end_hour: 3, end_minute: 0, timezone: "America/New_York", sort_order: 4, is_active: true },
];

export async function loadSessions(supabase: any, userId: string): Promise<SessionDefinition[]> {
  const { data, error } = await supabase
    .from("session_definitions")
    .select("key,start_hour,start_minute,end_hour,end_minute,timezone,sort_order,is_active")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("sort_order");
  if (error) {
    console.error("loadSessions error, falling back to defaults:", error);
    return DEFAULT_SESSIONS;
  }
  return data && data.length > 0 ? (data as SessionDefinition[]) : DEFAULT_SESSIONS;
}

/**
 * Classify a UTC timestamp into a user session key. Each session's own timezone
 * field is honored — do NOT assume America/New_York.
 */
export function classifySession(
  timestamp: string | Date,
  sessions: SessionDefinition[],
): string {
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  for (const session of sessions) {
    if (!session.is_active) continue;
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: session.timezone || "America/New_York",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
    const minutes = hour * 60 + minute;
    const startMin = session.start_hour * 60 + session.start_minute;
    const endMin = session.end_hour * 60 + session.end_minute;
    if (startMin > endMin) {
      // Session crosses midnight
      if (minutes >= startMin || minutes < endMin) return session.key;
    } else {
      if (minutes >= startMin && minutes < endMin) return session.key;
    }
  }
  return "off_hours";
}
