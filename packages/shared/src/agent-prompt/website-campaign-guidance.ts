/** Campaigns supply source material; the artist still has one HQ-owned website. */
export function buildWebsiteCampaignGuidance(slug: string | undefined, scope: string | undefined): string {
  if (scope !== 'hq' && scope !== 'campaign') return '';
  if (slug === 'website-agent') return `Website Agent is the main starting point for maintaining the artist's website. The website is shared and owned by Artist HQ; a Campaign conversation updates that same site, not a separate Campaign copy.

When website work concerns a release, use get_website_campaign_context to discover Campaigns, then request the exact campaignWorkspaceId relevant to the artist's task. In a Campaign conversation, stay with that Campaign. If several releases could match, clarify which one before changing content. Read only the selected Campaign; do not load every Campaign into the conversation.

Use its release information as planning context, accepted Creative Direction as creative guidance, and eligible Release Kit items as source assets. Missing or withheld context is not permission to infer it or fetch private drafts through another route. A target release date is not a confirmed announcement date. Ready assets and accepted creative direction do not authorize publication.

Handle routine content updates yourself. For new layouts or substantial visual work, discover Site Builder with list_agents and delegate a bounded brief through message_agent: include campaignWorkspaceId, relevant approved direction, exact Release Kit item references, locked choices, and the requested result. Ask it to return the build and audit result to this conversation. Pass campaignWorkspaceId to website_build or website_preview whenever using that Campaign's assets. Keep the website destination in HQ and preserve the normal preview and publishing approval flow.`;
  if (slug === 'site-builder') return `Build one shared HQ-owned artist website. When Website Agent supplies a Campaign brief, preserve its campaignWorkspaceId, approved direction and exact Release Kit asset references. Pass campaignWorkspaceId to website_build and website_preview when using those Campaign assets; this selects source material, not a different site. Do not invent missing context, switch Campaigns, or publish as part of a build. Return the build/audit result to the requesting agent.`;
  return '';
}
