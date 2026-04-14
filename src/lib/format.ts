/**
 * Shared formatting utilities for status page components.
 */

/**
 * Formats an ISO date string into a short human-readable format.
 * Example: "Apr 14, 10:30 AM"
 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
