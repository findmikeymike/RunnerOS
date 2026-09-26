import { describe, expect, it, mock } from 'bun:test'
import { PiAgent } from '../pi-agent.ts'

function streamingAgent(writable: boolean) {
  const agent = Object.create(PiAgent.prototype) as any
  agent.config = {}
  agent._isProcessing = true
  agent.debug = mock(() => {})
  agent.subprocess = { stdin: { writable, write: mock(() => true) } }
  return agent
}

describe('Pi steering transport acceptance', () => {
  it('rejects updates when a subprocess exists but stdin is no longer writable', () => {
    const agent = streamingAgent(false)
    expect(agent.redirect('Keep this update', 'original-id')).toBe(false)
    expect(agent.subprocess.stdin.write).not.toHaveBeenCalled()
  })

  it('reports synchronous failed writes as unaccepted so the host can queue the original message', () => {
    const agent = streamingAgent(true)
    agent.subprocess.stdin.write.mockImplementation(() => { throw new Error('closed pipe') })
    expect(agent.redirect('Keep this update')).toBe(false)
  })

  it('accepts a buffered write without claiming provider consumption', () => {
    const agent = streamingAgent(true)
    agent.subprocess.stdin.write.mockReturnValue(false) // Node backpressure still accepts the bytes.
    expect(agent.redirect('Use acoustic')).toBe(true)
    expect(agent.subprocess.stdin.write).toHaveBeenCalledWith('{"type":"steer","message":"Use acoustic"}\n')
    expect(agent.takePendingSteers()).toEqual([])
  })

  it('keeps durable execution on its separate queued-control path', () => {
    const agent = streamingAgent(true)
    agent.config.durableExecution = {}
    expect(agent.redirect('Durable update')).toBe(false)
    expect(agent.subprocess.stdin.write).not.toHaveBeenCalled()
  })
})
