import express, { Router } from 'express';
import { GENERATED_DIR } from '../config/paths.js';

export const staticRouter = Router();

// Serves files under generated/ — ffmpeg outputs, downloaded source clips,
// and audio that HeyGen pulls back from us via a public URL.
//
// These assets are content-addressable by filename (timestamp + uuid),
// so any given URL points to immutable content. We can set aggressive
// cache headers — browsers/CDNs can keep the file forever.
//
//   max-age=31536000  → 1 year
//   immutable         → don't even revalidate with If-Modified-Since
//
// Why this matters: the user's avatar render gets embedded into a
// downloadable MP4, often refetched (preview in browser, then re-played
// after navigating tabs). Without caching, every reload re-downloads
// the whole file from disk.
staticRouter.use(
  express.static(GENERATED_DIR, {
    maxAge: '1y',
    immutable: true,
    // etag still on by default — clients can revalidate if they really
    // want to bypass the immutable hint (rare).
    setHeaders: (res, filePath) => {
      // For HTML files (none expected here, but defensive) we want
      // standard no-cache so SPA updates take effect.
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);
staticRouter.use((_req, res) => {
  res.status(404).send('Not found');
});
