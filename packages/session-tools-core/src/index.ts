/**
 * Session Tools Core
 *
 * Shared utilities for session-scoped tools used by both
 * Claude (in-process) and Codex (subprocess) implementations.
 *
 * @packageDocumentation
 */

// Types
export type {
  // Credential types
  CredentialInputMode,

  // Service types
  GoogleService,
  SlackService,
  MicrosoftService,

  // Auth request types
  AuthRequestType,
  BaseAuthRequest,
  CredentialAuthRequest,
  McpOAuthAuthRequest,
  GoogleOAuthAuthRequest,
  SlackOAuthAuthRequest,
  MicrosoftOAuthAuthRequest,
  AuthRequest,
  AuthResult,

  // IPC types
  CallbackMessage,

  // Tool result types
  TextContent,
  ToolResult,

  // Developer feedback
  DeveloperFeedback,

  // Validation types
  ValidationIssue,
  ValidationResult,

  // Source config types
  SourceType,
  McpTransport,
  McpAuthType,
  ApiAuthType,
  McpSourceConfig,
  ApiSourceConfig,
  LocalSourceConfig,
  SourceConfig,
  ConnectionStatus,
} from './types.ts';

// Response helpers
export {
  successResponse,
  errorResponse,
  textContent,
  multiBlockResponse,
} from './response.ts';

// Source helpers
export {
  getSourcePath,
  getSourceConfigPath,
  getSourceGuidePath,
  sourceExists,
  sourceConfigExists,
  loadSourceConfig,
  listSourceSlugs,
  getSkillPath,
  getSkillMdPath,
  skillExists,
  skillMdExists,
  listSkillSlugs,
  generateRequestId,
  // Multi-header credential helpers
  detectCredentialMode,
  getEffectiveHeaderNames,
} from './source-helpers.ts';

export type {
  MessageAgentToolInput,
  MessageAgentToolResult,
} from './handlers/message-agent.ts';

// Validation
export {
  // Result helpers
  validResult,
  invalidResult,
  mergeResults,

  // Formatting
  formatValidationResult,

  // JSON utilities
  readJsonFile,
  validateJsonFileHasFields,
  zodErrorToIssues,

  // Slug validation
  SLUG_REGEX,
  validateSlug,

  // Skill validation
  SkillMetadataSchema,
  validateSkillContent,

  // Source validation
  SOURCE_CONFIG_REQUIRED_FIELDS,
  SOURCE_TYPES,
  validateSourceConfigBasic,
} from './validation.ts';

// Context interface
export type {
  SessionToolContext,
  SessionToolCallbacks,
  FileSystemInterface,
  CredentialManagerInterface,
  ValidatorInterface,
  LoadedSource,
  // MCP validation types
  StdioMcpConfig,
  HttpMcpConfig,
  StdioValidationResult,
  McpValidationResult,
  ApiTestResult,
  // Session self-management types
  SessionInfo,
  SessionListItem,
  ListSessionsOptions,
  ListSessionsResult,
  AgentListItem,
  ListAgentsOptions,
  ListAgentsResult,
  SkillListItem,
  ListSkillsOptions,
  ListSkillsResult,
  WorkflowListItem,
  WorkflowToolDetail,
  ListWorkflowsOptions,
  ListWorkflowsResult,
  DeepResearchRunListItem,
  ListDeepResearchRunsOptions,
  ListDeepResearchRunsResult,
  // list_sources types
  SourceTier,
  SourceListItemType,
  SourceListItemAuthStatus,
  SourceListItem,
  ListSourcesOptions,
  ListSourcesResult,
  ResolvedLabelsResult,
  ResolvedStatusResult,
} from './context.ts';

export { createNodeFileSystem } from './context.ts';

// Handlers
export {
  // SubmitPlan
  handleSubmitPlan,
  // Config Validate
  handleConfigValidate,
  // Skill Validate
  handleSkillValidate,
  // Mermaid Validate
  handleMermaidValidate,
  // Source Test
  handleSourceTest,
  // OAuth Triggers
  handleSourceOAuthTrigger,
  handleGoogleOAuthTrigger,
  handleSlackOAuthTrigger,
  handleMicrosoftOAuthTrigger,
  // Credential Prompt
  handleCredentialPrompt,
  // Save Secret
  handleSaveSecret,
  // Update Preferences
  handleUpdatePreferences,
  // Transform Data
  handleTransformData,
  // Script Sandbox
  handleScriptSandbox,
  // Render Template
  handleRenderTemplate,
  // Send Developer Feedback
  handleSendDeveloperFeedback,
  // Agent catalog
  handleListAgents,
  handleSearchSkillMarketplace,
  handleListSources,
  // Workflows
  handleListWorkflows,
  handleGetWorkflow,
  handleStartWorkflow,
  handleGetWorkflowRun,
  handleCancelWorkflowRun,
  handleStartDeepResearch,
  handleListDeepResearchRuns,
  handleGetDeepResearchRun,
  handleApproveDeepResearchPlan,
  handleReviseDeepResearchPlan,
  handleCancelDeepResearchRun,
  handleCreateWorkflow,
  // Memory
  handleSaveMemory,
  handleUpdateMemory,
  handleForgetMemory,
  handleRecallMemory,
  // Outputs
  handleCreateOutput,
  handleMediaProviderRequest,
  handleCreateLabSong,
  handleSaveLabLyrics,
  handleListLabSongs,
  handleListReleaseKit,
  handleGetReleaseKitItem,
  handlePromoteToReleaseKit,
  handleRemoveFromReleaseKit,
  handleSetReleaseKitPrimary,
  handleListCampaignAssets,
  handleListArtistVault,
  handleListCampaignOutputs,
  handleGetCampaignOutput,
  handleGetAssetRecord,
  // Visual surface
  handleVisualSurface,
  handleVisualSurfaceState,
  handleGetGoal,
  handleCreateGoal,
  handleUpdateGoal,
  handleUpdateTasks,
} from './handlers/index.ts';

export type { SearchSkillMarketplaceArgs } from './handlers/index.ts';

export type {
  CreateGoalToolInput,
  UpdateGoalToolInput,
  UpdateTasksOperation,
  UpdateTasksToolInput,
  SessionTaskRejectionCode,
} from './handlers/index.ts';

export type {
  CreateAgentToolInput,
  CreateAgentToolMetadata,
  CreateAgentResult,
} from './handlers/index.ts';

export {
  handleCreateAgent,
} from './handlers/index.ts';

export type {
  CreateAutomationToolInput,
  CreateAutomationResult,
  CreateAutomationMatcher,
  CreateAutomationAction,
  CreateAutomationPromptAction,
  CreateAutomationWebhookAction,
  CreateAutomationEventName,
} from './handlers/index.ts';

export {
  handleCreateAutomation,
} from './handlers/index.ts';

export type {
  CampaignCalendarWriteToolInput,
  CampaignCalendarWriteResult,
} from './handlers/index.ts';

export {
  handleCampaignCalendarWrite,
} from './handlers/index.ts';

export type {
  ScheduleWorkToolInput,
  ScheduleWorkResult,
  ScheduleWorkExecutionInput,
  ScheduleWorkTriggerInput,
} from './handlers/index.ts';

export { handleScheduleWork } from './handlers/index.ts';
export { handleSupplyWorkInput } from './handlers/index.ts';
export type { SupplyWorkInputToolInput, SupplyWorkInputToolResult } from './handlers/index.ts';
export { handleManageGoalRun } from './handlers/index.ts';
export type { ManageGoalRunToolInput, ManageGoalRunToolResult } from './handlers/index.ts';

export type {
  GetManagerBriefInput,
  GetCampaignBriefInput,
  GetArtistContextInput,
  GetCampaignContextInput,
  ListWorkspaceContextInput,
  GetWorkspaceContextInput,
  SearchArtistNetworkInput,
  ManagerContextToolResult,
} from './handlers/index.ts';

export {
  handleGetManagerBrief,
  handleGetCampaignBrief,
  handleGetArtistContext,
  handleGetCampaignContext,
  handleListWorkspaceContext,
  handleGetWorkspaceContext,
  handleSearchArtistNetwork,
} from './handlers/index.ts';

export type {
  GetWebsiteManifestInput,
  CreateWebsiteInput,
  SetWebsiteContentInput,
  BuildWebsiteInput,
  PreviewWebsiteInput,
  AuditWebsiteInput,
  DeployWebsiteInput,
  RollbackWebsiteInput,
  WebsiteHistoryInput,
  WebsiteStatusInput,
  WebsiteCaptureSyncInput,
  CommunityListContactsInput,
  CommunityStatsInput,
  CommunityDraftEmailInput,
  CommunityRequestSendInput,
  CommunityJobStatusInput,
  CommunityTagContactsInput,
  CommunityToolResult,
  WebsiteDomainSetInput,
  WebsiteDomainCheckInput,
  WebsiteInspectExternalInput,
  WebsiteToolResult,
} from './handlers/index.ts';

export {
  handleGetWebsiteManifest,
  handleCreateWebsite,
  handleSetWebsiteContent,
  handleBuildWebsite,
  handlePreviewWebsite,
  handleAuditWebsite,
} from './handlers/index.ts';

export type {
  CreateWorkflowToolInput,
  CreateWorkflowResult,
  CreateWorkflowMetadata,
  CreateWorkflowStep,
  CreateWorkflowTrigger,
  CreateWorkflowTriggerInput,
} from './handlers/index.ts';

export type {
  SubmitPlanArgs,
  ConfigValidateArgs,
  SkillValidateArgs,
  MermaidValidateArgs,
  SourceTestArgs,
  SourceOAuthTriggerArgs,
  GoogleOAuthTriggerArgs,
  SlackOAuthTriggerArgs,
  MicrosoftOAuthTriggerArgs,
  CredentialPromptArgs,
  SaveSecretToolInput,
  SaveSecretResult,
  SaveSecretTarget,
  UpdatePreferencesArgs,
  TransformDataArgs,
  ScriptSandboxArgs,
  RenderTemplateArgs,
  SendDeveloperFeedbackArgs,
  ListAgentsArgs,
  ListWorkflowsArgs,
  GetWorkflowArgs,
  StartWorkflowArgs,
  GetWorkflowRunArgs,
  CancelWorkflowRunArgs,
  StartDeepResearchArgs,
  ListDeepResearchRunsArgs,
  GetDeepResearchRunArgs,
  ApproveDeepResearchPlanArgs,
  ReviseDeepResearchPlanArgs,
  CancelDeepResearchRunArgs,
  SaveMemoryToolInput,
  UpdateMemoryToolInput,
  ForgetMemoryToolInput,
  RecallMemoryToolInput,
  MemoryMutationResult,
  RecalledMemoryEntry,
  RecallMemoryResult,
  MemoryScope,
  MemoryType,
  CreateOutputToolInput,
  CreateOutputResult,
  PromoteOutputToFinalToolInput,
  PromoteOutputToFinalResult,
  OutputKind,
  OutputAssetRole,
  CreateOutputFileInput,
  CreateOutputLinkInput,
  CreateOutputReceiptInput,
  GetSocialVariantSetToolInput,
  RecordSocialVariantResultToolInput,
  ListUsableSocialVariantsToolInput,
  SocialVariantToolResult,
  PromoteToReleaseKitToolInput,
  ReleaseKitItemToolInput,
  GetAssetRecordToolInput,
  ReleaseKitToolResult,
  ReleaseKitCategory,
  CampaignReleaseKitToolInput,
  GetCampaignOutputToolInput,
  MediaProvider,
  MediaProviderRequestInput,
  MediaRequestMethod,
  CreateLabSongToolInput,
  SaveLabLyricsToolInput,
  ListLabSongsToolInput,
  LabSongCaptureInput,
  LabSongToolResult,
  VisualSurfaceToolInput,
  VisualSurfaceToolResult,
  VisualSurfaceStateCapture,
  VisualSurfaceStateOutput,
  VisualSurfaceStateToolResult,
} from './handlers/index.ts';

// Tool definitions — single source of truth
export {
  // Individual Zod schemas
  SubmitPlanSchema,
  ConfigValidateSchema,
  SkillValidateSchema,
  MermaidValidateSchema,
  SourceTestSchema,
  SourceOAuthTriggerSchema,
  CredentialPromptSchema,
  SaveSecretSchema,
  CallLlmSchema,
  UpdatePreferencesSchema,
  TransformDataSchema,
  ScriptSandboxSchema,
  RenderTemplateSchema,
  ListAgentsSchema,
  ListWorkflowsSchema,
  GetWorkflowSchema,
  StartWorkflowSchema,
  GetWorkflowRunSchema,
  CancelWorkflowRunSchema,
  StartDeepResearchSchema,
  ListDeepResearchRunsSchema,
  GetDeepResearchRunSchema,
  ApproveDeepResearchPlanSchema,
  ReviseDeepResearchPlanSchema,
  CancelDeepResearchRunSchema,
  // Browser tool schema
  BrowserToolSchema,
  // Developer feedback schema
  SendDeveloperFeedbackSchema,
  CreateAgentSchema,
  CampaignCalendarWriteSchema,
  ScheduleWorkSchema,
  GetManagerBriefSchema,
  GetCampaignBriefSchema,
  GetArtistContextSchema,
  GetCampaignContextSchema,
  ListWorkspaceContextSchema,
  GetWorkspaceContextSchema,
  SearchArtistNetworkSchema,
  SaveMemorySchema,
  UpdateMemorySchema,
  ForgetMemorySchema,
  RecallMemorySchema,
  CreateOutputSchema,
  GetSocialVariantSetSchema,
  RecordSocialVariantResultSchema,
  ListUsableSocialVariantsSchema,
  ListReleaseKitSchema,
  GetReleaseKitItemSchema,
  PromoteToReleaseKitSchema,
  RemoveFromReleaseKitSchema,
  SetReleaseKitPrimarySchema,
  ListCampaignAssetsSchema,
  ListArtistVaultSchema,
  ListCampaignOutputsSchema,
  GetCampaignOutputSchema,
  GetAssetRecordSchema,
  MediaProviderRequestSchema,
  CreateLabSongSchema,
  SaveLabLyricsSchema,
  ListLabSongsSchema,
  VisualSurfaceSchema,
  VisualSurfaceStateSchema,
  // Descriptions
  TOOL_DESCRIPTIONS,
  // Registry
  SESSION_TOOL_DEFS,
  SESSION_TOOL_NAMES,
  SESSION_BACKEND_TOOL_NAMES,
  SESSION_REGISTRY_TOOL_NAMES,
  SESSION_SAFE_ALLOWED_TOOL_NAMES,
  SESSION_SAFE_BLOCKED_TOOL_NAMES,
  SESSION_TOOL_REGISTRY,
  // Filtered helper views
  getSessionToolDefs,
  getSessionToolNames,
  getSessionBackendToolNames,
  getSessionRegistryToolNames,
  getSessionToolRegistry,
  getSessionSafeAllowedToolNames,
  getSessionSafeBlockedToolNames,
  // JSON Schema converter
  getToolDefsAsJsonSchema,
} from './tool-defs.ts';

export type {
  SessionToolExecutionMode,
  SessionToolSafeMode,
  SessionToolDef,
  RegistrySessionToolDef,
  BackendSessionToolDef,
  SessionToolHandler,
  JsonSchemaToolDef,
  SessionToolFilterOptions,
  SessionToolNameOptions,
} from './tool-defs.ts';
