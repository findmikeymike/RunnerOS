export const BRANDING_FIELDS = ['creativeDna', 'tensions', 'fascinations', 'reactionHooks', 'mythology', 'emotionalTerritory', 'audienceGravity', 'notes'] as const;
export type BrandingField = typeof BRANDING_FIELDS[number];
export interface BrandingAttachmentInput { title: string; body: string; sourceOutputId?: string }
export interface BrandingAttachment extends BrandingAttachmentInput { id: string; createdAt: string }
export interface BrandingPatch { field: BrandingField; before: string; after: string }
export interface BrandingProposal { id: string; title: string; createdAt: string; patches: BrandingPatch[]; additions: BrandingAttachment[]; status: 'pending' | 'applied' | 'dismissed'; sourceSessionId?: string }
export interface BrandingHistoryEntry { id: string; createdAt: string; action: 'applied' | 'dismissed' | 'attachment-added' | 'attachment-removed'; proposalId?: string; attachment?: BrandingAttachment; previousBody?: string | null }
export interface BrandingState { revision: string; proposals: BrandingProposal[]; attachments: BrandingAttachment[]; history: BrandingHistoryEntry[] }
export interface ProposeBrandingUpdateInput { title: string; patches: BrandingPatch[]; additions?: BrandingAttachmentInput[]; expectedRevision: string; sourceSessionId?: string }
export interface BrandingProposalActionInput { proposalId: string; expectedRevision: string }
export interface AddBrandingAttachmentInput extends BrandingAttachmentInput { expectedRevision: string }
export interface RemoveBrandingAttachmentInput { attachmentId: string; expectedRevision: string }
