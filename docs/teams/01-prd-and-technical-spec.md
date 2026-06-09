# Teams — PRD and Technical Spec

## Summary

Teams make RunnerOS operate like a small AI company instead of a pile of independent chats.

A Team has one lead agent, specialist members, internal messages, owned tasks, wake/resume behavior, and verification gates. The user talks mostly to the lead. The lead assigns work, tracks progress, pulls in specialists, and returns one coherent result.

## Problem

RunnerOS already has agents, skills, sources, workflows, automations, and memory. What is missing is a durable coordination container.

Without Teams:

- agents hand off through loose chat context
- task ownership is implicit
- specialists do not have a shared task board
- the user has to mentally manage who is doing what
- verification depends on the user asking for it
- recurring business lanes cannot stay assembled

## Product Goal

Create reusable agent teams that can run complex work with clear ownership.

The first strong version should support:

- saved team definitions
- one lead agent per team
- member agents with roles
- internal agent-to-agent messages
- team task board
- wake/resume when work is assigned
- verification before important tasks are marked done
- standing teams for recurring business and engineering work

## Non-goals for V1

- no free-form swarm chaos
- no visual graph editor
- no autonomous live publishing/spending
- no marketplace/imported team bundles
- no cross-device distributed runtime
- no complex resource scheduling

## Core Concepts

### Team

A saved container for coordinated agent work.

Example teams:

- `head-of-biz-team`
- `commerce-launch-team`
- `content-production-team`
- `engineering-ship-team`
- `review-and-qa-team`

### Lead Agent

The user's main point of contact.

Responsibilities:

- clarify the job
- split the job into tasks
- assign members
- monitor progress
- ask the user only when needed
- produce final report

### Member Agent

A specialist with a bounded job.

Examples:

- researcher
- copywriter
- designer
- code reviewer
- test engineer
- finance analyst
- ecommerce ops agent

### Team Task

A durable task record owned by one agent.

Tasks are the center of the system. Messages support tasks; they do not replace tasks.

### Team Mailbox

Structured internal messages between agents.

Use cases:

- lead assigns a task to a specialist
- specialist asks another specialist for review
- reviewer sends findings back to the owner
- blocked agent asks lead for user approval

### Wake/Resume

When a task or message is assigned to an idle member, RunnerOS can resume that member's session with the relevant context.

### Verification Gate

Before important work becomes `done`, another agent checks the result.

Use it for:

- code changes
- workflow outputs
- publishing drafts
- customer-facing messages
- ads/budget work
- claims of completion

## UX

### Teams Library

List saved teams.

Each team card shows:

- name
- lead
- members
- active tasks
- blocked tasks
- last activity
- standing/manual badge

Primary actions:

- start team
- edit team
- duplicate team
- archive team

### Team Detail

Single command center for one team.

Required panels:

- lead conversation
- member roster
- task board
- internal messages
- activity log
- approvals needed

### Team Run

When a team is active, the user sees:

- what the lead is doing
- which member owns each task
- what is blocked
- what is ready for approval
- final output and receipts

### Team Creation

Two paths:

1. Template: choose a predefined team.
2. Prompt: "Create a product launch team for Shopify/Printify work."

The lead agent may suggest a team when a normal chat becomes too broad.

## File / Data Model

### Team Definition

Store globally first, activate per workspace later if needed.

Proposed location:

```text
~/.agents/teams/<slug>/TEAM.md
```

Example:

```yaml
---
name: Commerce Launch Team
description: Turns a product idea into a reviewed launch package.
lead: head-of-biz
members:
  - slug: product-strategist
    role: Product strategy
  - slug: ecommerce-ops
    role: Shopify and Printify operations
  - slug: content-creator
    role: Launch content
  - slug: reviewer
    role: Verification
standing: true
permissionMode: ask
verification:
  default: advisory
  requiredFor:
    - publish
    - spend
    - customer_message
    - code_change
---

# Commerce Launch Team

Use for launch planning, listing drafts, content packages, and approval-gated commerce execution.
```

### Team Run State

Store inside the workspace.

```text
<workspace>/.runneros/teams/runs/<runId>/run.json
<workspace>/.runneros/teams/runs/<runId>/messages.jsonl
<workspace>/.runneros/teams/runs/<runId>/tasks.jsonl
<workspace>/.runneros/teams/runs/<runId>/events.jsonl
```

Keep it readable and append-friendly. Move to SQLite only if JSONL becomes too slow.

## Type Sketch

```ts
type TeamDefinition = {
  slug: string;
  name: string;
  description: string;
  lead: string;
  members: TeamMemberDefinition[];
  standing: boolean;
  permissionMode: 'safe' | 'ask' | 'allow-all';
  verification: TeamVerificationPolicy;
};

type TeamMemberDefinition = {
  slug: string;
  role: string;
  requiredSources?: string[];
};

type TeamTask = {
  id: string;
  runId: string;
  title: string;
  description: string;
  ownerAgentSlug: string;
  status: 'todo' | 'in_progress' | 'blocked' | 'review' | 'done' | 'failed';
  priority: 'low' | 'normal' | 'high';
  inputs: Record<string, unknown>;
  output?: string;
  evidence?: TeamTaskEvidence[];
  approvalRequired?: boolean;
  blockedReason?: string;
  createdAt: string;
  updatedAt: string;
};

type TeamMessage = {
  id: string;
  runId: string;
  fromAgentSlug: string | 'user' | 'system';
  toAgentSlug: string | 'lead' | 'all';
  taskId?: string;
  kind: 'assignment' | 'question' | 'result' | 'review' | 'note';
  body: string;
  createdAt: string;
  readAt?: string;
};
```

## Runtime

### Start Team Run

1. Load `TEAM.md`.
2. Resolve lead and member agents.
3. Create a lead session.
4. Create run directory.
5. Send the user's request to the lead with team roster and rules.
6. Lead creates tasks through team tools.

### Assign Task

1. Lead writes a `TeamTask`.
2. Runtime appends an assignment message.
3. If owner has no active session, create/resume one.
4. Inject task, relevant messages, team rules, and available sources.
5. Member reports result back to task and lead.

### Complete Task

1. Owner submits output and evidence.
2. Runtime checks whether verification is required.
3. If required, route to reviewer.
4. Reviewer returns pass/fail/findings.
5. Lead accepts, reopens, or escalates to user.

### Human Approval

If a task wants to publish, spend, message customers, delete, refund, deploy, or mutate production state, it must create an approval request instead of acting directly.

## Team Tools

Expose these as session tools to the lead and members:

- `create_team_task`
- `update_team_task`
- `list_team_tasks`
- `send_team_message`
- `list_team_messages`
- `request_team_review`
- `request_user_approval`
- `spawn_team_member`
- `summarize_team_run`

## Permission Model

Team-level permission mode is the default. Individual agents cannot silently escalate.

Rules:

- lead can assign and message
- members can update their own tasks
- reviewers can mark verification result
- risky external actions require approval
- dynamic member spawning requires lead action and may require user approval depending on workspace setting

## Relationship to Existing RunnerOS Primitives

Teams should reuse existing pieces:

- agents remain normal agents
- skills remain reusable instructions
- sources remain tool/integration bundles
- workflows remain repeatable SOPs
- pulses can kick off team runs
- approvals should become a shared primitive used by teams and workflows
- memory stores durable preferences and lessons, not live task state

## Phased Build

### Phase 1 — Team Definition and UI

Ship:

- `TEAM.md` parser/storage
- teams library page
- team detail page
- create/edit/archive teams
- starter team templates

Done when:

- user can create a team and see roster/lead/members
- definitions round-trip to disk cleanly

### Phase 2 — Team Runs and Task Board

Ship:

- run state storage
- task board
- lead session launch
- team tools for task CRUD
- activity log

Done when:

- lead can create tasks
- user can see task ownership and status

### Phase 3 — Mailbox and Wake/Resume

Ship:

- internal messages
- member session spawn/resume
- unread message handling
- task context injection

Done when:

- lead assigns a member
- member wakes, does work, reports back

### Phase 4 — Verification Gate

Ship:

- review policy
- `request_team_review`
- reviewer result state
- lead accept/reopen flow

Done when:

- important tasks cannot silently mark done without review

### Phase 5 — Standing Teams and Templates

Ship:

- standing team badge
- run history
- duplicate from template
- pulse/workflow launch hooks

Done when:

- recurring business teams can stay assembled and be relaunched cleanly

## Starter Templates

### Head of Biz Team

- lead: `head-of-biz`
- members: ecommerce ops, content strategist, finance analyst, reviewer

### Commerce Launch Team

- lead: `head-of-biz`
- members: product strategist, design reviewer, ecommerce ops, content creator, reviewer

### Engineering Ship Team

- lead: `system-architect`
- members: coder, test engineer, code reviewer, cleanup agent

### Review and QA Team

- lead: `truth-guardian`
- members: code reviewer, test engineer, security auditor

## Acceptance Criteria

V1 is successful when:

- a team is a durable object, not just a prompt
- the user talks to the lead
- the lead can create owned tasks
- members can receive work and report back
- task state survives app restart
- the user can inspect what happened
- risky actions route to approval instead of direct execution

## Open Decisions

- Should Team definitions live under `~/.agents/teams` or RunnerOS-specific `~/.runneros/teams`?
- Should team run state be JSONL first or SQLite from day one?
- Should dynamic member spawning be enabled in V1 or wait until after fixed-roster teams work?
- Should every team require a reviewer, or only teams with verification policy enabled?
- Should a workflow step be able to target an entire team instead of one agent?
