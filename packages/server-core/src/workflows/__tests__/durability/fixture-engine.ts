import { certify, digest, FixtureJournal, manifest, type Contract, type FixtureRun, type Operation } from './fixture-journal.ts';
import { request as httpRequest } from 'node:http';

export type Barrier = (name: string) => Promise<void>;
const noBarrier: Barrier = async () => {};
function eligible(run: FixtureRun): void {
  if (['cancelled', 'paused', 'succeeded', 'needs-attention'].includes(run.state)) throw new Error('not-runnable');
  if (!run.allowed) throw new Error('permission-revoked');
  if (Date.now() >= run.deadline) throw new Error('deadline-exceeded');
}
function validateResult(tool: string, result: any): void {
  if (tool === 'model') {
    if (!result || digest(result) !== digest({ calls: ['read:0', 'read:1', 'effect'], version: 1 })) throw new Error('invalid-model-turn');
  } else if (!result || typeof result.value !== 'string') throw new Error('invalid-result');
}

/** Explicit serialized continuation; no closures, provider SDKs or product sessions are restored. */
export async function recoverFixture(journal: FixtureJournal, id: string, endpoint: string, barrier: Barrier = noBarrier, expected?: { account?: string; contract?: Contract }): Promise<void> {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint)) throw new Error('local-fixture-provider-required');
  const workspace = 'fixture';
  const epoch = journal.claim(id, workspace);
  const read = () => journal.read(id, workspace);
  const update = (kind: string, fn: (run: FixtureRun) => void) => journal.update(id, workspace, epoch, kind, fn);
  // Bun fetch retried an accepted/drop-reply POST in the fault experiment. Use a single
  // non-pooled request; only this coordinator may spend another logical attempt.
  const request = (path: string, body: unknown): Promise<any> => new Promise((resolve, reject) => {
    const req = httpRequest(endpoint + path, { method: 'POST', agent: false, headers: { 'content-type': 'application/json' } }, response => {
      let bytes = '';
      response.on('data', chunk => { bytes += chunk; if (bytes.length > 16384) req.destroy(new Error('fixture-response-too-large')); });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode !== 200) { reject(new Error('fixture-provider-error')); return; }
        try { resolve(JSON.parse(bytes)); } catch (error) { reject(error); }
      });
    });
    req.setTimeout(1500, () => req.destroy(new Error('fixture-provider-timeout')));
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
  async function operation(slot: string, contract: Contract, input: unknown, requiresApproval = false): Promise<unknown> {
    certify(contract);
    const requestDigest = digest({ input, contract, account: read().account });
    update('prepare:' + slot, run => {
      eligible(run);
      const old = run.operations[slot];
      if (old && old.requestDigest !== requestDigest) throw new Error('execution-diverged');
      if (!old) run.operations[slot] = { id: id + ':' + slot, contract, request: input, requestDigest, status: 'prepared', attempts: 0, reserved: 0 };
    });
    await barrier('prepared:' + slot);
    let op = read().operations[slot]!;
    if (op.status === 'succeeded') return op.result;
    if (op.status === 'dispatched' || op.status === 'unknown') {
      if (contract.effect === 'nonreplayable-external') {
        update('unknown:' + slot, run => { run.operations[slot]!.status = 'unknown'; run.state = 'needs-attention'; });
        throw new Error('unknown-effect');
      }
      if (contract.effect === 'idempotent-external') {
        // Simulator lookup is strongly consistent. No inference from missing real-provider listings.
        const found = await request('/lookup', { id: op.id, digest: op.requestDigest });
        if (found.result) {
          validateResult(contract.tool, found.result);
          update('reconciled:' + slot, run => { Object.assign(run.operations[slot]!, { status: 'succeeded', result: found.result }); });
          return found.result;
        }
      }
    }
    await barrier('before-dispatch:' + slot);
    update('dispatch:' + slot, run => {
      eligible(run);
      certify(contract); // Dynamic/child paths recheck the manifest at the actual dispatch claim.
      op = run.operations[slot]!;
      if (op.attempts >= 3) throw new Error('attempt-limit');
      if (requiresApproval) {
        if (!run.approval || run.approval.digest !== op.requestDigest || run.approval.decision !== 'approve' || run.approval.expires <= Date.now()) throw new Error('invalid-approval');
        run.approval.consumed = true;
      }
      // Synthetic model/effect costs each reserve one unit per possible charged attempt.
      const cost = contract.tool === 'read' ? 0 : 1;
      if (Object.values(run.operations).reduce((sum, item) => sum + item.reserved, 0) + cost > run.budget) throw new Error('budget-exceeded');
      op.reserved += cost;
      op.attempts++;
      op.status = 'dispatched';
    });
    await barrier('dispatched:' + slot);
    let result: unknown;
    try { result = await request('/' + contract.tool, { id: op.id, digest: op.requestDigest, input }); }
    catch (error) {
      update('uncertain:' + slot, run => { run.operations[slot]!.status = 'unknown'; if (contract.effect === 'nonreplayable-external') run.state = 'needs-attention'; });
      throw error;
    }
    await barrier('response:' + slot);
    validateResult(contract.tool, result);
    update('result:' + slot, run => { Object.assign(run.operations[slot]!, { status: 'succeeded', result }); });
    await barrier('result:' + slot);
    return result;
  }
  try {
    const initial = read();
    if ((expected?.account && expected.account !== initial.account) || (expected?.contract && digest(expected.contract) !== digest(initial.contract))) throw new Error('execution-diverged');
    if (initial.state === 'succeeded' || initial.state === 'cancelled' || initial.state === 'paused' || initial.state === 'needs-attention') return;
    eligible(initial);
    await operation('model', manifest.model!, { fixture: 'approval-child-effect-v1' });
    await barrier('model-committed');
    const effectInput = { text: 'synthetic-private-payload' };
    const effectDigest = digest({ input: effectInput, contract: initial.contract, account: initial.account });
    update('approval-wait', run => {
      eligible(run);
      if (!run.approval) run.approval = { digest: effectDigest, expires: run.deadline, consumed: false };
      if (run.approval.digest !== effectDigest) throw new Error('execution-diverged');
      if (!run.approval.decision) run.state = 'waiting-approval';
    });
    await barrier('waiting-approval');
    if (!read().approval?.decision) return;
    update('child-admitted', run => {
      eligible(run);
      if (!run.child) run.child = { id: id + ':child', joined: false };
    });
    await barrier('child-admitted');
    // Child identity + results live under the same root owner and budget in this minimal fixture.
    const first = await operation('read:0', manifest.read!, { query: 'same-query' });
    const second = await operation('read:1', manifest.read!, { query: 'same-query' });
    update('child-result', run => { eligible(run); run.child!.result = [first, second]; });
    await barrier('child-result');
    if (!read().child!.joined) update('child-joined', run => {
      eligible(run);
      if (run.child?.result?.length !== 2) throw new Error('invalid-child-output');
      run.child.joined = true;
    });
    const effect = await operation('effect', initial.contract, effectInput, true);
    await barrier('before-success');
    update('succeeded', run => { eligible(run); if (!run.child?.joined) throw new Error('child-not-joined'); run.output = effect; run.state = 'succeeded'; });
  } finally { journal.release(id, epoch); }
}
