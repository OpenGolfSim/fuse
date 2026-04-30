import fs from 'fs';
import path from 'path';
import express from 'express';
import { replaceRuntimeHTML } from './utils.js';


const PORT = process.env.PORT || 3112;
// const project = process.argv[process.argv.length - 1];
const USAGE = 'Usage: npm run project MY_DIR';

function getProjectPath() {
  if (process.argv.length !== 3) {
    console.error('Incorrect number of args');
    return process.exit(1);
  }
  const projectPath = process.argv[2];
  const stat = fs.statSync(projectPath);
  if (!stat.isDirectory()) {
    console.error(`Error: Project path should be directory (${USAGE})`);
    return process.exit(1);
  }
  return projectPath;
}

const project = getProjectPath();
console.log('project', project);

const app = express();

app.use('/dist', express.static(path.join(import.meta.dirname, '../dist')));

app.get('/', async (req, res) => {
  try {
    const data = await fs.promises.readFile(path.join(project, 'index.html'));
    res.send(replaceRuntimeHTML(data.toString('utf-8')));
  } catch (error) {
    res.status(500).send(error.message);
  }
});
app.use(express.static(project));

app.listen(PORT, () => console.log(`Listening at http://localhost:${PORT}/`));