/**
 * ACP (Agent Client Protocol) message types.
 *
 * Ported from Hermes hermes_acp/ (MIT). Mirrors shapes from:
 *  - hermes_acp/server.py (RPC method names)
 *  - hermes_acp/tools.py (ToolCallStart / ToolCallProgress)
 *  - hermes_acp/permissions.py (PermissionOption)
 *  - hermes_acp/edit_approval.py (EditProposal)
 *
 * See .planning/research/01-acp-adapter.md for citations.
 * See THIRD_PARTY_NOTICES.md for license attribution (Hermes MIT).
 */

export type SessionId = string;
export type ToolCallId = string;
export type ToolKind = 'read' | 'edit' | 'execute' | 'other';
export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

// ---------- JSON-RPC base types ----------

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ---------- ACP content blocks ----------

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface DiffBlock {
  type: 'diff';
  path: string;
  oldText: string | null;
  newText: string;
}

export type ContentBlock = TextBlock | DiffBlock;

// ---------- Tool calls ----------

export interface ToolCallLocation {
  path: string;
  line?: number;
}

export interface ToolCallStart {
  sessionUpdate: 'tool_call';
  toolCallId: ToolCallId;
  title: string;
  kind: ToolKind;
  status: ToolStatus;
  content: ContentBlock[];
  locations?: ToolCallLocation[];
  rawInput?: Record<string, unknown>;
}

export interface ToolCallProgress {
  sessionUpdate: 'tool_call_update';
  toolCallId: ToolCallId;
  status: ToolStatus;
  content?: ContentBlock[];
}

// ---------- Permissions ----------

export type PermissionOptionKind =
  | 'allow_once'
  | 'allow_always'
  | 'reject_once'
  | 'reject_always';

export interface PermissionOption {
  optionId: string;
  kind: PermissionOptionKind;
  name: string;
}

export interface PermissionRequest {
  sessionId: SessionId;
  toolCall: ToolCallStart;
  options: PermissionOption[];
}

export interface PermissionResponse {
  outcome:
    | { outcome: 'selected'; optionId: string }
    | { outcome: 'cancelled' };
}

// ---------- Edit approval ----------

export interface EditProposal {
  toolName: string;
  path: string;
  oldText: string | null;
  newText: string;
  arguments: Record<string, unknown>;
}

// ---------- Plan / session updates ----------

export interface PlanEntry {
  content: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'in_progress' | 'completed';
}

export interface AgentPlanUpdate {
  sessionUpdate: 'plan';
  entries: PlanEntry[];
}

export interface AgentMessageText {
  sessionUpdate: 'agent_message_chunk';
  content: TextBlock;
}

export interface AgentThoughtText {
  sessionUpdate: 'agent_thought_chunk';
  content: TextBlock;
}

export type SessionUpdate =
  | ToolCallStart
  | ToolCallProgress
  | AgentPlanUpdate
  | AgentMessageText
  | AgentThoughtText;

// ---------- RPC params ----------

export interface InitializeParams {
  protocolVersion?: number;
  clientCapabilities?: Record<string, unknown>;
}

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities: {
    loadSession: boolean;
    promptCapabilities: { audio?: boolean; embeddedContext?: boolean; image?: boolean };
  };
  authMethods: Array<{ id: string; name: string; description?: string }>;
}

export interface SessionNewParams {
  cwd: string;
  mcpServers?: unknown[];
}

export interface SessionNewResult {
  sessionId: SessionId;
}

export interface SessionPromptParams {
  sessionId: SessionId;
  prompt: Array<TextBlock>;
}

export interface SessionPromptResult {
  stopReason: 'end_turn' | 'cancelled' | 'max_turn_requests' | 'refusal';
}

// ---------- Auto-approve policies ----------

export const AUTO_APPROVE_ASK = 'ask';
export const AUTO_APPROVE_WORKSPACE = 'workspace_session';
export const AUTO_APPROVE_SESSION = 'session';

export type AutoApprovePolicy =
  | typeof AUTO_APPROVE_ASK
  | typeof AUTO_APPROVE_WORKSPACE
  | typeof AUTO_APPROVE_SESSION;
