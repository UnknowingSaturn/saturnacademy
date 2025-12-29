/**
 * Time utility functions for consistent timezone handling
 * All trade times are displayed in America/New_York (Eastern Time)
 */

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
