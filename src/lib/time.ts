/**
 * Time utility functions for consistent timezone handling
 * All trade times are displayed in America/New_York (Eastern Time)
 */

import { SessionType } from "@/types/trading";

const TIMEZONE = 'America/New_York';

/**
 * Format a UTC timestamp to Eastern Time (America/New_York)
 * This handles DST automatically
 */
export function formatToET(
  utcTimestamp: string | Date,
  formatOptions?: Intl.DateTimeFormatOptions
): string {
  const date = new Date(utcTimestamp);
  
  const defaultOptions: Intl.DateTimeFormatOptions = {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };
  
  return new Intl.DateTimeFormat('en-US', formatOptions || defaultOptions).format(date);
}

/**
 * Get date only in ET (e.g., "Dec 19, 2024")
 */
export function formatDateET(utcTimestamp: string | Date): string {
  const date = new Date(utcTimestamp);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/**
 * Get time only in ET (e.g., "9:30 AM")
 */
export function formatTimeET(utcTimestamp: string | Date): string {
  const date = new Date(utcTimestamp);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * Get day name in ET (e.g., "Mon", "Tue")
 */
export function getDayNameET(utcTimestamp: string | Date): string {
  const date = new Date(utcTimestamp);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
  }).format(date);
}

/**
 * Get hour in ET (0-23) for session detection
 */
export function getHourInET(utcTimestamp: string | Date): number {
  const date = new Date(utcTimestamp);
  const etTime = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: 'numeric',
    hour12: false,
  }).format(date);
  return parseInt(etTime, 10);
}

/**
 * Get full datetime in ET for display
 */
export function formatFullDateTimeET(utcTimestamp: string | Date): string {
  const date = new Date(utcTimestamp);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * Convert broker server time to UTC
 * Broker timestamps come in the broker's local time (e.g., UTC+2 or UTC+3)
 * We need to convert to actual UTC for correct session detection
 * 
 * @param brokerTimestamp - Timestamp string from broker (interpreted as broker local time)
 * @param brokerUtcOffset - Broker's UTC offset in hours (e.g., 2 for UTC+2, 3 for UTC+3)
 * @returns Date object in UTC
 */
export function brokerTimeToUTC(brokerTimestamp: string | Date, brokerUtcOffset: number): Date {
  const date = new Date(brokerTimestamp);
  // Subtract the broker's offset to get UTC
  // If broker is UTC+2, we subtract 2 hours to get UTC
  const utcMs = date.getTime() - (brokerUtcOffset * 60 * 60 * 1000);
  return new Date(utcMs);
}

/**
 * Format broker time for display in ET
 * Converts broker time to UTC, then formats in ET
 * 
 * @param brokerTimestamp - Timestamp string from broker
 * @param brokerUtcOffset - Broker's UTC offset in hours
 * @returns Formatted time string in ET
 */
export function formatBrokerTimeET(brokerTimestamp: string | Date, brokerUtcOffset: number): string {
  const utcDate = brokerTimeToUTC(brokerTimestamp, brokerUtcOffset);
  return formatToET(utcDate);
}

/**
 * Format broker time with date for display in ET
 * 
 * @param brokerTimestamp - Timestamp string from broker
 * @param brokerUtcOffset - Broker's UTC offset in hours
 * @returns Formatted date and time string in ET (e.g., "Dec 19, 9:30 AM")
 */
export function formatBrokerDateTimeET(brokerTimestamp: string | Date, brokerUtcOffset: number): string {
  const utcDate = brokerTimeToUTC(brokerTimestamp, brokerUtcOffset);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(utcDate);
}

/**
 * Get hour in ET from broker timestamp for session detection
 * 
 * @param brokerTimestamp - Timestamp string from broker
 * @param brokerUtcOffset - Broker's UTC offset in hours
 * @returns Hour in ET (0-23)
 */
export function getBrokerHourInET(brokerTimestamp: string | Date, brokerUtcOffset: number): number {
  const utcDate = brokerTimeToUTC(brokerTimestamp, brokerUtcOffset);
  return getHourInET(utcDate);
}

/**
 * Detect trading session based on time in ET
 * Standard forex session times in Eastern Time:
 * - Tokyo: 7pm - 4am ET (19:00 - 04:00)
 * - London: 3am - 12pm ET (03:00 - 12:00)
 * - New York AM: 8am - 12pm ET (08:00 - 12:00)
 * - London/NY Overlap: 8am - 12pm ET (08:00 - 12:00)
 * - New York PM: 12pm - 5pm ET (12:00 - 17:00)
 * - Off Hours: outside regular sessions
 * 
 * @param brokerTimestamp - Timestamp string from broker
 * @param brokerUtcOffset - Broker's UTC offset in hours
 * @returns Detected session type
 */
export function detectSessionFromBrokerTime(
  brokerTimestamp: string | Date, 
  brokerUtcOffset: number
): SessionType {
  const hourET = getBrokerHourInET(brokerTimestamp, brokerUtcOffset);
  
  // London/NY Overlap: 8am - 12pm ET
  if (hourET >= 8 && hourET < 12) {
    return 'overlap_london_ny';
  }
  
  // New York AM: 9:30am - 12pm ET (US market hours overlap)
  // Already covered by overlap above, so this branch handles edge cases
  
  // New York PM: 12pm - 5pm ET
  if (hourET >= 12 && hourET < 17) {
    return 'new_york_pm';
  }
  
  // London: 3am - 8am ET (before overlap)
  if (hourET >= 3 && hourET < 8) {
    return 'london';
  }
  
  // Tokyo: 7pm - 4am ET
  if (hourET >= 19 || hourET < 4) {
    return 'tokyo';
  }
  
  // Off hours: 5pm - 7pm ET or 4am - 3am gaps
  return 'off_hours';
}
