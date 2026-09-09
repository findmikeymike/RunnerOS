import {expect,test} from 'bun:test';
import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,unlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DurableJournal} from '../../../../../shared/src/durable-execution/index.ts';
import {startProcess} from './process-support.ts';

test('actual Pi child commits native read before SIGKILL; restart joins without another model or read',async()=>{
 const root=mkdtempSync(join(tmpdir(),'child-pi-')),key=randomBytes(32),runId=randomUUID();let requests=0,readResults=0;
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests++;const done=body.messages.some((message:any)=>message.role==='tool');if(done){readResults++;expect(raw).toContain('CHILD_PI_NATIVE_SENTINEL')}
 const delta=done?{role:'assistant',content:'{"summary":"native read verified"}'}:{role:'assistant',tool_calls:[{index:0,id:'native-child-read',type:'function',function:{name:'read',arguments:JSON.stringify({path:join(root,'fixture.txt')})}}]};res.writeHead(200,{'content-type':'text/event-stream'});for(const[value,finish]of[[delta,null],[{},done?'stop':'tool_calls']])res.write(`data: ${JSON.stringify({id:'child-fixture',object:'chat.completion.chunk',created:1,model:'child-pi-fixture',choices:[{index:0,delta:value,finish_reason:finish}]})}\n\n`);res.end('data: [DONE]\n\n')});
 await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes)});const endpoint=`http://127.0.0.1:${(server.address()as{port:number}).port}`;
 writeFileSync(join(root,'synthetic-only'),'child-pi-fixture');writeFileSync(join(root,'fixture.txt'),'CHILD_PI_NATIVE_SENTINEL');writeFileSync(join(root,'input.json'),JSON.stringify({runId,createdAt:Date.now(),deadlineAt:Date.now()+60000}));
 const env={CHILD_PI_TEST_KEY:key.toString('hex'),CRAFT_CONFIG_DIR:join(root,'config'),CRAFT_PRODUCT_VARIANT:'artist-os',CRAFT_BUNDLED_ASSETS_ROOT:resolve(import.meta.dir,'../../../../../../apps/electron/resources')};const worker=join(import.meta.dir,'child-pi-worker.ts');const first=startProcess([worker,root,endpoint,'before-join'],env,process.execPath,25000);
 try{const barrier=JSON.parse(await first.line(line=>line.startsWith('{"barrier":"child-complete"')));expect(requests).toBe(2);expect(readResults).toBe(1);first.child.kill('SIGKILL');expect((await first.done).signal).toBe('SIGKILL');unlinkSync(join(root,'fixture.txt'));
 for(let retry=0;retry<2;retry++){const resumed=await startProcess([worker,root,endpoint,'recover'],env,process.execPath,25000).done;expect({code:resumed.code,error:resumed.code?resumed.stderr:''}).toEqual({code:0,error:''});expect(resumed.stdout).toContain('"status":"joined"');expect(resumed.stdout).toContain(barrier.childRunId);expect(requests).toBe(2);expect(readResults).toBe(1)}
 const journal=new DurableJournal({configRoot:join(root,'config'),key});try{const parent=journal.get(runId,'w');expect(parent.children).toHaveLength(1);expect(parent.children![0]!.status).toBe('joined');expect(parent.children![0]!.result).toEqual({summary:'native read verified'});expect(journal.get(barrier.childRunId,'w').turns[0]!.calls[0]!.attempts).toBe(1)}finally{journal.close()}
 }finally{if(first.child.exitCode===null)first.child.kill('SIGKILL');await first.done;server.closeAllConnections();await new Promise<void>(yes=>server.close(()=>yes()));rmSync(root,{recursive:true,force:true})}
},60000);
