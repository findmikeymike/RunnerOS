import {test,expect} from 'bun:test'
import {playbackHarness} from './playback-harness'
import {createVoiceWorkCall} from './call'
test('call attachment waits through an unrelated actual SDK exchange then acknowledges consumed result audio',async()=>{
 const h=await playbackHarness();let pending=false,acked=false,claims=0;const acks:any[]=[]
 const api:any={onEvent:()=>()=>{},subscribe:async()=>{},invoke:async(r:any)=>{
  if(r.method==='bind')return {bindingId:'b'}
  if(r.method==='snapshot')return {tasks:[],intents:[],cursor:0,pendingDeliveries:pending&&!acked?[{taskId:'t',attemptId:'a',revision:1}]:[]}
  if(r.method==='claimDelivery'){claims++;return {deliveryId:'d',leaseId:'l',bindingGeneration:1,taskId:'t',attemptId:'a',revision:1,text:'Your teaser draft is saved.',expiresAt:new Date(h.now()+15000).toISOString()}}
  if(r.method==='acknowledgeDelivery'){acks.push(r.args[1]);acked=r.args[1].outcome==='delivered';return {acknowledged:true,outcome:r.args[1].outcome}}
 }}
 const call=createVoiceWorkCall({api,sessionId:'focus',runtime:h.runtime,onView:()=>{},onError:()=>{},now:h.now})
 try{
  await call.ready
  await h.runtime.completeUserTranscript('Tell me about rhythm.');pending=true
  await call.tick();expect(claims).toBe(0)
  for(let i=0;i<8;i++){await h.drain();await h.consume(120)}
  await h.advance(2000);await call.tick();await h.advance(700);await call.tick();await h.settle()
  expect(claims).toBe(1);expect(acks).toHaveLength(0)
  for(let i=0;i<8;i++){await h.drain();await h.consume(120)}
  await h.settle();expect(acks).toEqual([expect.objectContaining({deliveryId:'d',leaseId:'l',outcome:'delivered'})])
  expect(h.commands.filter(x=>x==='completeUserTranscript')).toHaveLength(1)
  expect(h.runtime.running).toBe(true)
  const context=JSON.parse(await h.runtime.getContextJson());expect(context.filter((m:any)=>m.role==='user')).toHaveLength(1)
  expect(h.spoken).toEqual(['An ordinary answer about music.','Your teaser draft is saved.'])
 }finally{call.stop();await h.close()}
})
