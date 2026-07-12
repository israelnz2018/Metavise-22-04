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
// Dev fallback: if firebase-admin isn't initialized OR Firestore credentials
// aren't reachable (no service account on dev Mac), we fall back to a
// per-uid in-memory map so the rest of the app keeps working. Resets on
// reboot — fine for dev.

import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// O app usa um banco Firestore NÃO-PADRÃO ('metavise'). O front já aponta pra
// ele (firestoreDatabaseId); o servidor precisa apontar pro MESMO banco, senão
// lê/escreve créditos no banco (default) — errado/inexistente. Configurável por
// env; default 'metavise'.
const FS_DB_ID = process.env.FIRESTORE_DATABASE_ID || 'metavise';
function fsdb() {
  return getFirestore(admin.app(), FS_DB_ID);
}

// F7.6 — welcome bonus bumped pra 10000 (de 100) porque cada avatar
// custa 100 créditos. Com 100, uma única geração zerava o saldo do
// dev usando a app. Esse número só importa pro WELCOME (novo user) e
// pro memory fallback (dev sem Firestore creds). Produção usa o saldo
// real do Firestore.
const WELCOME_CREDITS = 10000;

// In-memory fallback used when Firestore is unavailable.
const memoryBalance = new Map<string, number>();
function memGet(uid: string) {
  if (!memoryBalance.has(uid)) memoryBalance.set(uid, WELCOME_CREDITS);
  return memoryBalance.get(uid)!;
}

// F7.5 — once a Firestore call fails with auth error, latch this to true
// so subsequent calls skip Firestore entirely and use memory. Avoids
// repeating the same expensive failed RPC on every credit check.
let firestoreUnavailable = false;

function db() {
  if (admin.apps.length === 0) return null;
  if (firestoreUnavailable) return null;
  return fsdb();
}

function accountRef(uid: string) {
  return fsdb().collection('users').doc(uid).collection('billing').doc('account');
}

// F7.5 — catch "Could not load default credentials" + similar. After the
// first failure we latch firestoreUnavailable=true so future calls don't
// re-throw and crash the server (previously hasCredits → ensureAccount →
// uncaught throw → process crash on every avatar generation attempt).
function handleFirestoreFailure(operation: string, err: any): void {
  const msg = String(err?.message || err);
  if (
    msg.includes('Could not load the default credentials') ||
    msg.includes('UNAUTHENTICATED') ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('NOT_FOUND') ||
    msg.includes('credentials')
  ) {
    if (!firestoreUnavailable) {
      console.warn(
        `[creditsService] Firestore unavailable during ${operation}: ${msg.substring(0, 200)}. ` +
          'Latching to in-memory fallback for the rest of this process.'
      );
      firestoreUnavailable = true;
    }
  } else {
    console.error(`[creditsService] ${operation} failed (non-credentials):`, err);
  }
}

async function ensureAccount(uid: string): Promise<void> {
  const firestore = db();
  if (!firestore) return;
  try {
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
  } catch (err: any) {
    handleFirestoreFailure('ensureAccount', err);
  }
}

export async function getCredits(uid: string): Promise<number> {
  const firestore = db();
  if (!firestore) return memGet(uid);
  try {
    await ensureAccount(uid);
    // If ensureAccount latched the fallback, return memory now.
    if (firestoreUnavailable) return memGet(uid);
    const snap = await accountRef(uid).get();
    return (snap.data()?.balance as number) ?? 0;
  } catch (err: any) {
    handleFirestoreFailure('getCredits', err);
    return memGet(uid);
  }
}

export async function hasCredits(uid: string, amount: number): Promise<boolean> {
  try {
    const balance = await getCredits(uid);
    return balance >= amount;
  } catch (err: any) {
    handleFirestoreFailure('hasCredits', err);
    return memGet(uid) >= amount;
  }
}

// Atomic deduction. Throws if insufficient credits. Returns the new
// balance after the deduction.
export async function deductCredits(
  uid: string,
  amount: number,
  operation: string,
  opMeta: Record<string, any> = {}
): Promise<number> {
  const firestore = db();
  if (!firestore) {
    const cur = memGet(uid);
    if (cur < amount) throw new Error('Créditos insuficientes.');
    memoryBalance.set(uid, cur - amount);
    return cur - amount;
  }

  try {
    await ensureAccount(uid);
    if (firestoreUnavailable) {
      // ensureAccount just latched the fallback — use memory.
      const cur = memGet(uid);
      if (cur < amount) throw new Error('Créditos insuficientes.');
      memoryBalance.set(uid, cur - amount);
      return cur - amount;
    }
    const ref = accountRef(uid);
    const txRef = ref.collection('transactions').doc();

    return await firestore.runTransaction(async (tx) => {
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
  } catch (err: any) {
    // Re-throw business errors (insufficient credits) — only swallow creds errors.
    if (String(err?.message || '').includes('Créditos insuficientes')) throw err;
    handleFirestoreFailure('deductCredits', err);
    const cur = memGet(uid);
    if (cur < amount) throw new Error('Créditos insuficientes.');
    memoryBalance.set(uid, cur - amount);
    return cur - amount;
  }
}

// Credit user (top-up, refund, promo). Atomic.
export async function creditUser(
  uid: string,
  amount: number,
  operation: string,
  opMeta: Record<string, any> = {}
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
