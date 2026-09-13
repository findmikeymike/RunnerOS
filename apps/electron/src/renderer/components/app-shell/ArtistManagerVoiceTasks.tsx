import type { VoiceWorkView } from '@/lib/voice-task-delivery/call'
const labels: Record<string, string> = {admitting:'Starting',running:'Working',cancelling:'Cancellation requested',cancelled:'Cancelled',succeeded:'Saved',failed:'Failed',timed_out:'Timed out',interrupted:'Needs review'}
const active = (state: string) => ['admitting','running','cancelling'].includes(state)
export function ArtistManagerVoiceTasks({work,cancelling,attached,onCancel,onOpen,onRetry}: {
  work: VoiceWorkView; cancelling: string[]; attached: boolean
  onCancel(taskId:string,attemptId:string):Promise<void>
  onOpen(taskId:string,outputId:string):Promise<void>
  onRetry(intentId:string):Promise<void>
}) {
  if (!work.tasks.length && !work.unresolved.length) return null
  const tasks = [...work.tasks].reverse().sort((a,b)=>Number(active(b.state))-Number(active(a.state)))
  const button = 'rounded px-2 py-1 text-white underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-40 disabled:no-underline'
  return <section aria-label="Background tasks" className="mx-5 mb-2 max-h-40 shrink-0 space-y-2 overflow-y-auto text-xs">
    {!attached ? <p className="text-white/45">Reconnect to manage tasks. Work can continue after the call.</p> : null}
    {tasks.map(task=>{
      const pending = cancelling.includes(`${task.taskId}:${task.attemptId}`)
      return <details key={task.taskId} className="text-white/65">
        <summary className="cursor-pointer rounded py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"><span>{task.title}</span><span className="ml-2 text-white/45">{labels[task.state] ?? 'Needs review'}</span></summary>
        <div className="space-y-2 pb-2 pl-4">
          <p>Specialist: {task.targetAgentSlug.replaceAll('-', ' ')}</p>
          <p role="status">{pending ? 'Requesting cancellation…' : labels[task.state] ?? 'Needs review'}</p>
          {task.state === 'cancelling' ? <p>Waiting for the worker to stop. Your call can continue.</p> : null}
          {task.state === 'interrupted' ? <p>Execution could not be confirmed. Review the existing task before starting another.</p> : null}
          {task.outputs.map(output=><button key={output.outputId} type="button" disabled={!attached} className={button} onClick={()=>{void onOpen(task.taskId,output.outputId)}}>Open {output.title || 'saved result'}</button>)}
          {active(task.state) ? <button type="button" disabled={!attached || pending || task.state === 'cancelling'} className={button} aria-label={`Cancel task: ${task.title}`} onClick={()=>{void onCancel(task.taskId,task.attemptId)}}>{pending ? 'Requesting…' : task.state === 'cancelling' ? 'Cancellation requested' : 'Cancel task'}</button> : null}
        </div>
      </details>
    })}
    {work.unresolved.map(intent=><div key={intent.intentId} className="flex items-center justify-between gap-3 text-amber-100/80"><span>{intent.title} · {intent.state === 'pending' ? 'Not started' : 'Needs review'}</span>{intent.state === 'pending' ? <button type="button" disabled={!attached} className={button} onClick={()=>{void onRetry(intent.intentId)}}>Start existing request</button> : null}</div>)}
  </section>
}
