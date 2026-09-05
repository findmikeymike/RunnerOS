// Remember voice ownership even after Stop: delayed generic chat retry timers
// must never resurrect a closed voice session. IDs contain no credentials.
const voiceSessions = new Set<string>()
export function markVoiceManagedSession(id: string): void { voiceSessions.add(id) }
export function isVoiceManagedSession(id: string): boolean { return voiceSessions.has(id) }
// Only an explicit user handoff re-enables the ordinary chat continuation path.
export function handVoiceSessionToChat(id: string): void { voiceSessions.delete(id) }
