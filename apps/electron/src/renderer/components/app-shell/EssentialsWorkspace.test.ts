import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Essentials workspace', () => {
  const source = readFileSync(join(import.meta.dir, 'ArtistCommandCenterHome.tsx'), 'utf8')

  test('keeps optional release plays behind progressive disclosure', () => {
    expect(source).toContain('More options')
    expect(source).toContain("const optionalItems = category.items.filter((item) => item.tier !== 'core')")
    expect(source).toContain('setReleaseBoardItemIncluded')
    expect(source).toContain('isReleaseBoardItemIncluded')
  })

  test('keeps each row to one quiet action control while preserving honest work states', () => {
    expect(source).toContain('<Play className="h-2.5 w-2.5 fill-current" />')
    expect(source).toContain('Choose an action for ${item.label}')
    expect(source).toContain('Use {actionChoice.targetName}')
    expect(source).toContain('Add existing file')
    expect(source).toContain('item.linkedSessionId')
    expect(source).toContain("item.status === 'in-progress' && action?.kind === 'agent'")
    expect(source).toContain('Open the ${item.label} worker chat')
    expect(source).toContain('routes.view.allSessions(item.linkedSessionId)')
    expect(source).toContain('findReleaseBoardWorkerSession')
    expect(source).toContain("{included ? 'Remove' : 'Add'}")
    expect(source).toContain("? 'In progress'")
    expect(source).toContain("? 'Review'")
    expect(source).toContain("? 'Approved' : 'Done'")
    expect(source).toContain('Mark ready for review')
    expect(source).toContain('Confirm done')
    expect(source).toContain('Not applicable to this release')
    expect(source).toContain('reserved Artist OS Release Manager identity is occupied')
    expect(source).not.toContain('>Run workflow<')
    expect(source).not.toContain('>Start worker<')
    expect(source).not.toContain('>Transcribe<')
    expect(source).not.toContain('Mark this item not applicable')
    expect(source).not.toContain('Remove ${item.label} from this release')
  })
})
