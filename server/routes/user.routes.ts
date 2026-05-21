import { Router } from 'express';
import { getCredits, listTransactions } from '../services/creditsService.js';
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
