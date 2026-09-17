import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDurableConnectedReadBindingResolver } from '../../durable-connected-read-binding';
import { loadSource } from '../../../../../shared/src/sources/storage';

const [root, mode] = process.argv.slice(2);
if (!root || !['capture', 'unchanged', 'changed'].includes(mode ?? '')
  || readFileSync(join(root, 'synthetic-only'), 'utf8') !== 'connected-binding-fixture') throw new Error('fixture-only');
// Synthetic credential seam: no real credential store or network is accessed.
const resolver = createDurableConnectedReadBindingResolver({
  getWorkspaces: () => [{ id: 'fixture', name: 'Fixture', slug: 'fixture', rootPath: root, createdAt: 1 }],
  loadSource, now: () => 1000,
  loadCredential: async () => ({ value: readFileSync(join(root, 'synthetic-token'), 'utf8') }),
});
if (mode === 'capture') {
  const saved = await resolver.capture('fixture', 'account', ['https://api.example.com/v1/items']);
  writeFileSync(join(root, 'saved-binding.json'), JSON.stringify(saved));
  process.stdout.write('binding-saved\n');
  await new Promise(() => setInterval(() => {}, 1000));
} else {
  let rejected = false;
  try { await resolver.assertCurrent(JSON.parse(readFileSync(join(root, 'saved-binding.json'), 'utf8'))); }
  catch (error) {
    if ((error as Error).message !== 'durable-connected-read-binding-unavailable') throw error;
    rejected = true;
  }
  if (rejected !== (mode === 'changed')) throw new Error('unexpected-binding-result');
  process.stdout.write('binding-verified\n');
}
