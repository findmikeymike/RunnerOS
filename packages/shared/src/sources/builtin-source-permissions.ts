import type { PermissionsConfigFile } from '../agent/mode-types.ts';

const SQUAD_CLI_PATTERN = String.raw`(?:"[^"]*/tools/squad/bin/squad\.mjs"|'[^']*/tools/squad/bin/squad\.mjs'|[^\s]+/tools/squad/bin/squad\.mjs|tools/squad/bin/squad\.mjs)`;

const SQUAD_PERMISSIONS: PermissionsConfigFile = {
  allowedBashPatterns: [
    {
      pattern: String.raw`^node\s+${SQUAD_CLI_PATTERN}\s+doctor\s+--json$`,
      comment: 'Check Squad wrapper and checkout readiness',
    },
    {
      pattern: String.raw`^node\s+${SQUAD_CLI_PATTERN}\s+storyboard\s+.+\s+--json$`,
      comment: 'Generate a no-spend Squad storyboard board',
    },
    {
      pattern: String.raw`^node\s+${SQUAD_CLI_PATTERN}\s+preflight\s+.+\s+--json$`,
      comment: 'Run Squad no-spend production preflight',
    },
    {
      pattern: String.raw`^node\s+${SQUAD_CLI_PATTERN}\s+inspect-latest\s+--json$`,
      comment: 'Inspect latest Squad creative production run',
    },
  ],
  blockedCommandHints: [
    {
      command: 'node <squad-source-local-path>/bin/squad.mjs run',
      reason: 'Squad production can spend provider credits or start long media generation.',
      context: 'Run storyboard and preflight first, then ask for explicit approval of budget, quality, and brief.',
      tryInstead: [
        'node <squad-source-local-path>/bin/squad.mjs storyboard --brief-file brief.json --json',
        'node <squad-source-local-path>/bin/squad.mjs preflight --brief-file brief.json --json',
      ],
    },
  ],
};

export function getBuiltinSourcePermissionsConfig(sourceSlug: string): PermissionsConfigFile | null {
  if (sourceSlug === 'squad') return SQUAD_PERMISSIONS;
  return null;
}

