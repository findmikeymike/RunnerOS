/** Separate process with its own persistent ledger: independent oracle for observed calls/effects. */
import { createServer } from 'node:http';
import { join } from 'node:path';
import { openDatabase } from './fixture-journal.ts';
const db = openDatabase(join(process.argv[2]!, 'provider.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, count INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS effects(id TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL);');
const server = createServer(async (req, res) => {
  try {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 16384) throw new Error('too-large'); }
    const body = JSON.parse(raw || '{}');
    if (req.url === '/stats') {
      res.end(JSON.stringify({ calls: db.prepare('SELECT * FROM calls').all(), effects: db.prepare('SELECT * FROM effects').all() })); return;
    }
    if (req.url === '/lookup') {
      const row = db.prepare('SELECT * FROM effects WHERE id=?').get(body.id);
      if (row && row.digest !== body.digest) throw new Error('diverged');
      res.end(JSON.stringify({ result: row ? JSON.parse(row.result) : null })); return;
    }
    db.exec('BEGIN IMMEDIATE');
    let result: unknown;
    try {
      db.prepare('INSERT INTO calls VALUES(?,1) ON CONFLICT(id) DO UPDATE SET count=count+1').run(body.id);
      if (req.url === '/model') result = { calls: ['read:0', 'read:1', 'effect'], version: 1 };
      else if (req.url === '/read') result = { value: 'read:' + body.id };
      else if (req.url === '/effect' || req.url === '/opaque') {
        const old = db.prepare('SELECT * FROM effects WHERE id=?').get(body.id);
        if (old && old.digest !== body.digest) throw new Error('diverged');
        // Opaque records each actual dispatch separately; it offers no deduplication contract.
        const effectId = req.url === '/opaque' ? body.id + ':' + db.prepare('SELECT count FROM calls WHERE id=?').get(body.id).count : body.id;
        result = old ? JSON.parse(old.result) : { value: 'effect:' + effectId };
        db.prepare('INSERT OR IGNORE INTO effects VALUES(?,?,?)').run(effectId, body.digest, JSON.stringify(result));
      } else throw new Error('unknown-route');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    if (body.id.startsWith('drop-') && (req.url === '/effect' || req.url === '/opaque')) { req.socket.destroy(); return; }
    res.end(JSON.stringify(result));
  } catch { res.statusCode = 400; res.end('{}'); }
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: (server.address() as { port: number }).port })));
