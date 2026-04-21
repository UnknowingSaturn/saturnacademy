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

/** Get the currently active display timezone. */
export function getDisplayTimezone(): string {
  return currentDisplayTimezone;
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

/** Get hour (0-23) in the active display timezone for session detection */
export function getHourInET(utcTimestamp: string | Date): number {
  const date = new Date(utcTimestamp);
  const etTime = new Intl.DateTimeFormat('en-US', {
    timeZone: currentDisplayTimezone,
    hour: 'numeric',
    hour12: false,
  }).format(date);
  return parseInt(etTime, 10);
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

// =====================================================================
// Legacy broker-time helpers (kept for backward compatibility).
//
// NEW CODE SHOULD NOT USE THESE. Live EA trades already arrive in UTC,
// and CSV imports should be corrected via src/lib/brokerDst.ts at import
// time so trades.entry_time / exit_time are always real UTC.
// =====================================================================

/** @deprecated Use brokerLocalToUtc from src/lib/brokerDst.ts (DST-aware). */
export function brokerTimeToUTC(brokerTimestamp: string | Date, brokerUtcOffset: number): Date {
  const date = new Date(brokerTimestamp);
  const utcMs = date.getTime() - (brokerUtcOffset * 60 * 60 * 1000);
  return new Date(utcMs);
}

/** @deprecated Format trades.entry_time directly with formatToET — it's already UTC. */
export function formatBrokerTimeET(brokerTimestamp: string | Date, brokerUtcOffset: number): string {
  const utcDate = brokerTimeToUTC(brokerTimestamp, brokerUtcOffset);
  return formatToET(utcDate);
}

/** @deprecated Format trades.entry_time directly with the date/time formatters above. */
export function formatBrokerDateTimeET(brokerTimestamp: string | Date, brokerUtcOffset: number): string {
  const utcDate = brokerTimeToUTC(brokerTimestamp, brokerUtcOffset);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: currentDisplayTimezone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(utcDate);
}

/** @deprecated Use getHourInET on the stored UTC timestamp. */
export function getBrokerHourInET(brokerTimestamp: string | Date, brokerUtcOffset: number): number {
  const utcDate = brokerTimeToUTC(brokerTimestamp, brokerUtcOffset);
  return getHourInET(utcDate);
}

/**
 * Detect trading session from a broker timestamp using session times in ET.
 * Kept for legacy callers; prefer feeding UTC times directly into session logic.
 */
export function detectSessionFromBrokerTime(
  brokerTimestamp: string | Date,
  brokerUtcOffset: number
): SessionType {
  const hourET = getBrokerHourInET(brokerTimestamp, brokerUtcOffset);
  if (hourET >= 8 && hourET < 12) return 'overlap_london_ny';
  if (hourET >= 12 && hourET < 17) return 'new_york_pm';
  if (hourET >= 3 && hourET < 8) return 'london';
  if (hourET >= 19 || hourET < 4) return 'tokyo';
  return 'off_hours';
}
