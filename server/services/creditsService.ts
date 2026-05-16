// Mock in-memory credit balance shared across all users. Resets to 1000 on
// every server boot. TODO: migrate to a per-user Firestore document once the
// auth flow on the frontend is wired up to send a userId we can trust.
let userCredits = 1000;

export function getCredits(): number {
  return userCredits;
}

export function hasCredits(amount: number): boolean {
  return userCredits >= amount;
}

export function deductCredits(amount: number): number {
  userCredits -= amount;
  return userCredits;
}
