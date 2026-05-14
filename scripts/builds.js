import { build } from 'vite';

const isWatch = process.argv.includes('--watch');

const configs = [
  { configFile: 'vite.config.js', emptyOutDir: true },
  { configFile: 'vite.config.module.js', emptyOutDir: false },
];

if (isWatch) {
  await Promise.all(configs.map(c =>
    build({ configFile: c.configFile, build: { emptyOutDir: false, watch: {} } })
  ));
} else {
  for (const c of configs) {
    await build({ configFile: c.configFile, build: { emptyOutDir: c.emptyOutDir } });
  }
}