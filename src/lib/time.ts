/**
 * Time utility functions for consistent timezone handling
 *
 * Architecture:
 * - All times are stored in UTC in the database.
 * - Display timezone is configurable per user via user_settings.display_timezone.
 * - Default display timezone is America/New_York (Eastern Time).
 *
 * Components should call setDisplayTimezone() once on mount (typically from
 * a top-level effect that reads useUserSettings) to keep formatters in sync.
 */

import { SessionType } from "@/types/trading";

const DEFAULT_TIMEZONE = 'America/New_York';

// Module-level mutable holder so non-React callers (utils, edge functions of the same shape)
// share the same configured zone after the user logs in.
let currentDisplayTimezone: string = DEFAULT_TIMEZONE;

/** Set the display timezone used by all formatters in this module. */
export function setDisplayTimezone(tz: string | null | undefined) {
  currentDisplayTimezone = tz && tz.length > 0 ? tz : DEFAULT_TIMEZONE;
}


/**
 * Format a UTC timestamp in the user's display timezone (default ET).
 * Handles DST automatically via IANA timezone resolution.
 */
export function formatToET(
  utcTimestamp: string | Date,
  formatOptions?: Intl.DateTimeFormatOptions
): string {
  const date = new Date(utcTimestamp);
  const defaultOptions: Intl.DateTimeFormatOptions = {
    timeZone: currentDisplayTimezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };
  return new Intl.DateTimeFormat('en-US', formatOptions || defaultOptions).format(date);
}

/** Get date only in the active display timezone (e.g., "Dec 19, 2024") */
export function formatDateET(utcTimestamp: string | Date): string {
  const date = new Date(utcTimestamp);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: currentDisplayTimezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/** Get time only in the active display timezone (e.g., "9:30 AM") */
export function formatTimeET(utcTimestamp: string | Date): string {
  const date = new Date(utcTimestamp);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: currentDisplayTimezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/** Get day name in the active display timezone (e.g., "Mon", "Tue") */
export function getDayNameET(utcTimestamp: string | Date): string {
  const date = new Date(utcTimestamp);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: currentDisplayTimezone,
    weekday: 'short',
  }).format(date);
}


/** Get full datetime in the active display timezone */
export function formatFullDateTimeET(utcTimestamp: string | Date): string {
  const date = new Date(utcTimestamp);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: currentDisplayTimezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * Detect trading session from a UTC timestamp using session times in ET.
 * Live EA trades arrive in UTC; CSV imports are normalized to UTC at import time
 * via src/lib/brokerDst.ts, so consumers should always pass UTC timestamps here.
 */
export function detectSessionFromUtc(utcTimestamp: string | Date): SessionType {
  const date = new Date(utcTimestamp);
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: currentDisplayTimezone,
    hour: 'numeric',
    hour12: false,
  }).format(date);
  const hourET = parseInt(hourStr, 10);
  if (hourET >= 8 && hourET < 12) return 'overlap_london_ny';
  if (hourET >= 12 && hourET < 17) return 'new_york_pm';
  if (hourET >= 3 && hourET < 8) return 'london';
  if (hourET >= 19 || hourET < 4) return 'tokyo';
  return 'off_hours';
}
