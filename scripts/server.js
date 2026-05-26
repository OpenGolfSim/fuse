import { build } from 'vite';
import fs from 'fs';
import path from 'path';
import express from 'express';
import * as cheerio from 'cheerio';

const PORT = process.env.PORT || 3112;
const DIST_DIR = path.join(import.meta.dirname, '../dist');
const PUBLIC_DIR = path.join(import.meta.dirname, '../public');
const viteConfigFile = 'vite.config.js';

const app = express();

function createServer() {

  // check public first to serve live changes
  app.use(express.static(PUBLIC_DIR));
  // fallback to dist, like production would use
  app.use(express.static(DIST_DIR));

  return new Promise((resolve) => {
    app.listen(PORT, () => {
      console.log('');
      console.log('');
      console.log(`OGS-FUSE is running at: http://localhost:${PORT}/`);
      console.log('');
      resolve();
    });
  });
}

async function startWatchedBuild() {
  console.log('Building module...');
  const watcher = await build({
    configFile: viteConfigFile,
    build: { emptyOutDir: false, watch: {} },
  });

  await new Promise((resolve, reject) => {
    watcher.on('event', (event) => {
      // Rollup explicitly requires freeing file handles or we'll leak them
      if (event.code === 'BUNDLE_END') event.result?.close();
      else if (event.code === 'END') resolve();
      else if (event.code === 'ERROR') reject(event.error);
    });
  });
}

(async () => {
  await startWatchedBuild();
  await createServer();
})();
