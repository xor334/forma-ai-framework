import { readFile } from 'node:fs/promises';
import { makeRelease } from './contract.mjs';

try {
  if (process.argv.length !== 3) throw new Error('node packages/widget-contract/release.mjs examples/coffee/page.json');
  const page = JSON.parse(await readFile(process.argv[2], 'utf8'));
  process.stdout.write(JSON.stringify(makeRelease(page), null, 2) + '\n');
} catch (error) {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
}
