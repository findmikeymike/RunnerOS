import { expect, test } from 'bun:test';
import { waitForSafeShutdown } from './shutdown-wait';
test('hung cleanup announces waiting but never resolves or closes dependencies on timeout', async () => {
  let finish!:()=>void, noticed!:()=>void;const cleanup=new Promise<void>(resolve=>finish=resolve),notice=new Promise<void>(resolve=>noticed=resolve);let done=false;
  const waiting=waitForSafeShutdown(cleanup,{waitMs:1,onWaiting:noticed}).then(()=>{done=true});await notice;expect(done).toBe(false);finish();await waiting;expect(done).toBe(true);
});
test('cleanup rejection stays the original failure and retry can finish',async()=>{
  const failure=new Error('storage unavailable');await expect(waitForSafeShutdown(Promise.reject(failure),{waitMs:100,onWaiting:()=>{throw new Error('unexpected')}})).rejects.toBe(failure);
  await waitForSafeShutdown(Promise.resolve(),{waitMs:100,onWaiting:()=>{throw new Error('unexpected')}});
});
test('notice failure cannot falsely complete cleanup or hide its later failure',async()=>{
 let reject!:(error:Error)=>void,noticed!:()=>void;const cleanup=new Promise<void>((_,fail)=>reject=fail),notice=new Promise<void>(resolve=>noticed=resolve);const failure=new Error('late failure');
 const waiting=waitForSafeShutdown(cleanup,{waitMs:1,onWaiting:()=>{noticed();throw new Error('notice unavailable')}});void waiting.catch(()=>{});await notice;reject(failure);await expect(waiting).rejects.toBe(failure);
});
