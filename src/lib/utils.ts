import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Public site origin used for shareable links.
 * Falls back to the published Ephemeris domain so links copied from the
 * in-editor preview (id-preview--*.lovable.app) still resolve to the
 * publicly accessible site rather than the login-gated preview.
 */
const PUBLIC_SITE_ORIGIN =
  (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined)?.replace(/\/$/, "") ||
  "https://ephemeris.lovable.app";

export function getPublicReportUrl(slug: string): string {
  return `${PUBLIC_SITE_ORIGIN}/r/${slug}`;
}

export function isEditorPreviewHost(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname.includes("id-preview--");
}
