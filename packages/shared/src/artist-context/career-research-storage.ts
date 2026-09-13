/** Server-only persistence. Keep out of the browser-safe artist-context barrel. */
import type { SharedRecordBaseline } from '../records/types.ts';
import { readSharedRecord, readSharedRecordBaseline, writeSharedRecord } from '../records/storage.ts';
import { deleteContextDoc, upsertContextDoc } from '../workspace-context/storage.ts';
import type { LoadedContextDoc } from '../workspace-context/types.ts';
import {
  ARTIST_CAREER_RESEARCH_COLLECTION,
  ARTIST_CAREER_RESEARCH_ID,
  ARTIST_CAREER_RESEARCH_CONTEXT_SLUG,
  isCareerResearchRecord,
  careerResearchMetadata,
  compileCareerResearchBody,
  type CareerResearchRecord,
  type CareerResearchRecordData,
} from './career-research.ts';

export function readCareerResearchRecord(workspaceRootPath: string): CareerResearchRecord | null {
  const record = readSharedRecord<CareerResearchRecord>(workspaceRootPath, ARTIST_CAREER_RESEARCH_COLLECTION, ARTIST_CAREER_RESEARCH_ID);
  return isCareerResearchRecord(record) ? record : null;
}

export function readCareerResearchBaseline(workspaceRootPath: string): SharedRecordBaseline<CareerResearchRecord> | null {
  return readSharedRecordBaseline<CareerResearchRecord>(workspaceRootPath, ARTIST_CAREER_RESEARCH_COLLECTION, ARTIST_CAREER_RESEARCH_ID);
}

export function writeCareerResearchRecord(
  workspaceRootPath: string,
  data: CareerResearchRecordData,
  options: { machineId: string; baseline?: SharedRecordBaseline<CareerResearchRecord>; now?: string },
) {
  return writeSharedRecord(workspaceRootPath, ARTIST_CAREER_RESEARCH_COLLECTION, ARTIST_CAREER_RESEARCH_ID, data, options);
}

export function rebuildCareerResearchProjection(workspaceRootPath: string): LoadedContextDoc | null {
  const record = readCareerResearchRecord(workspaceRootPath);
  if (!record) {
    deleteContextDoc(workspaceRootPath, ARTIST_CAREER_RESEARCH_CONTEXT_SLUG);
    return null;
  }
  return upsertContextDoc(workspaceRootPath, {
    slug: ARTIST_CAREER_RESEARCH_CONTEXT_SLUG,
    metadata: careerResearchMetadata(record),
    body: compileCareerResearchBody(record),
  });
}

