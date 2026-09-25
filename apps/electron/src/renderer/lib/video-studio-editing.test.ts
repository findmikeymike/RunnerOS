import { buildScenePlan, sceneAtTime } from '../../../../../tools/video-studio/lib/scene-plan.mjs'
import { describe, expect, test } from 'bun:test'
import type { VideoClip } from '@craft-agent/shared/video'
import { createVideoAgentHandoff, videoAgentPromptKey, previewMediaTime, previewTimelineTime, previewPlaybackRate, videoCompositionFingerprint, renderedPreviewFreshness, sourceInAfterLeadingTrim, clipPlaybackSpeed, previewClipSourceTime, timelineMsFromPreviewVideoTime, splitVideoClip, sliceVideoClipMetadata, videoProjectFingerprint, isExternalVideoProjectChange, nextPreviewClip, requireVideoProjectWrite } from './video-studio-editing'

const clip = (speed = 1): VideoClip => ({ id: 'a', type: 'video', startMs: 1000, durationMs: 4000, sourceInMs: 500, sourceOutMs: 10500, speed })

describe('Video Studio editor safety', () => {
  test('unrelated output events and own in-flight save do not create conflicts', () => {
    const saved = videoProjectFingerprint('{"id":"a","version":1}')
    const pending = videoProjectFingerprint('{"id":"a","version":2}')
    expect(isExternalVideoProjectChange('{ "id": "a", "version": 1 }', saved, pending)).toBe(false)
    expect(isExternalVideoProjectChange('{"id":"a","version":2}', saved, pending)).toBe(false)
    expect(isExternalVideoProjectChange('{"id":"a","version":3}', saved, pending)).toBe(true)
  })
  test('missing or unsuccessful save bridge fails without continuing', async () => {
    await expect(requireVideoProjectWrite(undefined)).rejects.toThrow('unavailable')
    await expect(requireVideoProjectWrite(async () => false)).rejects.toThrow('not saved')
    await expect(requireVideoProjectWrite(async () => { throw new Error('disk full') })).rejects.toThrow('disk full')
    await expect(requireVideoProjectWrite(async () => true)).resolves.toBeUndefined()
  })
  test.each([0.5, 1, 2, 4])('split preserves source continuity at %s speed', (speed) => {
    const original = clip(speed)
    const [left, right] = splitVideoClip(original, 2000, 'b')
    expect(left.sourceOutMs).toBe(500 + 1000 * speed)
    expect(right.sourceInMs).toBe(left.sourceOutMs)
    expect(right.sourceOutMs).toBe(original.sourceOutMs)
    expect(left.durationMs + right.durationMs).toBe(original.durationMs)
    expect(right.startMs).toBe(left.startMs + left.durationMs)
    expect(previewClipSourceTime(right, 2000)).toBe(previewClipSourceTime(original, 2000))
  })
  test.each([0.5, 1, 2, 4])('preview seeking and playhead round-trip at %s speed', (speed) => {
    const current = clip(speed)
    const sourceSeconds = previewClipSourceTime(current, 2750)
    expect(sourceSeconds).toBe((500 + 1750 * speed) / 1000)
    expect(timelineMsFromPreviewVideoTime(current, sourceSeconds)).toBe(2750)
  })
  test('touching next clips are not skipped during handoff', () => {
    const next = { clip: { startMs: 5000 } }
    const later = { clip: { startMs: 7000 } }
    expect(nextPreviewClip([next, later], 5000)).toBe(next)
    expect(nextPreviewClip([next, later], 5001)).toBe(later)
  })
  test('invalid speeds use safe normal playback and boundary splits fail', () => {
    expect(clipPlaybackSpeed({ speed: 0 })).toBe(1)
    expect(clipPlaybackSpeed({ speed: NaN })).toBe(1)
    expect(() => splitVideoClip(clip(), 1000, 'b')).toThrow('inside')
    expect(() => splitVideoClip(clip(), 5000, 'b')).toThrow('inside')
  })
})

test('leading trim consumes source time at playback speed in both directions', () => {
  expect(sourceInAfterLeadingTrim({ speed: 2 }, 3000, 500)).toBe(4000)
  expect(sourceInAfterLeadingTrim({ speed: 0.5 }, 3000, 500)).toBe(3250)
  expect(sourceInAfterLeadingTrim({ speed: 2 }, 3000, -500)).toBe(2000)
  expect(sourceInAfterLeadingTrim({ speed: 2 }, 3000, -2000)).toBe(0)
})


describe('Video Studio rendered result review', () => {
  test('rendered video uses its own clock and normal rate instead of applying source speed twice', () => {
    const spedUp = clip(2)
    expect(previewMediaTime('source', spedUp, 2500)).toBe(3.5)
    expect(previewMediaTime('rendered', spedUp, 2500)).toBe(2.5)
    expect(previewTimelineTime('source', spedUp, 3.5)).toBe(2500)
    expect(previewTimelineTime('rendered', spedUp, 3.5)).toBe(3500)
    expect(previewPlaybackRate('source', spedUp)).toBe(2)
    expect(previewPlaybackRate('rendered', spedUp)).toBe(1)
    expect(previewMediaTime('rendered', null, 2500)).toBe(2.5)
  })
  test('render freshness ignores save/export bookkeeping but detects composition edits', () => {
    const project = { title: 'Cut', settings: { width: 1920 }, timeline: { tracks: [clip()] }, versions: [], exports: [], updatedAt: 'before' }
    const rendered = videoCompositionFingerprint(JSON.stringify(project))
    expect(renderedPreviewFreshness(JSON.stringify({ ...project, versions: ['save'], exports: ['result'], updatedAt: 'after' }), rendered)).toBe('current')
    expect(renderedPreviewFreshness(JSON.stringify({ ...project, timeline: { tracks: [clip(2)] } }), rendered)).toBe('edited')
    expect(renderedPreviewFreshness(JSON.stringify({ ...project, settings: { width: 1080 } }), rendered)).toBe('edited')
    expect(renderedPreviewFreshness('{unfinished', rendered)).toBe('edited')
    expect(renderedPreviewFreshness(JSON.stringify(project), null)).toBe('unknown')
  })
})


describe('video agent handoff sequencing', () => {
  const result = { ok: true, status: 'started' as const, outputId: 'out', sessionId: 'session', message: 'Message saved' }
  test('busy is claimed before save and double clicks cannot create a second session', async () => {
    const launch = createVideoAgentHandoff()
    let release!: (saved: boolean) => void
    const pendingSave = new Promise<boolean>(resolve => { release = resolve })
    const calls: string[] = []
    const actions = {
      onBusy: (busy: boolean) => calls.push(`busy:${busy}`),
      save: () => { calls.push('save'); return pendingSave },
      launch: async () => { calls.push('launch'); return result },
    }
    const first = launch(actions)
    expect(calls).toEqual(['busy:true', 'save'])
    expect(await launch(actions)).toBeNull()
    release(true)
    expect(await first).toEqual(result)
    expect(calls).toEqual(['busy:true', 'save', 'launch', 'busy:false'])
  })
  test('save failure releases gate and does not launch or clear caller prompt', async () => {
    const launch = createVideoAgentHandoff()
    let sends = 0
    const busy: boolean[] = []
    await expect(launch({ onBusy: value => busy.push(value), save: async () => { throw new Error('disk full') }, launch: async () => { sends++; return result } })).rejects.toThrow('disk full')
    expect(sends).toBe(0)
    expect(busy).toEqual([true, false])
    expect(await launch({ onBusy: () => {}, save: async () => true, launch: async () => result })).toEqual(result)
  })
  test('declined save and absent bridge do not pretend an agent started', async () => {
    const launch = createVideoAgentHandoff()
    expect(await launch({ onBusy: () => {}, save: async () => false, launch: async () => { throw new Error('must not run') } })).toBeNull()
    await expect(launch({ onBusy: () => {}, save: async () => true, launch: async () => undefined })).rejects.toThrow('unavailable')
  })
  test('draft handoff preserves exact composer input and pending never invents an accepted send', async () => {
    const launch = createVideoAgentHandoff()
    const draft = { ...result, status: 'draft' as const, draftInput: 'Complete video-edit context\nRetry this edit' }
    expect(await launch({ onBusy: () => {}, save: async () => true, launch: async () => draft })).toEqual(draft)
    const pending = { ...result, status: 'pending' as const }
    expect((await launch({ onBusy: () => {}, save: async () => true, launch: async () => pending }))?.status).toBe('pending')
  })
  test('retry prompts remain scoped to workspace and output', () => {
    expect(videoAgentPromptKey('a:b', 'c')).not.toBe(videoAgentPromptKey('a', 'b:c'))
    expect(videoAgentPromptKey('workspace', 'one')).not.toBe(videoAgentPromptKey('workspace', 'two'))
  })
})


describe('timed metadata survives cuts', () => {
  const animated = (): VideoClip => ({ ...clip(), transform: {x: -20,y:0,scale:1,rotateDeg:0}, keyframes: [
    {property:'x', timeMs:2000, value:80}, {property:'x', timeMs:4000, value:0},
    {property:'y', timeMs:0, value:10}, {property:'y', timeMs:4000, value:50},
  ] })
  test('split interpolates boundary keys and rebases each half', () => {
    const original=animated(), [left,right]=splitVideoClip(original,2000,'b')
    expect(left.keyframes!.find(key=>key.property==='x' && key.timeMs===1000)?.value).toBe(30)
    expect(right.keyframes!.find(key=>key.property==='x' && key.timeMs===0)?.value).toBe(30)
    expect(right.keyframes!.find(key=>key.property==='x' && key.timeMs===1000)?.value).toBe(80)
    expect([...left.keyframes!,...right.keyframes!].every(key=>key.timeMs<=3000)).toBe(true)
    expect(original.keyframes![1]!.timeMs).toBe(4000)
  })
  test('drag reversal uses original baseline and restores original animation', () => {
    const original=animated()
    const short=sliceVideoClipMetadata(original,0,1000)
    const reversed=sliceVideoClipMetadata(original,0,4000)
    expect(short.keyframes!.every(key=>key.timeMs<=1000)).toBe(true)
    expect(reversed.keyframes!.find(key=>key.property==='x' && key.timeMs===2000)?.value).toBe(80)
    const leading=sliceVideoClipMetadata(original,1000,3000)
    expect(leading.keyframes!.find(key=>key.property==='x' && key.timeMs===0)?.value).toBe(30)
  })
  test('caption split and repeated trim retain immutable original timing', () => {
    const original: VideoClip={id:'captions',type:'caption',startMs:0,durationMs:4000,captionCueIds:['a','b']}
    const [left,right]=splitVideoClip(original,2000,'right')
    expect(left.captionSource).toEqual({offsetMs:0,durationMs:4000})
    expect(right.captionSource).toEqual({offsetMs:2000,durationMs:4000})
    expect(sliceVideoClipMetadata(right,500,1500).captionSource).toEqual({offsetMs:2500,durationMs:4000})
    expect(original.captionSource).toBeUndefined()
  })
})


test('split remains renderable and preserves sampled animation and caption output', () => {
  const animation: VideoClip={id:'v',mediaId:'m',type:'video',startMs:0,durationMs:4000,transform:{x:-80,y:0,scale:1,rotateDeg:0},keyframes:[{property:'x',timeMs:4000,value:80}]}
  const caption: VideoClip={id:'cap',type:'caption',startMs:0,durationMs:4000,captionCueIds:['a','b']}
  const project:any={title:'Cut',settings:{width:320,height:240},media:[{id:'m',type:'video',path:'m.mp4',durationMs:4000,width:320,height:240}],timeline:{durationMs:4000,tracks:[{id:'v',clips:[animation]},{id:'c',clips:[caption]}]},captions:[{cues:[{id:'a',startMs:0,durationMs:2000,text:'FIRST'},{id:'b',startMs:2000,durationMs:2000,text:'SECOND'}]}]}
  const before=buildScenePlan(project)
  project.timeline.tracks[0].clips=splitVideoClip(animation,2000,'v2')
  project.timeline.tracks[1].clips=splitVideoClip(caption,2000,'c2')
  const after=buildScenePlan(project)
  expect(after.issues).toEqual([])
  expect(after.captions).toEqual(before.captions)
  for(const time of [0,999,1999,2001,2500,3999]) expect(sceneAtTime(after,time).visuals[0]!.geometry.x).toBeCloseTo(sceneAtTime(before,time).visuals[0]!.geometry.x,8)
  const second=project.timeline.tracks[1].clips[1]
  project.timeline.tracks[1].clips=[...splitVideoClip(second,3000,'c3')]
  expect(buildScenePlan(project).captions.map(c=>[c.text,c.startMs,c.endMs])).toEqual([['SECOND',2000,3000],['SECOND',3000,4000]])
  const tail=sliceVideoClipMetadata(caption,3900,100)
  project.timeline.tracks[1].clips=[{...tail,startMs:3900}]
  expect(buildScenePlan(project).captions.map(c=>[c.text,c.startMs,c.endMs])).toEqual([['SECOND',3900,4000]])
  const single={...caption,captionCueIds:['a']}
  project.timeline.tracks[1].clips=splitVideoClip(single,2000,'single2')
  expect(buildScenePlan(project).captions.map(c=>[c.text,c.startMs,c.endMs])).toEqual([['FIRST',0,2000],['FIRST',2000,4000]])
  const extended=sliceVideoClipMetadata(caption,-1000,5000)
  project.timeline.tracks[1].clips=[{...extended,startMs:0}]
  expect(buildScenePlan(project).captions.map(c=>[c.text,c.startMs,c.endMs])).toEqual([['FIRST',1000,3000],['SECOND',3000,5000]])
})

test('slicing never silently repairs unsupported keyframes', () => {
  for(const key of [{property:'opacity',timeMs:1000,value:1},{property:'x',timeMs:1000,value:1,easing:'ease-in'},{property:'x',timeMs:NaN,value:1}]) {
    const original={...clip(),keyframes:[key]} as VideoClip
    expect(sliceVideoClipMetadata(original,0,1000).keyframes).toBe(original.keyframes)
  }
})

describe('trailing trim source bounds', () => {
  test.each([0.5, 1, 2, 4])('uses earliest source end and speed %s', async speed => {
    const { availableClipSourceMs, maximumClipDurationMs, boundedTrailingTrimDuration } = await import('../../../../../tools/video-studio/lib/clip-editing.mjs');
    const c = { ...clip(speed), sourceInMs: 500, sourceOutMs: 10500 };
    const media = { type: 'video', durationMs: 6500 };
    expect(availableClipSourceMs(c, media)).toBe(6000);
    expect(maximumClipDurationMs(c, media)).toBe(6000 / speed);
    expect(boundedTrailingTrimDuration(c, media, 99999, undefined, true)).toBe(6000 / speed);
    expect(boundedTrailingTrimDuration(c, media, 99999, 1200, false)).toBe(200);
    expect(maximumClipDurationMs({ ...c, sourceOutMs: 2500 }, media)).toBe(2000 / speed);
  });
  test('short, exhausted, unknown and still sources retain their distinct limits', async () => {
    const { maximumClipDurationMs, boundedTrailingTrimDuration } = await import('../../../../../tools/video-studio/lib/clip-editing.mjs');
    const c = { ...clip(2), durationMs: 20, sourceInMs: 500, sourceOutMs: 600 };
    expect(boundedTrailingTrimDuration(c, undefined, 9999)).toBe(50);
    expect(boundedTrailingTrimDuration(c, undefined, 1)).toBe(50);
    expect(maximumClipDurationMs(c, { type: 'video', durationMs: 500 })).toBe(0);
    expect(boundedTrailingTrimDuration(c, { type: 'video', durationMs: 500 }, 9999)).toBe(20);
    expect(maximumClipDurationMs({ type: 'video' })).toBe(Infinity);
    expect(maximumClipDurationMs({ type: 'audio', sourceOutMs: 1200, speed: 2 })).toBe(600);
    for (const type of ['image', 'text', 'caption']) expect(maximumClipDurationMs({ ...c, type }, { type, durationMs: 10 })).toBe(Infinity);
  });
});
