/** Parent view shows "J. Lim", never a full first name. */
export function parentDisplayName(firstName: string, lastName: string): string {
  const initial = firstName.trim().charAt(0).toUpperCase();
  return initial ? `${initial}. ${lastName.trim()}` : lastName.trim();
}

/** Normalise a datetime-local / ISO string to canonical UTC ISO, or null. */
export function toIsoOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
