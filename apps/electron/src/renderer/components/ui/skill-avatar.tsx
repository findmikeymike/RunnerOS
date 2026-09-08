import { useEffect, useState } from 'react'
/**
 * SkillAvatar - Thin wrapper around EntityIcon for skills.
 *
 * Sets fallbackIcon={Zap} and delegates all rendering to EntityIcon.
 * Use `fluid` prop for fill-parent sizing (e.g., Info_Page.Hero).
 */

import { Zap } from 'lucide-react'
import { EntityIcon } from '@/components/ui/entity-icon'
import { useEntityIcon } from '@/lib/icon-cache'
import type { IconSize } from '@craft-agent/shared/icons'
import type { SkillDescriptor } from '../../../shared/types'

interface SkillAvatarProps {
  /** SkillDescriptor object */
  skill: SkillDescriptor
  /** Size variant */
  size?: IconSize
  /** Fill parent container (h-full w-full). Overrides size. */
  fluid?: boolean
  /** Additional className overrides */
  className?: string
  /** Workspace ID for loading local icons */
  workspaceId?: string
  workingDirectory?: string
}

export function SkillAvatar({ skill, size = 'md', fluid, className, workspaceId, workingDirectory }: SkillAvatarProps) {
  const [image, setImage] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setImage(null)
    if (workspaceId && !skill.metadata.icon) void window.electronAPI.getSkillIcon(workspaceId, skill.slug, workingDirectory).then(value => { if (!cancelled) setImage(value) }).catch(() => {})
    return () => { cancelled = true }
  }, [workspaceId, workingDirectory, skill.id, skill.revision, skill.slug, skill.metadata.icon])
  const icon = useEntityIcon({
    workspaceId: workspaceId ?? '',
    entityType: 'skill',
    identifier: skill.slug,

    iconValue: skill.metadata.icon,
  })

  return (
    <EntityIcon
      icon={image ? { kind: 'file', value: image, colorable: false } : icon}
      size={size}
      fallbackIcon={Zap}
      alt={skill.metadata.name}
      className={className}
      containerClassName={fluid ? 'h-full w-full' : undefined}
    />
  )
}
