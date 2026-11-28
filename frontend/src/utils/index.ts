/**
 * Combines React Native style properties, filtering out falsy values and flattening arrays.
 */
export function cn(...args: any[]): any[] {
  return args.filter(Boolean).flat();
}

const GRADIENTS = [
  { start: '#38bdf8', end: '#1d4ed8' }, // Accent Blue -> Dark Blue
  { start: '#10b981', end: '#047857' }, // Emerald -> Forest Green
  { start: '#a855f7', end: '#6b21a8' }, // Purple -> Indigo
  { start: '#f43f5e', end: '#be123c' }, // Rose -> Crimson
  { start: '#fb923c', end: '#c2410c' }, // Orange -> Rust
  { start: '#06b6d4', end: '#0369a1' }, // Cyan -> Sky Blue
];

/**
 * Generates deterministic gradient colors based on a username string.
 */
export function getAvatarColors(username: string) {
  if (!username) return GRADIENTS[0];
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % GRADIENTS.length;
  return GRADIENTS[index];
}

/**
 * Extracts initials (up to 2 letters) from a username.
 */
export function getInitials(username: string): string {
  if (!username) return '?';
  const trimmed = username.trim();
  if (trimmed.length === 0) return '?';
  const parts = trimmed.split(/[\s._-]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.substring(0, Math.min(2, trimmed.length)).toUpperCase();
}
