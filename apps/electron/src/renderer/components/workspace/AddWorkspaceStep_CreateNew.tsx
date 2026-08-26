import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { slugify } from "@/lib/slugify"
import { Input } from "../ui/input"
import { Button } from "../ui/button"
import { AddWorkspaceContainer, AddWorkspaceStepHeader, AddWorkspaceSecondaryButton, AddWorkspacePrimaryButton } from "./primitives"
import { AddWorkspace_RadioOption } from "./AddWorkspace_RadioOption"
import { useDirectoryPicker } from "@/hooks/useDirectoryPicker"
import { ServerDirectoryBrowser } from "@/components/ServerDirectoryBrowser"
import { PRODUCT_NAME } from "@/lib/product-identity"

type LocationOption = 'default' | 'custom'
type WorkspacePurpose = 'general' | 'campaign' | 'lab'

interface AddWorkspaceStep_CreateNewProps {
  onBack: () => void
  onCreate: (folderPath: string, name: string, purpose: WorkspacePurpose) => Promise<void>
  isCreating: boolean
  initialName?: string
  initialPurpose?: WorkspacePurpose
}

/**
 * AddWorkspaceStep_CreateNew - Create a new workspace
 *
 * Fields:
 * - Workspace name (required)
 * - Location: Default product workspace folder or Custom
 */
export function AddWorkspaceStep_CreateNew({
  onBack,
  onCreate,
  isCreating,
  initialName = '',
  initialPurpose,
}: AddWorkspaceStep_CreateNewProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(initialName)
  const [purpose, setPurpose] = useState<WorkspacePurpose>(initialPurpose ?? 'general')
  const [locationOption, setLocationOption] = useState<LocationOption>('default')
  const [customPath, setCustomPath] = useState<string | null>(null)
  const [defaultWorkspacePath, setDefaultWorkspacePath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isValidating, setIsValidating] = useState(false)

  const slug = slugify(name)
  const finalPath = locationOption === 'default'
    ? defaultWorkspacePath
    : customPath && slug
      ? `${customPath}/${slug}`
      : null

  // Validate slug uniqueness when name changes
  useEffect(() => {
    if (!slug) {
      setError(null)
      setDefaultWorkspacePath(null)
      return
    }

    const validateSlug = async () => {
      setIsValidating(true)
      try {
        const result = await window.electronAPI.checkWorkspaceSlug(slug)
        setDefaultWorkspacePath(result.path)
        if (result.exists) {
          setError(`A workspace named "${slug}" already exists`)
        } else {
          setError(null)
        }
      } catch (err) {
        console.error('Failed to validate workspace slug:', err)
        setDefaultWorkspacePath(null)
        setError('Unable to verify the workspace location')
      } finally {
        setIsValidating(false)
      }
    }

    // Debounce validation
    const timeout = setTimeout(validateSlug, 300)
    return () => clearTimeout(timeout)
  }, [slug])

  const handleFolderSelected = useCallback((path: string) => {
    setCustomPath(path)
  }, [])

  const {
    pickDirectory,
    showServerBrowser,
    serverBrowserMode,
    cancelServerBrowser,
    confirmServerBrowser,
  } = useDirectoryPicker(handleFolderSelected)

  const handleCreate = useCallback(async () => {
    if (!name.trim() || !finalPath || error) return
    await onCreate(finalPath, name.trim(), purpose)
  }, [name, finalPath, error, onCreate, purpose])

  const canCreate = name.trim() && finalPath && !error && !isValidating && !isCreating

  return (
    <AddWorkspaceContainer>
      {/* Back button */}
      <button
        onClick={onBack}
        disabled={isCreating}
        className={cn(
          "self-start flex items-center gap-1 text-sm text-muted-foreground",
          "hover:text-foreground transition-colors mb-4",
          isCreating && "opacity-50 cursor-not-allowed"
        )}
      >
        <ArrowLeft className="h-4 w-4" />
        {t("common.back")}
      </button>

      <AddWorkspaceStepHeader
        title={t("workspace.createWorkspace")}
        description={t("workspace.createWorkspaceDesc")}
      />

      <div className="mt-6 w-full space-y-6">
        {/* Workspace name */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground mb-2.5">
            {t("workspace.nameLabel")}
          </label>
          <div className="bg-background shadow-minimal rounded-lg">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("workspace.myWorkspace")}
              disabled={isCreating}
              autoFocus
              className="border-0 bg-transparent shadow-none"
            />
          </div>
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>

        {!initialPurpose && (
          <div className="space-y-3">
            <label className="block text-sm font-medium text-foreground">
              Workspace type
            </label>
            <AddWorkspace_RadioOption
              name="purpose"
              checked={purpose === 'general'}
              onChange={() => setPurpose('general')}
              disabled={isCreating}
              title="General workspace"
              subtitle="A neutral space for operations, trading, or other projects."
            />
            <AddWorkspace_RadioOption
              name="purpose"
              checked={purpose === 'lab'}
              onChange={() => setPurpose('lab')}
              disabled={isCreating}
              title="Creative Lab"
              subtitle="Songwriting, hooks, references, and creative experiments."
            />
            <AddWorkspace_RadioOption
              name="purpose"
              checked={purpose === 'campaign'}
              onChange={() => setPurpose('campaign')}
              disabled={isCreating}
              title="Artist campaign"
              subtitle="A specific release, rollout, single, album, or tour."
            />
          </div>
        )}

        {/* Location selection */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-foreground mb-2.5">
            {t("workspace.locationLabel")}
          </label>

          {/* Default location option */}
          <AddWorkspace_RadioOption
            name="location"
            checked={locationOption === 'default'}
            onChange={() => setLocationOption('default')}
            disabled={isCreating}
            title={t("workspace.defaultLocation")}
            subtitle={t("workspace.underDefaultFolder", { folder: PRODUCT_NAME })}
          />

          {/* Custom location option */}
          <AddWorkspace_RadioOption
            name="location"
            checked={locationOption === 'custom'}
            onChange={() => setLocationOption('custom')}
            disabled={isCreating}
            title={t("workspace.chooseLocation")}
            subtitle={customPath || t("workspace.pickLocation")}
            action={locationOption === 'custom' ? (
              <AddWorkspaceSecondaryButton
                onClick={(e) => {
                  e.preventDefault()
                  pickDirectory()
                }}
                disabled={isCreating}
              >
                {t("common.browse")}
              </AddWorkspaceSecondaryButton>
            ) : undefined}
          />
        </div>

        {/* Create button */}
        <AddWorkspacePrimaryButton
          onClick={handleCreate}
          disabled={!canCreate}
          loading={isCreating}
          loadingText={t("workspace.creating")}
        >
          {t("common.create")}
        </AddWorkspacePrimaryButton>
      </div>
      <ServerDirectoryBrowser
        open={showServerBrowser}
        mode={serverBrowserMode}
        onSelect={confirmServerBrowser}
        onCancel={cancelServerBrowser}
      />
    </AddWorkspaceContainer>
  )
}
