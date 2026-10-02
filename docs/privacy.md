# Privacy and local data

Coffice is a local application. Codex-owned storage is read-only. Snapshot
ingestion is metadata-only; explicit user-confirmed task actions use the local
Codex App Server rather than modifying those files or databases.

The desktop companion's scene interactions are presentation only: they do not
send messages, change a task, or control a Codex process. Demo occupants are
labelled simulations. The desktop wrapper starts its own loopback service and
does not grant Node access to the rendered page. The optional Workbench retains
the action and storage boundaries described below.

## Allowed information

Depending on availability, Coffice may normalize:

- saved project identifiers, names, paths, and ordering;
- explicit top-level thread-to-project assignments, or the explicit absence of
  an assignment, from Codex's current local project state;
- structural assignment provenance indicating an explicit project, explicit
  absence, unknown assignment, or non-authoritative fallback;
- opaque task or session identifiers and the current top-level thread display
  titles published by Codex;
- explicitly marked resident staff names (`[AGENT] Name` convention);
- timestamps, token totals, context limits, model names, and lifecycle events;
- for an already admitted visible live task, its exact identifier, enumerated
  goal status, and goal update time from a bounded App Server goal read;
- evidence source, staleness, and confidence needed to qualify a displayed
  status;
- bounded live Git metadata independently scoped to each authoritative saved
  root in a project: branch, commit identifier, aggregate counts, coarse
  changed-area summaries, and freshness;
- exact-result verification receipt identifiers, fixed profile/check versions,
  timestamps, structural lifecycle state, and pass, fail, or unknown outcomes.

Thread display titles are metadata. Coffice joins them by identifier from the
session index or current visible-thread state; it does not derive titles from a
message preview or conversation body. When an authoritative display title is
unavailable, Coffice uses a neutral fallback.

## Information Coffice must not access

- `.codex/auth.json`;
- access tokens, cookies, credentials, or environment secrets;
- preview text, `first_user_message`, prompt bodies, response bodies,
  transcripts, or tool payloads;
- subagent or other internal threads;
- hidden or obsolete threads that are not present in Codex's current top-level
  view;
- unrelated project files during automatic metadata collection;
- repository file bodies, patches, diff hunks, remotes, or absolute repository
  paths during automatic evidence collection;
- writable Codex control or storage interfaces.

## Visible-thread filtering

Coffice reads the current `state_5` project and thread metadata as a read-only
allowlist. A thread appears in a project office only when Codex currently
exposes it as a top-level thread and explicitly assigns it to that saved local
project. A current top-level thread without a project assignment may remain in
Coffice's projectless campus or holding view, but it is never inferred into a
project from its working directory. A rollout file, matching working directory,
or historical session-index entry is not enough to make a thread visible or
assign it to a project. Coffice never writes changes back to this state.

Moving or unlinking a task in Coffice changes only the local outcome-plan
association. It does not move, assign, archive, or modify the task in Codex.
These controls require fresh authoritative assignment evidence; stale,
malformed, contradictory, or unknown evidence disables them rather than being
treated as an explicit absence of assignment.

## Status evidence

Every displayed operational status is either observed or inferred. Observed
states require a direct supported signal. Inferred states use conservative fixed
rules and remain visibly qualified. Missing, stale, contradictory, or malformed
evidence must not be upgraded into a stronger activity claim.

Blocked state uses the supported `thread/goal/get` method only for exact task
identifiers already admitted by the visible top-level roster. Although the
protocol response can carry an objective, budget, and usage fields, the adapter
does not read those fields and projects only the exact identifier, enumerated
status, and normalized update time before the request resolves. Objective text
and resource fields never enter a snapshot, log, cache, workspace, report, or
UI. Reads are capped at 64 tasks in bounded concurrent batches. Only a complete,
well-formed read can replace the previous blocked projection. Duplicate,
malformed, mismatched, partial, oversized, or unavailable responses preserve a
previously observed exact block only as stale, explicitly unavailable evidence;
they cannot clear it or create a new block. Only the exact `blocked` status is
admitted. No paused, limited, active, or complete goal is reinterpreted as
blocked, and there is no inferred stuck state.

Office workflow placement consumes only the already admitted canonical
Attention event. A fresh structural request for input may place its task in the
meeting area, and a supported current completion—either directly observed or a
durable session completion—may place it in the review area. Otherwise its
automatic workflow destination remains the owned desk; neutral agents may still
be moved manually. Coffice does not derive a blocked or failed location from
age, prose, or weak status signals. Snoozing, dismissing, or reviewing the exact
event removes the qualifying placement without writing a separate workflow
record. The same rule applies to explicitly unassigned tasks in the holding
area.

## Live repository evidence

The Review & Act inspector may show a separate live snapshot for every
authoritative saved root in one project. The roots keep Codex's order and appear
only as path-free ordinal scopes such as the primary root and an additional
root; their names, paths, and identifiers are not published. Working-tree and
diff aggregates cover only their respective saved-root subtrees, even when a
root is nested inside a larger Git worktree. The roots remain in the same
project, office, and task roster. Branch identity and ahead/behind remain
repository-level facts. Coffice invokes bounded Git status and aggregate numstat
operations with external diff and textconv drivers, prompts, lazy object
fetching, and submodule traversal disabled. Git may inspect working files to
calculate line totals; Coffice receives no file bodies or diff hunks.

The adapter checks a source-wide technical workload bound before invoking Git.
If collection is bounded out, projects remain visible with their exact root
counts, but the snapshot omits the per-root evidence array and primary
compatibility alias. It does not truncate the root list or publish partial Git
claims, and the bound is not a product capacity or display tier.

Coffice uses a generated, filter-free Git control directory, never copies the
repository index, and audits only hazard key names from repository-local config
without following includes. External includes, worktree-local config, custom
clean or process filters, active filter attributes, active private attribute or
exclude metadata, excessive path inventories, and comparison-setting ambiguity
all make the evidence unavailable. This prevents collection from executing
project-configured filter commands or publishing a false clean/dirty claim.
Only aggregate evidence is published; paths, filter commands, patches, remotes,
roots, and file contents remain private.

The displayed source is a privacy-isolated Git comparison, not a claim that
every user or global Git configuration would produce identical output. Coffice
varies safe comparison settings and refuses evidence when those settings change
the observed status; it does not read global Git configuration to resolve that
ambiguity.

Repository-relative paths are used only transiently to count coarse areas such
as Source, Tests, Docs, Config, and Assets. Exact paths are discarded before the
snapshot is produced. The resulting branch, HEAD, counts, areas, aggregate line
totals, source, and observation time are live project evidence only. They are
not persisted in the Coffice workspace and are never attributed to a task,
attempt, result, or decision. Within an admitted refresh, each root keeps
distinct observation and failure evidence: one unavailable root does not erase
another. The source-wide safety bound and snapshot cache state apply to the
whole refresh. Coffice never merges the scopes or claims that one represents
the whole project.
Each available or explicitly unavailable Git observation carries its own
observation time. The snapshot's cache freshness describes delivery of the
whole snapshot, not the age or availability of every root. During a cold
background refresh, a known root may therefore appear as a path-free ordinal
slot with no Git evidence or observation time yet.
Unavailable or partial Git evidence is labelled as such instead of being
treated as a clean repository. Reading or displaying this evidence performs no
workspace write or Codex action.

## Local Coffice state

Coffice stores its own bounded, versioned workspace under the operating
system's local application-data directory, never inside a project or `.codex`.
It may contain objectives, expected outcomes, optional work-item Definition of
Done entries, optional current project rules, fixed-profile project quality
bars, and review assessments written by the user, private project decision
statements and context, user-managed decision-request prompts and optional
recorded resolutions, work-item and attempt
links, result identifiers, exact-result review decisions, structural evidence
receipts, Attention dispositions, snooze timestamps, and migration receipts.
Review assessment text can include the user's assessment, risks, uncertainties,
decisions needed, and an advisory next step. Project decision history can also
contain correction or replacement statements, their optional context, and an
optional withdrawal reason. The file is replaced atomically and retains a
last-known-good backup. Recovery from backup is shown to the user and blocks new
writes until acknowledged.
The workspace and backup are ordinary local files protected by the operating
system account and filesystem; Coffice does not add application-level
encryption.

Workspace schema v12 keeps task associations as time-bounded link segments and
user-authored assessments against either a work item or one exact result. It
retains the root-level `projectDecisionEvents` ledger and optional ordered
Definition of Done text, optional ordered current rules, and optional canonical
fixed-profile quality bars on projects, structural advisory work-item links,
an optional user-declared current project-context review marker, and an optional
user-authored project-review schedule. It adds bounded user-authored decision
requests against one work item or exact stored result, with reducer-stamped
authorship and timestamps plus dedicated create, update, resolve, reopen, and
remove intents.
Versions v1 through v6 migrate with rules absent; versions v1 through v7 migrate
with quality bars absent; versions v1 through v8 migrate with work links absent.
Versions v1 through v9 migrate with the context-review marker absent. Their
strict parsers reject those backported fields. Versions v1 through v10 migrate
with the project-review schedule absent and reject a backported
`reviewSchedule` field. Versions v1 through v11 migrate with an empty decision-
request list and reject a backported `decisionRequests` field. Versions v1
through v5 migrate with Definition of Done absent.
Versions v1 through v4 gain an empty decision ledger; v5 preserves its existing
decision events. Recorded, corrected, replaced, and withdrawn
states remain as an append-only event chain while the project exists;
correction and replacement are explicit structural kinds rather than
interpretations of the text.

The read-only **Compare saved evidence** projection adds no schema field or API.
It treats one selected exact stored result as a transient reference and pairs it
only with the final stored result from another same-work-item attempt explicitly
linked as an alternative. A pair is omitted when both sides lack substantive
saved evidence; timestamps by themselves do not disclose an otherwise empty
panel. Selecting a comparison alternative performs no local-workspace write,
verification run, or Codex action.

The projection is deliberately structural. It may show attempt and result
ordinals, observation time, durable exact-result review mark and timestamp,
decision kind and timestamp, current exact-result user-note presence, update
time, and counts,
advisory-action kind without its text, and the newest retained exact verification
receipt in workspace order.
Verification profiles use allowlisted display labels or a generic fallback, and
only one structural receipt time and structural failure states are shown. Saved
decision-note counts are private annotations, not the canonical needs-decision
count or a result-observation-time snapshot. The projection never
publishes IDs, hashes, paths, commands, output, result or artifact content,
assessment or advisory text, project rules or decision entries,
review-decision notes, Definition of Done, repository evidence, or work-item
assessments. It neither compares content,
diffs, artifacts, or quality nor ranks, selects a winner, recommends an action,
or attributes Git state. Opening, selecting, and closing it create no workspace
write, verification run, or Codex action.

Project decisions are not copied onto objectives or work items and remain
separate from exact-result review decisions, assessments, evidence, Attention,
verification, and Codex operations. Recording, superseding, or withdrawing one
does not accept work, change workflow state, create evidence, resolve an alert,
or contact Codex. The workspace reducer records the time and fixed user
authorship rather than trusting those fields from the browser.

Review & Act may show a collapsed, read-only projection of the active decision
heads for the exact project in the stored work context. A historical result uses
its source project even if the task later moves. These are the project's current
decisions, not a result-time snapshot, project rules, evidence, or Codex output.
Displaying them adds no workspace field or copy, mutation, action permission,
network request, or content exposure beyond reading the existing local
versioned workspace through its existing no-store boundary.

Definition of Done entries are current user-authored plan context, not a
result-time snapshot. They remain advisory even when Review & Act displays them
beside a historical result. Coffice does not automatically check, score, infer,
or mark them complete; they do not create evidence, quality-check profiles,
Attention items, decisions, workflow transitions, or release readiness.
Defensive count and text bounds reject invalid writes atomically without silent
deduplication or truncation. Those limits protect the local file and parser;
they are not product tiers or recommended checklist sizes.

The entries use the same local workspace, atomic replacement, and
last-known-good backup as the rest of the plan. Clearing them removes them from
the current workspace, while the backup may retain the previous revision until
a later successful replacement rotates it. A successfully applied request also
leaves a bounded, local SHA-256 digest of its canonical mutation content for
idempotent retry detection. The raw cleared text disappears from the current
workspace, but its request digest remains until the bounded mutation receipt is
evicted. The receipt contains no raw text, derives from the full canonical
mutation rather than the text alone, and stays within the local no-store
workspace boundary. Removing their work item or project
removes them from the current workspace under the existing plan rules. The
campus digest and browser alert digest ledgers neither copy nor retain this
text. Definition of Done is excluded from Codex source snapshots, event streams,
URLs, logs, evidence and verification receipts or requests, and Codex action
payloads. The text necessarily traverses the local no-store workspace API when
it is read or changed.
In particular, current-plan and failed-check follow-up drafts do not copy it;
adding it to any future Codex instruction would require a separate explicit
product contract and confirmation.

Project rules are current user-authored advisory text, not a historical record,
result-time snapshot, Definition of Done, quality bar, evidence, verification
rule, or automatically enforced policy. Coffice does not check, score, infer,
or correct them, and they do not create Attention items, workflow transitions,
result decisions, quality-check receipts, release readiness, or Codex actions.
They are excluded from Codex source snapshots, evidence and verification data,
URLs, logs, and action payloads. In particular, neither the current-plan builder
nor the failed-check repair builder copies them. The text necessarily traverses
the local no-store workspace API when read or changed.

Rules use the same atomic local workspace and last-known-good backup as the rest
of the plan. Clearing or deleting their project removes their raw text from the
current workspace, while the backup may retain the prior revision until a later
successful replacement rotates it. A successful mutation leaves a bounded,
local SHA-256 digest of the full canonical request for idempotent retry
detection. The receipt contains no raw rule text, remains inside the local
no-store boundary, and persists only until bounded receipt eviction; because it
is content-derived, it may permit guesses about low-entropy text to be checked.
Defensive entry, count, aggregate-text, and workspace bounds reject invalid
writes without truncation or deduplication. They protect parsing and storage and
are not product tiers or recommended rule counts.

Project quality bars contain only allowlisted structural profile identifiers
and version `1`; they contain no user text, command, path, environment, output,
or result content. They remain in the local workspace and last-known-good backup
and necessarily traverse the local no-store workspace API when read or changed.
Clearing or removing their project removes them from the current workspace; a
prior backup may retain the previous selection until a later successful write
rotates it. Bounded mutation receipts retain the existing canonical-request
digest for idempotency, not a separate quality-bar log.

The readiness projection reads the exact stored source project's selected bars
and the final retained exact-result receipt in current workspace order for each
profile. It exposes only the fixed display label, structural state, and one
receipt time as Ready, Not ready, Unknown, or Not configured. It does not run a
check, copy verification output, infer missing history, create evidence, change
Attention or work state, recommend a result decision, block acceptance, or send
anything to Codex. Quality bars are excluded from Codex source snapshots,
events, URLs, logs, action payloads, and verification requests except when the
user separately confirms one of the already-supported fixed verification
profiles.

Work-item relationships contain only the structural link kind and same-project
objective/work-item identifiers needed to resolve the target. They contain no
free text, task content, command, path, evidence, assessment, status, or result
claim. The current workspace and last-known-good backup may retain them until
normal atomic replacement and backup rotation removes an earlier revision;
bounded mutation receipts retain only the existing canonical-request digest.

Plan and Review & Act resolve target titles from the already-loaded local
workspace for display, but do not copy those titles into the relationship
record. Links are excluded from Codex source snapshots, events, Attention,
verification requests and receipts, action payloads, URLs, logs, and browser
reports. Reading or changing them necessarily traverses the local no-store
workspace API. They never trigger a workspace status mutation, Codex action,
verification run, or acceptance decision by themselves.

The project-context review marker contains canonical stale/contradictory kinds,
an optional user-authored note, a timestamp, and fixed user authorship. It is
stored only in the local workspace and last-known-good backup and necessarily
traverses the local no-store workspace API. Clearing or deleting its project
removes the marker from the current workspace; a backup may retain the prior
revision until normal rotation. The bounded mutation receipt contains only the
existing canonical-request digest, not a separate context-review log.

The note is plain text rendered safely. It is excluded from Codex snapshots,
events, Attention, evidence, verification requests and receipts, action
payloads, URLs, logs, browser reports, current-plan follow-ups, and repair
drafts. Coffice does not infer a marker from other private text or expose it as
proof about a result. The structural concern kinds may appear in local Plan and
Review UI only when the user has explicitly saved them.

The project-review schedule contains only absolute timestamps, an optional
whole-day repeat interval, and fixed user authorship. It remains in the local
workspace and last-known-good backup and crosses only the local no-store
workspace API. Due-state projection creates a structural Attention event key;
it adds no task content, command, path, environment, output, or transcript.
Clearing or completing a one-time schedule can leave the prior value in the
backup until normal rotation, while bounded mutation receipts retain only their
existing canonical request digest.

Coffice checks due schedules only while the app is open. If optional desktop
alerts are enabled, a due reminder follows the existing open-page notification
policy and uses the same fixed, generic payload as other Attention events. The
project name remains inside Coffice. A schedule never runs verification,
contacts Codex, changes work status, marks context stale, or accepts a result.

Closing or moving a task link preserves earlier results, exact-result decisions,
evidence, and verification receipts in their original project context. A
continuation accepts only structurally new result identifiers; Coffice does not
order Codex event timestamps against local interaction timestamps.

Assessment text is never inferred from a Codex response, transcript, review
operation, or verification output. It is not sent to Codex merely because the
user records an advisory next step. Any later Codex action still requires its
own supported availability checks and explicit confirmation. The text is
available only through the local, no-store workspace API; it is excluded from
the source snapshot, event stream, evidence receipts, action and verification
requests, URLs, and logs. Clearing an assessment removes it from the current
workspace; the last-known-good backup may retain the previous revision until a
later successful replacement rotates that backup.

Project decision text follows the same local-only boundary: Coffice never
derives it from Codex content or sends it to Codex merely because it is saved.
Removing a project removes its decision history from the current workspace so
private text is not orphaned, but the last-known-good backup may retain the
prior revision until a later successful write rotates it.

Legacy browser-local Attention receipts are imported once into this workspace
and removed only after the durable write is confirmed. Neither store contains
prompt, response, preview, transcript, or tool content.

Optional desktop-alert presentation uses three separate, versioned same-origin
browser `localStorage` records. They contain the user's Coffice enablement
preference, a bounded handled-delivery ledger of SHA-256 event-key digests, and
bounded project mute state containing only domain-separated SHA-256 digests of
exact project IDs, including the explicit unassigned-sessions ID. They contain
no raw event key, timestamp, project or task identity, event kind,
title, reason, summary, route, prompt, response, preview, transcript, tool body,
or result content. Neither hash record is copied into the versioned workspace
or any request. Origin-scoped Web Locks coordinate visible-page presence, mute
changes, final eligibility reads, and at-most-once claims between open Coffice
tabs without exposing work data.

The campus digest and project-scoped wayfinding derive their groups and numeric
aggregates from the already sanitized Attention view. Campus cards, Digest
groups, project drawer rows, office controls, and office inboxes keep total
actions, structural replies needed, user-managed decisions needed, and unread
completed results distinct. They
use only the admitted item's existing project identifier, including the exact
explicit unassigned route, and expose no event key or request content in those
counts. They store no digest copy, project index, title, reason, or summary and
do not infer ownership from task text, paths, or working directories. Until the
Attention review state is ready, the interface reports these aggregates as
unknown rather than persisting or inventing a zero.

Opening an item writes only the existing opaque event key and structural
`needs_review` timestamp. That marks a completed result as seen and therefore no
longer unread, but it does not claim that a structural request for input was
answered; a seen request remains in the replies-needed aggregate while it is a
canonical Attention item. An open user-managed decision request creates one
stable structural Attention identity; its prompt and optional resolution are
never copied into Attention, Digest, the in-app cue, numeric projections, or a
desktop alert. Resolving or removing that exact request clears its current
Attention item, while reopening makes it structurally eligible again under the
normal disposition rules. User-authored `blockedDecisions` are private review
notes, not durable decision requests, and are never counted. The numeric
projections add no state, storage, endpoint, operating-system notification, or
write to either the Coffice workspace or Codex.

The in-app transition cue consumes only additions to that same sanitized,
ordered Attention view. Its first authoritative fresh render silently baselines
all current event keys, preventing an initial backlog flood. Later it may show
only a new key without an existing disposition. Event identities are kept only
in bounded memory for the current mounted application; reaching the internal
safety bound fails quiet without evicting identities, persistence, or cross-tab
synchronization. The cue is hidden while evidence is stale or unavailable, and
it admits or baselines nothing while the source is not authoritative and fresh.

The cue renders fixed structural labels plus the existing task and project
identity. It does not render an Attention reason, recommended action, response,
preview, transcript, or tool content. Merely displaying or closing a cue writes
nothing. Explicitly opening it revalidates the current target, attempts to write
only the existing opaque event key and structural `needs_review` timestamp, and
routes to the exact live task or stored result even if that receipt fails; an
invalid or vanished target produces no write or route. The in-app cue itself
does not invoke the operating system's Notification API, play a sound, persist
cue state, or synchronize its session memory between tabs.

The separate optional desktop-alert channel is exposed only inside the global
Digest. Coffice requests browser-owned notification permission only from the
user's direct **Enable desktop alerts** activation. It never prompts on load,
reload, focus, visibility change, or Digest open. Denial remains browser-owned;
turning Coffice alerts off does not revoke that permission. Unsupported,
blocked, inaccessible, corrupt, or defensively full delivery-history state pauses
desktop delivery without weakening the in-app Attention experience or clearing
the digest ledger in a way that could replay alerts.

On enable, permission restoration, or reload, Coffice silently baselines the
current authoritative fresh events. Only a later new canonical batch is
eligible, and only while every open same-origin Coffice page is backgrounded.
Any visible page permanently suppresses desktop delivery for that batch; the
foreground in-app cue remains the channel. Coffice claims every event digest in
the batch before attempting display, so constructor failure is not retried and
other tabs cannot duplicate it.

Per-project choices affect only future desktop presentation. A missing mute
record means no projects are muted. An unreadable or inaccessible mute record
fails quiet; exact rows remain unresolved rather than guessing. A full valid
record refuses only a new mute: existing choices and eligible delivery continue.
The user can explicitly confirm a reset that replaces even corrupt or full state
with an empty mute record. Valid digests for projects no longer shown are
retained until that reset, so a temporarily absent, re-added, or renamed exact
project keeps its choice without storing its raw identity.

All events in a new canonical batch are permanently claimed, including muted
events, so unmuting cannot replay past work. A wholly muted batch shows nothing;
a mixed batch may show one fixed generic alert based only on its eligible event
count. Cross-tab Web Lock ordering ensures a concurrent mute change,
foreground-page suppression, and delivery claim cannot each act on a different
preference snapshot. Muting does not change canonical Attention, its counts,
the in-app cue, routing, workflow placement, the Coffice workspace, or Codex.
It also cannot withdraw a generic alert already retained or displayed by the
browser or operating system.

The operating-system payload contains only `Coffice` and fixed generic copy:
either `A new action is ready. Open Coffice to review it.` or `New actions are
ready. Open Coffice to review them.` It supplies no project name, task name,
event kind, reason, request, result, preview, route, notification data, or
navigation URL, and it requests silent presentation. The browser or operating
system may nevertheless retain this generic text in notification history or on
a lock screen.

Displaying, suppressing, dismissing, or closing the alert writes neither the
Coffice workspace nor Codex and does not mark Attention seen. Clicking it
best-effort focuses its still-open Coffice page, revalidates the first canonical
item, attempts only the existing opaque seen receipt, and opens the exact live
task, exact stored result, or explicit unassigned holding route even if that
receipt fails. A vanished, resolved, stale, cross-project, or malformed target
produces no receipt or route. There is no service worker, push subscription,
server delivery, closed-app notification, custom sound, scheduled digest, or
project-specific notification content.

## Confirmed Codex actions

Coffice can send a follow-up instruction, request a detached review, or archive
a finished task only after the user confirms the exact target and action. The
loopback endpoint accepts a fixed action schema and checks fresh task metadata
before the App Server independently confirms that the task is idle. Archive is
admitted only for a task observed as completed or failed. Instruction text is
passed transiently to Codex and is not stored in the workspace, operation list,
error state, or logs.

Archive sends only the opaque task identifier through App Server
`thread/archive`. A confirmed empty response records structural completion; a
lost or malformed response becomes unknown and is never retried automatically.
The task leaves active Coffice views only when the normal Codex metadata source
reports that change. Coffice does not delete the thread or erase the local work
plan, result, decision, assessment, evidence, or verification history associated
with it.

Coffice can request cancellation only for an active follow-up or detached review
that the current bounded operation manager started and still binds to an exact
task and turn. The browser sends the opaque task and operation identifiers; the
manager resolves the exact thread and turn and sends `turn/interrupt`. Coffice
stores only a cancellation-request timestamp and the existing structural
lifecycle receipt. It does not store task content, output, commands, paths, or
the interruption response body. Acceptance of the stop request is not presented
as a terminal outcome: Coffice waits for the matching turn event. A lost outcome
becomes unknown and is never retried automatically.

For a task with one unique current open Coffice plan link, the user may
explicitly copy the current objective, optional objective success definition,
work item, expected outcome, and active user-recorded project decision text into
that editable instruction. Nothing is copied or sent automatically. Historical
links, superseded decision versions, withdrawn decisions, IDs, timestamps,
assessments, evidence, repository data, paths, task messages, prompts, responses,
and tool content are excluded. The optional `Recorded context` attached to a
current active project-decision head is included and labelled explicitly. A
historical result view still uses the task's current open link, never the
result's former project. The complete snapshot must fit the existing 8,000-unit
instruction bound; Coffice never truncates or partially omits it, and manual
compose remains available. The copied snapshot exists only in the composer and
confirmation preview; canceling, changing tasks, or completing the request
clears it. Only the user's final explicit confirmation sends the exact visible
text through the existing non-retaining action path.

For a failed local quality check, Coffice may also prepare a repair follow-up
from safe structured fields already present in the local workspace. It requires
one unique current open task link, that attempt's current latest result, and the
newest receipt for the complete exact-result target. The receipt must describe
one failed fixed tests, type-check, lint, or production-build check. A later
pass, queued or running check, unknown outcome, different result, closed link,
or ambiguous link disables the helper rather than reviving an older failure.

The repair draft contains the same current plan context plus the public fixed
check label, structural failure kind, optional signed exit code, and a plain
request to diagnose, repair, rerun the check, and report the outcome. It never
copies receipt, result, attempt, work-item, objective, project, or task IDs;
timestamps; command output; logs; commands; paths; environment values; evidence;
assessments; messages; prompts; responses; transcripts; or tool content. The
whole draft must fit the existing 8,000-unit instruction bound. Coffice does not
truncate or partially insert it, and manual composition remains available.

Preparing the draft does not execute a repair, rerun verification, write the
workspace, or contact Codex. The text remains editable and transient, and the
existing separate confirmation is still required to send the exact visible
instruction through the same non-retaining follow-up action. No new workspace
schema, endpoint, or App Server method is introduced.

The App Server session requests history-free responses and opts out of ordinary
content-bearing notifications. If a response unexpectedly contains turns, the
operation fails closed. Coffice normally retains only opaque task, operation,
thread, and turn identifiers; lifecycle state; timestamps; and bounded
structural error codes.

One narrow exception lets the user answer an exact clarification or one-time
command approval for a turn that this Coffice process started and still tracks.
The bounded callback body may exist transiently in manager memory, the no-store
loopback response, and the current Review & Act UI. It is bound to the exact
operation, task, lifecycle thread, turn, callback request, and App Server item.
Clarification bodies and answers, including secret inputs, are never written to
the Coffice workspace, local or session storage, operation records, logs,
reports, URLs, Attention, verification receipts, or public snapshots. The
browser clears answer values when dispatch begins, and the manager removes its
request body before sending the JSON-RPC response. Resolution, terminal state,
transport exit, or task-view replacement clears the remaining transient UI.

Only an App Server decision explicitly offered as one-time `accept`, `decline`,
or `cancel` can be returned. Coffice never offers session-wide approval,
additional permission profiles, or execution/network policy amendments. A
file-change callback does not include the patch body, so Coffice can show its
bounded reason and grant root but offers only decline or stop; approval remains
in Codex. Permission-profile callbacks also remain in Codex. A lost response is
marked unknown and never retried automatically, because repeating an answer or
approval could apply it twice.

## Confirmed local verification

The user may explicitly confirm a fixed local quality-check profile for one
exact stored result. The browser cannot provide a command, path, argument,
environment value, or sandbox policy. The server resolves the current saved
primary root and runs only the versioned tests, type-check, lint, or build
profile through Codex App Server `command/exec`.

These profiles execute the project's own package scripts. They are trusted local
code, not an untrusted-code isolation guarantee. The command runs without a
shell, stdin, or TTY; network access is disabled; project writes are limited to
the authoritative primary root; and time and output are bounded. Standard
sandbox-managed temporary locations may remain writable. The installed
workspace-write sandbox may permit broader reads than writes, so the
confirmation names this trust boundary before execution. If that restricted
sandbox is unavailable, Coffice keeps the receipt unknown without executing the
project script, retrying it, or falling back to unrestricted execution.

The App Server may return bounded standard output and standard error to the
Coffice process as part of its response envelope. Coffice discards both
immediately after projecting the signed exit code. Output is never stored,
published, logged, rendered, placed in an error message, or copied into an
Attention item. Durable verification receipts contain only opaque identifiers,
the exact result target, profile and check versions, structural state,
timestamps, and a structural failure kind. Unknown outcomes are not retried
automatically, and passing verification never changes the user's review or
decision. A confirmed cancellation requests termination, but an outcome that
cannot be proved remains unknown and is not silently retried.

## Network behavior

The application serves its UI, snapshot, workspace, action, and verification
endpoints on the loopback interface. Metadata reads, workspace writes, Codex
actions, and verification runs reject non-loopback authorities, mismatched
origins, and cross-site requests. Coffice does not require a cloud service for
classification or office behavior.
Dependency installation and development tooling may contact their normal
package or browser providers; those operations are separate from the runtime
adapters.

Browser checks and screenshots are not currently stored as exact-result
evidence. Confirmed verification runs with network access disabled, which also
blocks localhost, and the supported execution policy cannot grant loopback-only
access. Development browser acceptance remains separate tooling; it is not
silently promoted into a receipt, persisted screenshot, or user-approved
artifact.

## Reporting a concern

Do not include authentication files, tokens, prompt content, response content,
or private session data in an issue. Follow [SECURITY.md](../SECURITY.md) for
private vulnerability reporting.
