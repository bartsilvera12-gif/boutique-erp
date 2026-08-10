const HASH_KEY = "boutique_edit_password_hash_v1";
const UNLOCK_KEY = "boutique_edit_unlocked_until_v1";
const UNLOCK_MS = 30 * 60 * 1000;

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hasStoredPassword(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.localStorage.getItem(HASH_KEY);
}

export async function setStoredPassword(password: string): Promise<void> {
  const hash = await sha256(password);
  window.localStorage.setItem(HASH_KEY, hash);
}

export async function verifyPassword(password: string): Promise<boolean> {
  const stored = window.localStorage.getItem(HASH_KEY);
  if (!stored) return false;
  const hash = await sha256(password);
  return hash === stored;
}

export function isUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.sessionStorage.getItem(UNLOCK_KEY);
  if (!raw) return false;
  const until = parseInt(raw, 10);
  if (!Number.isFinite(until)) return false;
  return Date.now() < until;
}

export function unlock(): void {
  window.sessionStorage.setItem(UNLOCK_KEY, String(Date.now() + UNLOCK_MS));
}

export function lock(): void {
  window.sessionStorage.removeItem(UNLOCK_KEY);
}

export function resetPassword(): void {
  window.localStorage.removeItem(HASH_KEY);
  lock();
}
