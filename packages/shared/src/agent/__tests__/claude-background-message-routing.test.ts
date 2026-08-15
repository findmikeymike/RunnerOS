import { describe, expect, it } from 'bun:test'
import { classifyClaudeTaskNotification } from '../backend/claude/task-notification.ts'

describe('classifyClaudeTaskNotification', () => {
  it('normalizes valid terminal notifications', () => {
    expect(classifyClaudeTaskNotification({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'agent-123',
      status: 'failed',
      output_file: '/tmp/output.txt',
      summary: 'failed cleanly',
    })).toEqual({
      kind: 'valid',
      notification: {
        taskId: 'agent-123',
        status: 'failed',
        outputFile: '/tmp/output.txt',
        summary: 'failed cleanly',
      },
    })
  })

  it('detects terminal notifications without task ids', () => {
    expect(classifyClaudeTaskNotification({
      type: 'system',
      subtype: 'task_notification',
      status: 'completed',
    })).toEqual({ kind: 'missing-task-id' })
  })

  it('defaults unknown statuses to completed', () => {
    expect(classifyClaudeTaskNotification({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'agent-future',
      status: 'future-status',
    })).toEqual({
      kind: 'valid',
      notification: { taskId: 'agent-future', status: 'completed' },
    })
  })
})
