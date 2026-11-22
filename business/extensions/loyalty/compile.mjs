import { readFile } from 'node:fs/promises';
import { withLoyaltyOffer } from './loyalty.mjs';

try {
  if (process.argv.length !== 4) throw new Error('Формат: node business/extensions/loyalty/compile.mjs PAGE.json OFFER.json');
  const [page, offer] = await Promise.all(process.argv.slice(2).map(async path => JSON.parse(await readFile(path, 'utf8'))));
  process.stdout.write(JSON.stringify(withLoyaltyOffer(page, offer), null, 2) + '\n');
} catch (error) {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
}
