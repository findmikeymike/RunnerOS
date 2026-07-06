---
status: draft
owner: product
last_verified: 2026-07-05
source_of_truth: false
---

# Core Surfaces

RunnerOS is a command center for creator work. You bring goals, files, context, and accounts. Runner gives you workers, tools, outputs, and memory.

## HQ

HQ is the home base. Use it for broad artist/company context, setup, strategy, and cross-campaign work.

Common uses:
- Fill in artist profile, voice, branding, assets, and current priorities.
- Talk to HNIC when you do not know which worker should handle a job.
- Review recent outputs, approvals, and active work.
- Manage workers, skills, sources, automations, and settings.

## Campaign Workspace

A campaign workspace is for one release, rollout, launch, or focused project.

Use it when the work needs a shared mission:
- song/release campaign
- content sprint
- merch drop
- ad push
- outreach run
- video package

Campaign workspaces can show a default starter team. Current default workers:
- **World Builder**: creates the release world and fan experience.
- **Content Genius**: plans short-form content and finishes locked ideas with captions/overlays.

## HNIC

HNIC is the main guide and router.

Use HNIC when:
- you do not know what worker to use
- you want a plan
- you want to create a new worker, workflow, automation, or source
- you want the app to explain what it can do
- you want a task handed to the right specialist

HNIC is not just chat. It can route to workers, suggest workflows, and help set up reusable systems.

For setup, keys, connections, and "how do I use this?" questions, HNIC should hand you to **Setup Concierge**.

## Setup Concierge

Setup Concierge is the app/setup helper.

Use it when:
- connecting services
- adding API keys
- setting up Google, YouTube, Zero, commerce, media, or messaging tools
- understanding what a page/button/workflow does
- testing whether a connection works

Setup Concierge can save approved credentials into RunnerOS encrypted credential storage. It should not ask for account passwords, 2FA codes, recovery codes, cookies, or raw browser sessions.

## Workers / Agents

Workers are saved specialists. Each worker has a job, a prompt, optional skills, optional sources/tools, and a permission mode.

Typical workers:
- **Content Genius**: short-form ideas, hooks, captions, overlays.
- **World Builder**: immersive release worlds and campaign mechanics.
- **Branding Agent**: artist DNA, mythology, visual world, campaign angles.
- **Art Director**: cover art, merch graphics, visual prompts, layout direction.
- **Comms Agent**: fan emails, newsletters, press/community updates.
- **Outreach Agent**: prospect research, email lookup, outreach drafts.
- **Industry Hunter**: finds target people and companies for outreach, then can use Zero for LinkedIn/email enrichment when a real public profile URL is found.
- **Record Doctor**: prepares song review handoff packets.
- **Social Publisher**: posts/schedules to social channels after approval.
- **Ads Agent**: Meta/Google ad planning and review.
- **Shopify Agent**: store/product/listing work.
- **Print Agent**: print-on-demand product planning.
- **Video Editor / Raw Video Editor**: video project edits and footage cutdowns.
- **Hypermotion / Lottie**: motion graphics and animation.

In the Workers page:
- Toggle workers active/inactive for the workspace.
- Open a worker to see its job, skills, tools, memory, and sessions.
- Start a worker chat when you know who should own the task.

## Skills

Skills are reusable instruction packs. They make workers better at a narrow job.

Examples:
- `contentgenuis`: creator content strategy and short-form idea shaping.
- `captions-and-overlays`: caption hooks and on-screen text after an idea is locked.
- `artist-comms-strategist`: fan, press, collaborator, and community messages.
- `artist-brand-dna-audit`: brand diagnosis.
- `artist-art-direction`: taste-led visual direction.
- `social-publishing`: approval-gated social posting rules.

Users can add skills to custom workers. All shipped worker-critical skills should live inside the app, not only on one local machine.

## Sources / Tools

Sources are the outside tools or local toolkits a worker can use.

Examples:
- Gmail, Google Calendar, Google Drive
- Meta Ads, Google Ads
- Shopify, Printify
- browser/social publishing tools
- video studio tools
- image/video generation providers

If a worker needs a source that is not connected, it should say what is missing instead of pretending it can do the work.

## Workflows

Workflows are repeatable multi-step processes.

Use workflows when the same kind of work happens again and again:
- weekly content pipeline
- email triage
- campaign review
- research -> draft -> critique -> revise

A workflow can call multiple workers in sequence. It is best for repeatable operations, not one-off creative chats.

## Automations and Triggers

Automations run when something happens.

Common trigger ideas:
- a label changes
- a file appears
- a schedule fires
- a message arrives
- a new campaign task is created

Automations are powerful, so anything that publishes, sends, spends, deletes, or changes an outside account should require approval.

## Outputs / Artifacts

Outputs are finished or useful work products the app should help you find again.

Examples:
- campaign plan
- caption batch
- outreach packet
- PDF/report
- image or cover draft
- video render receipt
- approved publish packet
- research list

Outputs should appear on the Outputs page and can also be shown in widgets on HQ/Campaign pages.

Clicking an output should open the useful thing: preview, file, modal, canvas, or receipt.

## Finals

Finals are Outputs you or an agent mark as trusted enough to reuse.

Use Finals when:
- a cover option becomes approved campaign cover art
- a bio draft becomes the artist bio
- a caption pack becomes the campaign caption set
- a video cut becomes one of the final clips

How it works:
- Click an Output card or Output detail page.
- Choose **Set as Final**.
- Pick `HQ` or `Campaign`, add the campaign id when needed, and choose a slot like `Cover Art`, `Artist Bio`, `Press Copy`, or `Shortform Clips`.
- Use **Set as Primary** when one Final should be the default choice.

Finals do not copy or publish files. They point back to the original Output. Removing something from Finals does not delete the Output.

You can also tell an agent, "make this a final." If the agent knows which Output you mean, it can use the Finals tool. If not, it should ask you which Output.

## Canvas / Visual Display

Canvas is where visual artifacts can be previewed or inspected.

Use it for:
- images
- cover drafts
- decks
- HTML previews
- video/motion previews
- layout artifacts
- visual receipts

Not every chat answer belongs on Canvas. Canvas is for visual or file-like work you may inspect, approve, or reuse.

## State of Play

State of Play is the short current-status brain for a campaign or HQ.

It should answer:
- What are we doing?
- What is ready?
- What is blocked?
- What needs approval?
- What should happen next?

It is not a long archive. It is the quick truth of the workspace right now.

## Saving Nuggets / Share Intel

Use Share Intel when a chat contains a useful fact workers should remember.

Good nuggets:
- artist voice preference
- campaign angle
- target audience insight
- visual rule
- avoid-list
- important contact/context

Bad nuggets:
- passwords or API keys
- temporary chatter
- random drafts you do not want reused
- private sensitive details without a reason

Shared intel is routed to the workers that need it instead of dumping everything into every prompt.

## Approval Needed

Anything risky should ask first.

Requires approval:
- sending email/DM/comment
- posting or scheduling
- uploading
- spending money or credits
- deleting or editing live content
- changing accounts/settings
- using private assets publicly

Approval items should surface where the user works, not hide inside old chats.
