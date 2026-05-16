import { Router } from 'express';
import fs from 'fs';

export const adminRouter = Router();

// /api/admin/debug-logs — dumps the rolling file log written by logToFile.
// The log file is truncated on every server boot.
adminRouter.get('/debug-logs', (_req, res) => {
  try {
    if (fs.existsSync('debug_logs.txt')) {
      const content = fs.readFileSync('debug_logs.txt', 'utf8');
      res.send(`<pre>${content}</pre>`);
    } else {
      res.send('No logs found.');
    }
  } catch {
    res.status(500).send('Error reading logs');
  }
});
