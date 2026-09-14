import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { BRAIN_FIELDS, validatedManageArtistBrainSchema, type ManageArtistBrainInput } from '@craft-agent/session-tools-core';
import { artistProfileDoc, artistVoiceDoc, artistBrandingDoc } from '@craft-agent/shared/artist-context';
import { canAgentAccessContextDoc, getContextDocFile, loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context';
import { assertTeamPermission } from '@craft-agent/shared/workspaces';
import { withWorkspaceContextLock } from '../scheduled-work/workspace-context-lock';

const definitions = { profile: artistProfileDoc, voice: artistVoiceDoc, branding: artistBrandingDoc };
export async function manageArtistBrain(root: string, raw: ManageArtistBrainInput, agentSlug: string) {
  const input = validatedManageArtistBrainSchema.parse(raw);
  if (input.action === 'update') assertTeamPermission(root, 'files.write');
  return withWorkspaceContextLock(root, async () => {
    const definition = definitions[input.topic];
    const doc = loadContextDoc(root, definition.slug);
    // Voice's stock targeted routing serves copywriting specialists. Interactive setup
    // may inspect that stock guide without adding it to every helper prompt.
    const stockVoice = input.topic === 'voice' && agentSlug === 'setup-concierge' && doc?.metadata.enabled
      && !doc.metadata.private && JSON.stringify(doc.metadata.routing) === JSON.stringify(artistVoiceDoc.metadata().routing);
    if (doc && !stockVoice && !canAgentAccessContextDoc(doc, agentSlug)) throw new Error('This Brain section is disabled or not available to this agent.');
    if ((!doc && existsSync(getContextDocFile(root, definition.slug))) || doc?.parseWarnings?.length) throw new Error('This Brain section could not be read safely. Nothing was changed.');
    const fenced = doc?.body.match(/```json\s*([\s\S]*?)```/i)?.[1];
    const firstBrace = doc?.body.indexOf('{') ?? -1;
    const lastBrace = doc?.body.lastIndexOf('}') ?? -1;
    const json = fenced ?? (firstBrace >= 0 && lastBrace > firstBrace ? doc!.body.slice(firstBrace, lastBrace + 1) : undefined);
    let record: Record<string, unknown>;
    if (json) {
      try { record = JSON.parse(json); } catch { throw new Error('This Brain section contains invalid JSON. Nothing was changed.'); }
      if (!record || Array.isArray(record) || record.version !== 1) throw new Error('This Brain section has an unsupported format.');
      for (const field of BRAIN_FIELDS[input.topic]) if (record[field] !== undefined && typeof record[field] !== 'string') throw new Error(`Invalid saved field: ${field}. Nothing was changed.`);
    } else {
      const parsed = definition.parse(doc ?? undefined);
      if (!parsed.ok) throw new Error(parsed.error);
      record = { ...parsed.value };
    }
    const revision = createHash('sha256').update(JSON.stringify({body:doc?.body ?? null,metadata:doc?.metadata ?? null})).digest('hex');
    const fields = BRAIN_FIELDS[input.topic];
    if (input.action === 'read') {
      const values = Object.fromEntries(fields.map(field => [field, record[field] ?? null]));
      if (JSON.stringify(values).length > 70000) throw new Error('This Brain section is too large for conversational setup. Open Brain to review it.');
      return { topic: input.topic, revision, fields, values };
    }
    if (input.expectedRevision !== revision) throw new Error('Brain changed since you read it. Read again and reconcile the latest values before saving.');
    for (const [field,value] of Object.entries(input.changes!)) {
      if (value === null) delete record[field]; else record[field] = value;
    }
    record.updatedAt = new Date().toISOString();
    const serialized = JSON.stringify(record,null,2);
    // Preserve extra properties and prose. Legacy intake text remains as reference.
    const body = json ? doc!.body.replace(json, () => serialized)
      : `${doc?.body ?? ''}\n\n\`\`\`json\n${serialized}\n\`\`\``;
    upsertContextDoc(root,{slug:definition.slug,metadata:doc?.metadata ?? definition.metadata(),body});
    return { saved: true, topic: input.topic, updatedFields: Object.keys(input.changes!) };
  });
}
