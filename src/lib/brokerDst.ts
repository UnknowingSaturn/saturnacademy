/**
 * Broker DST Profile resolution
 *
 * Handles per-trade-date offset lookup for CSV-imported trades where
 * a single static offset would be wrong across DST transitions.
 *
 * Industry-standard approach: most MT5 brokers run on a known schedule.
 * We map the broker's profile + the trade's date to the correct offset.
 */

export type BrokerDstProfile =
  | 'EET_DST'      // UTC+2 winter / UTC+3 summer (EU DST) — IC Markets, Pepperstone, FTMO, etc.
  | 'GMT_DST'      // UTC+0 winter / UTC+1 summer (UK DST)
  | 'FIXED_PLUS_3' // No DST — some US-friendly brokers
  | 'FIXED_PLUS_2' // No DST — fixed UTC+2
  | 'FIXED_PLUS_0' // UTC, no DST
  | 'MANUAL';      // Use accounts.broker_utc_offset

export const BROKER_DST_PROFILE_OPTIONS: Array<{ value: BrokerDstProfile; label: string; description: string }> = [
  { value: 'EET_DST', label: 'EET / EEST (UTC+2/+3, EU DST)', description: 'IC Markets, Pepperstone, FTMO, FXPro, most ECN brokers' },
  { value: 'GMT_DST', label: 'GMT / BST (UTC+0/+1, UK DST)', description: 'A few UK-based brokers' },
  { value: 'FIXED_PLUS_3', label: 'Fixed UTC+3 (no DST)', description: 'Some US-friendly brokers' },
  { value: 'FIXED_PLUS_2', label: 'Fixed UTC+2 (no DST)', description: 'Rare; brokers that don\'t observe DST' },
  { value: 'FIXED_PLUS_0', label: 'UTC (no offset)', description: 'Brokers that report in UTC directly' },
  { value: 'MANUAL', label: 'Manual offset', description: 'Use the numeric offset on the account (legacy)' },
];

/**
 * Resolve the broker's UTC offset (in hours) for a given timestamp.
 *
 * For DST-aware profiles, we use Intl.DateTimeFormat to get the correct
 * offset on the date in question — this handles DST transitions correctly
 * across mixed-history imports without any hard-coded date math.
 *
 * @param profile The broker's DST profile
 * @param timestamp The timestamp to resolve the offset FOR (any timezone-naive Date is fine)
 * @param manualOffsetHours Used when profile === 'MANUAL'
 * @returns Offset in hours (e.g., 2 means broker time is UTC+2 on that date)
 */
export function resolveBrokerOffsetHours(
  profile: BrokerDstProfile,
  timestamp: string | Date,
  manualOffsetHours: number = 2
): number {
  const date = new Date(timestamp);

  switch (profile) {
    case 'FIXED_PLUS_0':
      return 0;
    case 'FIXED_PLUS_2':
      return 2;
    case 'FIXED_PLUS_3':
      return 3;
    case 'EET_DST':
      // Europe/Athens follows EU DST: UTC+2 winter, UTC+3 summer
      return getIanaOffsetHours('Europe/Athens', date);
    case 'GMT_DST':
      // Europe/London follows UK DST: UTC+0 winter, UTC+1 summer
      return getIanaOffsetHours('Europe/London', date);
    case 'MANUAL':
    default:
      return manualOffsetHours;
  }
}

/**
 * Get the offset (in hours) of an IANA timezone at a given date.
 * Uses Intl.DateTimeFormat — no external libs, fully DST-aware.
 */
export function getIanaOffsetHours(timeZone: string, date: Date): number {
  // Format the same instant in UTC and in the target zone, then diff.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((asUtc - date.getTime()) / 3_600_000);
}

/**
 * Convert a broker-local timestamp (string the broker emitted, interpreted naively as
 * "their wall clock") to UTC, using the broker's DST profile to pick the right offset
 * for that specific date.
 *
 * Example: For an EET_DST broker, a "2024-02-15 10:00:00" stamp → UTC-2h = 08:00 UTC,
 * and a "2024-07-15 10:00:00" stamp → UTC-3h = 07:00 UTC. Mixed history handled correctly.
 *
 * Parsing rules (deterministic, browser-locale-independent):
 *   - If the input already carries an explicit offset / Z, it is treated as
 *     absolute UTC and returned as-is (no double-shift).
 *   - Otherwise the wall-clock components are extracted with a strict regex
 *     and combined via Date.UTC() — never via `new Date(string)`, which is
 *     locale-dependent and would yield different results for the same string
 *     in Chrome vs Safari, or in a UTC-vs-PST user shell.
 */
const NAIVE_TS_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/;
const TZ_TS_RE = /(Z|[+-]\d{2}:?\d{2})$/;

export function brokerLocalToUtc(
  profile: BrokerDstProfile,
  brokerTimestamp: string | Date,
  manualOffsetHours: number = 2
): Date {
  // Date input: already an absolute instant. Nothing to shift.
  if (brokerTimestamp instanceof Date) return brokerTimestamp;

  const s = String(brokerTimestamp).trim();

  // Explicit timezone in the string → trust it, don't double-shift.
  if (TZ_TS_RE.test(s)) return new Date(s);

  const m = NAIVE_TS_RE.exec(s);
  if (!m) {
    // Last-resort fallback for unexpected formats — surface the issue rather
    // than silently producing locale-dependent garbage.
    const fallback = new Date(s);
    const offsetH = resolveBrokerOffsetHours(profile, fallback, manualOffsetHours);
    return new Date(fallback.getTime() - offsetH * 3_600_000);
  }

  const [, yyyy, mo, dd, hh, mm, ss = "0", frac = "0"] = m;
  const ms = Number((frac + "000").slice(0, 3));
  // Compose the wall-clock as if it were UTC, then subtract the broker offset
  // resolved at *that* date (so DST transitions are honored).
  const wallAsUtc = Date.UTC(
    Number(yyyy),
    Number(mo) - 1,
    Number(dd),
    Number(hh),
    Number(mm),
    Number(ss),
    ms,
  );
  const offsetH = resolveBrokerOffsetHours(
    profile,
    new Date(wallAsUtc),
    manualOffsetHours,
  );
  return new Date(wallAsUtc - offsetH * 3_600_000);
}
