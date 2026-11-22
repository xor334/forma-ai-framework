import { readFile } from 'node:fs/promises';
import { renderWeb } from './renderers.mjs';

try {
  if (process.argv.length !== 3) throw new Error('node packages/widget-contract/render.mjs examples/coffee/page.json');
  const page = JSON.parse(await readFile(process.argv[2], 'utf8'));
  process.stdout.write(renderWeb(page));
} catch (error) {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
}
