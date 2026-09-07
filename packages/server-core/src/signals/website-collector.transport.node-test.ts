import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConnection, createServer, type AddressInfo } from 'node:net';
import { once } from 'node:events';
import { collectSignalWebsite, createSignalWebsiteLookup, SIGNAL_WEBSITE_SOURCES } from './website-collector';

test('bundled collector parses RSS without an external SAX module', async () => {
  const packet = await collectSignalWebsite({ url: SIGNAL_WEBSITE_SOURCES[4], sinceDays: 7, now: '2026-09-07T12:00:00Z' }, {
    fetch: async () => new Response('<rss><channel><lastBuildDate>2026-09-07T12:00:00Z</lastBuildDate></channel></rss>'),
  });
  assert.equal(packet.status, 'checked');
});

test('pinned lookup honors scalar and all-address callback contracts', () => {
  const lookup = createSignalWebsiteLookup({ address: '93.184.216.34', family: 4 });
  lookup('configured.example', { all: false }, (error, value, family) => {
    assert.equal(error, null);
    assert.equal(value, '93.184.216.34');
    assert.equal(family, 4);
  });
  lookup('configured.example', { all: true }, (error, value, family) => {
    assert.equal(error, null);
    assert.deepEqual(value, [{ address: '93.184.216.34', family: 4 }]);
    assert.equal(family, undefined);
  });
});

for (const autoSelectFamily of [false, true]) {
  test(`real runtime socket accepts pinned lookup (autoSelectFamily=${autoSelectFamily})`, async () => {
    const server = createServer(socket => socket.end('pinned transport'));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const seen: boolean[] = [];
    const pinned = createSignalWebsiteLookup({ address: '127.0.0.1', family: 4 });
    const socket = createConnection({
      host: 'no-dns-resolution.invalid', port: (server.address() as AddressInfo).port,
      autoSelectFamily,
      lookup(host, options, callback) { seen.push(options.all === true); pinned(host, options, callback); },
    });
    socket.setTimeout(2000, () => socket.destroy(new Error('Transport timed out')));
    try {
      let text = '';
      for await (const chunk of socket) text += chunk.toString();
      assert.equal(text, 'pinned transport');
      assert.deepEqual(seen, [autoSelectFamily]);
    } finally {
      socket.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
}
