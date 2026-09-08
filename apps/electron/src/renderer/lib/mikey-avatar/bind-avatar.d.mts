import type { Object3D } from 'three'
export interface AvatarPose { morphs: Record<string, number>; gaze?: { x: number; y: number } }
export function bindAvatar(root: Object3D): {
  apply(pose: AvatarPose): boolean
  reset(): boolean
  dispose(): void
}
