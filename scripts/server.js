import fs from 'fs';
import path from 'path';
import express from 'express';
import { replaceRuntimeHTML } from './utils.js';

const PORT = process.env.PORT || 3112;

const app = express();

app.use('/dist', express.static(path.join(import.meta.dirname, '../dist')));

app.use((req, res, next) => {
  const ext = path.extname(req.path);
  if (!ext && req.path.substr(-1) !== '/' && req.path.length > 1) {
    const query = req.url.slice(req.path.length);
    res.redirect(301, req.path + '/' + query);
  } else {
    next();
  }
});

app.get('/examples/:example', async (req, res) => {
  const ext = path.extname(req.url);
  // if (ext) {
  //   const gamePath = path.join(import.meta.dirname, '../examples', example, 'index.html');
  //   return res.sendFile();
  // }
  // console.log(`ext:`, ext);
  // if (ext && req.path.substr(-1) !== '/' && req.path.length > 1) {
  //   const query = req.url.slice(req.path.length);
  //   res.redirect(301, req.path + '/' + query);
  // }
  const { example } = req.params;
  console.log(`req.url:`, req.url);
  const gamePath = path.join(import.meta.dirname, '../examples', example, 'index.html');
  const exists = await fs.promises.stat(gamePath);
  if (!exists.isFile()) {
    return res.sendStatus(404);
  }
  const data = await fs.promises.readFile(gamePath);
  const $ = cheerio.load(data.toString('utf-8'));
  $('head').append('<link rel="stylesheet" type="text/css" href="/dist/runtime.css"></script>');
  $('head').prepend('<script src="/dist/runtime.iife.js"></script>');

  res.send($.html());

  // <link rel="stylesheet" type="text/css" href="/dist/runtime.css"></script>
  // res.send(`example ${gamePath}`);
});
app.use('/examples/', express.static(path.join(import.meta.dirname, '../examples')));

app.get('/', (req, res) => {
  res.sendFile(path.join(import.meta.dirname, '../public/index.html'));
});

app.listen(PORT, () => console.log(`Listening at http://localhost:${PORT}/`));