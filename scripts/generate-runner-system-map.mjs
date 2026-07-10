#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, 'docs', 'system-map');
const STARTER_AGENTS_FILE = join(ROOT, 'packages/shared/src/agent-definitions/starter-templates.ts');
const AGENT_TYPES_FILE = join(ROOT, 'packages/shared/src/agent-definitions/types.ts');
const SYSTEM_SKILLS_FILE = join(ROOT, 'packages/shared/src/skills/system.ts');
const STARTER_SKILLS_FILE = join(ROOT, 'packages/shared/src/skills/starter-templates.ts');
const LAUNCHPAD_FILE = join(ROOT, 'apps/electron/src/renderer/components/app-shell/AgentsLaunchpad.tsx');
const WORKER_DEFAULTS_FILE = join(ROOT, 'apps/electron/src/renderer/lib/worker-defaults.ts');
const RUN_AGENT_FILE = join(ROOT, 'apps/electron/src/renderer/lib/run-agent.ts');
const COMPOSE_AGENT_PROMPT_FILE = join(ROOT, 'apps/electron/src/renderer/lib/compose-agent-prompt.ts');
const SESSION_MANAGER_FILE = join(ROOT, 'packages/server-core/src/sessions/SessionManager.ts');
const SHARED_INTEL_HANDLER_FILE = join(ROOT, 'packages/server-core/src/handlers/rpc/shared-intel.ts');
const SHARED_INTEL_ROUTER_FILE = join(ROOT, 'packages/shared/src/shared-intel/router.ts');
const SHARED_INTEL_TYPES_FILE = join(ROOT, 'packages/shared/src/shared-intel/types.ts');
const TOOL_DEFS_FILE = join(ROOT, 'packages/session-tools-core/src/tool-defs.ts');
const OUTPUT_FINALS_FILE = join(ROOT, 'packages/shared/src/outputs/finals.ts');
const OUTPUT_SERVICE_FILE = join(ROOT, 'packages/server-core/src/outputs/OutputService.ts');
const OUTPUTS_HOOK_FILE = join(ROOT, 'apps/electron/src/renderer/hooks/useOutputs.ts');
const OUTPUT_FINAL_ACTION_DIALOG_FILE = join(ROOT, 'apps/electron/src/renderer/components/outputs/OutputFinalActionDialog.tsx');
const BUNDLED_SKILLS_FILE = join(ROOT, 'packages/shared/src/skills/bundled.generated.ts');
const BUILTIN_SOURCES_FILE = join(ROOT, 'packages/shared/src/sources/builtin-sources.ts');
const STARTER_WORKFLOWS_FILE = join(ROOT, 'packages/shared/src/workflows/starter-templates.ts');
const SCHEDULED_WORK_MODEL_FILE = join(ROOT, 'packages/shared/src/scheduled-work/index.ts');
const SCHEDULED_WORK_HANDLER_FILE = join(ROOT, 'packages/server-core/src/handlers/rpc/scheduled-work.ts');
const SCHEDULED_WORK_RUNNER_FILE = join(ROOT, 'packages/server-core/src/scheduled-work/ScheduledWorkRunner.ts');
const SCHEDULED_WORK_COMPOSER_FILE = join(ROOT, 'apps/electron/src/renderer/components/calendar/ScheduledWorkComposer.tsx');
const CAMPAIGN_CALENDAR_PAGE_FILE = join(ROOT, 'apps/electron/src/renderer/components/app-shell/CampaignCalendarPage.tsx');
const HQ_CALENDAR_FILE = join(ROOT, 'apps/electron/src/renderer/components/app-shell/ArtistHQHome.tsx');
const AUTOMATION_WORK_DIALOG_FILE = join(ROOT, 'apps/electron/src/renderer/components/automations/AutomationWorkDialog.tsx');
const AUTOMATION_WORK_QUEUE_FILE = join(ROOT, 'packages/server-core/src/scheduled-work/AutomationWorkQueue.ts');
const AUTOMATION_QUEUE_HANDLER_FILE = join(ROOT, 'packages/shared/src/automations/handlers/queue-work-handler.ts');
const HNIC_SCHEDULED_WORK_FILE = join(ROOT, 'packages/server-core/src/scheduled-work/HnicScheduledWork.ts');
const SOCIAL_BROWSER_EXECUTOR_FILE = join(ROOT, 'apps/electron/src/main/scheduled-social-browser-executor.ts');
const ELECTRON_MAIN_FILE = join(ROOT, 'apps/electron/src/main/index.ts');
const MISSION_BRIEF_FILE = join(ROOT, 'apps/electron/src/renderer/lib/mission-brief.ts');
const USER_GLOBAL_SKILLS_DIR = '/Users/michaelb.williams/.agents/skills';

const GENERATED_AT = process.env.SYSTEM_MAP_GENERATED_AT ?? new Date().toISOString().slice(0, 10);

function parseSource(filePath) {
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function text(filePath) {
  return readFileSync(filePath, 'utf8');
}

function unwrap(node) {
  let current = node;
  while (
    ts.isAsExpression(current)
    || ts.isSatisfiesExpression?.(current)
    || ts.isParenthesizedExpression(current)
    || ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function collectTopLevelConstants(filePath, seed = {}) {
  const source = parseSource(filePath);
  const constants = { ...seed };

  for (const stmt of source.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      constants[decl.name.text] = evaluate(decl.initializer, constants);
    }
  }

  for (const stmt of source.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name) continue;
    constants[stmt.name.text] = `[function ${stmt.name.text}]`;
  }

  return constants;
}

function evaluate(node, constants) {
  const n = unwrap(node);

  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (n.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (n.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (n.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(n)) return constants[n.text] ?? n.text;
  if (ts.isPropertyAccessExpression(n)) {
    const left = evaluate(n.expression, constants);
    if (left && typeof left === 'object' && n.name.text in left) return left[n.name.text];
    return `${String(left)}.${n.name.text}`;
  }
  if (ts.isArrayLiteralExpression(n)) {
    const items = [];
    for (const el of n.elements) {
      if (ts.isSpreadElement(el)) {
        const spread = evaluate(el.expression, constants);
        if (Array.isArray(spread)) items.push(...spread);
        else if (spread != null) items.push(String(spread));
      } else {
        items.push(evaluate(el, constants));
      }
    }
    return items;
  }
  if (ts.isObjectLiteralExpression(n)) {
    const obj = {};
    for (const prop of n.properties) {
      if (ts.isSpreadAssignment(prop)) {
        const spread = evaluate(prop.expression, constants);
        if (spread && typeof spread === 'object' && !Array.isArray(spread)) Object.assign(obj, spread);
        continue;
      }
      if (ts.isPropertyAssignment(prop)) {
        const key = propertyName(prop.name);
        obj[key] = evaluate(prop.initializer, constants);
      }
      if (ts.isShorthandPropertyAssignment(prop)) {
        obj[prop.name.text] = constants[prop.name.text] ?? prop.name.text;
      }
    }
    return obj;
  }
  if (ts.isTemplateExpression(n)) {
    let value = n.head.text;
    for (const span of n.templateSpans) {
      value += `\${${span.expression.getText()}}${span.literal.text}`;
    }
    return value;
  }

  return n.getText();
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return name.getText();
}

function findExportedConst(filePath, name, constants) {
  const source = parseSource(filePath);
  for (const stmt of source.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
        return evaluate(decl.initializer, constants);
      }
    }
  }
  throw new Error(`Could not find ${name} in ${filePath}`);
}

function extractSetLiteral(filePath, constName) {
  const source = parseSource(filePath);
  for (const stmt of source.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== constName || !decl.initializer) continue;
      const init = unwrap(decl.initializer);
      if (!ts.isNewExpression(init) || !init.arguments?.length) return [];
      const firstArg = unwrap(init.arguments[0]);
      if (!ts.isArrayLiteralExpression(firstArg)) return [];
      return firstArg.elements.map((el) => evaluate(el, {})).filter(Boolean);
    }
  }
  return [];
}

function classifyDomain(agent) {
  const slug = agent.slug;
  const name = agent.metadata.name ?? '';
  const description = agent.metadata.description ?? '';
  const tags = agent.metadata.tags ?? [];

  if (['industry-hunter', 'comms-agent', 'outreach-agent', 'college-radio-agent'].includes(slug)) return 'Outreach';
  if (['persona-agent', 'content-genius', 'record-doctor', 'art-director', 'world-builder'].includes(slug)) return 'Creative';
  if (['youtube-research-agent', 'youtube-intelligence-agent', 'spotify-analyst'].includes(slug)) return 'Research';
  if (['ig-trending-power-up', 'influencer-campaign-power-up', 'playlisting-power-up', 'spotify-playlist-creator'].includes(slug)) return 'Promotion';

  const joined = `${slug} ${name} ${description} ${tags.join(' ')}`.toLowerCase();
  if (matchesAny(joined, ['social publisher', 'trypost', 'socials', 'social posting', 'posting', 'publisher'])) return 'Socials';
  if (matchesAny(joined, ['scroll stopper', 'scroll-stopper', 'content genius', 'hypermotion', 'lottie', 'video director', 'video editor', '3d agent', '3dcellforge', 'motion', 'caption', 'clip', 'shortform'])) return 'Content Creation';
  if (matchesAny(joined, ['anr', 'a&r', 'industry', 'artist development', 'label operator', 'labels', 'sync', 'outreach', 'comms', 'press', 'email'])) return 'Outreach';
  if (matchesAny(joined, ['ads', 'marketing', 'campaign', 'growth', 'meta ads', 'google ads', 'power-up', 'power up', 'service-handoff', 'ig trending', 'influencer campaign', 'playlisting power'])) return 'Promotion';
  if (matchesAny(joined, ['shopify', 'printify', 'print agent', 'merch', 'storefront', 'commerce', 'pod', 'apparel'])) return 'Merch';
  if (matchesAny(joined, ['legendary', 'gaygent', 'brand', 'copy', 'creative direction', 'positioning', 'persona'])) return 'Creative';
  if (matchesAny(joined, ['spotify', 'playlist', 'youtube intelligence', 'youtube research', 'audience', 'research', 'analy', 'insight'])) return 'Research';
  if (matchesAny(joined, ['workflow', 'ops', 'orchestr', 'router', 'guide', 'chat', 'routing'])) return 'Command';
  if (matchesAny(joined, ['code', 'tool', 'diagnostic', 'reporting'])) return 'Operators';
  return 'Other Workers';
}

function matchesAny(value, needles) {
  return needles.some((needle) => value.includes(needle));
}

function riskSignals(agent) {
  const prompt = String(agent.systemPrompt ?? '').toLowerCase();
  const meta = agent.metadata;
  const signals = [];

  if ((meta.sources ?? []).length > 0) signals.push('requires-source-activation');
  if ((meta.optionalSources ?? []).length > 0) signals.push('optional-source-aware');
  if ((meta.trustedWorkerTools ?? []).length > 0) signals.push('trusted-worker-tools');
  if (meta.permissionMode === 'ask') signals.push('approval-capable');
  if (meta.permissionMode === 'safe') signals.push('safe-default');
  if (meta.permissionMode === 'allow-all') signals.push('allow-all-default');
  if (meta.visualAgent) signals.push('canvas-visual-agent');
  if (matchesAny(prompt, ['publish', 'send', 'email', 'post', 'schedule', 'dm', 'delete', 'spending', 'account changes'])) signals.push('external-action-boundary');
  if (matchesAny(prompt, ['explicit approval', 'ask approval', 'approval rule', 'before execution', 'before any live'])) signals.push('explicit-approval-required');
  if (matchesAny(prompt, ['canvas', 'output', 'artifact'])) signals.push('artifact-output-aware');
  if (matchesAny(prompt, ['memory scope', 'save_memory'])) signals.push('memory-scope-instructions');
  if (matchesAny(prompt, ['active-agent capability catalog', 'list_agents'])) signals.push('agent-catalog-aware');
  if (matchesAny(prompt, ['context doc', 'workspace context', 'receive every workspace-context'])) signals.push('context-doc-aware');
  if (prompt.includes('bounded engagement mandate')) signals.push('bounded-engagement-mandate');

  return [...new Set(signals)].sort();
}

function deriveLaunchSurfaces(agent, systemSlugs, hiddenSlugs, baseDefaultSlugs, campaignDefaultSlugs) {
  const surfaces = [];
  if (agent.slug === 'concierge') surfaces.push('hq-sidebar-chat', 'campaign-sidebar-chat');
  if (systemSlugs.includes(agent.slug)) surfaces.push('system-agent-hidden-from-worker-home');
  if (hiddenSlugs.includes(agent.slug)) surfaces.push('hidden-from-workers-home');
  if (!systemSlugs.includes(agent.slug) && !hiddenSlugs.includes(agent.slug)) surfaces.push('workspace-workers-when-active');
  if (baseDefaultSlugs.includes(agent.slug)) surfaces.push('hq-workers-default-visible', 'campaign-workers-default-visible');
  else if (campaignDefaultSlugs.includes(agent.slug)) surfaces.push('campaign-workers-default-visible');
  return surfaces;
}

function mermaidId(value) {
  return value.replace(/[^a-zA-Z0-9_]/g, '_');
}

function formatList(items) {
  return items?.length ? items.map((item) => `\`${item}\``).join(', ') : 'none';
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const group = map.get(key) ?? [];
    group.push(item);
    map.set(key, group);
  }
  return [...map.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)));
}

function extractQuotedSlugs(filePath, pattern) {
  const body = text(filePath);
  const slugs = new Set();
  for (const match of body.matchAll(pattern)) slugs.add(match[1]);
  return [...slugs].sort();
}

function listSkillDirs(rootDir) {
  if (!existsSync(rootDir)) return [];
  return readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(rootDir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function referenceHealth(agents, skillScopes, knownSources) {
  const repoSkillSet = new Set([...skillScopes.bundled, ...skillScopes.system]);
  const anySkillSet = new Set([...skillScopes.bundled, ...skillScopes.system, ...skillScopes.userGlobal]);
  const sourceSet = new Set(knownSources);
  const allSkillRefs = [...new Set(agents.flatMap((a) => a.skills))].sort();
  const allSourceRefs = [...new Set(agents.flatMap((a) => [...a.sources, ...a.optionalSources]))].sort();
  const missingSkills = allSkillRefs.filter((slug) => !anySkillSet.has(slug));
  const machineLocalOnlySkills = allSkillRefs.filter((slug) => !repoSkillSet.has(slug) && anySkillSet.has(slug));
  const missingSources = allSourceRefs.filter((slug) => !sourceSet.has(slug));
  const agentsWithMissingRefs = agents
    .map((agent) => ({
      slug: agent.slug,
      missingSkills: agent.skills.filter((slug) => !anySkillSet.has(slug)),
      machineLocalOnlySkills: agent.skills.filter((slug) => !repoSkillSet.has(slug) && anySkillSet.has(slug)),
      missingSources: [...agent.sources, ...agent.optionalSources].filter((slug) => !sourceSet.has(slug)),
    }))
    .filter((row) => row.missingSkills.length > 0 || row.machineLocalOnlySkills.length > 0 || row.missingSources.length > 0);

  return {
    knownSkillCount: anySkillSet.size,
    bundledSkillCount: skillScopes.bundled.length,
    systemSkillCount: skillScopes.system.length,
    userGlobalSkillCount: skillScopes.userGlobal.length,
    knownSourceCount: knownSources.length,
    missingSkills,
    machineLocalOnlySkills,
    missingSources,
    agentsWithMissingRefs,
  };
}

function workflowHealth(workflows, agents) {
  const agentSlugs = new Set(agents.map((agent) => agent.slug));
  return workflows.map((workflow) => {
    const steps = workflow.metadata?.steps ?? [];
    const agentRefs = [...new Set(steps.map((step) => step.agent).filter(Boolean))].sort();
    return {
      slug: workflow.slug,
      name: workflow.metadata?.name ?? workflow.slug,
      description: workflow.metadata?.description ?? '',
      triggerType: workflow.metadata?.trigger?.type ?? 'unknown',
      inputCount: workflow.metadata?.trigger?.inputs?.length ?? 0,
      stepCount: steps.length,
      agentRefs,
      missingAgentRefs: agentRefs.filter((slug) => !agentSlugs.has(slug)),
      steps: steps.map((step) => ({ id: step.id, agent: step.agent })),
    };
  });
}

function main() {
  const typeConstants = collectTopLevelConstants(AGENT_TYPES_FILE);
  const skillConstants = collectTopLevelConstants(SYSTEM_SKILLS_FILE);
  const constants = { ...typeConstants, ...skillConstants };
  const starterAgents = findExportedConst(STARTER_AGENTS_FILE, 'STARTER_AGENTS', constants);
  if (!Array.isArray(starterAgents)) throw new Error('STARTER_AGENTS did not parse to an array');
  const starterSkills = findExportedConst(STARTER_SKILLS_FILE, 'STARTER_SKILLS', constants);
  if (!Array.isArray(starterSkills)) throw new Error('STARTER_SKILLS did not parse to an array');

  const hiddenSlugs = extractSetLiteral(LAUNCHPAD_FILE, 'HIDDEN_WORKER_HOME_AGENT_SLUGS');
  const baseDefaultSlugs = findExportedConst(WORKER_DEFAULTS_FILE, 'BASE_DEFAULT_WORKER_SLUGS', constants);
  const campaignOnlyDefaultSlugs = findExportedConst(WORKER_DEFAULTS_FILE, 'CAMPAIGN_DEFAULT_WORKER_SLUGS', constants);
  const campaignDefaultSlugs = [...baseDefaultSlugs, ...campaignOnlyDefaultSlugs];
  const systemSlugs = ['concierge', 'orchestrator', 'update-system-agent'];
  const skillScopes = {
    bundled: [
      ...extractQuotedSlugs(BUNDLED_SKILLS_FILE, /slug:\s*"([^"]+)"/g),
      ...starterSkills.map((skill) => skill.slug).filter(Boolean),
    ].filter((slug, index, arr) => arr.indexOf(slug) === index).sort(),
    system: skillConstants.SYSTEM_GLOBAL_SKILL_SLUGS ?? [],
    userGlobal: listSkillDirs(USER_GLOBAL_SKILLS_DIR),
  };
  const knownSources = [
    ...extractQuotedSlugs(BUILTIN_SOURCES_FILE, /const\s+[A-Z0-9_]+_SLUG\s*=\s*'([^']+)'/g),
    ...extractQuotedSlugs(BUILTIN_SOURCES_FILE, /slug:\s*'([^']+)'/g),
  ].filter((slug, index, arr) => arr.indexOf(slug) === index).sort();
  const workflowConstants = collectTopLevelConstants(STARTER_WORKFLOWS_FILE, constants);
  const starterWorkflows = findExportedConst(STARTER_WORKFLOWS_FILE, 'STARTER_WORKFLOWS', workflowConstants);
  const scheduledWorkWiring = {
    queueTypes: ['event', 'agent-task', 'workflow-run', 'social-publish', 'review'],
    campaignComposerWired: text(SCHEDULED_WORK_COMPOSER_FILE).includes('ScheduledWorkComposer')
      && text(CAMPAIGN_CALENDAR_PAGE_FILE).includes('scheduleCampaignWork'),
    hqComposerWired: text(HQ_CALENDAR_FILE).includes('<ScheduledWorkComposer')
      && text(HQ_CALENDAR_FILE).includes('scheduleHqWork')
      && text(HQ_CALENDAR_FILE).includes('scheduleCampaignWork'),
    backendMutationsWired: text(SCHEDULED_WORK_HANDLER_FILE).includes('SCHEDULE_CAMPAIGN')
      && text(SCHEDULED_WORK_HANDLER_FILE).includes('CANCEL_CAMPAIGN')
      && text(SCHEDULED_WORK_HANDLER_FILE).includes('DECIDE_CAMPAIGN'),
    runnerWired: text(SCHEDULED_WORK_RUNNER_FILE).includes('class ScheduledWorkRunner')
      && text(SCHEDULED_WORK_RUNNER_FILE).includes('required-output-missing')
      && text(SCHEDULED_WORK_RUNNER_FILE).includes('missed-start-window'),
    workspaceLockWired: text(SCHEDULED_WORK_HANDLER_FILE).includes('withWorkspaceContextLock'),
    socialApprovalGateWired: text(SCHEDULED_WORK_RUNNER_FILE).includes("execution.type === 'social-publish'")
      && text(SCHEDULED_WORK_RUNNER_FILE).includes("'needs-approval'"),
    liveSocialExecutorWired: text(SCHEDULED_WORK_RUNNER_FILE).includes('this.deps.executeSocial')
      && text(SOCIAL_BROWSER_EXECUTOR_FILE).includes('executeScheduledSocialBrowser')
      && text(ELECTRON_MAIN_FILE).includes('executeScheduledSocialBrowser'),
    automationsQueueWired: text(AUTOMATION_WORK_DIALOG_FILE).includes('buildAutomationQueueWorkAction')
      && text(AUTOMATION_WORK_QUEUE_FILE).includes('queueAutomationWork')
      && text(AUTOMATION_QUEUE_HANDLER_FILE).includes('QueueWorkHandler'),
    hiddenCalendarRunsWired: text(AUTOMATION_WORK_QUEUE_FILE).includes("calendarVisibility === 'hidden'")
      && text(AUTOMATION_WORK_QUEUE_FILE).includes('Hidden queue-work automations support standalone agent and workflow work only.'),
    hnicSchedulingWired: text(TOOL_DEFS_FILE).includes("schedule_work: `Create executable tracked work")
      && text(HNIC_SCHEDULED_WORK_FILE).includes("type: 'queue-work'"),
    releaseDateMarkersWired: text(MISSION_BRIEF_FILE).includes('missionReleaseDateKey')
      && text(CAMPAIGN_CALENDAR_PAGE_FILE).includes('Release day'),
  };

  const agents = starterAgents.map((agent) => ({
    slug: agent.slug,
    name: agent.metadata?.name ?? agent.slug,
    description: agent.metadata?.description ?? '',
    domain: classifyDomain(agent),
    permissionMode: agent.metadata?.permissionMode ?? 'ask',
    thinkingLevel: agent.metadata?.thinkingLevel ?? 'workspace-default',
    skills: agent.metadata?.skills ?? [],
    sources: agent.metadata?.sources ?? [],
    optionalSources: agent.metadata?.optionalSources ?? [],
    trustedWorkerTools: agent.metadata?.trustedWorkerTools ?? [],
    visualAgent: Boolean(agent.metadata?.visualAgent),
    tags: agent.metadata?.tags ?? [],
    launchSurfaces: deriveLaunchSurfaces(agent, systemSlugs, hiddenSlugs, baseDefaultSlugs, campaignOnlyDefaultSlugs),
    riskSignals: riskSignals(agent),
    inputs: agent.metadata?.inputs ?? '',
    outputs: agent.metadata?.outputs ?? '',
  })).sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name));

  const map = {
    generatedAt: GENERATED_AT,
    sourceFiles: {
      starterAgents: rel(STARTER_AGENTS_FILE),
      agentTypes: rel(AGENT_TYPES_FILE),
      systemSkills: rel(SYSTEM_SKILLS_FILE),
      starterSkills: rel(STARTER_SKILLS_FILE),
      workersLaunchpad: rel(LAUNCHPAD_FILE),
      workerDefaults: rel(WORKER_DEFAULTS_FILE),
      runAgent: rel(RUN_AGENT_FILE),
      composeAgentPrompt: rel(COMPOSE_AGENT_PROMPT_FILE),
      sessionManager: rel(SESSION_MANAGER_FILE),
      sharedIntelHandler: rel(SHARED_INTEL_HANDLER_FILE),
      sharedIntelRouter: rel(SHARED_INTEL_ROUTER_FILE),
      sharedIntelTypes: rel(SHARED_INTEL_TYPES_FILE),
      sessionTools: rel(TOOL_DEFS_FILE),
      outputFinals: rel(OUTPUT_FINALS_FILE),
      outputService: rel(OUTPUT_SERVICE_FILE),
      outputsHook: rel(OUTPUTS_HOOK_FILE),
      outputFinalActionDialog: rel(OUTPUT_FINAL_ACTION_DIALOG_FILE),
      bundledSkills: rel(BUNDLED_SKILLS_FILE),
      builtinSources: rel(BUILTIN_SOURCES_FILE),
      starterWorkflows: rel(STARTER_WORKFLOWS_FILE),
      scheduledWorkModel: rel(SCHEDULED_WORK_MODEL_FILE),
      scheduledWorkHandler: rel(SCHEDULED_WORK_HANDLER_FILE),
      scheduledWorkRunner: rel(SCHEDULED_WORK_RUNNER_FILE),
      scheduledWorkComposer: rel(SCHEDULED_WORK_COMPOSER_FILE),
      campaignCalendarPage: rel(CAMPAIGN_CALENDAR_PAGE_FILE),
      hqCalendar: rel(HQ_CALENDAR_FILE),
      automationWorkDialog: rel(AUTOMATION_WORK_DIALOG_FILE),
      automationWorkQueue: rel(AUTOMATION_WORK_QUEUE_FILE),
      automationQueueHandler: rel(AUTOMATION_QUEUE_HANDLER_FILE),
      hnicScheduledWork: rel(HNIC_SCHEDULED_WORK_FILE),
      socialBrowserExecutor: rel(SOCIAL_BROWSER_EXECUTOR_FILE),
      missionBrief: rel(MISSION_BRIEF_FILE),
    },
    summary: {
      agentCount: agents.length,
      domains: Object.fromEntries(groupBy(agents, (a) => a.domain).map(([domain, rows]) => [domain, rows.length])),
      permissionModes: Object.fromEntries(groupBy(agents, (a) => a.permissionMode).map(([mode, rows]) => [mode, rows.length])),
      hiddenWorkerHomeCount: hiddenSlugs.length,
      hqDefaultWorkerSlugs: baseDefaultSlugs,
      campaignDefaultWorkerSlugs: campaignDefaultSlugs,
      workflowCount: Array.isArray(starterWorkflows) ? starterWorkflows.length : 0,
      sharedIntelPromptWired: text(COMPOSE_AGENT_PROMPT_FILE).includes('buildSharedIntelPromptSection')
        && text(SESSION_MANAGER_FILE).includes('buildSharedIntelPromptSection'),
      finalsPromotionWired: text(TOOL_DEFS_FILE).includes('promote_output_to_final')
        && text(OUTPUT_SERVICE_FILE).includes('promoteToFinal')
        && text(OUTPUT_FINALS_FILE).includes('withOutputFinalsRegistryLock')
        && text(OUTPUT_FINAL_ACTION_DIALOG_FILE).includes('Set as Final'),
      scheduledWorkWired: Object.entries(scheduledWorkWiring)
        .filter(([key]) => key !== 'queueTypes')
        .every(([, value]) => value === true),
    },
    referenceHealth: referenceHealth(agents, skillScopes, knownSources),
    workflows: Array.isArray(starterWorkflows) ? workflowHealth(starterWorkflows, agents) : [],
    scheduledWork: scheduledWorkWiring,
    inferredRuntimeRules: [
      'Saved agents live in the global library and are activated per workspace.',
      'Workers page shows active agents, except system agents and hidden worker-home slugs.',
      `Artist HQ default workers are currently ${baseDefaultSlugs.join(', ')}.`,
      `Campaign default workers are currently ${campaignDefaultSlugs.join(', ')}.`,
      'run-agent drops missing skills/sources before session creation and includes a launch receipt.',
      'Concierge receives broad workspace context and an active-agent capability catalog for routing.',
      'Share Intel writes targeted workspace context docs, then the central prompt composer injects them as a dedicated Shared Intel section at agent launch.',
      'Specialist agents do not need individual prompt edits for Shared Intel; they see only the routed docs selected for their slug. Concierge/HNIC can see all enabled context docs through its existing override.',
      'Outputs become Finals through UI actions or the promote_output_to_final session tool; Finals are pointers to existing Output bundles, not copied assets.',
      'Finals writes use a workspace filesystem lock under context/.locks/output-finals.lock; campaign Finals require campaignId and source Outputs cannot be deleted while still referenced.',
      'Campaign Scheduled Work separates calendar shells from executable work orders and uses backend-owned schedule/cancel/review mutations.',
      'Agent/workflow scheduled work completes only after terminal child state; required Outputs, missed windows, stale runs, and failures become visible attention states.',
      'Scheduled social publishing waits at needs-approval, then the guarded native browser executor may run only the exact approved profile, payload, media bytes, and browser partition and must return a durable receipt.',
      'Automations can queue the same typed Scheduled Work lifecycle from recurring, file, webhook, URL, or inbound-message triggers; standalone background agent/workflow runs may opt out of Calendar display.',
      'HNIC alone receives schedule_work and can create Calendar work or queue-work Automations for agent tasks and workflow runs after confirmation.',
      'A direct instruction or active schedule to answer comments/messages is a bounded Social Publisher engagement mandate; it does not authorize cold DMs, posts/uploads, account changes, or sensitive replies.',
      'message_agent/spawn_session cannot exceed parent permission mode; external actions still need user approval.',
      'trustedWorkerTools are for bounded internal work only, not sends/posts/publishing.',
    ],
    agents,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'runner-system-map.json'), `${JSON.stringify(map, null, 2)}\n`);
  writeFileSync(join(OUT_DIR, 'runner-system-map.md'), renderMarkdown(map));
  writeFileSync(join(OUT_DIR, 'runner-system-map.mmd'), renderMermaid(map));
  writeFileSync(join(OUT_DIR, 'README.md'), renderReadme());
}

function rel(filePath) {
  return filePath.replace(`${ROOT}/`, '');
}

function renderReadme() {
  return `---\nstatus: current\nowner: agent\nlast_verified: ${GENERATED_AT}\nsource_of_truth: true\n---\n\n# Runner System Map\n\nGenerated map of Runner-specific worker, context, Output/Final, Scheduled Work, Automations, HNIC scheduling, and social-execution wiring that generic code graphs miss.\n\nFiles:\n\n- [runner-system-map.md](./runner-system-map.md) - human-readable worker/system wiring.\n- [runner-system-map.json](./runner-system-map.json) - machine-readable source for agents.\n- [runner-system-map.mmd](./runner-system-map.mmd) - Mermaid graph for quick visual scans.\n\nRegenerate after changing starter agents, worker visibility, launch routing, Scheduled Work, Automations, Outputs/Finals, or permission/tool rules:\n\n\`\`\`bash\nnode scripts/generate-runner-system-map.mjs\n\`\`\`\n\nThis map is derived from code. If it disagrees with the running app, inspect the source files listed in the generated JSON before editing docs by hand.\n`;
}

function renderMarkdown(map) {
  const lines = [];
  lines.push('---');
  lines.push('status: current');
  lines.push('owner: agent');
  lines.push(`last_verified: ${GENERATED_AT}`);
  lines.push('source_of_truth: true');
  lines.push('---');
  lines.push('');
  lines.push('# Runner System Map');
  lines.push('');
  lines.push(`Generated: ${map.generatedAt}`);
  lines.push('');
  lines.push('## Why This Exists');
  lines.push('');
  lines.push('This map captures Runner-specific wiring that future agents often miss: worker visibility, skill/source bundles, approval mode, trusted tools, Canvas awareness, context injection, Outputs/Finals, Scheduled Work, Automations, HNIC scheduling, social execution, and launch surfaces.');
  lines.push('');
  lines.push('## Source Files');
  lines.push('');
  for (const [label, file] of Object.entries(map.sourceFiles)) lines.push(`- ${label}: \`${file}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Agents mapped: ${map.summary.agentCount}`);
  lines.push(`- Hidden from Workers home: ${map.summary.hiddenWorkerHomeCount}`);
  lines.push(`- Campaign default workers: ${formatList(map.summary.campaignDefaultWorkerSlugs)}`);
  lines.push(`- Starter workflows mapped: ${map.summary.workflowCount}`);
  lines.push(`- Shared Intel prompt injection: ${map.summary.sharedIntelPromptWired ? 'wired' : 'not detected'}`);
  lines.push(`- Outputs -> Finals promotion: ${map.summary.finalsPromotionWired ? 'wired' : 'not detected'}`);
  lines.push(`- Scheduled Work execution: ${map.summary.scheduledWorkWired ? 'wired' : 'incomplete'}`);
  lines.push(`- Domains: ${Object.entries(map.summary.domains).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  lines.push(`- Permission modes: ${Object.entries(map.summary.permissionModes).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  lines.push(`- Known skills: ${map.referenceHealth.knownSkillCount} (${map.referenceHealth.bundledSkillCount} bundled, ${map.referenceHealth.systemSkillCount} system, ${map.referenceHealth.userGlobalSkillCount} user-global on this machine)`);
  lines.push(`- Known builtin sources: ${map.referenceHealth.knownSourceCount}`);
  lines.push('');
  lines.push('## Reference Health');
  lines.push('');
  if (
    map.referenceHealth.missingSkills.length === 0
    && map.referenceHealth.missingSources.length === 0
    && map.referenceHealth.machineLocalOnlySkills.length === 0
  ) {
    lines.push('- All mapped starter-agent skill/source references resolve to repo-bundled/system skills or builtin sources.');
  } else {
    lines.push(`- Missing skills: ${formatList(map.referenceHealth.missingSkills)}`);
    lines.push(`- Machine-local-only skills: ${formatList(map.referenceHealth.machineLocalOnlySkills)}`);
    lines.push(`- Missing sources: ${formatList(map.referenceHealth.missingSources)}`);
    for (const row of map.referenceHealth.agentsWithMissingRefs) {
      lines.push(`- ${row.slug}: missing skills ${formatList(row.missingSkills)}; machine-local-only skills ${formatList(row.machineLocalOnlySkills)}; missing sources ${formatList(row.missingSources)}`);
    }
  }
  lines.push('');
  lines.push('## Runtime Rules Agents Should Not Miss');
  lines.push('');
  for (const rule of map.inferredRuntimeRules) lines.push(`- ${rule}`);
  lines.push('');
  lines.push('## Shared Intel Awareness');
  lines.push('');
  lines.push('- User action: chat `Share Intel` calls the shared-intel RPC for the current workspace/session.');
  lines.push('- Router action: the backend reads recent session messages, scores durable nuggets, picks target agents from the active agent catalog, and upserts targeted workspace context docs.');
  lines.push('- Storage: shared notes use the shared-intel context slug prefix and `routing: { mode: "targeted", agents: [...] }`.');
  lines.push('- Agent launch: `loadActiveContextDocsForAgent` filters docs for the launched agent; Concierge/HNIC keeps the broad context override.');
  lines.push('- Prompt delivery: `composeAgentSystemPrompt` and workflow prompt composition inject matching notes into a dedicated `Shared Intel for this worker:` section and remove them from generic workspace context to avoid duplicate/bloat.');
  lines.push('- Practical result: agents know to check it because the runtime places the relevant notes in their system prompt at launch. Individual saved agent prompts do not need to be edited.');
  lines.push('');
  lines.push('## Outputs -> Finals Promotion');
  lines.push('');
  lines.push('- User action: Output list/detail actions open `OutputFinalActionDialog` for `Set as Final`, `Set as Primary`, or `Remove from Finals`.');
  lines.push('- Agent action: `promote_output_to_final` is exposed through the session tool manifest and calls the same backend promotion path.');
  lines.push('- Backend action: `OutputService.promoteToFinal` validates workspace ownership, then writes through shared Finals registry helpers.');
  lines.push('- Storage: Finals live as JSON pointers in `context/finals/CONTEXT.md`; the Output bundle remains canonical.');
  lines.push('- Safety: writes use `context/.locks/output-finals.lock`, corrupt registry data fails closed, campaign Finals require `campaignId`, and source Output deletion is blocked while referenced.');
  lines.push('- Surfacing: HQ and campaign command-center widgets read Outputs with attached Final pointers; campaign widgets fail closed without a campaign id.');
  lines.push('');
  lines.push('## Campaign Scheduled Work');
  lines.push('');
  lines.push(`- Queue types: ${formatList(map.scheduledWork.queueTypes)}`);
  lines.push(`- Campaign Calendar composer: ${map.scheduledWork.campaignComposerWired ? 'wired' : 'not detected'}`);
  lines.push(`- HQ Calendar composer and Campaign routing: ${map.scheduledWork.hqComposerWired ? 'wired' : 'not detected'}`);
  lines.push(`- Backend-owned schedule/cancel/review mutations: ${map.scheduledWork.backendMutationsWired ? 'wired' : 'not detected'}`);
  lines.push(`- Terminal-state runner + attention handling: ${map.scheduledWork.runnerWired ? 'wired' : 'not detected'}`);
  lines.push(`- Workspace-context write lock: ${map.scheduledWork.workspaceLockWired ? 'wired' : 'not detected'}`);
  lines.push(`- Social approval gate: ${map.scheduledWork.socialApprovalGateWired ? 'wired' : 'not detected'}`);
  lines.push(`- Guarded native social executor + receipt: ${map.scheduledWork.liveSocialExecutorWired ? 'wired' : 'not detected'}`);
  lines.push(`- Automations queue-work integration: ${map.scheduledWork.automationsQueueWired ? 'wired' : 'not detected'}`);
  lines.push(`- Optional hidden Calendar runs: ${map.scheduledWork.hiddenCalendarRunsWired ? 'wired' : 'not detected'}`);
  lines.push(`- HNIC-only schedule_work tool: ${map.scheduledWork.hnicSchedulingWired ? 'wired' : 'not detected'}`);
  lines.push(`- Campaign release-date marker: ${map.scheduledWork.releaseDateMarkersWired ? 'wired' : 'not detected'}`);
  lines.push('- Calendar items are visible shells; executable state, runs, results, review decisions, and attention reasons live in the Scheduled Work context document.');
  lines.push('- Agent and workflow starts are non-terminal. The runner polls child state and enforces required-Output contracts before marking work done.');
  lines.push('- Social Publish waits at needs-approval. After an exact approval is bound, the native executor revalidates profile, browser partition, payload, and media bytes before submitting once and recording a receipt.');
  lines.push('- Automations reuse this lifecycle. Background standalone agent/workflow runs may hide their Calendar shell; review, social, and chained work stay visible.');
  lines.push('- HNIC can schedule confirmed agent/workflow work through schedule_work. Other agents do not receive this tool.');
  lines.push('');
  lines.push('## Starter Workflows');
  lines.push('');
  for (const workflow of map.workflows) {
    lines.push(`### ${workflow.name} (\`${workflow.slug}\`)`);
    lines.push('');
    lines.push(`- Description: ${workflow.description || 'none'}`);
    lines.push(`- Trigger: \`${workflow.triggerType}\`; inputs: ${workflow.inputCount}; steps: ${workflow.stepCount}`);
    lines.push(`- Agent refs: ${formatList(workflow.agentRefs)}`);
    lines.push(`- Missing agent refs: ${formatList(workflow.missingAgentRefs)}`);
    lines.push(`- Step order: ${workflow.steps.map((step) => `${step.id} -> @${step.agent}`).join('; ') || 'none'}`);
    lines.push('');
  }
  lines.push('');
  lines.push('## Workers By Domain');
  lines.push('');
  for (const [domain, rows] of groupBy(map.agents, (a) => a.domain)) {
    lines.push(`### ${domain}`);
    lines.push('');
    for (const agent of rows) {
      lines.push(`#### ${agent.name} (\`${agent.slug}\`)`);
      lines.push('');
      lines.push(`- Description: ${agent.description || 'none'}`);
      lines.push(`- Permission: \`${agent.permissionMode}\`; thinking: \`${agent.thinkingLevel}\``);
      lines.push(`- Launch surfaces: ${formatList(agent.launchSurfaces)}`);
      lines.push(`- Skills: ${formatList(agent.skills)}`);
      lines.push(`- Sources: ${formatList(agent.sources)}`);
      lines.push(`- Optional sources: ${formatList(agent.optionalSources)}`);
      lines.push(`- Trusted tools: ${formatList(agent.trustedWorkerTools)}`);
      lines.push(`- Tags: ${formatList(agent.tags)}`);
      lines.push(`- Signals: ${formatList(agent.riskSignals)}`);
      if (agent.inputs) lines.push(`- Inputs: ${agent.inputs}`);
      if (agent.outputs) lines.push(`- Outputs: ${agent.outputs}`);
      lines.push('');
    }
  }
  lines.push('## Manual Follow-Up Map Gaps');
  lines.push('');
  lines.push('- IPC channel to UI route mapping is not yet generated.');
  lines.push('- Individual Automation trigger definitions are summarized, not enumerated one by one.');
  lines.push('- Context-doc routing is summarized from launch/runtime code, not enumerated per workspace doc.');
  lines.push('- Live user/global agent overrides in `~/.agents/agents` are not included; this maps starter code, not machine-local mutations.');
  lines.push('- If Reference Health flags a missing skill/source that intentionally lives only in a user workspace, document that exception here.');
  return `${lines.join('\n').trimEnd()}\n`;
}

function renderMermaid(map) {
  const lines = [];
  lines.push('flowchart LR');
  lines.push('  App["App Shell"] --> Workers["Workers Page"]');
  lines.push('  App --> Chat["HNIC Chat"]');
  lines.push('  Registry["Starter Agent Registry"] --> Workers');
  lines.push('  Workers --> Launch["openAgentSessionComposer"]');
  lines.push('  Launch --> Session["SessionManager.createSession"]');
  lines.push('  Session --> Permissions["Permission Mode + Trusted Tools"]');
  lines.push('  Session --> Context["Workspace Context + Memory"]');
  lines.push('  ShareIntel["Share Intel Button"] --> SharedIntelRpc["sharedIntel:share RPC"]');
  lines.push('  SharedIntelRpc --> SharedIntelRouter["Shared Intel Router"]');
  lines.push('  SharedIntelRouter --> Context');
  lines.push('  Context --> SharedIntelPrompt["Shared Intel Prompt Section"]');
  lines.push('  SharedIntelPrompt --> Session');
  lines.push('  Session --> Sources["Enabled Sources"]');
  lines.push('  Session --> Skills["Agent Skills"]');
  lines.push('  Outputs["Outputs"] --> FinalsDialog["Output Final Dialog"]');
  lines.push('  FinalsDialog --> FinalsService["OutputService Finals Actions"]');
  lines.push('  SessionTools["Session Tools"] --> PromoteFinal["promote_output_to_final"]');
  lines.push('  PromoteFinal --> FinalsService');
  lines.push('  FinalsService --> FinalsRegistry["context/finals/CONTEXT.md"]');
  lines.push('  FinalsService --> FinalsLock["context/.locks/output-finals.lock"]');
  lines.push('  FinalsRegistry --> HQFinals["HQ / Campaign Finals Widgets"]');
  lines.push('  CampaignCalendar["Campaign Calendar"] --> WorkComposer["Scheduled Work Composer"]');
  lines.push('  HQCalendar["HQ Calendar"] --> WorkComposer');
  lines.push('  Automations["Automations Hub"] --> WorkComposer');
  lines.push('  HNIC["HNIC schedule_work"] --> WorkRpc');
  lines.push('  WorkComposer --> WorkRpc["Schedule / Cancel / Review RPC"]');
  lines.push('  Automations --> AutomationQueue["queue-work"]');
  lines.push('  AutomationQueue --> WorkRpc');
  lines.push('  WorkRpc --> WorkContext["scheduled-work context doc"]');
  lines.push('  WorkContext --> WorkRunner["ScheduledWorkRunner"]');
  lines.push('  WorkRunner --> AgentSessions["Agent Sessions"]');
  lines.push('  WorkRunner --> WorkflowRuns["Workflow Runs"]');
  lines.push('  WorkRunner --> Attention["Done / Review / Needs Attention"]');
  lines.push('  WorkRunner -. needs approval .-> SocialExecution["Guarded Social Executor"]');
  lines.push('  SocialExecution --> SocialReceipt["External Receipt"]');
  for (const agent of map.agents) {
    const id = `A_${mermaidId(agent.slug)}`;
    const label = `${agent.name}\\n${agent.permissionMode}\\n${agent.domain}`;
    lines.push(`  Registry --> ${id}["${label.replace(/"/g, "'")}"]`);
    if (agent.launchSurfaces.includes('workspace-workers-when-active')) lines.push(`  Workers --> ${id}`);
    if (agent.launchSurfaces.includes('hq-sidebar-chat') || agent.launchSurfaces.includes('campaign-sidebar-chat')) lines.push(`  Chat --> ${id}`);
    for (const skill of agent.skills.slice(0, 8)) lines.push(`  ${id} --> S_${mermaidId(skill)}["skill:${skill}"]`);
    for (const source of agent.sources.slice(0, 6)) lines.push(`  ${id} --> T_${mermaidId(source)}["source:${source}"]`);
    if (agent.launchSurfaces.includes('hidden-from-workers-home')) lines.push(`  ${id} -. hidden .-> Workers`);
    if (agent.launchSurfaces.includes('campaign-workers-default-visible')) lines.push(`  Campaign["Campaign Workspace"] --> ${id}`);
  }
  for (const workflow of map.workflows) {
    const id = `W_${mermaidId(workflow.slug)}`;
    lines.push(`  Workflows["Starter Workflows"] --> ${id}["workflow:${workflow.name.replace(/"/g, "'")}"]`);
    for (const step of workflow.steps) {
      lines.push(`  ${id} --> A_${mermaidId(step.agent)}["${step.agent}"]`);
    }
  }
  return `${lines.join('\n')}\n`;
}

main();
