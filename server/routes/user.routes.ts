import { Router } from 'express';
import { getCredits } from '../services/creditsService.js';

export const userRouter = Router();

userRouter.get('/credits', (_req, res) => {
  res.json({ credits: getCredits() });
});
