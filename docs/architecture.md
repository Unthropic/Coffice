# Architecture

Coffice isolates approved local Codex metadata from presentation and from
Coffice-owned review state. The UI consumes a normalized model and never reads
Codex storage directly.

## Desktop companion

The default route is a playful office companion. It uses a lightweight,
read-only roster feed and owns only presentation state: selection, atmosphere,
and playful movement. Simulated demo occupants are explicitly labelled and do
not enter the live roster. The earlier planning and review application is
available at `/workbench`; its contracts below remain in force.

The Electron shell starts a bundled Next standalone service on
`127.0.0.1:3003` using its own Node runtime. The renderer has no Node integration
and uses sandboxing and context isolation. External navigation is restricted.
Closing the shell stops only its own service. Port conflicts are reported
without killing an existing process, and Codex itself is never restarted.

## Runtime layers

1. **Read-only source adapters** inspect explicitly approved Codex metadata.
2. **Normalization** produces projects, current top-level tasks, statuses,
   timestamps, and evidence with provenance.
3. **Snapshot delivery** publishes bounded local snapshots and server-sent
   updates without blocking the interface during enrichment.
4. **Coffice state** stores objectives, work items, attempt links, result cycles,
   user-authored review assessments, project decision history, exact-result
   decisions, evidence receipts, and Attention state separately from Codex-owned
   data.
5. **Office world state** owns desks, routes, collision, movement, selection,
   animation, and local preferences.
6. **Action and verification bridges** expose narrow, confirmed allowlists over
   the local Codex App Server and retain only structural lifecycle receipts.
7. **React presentation** renders the campus, top-down offices, outcome plan,
   Attention inbox, Review & Act inspector, and degraded states.

## Privacy and ownership boundaries

- Source adapters may read only approved metadata and must fail closed.
- `.codex/auth.json`, credentials, environment secrets, message previews,
  `first_user_message`, prompts, responses, transcripts, and tool payload bodies
  are outside the data model.
- Coffice never writes to Codex-owned files or databases.
- Coffice-only plans, user-authored review assessments, project decision
  history, exact-result decisions, and receipts use a separate, bounded,
  versioned local store. It never contains Codex task conversation content or
  command output. Workspace schema v12 retains v11's time-bounded task links,
  exact work-item or result assessment targets, and root-level
  `projectDecisionEvents` ledger and optional ordered Definition of Done text,
  optional ordered current rules, optional fixed-profile project quality bars,
  optional advisory same-project work-item relationships, an optional explicit
  current project-context review flag, and an optional user-authored project-
  review schedule. It adds user-authored `decisionRequests` against one work
  item or exact stored result. Versions v1
  through v6 migrate with project rules absent, versions v1 through v7 migrate
  with quality bars absent, and versions v1 through v8 migrate with work links
  absent, versions v1 through v9 migrate with the context-review flag absent,
  versions v1 through v10 migrate with the review schedule absent, and versions
  v1 through v11 migrate with decision requests absent;
  legacy schema versions reject newer fields rather than accepting a mixed-version
  shape.
  The existing order of work items within an
  objective remains their milestone order, so ordered milestones still add no
  entity or field. Versioned verification receipts target one exact result
  cycle and can be written only by the server-side verification boundary.
- The store uses revision checks, idempotent mutations, atomic replacement, and
  a last-known-good backup. A recovered backup is disclosed and write-locked
  until the user reviews it.
- Inferred values never become observed evidence.
- Snapshot, event, workspace, action, and verification endpoints accept only
  the fixed local loopback authorities and reject mismatched origins and
  cross-site requests.

## Thread discovery, naming, and grouping

The current Codex `state_5` view is the read-only authority for office
membership. Coffice admits current, visible, top-level user tasks and excludes
archived, hidden, internal, and subagent threads. Explicit local-project
assignments are authoritative for grouping; an admitted unassigned task remains
projectless instead of being guessed into a project from its working directory.
Assignment provenance remains explicit in the normalized snapshot. Missing,
stale, malformed, contradictory, or unknown assignment metadata cannot enable
plan reassignment controls.

The current Codex display name is preserved. A generic label is used only when
that metadata is unavailable. Rollout files may enrich an admitted task with
safe structural status evidence, but cannot admit or assign it.

## Outcome planning and milestone order

The current objective owns a sequence of outcome work items. Those existing
work items are Coffice's milestones; there is no separate milestone hierarchy.
Their stored sibling order is an advisory plan, and newly created work appends
to the end. Reordering is a permutation of the same stable work-item identities,
so linked attempts, result cycles, reviews, decisions, assessments, and
verification receipts remain attached to their original work item.

Milestone order does not prove execution order and does not change workflow
state. It never accepts a result: acceptance remains an explicit immutable user
decision on one exact result cycle. It does not itself create dependencies,
enforce gates or dates, dispatch Codex work, start a task, or automatically
advance another item. Explicit work links are modeled separately and remain
advisory rather than being inferred from list position.

Each work item may also carry an ordered, user-authored Definition of Done.
The required expected outcome remains the concise result the item intends to
produce; Definition of Done entries are optional current criteria the user may
consult while reviewing it. They are advisory text, not observed evidence,
checkbox completion, verification profiles, project-wide quality bars, result
decisions, or release gates. Review & Act labels them as current context even
for a historical result; Coffice does not claim they were frozen when that
result was observed.

Schema v6 stores normalized plain-text entries in their authored order. A
dedicated intent mutation changes only this field and current timestamps on the
work item and its parents, preserving the current status, attempts, results,
and link history at apply time. Generic project, objective, and work-item
upserts may still change their other permitted fields, but preserve the current
Definition of Done on every existing work item instead of trusting a stale
whole-object copy. Revision conflicts still fail atomically. Defensive per-entry, count, aggregate-text,
and whole-workspace limits protect parsing and storage; they do not define a
product tier, preferred checklist size, or automatic truncation policy.

## Current project rules

Schema v7 lets each saved project carry an optional ordered list of normalized,
user-authored current rules. They are advisory project context: not a historical
ledger, quality bar, Definition of Done, observed evidence, verification rule,
or automatically enforced policy. Coffice does not infer compliance, staleness,
or contradiction; rules do not change workflow state, Attention, result review,
verification, release readiness, or Codex availability.

A dedicated `project.rules.set` intent mutation locates the current project at
apply time and replaces only its rules and timestamp. Existing whole-project
upserts preserve the current rules rather than trusting a stale object copy; a
new project may seed them. Revision conflicts and idempotent retries retain the
workspace store's existing atomic semantics. Removing the project removes its
rules from the current workspace. Defensive entry, count, aggregate-text, and
whole-workspace bounds reject invalid writes atomically without deduplication or
truncation; they are technical safety limits, not product tiers or recommended
rule counts.

Versions v1 through v6 migrate to the current schema with rules absent. Their
strict parsers reject an injected `rules` field, so old-version data cannot
silently opt into new semantics. Rules are current-only: schema v7 added no rule history,
result-time snapshot, evidence receipt, enforcement engine, or stale-context
model. They are also excluded from the source snapshot and from both the
current-plan follow-up builder and the failed-check repair builder.

## Project-wide quality bars

Schema v8 lets a saved project select any canonical subset of the fixed
`test@1`, `typecheck@1`, `lint@1`, and `build@1` verification profiles. These
bars express the user's current project-wide standard; they are not free text,
work-item Definition of Done entries, inferred policy, or result-time snapshots.
Their stored order is canonical and carries no priority or execution sequence.

A dedicated `project.qualityBars.set` intent replaces only the current bars and
project timestamp. A new project may seed bars in its first atomic upsert, while
generic upserts preserve the current bars on an existing project. Revision
conflicts, idempotent retries, atomic replacement, backup rotation, and project
removal use the existing workspace semantics. Versions v1 through v7 migrate to
the current schema with bars absent and reject a backported `qualityBars` field.

Review & Act resolves bars from the exact stored source project and projects the
final retained matching receipt in workspace order for each selected profile on
the exact result target. All selected checks passed means **Ready**; any failed
check means **Not ready**; a missing, queued, running, or unknown outcome means
**Unknown**. No selection is **Not configured**. This is a visible summary of
retained structural receipts, not a new receipt, quality score, release gate, or
claim about checks that may have been evicted. Changing bars does not run a
verification, create Attention, alter work status, recommend a decision, or
contact Codex. Readiness never enables or disables result acceptance.

## Advisory work-item relationships

Schema v9 lets a work item carry an optional authored-order list of explicit
same-project links. `depends_on` means the named target precedes the current
item; `hands_off_to` means the current item precedes the named target. Order in
the stored list is presentation only. The workspace rejects self-links, missing
targets, repeated directions, and cycles atomically. Removing a referenced work
item or objective is rejected until its links are cleared; removing the whole
project removes its links with the project.

Only the dedicated `workItem.relationships.set` intent changes links on an
existing item. Generic project, objective, and work-item upserts preserve the
current list instead of trusting stale whole-object copies. Versions v1 through
v8 migrate to the current schema with links absent and reject a backported
`relationships` field. The existing revision, idempotency, atomic replacement,
and backup-rotation rules apply.

These links are current user-authored planning context, not observed evidence,
workflow state, task-attempt relationships, executable gates, or result-time
snapshots. Plan can author them and Review & Act reads them from the exact stored
source work item. Coffice does not infer blocked or unblocked state, update
Attention, run verification, contact Codex, start another task, recommend a
decision, or prevent acceptance from them.

## User-declared project-context review

Schema v10 adds one optional current `contextReview` marker to a saved project.
It records the canonical concern set (`stale`, `contradictory`, or both), an
optional normalized user note, the reducer-stamped time, and fixed user
authorship. Coffice never derives this marker from age, free text, rules,
decisions, Definition of Done, results, or Codex activity.

Only `project.contextReview.set` and `project.contextReview.clear` change the
marker on an existing project. Generic project upserts preserve it. Revision
conflicts, idempotent replay, atomic replacement, project deletion, and backup
rotation use the existing store semantics. Versions v1 through v9 migrate with
the marker absent and reject a backported `contextReview` field.

Plan lets the user flag, edit, or explicitly mark the current context reviewed.
Review & Act shows the current marker from the exact stored source project,
including for a historical result. It is not a result-time snapshot, evidence,
Attention state, readiness result, correction history, or claim that the result
is affected. Setting or clearing it does not rewrite context, run verification,
contact Codex, change workflow state, recommend a decision, or gate acceptance.

## Scheduled project review

Schema v11 lets a saved project carry one optional user-authored review
schedule: the next absolute review time, an optional whole-day recurrence,
configuration time, and the last explicit completion time for a recurring
schedule. Versions v1 through v10 migrate with no schedule and reject a
backported `reviewSchedule` field.

Plan can create, edit, remove, or explicitly complete the schedule. A one-time
schedule clears when completed; a recurring schedule calculates its next time
from the explicit completion, so missed intervals do not create a backlog. A
due occurrence becomes one exact local Attention item and routes to the project
Plan. Opening it records only normal Attention seen state; it remains due until
the user completes, removes, dismisses, or snoozes that occurrence.

The schedule is not a background job. Coffice evaluates it while the local app
is open, and optional desktop delivery retains the existing open-page policy.
It never marks context stale, infers project health, changes work status,
accepts a result, starts Codex, or runs a quality check. Project quality bars
remain a manual user choice at an exact result.

## Project decision history

Each saved project can own independent, user-authored decision chains in the
root-level `projectDecisionEvents` ledger. A `recorded` event begins a chain. A
`superseded` event replaces the current active head and carries a structural
`supersessionKind` of `correction` or `replacement`; this distinction is never
inferred from prose. A `withdrawn` event closes an active chain without a
replacement statement. The active projection contains only recorded or
superseded events that have not been consumed by a later event, while every
earlier event remains available in immutable history.

The browser supplies an opaque structural event identifier, but the workspace
reducer stamps the event time and the fixed `user` authorship. A supersession or
withdrawal must target an earlier, currently active head in the same project.
Cross-project targets, branches, repeated withdrawals, self-references, and
duplicate event identifiers fail closed. Workspace versions v1 through v4
migrate with an empty decision ledger; v5 preserves its existing decision
events. Versions v1 through v5 migrate with no Definition of Done fields, and
versions v1 through v6 migrate with no project rules, versions v1 through v7
migrate with no project quality bars, and versions v1 through v8 migrate with no
advisory work-item relationships.

This first slice is deliberately project-scoped; it does not duplicate decisions
onto objectives or work items. Project decision events are separate from exact-
result review decisions, user assessments, evidence records, Attention,
verification receipts, and Codex operations. Recording or changing one has no
side effect on acceptance, workflow state, action availability, notifications,
or Codex. Entries are append-only for as long as their project exists. Removing
the project deliberately removes its decision events from the current workspace
rather than leaving orphaned private text; the last-known-good backup may retain
the prior revision until a later successful write rotates it.

Review & Act projects this same decision ledger as collapsed, read-only context.
It selects only the active heads for the exact project in the stored work
context; a historical result therefore keeps using its source project after its
task link moves. The projection describes the project's current decisions, not
a snapshot captured with the result. It does not reinterpret those entries as
project rules, evidence, result-review decisions, or Codex output, and it cannot
change workflow, action availability, acceptance, or any stored state.

## Status and attention

Coffice reads structural event discriminators rather than message content.
Queued, active, planning, thinking, researching, running, coding, reviewing,
waiting-for-user, completed, failed, blocked, and unknown states retain their
evidence source and timestamp. `blocked` is shown only when a source proves an
external impasse; it is never inferred from age, warnings, or text.

For an already admitted, visible, live top-level task, the App Server adapter
may make a bounded `thread/goal/get` read. Its protocol projection immediately
reduces the response to the exact thread identifier, the enumerated goal status,
and `updatedAt`; it never returns, logs, caches, or stores the goal objective,
budget, or usage fields. At most 64 exact task identifiers are read per snapshot
in bounded concurrent batches. Only a complete, well-formed read may replace
the last blocked projection. A malformed, mismatched, duplicate, partial,
oversized, or unavailable collection keeps any previously observed exact block
as stale, explicitly unavailable evidence until a later complete read resolves
or refreshes it. Only the exact `blocked` enum becomes observed blocked
evidence. Paused, usage-limited, budget-limited, active, and complete goal
states do not become blocked or overwrite the normal lifecycle projection.

The Attention inbox is an event view over this normalized state. It admits a
small set of actionable transitions, deduplicates revisions, and applies local
review, snooze, and dismiss receipts. First use baselines historical completed
results so an existing workspace does not become an artificial notification
flood. A current structural request for input remains actionable until a later
event supersedes it; age alone does not imply that the request was answered.
If the source can no longer be refreshed, the retained request becomes stale
and is not presented as current.

Reviewing an exact stored result is the authoritative resolution for that
completion. The separate Attention disposition is useful notification state,
but a failed disposition write cannot make a durably reviewed completion
reappear. A later completion revision has a different event identity and is
actionable again. Likewise, a later passing quality check resolves an earlier
failure only for the same exact result and the same versioned check profile;
another profile, another result, or an unknown run does not erase proven
failure evidence.

A durable decision request is an explicit user-authored local item attached to
one work item or exact stored result. It has a stable identity and distinct
create, update, resolve, reopen, and remove mutations. The reducer stamps user
authorship and times; a resolved request cannot be rewritten or removed unless
the user reopens it, and removing or replacing its target is rejected while the
request remains. Revision checks preserve a conflicting browser draft rather
than replaying it against newer state. This lifecycle is separate from transient
App Server approvals, private `ReviewAssessment.blockedDecisions` notes,
immutable result decisions, and the project decision ledger.

Each open request projects one structural `decision_needed` Attention event. A
work-item request routes to Plan; an exact-result request carries only the
structural stored-result coordinates needed to route back to that exact Review
context. Resolving or removing the request removes that exact event; reopening
creates the same stable request event again subject to normal Attention
dispositions. The projection includes the project and work-item title but never
the request prompt or recorded resolution.

The campus digest is a grouped projection of those same current Attention
items, not a second notification source. It preserves Attention priority and
resolution rules, counts total actions, structural requests for a reply,
user-managed decisions needed, and unread completed results separately, and
routes to the existing Plan, live-task, or exact-result review context. Opening
a completed result records the existing `needs_review` receipt so that result
is no longer unread. Opening a request for input records the same seen state but
does not claim that the user replied, so the request remains in the replies-
needed count until the canonical item is reviewed, dismissed, snoozed, or
resolved by fresh source evidence.

The in-app transition cue is another projection of that canonical ordered
Attention view, not a durable queue. On the first authoritative fresh render in
a mounted application, it silently records every current event key as its
baseline. On later authoritative fresh renders, it observes newly added keys
and admits only events with no existing disposition. An event key is never
re-cued in the same mounted application after disappearance, restoration,
snooze expiry, or a failed seen-receipt write; a genuinely new source transition
has a new key and may cue. Session memory has an internal safety bound and fails
quiet rather than evicting old identities and creating duplicate cues.

One in-flow cue batch appears below the application header. Its first item stays
stable while simultaneous new items append to the batch. Refreshing may retain
an already admitted cue with a freshness warning, but no new event is baselined
or admitted until the source is authoritative and fresh; stale or unavailable
sources hide the cue. Showing or closing the batch changes no Attention receipt,
workspace field, or Codex state. Explicit **Open** revalidates the exact current
event, attempts its existing seen-disposition write, and routes even if that
receipt fails: to the exact stored result when available or otherwise to the
exact live task and project, including the unassigned holding route. A vanished
or malformed target is consumed quietly without a write or route.

The cue is session-only presentation and resets on reload. It does not itself
use the operating system's Notification API, show a permission prompt, play a
sound, persist cue state, or synchronize between tabs. Optional browser desktop
delivery is a separate presentation channel over the same admitted batch.

Desktop alerts default off and can be enabled only from settings inside the
global Digest. `Notification.requestPermission()` runs only in that explicit
button activation; Coffice never prompts on mount, reload, focus, visibility
change, or Digest open. The browser owns the resulting permission. Unsupported,
blocked, or coordination-failure states leave the in-app cue and Digest
available, and turning Coffice alerts off does not revoke browser permission.

Enabling the channel, restoring permission, or reloading silently baselines the
current authoritative fresh Attention set. Only a later newly admitted,
undisposed canonical event batch is eligible. If any same-origin Coffice page
is visible, that batch is handled by the foreground in-app cue and is not
replayed as a desktop alert when the page later becomes hidden. When every open
Coffice page is backgrounded, origin-scoped Web Locks coordinate visible-page
presence and one delivery claimant across tabs.

The delivery claimant records the whole batch before invoking the Notification
constructor. Three separate, versioned Coffice `localStorage` records hold the
opt-in preference, a bounded handled-delivery ledger of SHA-256 event-key
digests, and bounded per-project mute state. The mute record contains only
domain-separated SHA-256 digests of exact project IDs, including the explicit
unassigned-sessions ID. Neither hash record stores raw event keys, project or
task identities, event kinds, titles, reasons, summaries, routes, or timestamps.
Claims are at-most-once attempts:
an ambiguous constructor failure is not retried. Corrupt or unavailable
storage, cryptographic hashing, Web Locks, permission, or an unreadable or full
defensive handled-event ledger pauses desktop delivery rather than resetting memory and replaying old
work. This browser-local presentation record is not part of the versioned
workspace and never writes Codex state.

Project delivery choices are managed inside the global Digest and remain
available while the global channel is off, blocked, paused, or unsupported by
the Notification API whenever safe local hashing, storage, and Web Lock
coordination are available. A missing mute record means no scopes are muted.
Unreadable mute state pauses delivery and leaves exact rows unresolved. A full
valid mute record refuses only a new mute while existing choices and eligible
delivery continue. An explicit confirmed reset replaces either state with a valid empty record,
including removal of retained choices for projects no longer shown. Valid mute
digests for absent projects are otherwise retained, so removing, re-adding, or
renaming a project does not silently alter its exact-ID preference.

The shared project-mute lock linearizes the final eligibility read with mute
changes and remains held through foreground suppression, the delivery lock,
the handled-event claim, and the synchronous constructor decision. Every event in the canonical batch is permanently
claimed whether muted or eligible, preventing replay after unmute. A wholly
muted batch produces no alert. A mixed batch can produce one fixed generic alert
whose singular or plural wording counts eligible events only; it discloses no
project membership. Muting affects only this presentation decision. It does not
filter canonical Attention, the in-app cue, numeric counts, routing, workflow
placement, the versioned workspace, or Codex.

The desktop payload is fixed to the Coffice name and generic singular or plural
copy. It includes no notification data or navigation URL and requests silent
presentation. The browser or operating system may retain the generic payload in
notification history or on a lock screen. Display, foreground suppression,
browser dismissal, and programmatic close write no Attention receipt. On click,
the owning page focuses best-effort and revalidates the first canonical item
against the current fresh or refreshing view. A valid exact stored-result
target takes precedence; otherwise an exact non-empty project and live task are
required, including the explicit unassigned holding route. The click attempts
the existing seen receipt and routes even if that receipt fails. A vanished,
resolved, stale, cross-project, or malformed target produces no receipt or
route.

This is open-page browser delivery, not a background service. It has no service
worker, push subscription, server endpoint, closed-app guarantee, custom sound,
vibration, content preview, action buttons, scheduled digest, or
project-specific content. Project muting is delivery-only and does not create
project-specific payloads. Those non-goals also prevent the desktop channel
from becoming another Attention admission or resolution model.

One canonical projection also supplies the global and exact-project numeric
aggregates shown on the campus cards, in the Digest, in the project drawer, on
the office Attention control, and in the office inbox. Every project surface
uses the exact non-empty `projectId` already carried by the admitted Attention
item. Historical result and verification actions therefore stay with their
saved result project even if the live task later moves, and explicitly
unassigned work stays under the exact holding route. Visible routes are
zero-seeded so a quiet project can truthfully show no current actions. Until
the Coffice review state is ready, these surfaces show unknown totals, replies
needed, decisions needed, and unread results instead of treating provisional
data as zero; they also do not reorder or hide projects from provisional data.

The aggregates inspect no task or request content and introduce no new
Attention admission, state, storage, endpoint, or operating-system notification
path. Computing and rendering them writes neither the Coffice workspace nor
Codex. User-authored `blockedDecisions` in a review assessment remain private
context in Review & Act; they are not durable decision requests and are never
folded into either the replies-needed or decisions-needed aggregate.

That canonical projection also drives the office's workflow-area destinations.
For a task's current exact event, a fresh `needs_input` item selects the meeting
area and an unreviewed `completed` item selects the review area. All other
admitted tasks use their stable owned desk as the automatic workflow
destination, while neutral agents remain manually movable. Review, snooze, and
dismiss receipts therefore retarget the actor to its desk through the same
Attention lifecycle; the office does not maintain a second workflow state or
infer blocked and failed destinations from weaker status signals. The
projectless holding route uses the same rules.

Spatial placement is a presentation of the actionable event, not a replacement
for it. The Attention UI remains the source of the reason, provenance, age, and
safe next action. Computing or rendering a workflow destination writes neither
the Coffice workspace nor Codex state.

The Review & Act inspector shows only evidence actually available for the
selected task or its project. Missing result, verification, and risk evidence
is labelled unavailable rather than invented. Live Git evidence keeps Codex's
authoritative saved-root order and labels each scope by path-free ordinal role.
It never merges roots or attributes repository state to a task or result. A
source-wide technical workload bound is checked before Git collection begins.
When collection is bounded out, the snapshot retains each project's exact root
count but omits root evidence arrays and the primary compatibility alias rather
than truncating scopes or publishing a partial claim. This is a collector
safety state, not a product capacity or display tier. A Codex task is linked as
an execution attempt under a work item; successive
completed revisions are separate result cycles. Reviewing a result, accepting
it, redirecting it, and rejecting it remain distinct. Decisions and their
structural evidence receipt are written atomically.

Review assessments are explicitly user-authored and remain separate from
observed evidence, result-review state, and immutable decisions. A work-item
assessment stays with that work item. An exact-result assessment stays at its
original project, attempt, and result coordinates when a task link moves, and
does not carry into a later result. A saved next step is advisory only: action
availability and confirmation are still evaluated independently when the user
chooses to act. Coffice does not treat review activity as an agent
self-critique; that field remains unreported until a supported structured source
exists.

Review & Act derives **Compare saved evidence** as a read-only projection of the
existing local workspace. One selected exact stored result is the reference.
For each other attempt under the same work item whose link relationship is
explicitly `alternative`, the projection uses that attempt's final stored
result. A pair is admitted only when either exact result has substantive saved
evidence; result timestamps alone do not create a comparison panel.

Each side exposes only its attempt and result ordinals, observation timestamp,
durable exact-result review mark and timestamp, decision kind and timestamp,
current exact-result user-note presence, update time, and bounded structural counts, advisory-action
kind without advisory text, and the newest retained verification receipt for
that exact target in workspace order.
The note counts are annotations rather than a canonical needs-decision signal.
They reflect the currently saved user annotation for that exact result, not a
snapshot captured when the result was observed.
The receipt projection uses an allowlisted profile label, falling back to a
generic check label, plus one structural receipt time and structural failure
states. It publishes
no IDs, hashes, paths, commands, output, content, assessment text, project rules
or decision entries, review-decision notes, Definition of Done text, or
repository evidence. It does not compare
result content, artifacts, diffs, or quality; rank alternatives; choose a
winner; recommend an action; infer work-item assessment; or attribute Git state.
Alternative selection is transient presentation state and performs no workspace
write, verification run, or Codex action. The workspace schema and local API are
unchanged.

An assessed target cannot be removed or replaced with a structure that would
orphan its notes; the user must clear that assessment explicitly first. The
store never silently compacts or evicts user-authored assessment text.

Moving or unlinking a task changes only its Coffice plan association; it never
changes Codex project state. A move closes the previous link segment and opens
a continuation under an existing eligible work item. Results, decisions,
evidence, and verification receipts already recorded under the previous segment
remain in their original project context. Only a structurally new result key
can attach to the continuation. Result admission does not compare Codex event
timestamps with Coffice interaction timestamps, because those clocks are not
assumed to be synchronized. Unlinking closes the current segment without
deleting its history.

Opening the task uses the supported desktop link. Follow-up, detached review,
and finished-task archive requests use a loopback, same-origin endpoint and a
narrow Codex App Server adapter. Each external action requires a separate
confirmation step, is idempotent within the bounded operation manager, and
exposes only structural lifecycle state. Resume and status reads request no
turns; an unexpected history-bearing response fails closed. Coffice does not
write Codex-owned files or databases and never retains instruction or
conversation content in an operation record.

Archive admission requires fresh observed `completed` or `failed` task metadata.
Immediately before `thread/archive`, the adapter performs a metadata-only
`thread/read` and requires the exact thread to be idle. A confirmed empty archive
response completes the operation. A timeout, transport loss, or malformed
response after dispatch becomes `unknown` and is never retried automatically.
The normal Codex source refresh removes the archived task from active office
membership; Coffice's saved plan links, result cycles, decisions, assessments,
and verification receipts remain local and unchanged. Archiving is not deletion.

An active follow-up or detached review started and still tracked by this Coffice
process may be stopped after a separate confirmation. The browser supplies only
the bounded operation and task identities. The manager resolves the exact stored
turn identity and uses the original thread for a follow-up or the detached review
thread for a review, then sends `turn/interrupt`. An empty response confirms only
that the stop request was accepted; the operation remains active with a
structural cancellation-request timestamp until its matching terminal turn event
arrives. A lost or malformed response becomes unknown, and Coffice does not
retry. Operations without an exact active turn, terminal operations, archive
operations, and cross-task IDs fail closed.

While that exact manager-owned turn is active, the App Server may pause it for
one clarification, command approval, or file-change approval. Coffice projects
at most one bounded request into process memory and the current Review & Act
view, binding it to the exact operation, task, lifecycle thread, turn, callback,
and App Server item. Clarification question IDs are replaced by local opaque
tokens in the browser and mapped back only when the response is sent. A command
may expose its exact command, working folder, reason, environment, and network
host so the user can decide; only an explicitly offered one-time `accept` is
available. Session approvals, permission profiles, and policy amendments remain
in Codex. File-change callbacks do not contain the patch, so Coffice offers only
decline or stop and never approval.

Every response has its own confirmation. The manager removes the request body
before writing the JSON-RPC response, then resumes structural lifecycle
tracking. A callback that no longer matches, a second callback for the same
operation, a lost write, or an ambiguous outcome fails closed and is never
retried automatically. Terminal state, transport exit, task change, or callback
resolution clears the transient projection. No callback body or answer enters
the workspace, operation receipt, logs, URL, report, Attention, verification,
or Codex action history.

The follow-up composer can explicitly copy a transient plan-context snapshot
from the task's one unique current open Coffice link. It includes the linked
objective and its optional success definition, the work item and expected
outcome, and the active user-recorded decision heads for that exact current
project. It never falls back to a closed or historical result context, and it
excludes IDs, timestamps, decision history, assessments, evidence, paths, and
task content. No or ambiguous current link fails quiet. The user may edit the
plain-text draft and must still review the exact normalized text at the existing
send confirmation; copying the context performs no write or Codex action. The
complete snapshot must fit the existing 8,000-unit instruction bound. Coffice
never truncates or partially omits it, and manual follow-up remains available
when it cannot fit. The workspace schema and App Server action method are
unchanged.

Current project rules are not part of this plan-context snapshot. Saving a rule
therefore never authorizes its inclusion in a Codex action payload.

The same composer can prepare a repair follow-up only when one unique current
open link, that attempt's latest stored result, and the newest verification
receipt for the complete exact-result target all agree. The newest exact
receipt must be a failed tests, type-check, lint, or production-build profile
with one matching failed check. A later pass, active run, unknown outcome, or
different current result suppresses the older failure instead of offering a
stale repair shortcut. The draft reuses the current objective, optional success
definition, work item, expected outcome, and active project-decision heads, then
adds only the fixed check label, structural failure kind, optional signed exit
code, and a request to diagnose, repair, rerun that check, and report the
outcome. It excludes identifiers, timestamps, output, logs, commands, paths,
environment values, evidence, assessments, and task content.
Current project rules are excluded as well.

Preparing this repair text only copies one transient, editable plain-text draft.
It performs no repair, verification rerun, workspace write, or Codex action. The
complete draft must fit the same 8,000-unit bound without truncation or partial
insertion, and sending still requires the existing separate exact-text
confirmation. A changed result, link, or receipt invalidates the repair binding
without silently replacing the user's editable text; cancellation, task change,
or completion clears the transient text. Coffice retains no instruction. This
adds no workspace schema, endpoint, or App Server method.

## Confirmed local verification

Review & Act can run one of four fixed, versioned quality-check profiles for an
exact stored result: tests, type checking, linting, or a production build. The
browser's execution choices are limited to the profile identity, version, and
result target. The server resolves the current saved primary root and fixed
command; browser-supplied commands, paths, arguments, environment values, and
sandbox policies are rejected. Coffice does not guess whether a project defines
the matching package script; a missing script produces an ordinary failed
receipt.

Each run requires a separate confirmation. Coffice invokes the stable Codex App
Server `command/exec` boundary with no shell, no stdin or TTY, network disabled,
project writes limited to the authoritative primary root, bounded output, and a
fixed deadline. Standard sandbox-managed temporary locations may remain
writable. Project package scripts are trusted local code: the sandbox is not
presented as an untrusted-code security boundary, and its read scope may be
broader than its write scope. Passing a check does not review, accept, redirect,
or reject the result. If the installed App Server cannot establish the required
restricted sandbox, Coffice fails closed: it records an unknown structural
outcome, does not retry automatically, and never falls back to unrestricted
execution. On Windows, executable discovery follows PATH directory order and
uses exact command-shim quoting; fixed npm profiles invoke npm's JavaScript CLI
through the current Node executable so the verification command itself still
uses no shell.

The App Server response is projected immediately to a signed exit code and
structural lifecycle state. Standard output and standard error are bounded and
discarded; they are never stored, published, logged, or shown in the UI. Durable
receipts contain only the exact result target, profile and check versions,
queued/running/pass/fail/unknown state, timestamps, and a structural failure
kind. Ambiguous outcomes are never retried automatically. Confirmed cancellation
requests termination, but records the outcome as unknown unless the final
response proves what happened. An admitted command whose termination cannot be
confirmed quarantines its project root until the underlying process or App
Server transport settles. On Coffice restart, any persisted queued or running
receipt becomes unknown rather than being replayed.

## Repository evidence

Repository enrichment is read-only and independently path-limited to every
authoritative saved-root subtree of a project, even when a root sits inside a
larger Git worktree. One globally bounded worker pool preserves Codex's saved
root order without starting an unbounded burst per project. Bounded Git status
and aggregate numstat commands collect the branch, HEAD, clean or dirty state,
coarse changed areas, and addition/deletion totals for each subtree. Branch
identity and ahead/behind remain repository-level facts. Git may inspect working
files to calculate those totals. Coffice processes repository-relative paths
only long enough to classify them; the published snapshot never contains
filenames, file bodies, patches, hunks, remotes, root names, root identifiers,
or absolute roots.

Before starting any Git command, the adapter also bounds the source-wide
collector workload. If that workload cannot be admitted, all repository
collection for the refresh fails closed: projects remain present with exact
root counts, while per-root arrays and compatibility evidence are omitted. No
root list is silently truncated.

Collection uses a generated filter-free Git control directory while referencing
the original index and object database read-only. It never copies the index,
disables lazy object fetching, and audits only hazard key names from local config
without following includes. External includes, worktree-local config, custom
clean/process filters, active filter attributes, active private attribute or
exclude metadata, excessive tracked-path inventories, and comparison-setting
ambiguity all fail closed. Thus project-configured filter commands are not
executed merely to enrich the inspector, and uncertain clean/dirty results are
not published.

The collector deliberately ignores arbitrary global Git configuration. It runs
bounded comparisons across safe line-ending, file-mode, symlink, and case
settings; if those settings change status, the evidence is unavailable. The UI
therefore labels the source as privacy-isolated Git evidence rather than claiming
equivalence with every local Git client configuration.

Paths are classified in memory into a small fixed set of areas such as Source,
Tests, Docs, Config, and Assets, then discarded. Status failure produces an
explicit unavailable record; diff-stat failure preserves the available status
summary without inventing totals. Each root keeps its own evidence and failure
state; one unavailable root does not erase another, and the scopes are never
merged into a whole-project claim. All roots remain part of the same project,
office, and task roster. This live evidence is not written to the Coffice
workspace and is not attached to a task, attempt, result, or decision. The
legacy single `repository` projection remains only as a primary-root
compatibility alias; consumers use the ordered per-root projection when it is
present.

## Top-down office world

The production room is a strict overhead 2D world. A generated plan owns the
logical world bounds, one desk per admitted task, desk contacts, spawn anchors,
shared amenities, and collision rectangles. Rendering, pointer conversion,
movement, and collision all consume that same geometry.

Desk assignments are stable across task reorder, status changes, and additions.
New tasks fill released slots before any survivor moves. When departures leave
unfilled gaps, higher assignments compact in their prior-slot order, keeping
exactly one functional desk per admitted task. The plan grows by workstation
rows with no arbitrary roster cap. The viewport applies one uniform scale, so
circles remain circular and larger rooms become pannable instead of compressing
furniture or actors independently.

Shared review and meeting anchors are part of the generated room plan rather
than fixed viewport coordinates. They grow with the same uncapped logical room,
and destination selection never removes or reassigns the actor's desk. Actors
at shared anchors remain collision-aware and return to their owned desk when the
canonical Attention event no longer qualifies.

Routes use collision-aware rectilinear pathfinding over inflated desk and
amenity footprints. Actors retain grounded contact shadows and use explicit
walk, sit, work, stand, rest, attention, and completion presentation states.
The source artwork faces screen-down, so runtime orientation maps north to
180°, east to -90°, south to 0°, and west to 90°. Reduced-motion mode settles
routes immediately and uses representative static poses.

Office movement is intentionally local. It communicates current structural
state and gives the user a spatial overview; it is not evidence that Codex has
performed an action.

## Main code areas

- `src/lib/codex-source.ts` and `src/lib/codex-thread-state.ts`: approved local
  metadata adapters
- `src/lib/snapshot.ts`: normalized snapshot construction
- `src/lib/status.ts`: evidence-aware status reduction
- `src/lib/repository-source.ts`: bounded, privacy-safe live Git summaries
- `src/lib/local-request-security.ts`: fixed loopback and same-origin policy
- `src/app/api/`: snapshot and event endpoints
- `src/components/coffice-app.tsx`: application shell and project navigation
- `src/components/pixel-office.tsx`: production office orchestration
- `src/components/top-down-office.tsx`: interactive room presentation
- `src/lib/top-down-office-world.ts`: layout, geometry, assignment, collision,
  and routing
- `src/lib/attention-inbox.ts`: attention admission and local receipt model
- `src/lib/attention-transition-cue.ts`: bounded session transition tracking
- `src/components/use-attention-transition-cue.ts`: render-safe tracker bridge
- `src/components/attention-transition-controller.tsx`: root-mounted source,
  modal, desktop-delivery, and exact-route coordination
- `src/components/attention-transition-cue.tsx`: accessible in-flow cue
- `src/lib/desktop-alerts.ts`: bounded browser preference, digest ledger, and
  same-origin Web Lock coordination
- `src/components/use-desktop-alert-settings.ts`: browser-owned permission and
  opt-in state bridge
- `src/components/use-desktop-alert-delivery.ts`: generic background delivery
  over the canonical transition batch
- `src/components/desktop-alert-settings.tsx`: Digest-owned permission and
  privacy disclosure
- `src/lib/coffice-workspace.ts` and `src/lib/coffice-workspace-store.ts`:
  versioned Coffice-owned planning, review, evidence, recovery, and persistence
- `src/lib/codex-app-server.ts`: privacy-reduced blocked-goal reads plus the
  confirmed, structural Codex action boundary
- `src/lib/verification-execution.ts` and `src/lib/verification-manager.ts`:
  fixed-profile App Server execution, exact-result receipts, and lifecycle
  coordination
- `src/components/work-planner.tsx`: project objective and work-item planning
- `src/components/review-workspace.tsx`: Attention and Review & Act UI

## Determinism and resilience

Project presentation, desk assignments, avatar variants, and routes use
authored data or stable hashes. They do not depend on AI inference, network
services, prompt content, or wall-clock randomness. Source reads and parser
caches are bounded, the initial roster can render before enrichment completes,
and malformed or unavailable metadata degrades to explicit unknown state.

## Verification

The test suite covers source discovery, normalization, status evidence,
repository-summary privacy and failure modes, local-route security, attention
receipts, workspace recovery and conflicts, project-decision migration and
lineage, result cycles and atomic exact-result decisions, action security and
lifecycle, fixed-profile verification and cancellation, exact-result receipts,
dynamic world growth, stable desk ownership, coordinate transforms, pathfinding,
movement, accessibility, reduced motion, and asset contracts. Production checks
add type checking, linting, a Next.js build, asset hash and metadata verification,
the public-boundary audit, and real browser review on `127.0.0.1:3003` across
desktop, mobile, short-height, and ultrawide viewports.

Durable browser-check and approved-screenshot evidence are not yet admitted as
product receipts. Existing confirmed verification disables network access,
which also prevents a project script from reaching a local development server;
the App Server boundary does not currently offer a loopback-only network policy.
Coffice keeps this evidence unavailable rather than weakening the established
verification sandbox or claiming that development acceptance screenshots are
exact-result evidence.
