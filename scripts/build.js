// Builds dist/ from src/. Dev-only; consumers just use the files in dist/.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const banner = readFileSync(new URL('../src/banner.txt', import.meta.url), 'utf8').trim();
const common = { entryPoints: ['src/index.js'], bundle: true, banner: { js: banner }, legalComments: 'none' };

await Promise.all([
  // <script src> build: defines window.SableEdit
  build({ ...common, format: 'iife', globalName: 'SableEdit', outfile: 'dist/sable-edit.js' }),
  build({ ...common, format: 'iife', globalName: 'SableEdit', outfile: 'dist/sable-edit.min.js', minify: true }),
  // import { attach } from './sable-edit.esm.js'
  build({ ...common, format: 'esm', outfile: 'dist/sable-edit.esm.js' }),
]);
console.log('built dist/');
