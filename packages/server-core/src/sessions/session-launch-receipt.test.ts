import { describe, expect, test } from 'bun:test';
import { completeLaunchReceipt } from './session-launch-receipt';
import { createAgentFocusTransferIntent, inheritHostAgentFocus, type SessionLaunchReceipt } from '@craft-agent/shared/sessions';

describe('real SessionManager launch receipt projection', () => {
  const voiceTask = { schemaVersion: 1 as const, workspaceId:'workspace', taskId:'task', attemptId:'attempt', intentId:'intent', admissionKey:'key', requestDigest:'digest', receiptId:'receipt' };
  const receipt:SessionLaunchReceipt = { createdAt:123,origin:'agent',config:{},voiceTask,delegation:{parentSessionId:'real-manager',mechanism:'message-agent',depth:1},injected:{skills:[],sources:[],contextDocs:[]} };
  test('creation keeps immutable cap and durable child/receipt correlation',()=>{
    const projected=completeLaunchReceipt(receipt,{origin:'agent',permissionMode:'allow-all'});
    expect(projected.voiceTask).toEqual(voiceTask);
    expect(projected.delegation).toEqual(receipt.delegation);
    expect(projected.voiceTask).not.toBe(voiceTask);
  });
  test('same-host branch inherits voice cap through actual focus and launch projection',()=>{
    const inherited=inheritHostAgentFocus({launchReceipt:receipt});
    const branch=completeLaunchReceipt(inherited.launchReceipt,{origin:'branch'});
    expect(branch.voiceTask).toEqual(voiceTask);
    expect(branch.delegation?.parentSessionId).toBe('real-manager');
  });
  test('remote transfer cannot drop the voice origin cap',()=>{ expect(()=>createAgentFocusTransferIntent({launchReceipt:receipt})).toThrow('Voice-origin task transfer is unsupported'); });
  test('normal sessions do not gain a voice origin',()=>{
    const normal=completeLaunchReceipt(undefined,{origin:'manual',permissionMode:'ask'});
    expect(normal.voiceTask).toBeUndefined();
  });
});
