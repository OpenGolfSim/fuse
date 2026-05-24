import { build } from 'vite';
import fs from 'fs';
import path from 'path';
import express from 'express';
import * as cheerio from 'cheerio';

const PORT = process.env.PORT || 3112;
const DIST_DIR = path.join(import.meta.dirname, '../dist');
const STATIC_DIR = path.join(import.meta.dirname, '../public');
const viteConfigFile = 'vite.config.js';

// const staticDirs = {
//   // games: {
//   //   prefix: '/games',
//   //   path: path.join(import.meta.dirname, '../games')
//   // },
//   // examples: {
//   //   prefix: '/examples',
//   //   path: path.join(import.meta.dirname, '../examples')
//   // },
//   dist: {
//     prefix: '/dist',
//     path: path.join(import.meta.dirname, '../dist')
//   },
//   public: {
//     prefix: '/',
//     path: path.join(import.meta.dirname, '../public')
//   },
// };

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
  app.get('/games/:gameFolder/', async (req, res) => {
    const pagePath = path.join(STATIC_DIR, 'games', req.params.gameFolder, 'index.html');
    if (!fs.existsSync(pagePath)) {
      return res.sendStatus(404);
    }
    const data = await fs.promises.readFile(pagePath);
    const $ = cheerio.load(data.toString('utf-8'));
    $('head').prepend([
      `<link rel="stylesheet" type="text/css" href="/dist/runtime.css" />`,
      `<script src="/dist/runtime.iife.js"></script>`
    ].join(''));
    res.send($.html());  
  });
  app.use('/dist', express.static(DIST_DIR));
  app.use(express.static(STATIC_DIR));
  app.use('/static', express.static(STATIC_DIR));
  
  app.get('/list', async (req, res) => {
    res.json({
      items: [
        // {
        //   title: 'Corn Hole',
        //   url: 'cornhole/index.html',
        //   slug: 'webgl-cornhole'
        // },
        {
          title: 'FUSE: Range',
          gameMode: 0,
          url: '/static/games/range/',
          posterUrl: 'https://coursedata.opengolfsim.com/webgl/courses/mountain-vista/v1/mountain-vista.jpg',
          slug: 'webgl-range'
        },
        {
          title: 'FUSE: Mountain Vista',
          gameMode: 2,
          url: '/static/games/courses/',
          courseUrl: 'https://coursedata.opengolfsim.com/webgl/courses/mountain-vista/v1/mountain-vista.glb',
          posterUrl: 'https://coursedata.opengolfsim.com/webgl/courses/mountain-vista/v1/mountain-vista.jpg',
          slug: 'webgl-mtnvista'
        },
        // {
        //   "title": "Cornhole - WEBGL",
        //   "url": "ogs-webgl-cornhole/index.html",
        //   "slug": "webgl-cornhole",
        //   "posterUrl": "ogs-webgl-cornhole/poster.jpg"
        // },
        // {
        //   "title": "Football Game - WEBGL",
        //   "url": "field-goal/index.html",
        //   "slug": "field-goal",
        //   "posterUrl": "field-goal/poster.jpg"
        // },
        // {
        //   "title": "High Striker - WEBGL",
        //   "url": "strength-test/index.html",
        //   "slug": "strength-test",
        //   "posterUrl": "strength-test/poster.jpg"
        // },
        // {
        //   "title": "Range - WEBGL",
        //   "url": "ogs-webgl-range/index.html",
        //   "slug": "ogs-webgl-range",
        //   "posterUrl": "ogs-webgl-range/poster.jpg"
        // }
      ]
    });
  
  });

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
