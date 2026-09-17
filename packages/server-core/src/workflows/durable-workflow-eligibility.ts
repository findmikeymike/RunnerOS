/** Public guidance is static: never include prompts, credentials, paths or raw errors. */
const guidance = {
  workspace: 'Use a local workspace and an available worker.',
  tools: 'Choose a worker without specialist or visual tools.',
  mode: 'Select an explicit supported task mode for this worker.',
  skills: 'Choose only certified instruction-only skills, without adjacent skills or custom skill overrides.',
  receipt: 'The worker configuration changed or could not be verified. Reselect its task mode and try again.',
  thinking: 'Set this worker’s thinking level to off.',
  permission: 'Set this worker’s permission mode to read-only (safe).',
  sources: 'Use enabled filesystem sources inside this workspace. Connected sources are not supported yet.',
  context: 'Use a standalone worker with the default workspace directory and a composed system prompt.',
  provider: 'Choose a supported Pi model connection authenticated with an API key.',
  unknown: 'This worker configuration could not be verified for durable reads. Check its mode, skills, tools, sources and model connection, then try again.',
} as const;
export type DurableWorkflowBlocker = keyof typeof guidance;
export class DurableWorkflowEligibilityError extends Error {
  constructor(readonly blocker: DurableWorkflowBlocker, message = 'unsupported-durable-agent-bundle') {
    super(message);
    this.name = 'DurableWorkflowEligibilityError';
  }
}
/** Only trusted categories cross the start boundary; arbitrary resolver errors stay private. */
export function durableWorkflowStartError(error: unknown, stepNumber: number): Error {
  const blocker = error instanceof DurableWorkflowEligibilityError && Object.hasOwn(guidance, error.blocker)
    ? error.blocker : 'unknown';
  return new Error(`Workflow step ${stepNumber} cannot start. ${guidance[blocker]}`);
}
