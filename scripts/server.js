import { build } from 'vite';
import fs from 'fs';
import path from 'path';
import express from 'express';
import * as cheerio from 'cheerio';

const PORT = process.env.PORT || 3112;
const DIST_DIR = path.join(import.meta.dirname, '../dist');
const PUBLIC_DIR = path.join(import.meta.dirname, '../public');
const THREE_DIR = path.join(import.meta.dirname, '../node_modules/three/build');
const viteConfigFile = 'vite.config.js';

const app = express();

function slashMiddleware(req, res, next) {
  const ext = path.extname(req.path);
  if (!ext && req.path.substr(-1) !== '/' && req.path.length > 1) {
    const query = req.url.slice(req.path.length);
    res.redirect(301, req.path + '/' + query);
  } else {
    next();
  }
}

function createServer() {
  // redirect directory urls to always end in /
  // this ensures game assets come from their folder
  app.use(slashMiddleware);

  // Inject runtime scripts into example games
  // this emulates how we inject the runtime into games within the OpenGolfSim app

  // app.get('/games/:gameFolder/', async (req, res) => {
  //   const pagePath = path.join(PUBLIC_DIR, 'games', req.params.gameFolder, 'index.html');
  //   if (!fs.existsSync(pagePath)) {
  //     return res.sendStatus(404);
  //   }
  //   const data = await fs.promises.readFile(pagePath);
  //   const $ = cheerio.load(data.toString('utf-8'));
  //   $('head').prepend([
  //     `<link rel="stylesheet" type="text/css" href="/dist/runtime.css" />`,
  //     `<script src="/dist/runtime.iife.js"></script>`
  //   ].join(''));
  //   res.send($.html());  
  // });
  
  app.use('/three', express.static(THREE_DIR));
  // check public first to serve live changes
  app.use(express.static(PUBLIC_DIR));
  // fallback to dist, like production would use
  app.use(express.static(DIST_DIR));

  return new Promise((resolve) => {
    app.listen(PORT, () => {
      console.log(`Listening at http://localhost:${PORT}/`);
      resolve();
    });
  });
}

async function startWatchedBuild() {
  console.log('Building module files...');
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
