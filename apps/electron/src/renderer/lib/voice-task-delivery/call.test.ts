import {test, expect} from 'bun:test'
import {createVoiceWorkCall} from './call'
function fixture() {
  let now = 0, idle = true, supported = true, pending = true, resolve!: (s: 'delivered'|'interrupted'|'failed') => void
  const log: string[] = [], views: unknown[] = [], errors: string[] = []
  const lease = {deliveryId:'d',leaseId:'l',bindingGeneration:1,taskId:'t',attemptId:'a',revision:2,text:'Your draft is saved.',expiresAt:new Date(15000).toISOString()}
  let listener: (event: any) => void = () => {}
  const api: any = {
    invoke: async (r: any) => {
      log.push(r.method)
      if(r.method==='bind')return {bindingId:'b'}
      if(r.method==='snapshot')return {tasks:[],intents:[],cursor:1,pendingDeliveries:pending?[{taskId:'t',attemptId:'a',revision:2}]:[]}
      if(r.method==='claimDelivery'||r.method==='renewDelivery')return lease
      if(r.method==='acknowledgeDelivery'){expect(r.args[1].leaseId).toBe('l');expect(r.args[1].revision).toBe(2);if(r.args[1].outcome==='delivered')pending=false;return {acknowledged:true,outcome:r.args[1].outcome}}
    },
    subscribe:async()=>{},onEvent:(f:any)=>{listener=f;return()=>{log.push('unsubscribe')}},
  }
  const runtime = {
    getExternalAssistantTurnStatus:()=>({supported,idle,idleForMs:idle?700:0}),
    externalAssistantTurn: (_: any): any => {
      log.push('speak')
      if(!idle)return {status:'deferred'}
      return {status:'accepted',delivery:{done:new Promise(r=>{resolve=r}),cancel:()=>{log.push('cancel-speech');resolve('interrupted')}}}
    },
  }
  const call = createVoiceWorkCall({api,sessionId:'focus',runtime,onView:v=>views.push(v),onError:e=>errors.push(e),now:()=>now})
  return {call,api,runtime,log,errors,views,setIdle:(v:boolean)=>{idle=v},setSupported:(v:boolean)=>{supported=v},advance:(n:number)=>{now+=n},finish:(s:'delivered'|'interrupted'|'failed')=>resolve(s),event:()=>listener({bindingId:'b',event:{streamSequence:2}})}
}
async function settle(){for(let i=0;i<20;i++)await Promise.resolve()}
test('foreground speech has priority; only matching consumed delivery acknowledges result',async()=>{
 const f=fixture();try{await f.call.ready;f.setIdle(false);await f.call.tick();expect(f.log).not.toContain('claimDelivery');f.setIdle(true);await f.call.tick();expect(f.log.filter(x=>x==='claimDelivery')).toHaveLength(1);expect(f.log).not.toContain('acknowledgeDelivery');f.finish('delivered');await settle();expect(f.log).toContain('acknowledgeDelivery');await f.call.tick();expect(f.log.filter(x=>x==='speak')).toHaveLength(1)}finally{f.call.stop()}
})
test('lease renews during playback; call stop cancels speech and detaches, never worker execution',async()=>{
 const f=fixture();await f.call.ready;await f.call.tick();f.advance(5000);await f.call.tick();expect(f.log).toContain('renewDelivery');f.call.stop();await settle();expect(f.log).toContain('cancel-speech');expect(f.log).toContain('detach');expect(f.log).not.toContain('cancel')
})
test('missing/not-running SDK does not acquire or consume a pending result',async()=>{
 const f=fixture();try{await f.call.ready;f.setSupported(false);await f.call.tick();expect(f.log).not.toContain('claimDelivery');f.setSupported(true);await f.call.tick();expect(f.log).toContain('speak')}finally{f.call.stop()}
})
test('busy after asynchronous claim keeps same lease and waits for foreground',async()=>{
 const f=fixture();const invoke=f.api.invoke;f.api.invoke=async(r:any)=>{const result=await invoke(r);if(r.method==='claimDelivery')f.setIdle(false);return result}
 try{await f.call.ready;await f.call.tick();expect(f.log.filter(x=>x==='claimDelivery')).toHaveLength(1);expect(f.log).not.toContain('acknowledgeDelivery');f.setIdle(true);await f.call.tick();expect(f.log.filter(x=>x==='claimDelivery')).toHaveLength(1);f.finish('delivered');await settle()}finally{f.call.stop()}
})
test('lost renewal cancels event speech without claiming delivery',async()=>{
 const f=fixture();const invoke=f.api.invoke;f.api.invoke=async(r:any)=>r.method==='renewDelivery'?null:invoke(r)
 try{await f.call.ready;await f.call.tick();f.advance(5000);await f.call.tick();expect(f.log).toContain('cancel-speech');expect(f.errors).toEqual([])}finally{f.call.stop()}
})

test('hung renewal cannot outlive its local lease deadline',async()=>{
 const f=fixture();const invoke=f.api.invoke;let unblock!:()=>void
 f.api.invoke=async(r:any)=>{if(r.method==='renewDelivery')return new Promise(resolve=>{unblock=()=>resolve(null)});return invoke(r)}
 try{await f.call.ready;await f.call.tick();f.advance(5000);const renewing=f.call.tick();await settle();f.advance(11000);await f.call.tick();expect(f.log).toContain('cancel-speech');unblock();await renewing;await settle();expect(f.log.filter(x=>x==='acknowledgeDelivery')).toHaveLength(1)}finally{f.call.stop()}
})
test('unclaimable first twenty do not starve a later pending result',async()=>{
 const f=fixture();const invoke=f.api.invoke;const attempted:string[]=[]
 f.api.invoke=async(r:any)=>{
  if(r.method==='snapshot')return {tasks:[],intents:[],cursor:1,pendingDeliveries:Array.from({length:21},(_,i)=>({taskId:'t'+i,attemptId:'a',revision:2}))}
  if(r.method==='claimDelivery'){attempted.push(r.args[1].taskId);if(r.args[1].taskId!=='t20')return null}
  return invoke(r)
 }
 try{await f.call.ready;for(let i=0;i<21;i++){await f.call.tick();f.advance(200)}expect(attempted).toContain('t20');expect(f.log).toContain('speak')}finally{f.call.stop()}
})

function taskFixture(){
 const f=fixture();const invoke=f.api.invoke;let task:any={taskId:'task',attemptId:'attempt',state:'running',revision:1,outputs:[]};const cancellations:any[]=[]
 f.api.invoke=async(r:any)=>{if(r.method==='snapshot')return {tasks:[task],intents:[],cursor:task.revision,pendingDeliveries:[]};if(r.method==='cancel'){cancellations.push(r.args[1]);return task}return invoke(r)}
 return {...f,cancellations,setTask:(next:any)=>{task={...task,...next}}}
}
test('duplicate cancellation clicks share one in-flight request and uncertain retry preserves identity',async()=>{
 const f=taskFixture();const invoke=f.api.invoke;let reject!: (e:Error)=>void;let first=true
 f.api.invoke=async(r:any)=>{const result=await invoke(r);if(r.method==='cancel'&&first){first=false;return new Promise((_r,no)=>{reject=no})}return result}
 try{await f.call.ready;const a=f.call.cancelTask('task','attempt'),b=f.call.cancelTask('task','attempt');await settle();expect(f.cancellations).toHaveLength(1);const both=Promise.allSettled([a,b]);reject(new Error('lost reply'));await both;await f.call.cancelTask('task','attempt');expect(f.cancellations).toHaveLength(2);expect(f.cancellations[1]).toEqual(f.cancellations[0]);expect(f.log).not.toContain('cancel-speech');expect(f.log).not.toContain('detach')}finally{f.call.stop()}
})
test('successful cancellation request displays only host state, never optimistic cancelled',async()=>{
 const f=taskFixture();try{await f.call.ready;await f.call.cancelTask('task','attempt');expect((f.views.at(-1) as any).tasks[0].state).toBe('running');f.setTask({state:'cancelling',revision:2});await f.call.cancelTask('task','attempt');expect((f.views.at(-1) as any).tasks[0].state).toBe('cancelling')}finally{f.call.stop()}
})
test('stale attempts and detached calls cannot cancel; completed-before-cancel retains output',async()=>{
 const f=taskFixture();await f.call.ready;await expect(f.call.cancelTask('task','other-attempt')).rejects.toThrow();expect(f.cancellations).toHaveLength(0)
 f.setTask({state:'succeeded',revision:2,outputs:[{outputId:'saved'}]});f.advance(2000);await f.call.tick();await f.call.cancelTask('task','attempt');expect(f.cancellations).toHaveLength(0);expect((f.views.at(-1) as any).tasks[0].outputs[0].outputId).toBe('saved');f.call.stop();await expect(f.call.cancelTask('task','attempt')).rejects.toThrow()
})
test('late cancellation response after detach cannot publish task state',async()=>{
 const f=taskFixture();const invoke=f.api.invoke;let release!:()=>void
 f.api.invoke=async(r:any)=>{const result=await invoke(r);if(r.method==='cancel')await new Promise<void>(r=>{release=r});return result}
 await f.call.ready;const request=f.call.cancelTask('task','attempt');await settle();const count=f.views.length;f.call.stop();release();await request;expect(f.views).toHaveLength(count)
})
