/** Slice clip-relative timing from a stable gesture baseline, retaining boundary values. */
export function sliceVideoClipMetadata(clip, offsetMs, durationMs) {
  const next = { ...clip, durationMs }
  const seenKeys = new Set()
  const validKeys = Array.isArray(clip.keyframes) && clip.keyframes.every(key => {
    if (!key || !['x', 'y'].includes(key.property) || !Number.isFinite(key.value) || !Number.isFinite(key.timeMs)
      || key.timeMs < 0 || key.timeMs > clip.durationMs || (key.easing !== undefined && key.easing !== 'linear')) return false
    const id = `${key.property}:${key.timeMs}`
    if (seenKeys.has(id)) return false
    seenKeys.add(id)
    return true
  })
  // Leave unsupported metadata intact so capability validation still rejects it.
  if (validKeys && clip.keyframes?.length) {
    next.keyframes = []
    for (const property of ['x', 'y']) {
      const keys = clip.keyframes.filter(key => key.property === property).sort((a, b) => a.timeMs - b.timeMs)
      if (!keys.length) continue
      const frames = keys[0].timeMs === 0 ? keys : [{ timeMs: 0, property, value: clip.transform?.[property] ?? 0 }, ...keys]
      const valueAt = (time) => {
        if (time <= frames[0].timeMs) return frames[0].value
        for (let i = 1; i < frames.length; i++) {
          const left = frames[i - 1], right = frames[i]
          if (time <= right.timeMs) return left.value + (right.value - left.value) * (time - left.timeMs) / (right.timeMs - left.timeMs)
        }
        return frames[frames.length - 1].value
      }
      const end = offsetMs + durationMs
      next.keyframes.push(
        { property, timeMs: 0, value: valueAt(offsetMs), easing: 'linear' },
        ...frames.filter(key => key.timeMs > offsetMs && key.timeMs < end).map(key => ({ ...key, timeMs: key.timeMs - offsetMs })),
        { property, timeMs: durationMs, value: valueAt(end), easing: 'linear' },
      )
    }
  }
  if (clip.captionCueIds?.length) {
    next.captionSource = {
      durationMs: clip.captionSource?.durationMs ?? clip.durationMs,
      offsetMs: (clip.captionSource?.offsetMs ?? 0) + offsetMs,
    }
  }
  return next
}


/** Undefined means genuinely unknown; zero means the source is exhausted. */
export function availableClipSourceMs(clip, media) {
  if (!['video', 'audio'].includes(media?.type ?? clip.type)) return undefined
  const ends = [clip.sourceOutMs, media?.durationMs].filter(value => Number.isFinite(value) && value >= 0)
  if (!ends.length) return undefined
  const start = Number.isFinite(clip.sourceInMs) ? Math.max(0, clip.sourceInMs) : 0
  return Math.max(0, Math.min(...ends) - start)
}

export function maximumClipDurationMs(clip, media) {
  const available = availableClipSourceMs(clip, media)
  const speed = Number.isFinite(clip.speed) ? Math.min(4, Math.max(0.25, clip.speed)) : 1
  return available === undefined ? Infinity : available / speed
}

export function boundedTrailingTrimDuration(clip, media, requestedMs, nextStartMs, ripple = false) {
  const neighborLimit = !ripple && Number.isFinite(nextStartMs) ? Math.max(0, nextStartMs - clip.startMs) : Infinity
  const maximum = Math.floor(Math.min(maximumClipDurationMs(clip, media), neighborLimit))
  if (maximum <= 0) return clip.durationMs
  const minimum = Math.min(100, maximum)
  return Math.min(maximum, Math.max(minimum, Math.round(requestedMs)))
}
