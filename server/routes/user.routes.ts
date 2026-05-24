import { Router } from 'express';
import { getCredits, listTransactions, creditUser } from '../services/creditsService.js';
import { requireAuth } from '../middleware/auth.js';

export const userRouter = Router();

// GET /api/user/credits — current user's credit balance.
userRouter.get('/credits', requireAuth, async (req, res) => {
  try {
    const credits = await getCredits(req.user!.uid);
    res.json({ credits });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/user/credits/history — most recent credit transactions for
// the authed user. Optional ?limit=N (default 50).
userRouter.get('/credits/history', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const transactions = await listTransactions(req.user!.uid, limit);
    res.json({ transactions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// F7.6 — POST /api/user/credits/grant
//
// Dev/admin convenience: add `amount` credits to the authed user.
// In dev (no Firestore creds), this updates the in-memory balance.
// In production, this MUST be gated behind a real admin check or removed.
// For now, gating it behind requireAuth at least scopes it to the
// logged-in user — they can only grant credits to themselves.
//
// Body: { amount: number (1-100000) }
userRouter.post('/credits/grant', requireAuth, async (req, res) => {
  try {
    const amount = Math.max(1, Math.min(100000, Number(req.body?.amount) || 0));
    if (amount === 0) return res.status(400).json({ error: 'amount entre 1 e 100000' });
    const newBalance = await creditUser(req.user!.uid, amount, 'dev_grant', {
      grantedAt: new Date().toISOString(),
    });
    res.json({ ok: true, newBalance, granted: amount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
