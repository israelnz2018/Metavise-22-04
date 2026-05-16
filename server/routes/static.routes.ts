import express, { Router } from 'express';
import { GENERATED_DIR } from '../config/paths.js';

export const staticRouter = Router();

// Serves files under generated/ — ffmpeg outputs, downloaded source clips,
// and audio that HeyGen pulls back from us via a public URL.
staticRouter.use(express.static(GENERATED_DIR));
staticRouter.use((_req, res) => {
  res.status(404).send('Not found');
});
