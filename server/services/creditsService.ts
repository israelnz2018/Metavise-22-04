// Per-user credit ledger backed by Firestore.
//
// Schema:
//   users/{uid}/billing/account
//     { balance: number, totalSpent: number, totalCredited: number,
//       createdAt: Timestamp, updatedAt: Timestamp }
//   users/{uid}/billing/transactions/{txId}
//     { delta: number (signed), operation: string, opMeta: any,
//       balanceAfter: number, at: Timestamp }
//
// Atomicity: deductCredits + recordTransaction run inside a Firestore
// transaction so concurrent video generations can't double-spend.
//
// Dev fallback: if firebase-admin isn't initialized (no creds on the
// dev Mac), we fall back to a per-uid in-memory map so the rest of the
// app keeps working. Resets on reboot — fine for dev.

import admin from 'firebase-admin';

const WELCOME_CREDITS = 100;

// In-memory fallback used when Firestore is unavailable.
const memoryBalance = new Map<string, number>();
function memGet(uid: string) {
  if (!memoryBalance.has(uid)) memoryBalance.set(uid, WELCOME_CREDITS);
  return memoryBalance.get(uid)!;
}

function db() {
  if (admin.apps.length === 0) return null;
  return admin.firestore();
}

function accountRef(uid: string) {
  return admin.firestore().collection('users').doc(uid).collection('billing').doc('account');
}

async function ensureAccount(uid: string): Promise<void> {
  const firestore = db();
  if (!firestore) return;
  const ref = accountRef(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      balance: WELCOME_CREDITS,
      totalSpent: 0,
      totalCredited: WELCOME_CREDITS,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}

export async function getCredits(uid: string): Promise<number> {
  const firestore = db();
  if (!firestore) return memGet(uid);
  await ensureAccount(uid);
  const snap = await accountRef(uid).get();
  return (snap.data()?.balance as number) ?? 0;
}

export async function hasCredits(uid: string, amount: number): Promise<boolean> {
  const balance = await getCredits(uid);
  return balance >= amount;
}

// Atomic deduction. Throws if insufficient credits. Returns the new
// balance after the deduction.
export async function deductCredits(
  uid: string,
  amount: number,
  operation: string,
  opMeta: Record<string, any> = {},
): Promise<number> {
  const firestore = db();
  if (!firestore) {
    const cur = memGet(uid);
    if (cur < amount) throw new Error('Créditos insuficientes.');
    memoryBalance.set(uid, cur - amount);
    return cur - amount;
  }

  await ensureAccount(uid);
  const ref = accountRef(uid);
  const txRef = ref.collection('transactions').doc();

  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() || {};
    const balance = (data.balance as number) ?? 0;
    if (balance < amount) throw new Error('Créditos insuficientes.');
    const newBalance = balance - amount;
    const newTotalSpent = ((data.totalSpent as number) ?? 0) + amount;
    tx.update(ref, {
      balance: newBalance,
      totalSpent: newTotalSpent,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.set(txRef, {
      delta: -amount,
      operation,
      opMeta,
      balanceAfter: newBalance,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
    return newBalance;
  });
}

// Credit user (top-up, refund, promo). Atomic.
export async function creditUser(
  uid: string,
  amount: number,
  operation: string,
  opMeta: Record<string, any> = {},
): Promise<number> {
  const firestore = db();
  if (!firestore) {
    const cur = memGet(uid);
    memoryBalance.set(uid, cur + amount);
    return cur + amount;
  }
  await ensureAccount(uid);
  const ref = accountRef(uid);
  const txRef = ref.collection('transactions').doc();

  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() || {};
    const balance = (data.balance as number) ?? 0;
    const newBalance = balance + amount;
    const newTotalCredited = ((data.totalCredited as number) ?? 0) + amount;
    tx.update(ref, {
      balance: newBalance,
      totalCredited: newTotalCredited,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.set(txRef, {
      delta: amount,
      operation,
      opMeta,
      balanceAfter: newBalance,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
    return newBalance;
  });
}

export async function listTransactions(uid: string, limit = 50) {
  const firestore = db();
  if (!firestore) return [];
  const snap = await accountRef(uid)
    .collection('transactions')
    .orderBy('at', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
