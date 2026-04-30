import * as cheerio from 'cheerio';

export function replaceRuntimeHTML(inputHTML, prefix = '/dist') {
  const $ = cheerio.load(inputHTML.toString('utf-8'));
  $('head').append(`<link rel="stylesheet" type="text/css" href="${prefix}/runtime.css"></script>`);
  $('head').prepend(`<script src="${prefix}/runtime.iife.js"></script>`);
  return $.html();
}