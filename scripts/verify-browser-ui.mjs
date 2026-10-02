import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright-core";

const BASE_URL = new URL(
  "/workbench",
  process.env.COFFICE_URL ?? "http://127.0.0.1:3003",
).href;
const OUTPUT_DIRECTORY = path.resolve(
  process.env.COFFICE_ACCEPTANCE_DIR ?? "tmp/browser-acceptance/topdown",
);
const ACCESSIBILITY_ONLY =
  process.env.COFFICE_ACCEPTANCE_ACCESSIBILITY_ONLY === "1";
const FIXTURE_ID = "synthetic-topdown-structure-v2";
const PRIMARY_PROJECT_ID = "acceptance-office";
const SECONDARY_PROJECT_ID = "acceptance-secondary";
const HOLDING_PROJECT_ID = "__unassigned__";
const RENAMED_PRIMARY_PROJECT_NAME = "Renamed Acceptance Office";
const PRIMARY_TASK_COUNT = 8;
const SECONDARY_TASK_COUNT = 2;
const HOLDING_TASK_COUNT = 1;
const PRIMARY_ATTENTION_COUNT = 4;
const PRIMARY_NEEDS_REPLY_COUNT = 1;
const PRIMARY_UNREAD_RESULT_COUNT = 1;
const SECONDARY_ATTENTION_COUNT = 1;
const SECONDARY_NEEDS_REPLY_COUNT = 0;
const SECONDARY_UNREAD_RESULT_COUNT = 1;
const HOLDING_ATTENTION_COUNT = 0;
const HOLDING_NEEDS_REPLY_COUNT = 0;
const HOLDING_UNREAD_RESULT_COUNT = 0;
const GLOBAL_ATTENTION_COUNT = 5;
const GLOBAL_NEEDS_REPLY_COUNT = 1;
const GLOBAL_UNREAD_RESULT_COUNT = 2;
const DECISION_WORK_PROMPT =
  "DecisionWorkPromptPrivateCanaryMustNeverEnterAcceptanceReportsOrLogs";
const DECISION_WORK_EDITED_PROMPT =
  "DecisionWorkEditedPrivateCanaryMustNeverEnterAcceptanceReportsOrLogs";
const DECISION_WORK_DRAFT =
  "DecisionWorkPreservedDraftPrivateCanaryMustNeverEnterAcceptanceReportsOrLogs";
const DECISION_WORK_CONCURRENT_PROMPT =
  "DecisionWorkConcurrentPrivateCanaryMustNeverEnterAcceptanceReportsOrLogs";
const DECISION_RESULT_PROMPT =
  "DecisionResultPromptPrivateCanaryMustNeverEnterAcceptanceReportsOrLogs";
const DECISION_RESULT_RESOLUTION =
  "DecisionResultResolutionPrivateCanaryMustNeverEnterAcceptanceReportsOrLogs";
const DECISION_REQUEST_PRIVATE_CANARIES = Object.freeze([
  DECISION_WORK_PROMPT,
  DECISION_WORK_EDITED_PROMPT,
  DECISION_WORK_DRAFT,
  DECISION_WORK_CONCURRENT_PROMPT,
  DECISION_RESULT_PROMPT,
  DECISION_RESULT_RESOLUTION,
]);
const BLOCKED_TASK_ID = "10000000-0000-4000-8000-000000000003";
const REVIEW_TASK_ID = "10000000-0000-4000-8000-000000000004";
const FAILED_TASK_ID = "10000000-0000-4000-8000-000000000005";
const HOLDING_TASK_ID = "30000000-0000-4000-8000-000000000001";
const REVIEW_OBJECTIVE_ID = "acceptance-review-objective";
const REVIEW_WORK_ITEM_ID = "acceptance-review-work-item";
const REVIEW_ATTEMPT_ID = "acceptance-review-attempt";
const REVIEW_MILESTONE_TITLE = "Review the completed acceptance slice";
const RELEASE_MILESTONE_ID = "acceptance-release-work-item";
const VERIFICATION_MILESTONE_ID = "acceptance-verification-work-item";
const DEFINITION_OF_DONE_PRIVATE_CANARY =
  "DefinitionOfDonePrivateCanaryMustRemainOnlyInWorkspaceFixture";
const CURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY =
  "CurrentDefinitionOfDonePrivateCanaryMustRemainOnlyInWorkspaceFixture";
const CONCURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY =
  "ConcurrentDefinitionOfDonePrivateCanaryMustRemainOnlyInWorkspaceFixture";
const SECOND_CONCURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY =
  "SecondConcurrentDefinitionOfDonePrivateCanaryMustRemainOnlyInWorkspaceFixture";
const PROJECT_RULE_INITIAL_CANARY =
  "ProjectRuleInitialPrivateCanaryMustRemainOnlyInTheSyntheticWorkspace";
const PROJECT_RULE_LONG_CANARY =
  "ProjectRuleLongUnbrokenTokenForResponsiveContainmentAndPrivacyVerification";
const PROJECT_RULE_EDITED_CANARY =
  "ProjectRuleEditedPrivateCanaryMustRemainOnlyInTheSyntheticWorkspace";
const PROJECT_RULE_ADDED_CANARY =
  "ProjectRuleAddedPrivateCanaryMustRemainOnlyInTheSyntheticWorkspace";
const PROJECT_RULE_DRAFT_CONFLICT_CANARY =
  "ProjectRuleFirstPreservedDraftCanaryMustNeverEnterReportsOrLogs";
const PROJECT_RULE_CONCURRENT_CANARY =
  "ProjectRuleFirstConcurrentCanaryMustNeverEnterReportsOrLogs";
const PROJECT_RULE_SECOND_DRAFT_CANARY =
  "ProjectRuleSecondPreservedDraftCanaryMustNeverEnterReportsOrLogs";
const PROJECT_RULE_SECOND_CONCURRENT_CANARY =
  "ProjectRuleSecondConcurrentCanaryMustNeverEnterReportsOrLogs";
const PROJECT_RULE_ORPHAN_CANARY =
  "ProjectRuleOrphanedDraftCanaryMustRemainCopyableButUnsaveable";
const PROJECT_RULE_CURRENT_A_CANARY =
  "ProjectRuleCurrentSourceACanaryMustRemainWithTheHistoricalResult";
const PROJECT_RULE_CURRENT_B_CANARY =
  "ProjectRuleCurrentDestinationBCanaryMustNotAppearOnTheHistoricalResult";
const PROJECT_RULE_REPAIR_SOURCE_CANARY =
  "ProjectRuleRepairSourceCanaryMustNeverEnterTheRepairFollowUp";
const PROJECT_RULE_CANARIES = Object.freeze([
  PROJECT_RULE_INITIAL_CANARY,
  PROJECT_RULE_LONG_CANARY,
  PROJECT_RULE_EDITED_CANARY,
  PROJECT_RULE_ADDED_CANARY,
  PROJECT_RULE_DRAFT_CONFLICT_CANARY,
  PROJECT_RULE_CONCURRENT_CANARY,
  PROJECT_RULE_SECOND_DRAFT_CANARY,
  PROJECT_RULE_SECOND_CONCURRENT_CANARY,
  PROJECT_RULE_ORPHAN_CANARY,
  PROJECT_RULE_CURRENT_A_CANARY,
  PROJECT_RULE_CURRENT_B_CANARY,
  PROJECT_RULE_REPAIR_SOURCE_CANARY,
]);
const PROJECT_CONTEXT_REVIEW_INITIAL_CANARY =
  "ProjectContextReviewInitialPrivateCanaryMustRemainLocal";
const PROJECT_CONTEXT_REVIEW_EDITED_CANARY =
  "ProjectContextReviewEditedPrivateCanaryMustRemainLocal";
const DEFINITION_OF_DONE_LONG_ENTRY =
  "DefinitionOfDoneLongUnbrokenTokenForResponsiveContainmentAndOverflowVerification";
const RELEASE_MILESTONE_TITLE = "Publish the reviewed acceptance slice";
const VERIFICATION_MILESTONE_TITLE = "Verify the release candidate";
const APPENDED_MILESTONE_TITLE = "Archive the published release record";
const APPENDED_MILESTONE_OUTCOME =
  "The published slice has a durable release record.";
const APPENDED_DEFINITION_OF_DONE = [
  "The release record identifies the reviewed slice.",
  "The release record can be recovered locally.",
];
const INITIAL_PROJECT_DECISION =
  "Keep ProjectDecisionStatementWithAnIntentionallyLongUnbrokenTokenForResponsiveContainment private and project-scoped.";
const INITIAL_PROJECT_DECISION_CONTEXT =
  "Keep ProjectDecisionContextWithAnIntentionallyLongUnbrokenTokenForResponsiveContainment private to this workspace.";
const CORRECTED_PROJECT_DECISION =
  "Keep the project decision log private and scoped to this project.";
const REPLACEMENT_PROJECT_DECISION =
  "Ship project-level decision history before widening its scope.";
const REPLACEMENT_PROJECT_DECISION_CONTEXT =
  "Objective and work-item decisions remain outside this release.";
const PROJECT_DECISION_WITHDRAWAL_REASON =
  "The team reopened the scope choice before release.";
const REVIEW_DECISION_ORIGINAL_ID = "review-decision-original";
const REVIEW_DECISION_CURRENT_ID = "review-decision-current";
const REVIEW_DECISION_SECOND_ID = "review-decision-second";
const REVIEW_DECISION_WITHDRAWN_ID = "review-decision-withdrawn";
const REVIEW_DECISION_WITHDRAWAL_ID = "review-decision-withdrawal";
const REVIEW_DECISION_LONG_STATEMENT =
  "Keep CurrentProjectDecisionWithAnIntentionallyLongUnbrokenTokenForContainment exact-project scoped.";
const REVIEW_DECISION_PLAIN_CONTEXT =
  "Treat <source-project> as plain text and never as markup.";
const REVIEW_DECISION_SECOND_STATEMENT =
  "Review every current project decision before accepting this result.";
const CURRENT_CONTEXT_OBJECTIVE_ID = "acceptance-current-objective";
const CURRENT_CONTEXT_WORK_ITEM_ID = "acceptance-current-work-item";
const CURRENT_CONTEXT_ATTEMPT_ID = "acceptance-current-attempt";
const CURRENT_CONTEXT_OBJECTIVE_TITLE =
  "Ship the current destination plan context";
const CURRENT_CONTEXT_OBJECTIVE_OUTCOME =
  "The live task receives only the current destination plan.";
const CURRENT_CONTEXT_WORK_ITEM_TITLE =
  "Continue the acceptance slice in its current project";
const CURRENT_CONTEXT_WORK_ITEM_OUTCOME =
  "The current destination context is reviewed before anything is sent.";
const CURRENT_CONTEXT_DECISION_ORIGINAL_ID =
  "current-context-decision-original";
const CURRENT_CONTEXT_DECISION_CURRENT_ID = "current-context-decision-current";
const CURRENT_CONTEXT_DECISION_SECOND_ID = "current-context-decision-second";
const CURRENT_CONTEXT_DECISION_WITHDRAWN_ID =
  "current-context-decision-withdrawn";
const CURRENT_CONTEXT_DECISION_WITHDRAWAL_ID =
  "current-context-decision-withdrawal";
const CURRENT_CONTEXT_DECISION_STATEMENT =
  "Use CurrentDestinationDecisionWithAnIntentionallyLongUnbrokenTokenForContainment for the live continuation.";
const CURRENT_CONTEXT_DECISION_RECORDED_CONTEXT =
  "Treat <current-destination> as plain text in the copied instruction.";
const CURRENT_CONTEXT_DECISION_SECOND_STATEMENT =
  "Keep the current destination expected outcome in every follow-up.";
const HISTORICAL_CONTEXT_PRIVATE_PATH =
  "C:\\private-source\\historical-only\\never-copy-this-path";
const HISTORICAL_CONTEXT_WITHDRAWN_STATEMENT =
  "Historical withdrawn context must never enter the current follow-up.";
const CURRENT_CONTEXT_WITHDRAWN_STATEMENT =
  "Withdrawn current-project history must not be copied.";
const CURRENT_PLAN_CONTEXT_DRAFT = [
  "Coffice plan context copied for review",
  "",
  `Objective: ${CURRENT_CONTEXT_OBJECTIVE_TITLE}`,
  `Objective definition of success: ${CURRENT_CONTEXT_OBJECTIVE_OUTCOME}`,
  `Work item: ${CURRENT_CONTEXT_WORK_ITEM_TITLE}`,
  `Expected outcome: ${CURRENT_CONTEXT_WORK_ITEM_OUTCOME}`,
  "",
  "Current user-recorded project decisions:",
  `- ${CURRENT_CONTEXT_DECISION_SECOND_STATEMENT}`,
  `- ${CURRENT_CONTEXT_DECISION_STATEMENT}`,
  `  Recorded context: ${CURRENT_CONTEXT_DECISION_RECORDED_CONTEXT}`,
].join("\n");
const FAILED_CHECK_REPAIR_OLDER_RESULT_ID =
  "acceptance-repair-private-older-result";
const FAILED_CHECK_REPAIR_OLDER_RECEIPT_ID =
  "acceptance-repair-private-older-exact-receipt";
const FAILED_CHECK_REPAIR_LATEST_RECEIPT_ID =
  "acceptance-repair-private-latest-exact-receipt";
const FAILED_CHECK_REPAIR_OTHER_RECEIPT_ID =
  "acceptance-repair-private-other-result-receipt";
const FAILED_CHECK_REPAIR_PRIVATE_PATH =
  "C:\\private-checks\\raw-lint-output.log";
const FAILED_CHECK_REPAIR_PRIVATE_COMMAND =
  "npm run private-lint -- --synthetic-secret-flag";
const FAILED_CHECK_REPAIR_PRIVATE_OUTPUT =
  "Private linter output must never enter the repair follow-up.";
const FAILED_CHECK_REPAIR_PRIVATE_REFERENCE =
  "acceptance-repair-private-evidence-reference";
const FAILED_CHECK_REPAIR_ASSESSMENT_SUMMARY =
  "Private repair assessment summary must not be copied.";
const FAILED_CHECK_REPAIR_ASSESSMENT_RISK =
  "Private repair assessment risk must not be copied.";
const FAILED_CHECK_REPAIR_ASSESSMENT_NEXT_ACTION =
  "Private repair next action must not be copied.";
const SAVED_COMPARISON_RETRY_ATTEMPT_ID =
  "saved-comparison-private-retry-attempt";
const SAVED_COMPARISON_HANDOFF_ATTEMPT_ID =
  "saved-comparison-private-handoff-attempt";
const SAVED_COMPARISON_CONTINUATION_ATTEMPT_ID =
  "saved-comparison-private-continuation-attempt";
const SAVED_COMPARISON_ALPHA_ATTEMPT_ID =
  "saved-comparison-private-alpha-attempt";
const SAVED_COMPARISON_ALPHA_OLDER_RESULT_ID =
  "saved-comparison-private-alpha-older-result";
const SAVED_COMPARISON_ALPHA_RESULT_ID =
  "saved-comparison-private-alpha-latest-result";
const SAVED_COMPARISON_BETA_ATTEMPT_ID =
  "saved-comparison-private-beta-attempt";
const SAVED_COMPARISON_BETA_RESULT_ID = "saved-comparison-private-beta-result";
const SAVED_COMPARISON_PRIVATE_RESULT_CONTENT =
  "SavedComparisonPrivateResultContentMustNeverEnterTheComparison";
const SAVED_COMPARISON_PRIVATE_TASK_MESSAGE =
  "SavedComparisonPrivateTaskMessageMustNeverEnterTheComparison";
const SAVED_COMPARISON_PRIVATE_ASSESSMENT_SUMMARY =
  "SavedComparisonPrivateAssessmentSummaryMustNeverEnterTheComparison";
const SAVED_COMPARISON_PRIVATE_ASSESSMENT_NOTE =
  "SavedComparisonPrivateAssessmentNoteMustNeverEnterTheComparison";
const SAVED_COMPARISON_PRIVATE_WORK_ASSESSMENT =
  "SavedComparisonPrivateWorkItemAssessmentMustNotQualifyThePair";
const SAVED_COMPARISON_PRIVATE_PATH =
  "C:\\private-comparison\\never-render-this-path.log";
const SAVED_COMPARISON_PRIVATE_COMMAND =
  "npm run private-comparison -- --never-render-this-command";
const SAVED_COMPARISON_PRIVATE_OUTPUT =
  "SavedComparisonPrivateCommandOutputMustNeverEnterTheComparison";
const SAVED_COMPARISON_PRIVATE_GIT =
  "saved-comparison-private-root-wide-git-evidence";
const SAVED_COMPARISON_LONG_TOKEN =
  "SavedComparisonLongUnbrokenPrivateTokenMustStayOutOfTheComparisonSurfaceAndReport";
const SAVED_COMPARISON_PRIVATE_CANARIES = Object.freeze([
  PRIMARY_PROJECT_ID,
  REVIEW_OBJECTIVE_ID,
  REVIEW_WORK_ITEM_ID,
  REVIEW_ATTEMPT_ID,
  REVIEW_TASK_ID,
  SAVED_COMPARISON_RETRY_ATTEMPT_ID,
  SAVED_COMPARISON_HANDOFF_ATTEMPT_ID,
  SAVED_COMPARISON_CONTINUATION_ATTEMPT_ID,
  SAVED_COMPARISON_ALPHA_ATTEMPT_ID,
  SAVED_COMPARISON_ALPHA_OLDER_RESULT_ID,
  SAVED_COMPARISON_ALPHA_RESULT_ID,
  SAVED_COMPARISON_BETA_ATTEMPT_ID,
  SAVED_COMPARISON_BETA_RESULT_ID,
  SAVED_COMPARISON_PRIVATE_RESULT_CONTENT,
  SAVED_COMPARISON_PRIVATE_TASK_MESSAGE,
  SAVED_COMPARISON_PRIVATE_ASSESSMENT_SUMMARY,
  SAVED_COMPARISON_PRIVATE_ASSESSMENT_NOTE,
  SAVED_COMPARISON_PRIVATE_WORK_ASSESSMENT,
  SAVED_COMPARISON_PRIVATE_PATH,
  SAVED_COMPARISON_PRIVATE_COMMAND,
  SAVED_COMPARISON_PRIVATE_OUTPUT,
  SAVED_COMPARISON_PRIVATE_GIT,
  SAVED_COMPARISON_LONG_TOKEN,
  PROJECT_RULE_CURRENT_A_CANARY,
  PROJECT_RULE_CURRENT_B_CANARY,
  DEFINITION_OF_DONE_PRIVATE_CANARY,
  CURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
  REVIEW_DECISION_LONG_STATEMENT,
  REVIEW_DECISION_PLAIN_CONTEXT,
  REVIEW_DECISION_SECOND_STATEMENT,
  REVIEW_DECISION_ORIGINAL_ID,
  REVIEW_DECISION_CURRENT_ID,
  REVIEW_DECISION_SECOND_ID,
  REVIEW_DECISION_WITHDRAWN_ID,
  REVIEW_DECISION_WITHDRAWAL_ID,
]);
const FAILED_CHECK_REPAIR_DRAFT = [
  "Coffice repair follow-up copied for review",
  "",
  "Objective: Ship the review-note workflow",
  "Objective definition of success: A reviewer can record judgment and choose the next step safely.",
  `Work item: ${REVIEW_MILESTONE_TITLE}`,
  "Expected outcome: The completed slice is assessed before it is accepted.",
  "",
  "Current user-recorded project decisions:",
  `- ${REVIEW_DECISION_SECOND_STATEMENT}`,
  `- ${REVIEW_DECISION_LONG_STATEMENT}`,
  `  Recorded context: ${REVIEW_DECISION_PLAIN_CONTEXT}`,
  "",
  "Failed quality check: Lint",
  "Observed outcome: Failed · exit 23",
  "",
  "Please diagnose and repair the cause of this failed quality check. Rerun the same Lint check after the repair, then report the outcome and any remaining risks.",
].join("\n");
const MULTI_ROOT_PRIMARY_BRANCH = "feature/multi-root-primary";
const MULTI_ROOT_ADDITIONAL_BRANCH =
  "acceptance/additional-root-with-an-intentionally-long-unbroken-branch-for-containment";
const MULTI_ROOT_SINGLE_BRANCH = "single-root-main";
const MULTI_ROOT_LEGACY_ALIAS_BRANCH = "legacy-alias-must-not-render";
const MULTI_ROOT_PRIVATE_CANARIES = Object.freeze([
  "C:\\private-roots\\acceptance-primary-private-root",
  "acceptance-primary-private-basename",
  "acceptance-private-root-identifier-primary",
  "/private/additional/acceptance-additional-private-root",
  "acceptance-additional-private-basename",
  "acceptance-private-root-identifier-additional",
  "/private/unavailable/acceptance-unavailable-private-root",
  "acceptance-unavailable-private-basename",
  "acceptance-private-root-identifier-unavailable",
  MULTI_ROOT_LEGACY_ALIAS_BRANCH,
]);
const INITIAL_MILESTONE_ORDER = Object.freeze([
  REVIEW_WORK_ITEM_ID,
  RELEASE_MILESTONE_ID,
  VERIFICATION_MILESTONE_ID,
]);
const REORDERED_MILESTONE_ORDER = Object.freeze([
  REVIEW_WORK_ITEM_ID,
  VERIFICATION_MILESTONE_ID,
  RELEASE_MILESTONE_ID,
]);
const LONG_DIGEST_TASK_TITLE =
  "AcceptanceAgentWithAnIntentionallyLongUnbrokenTitleForResponsiveDigestVerification";
const REVIEW_TASK_TITLE = "Acceptance Agent 04";
const PRIMARY_WORKFLOW_ASSIGNMENTS = Object.freeze({
  "Acceptance Agent 01": "desk",
  [LONG_DIGEST_TASK_TITLE]: "meeting",
  "Acceptance Agent 03": "desk",
  [REVIEW_TASK_TITLE]: "review",
  "Acceptance Agent 05": "desk",
  "Acceptance Agent 06": "desk",
  "Acceptance Agent 07": "desk",
  "Acceptance Agent 08": "desk",
});
const VIEWPORT_DEFINITIONS = Object.freeze([
  { id: "desktop", width: 1280, height: 720 },
  { id: "ultrawide", width: 2560, height: 1080 },
  { id: "portrait", width: 390, height: 844 },
  { id: "compact", width: 320, height: 640 },
  { id: "short-landscape", width: 844, height: 390 },
]);
const requestedViewportIds = new Set(
  (process.env.COFFICE_ACCEPTANCE_VIEWPORTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const unknownViewportIds = [...requestedViewportIds].filter(
  (id) => !VIEWPORT_DEFINITIONS.some((viewport) => viewport.id === id),
);
if (unknownViewportIds.length) {
  throw new Error(
    `Unknown acceptance viewport: ${unknownViewportIds.join(", ")}`,
  );
}
const VIEWPORTS = Object.freeze(
  requestedViewportIds.size
    ? VIEWPORT_DEFINITIONS.filter((viewport) =>
        requestedViewportIds.has(viewport.id),
      )
    : [...VIEWPORT_DEFINITIONS],
);

function milestoneOrderGroupLabel(position, title) {
  return `Change order for milestone ${position}, ${title}`;
}

function milestoneMoveLabel(position, title, direction) {
  return `Move milestone ${position}, ${title}, ${direction}`;
}

function assertLocalAcceptanceUrl(value) {
  const url = new URL(value);
  if (url.hostname !== "127.0.0.1" || url.port !== "3003") {
    throw new Error(
      `Browser acceptance must run on http://127.0.0.1:3003 (received ${url.origin})`,
    );
  }
  return url.toString();
}

function status(value, timestamp, provenance = "observed") {
  return {
    value,
    provenance,
    source: `acceptance:${value}`,
    timestamp,
    stale: false,
    confidence: 1,
  };
}

function syntheticFixture(pollIntervalMs = 60_000, observedAtOverride = null) {
  const observedAt = observedAtOverride ?? new Date().toISOString();
  const primaryStatuses = [
    "coding",
    "waiting_for_user",
    "blocked",
    "completed",
    "failed",
    "reviewing",
    "idle",
    "planning",
  ];
  const primaryTasks = primaryStatuses.map((value, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    title:
      index === 1
        ? LONG_DIGEST_TASK_TITLE
        : `Acceptance Agent ${String(index + 1).padStart(2, "0")}`,
    projectId: PRIMARY_PROJECT_ID,
    assignmentEvidence: "explicit_project",
    kind: "temporary_worker",
    model: "acceptance-model",
    updatedAt: observedAt,
    status: status(value, observedAt),
  }));
  const secondaryTasks = Array.from({ length: 2 }, (_, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    title: `Secondary Agent ${String(index + 1).padStart(2, "0")}`,
    projectId: SECONDARY_PROJECT_ID,
    assignmentEvidence: "explicit_project",
    kind: "temporary_worker",
    model: "acceptance-model",
    updatedAt: observedAt,
    status: status(index === 0 ? "running" : "completed", observedAt),
  }));
  const holdingTask = {
    id: "30000000-0000-4000-8000-000000000001",
    title: "Holding Agent 01",
    assignmentEvidence: "explicit_unassigned",
    kind: "temporary_worker",
    model: "acceptance-model",
    updatedAt: observedAt,
    status: status("coding", observedAt),
  };
  const projects = [
    {
      id: PRIMARY_PROJECT_ID,
      name: "Acceptance Office",
      order: 0,
      taskCount: primaryTasks.length,
      activeTaskCount: 3,
      status: primaryTasks[0].status,
    },
    {
      id: SECONDARY_PROJECT_ID,
      name: "Secondary Office",
      order: 1,
      taskCount: secondaryTasks.length,
      activeTaskCount: 1,
      status: secondaryTasks[0].status,
    },
  ];
  return {
    schemaVersion: "1.0",
    generatedAt: observedAt,
    source: {
      kind: "codex-local",
      health: "connected",
      lastReadAt: observedAt,
      pollIntervalMs,
      freshness: "fresh",
      refreshState: "fresh",
      cacheAgeMs: 0,
      lastRefreshSuccessAt: observedAt,
    },
    projects,
    tasks: [...primaryTasks, ...secondaryTasks, holdingTask],
    diagnostics: [],
  };
}

function availableRepositoryEvidence({
  branch,
  headOid,
  changedFiles,
  stagedFiles,
  untrackedFiles,
  ahead,
  behind,
  changeAreas,
  diffStats,
  observedAt,
  privateCanary,
}) {
  return {
    availability: "available",
    branch,
    headOid,
    headState: "commit",
    changedFiles,
    stagedFiles,
    untrackedFiles,
    conflictedFiles: 0,
    ahead,
    behind,
    clean: changedFiles === 0,
    source: "git:status-porcelain-v2",
    observedAt,
    changeAreas,
    ...(diffStats ? { diffStats } : {}),
    rootPath: privateCanary,
  };
}

function multiRootRepositoryFixture(snapshot, scenario) {
  const scenarioOffset =
    scenario === "cold"
      ? 0
      : scenario === "settled"
        ? 30_000
        : scenario === "bounded"
          ? 60_000
          : 90_000;
  const observedAt = new Date(
    Date.parse(snapshot.generatedAt) + scenarioOffset,
  ).toISOString();
  const primary = availableRepositoryEvidence({
    branch: MULTI_ROOT_PRIMARY_BRANCH,
    headOid: "1".repeat(40),
    changedFiles: 5,
    stagedFiles: 2,
    untrackedFiles: 1,
    ahead: 1,
    behind: 0,
    changeAreas: {
      totalFiles: 5,
      summarizedFiles: 5,
      omittedFiles: 0,
      areas: [
        { area: "Source", files: 3 },
        { area: "Tests", files: 2 },
      ],
    },
    diffStats: {
      trackedFiles: 4,
      additions: 17,
      deletions: 5,
      binaryFiles: 0,
      source: "git:diff-numstat",
    },
    observedAt,
    privateCanary: MULTI_ROOT_PRIVATE_CANARIES[0],
  });
  const additional = availableRepositoryEvidence({
    branch: MULTI_ROOT_ADDITIONAL_BRANCH,
    headOid: "2".repeat(40),
    changedFiles: 0,
    stagedFiles: 0,
    untrackedFiles: 0,
    ahead: 0,
    behind: 2,
    changeAreas: {
      totalFiles: 0,
      summarizedFiles: 0,
      omittedFiles: 0,
      areas: [],
    },
    diffStats: {
      trackedFiles: 0,
      additions: 0,
      deletions: 0,
      binaryFiles: 0,
      source: "git:diff-numstat",
    },
    observedAt,
    privateCanary: MULTI_ROOT_PRIVATE_CANARIES[3],
  });
  const legacyAlias = availableRepositoryEvidence({
    branch: MULTI_ROOT_LEGACY_ALIAS_BRANCH,
    headOid: "9".repeat(40),
    changedFiles: 9,
    stagedFiles: 9,
    untrackedFiles: 0,
    ahead: 9,
    behind: 9,
    changeAreas: {
      totalFiles: 9,
      summarizedFiles: 9,
      omittedFiles: 0,
      areas: [{ area: "Other", files: 9 }],
    },
    diffStats: {
      trackedFiles: 9,
      additions: 99,
      deletions: 99,
      binaryFiles: 0,
      source: "git:diff-numstat",
    },
    observedAt,
    privateCanary: MULTI_ROOT_PRIVATE_CANARIES[0],
  });
  const singleRoot = availableRepositoryEvidence({
    branch: MULTI_ROOT_SINGLE_BRANCH,
    headOid: "3".repeat(40),
    changedFiles: 1,
    stagedFiles: 0,
    untrackedFiles: 1,
    ahead: 0,
    behind: 0,
    changeAreas: {
      totalFiles: 1,
      summarizedFiles: 1,
      omittedFiles: 0,
      areas: [{ area: "Source", files: 1 }],
    },
    diffStats: {
      trackedFiles: 0,
      additions: 0,
      deletions: 0,
      binaryFiles: 0,
      source: "git:diff-numstat",
    },
    observedAt,
    privateCanary: MULTI_ROOT_PRIVATE_CANARIES[0],
  });
  return {
    ...structuredClone(snapshot),
    generatedAt: observedAt,
    source: {
      ...snapshot.source,
      lastReadAt: observedAt,
      lastRefreshSuccessAt: observedAt,
      refreshState: scenario === "cold" ? "refreshing" : "fresh",
      freshness: "fresh",
      cacheAgeMs: 0,
    },
    projects: snapshot.projects.map((project) => {
      const {
        repository: ignoredRepository,
        repositoryRoots,
        ...base
      } = project;
      void ignoredRepository;
      void repositoryRoots;
      if (
        scenario === "bounded" &&
        (project.id === PRIMARY_PROJECT_ID ||
          project.id === SECONDARY_PROJECT_ID)
      ) {
        return {
          ...base,
          repositoryRootCount: project.id === PRIMARY_PROJECT_ID ? 40 : 25,
          repositoryCollectionState: "bounded_out",
          privateRootPath:
            project.id === PRIMARY_PROJECT_ID
              ? MULTI_ROOT_PRIVATE_CANARIES[6]
              : MULTI_ROOT_PRIVATE_CANARIES[3],
          basename:
            project.id === PRIMARY_PROJECT_ID
              ? MULTI_ROOT_PRIVATE_CANARIES[7]
              : MULTI_ROOT_PRIVATE_CANARIES[4],
          rootId:
            project.id === PRIMARY_PROJECT_ID
              ? MULTI_ROOT_PRIVATE_CANARIES[8]
              : MULTI_ROOT_PRIVATE_CANARIES[5],
        };
      }
      if (project.id !== PRIMARY_PROJECT_ID) return structuredClone(project);
      if (scenario === "single") {
        return { ...base, repository: singleRoot };
      }
      const rootMetadata = [
        {
          path: MULTI_ROOT_PRIVATE_CANARIES[0],
          basename: MULTI_ROOT_PRIVATE_CANARIES[1],
          rootId: MULTI_ROOT_PRIVATE_CANARIES[2],
        },
        {
          path: MULTI_ROOT_PRIVATE_CANARIES[3],
          basename: MULTI_ROOT_PRIVATE_CANARIES[4],
          rootId: MULTI_ROOT_PRIVATE_CANARIES[5],
        },
        {
          path: MULTI_ROOT_PRIVATE_CANARIES[6],
          basename: MULTI_ROOT_PRIVATE_CANARIES[7],
          rootId: MULTI_ROOT_PRIVATE_CANARIES[8],
        },
      ];
      return {
        ...base,
        repositoryRootCount: 3,
        repository: legacyAlias,
        repositoryRoots: rootMetadata.map((metadata, index) => ({
          role: index === 0 ? "primary" : "additional",
          ...(scenario === "settled" && index === 0
            ? { evidence: primary }
            : scenario === "settled" && index === 1
              ? { evidence: additional }
              : scenario === "settled" && index === 2
                ? {
                    evidence: {
                      availability: "unavailable",
                      source: "git",
                      observedAt,
                      rootPath: MULTI_ROOT_PRIVATE_CANARIES[6],
                    },
                  }
                : {}),
          ...metadata,
        })),
      };
    }),
  };
}

function syntheticWorkspaceFixture(snapshot) {
  const observedAt = snapshot.generatedAt;
  const reviewTask = snapshot.tasks.find((task) => task.id === REVIEW_TASK_ID);
  if (!reviewTask) throw new Error("Review fixture task is missing.");
  const resultKey = {
    kind: "revision",
    id: `${REVIEW_TASK_ID}:completed:${observedAt}`,
  };
  const exactTarget = {
    projectId: PRIMARY_PROJECT_ID,
    objectiveId: REVIEW_OBJECTIVE_ID,
    workItemId: REVIEW_WORK_ITEM_ID,
    attemptId: REVIEW_ATTEMPT_ID,
    resultKey,
  };
  return {
    schemaVersion: 12,
    revision: 1,
    createdAt: observedAt,
    updatedAt: observedAt,
    projects: [
      {
        id: PRIMARY_PROJECT_ID,
        title: "Acceptance Office",
        contextReview: {
          concerns: ["stale"],
          note: PROJECT_CONTEXT_REVIEW_INITIAL_CANARY,
          markedAt: observedAt,
          authorship: "user",
        },
        reviewSchedule: {
          nextReviewAt: new Date(
            Date.parse(observedAt) + 7 * 24 * 60 * 60 * 1_000,
          ).toISOString(),
          repeatEveryDays: 7,
          configuredAt: observedAt,
          authorship: "user",
        },
        createdAt: observedAt,
        updatedAt: observedAt,
        objectives: [
          {
            id: REVIEW_OBJECTIVE_ID,
            title: "Ship the review-note workflow",
            expectedOutcome:
              "A reviewer can record judgment and choose the next step safely.",
            status: "active",
            createdAt: observedAt,
            updatedAt: observedAt,
            workItems: [
              {
                id: REVIEW_WORK_ITEM_ID,
                title: REVIEW_MILESTONE_TITLE,
                expectedOutcome:
                  "The completed slice is assessed before it is accepted.",
                definitionOfDone: [
                  "Review the exact completed result.",
                  DEFINITION_OF_DONE_PRIVATE_CANARY,
                  DEFINITION_OF_DONE_LONG_ENTRY,
                ],
                relationships: [
                  {
                    kind: "depends_on",
                    targetObjectiveId: REVIEW_OBJECTIVE_ID,
                    targetWorkItemId: RELEASE_MILESTONE_ID,
                  },
                ],
                status: "ready_for_review",
                createdAt: observedAt,
                updatedAt: observedAt,
                attempts: [
                  {
                    id: REVIEW_ATTEMPT_ID,
                    codexTaskId: REVIEW_TASK_ID,
                    relationship: "primary",
                    linkedAt: observedAt,
                    resultCycles: [{ key: resultKey, observedAt }],
                  },
                ],
              },
              {
                id: RELEASE_MILESTONE_ID,
                title: RELEASE_MILESTONE_TITLE,
                expectedOutcome:
                  "The reviewed slice is published after its release checks pass.",
                status: "planned",
                createdAt: observedAt,
                updatedAt: observedAt,
                attempts: [],
              },
              {
                id: VERIFICATION_MILESTONE_ID,
                title: VERIFICATION_MILESTONE_TITLE,
                expectedOutcome:
                  "The release candidate passes its final quality checks.",
                status: "planned",
                createdAt: observedAt,
                updatedAt: observedAt,
                attempts: [],
              },
            ],
          },
        ],
      },
    ],
    attentionReview: {
      version: 2,
      initializedAt: new Date(Date.parse(observedAt) - 60_000).toISOString(),
      dispositions: {},
      snoozedUntil: {},
    },
    reviewAssessments: [
      {
        target: exactTarget,
        authorship: "user",
        reviewSummary:
          "The result is promising, but its compact-layout behavior needs review.",
        risks: ["Compact-layout compatibility is not yet confirmed."],
        uncertainties: [],
        blockedDecisions: [],
        nextAction: {
          kind: "send_follow_up",
          note: "Confirm compact-layout behavior before accepting.",
        },
        updatedAt: observedAt,
      },
    ],
    decisionRequests: [],
    projectDecisionEvents: [
      {
        id: REVIEW_DECISION_ORIGINAL_ID,
        projectId: PRIMARY_PROJECT_ID,
        action: "recorded",
        statement: "Use the superseded review wording.",
        recordedAt: new Date(Date.parse(observedAt) - 300_000).toISOString(),
        authorship: "user",
      },
      {
        id: REVIEW_DECISION_CURRENT_ID,
        projectId: PRIMARY_PROJECT_ID,
        action: "superseded",
        supersedesId: REVIEW_DECISION_ORIGINAL_ID,
        supersessionKind: "correction",
        statement: REVIEW_DECISION_LONG_STATEMENT,
        context: REVIEW_DECISION_PLAIN_CONTEXT,
        recordedAt: new Date(Date.parse(observedAt) - 240_000).toISOString(),
        authorship: "user",
      },
      {
        id: REVIEW_DECISION_SECOND_ID,
        projectId: PRIMARY_PROJECT_ID,
        action: "recorded",
        statement: REVIEW_DECISION_SECOND_STATEMENT,
        recordedAt: new Date(Date.parse(observedAt) - 180_000).toISOString(),
        authorship: "user",
      },
      {
        id: REVIEW_DECISION_WITHDRAWN_ID,
        projectId: PRIMARY_PROJECT_ID,
        action: "recorded",
        statement: "This withdrawn decision must stay out of Review & Act.",
        recordedAt: new Date(Date.parse(observedAt) - 120_000).toISOString(),
        authorship: "user",
      },
      {
        id: REVIEW_DECISION_WITHDRAWAL_ID,
        projectId: PRIMARY_PROJECT_ID,
        action: "withdrawn",
        supersedesId: REVIEW_DECISION_WITHDRAWN_ID,
        reason: "No longer current.",
        recordedAt: new Date(Date.parse(observedAt) - 60_000).toISOString(),
        authorship: "user",
      },
    ],
    evidence: [],
    migrations: { attentionReviewV2ImportedAt: observedAt },
    mutationReceipts: [],
    verificationReceipts: [],
  };
}

function setSyntheticDefinitionOfDone(workspace, mutation, updatedAt) {
  if (
    !hasExactObjectKeys(mutation, [
      "type",
      "projectId",
      "objectiveId",
      "workItemId",
      "definitionOfDone",
    ]) ||
    !Array.isArray(mutation.definitionOfDone) ||
    mutation.definitionOfDone.length > 64
  ) {
    return null;
  }
  const normalized = mutation.definitionOfDone.map((entry) =>
    typeof entry === "string" ? entry.replace(/\r\n?/gu, "\n").trim() : "",
  );
  if (
    normalized.some((entry) => !entry || entry.length > 1_000) ||
    normalized.reduce((total, entry) => total + entry.length, 0) > 16_000
  ) {
    return null;
  }
  let matched = false;
  const projects = workspace.projects.map((project) =>
    project.id !== mutation.projectId
      ? project
      : {
          ...project,
          updatedAt,
          objectives: project.objectives.map((objective) =>
            objective.id !== mutation.objectiveId
              ? objective
              : {
                  ...objective,
                  updatedAt,
                  workItems: objective.workItems.map((workItem) => {
                    if (workItem.id !== mutation.workItemId) return workItem;
                    matched = true;
                    const updated = { ...workItem, updatedAt };
                    if (normalized.length)
                      updated.definitionOfDone = normalized;
                    else delete updated.definitionOfDone;
                    return updated;
                  }),
                },
          ),
        },
  );
  return matched
    ? {
        ...workspace,
        revision: workspace.revision + 1,
        updatedAt,
        projects,
      }
    : null;
}

function mutateSyntheticDecisionRequest(workspace, mutation, updatedAt) {
  const findRequest = (id) =>
    workspace.decisionRequests.find((request) => request.id === id);
  let decisionRequests = workspace.decisionRequests;
  if (mutation.type === "decisionRequest.create") {
    const request = mutation.request;
    if (
      !request ||
      !hasExactObjectKeys(request, ["id", "target", "prompt"]) ||
      typeof request.id !== "string" ||
      !request.id.startsWith("decision-") ||
      typeof request.prompt !== "string" ||
      !request.prompt.trim() ||
      findRequest(request.id)
    ) {
      return null;
    }
    decisionRequests = [
      ...decisionRequests,
      {
        ...structuredClone(request),
        prompt: request.prompt.trim(),
        authorship: "user",
        createdAt: updatedAt,
        updatedAt,
      },
    ];
  } else if (mutation.type === "decisionRequest.update") {
    const request = findRequest(mutation.id);
    if (
      !request ||
      request.resolvedAt ||
      !hasExactObjectKeys(mutation, ["type", "id", "prompt"]) ||
      typeof mutation.prompt !== "string" ||
      !mutation.prompt.trim()
    ) {
      return null;
    }
    decisionRequests = decisionRequests.map((candidate) =>
      candidate.id === mutation.id
        ? { ...candidate, prompt: mutation.prompt.trim(), updatedAt }
        : candidate,
    );
  } else if (mutation.type === "decisionRequest.resolve") {
    const request = findRequest(mutation.id);
    if (
      !request ||
      request.resolvedAt ||
      !hasExactObjectKeys(mutation, ["type", "id"], ["resolution"])
    ) {
      return null;
    }
    decisionRequests = decisionRequests.map((candidate) =>
      candidate.id === mutation.id
        ? {
            ...candidate,
            ...(mutation.resolution?.trim()
              ? { resolution: mutation.resolution.trim() }
              : {}),
            resolvedAt: updatedAt,
            updatedAt,
          }
        : candidate,
    );
  } else if (mutation.type === "decisionRequest.reopen") {
    const request = findRequest(mutation.id);
    if (!request?.resolvedAt || !hasExactObjectKeys(mutation, ["type", "id"])) {
      return null;
    }
    decisionRequests = decisionRequests.map((candidate) => {
      if (candidate.id !== mutation.id) return candidate;
      const reopened = { ...candidate, updatedAt };
      delete reopened.resolvedAt;
      delete reopened.resolution;
      return reopened;
    });
  } else if (mutation.type === "decisionRequest.remove") {
    const request = findRequest(mutation.id);
    if (
      !request ||
      request.resolvedAt ||
      !hasExactObjectKeys(mutation, ["type", "id"])
    ) {
      return null;
    }
    decisionRequests = decisionRequests.filter(
      (candidate) => candidate.id !== mutation.id,
    );
  } else {
    return null;
  }
  return {
    ...workspace,
    revision: workspace.revision + 1,
    updatedAt,
    decisionRequests,
  };
}

function setSyntheticWorkItemRelationships(workspace, mutation, updatedAt) {
  if (
    !hasExactObjectKeys(mutation, [
      "type",
      "projectId",
      "objectiveId",
      "workItemId",
      "relationships",
    ]) ||
    !Array.isArray(mutation.relationships) ||
    mutation.relationships.length > 256
  ) {
    return null;
  }
  const project = workspace.projects.find(
    (candidate) => candidate.id === mutation.projectId,
  );
  const locations = new Set(
    (project?.objectives ?? []).flatMap((objective) =>
      objective.workItems.map((workItem) =>
        JSON.stringify([objective.id, workItem.id]),
      ),
    ),
  );
  if (
    mutation.relationships.some(
      (relationship) =>
        !hasExactObjectKeys(relationship, [
          "kind",
          "targetObjectiveId",
          "targetWorkItemId",
        ]) ||
        !["depends_on", "hands_off_to"].includes(relationship.kind) ||
        !locations.has(
          JSON.stringify([
            relationship.targetObjectiveId,
            relationship.targetWorkItemId,
          ]),
        ),
    )
  ) {
    return null;
  }
  let matched = false;
  const projects = workspace.projects.map((candidateProject) =>
    candidateProject.id !== mutation.projectId
      ? candidateProject
      : {
          ...candidateProject,
          updatedAt,
          objectives: candidateProject.objectives.map((objective) =>
            objective.id !== mutation.objectiveId
              ? objective
              : {
                  ...objective,
                  updatedAt,
                  workItems: objective.workItems.map((workItem) => {
                    if (workItem.id !== mutation.workItemId) return workItem;
                    matched = true;
                    const updated = { ...workItem, updatedAt };
                    if (mutation.relationships.length) {
                      updated.relationships = structuredClone(
                        mutation.relationships,
                      );
                    } else {
                      delete updated.relationships;
                    }
                    return updated;
                  }),
                },
          ),
        },
  );
  return matched
    ? {
        ...workspace,
        revision: workspace.revision + 1,
        updatedAt,
        projects,
      }
    : null;
}

function currentPlanContextFixture(snapshot, workspace) {
  const observedAt = snapshot.generatedAt;
  const currentTask = snapshot.tasks.find((task) => task.id === REVIEW_TASK_ID);
  if (!currentTask) {
    throw new Error("Current-plan-context fixture task is missing.");
  }
  const movedSnapshot = {
    ...snapshot,
    projects: snapshot.projects.map((project) =>
      project.id === PRIMARY_PROJECT_ID
        ? {
            ...project,
            taskCount: project.taskCount - 1,
          }
        : project.id === SECONDARY_PROJECT_ID
          ? {
              ...project,
              taskCount: project.taskCount + 1,
            }
          : project,
    ),
    tasks: snapshot.tasks.map((task) =>
      task.id === REVIEW_TASK_ID
        ? {
            ...task,
            projectId: SECONDARY_PROJECT_ID,
            assignmentEvidence: "explicit_project",
          }
        : task,
    ),
  };
  const historicalProject = workspace.projects.find(
    (project) => project.id === PRIMARY_PROJECT_ID,
  );
  if (!historicalProject) {
    throw new Error("Historical source project is missing.");
  }
  const sourceUnlinkedAt = new Date(
    Date.parse(observedAt) - 30_000,
  ).toISOString();
  const historicalProjects = workspace.projects.map((project) =>
    project.id !== PRIMARY_PROJECT_ID
      ? project
      : {
          ...project,
          rules: [PROJECT_RULE_CURRENT_A_CANARY],
          objectives: project.objectives.map((objective) => ({
            ...objective,
            workItems: objective.workItems.map((workItem) => ({
              ...workItem,
              attempts: workItem.attempts.map((attempt) =>
                attempt.id === REVIEW_ATTEMPT_ID
                  ? { ...attempt, unlinkedAt: sourceUnlinkedAt }
                  : attempt,
              ),
            })),
          })),
        },
  );
  const currentProject = {
    id: SECONDARY_PROJECT_ID,
    title: "Secondary Office",
    rules: [PROJECT_RULE_CURRENT_B_CANARY],
    createdAt: observedAt,
    updatedAt: observedAt,
    objectives: [
      {
        id: CURRENT_CONTEXT_OBJECTIVE_ID,
        title: CURRENT_CONTEXT_OBJECTIVE_TITLE,
        expectedOutcome: CURRENT_CONTEXT_OBJECTIVE_OUTCOME,
        status: "active",
        createdAt: observedAt,
        updatedAt: observedAt,
        workItems: [
          {
            id: CURRENT_CONTEXT_WORK_ITEM_ID,
            title: CURRENT_CONTEXT_WORK_ITEM_TITLE,
            expectedOutcome: CURRENT_CONTEXT_WORK_ITEM_OUTCOME,
            status: "in_progress",
            createdAt: observedAt,
            updatedAt: observedAt,
            definitionOfDone: [CURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY],
            attempts: [
              {
                id: CURRENT_CONTEXT_ATTEMPT_ID,
                codexTaskId: REVIEW_TASK_ID,
                relationship: "continuation",
                linkedAt: new Date(
                  Date.parse(observedAt) - 20_000,
                ).toISOString(),
                observeResultsAfterKey: {
                  kind: "revision",
                  id: `${REVIEW_TASK_ID}:completed:${observedAt}`,
                },
                resultCycles: [],
              },
            ],
          },
        ],
      },
    ],
  };
  const currentDecisionEvents = [
    {
      id: CURRENT_CONTEXT_DECISION_ORIGINAL_ID,
      projectId: SECONDARY_PROJECT_ID,
      action: "recorded",
      statement: "Use the superseded destination wording.",
      context: HISTORICAL_CONTEXT_PRIVATE_PATH,
      recordedAt: new Date(Date.parse(observedAt) - 50_000).toISOString(),
      authorship: "user",
    },
    {
      id: CURRENT_CONTEXT_DECISION_CURRENT_ID,
      projectId: SECONDARY_PROJECT_ID,
      action: "superseded",
      supersedesId: CURRENT_CONTEXT_DECISION_ORIGINAL_ID,
      supersessionKind: "correction",
      statement: CURRENT_CONTEXT_DECISION_STATEMENT,
      context: CURRENT_CONTEXT_DECISION_RECORDED_CONTEXT,
      recordedAt: new Date(Date.parse(observedAt) - 40_000).toISOString(),
      authorship: "user",
    },
    {
      id: CURRENT_CONTEXT_DECISION_SECOND_ID,
      projectId: SECONDARY_PROJECT_ID,
      action: "recorded",
      statement: CURRENT_CONTEXT_DECISION_SECOND_STATEMENT,
      recordedAt: new Date(Date.parse(observedAt) - 30_000).toISOString(),
      authorship: "user",
    },
    {
      id: CURRENT_CONTEXT_DECISION_WITHDRAWN_ID,
      projectId: SECONDARY_PROJECT_ID,
      action: "recorded",
      statement: CURRENT_CONTEXT_WITHDRAWN_STATEMENT,
      context: HISTORICAL_CONTEXT_PRIVATE_PATH,
      recordedAt: new Date(Date.parse(observedAt) - 20_000).toISOString(),
      authorship: "user",
    },
    {
      id: CURRENT_CONTEXT_DECISION_WITHDRAWAL_ID,
      projectId: SECONDARY_PROJECT_ID,
      action: "withdrawn",
      supersedesId: CURRENT_CONTEXT_DECISION_WITHDRAWN_ID,
      reason: "Current destination choice was withdrawn.",
      recordedAt: new Date(Date.parse(observedAt) - 10_000).toISOString(),
      authorship: "user",
    },
  ];
  const historicalPrivacyEvents = [
    {
      id: "historical-context-private-path",
      projectId: PRIMARY_PROJECT_ID,
      action: "recorded",
      statement: HISTORICAL_CONTEXT_WITHDRAWN_STATEMENT,
      context: HISTORICAL_CONTEXT_PRIVATE_PATH,
      recordedAt: new Date(Date.parse(observedAt) - 15_000).toISOString(),
      authorship: "user",
    },
    {
      id: "historical-context-private-path-withdrawal",
      projectId: PRIMARY_PROJECT_ID,
      action: "withdrawn",
      supersedesId: "historical-context-private-path",
      reason: "Historical private source context was withdrawn.",
      recordedAt: new Date(Date.parse(observedAt) - 5_000).toISOString(),
      authorship: "user",
    },
  ];
  return {
    snapshot: movedSnapshot,
    workspace: {
      ...workspace,
      projects: [...historicalProjects, currentProject],
      projectDecisionEvents: [
        ...workspace.projectDecisionEvents,
        ...historicalPrivacyEvents,
        ...currentDecisionEvents,
      ],
    },
  };
}

function failedCheckRepairFixture(snapshot, workspace) {
  const observedAt = snapshot.generatedAt;
  const currentResultKey = workspace.projects
    .find((project) => project.id === PRIMARY_PROJECT_ID)
    ?.objectives.find((objective) => objective.id === REVIEW_OBJECTIVE_ID)
    ?.workItems.find((workItem) => workItem.id === REVIEW_WORK_ITEM_ID)
    ?.attempts.find((attempt) => attempt.id === REVIEW_ATTEMPT_ID)
    ?.resultCycles.at(-1)?.key;
  if (!currentResultKey) {
    throw new Error("Failed-check repair fixture result is missing.");
  }
  const target = {
    projectId: PRIMARY_PROJECT_ID,
    objectiveId: REVIEW_OBJECTIVE_ID,
    workItemId: REVIEW_WORK_ITEM_ID,
    attemptId: REVIEW_ATTEMPT_ID,
    resultKey: { ...currentResultKey },
  };
  const olderResultKey = {
    kind: "revision",
    id: FAILED_CHECK_REPAIR_OLDER_RESULT_ID,
  };
  const timestamp = (offsetMs) =>
    new Date(Date.parse(observedAt) + offsetMs).toISOString();
  const failedReceipt = ({
    id,
    receiptTarget,
    profileId,
    profileVersion,
    completedAt,
    failureKind,
    exitCode,
    requestHash,
  }) => ({
    id,
    idempotencyKey: `${id}-private-request-key`,
    requestHash,
    target: receiptTarget,
    profile: { id: profileId, version: profileVersion },
    checks: [
      {
        id: profileId,
        version: profileVersion,
        state: "failed",
        queuedAt: completedAt,
        startedAt: completedAt,
        completedAt,
        failureKind,
        ...(exitCode === undefined ? {} : { exitCode }),
      },
    ],
    state: "failed",
    queuedAt: completedAt,
    startedAt: completedAt,
    completedAt,
  });
  const receipts = [
    failedReceipt({
      id: FAILED_CHECK_REPAIR_OLDER_RECEIPT_ID,
      receiptTarget: target,
      profileId: "test",
      profileVersion: "1",
      completedAt: timestamp(-180_000),
      failureKind: "timeout",
      requestHash: "b".repeat(64),
    }),
    failedReceipt({
      id: FAILED_CHECK_REPAIR_LATEST_RECEIPT_ID,
      receiptTarget: target,
      profileId: "lint",
      profileVersion: "3",
      completedAt: timestamp(-150_000),
      failureKind: "exit",
      exitCode: 23,
      requestHash: "c".repeat(64),
    }),
    failedReceipt({
      id: FAILED_CHECK_REPAIR_OTHER_RECEIPT_ID,
      receiptTarget: {
        ...target,
        resultKey: olderResultKey,
      },
      profileId: "build",
      profileVersion: "2",
      completedAt: timestamp(-120_000),
      failureKind: "launch",
      requestHash: "d".repeat(64),
    }),
  ];
  return {
    snapshot,
    workspace: {
      ...workspace,
      projects: workspace.projects.map((project) =>
        project.id !== PRIMARY_PROJECT_ID
          ? project
          : {
              ...project,
              rules: [PROJECT_RULE_REPAIR_SOURCE_CANARY],
              objectives: project.objectives.map((objective) =>
                objective.id !== REVIEW_OBJECTIVE_ID
                  ? objective
                  : {
                      ...objective,
                      workItems: objective.workItems.map((workItem) =>
                        workItem.id !== REVIEW_WORK_ITEM_ID
                          ? workItem
                          : {
                              ...workItem,
                              attempts: workItem.attempts.map((attempt) =>
                                attempt.id !== REVIEW_ATTEMPT_ID
                                  ? attempt
                                  : {
                                      ...attempt,
                                      resultCycles: [
                                        {
                                          key: olderResultKey,
                                          observedAt: timestamp(-240_000),
                                        },
                                        ...attempt.resultCycles,
                                      ],
                                    },
                              ),
                            },
                      ),
                    },
              ),
            },
      ),
      evidence: [
        ...workspace.evidence,
        {
          id: "acceptance-repair-private-evidence-id",
          kind: "verification",
          outcome: "failed",
          summary: `${FAILED_CHECK_REPAIR_PRIVATE_PATH} ${FAILED_CHECK_REPAIR_PRIVATE_COMMAND} ${FAILED_CHECK_REPAIR_PRIVATE_OUTPUT}`,
          recordedAt: timestamp(-110_000),
          projectId: PRIMARY_PROJECT_ID,
          provenance: {
            source: "coffice",
            reference: FAILED_CHECK_REPAIR_PRIVATE_REFERENCE,
          },
        },
      ],
      reviewAssessments: workspace.reviewAssessments.map((assessment) => ({
        ...assessment,
        reviewSummary: FAILED_CHECK_REPAIR_ASSESSMENT_SUMMARY,
        risks: [FAILED_CHECK_REPAIR_ASSESSMENT_RISK],
        nextAction: {
          kind: "send_follow_up",
          note: FAILED_CHECK_REPAIR_ASSESSMENT_NEXT_ACTION,
        },
      })),
      verificationReceipts: receipts,
    },
  };
}

function savedResultComparisonFixture(snapshot, workspace) {
  const observedAt = snapshot.generatedAt;
  const timestamp = (offsetMs) =>
    new Date(Date.parse(observedAt) + offsetMs).toISOString();
  const primaryProject = workspace.projects.find(
    (project) => project.id === PRIMARY_PROJECT_ID,
  );
  const reviewObjective = primaryProject?.objectives.find(
    (objective) => objective.id === REVIEW_OBJECTIVE_ID,
  );
  const reviewWorkItem = reviewObjective?.workItems.find(
    (workItem) => workItem.id === REVIEW_WORK_ITEM_ID,
  );
  const referenceAttempt = reviewWorkItem?.attempts.find(
    (attempt) => attempt.id === REVIEW_ATTEMPT_ID,
  );
  const originalReferenceResult = referenceAttempt?.resultCycles.at(-1);
  if (
    !primaryProject ||
    !reviewObjective ||
    !reviewWorkItem ||
    !referenceAttempt ||
    !originalReferenceResult
  ) {
    throw new Error("Saved-result comparison fixture source is missing.");
  }

  const referenceResultKey = { ...originalReferenceResult.key };
  const alphaOlderResultKey = {
    kind: "revision",
    id: SAVED_COMPARISON_ALPHA_OLDER_RESULT_ID,
  };
  const alphaResultKey = {
    kind: "revision",
    id: SAVED_COMPARISON_ALPHA_RESULT_ID,
  };
  const betaResultKey = {
    kind: "revision",
    id: SAVED_COMPARISON_BETA_RESULT_ID,
  };
  const resultTarget = (attemptId, resultKey) => ({
    projectId: PRIMARY_PROJECT_ID,
    objectiveId: REVIEW_OBJECTIVE_ID,
    workItemId: REVIEW_WORK_ITEM_ID,
    attemptId,
    resultKey,
  });
  const comparisonAttempts = [
    {
      ...referenceAttempt,
      resultCycles: [
        {
          key: referenceResultKey,
          observedAt: timestamp(-600_000),
        },
      ],
    },
    {
      id: SAVED_COMPARISON_RETRY_ATTEMPT_ID,
      codexTaskId: `${SAVED_COMPARISON_RETRY_ATTEMPT_ID}:task`,
      relationship: "retry",
      linkedAt: timestamp(-570_000),
      resultCycles: [
        {
          key: {
            kind: "revision",
            id: `${SAVED_COMPARISON_RETRY_ATTEMPT_ID}:result`,
          },
          observedAt: timestamp(-560_000),
          review: { reviewedAt: timestamp(-550_000) },
        },
      ],
    },
    {
      id: SAVED_COMPARISON_ALPHA_ATTEMPT_ID,
      codexTaskId: `${SAVED_COMPARISON_ALPHA_ATTEMPT_ID}:task`,
      relationship: "alternative",
      linkedAt: timestamp(-540_000),
      resultCycles: [
        {
          key: alphaOlderResultKey,
          observedAt: timestamp(900_000),
          review: { reviewedAt: timestamp(-530_000) },
        },
        {
          key: alphaResultKey,
          observedAt: timestamp(-520_000),
          review: {
            reviewedAt: timestamp(-510_000),
            decision: {
              kind: "accepted",
              decidedAt: timestamp(-500_000),
              note: SAVED_COMPARISON_PRIVATE_TASK_MESSAGE,
            },
          },
        },
      ],
    },
    {
      id: SAVED_COMPARISON_HANDOFF_ATTEMPT_ID,
      codexTaskId: `${SAVED_COMPARISON_HANDOFF_ATTEMPT_ID}:task`,
      relationship: "handoff",
      linkedAt: timestamp(-510_000),
      resultCycles: [
        {
          key: {
            kind: "revision",
            id: `${SAVED_COMPARISON_HANDOFF_ATTEMPT_ID}:result`,
          },
          observedAt: timestamp(-500_000),
          review: { reviewedAt: timestamp(-490_000) },
        },
      ],
    },
    {
      id: SAVED_COMPARISON_BETA_ATTEMPT_ID,
      codexTaskId: `${SAVED_COMPARISON_BETA_ATTEMPT_ID}:task`,
      relationship: "alternative",
      linkedAt: timestamp(-480_000),
      resultCycles: [
        {
          key: betaResultKey,
          observedAt: timestamp(-470_000),
        },
      ],
    },
    {
      id: SAVED_COMPARISON_CONTINUATION_ATTEMPT_ID,
      codexTaskId: `${SAVED_COMPARISON_CONTINUATION_ATTEMPT_ID}:task`,
      relationship: "continuation",
      linkedAt: timestamp(-460_000),
      resultCycles: [
        {
          key: {
            kind: "revision",
            id: `${SAVED_COMPARISON_CONTINUATION_ATTEMPT_ID}:result`,
          },
          observedAt: timestamp(-450_000),
          review: { reviewedAt: timestamp(-440_000) },
        },
      ],
    },
  ];
  if (
    new Set(comparisonAttempts.map((attempt) => attempt.codexTaskId)).size !==
    comparisonAttempts.length
  ) {
    throw new Error(
      "Saved-result comparison attempts must use distinct Codex task links.",
    );
  }
  const alphaTarget = resultTarget(
    SAVED_COMPARISON_ALPHA_ATTEMPT_ID,
    alphaResultKey,
  );
  const betaTarget = resultTarget(
    SAVED_COMPARISON_BETA_ATTEMPT_ID,
    betaResultKey,
  );
  const qualityReceipt = ({
    id,
    target,
    profileId,
    profileVersion,
    state,
    failureKind,
    offsetMs,
  }) => {
    const recordedAt = timestamp(offsetMs);
    return {
      id,
      idempotencyKey: `${id}:private-idempotency`,
      requestHash: "9".repeat(64),
      target,
      profile: { id: profileId, version: profileVersion },
      checks: [
        {
          id: profileId,
          version: profileVersion,
          state,
          queuedAt: recordedAt,
          startedAt: recordedAt,
          completedAt: recordedAt,
          ...(failureKind ? { failureKind, exitCode: 73 } : {}),
        },
      ],
      state,
      queuedAt: recordedAt,
      startedAt: recordedAt,
      completedAt: recordedAt,
    };
  };
  const comparisonWorkspace = {
    ...workspace,
    projects: workspace.projects.map((project) =>
      project.id !== PRIMARY_PROJECT_ID
        ? {
            ...project,
            rules: [PROJECT_RULE_CURRENT_B_CANARY],
          }
        : {
            ...project,
            rules: [PROJECT_RULE_CURRENT_A_CANARY],
            objectives: project.objectives.map((objective) =>
              objective.id !== REVIEW_OBJECTIVE_ID
                ? objective
                : {
                    ...objective,
                    workItems: objective.workItems.map((workItem) =>
                      workItem.id !== REVIEW_WORK_ITEM_ID
                        ? workItem
                        : {
                            ...workItem,
                            definitionOfDone: [
                              DEFINITION_OF_DONE_PRIVATE_CANARY,
                              CURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
                            ],
                            attempts: comparisonAttempts,
                          },
                    ),
                  },
            ),
          },
    ),
    reviewAssessments: [
      {
        target: betaTarget,
        authorship: "user",
        reviewSummary: SAVED_COMPARISON_PRIVATE_ASSESSMENT_SUMMARY,
        risks: [SAVED_COMPARISON_PRIVATE_PATH],
        uncertainties: [],
        blockedDecisions: [SAVED_COMPARISON_PRIVATE_COMMAND],
        nextAction: {
          kind: "send_follow_up",
          note: SAVED_COMPARISON_PRIVATE_ASSESSMENT_NOTE,
        },
        updatedAt: timestamp(-400_000),
      },
      {
        target: {
          projectId: PRIMARY_PROJECT_ID,
          objectiveId: REVIEW_OBJECTIVE_ID,
          workItemId: REVIEW_WORK_ITEM_ID,
        },
        authorship: "user",
        reviewSummary: SAVED_COMPARISON_PRIVATE_WORK_ASSESSMENT,
        risks: [SAVED_COMPARISON_PRIVATE_OUTPUT],
        uncertainties: [],
        blockedDecisions: [],
        updatedAt: timestamp(-380_000),
      },
    ],
    evidence: [
      {
        id: "saved-comparison-private-content-evidence",
        kind: "changeset",
        outcome: "neutral",
        summary: `${SAVED_COMPARISON_PRIVATE_RESULT_CONTENT} ${SAVED_COMPARISON_PRIVATE_TASK_MESSAGE}`,
        recordedAt: timestamp(-370_000),
        projectId: PRIMARY_PROJECT_ID,
        objectiveId: REVIEW_OBJECTIVE_ID,
        workItemId: REVIEW_WORK_ITEM_ID,
        attemptId: REVIEW_ATTEMPT_ID,
        resultKey: referenceResultKey,
        provenance: {
          source: "coffice",
          reference: SAVED_COMPARISON_PRIVATE_GIT,
        },
      },
    ],
    verificationReceipts: [
      qualityReceipt({
        id: "saved-comparison-private-beta-old-receipt",
        target: betaTarget,
        profileId: "test",
        profileVersion: "1",
        state: "failed",
        failureKind: "timeout",
        offsetMs: -360_000,
      }),
      qualityReceipt({
        id: "saved-comparison-private-beta-newest-receipt",
        target: betaTarget,
        profileId: "lint",
        profileVersion: "1",
        state: "passed",
        offsetMs: -350_000,
      }),
      qualityReceipt({
        id: "saved-comparison-private-alpha-unknown-receipt",
        target: alphaTarget,
        profileId: SAVED_COMPARISON_LONG_TOKEN,
        profileVersion: "99",
        state: "failed",
        failureKind: "launch",
        offsetMs: -340_000,
      }),
    ],
  };
  return {
    snapshot: {
      ...snapshot,
      projects: snapshot.projects.map((project) =>
        project.id === PRIMARY_PROJECT_ID
          ? {
              ...project,
              repository: {
                availability: "available",
                source: "git",
                observedAt: timestamp(-330_000),
                rootPath: SAVED_COMPARISON_PRIVATE_PATH,
                branch: SAVED_COMPARISON_PRIVATE_GIT,
                head: "8".repeat(40),
                dirty: true,
                changedFiles: 99,
                stagedFiles: 11,
                untrackedFiles: 7,
                ahead: 5,
                behind: 4,
              },
            }
          : project,
      ),
    },
    workspace: comparisonWorkspace,
    referenceResultKey,
    betaTarget,
  };
}

function resultKeyIdentity(resultKey) {
  return `${resultKey.kind}:${resultKey.id}`;
}

function reviewSyntheticWorkspaceResult(workspace, mutation) {
  let matched = false;
  const projects = workspace.projects.map((project) => {
    if (project.id !== mutation.projectId) return project;
    const objectives = project.objectives.map((objective) => {
      if (objective.id !== mutation.objectiveId) return objective;
      const workItems = objective.workItems.map((workItem) => {
        if (workItem.id !== mutation.workItemId) return workItem;
        const attempts = workItem.attempts.map((attempt) => {
          if (attempt.id !== mutation.attemptId) return attempt;
          const resultCycles = attempt.resultCycles.map((result) => {
            if (
              resultKeyIdentity(result.key) !==
              resultKeyIdentity(mutation.resultKey)
            ) {
              return result;
            }
            matched = true;
            return {
              ...result,
              review: { reviewedAt: mutation.reviewedAt },
            };
          });
          return { ...attempt, resultCycles };
        });
        return { ...workItem, updatedAt: mutation.reviewedAt, attempts };
      });
      return { ...objective, updatedAt: mutation.reviewedAt, workItems };
    });
    return { ...project, updatedAt: mutation.reviewedAt, objectives };
  });
  if (!matched) {
    throw new Error("Synthetic acceptance fixture could not find the result.");
  }
  return {
    ...workspace,
    revision: workspace.revision + 1,
    updatedAt: mutation.reviewedAt,
    projects,
  };
}

function observeSyntheticWorkspaceResult(workspace, mutation) {
  let matched = false;
  let added = false;
  const projects = workspace.projects.map((project) => {
    if (project.id !== mutation.projectId) return project;
    let projectChanged = false;
    const objectives = project.objectives.map((objective) => {
      if (objective.id !== mutation.objectiveId) return objective;
      let objectiveChanged = false;
      const workItems = objective.workItems.map((workItem) => {
        if (workItem.id !== mutation.workItemId) return workItem;
        let workItemChanged = false;
        const attempts = workItem.attempts.map((attempt) => {
          if (attempt.id !== mutation.attemptId) return attempt;
          matched = true;
          const exists = attempt.resultCycles.some(
            (result) =>
              resultKeyIdentity(result.key) ===
              resultKeyIdentity(mutation.result.key),
          );
          if (exists) return attempt;
          added = true;
          workItemChanged = true;
          return {
            ...attempt,
            resultCycles: [...attempt.resultCycles, mutation.result],
          };
        });
        if (!workItemChanged) return workItem;
        objectiveChanged = true;
        return {
          ...workItem,
          status: "ready_for_review",
          updatedAt: mutation.result.observedAt,
          attempts,
        };
      });
      if (!objectiveChanged) return objective;
      projectChanged = true;
      return { ...objective, updatedAt: mutation.result.observedAt, workItems };
    });
    return projectChanged
      ? { ...project, updatedAt: mutation.result.observedAt, objectives }
      : project;
  });
  if (!matched) {
    throw new Error("Synthetic acceptance fixture could not find the attempt.");
  }
  if (!added) return workspace;
  return {
    ...workspace,
    revision: workspace.revision + 1,
    updatedAt: mutation.result.observedAt,
    projects,
  };
}

function workspaceHasResult(workspace, resultKey) {
  return workspace.projects.some((project) =>
    project.objectives.some((objective) =>
      objective.workItems.some((workItem) =>
        workItem.attempts.some((attempt) =>
          attempt.resultCycles.some(
            (result) =>
              resultKeyIdentity(result.key) === resultKeyIdentity(resultKey),
          ),
        ),
      ),
    ),
  );
}

function workspaceResultIsReviewed(workspace, resultKey) {
  return workspace.projects.some((project) =>
    project.objectives.some((objective) =>
      objective.workItems.some((workItem) =>
        workItem.attempts.some((attempt) =>
          attempt.resultCycles.some(
            (result) =>
              resultKeyIdentity(result.key) === resultKeyIdentity(resultKey) &&
              Boolean(result.review),
          ),
        ),
      ),
    ),
  );
}

function reorderSyntheticWorkspaceWorkItems(workspace, mutation, updatedAt) {
  const project = workspace.projects.find(
    (candidate) => candidate.id === mutation.projectId,
  );
  const objective = project?.objectives.find(
    (candidate) => candidate.id === mutation.objectiveId,
  );
  if (!project || !objective) return null;

  const currentIds = objective.workItems.map((workItem) => workItem.id);
  const orderedIds = mutation.orderedWorkItemIds;
  if (
    !Array.isArray(orderedIds) ||
    orderedIds.length !== currentIds.length ||
    new Set(orderedIds).size !== orderedIds.length ||
    orderedIds.some((id) => !currentIds.includes(id))
  ) {
    return null;
  }

  const workItemsById = new Map(
    objective.workItems.map((workItem) => [workItem.id, workItem]),
  );
  const projects = workspace.projects.map((candidateProject) =>
    candidateProject.id !== project.id
      ? candidateProject
      : {
          ...candidateProject,
          updatedAt,
          objectives: candidateProject.objectives.map((candidateObjective) =>
            candidateObjective.id !== objective.id
              ? candidateObjective
              : {
                  ...candidateObjective,
                  updatedAt,
                  workItems: orderedIds.map((id) => workItemsById.get(id)),
                },
          ),
        },
  );
  return {
    ...workspace,
    revision: workspace.revision + 1,
    updatedAt,
    projects,
  };
}

function appendSyntheticWorkspaceWorkItem(workspace, mutation, updatedAt) {
  const project = workspace.projects.find(
    (candidate) => candidate.id === mutation.projectId,
  );
  const objective = project?.objectives.find(
    (candidate) => candidate.id === mutation.objectiveId,
  );
  if (
    !project ||
    !objective ||
    objective.workItems.some(
      (workItem) => workItem.id === mutation.workItem?.id,
    )
  ) {
    return null;
  }

  return {
    ...workspace,
    revision: workspace.revision + 1,
    updatedAt,
    projects: workspace.projects.map((candidateProject) =>
      candidateProject.id !== project.id
        ? candidateProject
        : {
            ...candidateProject,
            updatedAt,
            objectives: candidateProject.objectives.map((candidateObjective) =>
              candidateObjective.id !== objective.id
                ? candidateObjective
                : {
                    ...candidateObjective,
                    updatedAt,
                    workItems: [
                      ...candidateObjective.workItems,
                      mutation.workItem,
                    ],
                  },
            ),
          },
    ),
  };
}

function hasExactObjectKeys(value, requiredKeys, optionalKeys = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  return (
    requiredKeys.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

function containsOnlyBooleanAndCountEvidence(value) {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(containsOnlyBooleanAndCountEvidence);
}

function isMeaningfulBoundedText(value, maxLength) {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    value.trim().length > 0
  );
}

function appendSyntheticProjectDecision(workspace, mutation, recordedAt) {
  if (workspace.projectDecisionEvents.length >= 4_096) return null;
  const safeEventId =
    typeof mutation?.id === "string" &&
    mutation.id.length <= 160 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(mutation.id);
  const projectExists = workspace.projects.some(
    (project) => project.id === mutation?.projectId,
  );
  const idIsUnique = !workspace.projectDecisionEvents.some(
    (event) => event.id === mutation?.id,
  );
  if (!safeEventId || !projectExists || !idIsUnique) return null;

  let event = null;
  if (
    mutation.type === "projectDecision.record" &&
    hasExactObjectKeys(
      mutation,
      ["type", "id", "projectId", "statement"],
      ["context"],
    ) &&
    isMeaningfulBoundedText(mutation.statement, 1_000) &&
    (mutation.context === undefined ||
      isMeaningfulBoundedText(mutation.context, 2_000))
  ) {
    event = {
      id: mutation.id,
      projectId: mutation.projectId,
      action: "recorded",
      statement: mutation.statement,
      ...(mutation.context === undefined ? {} : { context: mutation.context }),
      recordedAt,
      authorship: "user",
    };
  } else if (
    (mutation.type === "projectDecision.supersede" ||
      mutation.type === "projectDecision.withdraw") &&
    mutation.id !== mutation.supersedesId
  ) {
    const target = workspace.projectDecisionEvents.find(
      (candidate) => candidate.id === mutation.supersedesId,
    );
    const targetWasConsumed = workspace.projectDecisionEvents.some(
      (candidate) =>
        candidate.action !== "recorded" &&
        candidate.supersedesId === mutation.supersedesId,
    );
    if (
      !target ||
      target.projectId !== mutation.projectId ||
      target.action === "withdrawn" ||
      targetWasConsumed
    ) {
      return null;
    }

    if (
      mutation.type === "projectDecision.supersede" &&
      hasExactObjectKeys(
        mutation,
        [
          "type",
          "id",
          "projectId",
          "supersedesId",
          "supersessionKind",
          "statement",
        ],
        ["context"],
      ) &&
      ["correction", "replacement"].includes(mutation.supersessionKind) &&
      isMeaningfulBoundedText(mutation.statement, 1_000) &&
      (mutation.context === undefined ||
        isMeaningfulBoundedText(mutation.context, 2_000))
    ) {
      event = {
        id: mutation.id,
        projectId: mutation.projectId,
        action: "superseded",
        supersedesId: mutation.supersedesId,
        supersessionKind: mutation.supersessionKind,
        statement: mutation.statement,
        ...(mutation.context === undefined
          ? {}
          : { context: mutation.context }),
        recordedAt,
        authorship: "user",
      };
    } else if (
      mutation.type === "projectDecision.withdraw" &&
      hasExactObjectKeys(
        mutation,
        ["type", "id", "projectId", "supersedesId"],
        ["reason"],
      ) &&
      (mutation.reason === undefined ||
        isMeaningfulBoundedText(mutation.reason, 2_000))
    ) {
      event = {
        id: mutation.id,
        projectId: mutation.projectId,
        action: "withdrawn",
        supersedesId: mutation.supersedesId,
        ...(mutation.reason === undefined ? {} : { reason: mutation.reason }),
        recordedAt,
        authorship: "user",
      };
    }
  }
  if (!event) return null;
  return {
    workspace: {
      ...workspace,
      revision: workspace.revision + 1,
      updatedAt: recordedAt,
      projectDecisionEvents: [...workspace.projectDecisionEvents, event],
    },
    event,
  };
}

function projectDecisionInvariantSnapshot(workspace) {
  const { revision, updatedAt, projectDecisionEvents, ...unchanged } =
    workspace;
  void revision;
  void updatedAt;
  void projectDecisionEvents;
  return JSON.stringify(unchanged);
}

function browserCandidates() {
  const candidates = [process.env.CHROME_PATH, process.env.EDGE_PATH];
  if (process.platform === "win32") {
    for (const root of [
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
      process.env.LOCALAPPDATA,
    ]) {
      if (!root) continue;
      candidates.push(
        path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
      );
    }
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
    );
  }
  return candidates.filter(Boolean);
}

function resolveBrowserExecutable() {
  const executable = browserCandidates().find((candidate) =>
    existsSync(candidate),
  );
  if (!executable) {
    throw new Error(
      "Chrome or Edge was not found. Set CHROME_PATH or EDGE_PATH to a Chromium executable.",
    );
  }
  return executable;
}

function createErrorEvidence() {
  return {
    consoleErrors: [],
    expectedConsoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    responseFailures: [],
    expectedResponseFailures: [],
  };
}

function attachErrorCapture(page, evidence = createErrorEvidence()) {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (
      message.text() ===
        "Failed to load resource: the server responded with a status of 503 (Service Unavailable)" ||
      message.text() ===
        "Failed to load resource: the server responded with a status of 409 (Conflict)"
    ) {
      evidence.expectedConsoleErrors.push(message.text());
      return;
    }
    evidence.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => evidence.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const failure = request.failure();
    if (failure?.errorText === "net::ERR_ABORTED") return;
    evidence.requestFailures.push({
      method: request.method(),
      url: request.url(),
      error: failure?.errorText ?? "unknown request failure",
    });
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    if (
      [
        "attention-event",
        "decision-request-conflict",
        "definition-of-done-conflict",
        "project-rules-conflict",
      ].includes(response.headers()["x-coffice-synthetic-expected-failure"])
    ) {
      evidence.expectedResponseFailures.push({
        status: response.status(),
        url: response.url(),
      });
      return;
    }
    evidence.responseFailures.push({
      status: response.status(),
      url: response.url(),
    });
  });
  return evidence;
}

async function installSyntheticFixture(page, options = {}) {
  let fixture = syntheticFixture(options.pollIntervalMs, options.observedAt);
  const multiRootBaseline = options.multiRootHarness
    ? structuredClone(fixture)
    : null;
  if (multiRootBaseline) {
    fixture = multiRootRepositoryFixture(multiRootBaseline, "cold");
  }
  let workspace = syntheticWorkspaceFixture(fixture);
  if (options.currentPlanContextHarness) {
    const currentPlanContext = currentPlanContextFixture(fixture, workspace);
    fixture = currentPlanContext.snapshot;
    workspace = currentPlanContext.workspace;
  }
  if (options.failedCheckRepairHarness) {
    const failedCheckRepair = failedCheckRepairFixture(fixture, workspace);
    fixture = failedCheckRepair.snapshot;
    workspace = failedCheckRepair.workspace;
  }
  let savedComparisonTargets = null;
  if (options.savedResultComparisonHarness) {
    const savedComparison = savedResultComparisonFixture(fixture, workspace);
    fixture = savedComparison.snapshot;
    workspace = savedComparison.workspace;
    savedComparisonTargets = {
      referenceResultKey: structuredClone(savedComparison.referenceResultKey),
      betaTarget: structuredClone(savedComparison.betaTarget),
    };
  }
  const initialResultKey = workspace.projects
    .find((project) => project.id === PRIMARY_PROJECT_ID)
    ?.objectives.find((objective) => objective.id === REVIEW_OBJECTIVE_ID)
    ?.workItems.find((workItem) => workItem.id === REVIEW_WORK_ITEM_ID)
    ?.attempts.find((attempt) => attempt.id === REVIEW_ATTEMPT_ID)
    ?.resultCycles.at(-1)?.key;
  if (!initialResultKey) {
    throw new Error("Synthetic acceptance result key is missing.");
  }
  const qualityBarsBaselineProject = options.projectQualityBarsHarness
    ? structuredClone(
        workspace.projects.find((project) => project.id === PRIMARY_PROJECT_ID),
      )
    : null;
  if (options.projectRulesHarness) {
    workspace = {
      ...workspace,
      projects: workspace.projects.filter(
        (project) => project.id !== PRIMARY_PROJECT_ID,
      ),
      projectDecisionEvents: workspace.projectDecisionEvents.filter(
        (event) => event.projectId !== PRIMARY_PROJECT_ID,
      ),
    };
  }
  if (options.projectQualityBarsHarness) {
    workspace = {
      ...workspace,
      projects: workspace.projects.filter(
        (project) => project.id !== PRIMARY_PROJECT_ID,
      ),
      projectDecisionEvents: workspace.projectDecisionEvents.filter(
        (event) => event.projectId !== PRIMARY_PROJECT_ID,
      ),
    };
  }
  const initialReplyTask = fixture.tasks.find(
    (task) => task.status.value === "waiting_for_user",
  );
  if (!initialReplyTask) {
    throw new Error("Synthetic acceptance reply task is missing.");
  }
  const initialReplyEventKey = `${initialReplyTask.id}:waiting_for_user:${initialReplyTask.status.timestamp}`;
  const acceptedSeenEventKeys = new Set([
    initialResultKey.id,
    initialReplyEventKey,
  ]);
  let releaseWorkspaceHold = () => undefined;
  const workspaceHold = options.holdWorkspace
    ? new Promise((resolve) => {
        releaseWorkspaceHold = resolve;
      })
    : null;
  let verificationSequence = 0;
  let savedComparisonVerificationGeneration = 0;
  let syntheticCodexOperations = [];
  const syntheticCodexActionBodies = [];
  const removedProjectScopes = new Map();
  const failedCheckRepairBaseline = options.failedCheckRepairHarness
    ? structuredClone(workspace)
    : null;
  let workspaceRecovery = { kind: "none" };
  let workspacePersistent = true;
  let workspaceReadCount = 0;
  let rejectNextDefinitionOfDoneMutation = false;
  let nextProjectRulesConflict = null;
  let nextDecisionRequestConflict = null;
  let repairPollingSequence = 0;
  let liveVerificationReceipts = [];
  const repairCurrentTarget = failedCheckRepairBaseline
    ? structuredClone(
        failedCheckRepairBaseline.verificationReceipts.find(
          (receipt) => receipt.id === FAILED_CHECK_REPAIR_LATEST_RECEIPT_ID,
        )?.target,
      )
    : null;
  const repairPollingReceipt = () => {
    const source = failedCheckRepairBaseline?.verificationReceipts.find(
      (receipt) => receipt.id === FAILED_CHECK_REPAIR_OTHER_RECEIPT_ID,
    );
    if (!source) return null;
    repairPollingSequence += 1;
    const queuedAt = new Date(
      Date.parse(fixture.generatedAt) - 90_000,
    ).toISOString();
    return {
      ...structuredClone(source),
      id: `acceptance-repair-private-live-poll-${repairPollingSequence}`,
      idempotencyKey: `acceptance-repair-private-live-poll-key-${repairPollingSequence}`,
      requestHash: "e".repeat(64),
      profile: { id: "test", version: "1" },
      checks: [
        {
          id: "test",
          version: "1",
          state: "running",
          queuedAt,
          startedAt: queuedAt,
        },
      ],
      state: "running",
      queuedAt,
      startedAt: queuedAt,
      completedAt: undefined,
    };
  };
  const syncLiveVerificationReceipts = () => {
    const polling = repairPollingReceipt();
    liveVerificationReceipts = [
      ...structuredClone(workspace.verificationReceipts),
      ...(polling ? [polling] : []),
    ];
  };
  if (failedCheckRepairBaseline) syncLiveVerificationReceipts();
  const fixtureState = {
    observedAt: fixture.generatedAt,
    workspaceWriteCount: 0,
    assessmentWriteCount: 0,
    resultObservationWriteCount: 0,
    resultReviewWriteCount: 0,
    milestoneOrderWriteCount: 0,
    milestoneOrderRequests: [],
    milestoneAppendWriteCount: 0,
    milestoneAppendRequests: [],
    definitionOfDoneWriteCount: 0,
    definitionOfDoneRequests: [],
    definitionOfDoneConflictCount: 0,
    workItemRelationshipsWriteCount: 0,
    workItemRelationshipsRequests: [],
    projectRulesWriteCount: 0,
    projectRulesRequests: [],
    projectRulesConflictCount: 0,
    projectQualityBarsWriteCount: 0,
    projectQualityBarsRequests: [],
    projectContextReviewWriteCount: 0,
    projectContextReviewRequests: [],
    projectReviewScheduleWriteCount: 0,
    projectReviewScheduleRequests: [],
    projectDecisionWriteCount: 0,
    projectDecisionRequests: [],
    decisionRequestWriteCount: 0,
    decisionRequestRequests: [],
    decisionRequestConflictCount: 0,
    codexRouteRequests: [],
    verificationRouteRequests: [],
    workspaceMutationAttemptCount: 0,
    attentionSeenWriteCount: 0,
    seenAttentionEventKeys: [],
    attentionEventFailureCount: 0,
    failedAttentionEventKeys: [],
    failedAttentionDispositionKinds: [],
    reviewedAttentionArrivedAfterResultReview: false,
    syntheticCodexActionRouteCount: 0,
    initialResultKey,
    initialReplyEventKey,
    releaseWorkspace() {
      releaseWorkspaceHold();
    },
    resultIsReviewed(resultKey) {
      return workspaceResultIsReviewed(workspace, resultKey);
    },
    hasResult(resultKey) {
      return workspaceHasResult(workspace, resultKey);
    },
    attentionDisposition(eventKey) {
      return workspace.attentionReview.dispositions[eventKey];
    },
    latestReviewResultKey() {
      return structuredClone(
        workspace.projects
          .find((project) => project.id === PRIMARY_PROJECT_ID)
          ?.objectives.find((objective) => objective.id === REVIEW_OBJECTIVE_ID)
          ?.workItems.find((workItem) => workItem.id === REVIEW_WORK_ITEM_ID)
          ?.attempts.find((attempt) => attempt.id === REVIEW_ATTEMPT_ID)
          ?.resultCycles.at(-1)?.key ?? null,
      );
    },
    restoreUnreadAttention(eventKey) {
      const dispositions = { ...workspace.attentionReview.dispositions };
      delete dispositions[eventKey];
      workspace = {
        ...workspace,
        attentionReview: { ...workspace.attentionReview, dispositions },
      };
    },
    milestoneOrder() {
      return (
        workspace.projects
          .find((project) => project.id === PRIMARY_PROJECT_ID)
          ?.objectives.find((objective) => objective.id === REVIEW_OBJECTIVE_ID)
          ?.workItems.map((workItem) => workItem.id) ?? []
      );
    },
    definitionOfDone() {
      return structuredClone(
        workspace.projects
          .find((project) => project.id === PRIMARY_PROJECT_ID)
          ?.objectives.find((objective) => objective.id === REVIEW_OBJECTIVE_ID)
          ?.workItems.find((workItem) => workItem.id === REVIEW_WORK_ITEM_ID)
          ?.definitionOfDone ?? [],
      );
    },
    workItemRelationships() {
      return structuredClone(
        workspace.projects
          .find((project) => project.id === PRIMARY_PROJECT_ID)
          ?.objectives.find((objective) => objective.id === REVIEW_OBJECTIVE_ID)
          ?.workItems.find((workItem) => workItem.id === REVIEW_WORK_ITEM_ID)
          ?.relationships ?? [],
      );
    },
    workItemStatus(workItemId = REVIEW_WORK_ITEM_ID) {
      return workspace.projects
        .flatMap((project) => project.objectives)
        .flatMap((objective) => objective.workItems)
        .find((workItem) => workItem.id === workItemId)?.status;
    },
    rejectNextDefinitionOfDoneMutationWithConcurrentStatus() {
      rejectNextDefinitionOfDoneMutation = true;
    },
    projectRules(projectId = PRIMARY_PROJECT_ID) {
      return structuredClone(
        workspace.projects.find((project) => project.id === projectId)?.rules ??
          [],
      );
    },
    workspaceRevision() {
      return workspace.revision;
    },
    workspaceSchemaVersion() {
      return workspace.schemaVersion;
    },
    bumpUnrelatedWorkspaceRevision() {
      workspace = {
        ...workspace,
        revision: workspace.revision + 1,
        updatedAt: new Date(
          Date.parse(workspace.updatedAt) + 1_000,
        ).toISOString(),
      };
    },
    rejectNextProjectRulesMutation(rules) {
      nextProjectRulesConflict = [...rules];
    },
    projectRulesConflictArmed() {
      return nextProjectRulesConflict !== null;
    },
    projectQualityBars(projectId = PRIMARY_PROJECT_ID) {
      return structuredClone(
        workspace.projects.find((project) => project.id === projectId)
          ?.qualityBars ?? [],
      );
    },
    projectContextReview(projectId = PRIMARY_PROJECT_ID) {
      return structuredClone(
        workspace.projects.find((project) => project.id === projectId)
          ?.contextReview ?? null,
      );
    },
    projectReviewSchedule(projectId = PRIMARY_PROJECT_ID) {
      return structuredClone(
        workspace.projects.find((project) => project.id === projectId)
          ?.reviewSchedule ?? null,
      );
    },
    decisionRequests() {
      return structuredClone(workspace.decisionRequests);
    },
    rejectNextDecisionRequestMutation(prompt) {
      nextDecisionRequestConflict = prompt;
    },
    restoreQualityBarsReviewProject(qualityBars) {
      if (!qualityBarsBaselineProject) {
        throw new Error("Project Quality Bars fixture is unavailable.");
      }
      const updatedAt = new Date(
        Date.parse(workspace.updatedAt) + 1_000,
      ).toISOString();
      const target = {
        projectId: PRIMARY_PROJECT_ID,
        objectiveId: REVIEW_OBJECTIVE_ID,
        workItemId: REVIEW_WORK_ITEM_ID,
        attemptId: REVIEW_ATTEMPT_ID,
        resultKey: structuredClone(initialResultKey),
      };
      workspace = {
        ...workspace,
        revision: workspace.revision + 1,
        updatedAt,
        projects: [
          ...workspace.projects.filter(
            (project) => project.id !== PRIMARY_PROJECT_ID,
          ),
          {
            ...structuredClone(qualityBarsBaselineProject),
            qualityBars: structuredClone(qualityBars),
            updatedAt,
          },
        ],
        verificationReceipts: [
          ...workspace.verificationReceipts.filter(
            (receipt) => receipt.target.projectId !== PRIMARY_PROJECT_ID,
          ),
          {
            id: "quality-bars-private-test-pass",
            idempotencyKey: "quality-bars-private-test-pass-key",
            requestHash: "8".repeat(64),
            target,
            profile: { id: "test", version: "1" },
            checks: [
              {
                id: "test",
                version: "1",
                state: "passed",
                queuedAt: updatedAt,
                startedAt: updatedAt,
                completedAt: updatedAt,
              },
            ],
            state: "passed",
            queuedAt: updatedAt,
            startedAt: updatedAt,
            completedAt: updatedAt,
          },
          {
            id: "quality-bars-private-build-fail",
            idempotencyKey: "quality-bars-private-build-fail-key",
            requestHash: "9".repeat(64),
            target,
            profile: { id: "build", version: "1" },
            checks: [
              {
                id: "build",
                version: "1",
                state: "failed",
                queuedAt: updatedAt,
                startedAt: updatedAt,
                completedAt: updatedAt,
                failureKind: "exit",
                exitCode: 1,
              },
            ],
            state: "failed",
            queuedAt: updatedAt,
            startedAt: updatedAt,
            completedAt: updatedAt,
          },
        ],
      };
    },
    setProjectRules(rules, projectId = PRIMARY_PROJECT_ID) {
      const updatedAt = new Date(
        Date.parse(workspace.updatedAt) + 1_000,
      ).toISOString();
      workspace = {
        ...workspace,
        revision: workspace.revision + 1,
        updatedAt,
        projects: workspace.projects.map((project) =>
          project.id !== projectId
            ? project
            : {
                ...project,
                updatedAt,
                ...(rules.length
                  ? { rules: [...rules] }
                  : { rules: undefined }),
              },
        ),
      };
    },
    removeWorkspaceProject(projectId = PRIMARY_PROJECT_ID) {
      workspace = {
        ...workspace,
        revision: workspace.revision + 1,
        updatedAt: new Date(
          Date.parse(workspace.updatedAt) + 1_000,
        ).toISOString(),
        projects: workspace.projects.filter(
          (project) => project.id !== projectId,
        ),
      };
    },
    restoreWorkspaceProject(project, { rules = [] } = {}) {
      const updatedAt = new Date(
        Date.parse(workspace.updatedAt) + 1_000,
      ).toISOString();
      workspace = {
        ...workspace,
        revision: workspace.revision + 1,
        updatedAt,
        projects: [
          ...workspace.projects.filter(
            (candidate) => candidate.id !== project.id,
          ),
          {
            ...structuredClone(project),
            updatedAt,
            ...(rules.length ? { rules: [...rules] } : { rules: undefined }),
          },
        ],
      };
    },
    workspaceProject(projectId = PRIMARY_PROJECT_ID) {
      const project = workspace.projects.find(
        (candidate) => candidate.id === projectId,
      );
      return project ? structuredClone(project) : null;
    },
    projectDecisionEvents() {
      return structuredClone(workspace.projectDecisionEvents);
    },
    projectDecisionInvariantSnapshot() {
      return projectDecisionInvariantSnapshot(workspace);
    },
    verificationReceiptCount() {
      return workspace.verificationReceipts.length;
    },
    verificationMutationCount() {
      return this.verificationRouteRequests.filter(
        (request) => request.method !== "GET" && request.method !== "HEAD",
      ).length;
    },
    verificationGetCount() {
      return this.verificationRouteRequests.filter(
        (request) => request.method === "GET",
      ).length;
    },
    workspaceReadCount() {
      return workspaceReadCount;
    },
    savedComparisonTargets() {
      return savedComparisonTargets
        ? structuredClone(savedComparisonTargets)
        : null;
    },
    removeSavedComparisonAlternative(target) {
      if (!savedComparisonTargets || !target) {
        throw new Error("Saved-result comparison fixture is unavailable.");
      }
      const updatedAt = new Date(
        Date.parse(workspace.updatedAt) + 1_000,
      ).toISOString();
      workspace = {
        ...workspace,
        revision: workspace.revision + 1,
        updatedAt,
        projects: workspace.projects.map((project) =>
          project.id !== target.projectId
            ? project
            : {
                ...project,
                updatedAt,
                objectives: project.objectives.map((objective) =>
                  objective.id !== target.objectiveId
                    ? objective
                    : {
                        ...objective,
                        updatedAt,
                        workItems: objective.workItems.map((workItem) =>
                          workItem.id !== target.workItemId
                            ? workItem
                            : {
                                ...workItem,
                                updatedAt,
                                attempts: workItem.attempts.filter(
                                  (attempt) => attempt.id !== target.attemptId,
                                ),
                              },
                        ),
                      },
                ),
              },
        ),
        reviewAssessments: workspace.reviewAssessments.filter(
          (assessment) =>
            !(
              assessment.target.projectId === target.projectId &&
              assessment.target.objectiveId === target.objectiveId &&
              assessment.target.workItemId === target.workItemId &&
              "attemptId" in assessment.target &&
              assessment.target.attemptId === target.attemptId
            ),
        ),
        verificationReceipts: workspace.verificationReceipts.filter(
          (receipt) => receipt.target.attemptId !== target.attemptId,
        ),
      };
      savedComparisonVerificationGeneration += 1;
    },
    savedComparisonLiveVerification() {
      if (!savedComparisonTargets) return null;
      const queuedAt = new Date(
        Date.parse(fixture.generatedAt) - 300_000,
      ).toISOString();
      return {
        id: `saved-comparison-live-${savedComparisonVerificationGeneration}`,
        target: {
          projectId: PRIMARY_PROJECT_ID,
          objectiveId: REVIEW_OBJECTIVE_ID,
          workItemId: REVIEW_WORK_ITEM_ID,
          attemptId: REVIEW_ATTEMPT_ID,
          resultKey: structuredClone(savedComparisonTargets.referenceResultKey),
        },
        profile: { id: "test", version: "1" },
        checks: [
          {
            id: "test",
            version: "1",
            state: "running",
            queuedAt,
            startedAt: queuedAt,
          },
        ],
        state: "running",
        queuedAt,
        startedAt: queuedAt,
      };
    },
    setMultiRootScenario(scenario) {
      if (!multiRootBaseline) {
        throw new Error("Multi-root repository fixture is unavailable.");
      }
      if (!new Set(["cold", "settled", "bounded", "single"]).has(scenario)) {
        throw new Error(`Unknown multi-root scenario ${scenario}.`);
      }
      fixture = multiRootRepositoryFixture(multiRootBaseline, scenario);
    },
    setFailedCheckRepairScenario(scenario) {
      if (!failedCheckRepairBaseline || !repairCurrentTarget) {
        throw new Error("Failed-check repair fixture is unavailable.");
      }
      workspace = structuredClone(failedCheckRepairBaseline);
      workspaceRecovery = { kind: "none" };
      workspacePersistent = true;
      if (scenario === "no_receipt") {
        workspace.verificationReceipts = workspace.verificationReceipts.filter(
          (receipt) =>
            receipt.id !== FAILED_CHECK_REPAIR_OLDER_RECEIPT_ID &&
            receipt.id !== FAILED_CHECK_REPAIR_LATEST_RECEIPT_ID,
        );
      } else if (scenario === "later_pass") {
        const completedAt = new Date(
          Date.parse(fixture.generatedAt) - 100_000,
        ).toISOString();
        workspace.verificationReceipts.push({
          id: "acceptance-repair-private-later-exact-pass",
          idempotencyKey: "acceptance-repair-private-later-pass-key",
          requestHash: "f".repeat(64),
          target: structuredClone(repairCurrentTarget),
          profile: { id: "lint", version: "3" },
          checks: [
            {
              id: "lint",
              version: "3",
              state: "passed",
              queuedAt: completedAt,
              startedAt: completedAt,
              completedAt,
            },
          ],
          state: "passed",
          queuedAt: completedAt,
          startedAt: completedAt,
          completedAt,
        });
      } else if (scenario === "oversized") {
        const recordedAt = new Date(
          Date.parse(fixture.generatedAt) - 80_000,
        ).toISOString();
        workspace.projectDecisionEvents.push(
          ...Array.from({ length: 4 }, (_, index) => ({
            id: `acceptance-repair-private-oversized-decision-${index + 1}`,
            projectId: PRIMARY_PROJECT_ID,
            action: "recorded",
            statement: String.fromCodePoint(0x4fee).repeat(1_000),
            context: String.fromCodePoint(0x606f).repeat(2_000),
            recordedAt: new Date(
              Date.parse(recordedAt) + index * 1_000,
            ).toISOString(),
            authorship: "user",
          })),
        );
      } else if (scenario !== "ready") {
        throw new Error(`Unknown failed-check repair scenario ${scenario}.`);
      }
      syncLiveVerificationReceipts();
    },
    setFailedCheckRepairRecoveryLocked(locked) {
      if (!failedCheckRepairBaseline) {
        throw new Error("Failed-check repair fixture is unavailable.");
      }
      workspaceRecovery = locked
        ? { kind: "backup", reason: "primary-corrupt" }
        : { kind: "none" };
      workspacePersistent = true;
      syncLiveVerificationReceipts();
    },
    setLiveFailedCheckRepairMismatch(mismatched) {
      if (!failedCheckRepairBaseline) {
        throw new Error("Failed-check repair fixture is unavailable.");
      }
      syncLiveVerificationReceipts();
      if (!mismatched) return;
      liveVerificationReceipts = liveVerificationReceipts.map((receipt) =>
        receipt.id !== FAILED_CHECK_REPAIR_LATEST_RECEIPT_ID
          ? receipt
          : {
              ...receipt,
              id: "acceptance-repair-private-newer-same-profile-receipt",
              checks: receipt.checks.map((check) => ({
                ...check,
                exitCode: 41,
              })),
            },
      );
    },
    codexOperations() {
      return structuredClone(syntheticCodexOperations);
    },
    clearCodexOperations() {
      syntheticCodexOperations = [];
    },
    consumeCodexActionBody() {
      return syntheticCodexActionBodies.shift() ?? null;
    },
    pendingCodexActionBodyCount() {
      return syntheticCodexActionBodies.length;
    },
    projectRulesExternalPrivacy(canaries) {
      const clean = (value) => {
        const serialized = JSON.stringify(value);
        return canaries.every((canary) => !serialized.includes(canary));
      };
      return {
        publicSnapshotClean: clean(fixture),
        publicEventSurfacesClean: clean([
          ...acceptedSeenEventKeys,
          fixture.tasks.map((task) => ({
            id: task.id,
            projectId: task.projectId,
            status: task.status,
          })),
        ]),
        structuralWorkspaceEventsClean: clean({
          attentionReview: workspace.attentionReview,
          projectDecisionEvents: workspace.projectDecisionEvents,
          reviewAssessments: workspace.reviewAssessments,
          verificationReceipts: workspace.verificationReceipts,
          evidence: workspace.evidence,
        }),
        codexRequestSurfacesClean: clean(fixtureState.codexRouteRequests),
        verificationRequestSurfacesClean: clean(
          fixtureState.verificationRouteRequests,
        ),
        pendingCodexBodiesClean: clean(syntheticCodexActionBodies),
        codexOperationSurfacesClean: clean(syntheticCodexOperations),
        liveVerificationSurfacesClean: clean(liveVerificationReceipts),
      };
    },
    makeCurrentPlanContextOversized() {
      const recordedAt = new Date(
        Date.parse(workspace.updatedAt) + 60_000,
      ).toISOString();
      const oversized = Array.from({ length: 4 }, (_, index) => ({
        id: `current-context-oversized-${index + 1}`,
        projectId: SECONDARY_PROJECT_ID,
        action: "recorded",
        statement: String.fromCodePoint(0x6c49).repeat(1_000),
        context: String.fromCodePoint(0x754c).repeat(2_000),
        recordedAt: new Date(
          Date.parse(recordedAt) + index * 1_000,
        ).toISOString(),
        authorship: "user",
      }));
      workspace = {
        ...workspace,
        updatedAt: recordedAt,
        projectDecisionEvents: [
          ...workspace.projectDecisionEvents,
          ...oversized,
        ],
      };
    },
    clearReviewDecisionFixture() {
      workspace = { ...workspace, projectDecisionEvents: [] };
    },
    renameProject(projectId, name) {
      const observedAt = new Date(
        Date.parse(fixture.generatedAt) + 30_000,
      ).toISOString();
      fixture = {
        ...fixture,
        generatedAt: observedAt,
        source: {
          ...fixture.source,
          lastReadAt: observedAt,
          lastRefreshSuccessAt: observedAt,
        },
        projects: fixture.projects.map((project) =>
          project.id === projectId ? { ...project, name } : project,
        ),
      };
      workspace = {
        ...workspace,
        updatedAt: observedAt,
        projects: workspace.projects.map((project) =>
          project.id === projectId ? { ...project, title: name } : project,
        ),
      };
      return observedAt;
    },
    removeProject(projectId) {
      const project = fixture.projects.find(
        (candidate) => candidate.id === projectId,
      );
      if (!project) throw new Error("Synthetic project is unavailable.");
      const tasks = fixture.tasks.filter(
        (task) => task.projectId === projectId,
      );
      removedProjectScopes.set(projectId, {
        project: structuredClone(project),
        tasks: structuredClone(tasks),
      });
      const observedAt = new Date(
        Date.parse(fixture.generatedAt) + 30_000,
      ).toISOString();
      fixture = {
        ...fixture,
        generatedAt: observedAt,
        source: {
          ...fixture.source,
          lastReadAt: observedAt,
          lastRefreshSuccessAt: observedAt,
        },
        projects: fixture.projects.filter(
          (candidate) => candidate.id !== projectId,
        ),
        tasks: fixture.tasks.filter((task) => task.projectId !== projectId),
      };
      return observedAt;
    },
    readdProject(projectId) {
      const removed = removedProjectScopes.get(projectId);
      if (!removed) throw new Error("Synthetic project was not removed.");
      const observedAt = new Date(
        Date.parse(fixture.generatedAt) + 30_000,
      ).toISOString();
      fixture = {
        ...fixture,
        generatedAt: observedAt,
        source: {
          ...fixture.source,
          lastReadAt: observedAt,
          lastRefreshSuccessAt: observedAt,
        },
        projects: [...fixture.projects, structuredClone(removed.project)].sort(
          (left, right) => left.order - right.order,
        ),
        tasks: [...fixture.tasks, ...structuredClone(removed.tasks)],
      };
      removedProjectScopes.delete(projectId);
      return observedAt;
    },
    publishTaskTransitions(transitions) {
      const observedAt = new Date(
        Date.parse(fixture.generatedAt) + 60_000,
      ).toISOString();
      const changes = new Map(
        transitions.map(({ taskId, value }) => [taskId, value]),
      );
      const published = [];
      fixture = {
        ...fixture,
        generatedAt: observedAt,
        source: {
          ...fixture.source,
          lastReadAt: observedAt,
          lastRefreshSuccessAt: observedAt,
        },
        tasks: fixture.tasks.map((task) => {
          const value = changes.get(task.id);
          if (!value) return task;
          const eventKey = `${task.id}:${value}:${observedAt}`;
          acceptedSeenEventKeys.add(eventKey);
          published.push({
            eventKey,
            taskId: task.id,
            projectId: task.projectId ?? HOLDING_PROJECT_ID,
            taskTitle: task.title,
            value,
            observedAt,
          });
          return {
            ...task,
            updatedAt: observedAt,
            status: status(value, observedAt),
          };
        }),
      };
      if (published.length !== transitions.length) {
        throw new Error("Synthetic transition fixture could not find a task.");
      }
      return published;
    },
    publishFailedVerification() {
      verificationSequence += 1;
      const completedAt = new Date(
        Date.parse(fixture.generatedAt) + 60_000,
      ).toISOString();
      const target = {
        projectId: PRIMARY_PROJECT_ID,
        objectiveId: REVIEW_OBJECTIVE_ID,
        workItemId: REVIEW_WORK_ITEM_ID,
        attemptId: REVIEW_ATTEMPT_ID,
        resultKey: { ...initialResultKey },
      };
      const id = `acceptance-transition-verification-${verificationSequence}`;
      workspace = {
        ...workspace,
        updatedAt: completedAt,
        verificationReceipts: [
          ...workspace.verificationReceipts,
          {
            id,
            idempotencyKey: `${id}-request`,
            requestHash: "a".repeat(64),
            target,
            profile: { id: "acceptance", version: "1" },
            checks: [
              {
                id: "acceptance",
                version: "1",
                state: "failed",
                queuedAt: completedAt,
                startedAt: completedAt,
                completedAt,
                failureKind: "exit",
                exitCode: 1,
              },
            ],
            state: "failed",
            queuedAt: completedAt,
            startedAt: completedAt,
            completedAt,
          },
        ],
      };
      const eventKey = `verification:${id}`;
      acceptedSeenEventKeys.add(eventKey);
      return { eventKey, id, target, completedAt };
    },
    publishDistinctResult() {
      const previousTask = fixture.tasks.find(
        (task) => task.id === REVIEW_TASK_ID,
      );
      if (!previousTask) {
        throw new Error("Synthetic review task is missing from the snapshot.");
      }
      const observedAt = new Date(
        Date.parse(previousTask.status.timestamp) + 60_000,
      ).toISOString();
      const resultKey = {
        kind: "revision",
        id: `${REVIEW_TASK_ID}:completed:${observedAt}`,
      };
      acceptedSeenEventKeys.add(resultKey.id);
      fixture = {
        ...fixture,
        generatedAt: observedAt,
        source: {
          ...fixture.source,
          lastReadAt: observedAt,
          lastRefreshSuccessAt: observedAt,
        },
        tasks: fixture.tasks.map((task) =>
          task.id === REVIEW_TASK_ID
            ? {
                ...task,
                updatedAt: observedAt,
                status: status("completed", observedAt),
              }
            : task,
        ),
      };
      return resultKey;
    },
  };
  page.on("request", (request) => {
    if (new URL(request.url()).pathname !== "/api/codex-actions") return;
    fixtureState.codexRouteRequests.push({
      method: request.method(),
      url: request.url(),
    });
  });
  await page.addInitScript((desktopAlertHarness) => {
    window.localStorage.setItem(
      "coffice.attention-review.v2",
      JSON.stringify({
        version: 2,
        initializedAt: new Date(Date.now() - 60_000).toISOString(),
        dispositions: {},
        snoozedUntil: {},
      }),
    );
    window.localStorage.removeItem("coffice.attention-review.v1");
    if (!desktopAlertHarness) return;

    if (desktopAlertHarness.resetStorage) {
      for (const key of Object.keys(window.localStorage)) {
        if (
          key.startsWith("coffice:desktop-alert") ||
          key.startsWith("coffice.desktop-alert")
        ) {
          window.localStorage.removeItem(key);
        }
      }
    }

    const state = {
      permission: desktopAlertHarness.permission,
      permissionRequests: 0,
      notifications: [],
      foreground: true,
      focusCalls: 0,
    };

    class SyntheticNotification {
      static get permission() {
        return state.permission;
      }

      static async requestPermission() {
        state.permissionRequests += 1;
        state.permission = "granted";
        return "granted";
      }

      constructor(title, options = {}) {
        this.title = title;
        this.options = structuredClone(options);
        this.closed = false;
        this.onclick = null;
        this.onclose = null;
        state.notifications.push(this);
      }

      close() {
        this.closed = true;
        this.onclose?.(new Event("close"));
      }
    }

    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: SyntheticNotification,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (state.foreground ? "visible" : "hidden"),
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => !state.foreground,
    });
    document.hasFocus = () => state.foreground;
    window.focus = () => {
      state.focusCalls += 1;
    };
    Object.defineProperty(window, "__cofficeDesktopAlertAcceptance", {
      configurable: false,
      value: {
        evidence() {
          return {
            permission: state.permission,
            permissionRequests: state.permissionRequests,
            focusCalls: state.focusCalls,
            notifications: state.notifications.map((notification) => ({
              title: notification.title,
              options: structuredClone(notification.options),
              closed: notification.closed,
            })),
          };
        },
        setForeground(foreground) {
          state.foreground = Boolean(foreground);
          document.dispatchEvent(new Event("visibilitychange"));
        },
        clickNotification(index) {
          const notification = state.notifications[index];
          if (!notification) return false;
          notification.onclick?.(new Event("click"));
          return true;
        },
      },
    });
  }, options.desktopAlertHarness ?? null);
  await page.route("**/api/snapshot", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    }),
  );
  await page.route("**/api/workspace", async (route) => {
    const request = route.request();
    if (request.method() === "GET") workspaceReadCount += 1;
    if (request.method() === "GET" && workspaceHold) {
      await workspaceHold;
    }
    if (request.method() === "PATCH") {
      fixtureState.workspaceMutationAttemptCount += 1;
      const body = request.postDataJSON();
      const mutation = body?.mutation;
      if (
        mutation?.type === "projectDecision.record" ||
        mutation?.type === "projectDecision.supersede" ||
        mutation?.type === "projectDecision.withdraw"
      ) {
        const acceptedRevision = workspace.revision;
        const recordedAt = new Date(
          Math.max(Date.now(), Date.parse(workspace.updatedAt) + 1),
        ).toISOString();
        const appended = appendSyntheticProjectDecision(
          workspace,
          mutation,
          recordedAt,
        );
        fixtureState.projectDecisionRequests.push({
          expectedRevision: body?.expectedRevision,
          acceptedRevision,
          mutationId: body?.mutationId,
          mutation: structuredClone(mutation),
        });
        if (
          !hasExactObjectKeys(body, [
            "expectedRevision",
            "mutationId",
            "mutation",
          ]) ||
          body.expectedRevision !== acceptedRevision ||
          typeof body.mutationId !== "string" ||
          body.mutationId.length === 0 ||
          !appended
        ) {
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error:
                "Synthetic acceptance fixture rejected an invalid project decision event.",
              code: "invalid_project_decision",
              persistence: { persistent: true },
            }),
          });
        }
        workspace = appended.workspace;
        fixtureState.workspaceWriteCount += 1;
        fixtureState.projectDecisionWriteCount += 1;
      } else if (mutation?.type?.startsWith("decisionRequest.")) {
        const acceptedRevision = workspace.revision;
        fixtureState.decisionRequestRequests.push({
          expectedRevision: body?.expectedRevision,
          acceptedRevision,
          mutationId: body?.mutationId,
          type: mutation.type,
        });
        if (
          nextDecisionRequestConflict !== null &&
          mutation.type === "decisionRequest.update"
        ) {
          const concurrentPrompt = nextDecisionRequestConflict;
          nextDecisionRequestConflict = null;
          const concurrent = mutateSyntheticDecisionRequest(
            workspace,
            { ...mutation, prompt: concurrentPrompt },
            new Date(Date.parse(workspace.updatedAt) + 1_000).toISOString(),
          );
          if (!concurrent) {
            throw new Error(
              "Synthetic decision conflict could not update its request.",
            );
          }
          workspace = concurrent;
          fixtureState.decisionRequestConflictCount += 1;
          return route.fulfill({
            status: 409,
            headers: {
              "x-coffice-synthetic-expected-failure":
                "decision-request-conflict",
            },
            contentType: "application/json",
            body: JSON.stringify({
              error: "Synthetic concurrent decision-request revision.",
              code: "workspace_conflict",
              workspace,
              recovery: workspaceRecovery,
              persistence: { persistent: true },
            }),
          });
        }
        const updatedAt = new Date(
          Math.max(Date.now(), Date.parse(workspace.updatedAt) + 1),
        ).toISOString();
        const updatedWorkspace = mutateSyntheticDecisionRequest(
          workspace,
          mutation,
          updatedAt,
        );
        if (
          !updatedWorkspace ||
          body?.expectedRevision !== acceptedRevision ||
          typeof body?.mutationId !== "string" ||
          !body.mutationId
        ) {
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error:
                "Synthetic acceptance fixture rejected an invalid decision request.",
              code: "invalid_decision_request",
              persistence: { persistent: true },
            }),
          });
        }
        workspace = updatedWorkspace;
        fixtureState.workspaceWriteCount += 1;
        fixtureState.decisionRequestWriteCount += 1;
      } else if (mutation?.type === "assessment.set") {
        const assessment = {
          ...mutation.assessment,
          authorship: "user",
          updatedAt: new Date().toISOString(),
        };
        const identity = JSON.stringify(assessment.target);
        const remaining = workspace.reviewAssessments.filter(
          (candidate) => JSON.stringify(candidate.target) !== identity,
        );
        workspace = {
          ...workspace,
          revision: workspace.revision + 1,
          updatedAt: assessment.updatedAt,
          reviewAssessments: [...remaining, assessment],
        };
        fixtureState.workspaceWriteCount += 1;
        fixtureState.assessmentWriteCount += 1;
      } else if (mutation?.type === "assessment.clear") {
        const identity = JSON.stringify(mutation.target);
        workspace = {
          ...workspace,
          revision: workspace.revision + 1,
          updatedAt: new Date().toISOString(),
          reviewAssessments: workspace.reviewAssessments.filter(
            (candidate) => JSON.stringify(candidate.target) !== identity,
          ),
        };
        fixtureState.workspaceWriteCount += 1;
        fixtureState.assessmentWriteCount += 1;
      } else if (mutation?.type === "result.review") {
        workspace = reviewSyntheticWorkspaceResult(workspace, mutation);
        fixtureState.workspaceWriteCount += 1;
        fixtureState.resultReviewWriteCount += 1;
      } else if (mutation?.type === "result.upsert") {
        const updatedWorkspace = observeSyntheticWorkspaceResult(
          workspace,
          mutation,
        );
        if (updatedWorkspace !== workspace) {
          workspace = updatedWorkspace;
          fixtureState.workspaceWriteCount += 1;
          fixtureState.resultObservationWriteCount += 1;
        }
      } else if (
        mutation?.type === "project.contextReview.set" ||
        mutation?.type === "project.contextReview.clear"
      ) {
        const acceptedRevision = workspace.revision;
        const exactSet =
          mutation.type === "project.contextReview.set" &&
          hasExactObjectKeys(
            mutation,
            ["type", "projectId", "concerns"],
            ["note"],
          ) &&
          Array.isArray(mutation.concerns) &&
          mutation.concerns.length > 0 &&
          JSON.stringify(mutation.concerns) ===
            JSON.stringify(
              ["stale", "contradictory"].filter((concern) =>
                mutation.concerns.includes(concern),
              ),
            ) &&
          (mutation.note === undefined ||
            (typeof mutation.note === "string" &&
              mutation.note.length > 0 &&
              mutation.note.length <= 2_000));
        const exactClear =
          mutation.type === "project.contextReview.clear" &&
          hasExactObjectKeys(mutation, ["type", "projectId"]);
        const projectExists = workspace.projects.some(
          (project) => project.id === mutation.projectId,
        );
        fixtureState.projectContextReviewRequests.push({
          expectedRevision: body?.expectedRevision,
          acceptedRevision,
          mutationId: body?.mutationId,
          mutation: structuredClone(mutation),
        });
        if (
          (!exactSet && !exactClear) ||
          !projectExists ||
          body?.expectedRevision !== acceptedRevision ||
          typeof body?.mutationId !== "string" ||
          !body.mutationId
        ) {
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error:
                "Synthetic fixture rejected an invalid context-review intent.",
              code: "invalid_project_context_review",
              persistence: { persistent: true },
            }),
          });
        }
        const updatedAt = new Date(
          Math.max(Date.now(), Date.parse(workspace.updatedAt) + 1),
        ).toISOString();
        workspace = {
          ...workspace,
          revision: workspace.revision + 1,
          updatedAt,
          projects: workspace.projects.map((project) => {
            if (project.id !== mutation.projectId) return project;
            const updated = { ...project, updatedAt };
            if (mutation.type === "project.contextReview.set") {
              updated.contextReview = {
                concerns: [...mutation.concerns],
                ...(mutation.note ? { note: mutation.note } : {}),
                markedAt: updatedAt,
                authorship: "user",
              };
            } else {
              delete updated.contextReview;
            }
            return updated;
          }),
        };
        fixtureState.workspaceWriteCount += 1;
        fixtureState.projectContextReviewWriteCount += 1;
      } else if (
        mutation?.type === "project.reviewSchedule.set" ||
        mutation?.type === "project.reviewSchedule.complete" ||
        mutation?.type === "project.reviewSchedule.clear"
      ) {
        const acceptedRevision = workspace.revision;
        const exactSet =
          mutation.type === "project.reviewSchedule.set" &&
          hasExactObjectKeys(
            mutation,
            ["type", "projectId", "nextReviewAt"],
            ["repeatEveryDays"],
          ) &&
          Number.isFinite(Date.parse(mutation.nextReviewAt)) &&
          (mutation.repeatEveryDays === undefined ||
            (Number.isSafeInteger(mutation.repeatEveryDays) &&
              mutation.repeatEveryDays >= 1 &&
              mutation.repeatEveryDays <= 3_650));
        const exactIntent =
          exactSet ||
          ((mutation.type === "project.reviewSchedule.complete" ||
            mutation.type === "project.reviewSchedule.clear") &&
            hasExactObjectKeys(mutation, ["type", "projectId"]));
        const project = workspace.projects.find(
          (candidate) => candidate.id === mutation.projectId,
        );
        fixtureState.projectReviewScheduleRequests.push({
          expectedRevision: body?.expectedRevision,
          acceptedRevision,
          mutationId: body?.mutationId,
          mutation: structuredClone(mutation),
        });
        if (
          !exactIntent ||
          !project ||
          ((mutation.type === "project.reviewSchedule.complete" ||
            mutation.type === "project.reviewSchedule.clear") &&
            !project.reviewSchedule) ||
          body?.expectedRevision !== acceptedRevision ||
          typeof body?.mutationId !== "string" ||
          !body.mutationId
        ) {
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error:
                "Synthetic fixture rejected an invalid project-review schedule intent.",
              code: "invalid_project_review_schedule",
              persistence: { persistent: true },
            }),
          });
        }
        const updatedAt = new Date(
          Math.max(Date.now(), Date.parse(workspace.updatedAt) + 1),
        ).toISOString();
        workspace = {
          ...workspace,
          revision: workspace.revision + 1,
          updatedAt,
          projects: workspace.projects.map((candidate) => {
            if (candidate.id !== mutation.projectId) return candidate;
            const updated = { ...candidate, updatedAt };
            if (mutation.type === "project.reviewSchedule.set") {
              updated.reviewSchedule = {
                nextReviewAt: mutation.nextReviewAt,
                ...(mutation.repeatEveryDays
                  ? { repeatEveryDays: mutation.repeatEveryDays }
                  : {}),
                configuredAt: updatedAt,
                ...(candidate.reviewSchedule?.lastReviewedAt
                  ? {
                      lastReviewedAt: candidate.reviewSchedule.lastReviewedAt,
                    }
                  : {}),
                authorship: "user",
              };
            } else if (mutation.type === "project.reviewSchedule.complete") {
              if (candidate.reviewSchedule.repeatEveryDays) {
                updated.reviewSchedule = {
                  ...candidate.reviewSchedule,
                  nextReviewAt: new Date(
                    Date.parse(updatedAt) +
                      candidate.reviewSchedule.repeatEveryDays *
                        24 *
                        60 *
                        60 *
                        1_000,
                  ).toISOString(),
                  lastReviewedAt: updatedAt,
                };
              } else {
                delete updated.reviewSchedule;
              }
            } else {
              delete updated.reviewSchedule;
            }
            return updated;
          }),
        };
        fixtureState.workspaceWriteCount += 1;
        fixtureState.projectReviewScheduleWriteCount += 1;
      } else if (
        mutation?.type === "project.qualityBars.set" ||
        (options.projectQualityBarsHarness &&
          mutation?.type === "project.upsert" &&
          Array.isArray(mutation.project?.qualityBars))
      ) {
        const acceptedRevision = workspace.revision;
        const requestedBars =
          mutation.type === "project.qualityBars.set"
            ? mutation.qualityBars
            : mutation.project.qualityBars;
        const exactSet =
          mutation.type === "project.qualityBars.set" &&
          hasExactObjectKeys(mutation, ["type", "projectId", "qualityBars"]) &&
          mutation.projectId === PRIMARY_PROJECT_ID;
        const project = mutation.project;
        const exactUpsert =
          mutation.type === "project.upsert" &&
          hasExactObjectKeys(mutation, ["type", "project"]) &&
          project &&
          hasExactObjectKeys(project, [
            "id",
            "title",
            "createdAt",
            "updatedAt",
            "objectives",
            "qualityBars",
          ]) &&
          project.id === PRIMARY_PROJECT_ID &&
          project.title === "Acceptance Office" &&
          Array.isArray(project.objectives) &&
          project.objectives.length === 0 &&
          project.createdAt === project.updatedAt &&
          Number.isFinite(Date.parse(project.createdAt));
        const profileOrder = ["test", "typecheck", "lint", "build"];
        const barsValid =
          Array.isArray(requestedBars) &&
          requestedBars.length <= profileOrder.length &&
          requestedBars.every(
            (bar, index) =>
              hasExactObjectKeys(bar, ["profileId", "profileVersion"]) &&
              bar.profileVersion === "1" &&
              profileOrder.includes(bar.profileId) &&
              (index === 0 ||
                profileOrder.indexOf(requestedBars[index - 1].profileId) <
                  profileOrder.indexOf(bar.profileId)),
          );
        fixtureState.projectQualityBarsRequests.push({
          expectedRevision: body?.expectedRevision,
          acceptedRevision,
          mutationId: body?.mutationId,
          mutation: structuredClone(mutation),
        });
        if (
          !hasExactObjectKeys(body, [
            "expectedRevision",
            "mutationId",
            "mutation",
          ]) ||
          body.expectedRevision !== acceptedRevision ||
          typeof body.mutationId !== "string" ||
          body.mutationId.length === 0 ||
          (!exactSet && !exactUpsert) ||
          !barsValid
        ) {
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error:
                "Synthetic acceptance fixture rejected invalid project quality bars.",
              code: "invalid_project_quality_bars",
              persistence: { persistent: true },
            }),
          });
        }
        const updatedAt = new Date(
          Math.max(Date.now(), Date.parse(workspace.updatedAt) + 1),
        ).toISOString();
        if (exactUpsert) {
          workspace = {
            ...workspace,
            revision: workspace.revision + 1,
            updatedAt,
            projects: [
              ...workspace.projects,
              { ...structuredClone(project), updatedAt },
            ],
          };
        } else {
          workspace = {
            ...workspace,
            revision: workspace.revision + 1,
            updatedAt,
            projects: workspace.projects.map((candidate) => {
              if (candidate.id !== PRIMARY_PROJECT_ID) return candidate;
              const updated = { ...candidate, updatedAt };
              if (requestedBars.length) {
                updated.qualityBars = structuredClone(requestedBars);
              } else {
                delete updated.qualityBars;
              }
              return updated;
            }),
          };
        }
        fixtureState.workspaceWriteCount += 1;
        fixtureState.projectQualityBarsWriteCount += 1;
      } else if (
        mutation?.type === "project.rules.set" ||
        mutation?.type === "project.upsert"
      ) {
        const acceptedRevision = workspace.revision;
        const requestedRules =
          mutation.type === "project.rules.set"
            ? mutation.rules
            : (mutation.project?.rules ?? []);
        const exactSet =
          mutation.type === "project.rules.set" &&
          hasExactObjectKeys(mutation, ["type", "projectId", "rules"]) &&
          mutation.projectId === PRIMARY_PROJECT_ID;
        const project = mutation.project;
        const exactUpsert =
          mutation.type === "project.upsert" &&
          hasExactObjectKeys(mutation, ["type", "project"]) &&
          project &&
          hasExactObjectKeys(
            project,
            ["id", "title", "createdAt", "updatedAt", "objectives"],
            ["rules"],
          ) &&
          project.id === PRIMARY_PROJECT_ID &&
          project.title === "Acceptance Office" &&
          Array.isArray(project.objectives) &&
          project.objectives.length === 0 &&
          project.createdAt === project.updatedAt &&
          Number.isFinite(Date.parse(project.createdAt));
        fixtureState.projectRulesRequests.push({
          expectedRevision: body?.expectedRevision,
          acceptedRevision,
          mutationId: body?.mutationId,
          mutation: structuredClone(mutation),
        });
        if (
          !hasExactObjectKeys(body, [
            "expectedRevision",
            "mutationId",
            "mutation",
          ]) ||
          (!nextProjectRulesConflict &&
            body.expectedRevision !== acceptedRevision) ||
          typeof body.mutationId !== "string" ||
          body.mutationId.length === 0 ||
          (!exactSet && !exactUpsert) ||
          !Array.isArray(requestedRules) ||
          requestedRules.some(
            (rule) =>
              typeof rule !== "string" || !rule.trim() || rule.length > 1_000,
          )
        ) {
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error:
                "Synthetic acceptance fixture rejected invalid project rules.",
              code: "invalid_project_rules",
              persistence: { persistent: true },
            }),
          });
        }
        if (nextProjectRulesConflict) {
          const concurrentRules = nextProjectRulesConflict;
          nextProjectRulesConflict = null;
          const updatedAt = new Date(
            Date.parse(workspace.updatedAt) + 1_000,
          ).toISOString();
          workspace = {
            ...workspace,
            revision: workspace.revision + 1,
            updatedAt,
            projects: workspace.projects.map((candidate) =>
              candidate.id !== PRIMARY_PROJECT_ID
                ? candidate
                : { ...candidate, rules: concurrentRules, updatedAt },
            ),
          };
          fixtureState.projectRulesConflictCount += 1;
          return route.fulfill({
            status: 409,
            headers: {
              "x-coffice-synthetic-expected-failure": "project-rules-conflict",
            },
            contentType: "application/json",
            body: JSON.stringify({
              error: "Synthetic concurrent project-rules revision.",
              code: "workspace_conflict",
              workspace,
              recovery: workspaceRecovery,
              persistence: { persistent: true },
            }),
          });
        }
        const updatedAt = new Date(
          Math.max(Date.now(), Date.parse(workspace.updatedAt) + 1),
        ).toISOString();
        if (exactUpsert) {
          workspace = {
            ...workspace,
            revision: workspace.revision + 1,
            updatedAt,
            projects: [
              ...workspace.projects,
              { ...structuredClone(project), updatedAt },
            ],
          };
        } else {
          workspace = {
            ...workspace,
            revision: workspace.revision + 1,
            updatedAt,
            projects: workspace.projects.map((candidate) => {
              if (candidate.id !== PRIMARY_PROJECT_ID) return candidate;
              const updated = { ...candidate, updatedAt };
              if (requestedRules.length) updated.rules = [...requestedRules];
              else delete updated.rules;
              return updated;
            }),
          };
        }
        fixtureState.workspaceWriteCount += 1;
        fixtureState.projectRulesWriteCount += 1;
      } else if (mutation?.type === "workItem.relationships.set") {
        const acceptedRevision = workspace.revision;
        const updatedWorkspace = setSyntheticWorkItemRelationships(
          workspace,
          mutation,
          new Date().toISOString(),
        );
        fixtureState.workItemRelationshipsRequests.push({
          expectedRevision: body?.expectedRevision,
          acceptedRevision,
          mutationId: body?.mutationId,
          mutation: structuredClone(mutation),
        });
        if (
          !updatedWorkspace ||
          body?.expectedRevision !== acceptedRevision ||
          typeof body?.mutationId !== "string" ||
          !body.mutationId
        ) {
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error:
                "Synthetic acceptance fixture rejected invalid work links.",
              code: "invalid_work_item_relationships",
              persistence: { persistent: true },
            }),
          });
        }
        workspace = updatedWorkspace;
        fixtureState.workspaceWriteCount += 1;
        fixtureState.workItemRelationshipsWriteCount += 1;
      } else if (mutation?.type === "workItem.definitionOfDone.set") {
        const acceptedRevision = workspace.revision;
        fixtureState.definitionOfDoneRequests.push({
          expectedRevision: body?.expectedRevision,
          acceptedRevision,
          mutationId: body?.mutationId,
          mutation: structuredClone(mutation),
        });
        if (rejectNextDefinitionOfDoneMutation) {
          rejectNextDefinitionOfDoneMutation = false;
          workspace = {
            ...workspace,
            revision: workspace.revision + 1,
            updatedAt: new Date().toISOString(),
            projects: workspace.projects.map((project) =>
              project.id !== mutation.projectId
                ? project
                : {
                    ...project,
                    updatedAt: new Date().toISOString(),
                    objectives: project.objectives.map((objective) =>
                      objective.id !== mutation.objectiveId
                        ? objective
                        : {
                            ...objective,
                            updatedAt: new Date().toISOString(),
                            workItems: objective.workItems.map((workItem) =>
                              workItem.id !== mutation.workItemId
                                ? workItem
                                : {
                                    ...workItem,
                                    status: "in_progress",
                                    definitionOfDone: [
                                      fixtureState.definitionOfDoneConflictCount ===
                                      0
                                        ? CONCURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY
                                        : SECOND_CONCURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
                                    ],
                                    updatedAt: new Date().toISOString(),
                                  },
                            ),
                          },
                    ),
                  },
            ),
          };
          fixtureState.definitionOfDoneConflictCount += 1;
          return route.fulfill({
            status: 409,
            headers: {
              "x-coffice-synthetic-expected-failure":
                "definition-of-done-conflict",
            },
            contentType: "application/json",
            body: JSON.stringify({
              error: "Synthetic concurrent workspace revision.",
              code: "workspace_conflict",
              workspace,
              recovery: workspaceRecovery,
              persistence: { persistent: true },
            }),
          });
        }
        const updatedWorkspace = setSyntheticDefinitionOfDone(
          workspace,
          mutation,
          new Date().toISOString(),
        );
        if (
          !updatedWorkspace ||
          body?.expectedRevision !== acceptedRevision ||
          typeof body?.mutationId !== "string" ||
          !body.mutationId
        ) {
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error:
                "Synthetic acceptance fixture rejected invalid Definition of Done intent.",
              code: "invalid_definition_of_done",
              persistence: { persistent: true },
            }),
          });
        }
        workspace = updatedWorkspace;
        fixtureState.workspaceWriteCount += 1;
        fixtureState.definitionOfDoneWriteCount += 1;
      } else if (mutation?.type === "workItem.reorder") {
        const acceptedRevision = workspace.revision;
        const updatedWorkspace = reorderSyntheticWorkspaceWorkItems(
          workspace,
          mutation,
          new Date().toISOString(),
        );
        fixtureState.milestoneOrderRequests.push({
          expectedRevision: body.expectedRevision,
          acceptedRevision,
          mutationId: body.mutationId,
          type: mutation.type,
          projectId: mutation.projectId,
          objectiveId: mutation.objectiveId,
          orderedWorkItemIds: Array.isArray(mutation.orderedWorkItemIds)
            ? [...mutation.orderedWorkItemIds]
            : mutation.orderedWorkItemIds,
        });
        if (
          !updatedWorkspace ||
          body.expectedRevision !== acceptedRevision ||
          typeof body.mutationId !== "string" ||
          body.mutationId.length === 0
        ) {
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error:
                "Synthetic acceptance fixture rejected an invalid milestone order.",
              code: "invalid_milestone_order",
              persistence: { persistent: true },
            }),
          });
        }
        workspace = updatedWorkspace;
        fixtureState.workspaceWriteCount += 1;
        fixtureState.milestoneOrderWriteCount += 1;
      } else if (mutation?.type === "workItem.upsert") {
        const acceptedRevision = workspace.revision;
        const workItem = mutation.workItem;
        const expectedWorkItemKeys = [
          "attempts",
          "createdAt",
          "definitionOfDone",
          "expectedOutcome",
          "id",
          "status",
          "title",
          "updatedAt",
        ];
        const workItemKeys =
          workItem && typeof workItem === "object"
            ? Object.keys(workItem).sort()
            : [];
        const exactWorkItem =
          JSON.stringify(workItemKeys) ===
            JSON.stringify(expectedWorkItemKeys) &&
          typeof workItem.id === "string" &&
          /^work-[A-Za-z0-9._:-]+$/u.test(workItem.id) &&
          workItem.title === APPENDED_MILESTONE_TITLE &&
          workItem.expectedOutcome === APPENDED_MILESTONE_OUTCOME &&
          JSON.stringify(workItem.definitionOfDone) ===
            JSON.stringify(APPENDED_DEFINITION_OF_DONE) &&
          workItem.status === "planned" &&
          Array.isArray(workItem.attempts) &&
          workItem.attempts.length === 0 &&
          typeof workItem.createdAt === "string" &&
          workItem.createdAt === workItem.updatedAt &&
          Number.isFinite(Date.parse(workItem.createdAt));
        const updatedWorkspace = exactWorkItem
          ? appendSyntheticWorkspaceWorkItem(
              workspace,
              mutation,
              new Date().toISOString(),
            )
          : null;
        fixtureState.milestoneAppendRequests.push({
          expectedRevision: body.expectedRevision,
          acceptedRevision,
          mutationId: body.mutationId,
          type: mutation.type,
          projectId: mutation.projectId,
          objectiveId: mutation.objectiveId,
          workItem:
            workItem && typeof workItem === "object"
              ? {
                  ...workItem,
                  attempts: Array.isArray(workItem.attempts)
                    ? [...workItem.attempts]
                    : workItem.attempts,
                }
              : workItem,
        });
        if (
          mutation.projectId !== PRIMARY_PROJECT_ID ||
          mutation.objectiveId !== REVIEW_OBJECTIVE_ID ||
          !updatedWorkspace ||
          body.expectedRevision !== acceptedRevision ||
          typeof body.mutationId !== "string" ||
          body.mutationId.length === 0
        ) {
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error:
                "Synthetic acceptance fixture rejected an invalid appended milestone.",
              code: "invalid_appended_milestone",
              persistence: { persistent: true },
            }),
          });
        }
        workspace = updatedWorkspace;
        fixtureState.workspaceWriteCount += 1;
        fixtureState.milestoneAppendWriteCount += 1;
      } else if (mutation?.type === "attention.event") {
        const currentDecisionEventKeys = new Set(
          workspace.decisionRequests
            .filter((request) => !request.resolvedAt)
            .map((request) => `decision-request:${request.id}`),
        );
        if (
          (acceptedSeenEventKeys.has(mutation.eventKey) ||
            currentDecisionEventKeys.has(mutation.eventKey)) &&
          mutation.disposition?.kind === "needs_review" &&
          typeof mutation.disposition.at === "string" &&
          Number.isFinite(Date.parse(mutation.disposition.at)) &&
          mutation.snoozedUntil === null
        ) {
          workspace = {
            ...workspace,
            revision: workspace.revision + 1,
            updatedAt: mutation.disposition.at,
            attentionReview: {
              ...workspace.attentionReview,
              dispositions: {
                ...workspace.attentionReview.dispositions,
                [mutation.eventKey]: { ...mutation.disposition },
              },
            },
          };
          fixtureState.workspaceWriteCount += 1;
          fixtureState.attentionSeenWriteCount += 1;
          fixtureState.seenAttentionEventKeys.push(mutation.eventKey);
        } else if (
          mutation.eventKey === initialResultKey.id &&
          mutation.disposition?.kind === "reviewed" &&
          mutation.snoozedUntil === null &&
          workspaceResultIsReviewed(workspace, initialResultKey)
        ) {
          fixtureState.attentionEventFailureCount += 1;
          fixtureState.failedAttentionEventKeys.push(mutation.eventKey);
          fixtureState.failedAttentionDispositionKinds.push(
            mutation.disposition.kind,
          );
          fixtureState.reviewedAttentionArrivedAfterResultReview = true;
          return route.fulfill({
            status: 503,
            headers: {
              "x-coffice-synthetic-expected-failure": "attention-event",
            },
            contentType: "application/json",
            body: JSON.stringify({
              error:
                "Synthetic acceptance fixture deliberately rejected the reviewed Attention receipt.",
              code: "synthetic_attention_unavailable",
              persistence: { persistent: true },
            }),
          });
        } else {
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error:
                "Synthetic acceptance fixture rejected an unexpected Attention receipt.",
              code: "unexpected_attention_mutation",
              persistence: { persistent: true },
            }),
          });
        }
      } else {
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Synthetic acceptance fixture rejected an unexpected write.",
            code: "unexpected_mutation",
            persistence: { persistent: true },
          }),
        });
      }
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspace,
        recovery: workspaceRecovery,
        persistence: { persistent: workspacePersistent },
      }),
    });
  });
  if (options.multiRootHarness || options.savedResultComparisonHarness) {
    await page.route("**/api/verifications**", async (route) => {
      const request = route.request();
      fixtureState.verificationRouteRequests.push({
        method: request.method(),
        url: request.url(),
      });
      if (request.method() !== "GET") {
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Synthetic read-only fixture rejected a verification write.",
            code: "unexpected_read_only_verification_mutation",
          }),
        });
      }
      const comparisonReceipt = options.savedResultComparisonHarness
        ? fixtureState.savedComparisonLiveVerification()
        : null;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store, max-age=0" },
        body: JSON.stringify({
          profiles: comparisonReceipt
            ? [
                {
                  id: "test",
                  version: "1",
                  label: "Tests",
                  description: "Runs the trusted project test profile.",
                  eligible: true,
                },
              ]
            : [],
          receipts: comparisonReceipt ? [comparisonReceipt] : [],
          operations: [],
        }),
      });
    });
    await page.route("**/api/codex-actions", async (route) => {
      fixtureState.syntheticCodexActionRouteCount += 1;
      fixtureState.codexRouteRequests.push({
        method: route.request().method(),
        url: route.request().url(),
      });
      if (route.request().method() !== "GET") {
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Synthetic read-only fixture rejected a Codex action.",
            code: "unexpected_read_only_codex_mutation",
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store, max-age=0" },
        body: JSON.stringify({ operations: [] }),
      });
    });
  }
  if (options.failedCheckRepairHarness) {
    await page.route("**/api/verifications**", async (route) => {
      const request = route.request();
      fixtureState.verificationRouteRequests.push({
        method: request.method(),
        url: request.url(),
      });
      if (request.method() !== "GET") {
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error:
              "Synthetic repair acceptance rejected a verification mutation.",
            code: "unexpected_synthetic_verification_mutation",
          }),
        });
      }
      const receipts = liveVerificationReceipts.map((receipt) => ({
        id: receipt.id,
        target: structuredClone(receipt.target),
        profile: { ...receipt.profile },
        checks: receipt.checks.map((check) => ({ ...check })),
        state: receipt.state,
        queuedAt: receipt.queuedAt,
        ...(receipt.startedAt ? { startedAt: receipt.startedAt } : {}),
        ...(receipt.completedAt ? { completedAt: receipt.completedAt } : {}),
      }));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store, max-age=0" },
        body: JSON.stringify({
          profiles: [
            {
              id: "test",
              version: "1",
              label: "Tests",
              description: "Runs the trusted project test profile.",
              eligible: true,
            },
            {
              id: "lint",
              version: "3",
              label: "Lint",
              description: "Runs the trusted project lint profile.",
              eligible: true,
            },
            {
              id: "build",
              version: "2",
              label: "Production build",
              description: "Runs the trusted production build profile.",
              eligible: true,
            },
          ],
          receipts,
          operations: [],
        }),
      });
    });
  }
  if (options.currentPlanContextHarness || options.failedCheckRepairHarness) {
    await page.route("**/api/codex-actions", async (route) => {
      fixtureState.syntheticCodexActionRouteCount += 1;
      const request = route.request();
      if (request.method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Cache-Control": "no-store, max-age=0" },
          body: JSON.stringify({ operations: syntheticCodexOperations }),
        });
      }
      if (request.method() !== "POST") {
        return route.fulfill({
          status: 405,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic method rejected." }),
        });
      }
      const body = request.postDataJSON();
      syntheticCodexActionBodies.push(structuredClone(body));
      const exactShape = hasExactObjectKeys(body, [
        "action",
        "taskId",
        "text",
        "idempotencyKey",
        "confirmed",
        "confirmationToken",
      ]);
      if (
        !exactShape ||
        body.action !== "send_follow_up" ||
        body.taskId !== REVIEW_TASK_ID ||
        typeof body.text !== "string" ||
        typeof body.idempotencyKey !== "string" ||
        body.idempotencyKey.length === 0 ||
        body.confirmed !== true ||
        body.confirmationToken !== "CONFIRM_SEND"
      ) {
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Synthetic acceptance fixture rejected a Codex action.",
            code: "invalid_synthetic_codex_action",
          }),
        });
      }
      const now = new Date().toISOString();
      syntheticCodexOperations = [
        {
          id: "synthetic-current-context-operation",
          kind: "send_follow_up",
          taskId: REVIEW_TASK_ID,
          state: "running",
          createdAt: now,
          updatedAt: now,
        },
      ];
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store, max-age=0" },
        body: JSON.stringify({ operation: syntheticCodexOperations[0] }),
      });
    });
  }
  return fixtureState;
}

async function enterProjectOffice(page, projectId, expectedTaskCount) {
  await page.goto(assertLocalAcceptanceUrl(BASE_URL), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForSelector("main", { timeout: 30_000 });
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector('[data-product-office-renderer="topdown"]') ||
        document.querySelector(".project-building"),
      ),
    undefined,
    { timeout: 30_000 },
  );
  const projectOffice = page.locator(
    `[data-product-office-renderer="topdown"][data-project-id="${projectId}"]`,
  );
  if ((await projectOffice.count()) === 0) {
    if ((await page.locator(".campus").count()) === 0) {
      await page
        .getByRole("button", { name: "Coffice campus map", exact: true })
        .click();
    }
    const projectDoor = page.locator(
      `.project-building[data-project-id="${projectId}"]`,
    );
    await projectDoor.waitFor({ state: "visible", timeout: 30_000 });
    await projectDoor.click();
  }
  await projectOffice.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForSelector('[data-topdown-room="true"]', {
    state: "visible",
    timeout: 30_000,
  });
  await page.waitForFunction(
    (expected) =>
      document.querySelectorAll("[data-desk-state]").length === expected &&
      document.querySelectorAll("[data-agent-state]").length === expected,
    expectedTaskCount,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(80);
}

async function enterTopDownOffice(page) {
  await enterProjectOffice(page, PRIMARY_PROJECT_ID, PRIMARY_TASK_COUNT);
}

async function inspectSettledWorkflowAreas(
  page,
  expectedAssignments,
  fixtureState,
) {
  await page.waitForFunction(
    (expected) => {
      const actors = Array.from(
        document.querySelectorAll("[data-agent-state]"),
      );
      return Object.entries(expected).every(([name, area]) => {
        const actor = actors.find((candidate) =>
          candidate.getAttribute("aria-label")?.startsWith(`${name}, `),
        );
        return (
          actor?.getAttribute("data-desired-area") === area &&
          actor.getAttribute("data-settled-area") === area &&
          !actor.hasAttribute("data-heading-area") &&
          actor.getAttribute("data-motion-phase") !== "walking"
        );
      });
    },
    expectedAssignments,
    { timeout: 12_000 },
  );

  const snapshot = await page.evaluate((expected) => {
    const room = document.querySelector('[data-topdown-room="true"]');
    const roomBounds = room?.getBoundingClientRect();
    const actors = Array.from(document.querySelectorAll("[data-agent-state]"));
    const assignments = Object.fromEntries(
      Object.keys(expected).map((name) => {
        const actor = actors.find((candidate) =>
          candidate.getAttribute("aria-label")?.startsWith(`${name}, `),
        );
        return [
          name,
          actor
            ? {
                desired: actor.getAttribute("data-desired-area"),
                heading: actor.getAttribute("data-heading-area"),
                settled: actor.getAttribute("data-settled-area"),
                motion: actor.getAttribute("data-motion-phase"),
                assignedDesk: actor.getAttribute("data-assigned-desk"),
                atHome: actor.getAttribute("data-at-home"),
              }
            : null,
        ];
      }),
    );
    const zones = Object.fromEntries(
      ["meeting", "review"].map((area) => {
        const element = document.querySelector(
          `[data-workflow-area="${area}"]`,
        );
        const bounds = element?.getBoundingClientRect();
        return [
          area,
          {
            exists: Boolean(element),
            title: element?.children[0]?.textContent?.trim() ?? null,
            purpose: element?.children[1]?.textContent?.trim() ?? null,
            assignedCount: element?.getAttribute(
              "data-workflow-assigned-count",
            ),
            withinRoom: Boolean(
              bounds &&
              roomBounds &&
              bounds.left >= roomBounds.left - 1 &&
              bounds.top >= roomBounds.top - 1 &&
              bounds.right <= roomBounds.right + 1 &&
              bounds.bottom <= roomBounds.bottom + 1,
            ),
          },
        ];
      }),
    );
    return { assignments, zones };
  }, expectedAssignments);

  return {
    ...snapshot,
    workspaceWriteCount: fixtureState.workspaceWriteCount,
    codexMutationCount: fixtureState.codexRouteRequests.filter(
      (request) => request.method !== "GET" && request.method !== "HEAD",
    ).length,
  };
}

async function waitForLocatorFocus(page, locator) {
  const element = await locator.elementHandle();
  if (!element) return false;
  try {
    await page.waitForFunction(
      (candidate) => document.activeElement === candidate,
      element,
      { timeout: 5_000 },
    );
    return true;
  } catch {
    return false;
  } finally {
    await element.dispose();
  }
}

async function waitForTextareaFocusAndCaretAtEnd(page, locator) {
  const element = await locator.elementHandle();
  if (!element) return false;
  try {
    await page.waitForFunction(
      (candidate) =>
        candidate instanceof HTMLTextAreaElement &&
        document.activeElement === candidate &&
        candidate.selectionStart === candidate.value.length &&
        candidate.selectionEnd === candidate.value.length,
      element,
      { timeout: 5_000 },
    );
    return true;
  } catch {
    return false;
  } finally {
    await element.dispose();
  }
}

async function waitForTextareaValues(page, container, expected) {
  const element = await container.elementHandle();
  if (!element) return false;
  try {
    const waitForValues = () =>
      page.waitForFunction(
        ({ root, values }) =>
          JSON.stringify(
            Array.from(root.querySelectorAll("textarea"), (textarea) =>
              textarea instanceof HTMLTextAreaElement ? textarea.value : "",
            ),
          ) === JSON.stringify(values),
        { root: element, values: expected },
        { timeout: 5_000 },
      );
    await waitForValues();
    // A controlled textarea receives the browser value before React commits the
    // corresponding state update. Wait through two paints and assert again so
    // the next click cannot observe the preceding render's draft.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await waitForValues();
    return true;
  } catch {
    return false;
  } finally {
    await element.dispose();
  }
}

async function captureWorkflowAreaView(page, areaId) {
  const previous = await page.evaluate((workflowAreaId) => {
    const stage = document.querySelector("[data-world-scale]");
    const viewport = stage?.parentElement;
    if (!viewport) return null;
    const scale = Number(stage.getAttribute("data-world-scale")) || 1;
    const workflowArea = document.querySelector(
      `[data-workflow-area="${workflowAreaId}"]`,
    );
    const state = {
      documentX: window.scrollX,
      documentY: window.scrollY,
      viewportX: viewport.scrollLeft,
      viewportY: viewport.scrollTop,
    };
    viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight;
    viewport.scrollLeft = Math.max(
      0,
      (workflowArea?.offsetLeft ?? 0) * scale - 12,
    );
    viewport.scrollIntoView({ block: "center", inline: "nearest" });
    return state;
  }, areaId);
  await page.waitForTimeout(150);
  const screenshot = await page.screenshot({ fullPage: false });
  await page.evaluate((state) => {
    const stage = document.querySelector("[data-world-scale]");
    const viewport = stage?.parentElement;
    if (viewport && state) {
      viewport.scrollTop = state.viewportY;
      viewport.scrollLeft = state.viewportX;
    }
    if (state) window.scrollTo(state.documentX, state.documentY);
  }, previous);
  if (previous) {
    await page.waitForFunction(
      (state) =>
        Math.abs(window.scrollX - state.documentX) <= 1 &&
        Math.abs(window.scrollY - state.documentY) <= 1,
      previous,
      { timeout: 5_000 },
    );
  }
  return screenshot;
}

function attentionToggle(page) {
  return page.locator('button[aria-controls="attention-inbox"]');
}

async function openCampus(page) {
  const campus = page.locator(".campus");
  const deadline = Date.now() + 12_000;
  while (!(await campus.isVisible()) && Date.now() < deadline) {
    const office = page.locator(
      '[data-product-office-renderer="topdown"]:visible',
    );
    if ((await office.count()) > 0) {
      await office
        .getByRole("button", { name: "← Back", exact: true })
        .click({ timeout: 2_000 })
        .catch(() => undefined);
    } else {
      await page
        .getByRole("button", { name: "Coffice campus map", exact: true })
        .click({ timeout: 2_000 })
        .catch(() => undefined);
    }
    await page.waitForTimeout(150);
  }
  await campus.waitFor({ state: "visible", timeout: 1_000 });
  return campus;
}

async function enterProjectFromCampus(page, projectId, expectedTaskCount) {
  const campus = await openCampus(page);
  const door = campus.locator(
    `.project-building[data-project-id="${projectId}"]`,
  );
  await door.waitFor({ state: "visible", timeout: 5_000 });
  await door.click();
  const office = page.locator(
    `[data-product-office-renderer="topdown"][data-project-id="${projectId}"]`,
  );
  await office.waitFor({ state: "visible", timeout: 5_000 });
  await page.waitForFunction(
    (expected) =>
      document.querySelectorAll("[data-desk-state]").length === expected &&
      document.querySelectorAll("[data-agent-state]").length === expected,
    expectedTaskCount,
    { timeout: 5_000 },
  );
  await page.waitForTimeout(80);
}

async function waitForSnapshotRefresh(page) {
  await page.waitForResponse(
    (response) =>
      response.status() === 200 &&
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/snapshot",
    { timeout: 5_000 },
  );
}

async function inspectAttentionTransitionCue(page, cue) {
  return cue.evaluate((rail) => {
    const header = document.querySelector(".app-bar");
    const region = rail.querySelector('[role="region"]');
    const primary = rail.querySelector("button:not([aria-label])");
    const close = rail.querySelector(
      'button[aria-label="Hide new Attention cues"]',
    );
    const status = document.querySelector(
      '[data-attention-transition-announcement="true"]',
    );
    const railBounds = rail.getBoundingClientRect();
    const headerBounds = header?.getBoundingClientRect();
    const primaryBounds = primary?.getBoundingClientRect();
    const closeBounds = close?.getBoundingClientRect();
    const allElements = [rail, ...rail.querySelectorAll("*")];
    const motionless = allElements.every((element) => {
      const style = getComputedStyle(element);
      const durations = `${style.animationDuration},${style.transitionDuration}`
        .split(",")
        .map((duration) => Number.parseFloat(duration) || 0);
      return (
        style.animationName === "none" &&
        durations.every((value) => value === 0)
      );
    });
    return {
      count: document.querySelectorAll('[data-attention-transition-cue="true"]')
        .length,
      text: rail.textContent?.replace(/\s+/gu, " ").trim() ?? "",
      announcement: status?.textContent?.replace(/\s+/gu, " ").trim() ?? "",
      regionRole: region?.getAttribute("role"),
      live: status?.getAttribute("aria-live"),
      atomic: status?.getAttribute("aria-atomic"),
      inFlow:
        getComputedStyle(rail).position !== "fixed" &&
        getComputedStyle(region).position !== "fixed",
      belowHeader: headerBounds
        ? railBounds.top >= headerBounds.bottom - 1
        : false,
      withinViewport:
        railBounds.left >= -1 &&
        railBounds.right <= innerWidth + 1 &&
        railBounds.top >= -1,
      noHorizontalOverflow:
        document.documentElement.scrollWidth <= innerWidth + 1 &&
        rail.scrollWidth <= rail.clientWidth + 1,
      primaryHeight: primaryBounds?.height ?? 0,
      closeWidth: closeBounds?.width ?? 0,
      closeHeight: closeBounds?.height ?? 0,
      primaryFontSize: primary
        ? Number.parseFloat(getComputedStyle(primary).fontSize)
        : 0,
      identityFontSize: rail.querySelector("strong")
        ? Number.parseFloat(
            getComputedStyle(rail.querySelector("strong")).fontSize,
          )
        : 0,
      motionless,
    };
  });
}

async function auditAttentionTransitionCue(
  page,
  screenshots,
  viewportId,
  fixtureState,
) {
  await enterTopDownOffice(page);
  await waitForAttentionCount(page, PRIMARY_ATTENTION_COUNT);
  const cue = page.locator('[data-attention-transition-cue="true"]');
  await page.waitForTimeout(500);
  const baselineSilent = (await cue.count()) === 0;
  const writesAtBaseline = fixtureState.workspaceWriteCount;
  const codexMutationsAtBaseline = fixtureState.codexRouteRequests.filter(
    (request) => request.method !== "GET" && request.method !== "HEAD",
  ).length;
  const brand = page.getByRole("button", {
    name: "Coffice campus map",
    exact: true,
  });
  await brand.focus();

  const firstBatch = fixtureState.publishTaskTransitions([
    { taskId: BLOCKED_TASK_ID, value: "waiting_for_user" },
    { taskId: FAILED_TASK_ID, value: "blocked" },
  ]);
  await waitForSnapshotRefresh(page);
  await cue.waitFor({ state: "visible", timeout: 5_000 });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-attention-transition-announcement="true"]')
        ?.textContent?.includes("Acceptance Agent 03") === true,
    undefined,
    { timeout: 5_000 },
  );
  const focusNotStolen = await waitForLocatorFocus(page, brand);
  const initial = await inspectAttentionTransitionCue(page, cue);
  screenshots.set(
    `${viewportId}-attention-transition-cue`,
    await page.screenshot({ fullPage: false }),
  );

  const writesBeforeModal = fixtureState.workspaceWriteCount;
  const codexMutationsBeforeModal = fixtureState.codexRouteRequests.filter(
    (request) => request.method !== "GET" && request.method !== "HEAD",
  ).length;
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  const projects = page.getByRole("dialog", { name: "Projects", exact: true });
  await projects.waitFor({ state: "visible", timeout: 5_000 });
  await cue.waitFor({ state: "detached", timeout: 5_000 });
  const suppressedByModal = (await cue.count()) === 0;
  const announcement = page.locator(
    '[data-attention-transition-announcement="true"]',
  );
  await page.waitForFunction(
    () =>
      document.querySelector('[data-attention-transition-announcement="true"]')
        ?.textContent === "",
    undefined,
    { timeout: 5_000 },
  );
  await projects.getByRole("button", { name: "Close projects" }).click();
  await projects.waitFor({ state: "detached", timeout: 5_000 });
  await cue.waitFor({ state: "visible", timeout: 5_000 });
  await page.waitForTimeout(80);
  const modalResumeStayedSilent = (await announcement.textContent()) === "";
  const firstItemStable = (await cue.textContent())?.includes(
    "Acceptance Agent 03",
  );

  await cue
    .getByRole("button", { name: "Hide new Attention cues", exact: true })
    .click();
  await cue.waitFor({ state: "detached", timeout: 5_000 });
  const closeRestoredFocus = await waitForLocatorFocus(page, brand);
  const closeHadNoWrites =
    fixtureState.workspaceWriteCount === writesBeforeModal &&
    fixtureState.codexRouteRequests.filter(
      (request) => request.method !== "GET" && request.method !== "HEAD",
    ).length === codexMutationsBeforeModal;

  const [holdingEvent] = fixtureState.publishTaskTransitions([
    { taskId: HOLDING_TASK_ID, value: "waiting_for_user" },
  ]);
  const failedVerification = fixtureState.publishFailedVerification();
  await waitForSnapshotRefresh(page);
  await cue.waitFor({ state: "visible", timeout: 5_000 });
  const holdingText = (await cue.textContent())?.replace(/\s+/gu, " ") ?? "";
  const oldBatchDidNotCascade = firstBatch.every(
    ({ taskTitle }) => !holdingText.includes(taskTitle),
  );
  const holdingRouteReceipt = page.waitForResponse(
    (response) => {
      if (
        response.status() !== 200 ||
        response.request().method() !== "PATCH"
      ) {
        return false;
      }
      const mutation = response.request().postDataJSON()?.mutation;
      return (
        mutation?.type === "attention.event" &&
        mutation.eventKey === holdingEvent.eventKey &&
        mutation.disposition?.kind === "needs_review"
      );
    },
    { timeout: 5_000 },
  );
  await cue.getByRole("button", { name: "Open task", exact: true }).click();
  await holdingRouteReceipt;
  const holdingOffice = page.locator(
    `[data-product-office-renderer="topdown"][data-project-id="${HOLDING_PROJECT_ID}"]`,
  );
  await holdingOffice.waitFor({ state: "visible", timeout: 5_000 });
  const holdingInspector = page.locator('[data-review-act-inspector="true"]');
  await holdingInspector.waitFor({ state: "visible", timeout: 5_000 });
  await waitForAttentionCount(page, 1);
  const holdingTriggerAfterSeen = await readAttentionTrigger(
    attentionToggle(page),
  );
  const exactHoldingRoute =
    (await holdingInspector.getByRole("heading", { level: 2 }).textContent())
      ?.replace(/\s+/gu, " ")
      .trim() === "Holding Agent 01";
  const cueSuppressedByInspector = (await cue.count()) === 0;
  await holdingInspector
    .getByRole("button", { name: "Close review inspector", exact: true })
    .click();
  await holdingInspector.waitFor({ state: "detached", timeout: 5_000 });

  await cue.waitFor({ state: "visible", timeout: 5_000 });
  const verificationText =
    (await cue.textContent())?.replace(/\s+/gu, " ") ?? "";
  const verificationRouteReceipt = page.waitForResponse(
    (response) => {
      if (
        response.status() !== 200 ||
        response.request().method() !== "PATCH"
      ) {
        return false;
      }
      const mutation = response.request().postDataJSON()?.mutation;
      return (
        mutation?.type === "attention.event" &&
        mutation.eventKey === failedVerification.eventKey &&
        mutation.disposition?.kind === "needs_review"
      );
    },
    { timeout: 5_000 },
  );
  await cue
    .getByRole("button", { name: "Open stored result", exact: true })
    .click();
  await verificationRouteReceipt;
  const planner = page.locator('[data-work-planner="true"]');
  await planner.waitFor({ state: "visible", timeout: 5_000 });
  const storedResult = planner.locator('[data-stored-result-context="true"]');
  await storedResult.waitFor({ state: "visible", timeout: 5_000 });
  const exactStoredResultRoute =
    (await planner.getByRole("heading", { level: 2 }).textContent())
      ?.replace(/\s+/gu, " ")
      .trim() === "Acceptance Office" &&
    (await storedResult.getAttribute("aria-labelledby")) ===
      "stored-result-heading" &&
    (await storedResult
      .locator('[data-stored-verification-state="failed"]')
      .count()) === 1 &&
    (await storedResult.evaluate(
      (element) => document.activeElement === element,
    ));
  await planner
    .getByRole("button", { name: "Close project plan", exact: true })
    .click();
  await planner.waitFor({ state: "detached", timeout: 5_000 });

  return {
    baselineSilent,
    baselineWorkspaceWriteCount: writesAtBaseline,
    baselineCodexMutationCount: codexMutationsAtBaseline,
    focusNotStolen,
    initial,
    firstBatchEventKeys: firstBatch.map(({ eventKey }) => eventKey),
    firstItemStable,
    suppressedByModal,
    modalResumeStayedSilent,
    closeRestoredFocus,
    closeHadNoWrites,
    oldBatchDidNotCascade,
    holdingCopy: holdingText,
    exactHoldingRoute,
    holdingTriggerAfterSeen,
    cueSuppressedByInspector,
    verificationCopy: verificationText,
    exactStoredResultRoute,
    workspaceWriteCount: fixtureState.workspaceWriteCount,
    cueWorkspaceWriteCount: fixtureState.workspaceWriteCount - writesAtBaseline,
    attentionSeenWriteCount: fixtureState.attentionSeenWriteCount,
    seenAttentionEventKeys: [...fixtureState.seenAttentionEventKeys],
    expectedSeenEventKeys: [holdingEvent.eventKey, failedVerification.eventKey],
    codexMutationCount: fixtureState.codexRouteRequests.filter(
      (request) => request.method !== "GET" && request.method !== "HEAD",
    ).length,
  };
}

async function readProjectAttentionRows(root) {
  return Object.fromEntries(
    await root
      .locator("button[data-project-id][data-attention-count]")
      .evaluateAll((rows) =>
        rows.map((row) => [
          row.getAttribute("data-project-id"),
          {
            count: row.getAttribute("data-attention-count"),
            needsReplyCount: row.getAttribute("data-needs-reply-count"),
            needsDecisionCount: row.getAttribute("data-needs-decision-count"),
            unreadResultCount: row.getAttribute("data-unread-result-count"),
            text: row.textContent?.replace(/\s+/gu, " ").trim() ?? "",
            ariaLabel: row.getAttribute("aria-label"),
          },
        ]),
      ),
  );
}

async function inspectAttentionPanelContainment(inbox) {
  return inbox.evaluate((surface) => {
    const bounds = surface.getBoundingClientRect();
    const items = Array.from(surface.querySelectorAll("[data-attention-item]"));
    return {
      panelWithinViewport:
        bounds.left >= -1 &&
        bounds.right <= innerWidth + 1 &&
        bounds.top >= -1 &&
        bounds.bottom <= innerHeight + 1,
      noHorizontalOverflow:
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1 &&
        surface.scrollWidth <= surface.clientWidth + 1 &&
        items.every((item) => item.scrollWidth <= item.clientWidth + 1),
    };
  });
}

async function readAttentionTrigger(toggle) {
  return {
    label: await toggle.getAttribute("aria-label"),
    projectId: await toggle.getAttribute("data-project-id"),
    count: await toggle.getAttribute("data-attention-count"),
    needsReplyCount: await toggle.getAttribute("data-needs-reply-count"),
    needsDecisionCount: await toggle.getAttribute("data-needs-decision-count"),
    unreadResultCount: await toggle.getAttribute("data-unread-result-count"),
    badge: (await toggle.locator('[aria-hidden="true"]').last().innerText())
      .replace(/\s+/gu, " ")
      .trim(),
  };
}

async function waitForAttentionCount(page, expectedCount) {
  await page.waitForFunction(
    (expected) =>
      document
        .querySelector('button[aria-controls="attention-inbox"]')
        ?.getAttribute("data-attention-count") === String(expected),
    expectedCount,
    { timeout: 5_000 },
  );
}

async function auditProjectDrawer(page, fixtureState = null) {
  const workspaceWritesBefore = fixtureState?.workspaceWriteCount ?? 0;
  const codexMutationsBefore =
    fixtureState?.codexRouteRequests.filter(
      (request) => request.method !== "GET" && request.method !== "HEAD",
    ).length ?? 0;
  const toggle = page.getByRole("button", { name: "Projects", exact: true });
  await toggle.focus();
  await toggle.click();
  const drawer = page.getByRole("dialog", { name: "Projects", exact: true });
  await drawer.waitFor({ state: "visible", timeout: 5_000 });
  const search = drawer.getByRole("searchbox", { name: "Search projects" });
  const evidence = {
    opened: await drawer.isVisible(),
    modal:
      (await drawer.getAttribute("role")) === "dialog" &&
      (await drawer.getAttribute("aria-modal")) === "true",
    initialFocusOnSearch: await search.evaluate(
      (element) => document.activeElement === element,
    ),
    shellInert: await page
      .locator(".app-shell")
      .evaluate(
        (shell) => shell.inert && shell.getAttribute("aria-hidden") === "true",
      ),
    currentProjectCount: await drawer.locator('[aria-current="page"]').count(),
    projectCount: await drawer.locator("button[data-project-id]").count(),
    projectRows: await readProjectAttentionRows(drawer),
    searchVisible: await search.isVisible(),
    countContainment: await drawer.evaluate((surface) => {
      const bounds = surface.getBoundingClientRect();
      const rows = Array.from(
        surface.querySelectorAll(
          "button[data-attention-count][data-needs-reply-count][data-needs-decision-count][data-unread-result-count]",
        ),
      );
      return {
        rowCount: rows.length,
        panelWithinViewport:
          bounds.left >= -1 && bounds.right <= innerWidth + 1,
        noHorizontalOverflow:
          surface.scrollWidth <= surface.clientWidth + 1 &&
          rows.every((row) => {
            const rowBounds = row.getBoundingClientRect();
            return (
              row.scrollWidth <= row.clientWidth + 1 &&
              rowBounds.left >= bounds.left - 1 &&
              rowBounds.right <= bounds.right + 1
            );
          }),
      };
    }),
  };
  evidence.focusTrap = await auditFocusTrap(page, drawer);
  await page.keyboard.press("Tab");
  evidence.focusWrapped = await drawer.evaluate((surface) => {
    const first = Array.from(
      surface.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ).find((control) => control.getClientRects().length > 0);
    return document.activeElement === first;
  });
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "detached", timeout: 5_000 });
  await page.waitForFunction(
    () => document.activeElement?.textContent?.trim() === "Projects",
  );
  evidence.closed = true;
  evidence.focusRestored = await toggle.evaluate(
    (element) => document.activeElement === element,
  );
  evidence.noWorkspaceWrites =
    fixtureState === null ||
    fixtureState.workspaceWriteCount === workspaceWritesBefore;
  evidence.noCodexMutations =
    fixtureState === null ||
    fixtureState.codexRouteRequests.filter(
      (request) => request.method !== "GET" && request.method !== "HEAD",
    ).length === codexMutationsBefore;
  return evidence;
}

async function auditLoadingAttentionCounts(
  page,
  screenshots,
  viewportId,
  fixtureState,
) {
  const workspaceWritesBefore = fixtureState.workspaceWriteCount;
  const codexMutationsBefore = fixtureState.codexRouteRequests.filter(
    (request) => request.method !== "GET" && request.method !== "HEAD",
  ).length;
  await page.goto(assertLocalAcceptanceUrl(BASE_URL), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForSelector("main", { timeout: 30_000 });
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector('[data-product-office-renderer="topdown"]') ||
        document.querySelector(".project-building"),
      ),
    undefined,
    { timeout: 30_000 },
  );
  const campus = await openCampus(page);
  const campusRows = await readProjectAttentionRows(campus);
  const campusCountContainment = await campus.evaluate((surface) => {
    const controls = Array.from(
      surface.querySelectorAll(
        "button[data-attention-count][data-needs-reply-count][data-needs-decision-count][data-unread-result-count]",
      ),
    );
    return {
      controlCount: controls.length,
      noHorizontalOverflow:
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1 &&
        controls.every((control) => {
          const bounds = control.getBoundingClientRect();
          return (
            control.scrollWidth <= control.clientWidth + 1 &&
            bounds.left >= -1 &&
            bounds.right <= innerWidth + 1
          );
        }),
    };
  });
  const digestToggle = page.getByRole("button", {
    name: "Digest is loading",
    exact: true,
  });
  await digestToggle.waitFor({ state: "visible", timeout: 5_000 });
  const digestTrigger = {
    disabled: await digestToggle.isDisabled(),
    count: await digestToggle.getAttribute("data-attention-count"),
    needsReplyCount: await digestToggle.getAttribute("data-needs-reply-count"),
    unreadResultCount: await digestToggle.getAttribute(
      "data-unread-result-count",
    ),
  };

  await enterProjectFromCampus(page, PRIMARY_PROJECT_ID, PRIMARY_TASK_COUNT);
  const officeTrigger = await readAttentionTrigger(attentionToggle(page));
  const drawer = await auditProjectDrawer(page, fixtureState);
  const officeCountContained = await attentionToggle(page).evaluate(
    (control) => {
      const bounds = control.getBoundingClientRect();
      return (
        bounds.left >= -1 &&
        bounds.right <= innerWidth + 1 &&
        control.scrollWidth <= control.clientWidth + 1
      );
    },
  );
  screenshots.set(
    `${viewportId}-attention-counts-loading`,
    await page.screenshot({ fullPage: false }),
  );

  fixtureState.releaseWorkspace();
  await waitForAttentionCount(page, PRIMARY_ATTENTION_COUNT);
  const resolvedOfficeTrigger = await readAttentionTrigger(
    attentionToggle(page),
  );
  return {
    campusRows,
    campusCountContainment,
    digestTrigger,
    officeTrigger,
    officeCountContained,
    drawer,
    resolvedOfficeTrigger,
    noWorkspaceWrites:
      fixtureState.workspaceWriteCount === workspaceWritesBefore,
    noCodexMutations:
      fixtureState.codexRouteRequests.filter(
        (request) => request.method !== "GET" && request.method !== "HEAD",
      ).length === codexMutationsBefore,
  };
}

async function auditFocusTrap(page, panel) {
  return panel.evaluate((surface) => {
    const controls = Array.from(
      surface.querySelectorAll(
        'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((control) => control.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    last?.focus();
    return {
      count: controls.length,
      firstLabel:
        first?.getAttribute("aria-label") ?? first?.textContent?.trim() ?? null,
      lastLabel:
        last?.getAttribute("aria-label") ?? last?.textContent?.trim() ?? null,
    };
  });
}

async function inspectAssessmentCard(card) {
  return card.evaluate((surface) => {
    const bounds = surface.getBoundingClientRect();
    const form = surface.querySelector("form");
    const savedDetails = surface.querySelector("details");
    const controls = Array.from(
      surface.querySelectorAll("button, textarea, select"),
    ).filter((control) => control.getClientRects().length > 0);
    return {
      scope: surface.querySelector("header span")?.textContent?.trim() ?? null,
      state: surface.querySelector("header b")?.textContent?.trim() ?? null,
      height: bounds.height,
      formVisible: Boolean(form),
      savedDetailsCount: savedDetails ? 1 : 0,
      savedDetailsOpen: savedDetails?.hasAttribute("open") ?? false,
      controlCount: controls.length,
      noHorizontalOverflow:
        surface.scrollWidth <= surface.clientWidth + 1 &&
        controls.every((control) => {
          const controlBounds = control.getBoundingClientRect();
          return (
            control.scrollWidth <= control.clientWidth + 1 &&
            controlBounds.left >= bounds.left - 1 &&
            controlBounds.right <= bounds.right + 1
          );
        }),
      withinViewportWidth: bounds.left >= -1 && bounds.right <= innerWidth + 1,
    };
  });
}

async function codexMutationCount(fixtureState) {
  return fixtureState.codexRouteRequests.filter(
    (request) => request.method !== "GET" && request.method !== "HEAD",
  ).length;
}

async function waitForFixtureCondition(predicate, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function openFailedCheckRepairComposer(page) {
  await enterTopDownOffice(page);
  const openReviewTask = page.getByRole("button", {
    name: `Review ${REVIEW_TASK_TITLE}, Completed`,
    exact: true,
  });
  await openReviewTask.scrollIntoViewIfNeeded();
  await openReviewTask.click();
  const inspector = page.locator('[data-review-act-inspector="true"]');
  await inspector.waitFor({ state: "visible", timeout: 5_000 });
  const sendFollowUp = inspector.getByRole("button", {
    name: "Send follow-up",
    exact: true,
  });
  await sendFollowUp.scrollIntoViewIfNeeded();
  await sendFollowUp.click();
  const textarea = inspector.getByRole("textbox", {
    name: "Follow-up instruction",
    exact: true,
  });
  await textarea.waitFor({ state: "visible", timeout: 5_000 });
  return {
    inspector,
    sendFollowUp,
    textarea,
    repairInsertion: inspector.locator('[data-repair-follow-up-insert="true"]'),
  };
}

async function closeFailedCheckRepairInspector(page, inspector, sendFollowUp) {
  await page.keyboard.press("Escape");
  await sendFollowUp.waitFor({ state: "visible", timeout: 5_000 });
  await page.keyboard.press("Escape");
  await inspector.waitFor({ state: "detached", timeout: 5_000 });
}

async function waitForFailedCheckRepairRowState(
  page,
  repairInsertion,
  expected,
) {
  await page.waitForFunction(
    ({ state, helperText }) => {
      const button = document.querySelector(
        '[data-repair-follow-up-insert="true"]',
      );
      if (state === "absent") return button === null;
      if (!(button instanceof HTMLButtonElement)) return false;
      const helperId = button.getAttribute("aria-describedby");
      const helper = helperId ? document.getElementById(helperId) : null;
      return (
        button.disabled === (state === "disabled") &&
        (!helperText || helper?.textContent?.includes(helperText))
      );
    },
    expected,
    { timeout: 7_000 },
  );
  if (expected.state !== "absent") {
    await repairInsertion.waitFor({ state: "visible", timeout: 5_000 });
  }
}

async function currentPlanContextActionLayout(inspector) {
  return inspector.evaluate((surface) => {
    const preview = surface.querySelector('[data-follow-up-preview="true"]');
    const actionForm = surface.querySelector("form");
    const actionConfirmation = surface.querySelector(
      '[role="group"][aria-label="Confirm Codex action"]',
    );
    const actionSurface = actionConfirmation ?? actionForm;
    const controls = actionSurface
      ? Array.from(actionSurface.querySelectorAll("button, textarea"))
      : [];
    const panelBounds = surface.getBoundingClientRect();
    const previewBounds = preview?.getBoundingClientRect();
    return {
      panelWithinViewport:
        panelBounds.left >= -1 &&
        panelBounds.right <= innerWidth + 1 &&
        panelBounds.top >= -1 &&
        panelBounds.bottom <= innerHeight + 1,
      noHorizontalOverflow:
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1 &&
        surface.scrollWidth <= surface.clientWidth + 1 &&
        (!actionSurface ||
          actionSurface.scrollWidth <= actionSurface.clientWidth + 1) &&
        (!preview || preview.scrollWidth <= preview.clientWidth + 1),
      controlsComfortable:
        controls.length > 0 &&
        controls.every((control) => {
          const bounds = control.getBoundingClientRect();
          return (
            bounds.height >= 44 &&
            Number.parseFloat(getComputedStyle(control).fontSize) >= 14
          );
        }),
      previewBounded:
        !previewBounds ||
        (previewBounds.height <= Math.min(innerHeight * 0.36, 282) &&
          previewBounds.left >= panelBounds.left - 1 &&
          previewBounds.right <= panelBounds.right + 1),
    };
  });
}

async function currentPlanContextEntryControlLayout(button) {
  return button.evaluate((control) => {
    const bounds = control.getBoundingClientRect();
    const style = getComputedStyle(control);
    return {
      comfortable:
        bounds.height >= 44 && Number.parseFloat(style.fontSize) >= 14,
      opaqueFocusOutline:
        (matchMedia("(forced-colors: active)").matches
          ? style.outlineStyle !== "none"
          : style.outlineColor === "rgb(78, 143, 121)") &&
        Number.parseFloat(style.outlineWidth) >= 3,
    };
  });
}

async function focusLocatorByTab(page, locator, maximumTabs = 80) {
  for (let index = 0; index < maximumTabs; index += 1) {
    if (
      await locator.evaluate((element) => document.activeElement === element)
    ) {
      return true;
    }
    await page.keyboard.press("Tab");
  }
  return locator.evaluate((element) => document.activeElement === element);
}

async function openMultiRootReviewInspector(page) {
  await enterTopDownOffice(page);
  const trigger = page.getByRole("button", {
    name: `Review ${REVIEW_TASK_TITLE}, Completed`,
    exact: true,
  });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const inspector = page.locator('[data-review-act-inspector="true"]');
  await inspector.waitFor({ state: "visible", timeout: 5_000 });
  return { inspector, trigger };
}

async function closeMultiRootReviewInspector(page, inspector) {
  await page.keyboard.press("Escape");
  await inspector.waitFor({ state: "detached", timeout: 5_000 });
}

async function multiRootPrivacyBoundariesClean(page) {
  const domAndStorageClean = await page.evaluate((canaries) => {
    const storage = JSON.stringify({
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
    });
    const dom = document.documentElement.outerHTML;
    return canaries.every(
      (canary) => !dom.includes(canary) && !storage.includes(canary),
    );
  }, MULTI_ROOT_PRIVATE_CANARIES);
  const ariaSnapshot = await page.locator("body").ariaSnapshot();
  return (
    domAndStorageClean &&
    MULTI_ROOT_PRIVATE_CANARIES.every(
      (canary) => !ariaSnapshot.includes(canary),
    )
  );
}

async function waitForMultiRootCampusCard(page, expectedCount) {
  const campus = await openCampus(page);
  const card = campus.locator(
    `.project-building[data-project-id="${PRIMARY_PROJECT_ID}"]`,
  );
  await card.waitFor({ state: "visible", timeout: 5_000 });
  await page.waitForFunction(
    ({ projectId, rootCount }) =>
      document
        .querySelector(`.project-building[data-project-id="${projectId}"]`)
        ?.getAttribute("data-repository-root-count") === String(rootCount),
    { projectId: PRIMARY_PROJECT_ID, rootCount: expectedCount },
    { timeout: 5_000 },
  );
  return card;
}

async function auditMultiRootRepositoryEvidence(
  page,
  screenshots,
  viewportId,
  fixtureState,
) {
  const writesBefore = fixtureState.workspaceWriteCount;
  const mutationAttemptsBefore = fixtureState.workspaceMutationAttemptCount;
  const codexMutationsBefore = fixtureState.codexRouteRequests.filter(
    (request) => request.method !== "GET" && request.method !== "HEAD",
  ).length;
  const verificationMutationsBefore = fixtureState.verificationMutationCount();
  await page.goto(assertLocalAcceptanceUrl(BASE_URL), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForSelector("main", { timeout: 30_000 });

  const coldCampusCard = await waitForMultiRootCampusCard(page, 3);
  const coldCampus = await coldCampusCard.evaluate((card) => {
    const text = card.textContent?.replace(/\s+/gu, " ").trim() ?? "";
    const aria = card.getAttribute("aria-label") ?? "";
    return {
      exactRootCount: card.getAttribute("data-repository-root-count") === "3",
      neutralVisible: text.includes("3 Git roots · inspect separately"),
      neutralAccessible: aria.includes(
        "3 saved Git roots; inspect separately.",
      ),
      noPrimaryMood:
        !text.includes("Clear skies") &&
        !text.includes("Breezy") &&
        !text.includes("Storm"),
    };
  });
  await enterProjectFromCampus(page, PRIMARY_PROJECT_ID, PRIMARY_TASK_COUNT);
  const coldOpen = await openMultiRootReviewInspector(page);
  const coldGroup = coldOpen.inspector.locator(
    '[data-repository-root-count="3"]',
  );
  await coldGroup.waitFor({ state: "visible", timeout: 5_000 });
  const coldInspector = await coldGroup.evaluate((group) => {
    const roots = Array.from(group.querySelectorAll('[role="listitem"]'));
    const text = group.textContent?.replace(/\s+/gu, " ").trim() ?? "";
    return {
      rootCount: roots.length,
      refreshingCount: roots.filter(
        (root) =>
          root.getAttribute("data-repository-evidence-state") === "refreshing",
      ).length,
      exactOrder:
        roots.map((root) => root.getAttribute("aria-label")).join("|") ===
        "Primary saved root Git evidence|Additional saved root 2 Git evidence|Additional saved root 3 Git evidence",
      noInventedTimestamp: !text.includes("Last checked"),
      noLegacyEvidence:
        !text.includes("legacy-alias") && !text.includes("9 changed"),
      noDetails: group.querySelectorAll("details").length === 0,
    };
  });
  const coldPrivacyClean = await multiRootPrivacyBoundariesClean(page);
  await coldGroup.scrollIntoViewIfNeeded();
  screenshots.set(
    `${viewportId}-multi-root-cold`,
    await page.screenshot({ fullPage: false }),
  );
  await closeMultiRootReviewInspector(page, coldOpen.inspector);

  const settledRefresh = waitForSnapshotRefresh(page);
  fixtureState.setMultiRootScenario("settled");
  await settledRefresh;
  const settledCampusCard = await waitForMultiRootCampusCard(page, 3);
  const settledCampus = await settledCampusCard.evaluate((card) => {
    const text = card.textContent?.replace(/\s+/gu, " ").trim() ?? "";
    const aria = card.getAttribute("aria-label") ?? "";
    return {
      exactRootCount: card.getAttribute("data-repository-root-count") === "3",
      neutralVisible: text.includes("3 Git roots · inspect separately"),
      neutralAccessible: aria.includes(
        "3 saved Git roots; inspect separately.",
      ),
      noPrimaryMood:
        !text.includes("Clear skies") &&
        !text.includes("Breezy") &&
        !text.includes("Storm"),
    };
  });
  screenshots.set(
    `${viewportId}-multi-root-campus`,
    await page.screenshot({ fullPage: false }),
  );
  await enterProjectFromCampus(page, PRIMARY_PROJECT_ID, PRIMARY_TASK_COUNT);
  const settledOpen = await openMultiRootReviewInspector(page);
  const group = settledOpen.inspector.locator(
    '[data-repository-root-count="3"]',
  );
  await group.waitFor({ state: "visible", timeout: 5_000 });
  const roots = group.locator('[role="listitem"]');
  const primaryRoot = roots.nth(0);
  const additionalRoot = roots.nth(1);
  const unavailableRoot = roots.nth(2);
  await unavailableRoot.scrollIntoViewIfNeeded();
  const settledStructure = await group.evaluate((surface) => {
    const rootItems = Array.from(surface.querySelectorAll('[role="listitem"]'));
    const text = surface.textContent?.replace(/\s+/gu, " ").trim() ?? "";
    return {
      rootCount: rootItems.length,
      exactOrder:
        rootItems.map((root) => root.getAttribute("aria-label")).join("|") ===
        "Primary saved root Git evidence|Additional saved root 2 Git evidence|Additional saved root 3 Git evidence",
      freshCount: rootItems.filter(
        (root) =>
          root.getAttribute("data-repository-evidence-state") === "fresh",
      ).length,
      unavailableCount: rootItems.filter(
        (root) =>
          root.getAttribute("data-repository-evidence-state") === "unavailable",
      ).length,
      explanationExact: text.includes(
        "Each saved root is reported separately. Totals are not combined, and local paths are not shown.",
      ),
      attributionExact: text.includes(
        "Not attributed to this task or result. Task-level changed files: Not reported per task.",
      ),
      noWholeProjectClaim:
        !/whole project|combined working tree|project working tree/iu.test(
          text,
        ),
      changedTotalAppearsOnce: (text.match(/5 changed/gu) ?? []).length === 1,
    };
  });
  const exactEvidence = {
    primary: await primaryRoot.evaluate(
      (root, expected) => {
        const text = root.textContent?.replace(/\s+/gu, " ").trim() ?? "";
        return (
          text.includes(`${expected.branch} @ ${"1".repeat(12)}`) &&
          text.includes("Dirty") &&
          text.includes("5 changed") &&
          text.includes("2 staged") &&
          text.includes("1 untracked") &&
          text.includes("1 ahead") &&
          !text.includes("Clean working tree")
        );
      },
      { branch: MULTI_ROOT_PRIMARY_BRANCH },
    ),
    additional: await additionalRoot.evaluate(
      (root, expected) => {
        const text = root.textContent?.replace(/\s+/gu, " ").trim() ?? "";
        return (
          text.includes(`${expected.branch} @ ${"2".repeat(12)}`) &&
          text.includes("Clean") &&
          text.includes("Clean working tree") &&
          text.includes("2 behind") &&
          !text.includes("5 changed")
        );
      },
      { branch: MULTI_ROOT_ADDITIONAL_BRANCH },
    ),
    unavailable: await unavailableRoot.evaluate((root) => {
      const text = root.textContent?.replace(/\s+/gu, " ").trim() ?? "";
      return (
        text.includes("Additional saved root 3") &&
        text.includes("Unavailable") &&
        text.includes(
          "Privacy-safe Git evidence is unavailable for this saved root.",
        ) &&
        root.querySelectorAll("details").length === 0
      );
    }),
  };

  const primarySummary = primaryRoot.getByLabel(
    "Primary saved root repository details",
    { exact: true },
  );
  const additionalSummary = additionalRoot.getByLabel(
    "Additional saved root 2 repository details",
    { exact: true },
  );
  const primaryKeyboardFocus = await focusLocatorByTab(page, primarySummary);
  const primaryControl = await primarySummary.evaluate((summary) => {
    const bounds = summary.getBoundingClientRect();
    const style = getComputedStyle(summary);
    return {
      comfortable:
        bounds.height >= 44 && Number.parseFloat(style.fontSize) >= 14,
      opaqueFocus:
        (matchMedia("(forced-colors: active)").matches
          ? style.outlineStyle !== "none"
          : style.outlineColor === "rgb(78, 143, 121)") &&
        Number.parseFloat(style.outlineWidth) >= 3,
      nativeMarker:
        summary.tagName === "SUMMARY" && style.display === "list-item",
    };
  });
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document
        .querySelector(
          'summary[aria-label="Primary saved root repository details"]',
        )
        ?.closest("details")
        ?.hasAttribute("open") === true,
  );
  const primaryDetailsExact = await primaryRoot.evaluate((root) => {
    const text = root.textContent?.replace(/\s+/gu, " ").trim() ?? "";
    return (
      text.includes("Source 3") &&
      text.includes("Tests 2") &&
      text.includes("5 of 5 files summarized") &&
      text.includes("4 tracked · +17 −5")
    );
  });
  const primaryOpenedIndependently =
    (await primaryRoot.locator("details[open]").count()) === 1 &&
    (await additionalRoot.locator("details[open]").count()) === 0;
  await page.keyboard.press("Enter");
  const primaryClosedWithFocus = await primarySummary.evaluate(
    (summary) =>
      !summary.closest("details")?.hasAttribute("open") &&
      document.activeElement === summary,
  );

  const additionalKeyboardFocus = await focusLocatorByTab(
    page,
    additionalSummary,
  );
  const additionalControl = await additionalSummary.evaluate((summary) => {
    const bounds = summary.getBoundingClientRect();
    const style = getComputedStyle(summary);
    return {
      comfortable:
        bounds.height >= 44 && Number.parseFloat(style.fontSize) >= 14,
      opaqueFocus:
        (matchMedia("(forced-colors: active)").matches
          ? style.outlineStyle !== "none"
          : style.outlineColor === "rgb(78, 143, 121)") &&
        Number.parseFloat(style.outlineWidth) >= 3,
      nativeMarker:
        summary.tagName === "SUMMARY" && style.display === "list-item",
    };
  });
  await page.keyboard.press("Space");
  await page.waitForFunction(
    () =>
      document
        .querySelector(
          'summary[aria-label="Additional saved root 2 repository details"]',
        )
        ?.closest("details")
        ?.hasAttribute("open") === true,
  );
  const additionalDetailsExact = await additionalRoot.evaluate((root) => {
    const text = root.textContent?.replace(/\s+/gu, " ").trim() ?? "";
    return (
      text.includes("No changed areas") &&
      text.includes("0 of 0 files summarized") &&
      text.includes("0 tracked · +0 −0")
    );
  });
  const additionalOpenedIndependently =
    (await primaryRoot.locator("details[open]").count()) === 0 &&
    (await additionalRoot.locator("details[open]").count()) === 1;
  await page.keyboard.press("Space");
  const additionalClosedWithFocus = await additionalSummary.evaluate(
    (summary) =>
      !summary.closest("details")?.hasAttribute("open") &&
      document.activeElement === summary,
  );

  await unavailableRoot.scrollIntoViewIfNeeded();
  const settledLayout = await group.evaluate(
    (surface, compact) => {
      const inspector = surface.closest('[data-review-act-inspector="true"]');
      const inspectorBounds = inspector?.getBoundingClientRect();
      const rootItems = Array.from(
        surface.querySelectorAll('[role="listitem"]'),
      );
      const visibleDescendants = Array.from(
        surface.querySelectorAll("*"),
      ).filter((element) => element.getClientRects().length > 0);
      return {
        panelWithinViewport: Boolean(
          inspectorBounds &&
          inspectorBounds.left >= -1 &&
          inspectorBounds.right <= innerWidth + 1 &&
          inspectorBounds.top >= -1 &&
          inspectorBounds.bottom <= innerHeight + 1,
        ),
        noHorizontalOverflow:
          document.documentElement.scrollWidth <= innerWidth + 1 &&
          surface.scrollWidth <= surface.clientWidth + 1 &&
          rootItems.every((root) => root.scrollWidth <= root.clientWidth + 1),
        descendantsContained: rootItems.every((root) => {
          const bounds = root.getBoundingClientRect();
          return visibleDescendants
            .filter((element) => root.contains(element))
            .every((element) => {
              const child = element.getBoundingClientRect();
              return (
                child.left >= bounds.left - 1 && child.right <= bounds.right + 1
              );
            });
        }),
        longBranchWraps: Array.from(surface.querySelectorAll("strong")).some(
          (element) =>
            element.textContent?.includes(
              "additional-root-with-an-intentionally",
            ) && getComputedStyle(element).overflowWrap === "anywhere",
        ),
        compactScrolls:
          !compact ||
          Boolean(
            inspector &&
            inspector.scrollHeight > inspector.clientHeight &&
            getComputedStyle(inspector).overflowY !== "hidden",
          ),
      };
    },
    viewportId === "portrait" || viewportId === "short-landscape",
  );
  const settledPrivacyClean = await multiRootPrivacyBoundariesClean(page);
  screenshots.set(
    `${viewportId}-multi-root-evidence`,
    await page.screenshot({ fullPage: false }),
  );
  await closeMultiRootReviewInspector(page, settledOpen.inspector);

  const boundedRefresh = waitForSnapshotRefresh(page);
  fixtureState.setMultiRootScenario("bounded");
  await boundedRefresh;
  const boundedCampusCard = await waitForMultiRootCampusCard(page, 40);
  const boundedSecondaryCampusCard = page.locator(
    `.project-building[data-project-id="${SECONDARY_PROJECT_ID}"]`,
  );
  await boundedSecondaryCampusCard.waitFor({
    state: "visible",
    timeout: 5_000,
  });
  const boundedGlobalCountsExact =
    (await boundedCampusCard.getAttribute("data-repository-root-count")) ===
      "40" &&
    (await boundedSecondaryCampusCard.getAttribute(
      "data-repository-root-count",
    )) === "25" &&
    (await boundedCampusCard.getAttribute(
      "data-repository-collection-state",
    )) === "bounded_out" &&
    (await boundedSecondaryCampusCard.getAttribute(
      "data-repository-collection-state",
    )) === "bounded_out";
  const boundedCampus = await boundedCampusCard.evaluate((card) => {
    const text = card.textContent?.replace(/\s+/gu, " ").trim() ?? "";
    const aria = card.getAttribute("aria-label") ?? "";
    return {
      exactCount:
        card.getAttribute("data-repository-root-count") === "40" &&
        card.getAttribute("data-repository-collection-state") === "bounded_out",
      compactVisible: text.includes("40 Git roots · evidence unavailable"),
      compactAccessible: aria.includes(
        "40 saved Git roots; evidence unavailable.",
      ),
      noPrimaryMood:
        !text.includes("Clear skies") &&
        !text.includes("Breezy") &&
        !text.includes("Storm"),
    };
  });
  await enterProjectFromCampus(page, PRIMARY_PROJECT_ID, PRIMARY_TASK_COUNT);
  const boundedOpen = await openMultiRootReviewInspector(page);
  const boundedCard = boundedOpen.inspector.locator(
    '[data-repository-collection-state="bounded_out"]',
  );
  await boundedCard.waitFor({ state: "visible", timeout: 5_000 });
  const boundedInspector = await boundedCard.evaluate((card) => {
    const text = card.textContent?.replace(/\s+/gu, " ").trim() ?? "";
    const bounds = card.getBoundingClientRect();
    return {
      exactCount:
        card.getAttribute("data-repository-root-count") === "40" &&
        text.includes("40 saved roots"),
      copyExact: text.includes(
        "Git evidence is unavailable because the source-wide saved-root inventory exceeds the technical collection safety bound. No partial subset was inspected.",
      ),
      noPartialDom:
        card.querySelectorAll('[role="listitem"]').length === 0 &&
        card.querySelectorAll("details").length === 0,
      noLegacyEvidence:
        !text.includes("legacy-alias") &&
        !text.includes("9 changed") &&
        !text.includes("Primary saved root"),
      contained:
        card.scrollWidth <= card.clientWidth + 1 &&
        document.documentElement.scrollWidth <= innerWidth + 1 &&
        bounds.left >= -1 &&
        bounds.right <= innerWidth + 1,
    };
  });
  const boundedVisibleText = await page.locator("body").innerText();
  const boundedAccessibleText = await page.locator("body").ariaSnapshot();
  const falseParserFailureCopy =
    /(?:some\s+)?records?\s+were\s+skipped|source\s+records?\s+could\s+not\s+be\s+read/iu;
  const boundedNoFalseParserFailureCopy =
    !falseParserFailureCopy.test(boundedVisibleText) &&
    !falseParserFailureCopy.test(boundedAccessibleText);
  const boundedPrivacyClean = await multiRootPrivacyBoundariesClean(page);
  await boundedCard.scrollIntoViewIfNeeded();
  screenshots.set(
    `${viewportId}-multi-root-bounded`,
    await page.screenshot({ fullPage: false }),
  );
  await closeMultiRootReviewInspector(page, boundedOpen.inspector);

  const singleRefresh = waitForSnapshotRefresh(page);
  fixtureState.setMultiRootScenario("single");
  await singleRefresh;
  const singleCampusCard = await waitForMultiRootCampusCard(page, 1);
  const singleCampus = await singleCampusCard.evaluate((card) => {
    const text = card.textContent?.replace(/\s+/gu, " ").trim() ?? "";
    const aria = card.getAttribute("aria-label") ?? "";
    return {
      rootCount: Number(card.getAttribute("data-repository-root-count")),
      primaryMoodUnchanged: text.includes("Breezy · 1 changed"),
      noMultiRootCopy:
        !text.includes("Git roots · inspect separately") &&
        !aria.includes("saved Git roots"),
    };
  });
  await enterProjectFromCampus(page, PRIMARY_PROJECT_ID, PRIMARY_TASK_COUNT);
  const singleOpen = await openMultiRootReviewInspector(page);
  const singleCard = singleOpen.inspector
    .getByText("Primary-root working tree", { exact: true })
    .locator("xpath=ancestor::article[1]");
  await singleCard.waitFor({ state: "visible", timeout: 5_000 });
  const singleInspector = await singleCard.evaluate(
    (card, expected) => {
      const text = card.textContent?.replace(/\s+/gu, " ").trim() ?? "";
      return {
        compactCopyUnchanged:
          text.includes("Project Git evidence") &&
          text.includes("Primary-root working tree") &&
          text.includes(`${expected.branch} @ ${"3".repeat(12)}`) &&
          text.includes("1 changed"),
        noMultiRootGroup:
          !card.hasAttribute("data-repository-root-count") &&
          !text.includes("saved roots") &&
          !text.includes("Totals are not combined"),
        detailsCount: card.querySelectorAll("details").length,
        contained:
          card.scrollWidth <= card.clientWidth + 1 &&
          document.documentElement.scrollWidth <= innerWidth + 1,
      };
    },
    { branch: MULTI_ROOT_SINGLE_BRANCH },
  );
  const singlePrivacyClean = await multiRootPrivacyBoundariesClean(page);
  await singleCard.scrollIntoViewIfNeeded();
  screenshots.set(
    `${viewportId}-single-root-evidence`,
    await page.screenshot({ fullPage: false }),
  );
  await closeMultiRootReviewInspector(page, singleOpen.inspector);

  return {
    cold: {
      campusRootCount: coldCampus.exactRootCount ? 3 : 0,
      campusNeutral: coldCampus.neutralVisible,
      campusAccessible: coldCampus.neutralAccessible,
      campusNoPrimaryMood: coldCampus.noPrimaryMood,
      inspectorRootCount: coldInspector.rootCount,
      refreshingCount: coldInspector.refreshingCount,
      exactOrder: coldInspector.exactOrder,
      noInventedTimestamp: coldInspector.noInventedTimestamp,
      noLegacyEvidence: coldInspector.noLegacyEvidence,
      detailsCount: coldInspector.noDetails ? 0 : 1,
    },
    settled: {
      campusRootCount: settledCampus.exactRootCount ? 3 : 0,
      campusNeutral: settledCampus.neutralVisible,
      campusAccessible: settledCampus.neutralAccessible,
      campusNoPrimaryMood: settledCampus.noPrimaryMood,
      inspectorRootCount: settledStructure.rootCount,
      exactOrder: settledStructure.exactOrder,
      freshCount: settledStructure.freshCount,
      unavailableCount: settledStructure.unavailableCount,
      explanationExact: settledStructure.explanationExact,
      attributionExact: settledStructure.attributionExact,
      noWholeProjectClaim: settledStructure.noWholeProjectClaim,
      changedTotalAppearsOnce: settledStructure.changedTotalAppearsOnce,
      primaryExact: exactEvidence.primary,
      additionalExact: exactEvidence.additional,
      unavailableExact: exactEvidence.unavailable,
      primaryDetailsExact,
      additionalDetailsExact,
      primaryKeyboardFocus,
      additionalKeyboardFocus,
      primaryControlComfortable: primaryControl.comfortable,
      additionalControlComfortable: additionalControl.comfortable,
      primaryOpaqueFocus: primaryControl.opaqueFocus,
      additionalOpaqueFocus: additionalControl.opaqueFocus,
      primaryNativeMarker: primaryControl.nativeMarker,
      additionalNativeMarker: additionalControl.nativeMarker,
      primaryOpenedIndependently,
      additionalOpenedIndependently,
      primaryClosedWithFocus,
      additionalClosedWithFocus,
      panelWithinViewport: settledLayout.panelWithinViewport,
      noHorizontalOverflow: settledLayout.noHorizontalOverflow,
      descendantsContained: settledLayout.descendantsContained,
      longBranchWraps: settledLayout.longBranchWraps,
      compactScrolls: settledLayout.compactScrolls,
    },
    single: {
      campusRootCount: singleCampus.rootCount,
      campusMoodUnchanged: singleCampus.primaryMoodUnchanged,
      campusNoMultiRootCopy: singleCampus.noMultiRootCopy,
      compactCopyUnchanged: singleInspector.compactCopyUnchanged,
      noMultiRootGroup: singleInspector.noMultiRootGroup,
      detailsCount: singleInspector.detailsCount,
      contained: singleInspector.contained,
    },
    bounded: {
      globalCountsExact: boundedGlobalCountsExact,
      campusExactCount: boundedCampus.exactCount,
      campusCompactVisible: boundedCampus.compactVisible,
      campusCompactAccessible: boundedCampus.compactAccessible,
      campusNoPrimaryMood: boundedCampus.noPrimaryMood,
      inspectorExactCount: boundedInspector.exactCount,
      copyExact: boundedInspector.copyExact,
      noPartialDom: boundedInspector.noPartialDom,
      noLegacyEvidence: boundedInspector.noLegacyEvidence,
      noFalseParserFailureCopy: boundedNoFalseParserFailureCopy,
      contained: boundedInspector.contained,
    },
    privacyBoundariesClean:
      coldPrivacyClean &&
      settledPrivacyClean &&
      boundedPrivacyClean &&
      singlePrivacyClean,
    workspaceWrites: fixtureState.workspaceWriteCount - writesBefore,
    workspaceMutationAttempts:
      fixtureState.workspaceMutationAttemptCount - mutationAttemptsBefore,
    codexMutations:
      fixtureState.codexRouteRequests.filter(
        (request) => request.method !== "GET" && request.method !== "HEAD",
      ).length - codexMutationsBefore,
    verificationMutations:
      fixtureState.verificationMutationCount() - verificationMutationsBefore,
  };
}

async function openSavedComparisonInspector(page, fixtureState) {
  await enterTopDownOffice(page);
  const hydrationDeadline = Date.now() + 5_000;
  while (
    fixtureState.workspaceReadCount() === 0 &&
    Date.now() < hydrationDeadline
  ) {
    await page.waitForTimeout(25);
  }
  if (fixtureState.workspaceReadCount() === 0) {
    throw new Error(
      "Saved-result comparison workspace did not become interactive.",
    );
  }
  const plan = page.getByRole("button", { name: "Plan", exact: true });
  await plan.waitFor({ state: "visible", timeout: 5_000 });
  await page.waitForFunction(
    () => {
      const control = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Plan",
      );
      return control instanceof HTMLButtonElement && !control.disabled;
    },
    undefined,
    { timeout: 5_000 },
  );
  const task = page.getByRole("button", {
    name: `Review ${REVIEW_TASK_TITLE}, Completed`,
    exact: true,
  });
  await task.scrollIntoViewIfNeeded();
  await task.focus();
  await page.keyboard.press("Enter");
  const inspector = page.locator('[data-review-act-inspector="true"]');
  await inspector.waitFor({ state: "visible", timeout: 5_000 });
  return { inspector, task };
}

async function savedComparisonPrivacyClean(page, comparison) {
  const storageAndUrlClean = await page.evaluate((canaries) => {
    const surfaces = JSON.stringify({
      localStorage: Object.entries(localStorage),
      sessionStorage: Object.entries(sessionStorage),
      url: location.href,
    });
    return canaries.every((canary) => !surfaces.includes(canary));
  }, SAVED_COMPARISON_PRIVATE_CANARIES);
  const comparisonMarkup = await comparison.evaluate(
    (surface) => surface.outerHTML,
  );
  const aria = await comparison.ariaSnapshot();
  return (
    storageAndUrlClean &&
    SAVED_COMPARISON_PRIVATE_CANARIES.every(
      (canary) => !comparisonMarkup.includes(canary) && !aria.includes(canary),
    )
  );
}

async function inspectSavedComparisonLayout(comparison, viewportId) {
  return comparison.evaluate((surface, currentViewportId) => {
    const inspector = surface.closest('[data-review-act-inspector="true"]');
    const cards = Array.from(surface.querySelectorAll("article"));
    const controls = Array.from(surface.querySelectorAll("button, select"));
    const surfaceBounds = surface.getBoundingClientRect();
    const cardBounds = cards.map((card) => card.getBoundingClientRect());
    const twoColumns =
      cards.length === 2 &&
      Math.abs(cardBounds[0].top - cardBounds[1].top) <= 2 &&
      cardBounds[1].left > cardBounds[0].left;
    const oneColumn =
      cards.length === 2 && cardBounds[1].top > cardBounds[0].bottom;
    const expectedTwoColumns =
      currentViewportId !== "portrait" && currentViewportId !== "compact";
    const visibleDescendants = Array.from(surface.querySelectorAll("*")).filter(
      (element) => element.getClientRects().length > 0,
    );
    return {
      expectedColumnLayout: expectedTwoColumns ? twoColumns : oneColumn,
      cardCount: cards.length,
      controlsComfortable:
        controls.length >= 2 &&
        controls.every((control) => {
          const bounds = control.getBoundingClientRect();
          const style = getComputedStyle(control);
          return bounds.height >= 44 && Number.parseFloat(style.fontSize) >= 14;
        }),
      panelWithinViewport: Boolean(
        inspector &&
        inspector.getBoundingClientRect().left >= -1 &&
        inspector.getBoundingClientRect().right <= innerWidth + 1 &&
        inspector.getBoundingClientRect().top >= -1 &&
        inspector.getBoundingClientRect().bottom <= innerHeight + 1,
      ),
      surfaceWithinInspector: Boolean(
        inspector &&
        surfaceBounds.left >= inspector.getBoundingClientRect().left - 1 &&
        surfaceBounds.right <= inspector.getBoundingClientRect().right + 1,
      ),
      noHorizontalOverflow:
        document.documentElement.scrollWidth <= innerWidth + 1 &&
        surface.scrollWidth <= surface.clientWidth + 1 &&
        cards.every((card) => card.scrollWidth <= card.clientWidth + 1),
      descendantsContained: visibleDescendants.every((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.left >= surfaceBounds.left - 1 &&
          bounds.right <= surfaceBounds.right + 1
        );
      }),
      compactScrolls:
        currentViewportId !== "portrait" &&
        currentViewportId !== "short-landscape"
          ? true
          : Boolean(
              inspector &&
              inspector.scrollHeight > inspector.clientHeight &&
              getComputedStyle(inspector).overflowY !== "hidden",
            ),
    };
  }, viewportId);
}

async function auditSavedResultComparison(
  page,
  screenshots,
  viewportId,
  fixtureState,
) {
  const writesBefore = fixtureState.workspaceWriteCount;
  const mutationAttemptsBefore = fixtureState.workspaceMutationAttemptCount;
  const resultObservationsBefore = fixtureState.resultObservationWriteCount;
  const codexMutationsBefore = fixtureState.codexRouteRequests.filter(
    (request) => request.method !== "GET" && request.method !== "HEAD",
  ).length;
  const verificationMutationsBefore = fixtureState.verificationMutationCount();
  const targets = fixtureState.savedComparisonTargets();
  if (!targets) throw new Error("Saved-result comparison targets are missing.");

  const opened = await openSavedComparisonInspector(page, fixtureState);
  const { inspector } = opened;
  const trigger = inspector.getByRole("button", {
    name: "Compare saved evidence",
    exact: true,
  });
  await trigger.scrollIntoViewIfNeeded();
  const closedDefault =
    (await trigger.getAttribute("aria-expanded")) === "false" &&
    (await inspector
      .getByRole("heading", { name: "Compare saved evidence", exact: true })
      .count()) === 0;
  await trigger.focus();
  const triggerControl = await trigger.evaluate((control) => {
    const bounds = control.getBoundingClientRect();
    const style = getComputedStyle(control);
    return {
      comfortable:
        bounds.height >= 44 && Number.parseFloat(style.fontSize) >= 14,
      opaqueFocus:
        (matchMedia("(forced-colors: active)").matches
          ? style.outlineStyle !== "none"
          : style.outlineColor === "rgb(78, 143, 121)") &&
        Number.parseFloat(style.outlineWidth) >= 3,
    };
  });
  await page.keyboard.press("Enter");
  const comparison = inspector.locator(
    'section[aria-labelledby="saved-comparison-heading"]',
  );
  await comparison.waitFor({ state: "visible", timeout: 5_000 });
  const picker = comparison.getByRole("combobox", {
    name: "Saved alternative",
    exact: true,
  });
  const openFocus = await waitForLocatorFocus(page, picker);
  const pickerOpaqueFocus = await picker.evaluate((control) => {
    const style = getComputedStyle(control);
    return (
      (matchMedia("(forced-colors: active)").matches
        ? style.outlineStyle !== "none"
        : style.outlineColor === "rgb(78, 143, 121)") &&
      Number.parseFloat(style.outlineWidth) >= 3
    );
  });
  const options = await picker.locator("option").allTextContents();
  const optionsExact =
    JSON.stringify(options) ===
    JSON.stringify([
      "Alternative 1 · Attempt 3 · Result 2",
      "Alternative 2 · Attempt 5 · Result 1",
    ]);
  const panelText = (await comparison.innerText()).replace(/\s+/gu, " ").trim();
  const selectedCard = comparison.getByRole("article", {
    name: "Selected result",
    exact: true,
  });
  const alternativeCard = comparison.getByRole("article", {
    name: "Alternative result",
    exact: true,
  });
  const selectedText = (await selectedCard.innerText())
    .replace(/\s+/gu, " ")
    .trim();
  const initialAlternativeText = (await alternativeCard.innerText())
    .replace(/\s+/gu, " ")
    .trim();
  const compactUtc = (timestamp) =>
    `${timestamp.slice(0, 10)} ${timestamp.slice(11, 16)} UTC`;
  const alphaReceiptRecordedLabel = `Recorded ${compactUtc(
    new Date(Date.parse(fixtureState.observedAt) - 340_000).toISOString(),
  )}`;
  const alphaReviewedLabel = `Reviewed ${compactUtc(
    new Date(Date.parse(fixtureState.observedAt) - 510_000).toISOString(),
  )}`;
  const alphaDecisionLabel = `Accepted ${compactUtc(
    new Date(Date.parse(fixtureState.observedAt) - 500_000).toISOString(),
  )}`;
  const initialAttributionExact =
    selectedText.includes("SELECTED RESULT Attempt 1 · Result 1") &&
    selectedText.includes("Not marked reviewed") &&
    selectedText.includes("Not recorded") &&
    selectedText.includes("No retained check receipt") &&
    !selectedText.includes("Tests · Running") &&
    initialAlternativeText.includes(
      "ALTERNATIVE RESULT Attempt 3 · Result 2",
    ) &&
    initialAlternativeText.includes(alphaReviewedLabel) &&
    initialAlternativeText.includes(alphaDecisionLabel) &&
    initialAlternativeText.includes("Not recorded") &&
    initialAlternativeText.includes("Saved quality check · Failed") &&
    initialAlternativeText.includes(alphaReceiptRecordedLabel) &&
    initialAlternativeText.includes("Checks: failed: 1") &&
    initialAlternativeText.includes("Failures: could not start: 1");
  const copyContract =
    panelText.includes(
      "Review Coffice’s saved records for two exact results. This does not compare the work itself.",
    ) &&
    panelText.includes(
      "No result content, changes, or task messages were inspected. Coffice does not score, rank, or recommend either result.",
    );
  const excludedRelationshipsAndEarlierCycle =
    options.length === 2 &&
    !panelText.includes("Attempt 2") &&
    !panelText.includes("Attempt 4") &&
    !panelText.includes("Attempt 6") &&
    !panelText.includes("Result 1 · Result 2");
  const layout = await inspectSavedComparisonLayout(comparison, viewportId);
  const initialPrivacyClean = await savedComparisonPrivacyClean(
    page,
    comparison,
  );
  screenshots.set(
    `${viewportId}-saved-result-comparison`,
    await page.screenshot({ fullPage: false }),
  );

  await picker.selectOption("alternative-2");
  const switchedStatus = inspector.getByRole("status").filter({
    hasText: "Showing saved alternative 2 of 2.",
  });
  await switchedStatus.waitFor({ state: "visible", timeout: 5_000 });
  const switchedSelectedText = (await selectedCard.innerText())
    .replace(/\s+/gu, " ")
    .trim();
  const switchedAlternativeText = (await alternativeCard.innerText())
    .replace(/\s+/gu, " ")
    .trim();
  const betaAssessmentUpdatedLabel = `Updated ${compactUtc(
    new Date(Date.parse(fixtureState.observedAt) - 400_000).toISOString(),
  )}`;
  const betaReceiptRecordedLabel = `Recorded ${compactUtc(
    new Date(Date.parse(fixtureState.observedAt) - 350_000).toISOString(),
  )}`;
  const switchExact =
    switchedSelectedText === selectedText &&
    switchedAlternativeText.includes(
      "ALTERNATIVE RESULT Attempt 5 · Result 1",
    ) &&
    switchedAlternativeText.includes("Not marked reviewed") &&
    switchedAlternativeText.includes("Summary: Recorded") &&
    switchedAlternativeText.includes("Risks 1") &&
    switchedAlternativeText.includes("Uncertainties 0") &&
    switchedAlternativeText.includes("Decision notes 1") &&
    switchedAlternativeText.includes("Advisory action: Send a follow-up") &&
    switchedAlternativeText.includes(betaAssessmentUpdatedLabel) &&
    switchedAlternativeText.includes("Lint · Passed") &&
    switchedAlternativeText.includes(betaReceiptRecordedLabel) &&
    switchedAlternativeText.includes("Checks: passed: 1") &&
    switchedAlternativeText.includes("Failures: None") &&
    !switchedAlternativeText.includes("Tests · Failed") &&
    !switchedAlternativeText.includes("Saved quality check · Failed");
  const switchedPrivacyClean = await savedComparisonPrivacyClean(
    page,
    comparison,
  );

  const close = comparison.getByRole("button", {
    name: "Close comparison",
    exact: true,
  });
  await close.click();
  await comparison.waitFor({ state: "detached", timeout: 5_000 });
  const closeFocusRestored = await waitForLocatorFocus(page, trigger);
  const closeClearedSwitchStatus =
    (await inspector
      .getByRole("status")
      .filter({ hasText: "Showing saved alternative 2 of 2." })
      .count()) === 0;
  await trigger.click();
  await comparison.waitFor({ state: "visible", timeout: 5_000 });
  await page.keyboard.press("Escape");
  await comparison.waitFor({ state: "detached", timeout: 5_000 });
  const escapeFocusRestored = await waitForLocatorFocus(page, trigger);

  await trigger.click();
  await comparison.waitFor({ state: "visible", timeout: 5_000 });
  await picker.selectOption("alternative-2");
  const readsBeforeRemoval = fixtureState.workspaceReadCount();
  const nextVerificationPoll = page.waitForResponse(
    (response) =>
      response.status() === 200 &&
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/verifications",
    { timeout: 5_000 },
  );
  fixtureState.removeSavedComparisonAlternative(targets.betaTarget);
  await nextVerificationPoll;
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-review-act-inspector="true"] [role="status"]')
        ?.textContent?.includes("Saved comparison is no longer available."),
    undefined,
    { timeout: 5_000 },
  );
  await comparison.waitFor({ state: "detached", timeout: 5_000 });
  const invalidationStatus = inspector.getByRole("status").filter({
    hasText: "Saved comparison is no longer available.",
  });
  const removalDidNotSubstitute =
    (await picker.count()) === 0 &&
    (await comparison.count()) === 0 &&
    (await invalidationStatus.count()) === 1 &&
    (await trigger.evaluate((control) => document.activeElement === control)) &&
    fixtureState.workspaceReadCount() > readsBeforeRemoval;
  await inspector
    .getByRole("button", { name: "Close review inspector", exact: true })
    .click();

  const workspaceWriteDelta = fixtureState.workspaceWriteCount - writesBefore;
  const workspaceMutationAttemptDelta =
    fixtureState.workspaceMutationAttemptCount - mutationAttemptsBefore;
  const resultObservationWriteDelta =
    fixtureState.resultObservationWriteCount - resultObservationsBefore;
  const codexMutationDelta =
    fixtureState.codexRouteRequests.filter(
      (request) => request.method !== "GET" && request.method !== "HEAD",
    ).length - codexMutationsBefore;
  const verificationMutationDelta =
    fixtureState.verificationMutationCount() - verificationMutationsBefore;
  return {
    closedDefault,
    triggerComfortable: triggerControl.comfortable,
    triggerOpaqueFocus: triggerControl.opaqueFocus,
    openFocus,
    pickerOpaqueFocus,
    optionCount: options.length,
    optionsExact,
    initialAttributionExact,
    copyContract,
    excludedRelationshipsAndEarlierCycle,
    layout,
    initialPrivacyClean,
    switchExact,
    switchedPrivacyClean,
    closeFocusRestored,
    closeClearedSwitchStatus,
    escapeFocusRestored,
    removalDidNotSubstitute,
    workspaceWriteDelta,
    workspaceMutationAttemptDelta,
    resultObservationWriteDelta,
    codexMutationDelta,
    verificationMutationDelta,
  };
}

async function auditCurrentPlanContextInsertion(
  page,
  screenshots,
  viewportId,
  fixtureState,
) {
  const workspaceWritesBefore = fixtureState.workspaceWriteCount;
  const verificationReceiptsBefore = fixtureState.verificationReceiptCount();
  const codexMutationsBefore = await codexMutationCount(fixtureState);
  await enterProjectOffice(
    page,
    SECONDARY_PROJECT_ID,
    SECONDARY_TASK_COUNT + 1,
  );
  const openReviewTask = page.getByRole("button", {
    name: `Review ${REVIEW_TASK_TITLE}, Completed`,
    exact: true,
  });
  await openReviewTask.scrollIntoViewIfNeeded();
  await openReviewTask.click();
  const inspector = page.locator('[data-review-act-inspector="true"]');
  await inspector.waitFor({ state: "visible", timeout: 5_000 });

  const historicalSourceVisible =
    (await inspector
      .getByText("Historical result", { exact: true })
      .count()) === 1 &&
    (await inspector
      .getByText(
        `Current tracking: Secondary Office · ${CURRENT_CONTEXT_WORK_ITEM_TITLE}.`,
        { exact: true },
      )
      .count()) === 1;
  const sourceDisclosure = inspector.locator(
    `[data-current-project-decisions="${PRIMARY_PROJECT_ID}"]`,
  );
  const exactSourceProjectStillVisible =
    (await sourceDisclosure.count()) === 1 &&
    (await sourceDisclosure.textContent())?.includes(
      REVIEW_DECISION_SECOND_STATEMENT,
    );
  const definitionSection = inspector.locator(
    '[aria-labelledby="definition-of-done-heading"]',
  );
  const historicalDefinitionCurrent =
    (await definitionSection.count()) === 1 &&
    (await definitionSection.textContent())?.includes(
      DEFINITION_OF_DONE_PRIVATE_CANARY,
    ) &&
    !(await definitionSection.textContent())?.includes(
      CURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
    );
  const historicalDefinitionOrderExact =
    JSON.stringify(
      await definitionSection.locator("ol > li").allTextContents(),
    ) ===
    JSON.stringify([
      "Review the exact completed result.",
      DEFINITION_OF_DONE_PRIVATE_CANARY,
      DEFINITION_OF_DONE_LONG_ENTRY,
    ]);
  const historicalDefinitionHasNoControls =
    (await definitionSection
      .locator("button, input, textarea, select")
      .count()) === 0;
  const historicalRules = inspector.locator(
    '[data-current-project-rules="true"]',
  );
  const historicalRulesUseSourceProjectOnly =
    (await historicalRules.count()) === 1 &&
    (await historicalRules
      .getByText(PROJECT_RULE_CURRENT_A_CANARY, {
        exact: true,
      })
      .count()) === 1 &&
    (await historicalRules
      .getByText(PROJECT_RULE_CURRENT_B_CANARY, {
        exact: true,
      })
      .count()) === 0;
  const historicalRulesExact =
    JSON.stringify(
      await historicalRules.locator("ol > li").allTextContents(),
    ) === JSON.stringify([PROJECT_RULE_CURRENT_A_CANARY]) &&
    (await historicalRules.getByText("1 rule", { exact: true }).count()) === 1;
  const historicalRulesAdvisoryExact =
    (await historicalRules
      .getByText(
        "Current project context—not a snapshot stored with this result. Coffice does not enforce these rules or treat them as evidence.",
        { exact: true },
      )
      .count()) === 1;
  const historicalRulesReadOnly =
    (await historicalRules
      .locator('button, input, textarea, select, [role="checkbox"]')
      .count()) === 0;
  await historicalRules.scrollIntoViewIfNeeded();
  screenshots.set(
    `${viewportId}-review-current-project-rules`,
    await page.screenshot({ fullPage: false }),
  );

  const sendFollowUp = inspector.getByRole("button", {
    name: "Send follow-up",
    exact: true,
  });
  await sendFollowUp.scrollIntoViewIfNeeded();
  await sendFollowUp.click();
  const textarea = inspector.getByRole("textbox", {
    name: "Follow-up instruction",
    exact: true,
  });
  await textarea.waitFor({ state: "visible", timeout: 5_000 });
  const insertion = inspector.getByRole("button", {
    name: "Insert current plan context",
    exact: true,
  });
  const helperId = await insertion.getAttribute("aria-describedby");
  const helper = helperId
    ? inspector.locator(`#${helperId.replace(/([:.])/gu, "\\$1")}`)
    : inspector.locator("__missing_helper__");
  const helperText = ((await helper.textContent()) ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  const helperDescribesCurrentDestination =
    Boolean(helperId) &&
    helperText.includes("current Coffice objective") &&
    helperText.includes("active project decisions") &&
    helperText.includes("Nothing is sent until you review and confirm.");
  const composeInitialFocus = await waitForLocatorFocus(page, textarea);
  await page.keyboard.press("Tab");
  await waitForLocatorFocus(page, insertion);
  const entryControlLayout =
    await currentPlanContextEntryControlLayout(insertion);
  const composeLayout = await currentPlanContextActionLayout(inspector);

  const actionsBeforeInsert = await codexMutationCount(fixtureState);
  const writesBeforeInsert = fixtureState.workspaceWriteCount;
  await insertion.click();
  const insertedStatus = inspector.getByRole("status").filter({
    hasText:
      "Inserted from the current Coffice plan. Review and edit before sending.",
  });
  await insertedStatus.waitFor({ state: "visible", timeout: 5_000 });
  const insertedText = await textarea.inputValue();
  const insertionExact = insertedText === CURRENT_PLAN_CONTEXT_DRAFT;
  const insertionFocusAndCaret = await waitForTextareaFocusAndCaretAtEnd(
    page,
    textarea,
  );
  const insertHadNoWrites =
    fixtureState.workspaceWriteCount === writesBeforeInsert &&
    (await codexMutationCount(fixtureState)) === actionsBeforeInsert;
  const privacyExclusions = [
    REVIEW_MILESTONE_TITLE,
    REVIEW_DECISION_LONG_STATEMENT,
    REVIEW_DECISION_PLAIN_CONTEXT,
    REVIEW_DECISION_SECOND_STATEMENT,
    "Use the superseded destination wording.",
    HISTORICAL_CONTEXT_PRIVATE_PATH,
    HISTORICAL_CONTEXT_WITHDRAWN_STATEMENT,
    CURRENT_CONTEXT_WITHDRAWN_STATEMENT,
    CURRENT_CONTEXT_DECISION_ORIGINAL_ID,
    CURRENT_CONTEXT_DECISION_CURRENT_ID,
    CURRENT_CONTEXT_DECISION_SECOND_ID,
    CURRENT_CONTEXT_DECISION_WITHDRAWN_ID,
    CURRENT_CONTEXT_DECISION_WITHDRAWAL_ID,
    REVIEW_ATTEMPT_ID,
    CURRENT_CONTEXT_ATTEMPT_ID,
    DEFINITION_OF_DONE_PRIVATE_CANARY,
    CURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
    DEFINITION_OF_DONE_LONG_ENTRY,
    "Review the exact completed result.",
  ];
  const privacyExact =
    insertedText.includes(CURRENT_CONTEXT_DECISION_RECORDED_CONTEXT) &&
    privacyExclusions.every((fragment) => !insertedText.includes(fragment));

  await page.keyboard.press("End");
  await page.keyboard.type(
    `\n${Array.from(
      { length: 18 },
      (_, index) =>
        `Review the destination context exactly, line ${index + 1}.`,
    ).join("\n")}`,
  );
  const editedText = await textarea.inputValue();
  await inspector
    .getByRole("button", { name: "Review before sending", exact: true })
    .click();
  const confirmation = inspector.locator(
    '[role="group"][aria-label="Confirm Codex action"]',
  );
  await confirmation.waitFor({ state: "visible", timeout: 5_000 });
  const back = confirmation.getByRole("button", {
    name: "Back",
    exact: true,
  });
  const confirmationInitialFocus = await waitForLocatorFocus(page, back);
  const preview = confirmation.locator('[data-follow-up-preview="true"]');
  const exactPreview = (await preview.textContent()) === editedText;
  const previewContract =
    (await preview.getAttribute("aria-label")) ===
      "Follow-up instruction to send" &&
    (await preview.getAttribute("tabindex")) === "0";
  const disclosureExact =
    (await confirmation
      .getByText(
        "Coffice plan context was inserted into this draft. Review the exact text above; Coffice does not store the instruction.",
        { exact: true },
      )
      .count()) === 1;
  const confirmationLayout = await currentPlanContextActionLayout(inspector);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await waitForLocatorFocus(page, preview);
  const previewKeyboardScrollableAndFocused = await preview.evaluate(
    (element) => {
      const style = getComputedStyle(element);
      const visibleOutline = matchMedia("(forced-colors: active)").matches
        ? style.outlineStyle !== "none" &&
          Number.parseFloat(style.outlineWidth) >= 2
        : style.outlineColor === "rgb(78, 143, 121)";
      return (
        document.activeElement === element &&
        element.scrollHeight > element.clientHeight &&
        style.overflowY !== "visible" &&
        visibleOutline
      );
    },
  );
  await back.focus();
  screenshots.set(
    `${viewportId}-current-plan-context-confirmation`,
    await page.screenshot({ fullPage: false }),
  );

  await page.keyboard.press("Escape");
  await textarea.waitFor({ state: "visible", timeout: 5_000 });
  const escapeConfirmationRetainedEdit =
    (await textarea.inputValue()) === editedText &&
    (await waitForLocatorFocus(page, textarea));
  await inspector
    .getByRole("button", { name: "Review before sending", exact: true })
    .click();
  await confirmation.waitFor({ state: "visible", timeout: 5_000 });
  await back.click();
  const backRetainedEdit =
    (await textarea.inputValue()) === editedText &&
    (await waitForLocatorFocus(page, textarea));
  const writesBeforeCancel = fixtureState.workspaceWriteCount;
  const actionsBeforeCancel = await codexMutationCount(fixtureState);
  await inspector.getByRole("button", { name: "Cancel", exact: true }).click();
  await sendFollowUp.waitFor({ state: "visible", timeout: 5_000 });
  const explicitCancelRestoredFocus = await waitForLocatorFocus(
    page,
    sendFollowUp,
  );
  const cancelHadNoWrites =
    fixtureState.workspaceWriteCount === writesBeforeCancel &&
    (await codexMutationCount(fixtureState)) === actionsBeforeCancel;

  await sendFollowUp.click();
  await textarea.waitFor({ state: "visible", timeout: 5_000 });
  await textarea.fill("Temporary instruction cleared by Escape.");
  await page.keyboard.press("Escape");
  await sendFollowUp.waitFor({ state: "visible", timeout: 5_000 });
  const escapeComposeCancelled = await waitForLocatorFocus(page, sendFollowUp);
  await sendFollowUp.click();
  await textarea.waitFor({ state: "visible", timeout: 5_000 });
  const escapeComposeClearedDraft = (await textarea.inputValue()) === "";
  await insertion.click();
  await insertedStatus.waitFor({ state: "visible", timeout: 5_000 });
  const finalInstruction = await textarea.inputValue();
  await inspector
    .getByRole("button", { name: "Review before sending", exact: true })
    .click();
  await confirmation.waitFor({ state: "visible", timeout: 5_000 });
  const confirmSend = confirmation.getByRole("button", {
    name: "Confirm & send",
    exact: true,
  });
  const actionResponse = page.waitForResponse(
    (response) =>
      response.status() === 202 &&
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/codex-actions",
    { timeout: 5_000 },
  );
  await confirmSend.click();
  await actionResponse;
  const actionBody = fixtureState.consumeCodexActionBody();
  const exactDispatch =
    actionBody?.action === "send_follow_up" &&
    actionBody?.taskId === REVIEW_TASK_ID &&
    actionBody?.text === finalInstruction &&
    actionBody?.confirmed === true &&
    actionBody?.confirmationToken === "CONFIRM_SEND" &&
    typeof actionBody?.idempotencyKey === "string" &&
    actionBody.idempotencyKey.length > 0;
  const operationStatus = inspector.locator('[role="status"]').filter({
    hasText: "Codex is working on the follow-up.",
  });
  await operationStatus.waitFor({ state: "visible", timeout: 5_000 });
  const operationFocused = await waitForLocatorFocus(page, operationStatus);
  const operations = fixtureState.codexOperations();
  const structuralOperationOnly =
    operations.length === 1 &&
    operations[0]?.kind === "send_follow_up" &&
    operations[0]?.taskId === REVIEW_TASK_ID &&
    operations[0]?.state === "running" &&
    !JSON.stringify(operations).includes(finalInstruction);
  const storageSnapshot = await page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
    ),
  );
  const transientTextCleared =
    !(await inspector.textContent()).includes(finalInstruction) &&
    !JSON.stringify(storageSnapshot).includes(finalInstruction) &&
    fixtureState.pendingCodexActionBodyCount() === 0;
  const exactlyOneAction =
    (await codexMutationCount(fixtureState)) - codexMutationsBefore === 1;
  const noVerificationOrWorkspaceMutation =
    fixtureState.workspaceWriteCount === workspaceWritesBefore &&
    fixtureState.verificationReceiptCount() === verificationReceiptsBefore;
  fixtureState.clearCodexOperations();

  await page.keyboard.press("Escape");
  await inspector.waitFor({ state: "detached", timeout: 5_000 });
  fixtureState.makeCurrentPlanContextOversized();
  await enterProjectOffice(
    page,
    SECONDARY_PROJECT_ID,
    SECONDARY_TASK_COUNT + 1,
  );
  const oversizedTask = page.getByRole("button", {
    name: `Review ${REVIEW_TASK_TITLE}, Completed`,
    exact: true,
  });
  await oversizedTask.scrollIntoViewIfNeeded();
  await oversizedTask.click();
  await inspector.waitFor({ state: "visible", timeout: 5_000 });
  await inspector
    .getByRole("button", { name: "Send follow-up", exact: true })
    .click();
  const oversizedInsertion = inspector.getByRole("button", {
    name: "Insert current plan context",
    exact: true,
  });
  const oversizedHelperId =
    await oversizedInsertion.getAttribute("aria-describedby");
  const oversizedHelper = oversizedHelperId
    ? inspector.locator(`#${oversizedHelperId.replace(/([:.])/gu, "\\$1")}`)
    : inspector.locator("__missing_oversized_helper__");
  const oversizedBlocked =
    (await oversizedInsertion.isDisabled()) &&
    ((await oversizedHelper.textContent()) ?? "").includes(
      "The current plan context cannot fit in one Codex follow-up. You can still write a shorter instruction manually.",
    ) &&
    (await codexMutationCount(fixtureState)) - codexMutationsBefore === 1 &&
    fixtureState.workspaceWriteCount === workspaceWritesBefore;
  await page.keyboard.press("Escape");
  await sendFollowUp.waitFor({ state: "visible", timeout: 5_000 });
  await page.keyboard.press("Escape");
  await inspector.waitFor({ state: "detached", timeout: 5_000 });
  return {
    historicalSourceVisible,
    historicalRulesUseSourceProjectOnly,
    historicalRulesExact,
    historicalRulesAdvisoryExact,
    historicalRulesReadOnly,
    exactSourceProjectStillVisible,
    historicalDefinitionCurrent,
    historicalDefinitionOrderExact,
    historicalDefinitionHasNoControls,
    helperDescribesCurrentDestination,
    entryControlLayout,
    composeInitialFocus,
    composeLayout,
    insertionExact,
    insertionFocusAndCaret,
    insertHadNoWrites,
    privacyExact,
    confirmationInitialFocus,
    exactPreview,
    previewContract,
    disclosureExact,
    previewKeyboardScrollableAndFocused,
    confirmationLayout,
    escapeConfirmationRetainedEdit,
    backRetainedEdit,
    explicitCancelRestoredFocus,
    escapeComposeCancelled,
    escapeComposeClearedDraft,
    cancelHadNoWrites,
    exactDispatch,
    operationFocused,
    structuralOperationOnly,
    transientTextCleared,
    exactlyOneAction,
    noVerificationOrWorkspaceMutation,
    oversizedBlocked,
    projectRulesExcludedFromDraft: PROJECT_RULE_CANARIES.every(
      (canary) => !finalInstruction.includes(canary),
    ),
    instructionDigestShape: {
      length: finalInstruction.length,
      lineCount: finalInstruction.split("\n").length,
      currentDecisionCount: 2,
    },
  };
}

async function auditFailedCheckRepairFollowUp(
  page,
  screenshots,
  viewportId,
  fixtureState,
) {
  const projectRulesSourcePresent =
    JSON.stringify(fixtureState.projectRules()) ===
    JSON.stringify([PROJECT_RULE_REPAIR_SOURCE_CANARY]);
  const workspaceWritesBefore = fixtureState.workspaceWriteCount;
  const workspaceMutationAttemptsBefore =
    fixtureState.workspaceMutationAttemptCount;
  const verificationReceiptsBefore = fixtureState.verificationReceiptCount();
  const verificationMutationsBefore = fixtureState.verificationMutationCount();
  const codexMutationsBefore = await codexMutationCount(fixtureState);

  fixtureState.setFailedCheckRepairScenario("no_receipt");
  const verificationGetsBeforeNoReceipt = fixtureState.verificationGetCount();
  let composer = await openFailedCheckRepairComposer(page);
  await waitForFixtureCondition(
    () => fixtureState.verificationGetCount() > verificationGetsBeforeNoReceipt,
    "No-receipt repair scenario was not read by the verification controller.",
    7_000,
  );
  await composer.inspector
    .getByText("No quality-check receipt exists for this result yet.", {
      exact: true,
    })
    .waitFor({ state: "visible", timeout: 7_000 });
  await waitForFailedCheckRepairRowState(page, composer.repairInsertion, {
    state: "absent",
  });
  const noReceiptRowAbsent = (await composer.repairInsertion.count()) === 0;
  await closeFailedCheckRepairInspector(
    page,
    composer.inspector,
    composer.sendFollowUp,
  );

  fixtureState.setFailedCheckRepairScenario("later_pass");
  const verificationGetsBeforeLaterPass = fixtureState.verificationGetCount();
  composer = await openFailedCheckRepairComposer(page);
  await waitForFixtureCondition(
    () => fixtureState.verificationGetCount() > verificationGetsBeforeLaterPass,
    "Later-pass repair scenario was not read by the verification controller.",
    7_000,
  );
  await composer.inspector
    .locator('[data-verification-state="passed"]')
    .waitFor({ state: "visible", timeout: 7_000 });
  await waitForFailedCheckRepairRowState(page, composer.repairInsertion, {
    state: "absent",
  });
  const laterPassRowAbsent = (await composer.repairInsertion.count()) === 0;
  await closeFailedCheckRepairInspector(
    page,
    composer.inspector,
    composer.sendFollowUp,
  );

  fixtureState.setFailedCheckRepairScenario("oversized");
  composer = await openFailedCheckRepairComposer(page);
  await waitForFailedCheckRepairRowState(page, composer.repairInsertion, {
    state: "disabled",
    helperText:
      "The repair context cannot fit in one Codex follow-up. You can still write a shorter instruction manually.",
  });
  const oversizedHelperId =
    await composer.repairInsertion.getAttribute("aria-describedby");
  const oversizedHelper = oversizedHelperId
    ? composer.inspector.locator(
        `#${oversizedHelperId.replace(/([:.])/gu, "\\$1")}`,
      )
    : composer.inspector.locator("__missing_repair_oversized_helper__");
  const oversizedCandidateDisabled =
    (await composer.repairInsertion.isDisabled()) &&
    ((await oversizedHelper.textContent()) ?? "").includes(
      "The repair context cannot fit in one Codex follow-up. You can still write a shorter instruction manually.",
    ) &&
    (await composer.textarea.inputValue()) === "";
  await closeFailedCheckRepairInspector(
    page,
    composer.inspector,
    composer.sendFollowUp,
  );

  fixtureState.setFailedCheckRepairScenario("ready");
  fixtureState.setFailedCheckRepairRecoveryLocked(true);
  composer = await openFailedCheckRepairComposer(page);
  await waitForFailedCheckRepairRowState(page, composer.repairInsertion, {
    state: "disabled",
    helperText:
      "Repair context is unavailable because the local Coffice workspace is not safely available.",
  });
  const safetyHelperId =
    await composer.repairInsertion.getAttribute("aria-describedby");
  const safetyHelper = safetyHelperId
    ? composer.inspector.locator(
        `#${safetyHelperId.replace(/([:.])/gu, "\\$1")}`,
      )
    : composer.inspector.locator("__missing_repair_safety_helper__");
  const safetyCandidateDisabled =
    (await composer.repairInsertion.isDisabled()) &&
    ((await safetyHelper.textContent()) ?? "").includes(
      "Repair context is unavailable because the local Coffice workspace is not safely available.",
    ) &&
    (await composer.textarea.inputValue()) === "";
  await closeFailedCheckRepairInspector(
    page,
    composer.inspector,
    composer.sendFollowUp,
  );

  fixtureState.setFailedCheckRepairScenario("ready");
  composer = await openFailedCheckRepairComposer(page);
  await waitForFailedCheckRepairRowState(page, composer.repairInsertion, {
    state: "enabled",
    helperText:
      "Copies the current plan plus the latest failed check and its status into this editable draft.",
  });
  const helperId =
    await composer.repairInsertion.getAttribute("aria-describedby");
  const helper = helperId
    ? composer.inspector.locator(`#${helperId.replace(/([:.])/gu, "\\$1")}`)
    : composer.inspector.locator("__missing_repair_helper__");
  const helperExact =
    ((await helper.textContent()) ?? "").replace(/\s+/gu, " ").trim() ===
    "Copies the current plan plus the latest failed check and its status into this editable draft. Nothing is repaired, rerun, or sent until you review and confirm.";
  const composeInitialFocus = await waitForLocatorFocus(
    page,
    composer.textarea,
  );
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const entryKeyboardFocus = await waitForLocatorFocus(
    page,
    composer.repairInsertion,
  );
  const entryControlLayout = await currentPlanContextEntryControlLayout(
    composer.repairInsertion,
  );
  const composeLayout = await currentPlanContextActionLayout(
    composer.inspector,
  );

  await composer.textarea.fill("Manual text blocks generated repair context.");
  const emptyOnlyInsertion =
    (await composer.repairInsertion.isDisabled()) &&
    ((await helper.textContent()) ?? "").includes(
      "Repair context can only be inserted into an empty instruction. Clear this draft first.",
    );
  await composer.textarea.fill("");
  await composer.repairInsertion.waitFor({ state: "visible", timeout: 5_000 });
  await composer.repairInsertion.evaluate((button) => {
    if (button.disabled) throw new Error("Repair insertion did not re-enable.");
  });

  const actionsBeforeInsert = await codexMutationCount(fixtureState);
  const workspaceAttemptsBeforeInsert =
    fixtureState.workspaceMutationAttemptCount;
  const verificationActionsBeforeInsert =
    fixtureState.verificationMutationCount();
  await composer.repairInsertion.click();
  const insertedStatus = composer.inspector.getByRole("status").filter({
    hasText:
      "Prepared from the current failed quality check. Review and edit before sending; Coffice has not repaired or rerun anything.",
  });
  await insertedStatus.waitFor({ state: "visible", timeout: 5_000 });
  const insertedText = await composer.textarea.inputValue();
  const insertionExact = insertedText === FAILED_CHECK_REPAIR_DRAFT;
  const insertionFocusAndCaret = await waitForTextareaFocusAndCaretAtEnd(
    page,
    composer.textarea,
  );
  const insertHadNoWrites =
    (await codexMutationCount(fixtureState)) === actionsBeforeInsert &&
    fixtureState.workspaceMutationAttemptCount ===
      workspaceAttemptsBeforeInsert &&
    fixtureState.verificationMutationCount() ===
      verificationActionsBeforeInsert;
  const latestExactReceiptOnly =
    insertedText.includes("Failed quality check: Lint") &&
    insertedText.includes("Observed outcome: Failed · exit 23") &&
    !insertedText.includes("Timed out") &&
    !insertedText.includes("Could not start") &&
    !insertedText.includes("Failed · exit 41");
  const privacyExclusions = [
    FAILED_CHECK_REPAIR_OLDER_RECEIPT_ID,
    FAILED_CHECK_REPAIR_LATEST_RECEIPT_ID,
    FAILED_CHECK_REPAIR_OTHER_RECEIPT_ID,
    FAILED_CHECK_REPAIR_OLDER_RESULT_ID,
    `${FAILED_CHECK_REPAIR_OLDER_RECEIPT_ID}-private-request-key`,
    `${FAILED_CHECK_REPAIR_LATEST_RECEIPT_ID}-private-request-key`,
    `${FAILED_CHECK_REPAIR_OTHER_RECEIPT_ID}-private-request-key`,
    "b".repeat(64),
    "c".repeat(64),
    "d".repeat(64),
    "e".repeat(64),
    PRIMARY_PROJECT_ID,
    REVIEW_OBJECTIVE_ID,
    REVIEW_WORK_ITEM_ID,
    REVIEW_ATTEMPT_ID,
    REVIEW_TASK_ID,
    REVIEW_TASK_TITLE,
    "Acceptance Office",
    "acceptance-model",
    "acceptance:completed",
    FAILED_CHECK_REPAIR_PRIVATE_PATH,
    FAILED_CHECK_REPAIR_PRIVATE_COMMAND,
    FAILED_CHECK_REPAIR_PRIVATE_OUTPUT,
    FAILED_CHECK_REPAIR_PRIVATE_REFERENCE,
    FAILED_CHECK_REPAIR_ASSESSMENT_SUMMARY,
    FAILED_CHECK_REPAIR_ASSESSMENT_RISK,
    FAILED_CHECK_REPAIR_ASSESSMENT_NEXT_ACTION,
    "acceptance-repair-private-evidence-id",
    DEFINITION_OF_DONE_PRIVATE_CANARY,
    DEFINITION_OF_DONE_LONG_ENTRY,
    "Review the exact completed result.",
  ];
  const privacyExact =
    insertedText.includes(REVIEW_DECISION_LONG_STATEMENT) &&
    insertedText.includes(REVIEW_DECISION_PLAIN_CONTEXT) &&
    insertedText.includes(REVIEW_DECISION_SECOND_STATEMENT) &&
    privacyExclusions.every((fragment) => !insertedText.includes(fragment));

  await page.keyboard.press("End");
  await page.keyboard.type(
    `\n${Array.from(
      { length: 18 },
      (_, index) => `Keep repair scope exact, review line ${index + 1}.`,
    ).join("\n")}`,
  );
  const editedText = await composer.textarea.inputValue();
  await composer.inspector
    .getByRole("button", { name: "Review before sending", exact: true })
    .click();
  const confirmation = composer.inspector.locator(
    '[role="group"][aria-label="Confirm Codex action"]',
  );
  await confirmation.waitFor({ state: "visible", timeout: 5_000 });
  const back = confirmation.getByRole("button", { name: "Back", exact: true });
  const confirmationInitialFocus = await waitForLocatorFocus(page, back);
  const preview = confirmation.locator('[data-follow-up-preview="true"]');
  const exactPreview = (await preview.textContent()) === editedText;
  const previewContract =
    (await preview.getAttribute("aria-label")) ===
      "Follow-up instruction to send" &&
    (await preview.getAttribute("tabindex")) === "0";
  const disclosureExact =
    (await confirmation
      .getByText(
        "Coffice plan and failed-check context were inserted into this draft. Review the exact text above; Coffice has not repaired or rerun anything and does not store the instruction.",
        { exact: true },
      )
      .count()) === 1;
  const confirmationLayout = await currentPlanContextActionLayout(
    composer.inspector,
  );
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await waitForLocatorFocus(page, preview);
  const previewKeyboardScrollableAndFocused = await preview.evaluate(
    (element) => {
      const style = getComputedStyle(element);
      const visibleOutline = matchMedia("(forced-colors: active)").matches
        ? style.outlineStyle !== "none" &&
          Number.parseFloat(style.outlineWidth) >= 2
        : style.outlineColor === "rgb(78, 143, 121)";
      return (
        document.activeElement === element &&
        element.scrollHeight > element.clientHeight &&
        style.overflowY !== "visible" &&
        visibleOutline
      );
    },
  );
  await back.focus();
  screenshots.set(
    `${viewportId}-failed-check-repair-confirmation`,
    await page.screenshot({ fullPage: false }),
  );

  await page.keyboard.press("Escape");
  await composer.textarea.waitFor({ state: "visible", timeout: 5_000 });
  const escapeConfirmationRetainedEdit =
    (await composer.textarea.inputValue()) === editedText &&
    (await waitForLocatorFocus(page, composer.textarea));
  await composer.inspector
    .getByRole("button", { name: "Review before sending", exact: true })
    .click();
  await confirmation.waitFor({ state: "visible", timeout: 5_000 });
  await back.click();
  const backRetainedEdit =
    (await composer.textarea.inputValue()) === editedText &&
    (await waitForLocatorFocus(page, composer.textarea));
  const mutationsBeforeCancel = {
    codex: await codexMutationCount(fixtureState),
    workspace: fixtureState.workspaceMutationAttemptCount,
    verification: fixtureState.verificationMutationCount(),
  };
  await composer.inspector
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await composer.sendFollowUp.waitFor({ state: "visible", timeout: 5_000 });
  const explicitCancelRestoredFocus = await waitForLocatorFocus(
    page,
    composer.sendFollowUp,
  );
  const cancelHadNoWrites =
    (await codexMutationCount(fixtureState)) === mutationsBeforeCancel.codex &&
    fixtureState.workspaceMutationAttemptCount ===
      mutationsBeforeCancel.workspace &&
    fixtureState.verificationMutationCount() ===
      mutationsBeforeCancel.verification;

  await composer.sendFollowUp.click();
  await composer.textarea.waitFor({ state: "visible", timeout: 5_000 });
  await composer.textarea.fill("Temporary repair draft cleared by Escape.");
  await page.keyboard.press("Escape");
  await composer.sendFollowUp.waitFor({ state: "visible", timeout: 5_000 });
  const escapeComposeCancelled = await waitForLocatorFocus(
    page,
    composer.sendFollowUp,
  );
  await composer.sendFollowUp.click();
  await composer.textarea.waitFor({ state: "visible", timeout: 5_000 });
  const escapeComposeClearedDraft =
    (await composer.textarea.inputValue()) === "";

  await composer.repairInsertion.waitFor({ state: "visible", timeout: 5_000 });
  await composer.repairInsertion.click();
  await insertedStatus.waitFor({ state: "visible", timeout: 5_000 });
  await composer.textarea.press("End");
  await composer.textarea.pressSequentially(
    "\nPreserve this edit across exact-receipt invalidation.",
  );
  const staleReceiptDraft = await composer.textarea.inputValue();
  await composer.inspector
    .getByRole("button", { name: "Review before sending", exact: true })
    .click();
  await confirmation.waitFor({ state: "visible", timeout: 5_000 });
  const mutationsBeforeStaleReceipt = await codexMutationCount(fixtureState);
  fixtureState.setLiveFailedCheckRepairMismatch(true);
  const invalidationStatus = composer.inspector.getByRole("status").filter({
    hasText:
      "The failed check, result, plan link, or copied plan context changed. Your draft was preserved as ordinary text. Review it again before sending.",
  });
  await invalidationStatus.waitFor({ state: "visible", timeout: 7_000 });
  const staleReceiptPreservedDraft =
    (await composer.textarea.inputValue()) === staleReceiptDraft &&
    (await waitForLocatorFocus(page, composer.textarea)) &&
    (await confirmation.count()) === 0;
  const staleReceiptPreventedDispatch =
    (await codexMutationCount(fixtureState)) === mutationsBeforeStaleReceipt;
  const readsBeforeReceiptRestore = fixtureState.workspaceReadCount();
  fixtureState.setLiveFailedCheckRepairMismatch(false);
  await waitForFixtureCondition(
    () => fixtureState.workspaceReadCount() > readsBeforeReceiptRestore,
    "Restored failed-check receipt did not refresh the workspace.",
    7_000,
  );
  await composer.inspector
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await composer.sendFollowUp.waitFor({ state: "visible", timeout: 5_000 });

  await composer.sendFollowUp.click();
  await composer.textarea.waitFor({ state: "visible", timeout: 5_000 });
  await composer.repairInsertion.waitFor({ state: "visible", timeout: 5_000 });
  await composer.repairInsertion.evaluate((button) => {
    if (button.disabled)
      throw new Error("Restored repair source stayed disabled.");
  });
  await composer.repairInsertion.click();
  await insertedStatus.waitFor({ state: "visible", timeout: 5_000 });
  await composer.textarea.press("End");
  await composer.textarea.pressSequentially(
    "\nPreserve this edit across source eligibility invalidation.",
  );
  const staleSourceDraft = await composer.textarea.inputValue();
  const readsBeforeRecoveryLock = fixtureState.workspaceReadCount();
  fixtureState.setFailedCheckRepairRecoveryLocked(true);
  await waitForFixtureCondition(
    () => fixtureState.workspaceReadCount() > readsBeforeRecoveryLock,
    "Repair safety-state change did not refresh the workspace.",
    7_000,
  );
  const mutationsBeforeStaleSource = await codexMutationCount(fixtureState);
  await composer.inspector
    .getByRole("button", { name: "Review before sending", exact: true })
    .click();
  await invalidationStatus.waitFor({ state: "visible", timeout: 5_000 });
  const staleSourcePreservedDraft =
    (await composer.textarea.inputValue()) === staleSourceDraft &&
    (await waitForLocatorFocus(page, composer.textarea)) &&
    (await confirmation.count()) === 0;
  const staleSourcePreventedDispatch =
    (await codexMutationCount(fixtureState)) === mutationsBeforeStaleSource;
  const readsBeforeRecoveryRestore = fixtureState.workspaceReadCount();
  fixtureState.setFailedCheckRepairRecoveryLocked(false);
  await waitForFixtureCondition(
    () => fixtureState.workspaceReadCount() > readsBeforeRecoveryRestore,
    "Restored repair safety state did not refresh the workspace.",
    7_000,
  );
  await composer.inspector
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await composer.sendFollowUp.waitFor({ state: "visible", timeout: 5_000 });

  await composer.sendFollowUp.click();
  await composer.textarea.waitFor({ state: "visible", timeout: 5_000 });
  await composer.repairInsertion.waitFor({ state: "visible", timeout: 5_000 });
  await composer.repairInsertion.evaluate((button) => {
    if (button.disabled) throw new Error("Final repair insertion is disabled.");
  });
  await composer.repairInsertion.click();
  await insertedStatus.waitFor({ state: "visible", timeout: 5_000 });
  const finalInstruction = await composer.textarea.inputValue();
  await composer.inspector
    .getByRole("button", { name: "Review before sending", exact: true })
    .click();
  await confirmation.waitFor({ state: "visible", timeout: 5_000 });
  const actionResponse = page.waitForResponse(
    (response) =>
      response.status() === 202 &&
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/codex-actions",
    { timeout: 5_000 },
  );
  await confirmation
    .getByRole("button", { name: "Confirm & send", exact: true })
    .click();
  await actionResponse;
  const actionBody = fixtureState.consumeCodexActionBody();
  const exactDispatch =
    actionBody?.action === "send_follow_up" &&
    actionBody?.taskId === REVIEW_TASK_ID &&
    actionBody?.text === finalInstruction &&
    actionBody?.confirmed === true &&
    actionBody?.confirmationToken === "CONFIRM_SEND" &&
    typeof actionBody?.idempotencyKey === "string" &&
    actionBody.idempotencyKey.length > 0;
  const operationStatus = composer.inspector.locator('[role="status"]').filter({
    hasText: "Codex is working on the follow-up.",
  });
  await operationStatus.waitFor({ state: "visible", timeout: 5_000 });
  const operationFocused = await waitForLocatorFocus(page, operationStatus);
  const operations = fixtureState.codexOperations();
  const structuralOperationOnly =
    operations.length === 1 &&
    operations[0]?.kind === "send_follow_up" &&
    operations[0]?.taskId === REVIEW_TASK_ID &&
    operations[0]?.state === "running" &&
    !JSON.stringify(operations).includes(finalInstruction);
  const storageSnapshot = await page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
    ),
  );
  const transientTextCleared =
    !(await composer.inspector.textContent()).includes(finalInstruction) &&
    !JSON.stringify(storageSnapshot).includes(finalInstruction) &&
    fixtureState.pendingCodexActionBodyCount() === 0;
  const exactlyOneAction =
    (await codexMutationCount(fixtureState)) - codexMutationsBefore === 1;
  const noVerificationOrWorkspaceMutation =
    fixtureState.workspaceWriteCount === workspaceWritesBefore &&
    fixtureState.workspaceMutationAttemptCount ===
      workspaceMutationAttemptsBefore &&
    fixtureState.verificationMutationCount() === verificationMutationsBefore;
  const receiptCountUnchanged =
    fixtureState.verificationReceiptCount() === verificationReceiptsBefore;
  const verificationReadsOnly =
    fixtureState.verificationRouteRequests.length > 0 &&
    fixtureState.verificationMutationCount() === 0;
  fixtureState.clearCodexOperations();
  await page.keyboard.press("Escape");
  await composer.inspector.waitFor({ state: "detached", timeout: 5_000 });

  return {
    projectRulesSourcePresent,
    noReceiptRowAbsent,
    laterPassRowAbsent,
    oversizedCandidateDisabled,
    safetyCandidateDisabled,
    helperExact,
    composeInitialFocus,
    entryKeyboardFocus,
    entryControlLayout,
    composeLayout,
    emptyOnlyInsertion,
    insertionExact,
    insertionFocusAndCaret,
    insertHadNoWrites,
    latestExactReceiptOnly,
    privacyExact,
    confirmationInitialFocus,
    exactPreview,
    previewContract,
    disclosureExact,
    previewKeyboardScrollableAndFocused,
    confirmationLayout,
    escapeConfirmationRetainedEdit,
    backRetainedEdit,
    explicitCancelRestoredFocus,
    cancelHadNoWrites,
    escapeComposeCancelled,
    escapeComposeClearedDraft,
    staleReceiptPreservedDraft,
    staleReceiptPreventedDispatch,
    staleSourcePreservedDraft,
    staleSourcePreventedDispatch,
    exactDispatch,
    operationFocused,
    structuralOperationOnly,
    transientTextCleared,
    exactlyOneAction,
    noVerificationOrWorkspaceMutation,
    receiptCountUnchanged,
    verificationReadsOnly,
    projectRulesExcludedFromDraft: PROJECT_RULE_CANARIES.every(
      (canary) => !finalInstruction.includes(canary),
    ),
    routeCounts: {
      codexMutations:
        (await codexMutationCount(fixtureState)) - codexMutationsBefore,
      verificationGets: fixtureState.verificationRouteRequests.filter(
        (request) => request.method === "GET",
      ).length,
      verificationMutations: fixtureState.verificationMutationCount(),
      workspaceMutationAttempts:
        fixtureState.workspaceMutationAttemptCount -
        workspaceMutationAttemptsBefore,
    },
    instructionShape: {
      length: finalInstruction.length,
      lineCount: finalInstruction.split("\n").length,
      activeDecisionCount: 2,
    },
  };
}

async function auditReviewProjectDecisions(
  page,
  inspector,
  screenshots,
  viewportId,
  fixtureState,
) {
  const disclosure = inspector.locator(
    `[data-current-project-decisions="${PRIMARY_PROJECT_ID}"]`,
  );
  await disclosure.waitFor({ state: "attached", timeout: 5_000 });
  const summary = disclosure.locator("summary");
  const writesBefore = fixtureState.workspaceWriteCount;
  const codexMutationsBefore = fixtureState.codexRouteRequests.filter(
    (request) => request.method !== "GET" && request.method !== "HEAD",
  ).length;
  const collapsed = await disclosure.evaluate((surface) => ({
    open: surface.hasAttribute("open"),
    bodyVisible: surface.querySelector("div")?.checkVisibility() ?? false,
  }));
  await summary.scrollIntoViewIfNeeded();
  await summary.focus();
  const keyboardFocusBeforeOpen = await summary.evaluate(
    (element) => document.activeElement === element,
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (projectId) =>
      document
        .querySelector(`[data-current-project-decisions="${projectId}"]`)
        ?.hasAttribute("open"),
    PRIMARY_PROJECT_ID,
  );
  const expanded = await disclosure.evaluate(
    (surface, expected) => {
      const bounds = surface.getBoundingClientRect();
      const inspector = surface.closest('[data-review-act-inspector="true"]');
      const inspectorBounds = inspector?.getBoundingClientRect();
      const ids = Array.from(
        surface.querySelectorAll("[data-project-decision-id]"),
        (item) => item.getAttribute("data-project-decision-id"),
      );
      const text = surface.textContent?.replace(/\s+/gu, " ").trim() ?? "";
      return {
        open: surface.hasAttribute("open"),
        summaryFocused:
          document.activeElement === surface.querySelector("summary"),
        ariaLabel: surface.querySelector("summary")?.getAttribute("aria-label"),
        projectId: surface.getAttribute("data-current-project-decisions"),
        ids,
        currentCount: ids.length,
        longStatementPresent: text.includes(expected.longStatement),
        plainContextPresent: text.includes(expected.plainContext),
        secondStatementPresent: text.includes(expected.secondStatement),
        supersededAbsent: !text.includes("Use the superseded review wording."),
        withdrawnAbsent: !text.includes(
          "This withdrawn decision must stay out of Review & Act.",
        ),
        markupNotInterpreted: surface.querySelector("source-project") === null,
        withinInspector: Boolean(
          inspectorBounds &&
          bounds.left >= inspectorBounds.left - 1 &&
          bounds.right <= inspectorBounds.right + 1,
        ),
        withinViewport: bounds.left >= -1 && bounds.right <= innerWidth + 1,
        noHorizontalOverflow:
          surface.scrollWidth <= surface.clientWidth + 1 &&
          document.documentElement.scrollWidth <= innerWidth + 1,
      };
    },
    {
      longStatement: REVIEW_DECISION_LONG_STATEMENT,
      plainContext: REVIEW_DECISION_PLAIN_CONTEXT,
      secondStatement: REVIEW_DECISION_SECOND_STATEMENT,
    },
  );
  screenshots.set(
    `${viewportId}-review-project-decisions`,
    await page.screenshot({ fullPage: false }),
  );
  await page.keyboard.press("Enter");
  const closedByKeyboard = await disclosure.evaluate(
    (surface) =>
      !surface.hasAttribute("open") &&
      document.activeElement === surface.querySelector("summary"),
  );
  const writesAfter = fixtureState.workspaceWriteCount;
  const codexMutationsAfter = fixtureState.codexRouteRequests.filter(
    (request) => request.method !== "GET" && request.method !== "HEAD",
  ).length;
  return {
    collapsed,
    keyboardFocusBeforeOpen,
    expanded,
    closedByKeyboard,
    noWorkspaceWrites: writesAfter === writesBefore,
    noCodexMutations: codexMutationsAfter === codexMutationsBefore,
  };
}

async function auditReviewWorkspace(
  page,
  screenshots,
  viewportId,
  fixtureState,
) {
  const toggle = attentionToggle(page);
  await waitForAttentionCount(page, PRIMARY_ATTENTION_COUNT);
  const initialTrigger = await readAttentionTrigger(toggle);
  await toggle.focus();
  await toggle.click();
  const inbox = page.locator('[data-attention-inbox="true"]');
  await inbox.waitFor({ state: "visible", timeout: 5_000 });
  const itemCount = await inbox.locator("[data-attention-item]").count();
  const scopeProjectId = await inbox.getAttribute(
    "data-attention-scope-project-id",
  );
  const scopeHeadingCount = await inbox
    .getByRole("heading", {
      name: "Acceptance Office attention",
      exact: true,
    })
    .count();
  const scopeIntroCount = await inbox
    .getByText("Only current observed actions for Acceptance Office.", {
      exact: true,
    })
    .count();
  const itemTexts = (
    await inbox.locator("[data-attention-item]").allTextContents()
  ).map((item) => item.replace(/\s+/gu, " ").trim());
  const secondaryItemCount = await inbox
    .locator("[data-attention-item]")
    .filter({ hasText: /Secondary (?:Agent|Office)/u })
    .count();
  const initialContainment = await inspectAttentionPanelContainment(inbox);
  const initialFocusOnItem = await page.evaluate(() =>
    Boolean(document.activeElement?.closest("[data-attention-item]")),
  );
  const inboxModal =
    (await inbox.getAttribute("role")) === "dialog" &&
    (await inbox.getAttribute("aria-modal")) === "true";
  const shellInert = await page
    .locator(".app-shell")
    .evaluate(
      (shell) => shell.inert && shell.getAttribute("aria-hidden") === "true",
    );
  const inboxTrap = await auditFocusTrap(page, inbox);
  await page.keyboard.press("Tab");
  const inboxFocusWrapped = await inbox.evaluate((surface) => {
    const first = Array.from(
      surface.querySelectorAll(
        'button:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])',
      ),
    ).find((control) => control.getClientRects().length > 0);
    return document.activeElement === first;
  });
  if (viewportId === "desktop") {
    screenshots.set(
      "desktop-attention",
      await page.screenshot({ fullPage: false }),
    );
  }
  await page.keyboard.press("Escape");
  await inbox.waitFor({ state: "detached", timeout: 5_000 });
  await page.waitForFunction(() =>
    document.activeElement
      ?.getAttribute("aria-label")
      ?.startsWith("Attention for "),
  );
  const inboxFocusRestored = await toggle.evaluate(
    (element) => document.activeElement === element,
  );

  await toggle.click();
  await inbox.waitFor({ state: "visible", timeout: 5_000 });
  const reviewItem = inbox
    .locator("[data-attention-item]")
    .filter({ hasText: "Acceptance Agent 04" })
    .first();
  await reviewItem.waitFor({ state: "visible", timeout: 5_000 });
  const initialCompletionVisible = (await reviewItem.count()) === 1;
  const seenReceiptResponse = page.waitForResponse(
    (response) => {
      if (
        response.status() !== 200 ||
        response.request().method() !== "PATCH"
      ) {
        return false;
      }
      const mutation = response.request().postDataJSON()?.mutation;
      return (
        mutation?.type === "attention.event" &&
        mutation.eventKey === fixtureState.initialResultKey.id &&
        mutation.disposition?.kind === "needs_review"
      );
    },
    { timeout: 5_000 },
  );
  await reviewItem.click();
  const inspector = page.locator('[data-review-act-inspector="true"]');
  await inspector.waitFor({ state: "visible", timeout: 5_000 });
  await seenReceiptResponse;
  const definitionOfDoneSection = inspector.locator(
    '[aria-labelledby="definition-of-done-heading"]',
  );
  const reviewDefinitionOfDone = {
    sectionCount: await definitionOfDoneSection.count(),
    exactCount:
      (await definitionOfDoneSection
        .getByText("3 criteria", { exact: true })
        .count()) === 1,
    currentCriteriaVisible:
      (await definitionOfDoneSection.locator("ol > li").count()) === 3,
    exactOrder:
      JSON.stringify(
        await definitionOfDoneSection.locator("ol > li").allTextContents(),
      ) ===
      JSON.stringify([
        "Review the exact completed result.",
        DEFINITION_OF_DONE_PRIVATE_CANARY,
        DEFINITION_OF_DONE_LONG_ENTRY,
      ]),
    noEditOrCheckControls:
      (await definitionOfDoneSection
        .locator("button, input, textarea, select")
        .count()) === 0,
    advisoryExact:
      (await definitionOfDoneSection
        .getByText(
          "Current work-item context—not a snapshot stored with this result. Coffice does not verify these criteria automatically.",
          { exact: true },
        )
        .count()) === 1,
  };
  const workLinksSection = inspector.locator(
    '[data-current-work-links="true"]',
  );
  const reviewWorkItemRelationships = {
    sectionCount: await workLinksSection.count(),
    exactCount:
      (await workLinksSection.getByText("1 link", { exact: true }).count()) ===
      1,
    exactSourceLink: (await workLinksSection.locator("ol > li").allInnerTexts())
      .map((text) => text.replace(/\s+/gu, " ").trim())
      .includes(`Depends on ${RELEASE_MILESTONE_TITLE}`),
    noEditOrCheckControls:
      (await workLinksSection
        .locator("button, input, textarea, select")
        .count()) === 0,
    advisoryExact:
      (await workLinksSection
        .getByText(
          "Current work-item context—not a snapshot stored with this result. These links are advisory and do not determine readiness or acceptance.",
          { exact: true },
        )
        .count()) === 1,
  };
  const contextReviewSection = inspector.locator(
    '[data-current-project-context-review="true"]',
  );
  const reviewProjectContextReview = {
    sectionCount: await contextReviewSection.count(),
    exactConcern:
      (await contextReviewSection
        .getByText("Stale", { exact: true })
        .count()) === 1,
    exactNote:
      (await contextReviewSection
        .getByText(PROJECT_CONTEXT_REVIEW_INITIAL_CANARY, { exact: true })
        .count()) === 1,
    advisoryExact:
      (await contextReviewSection
        .getByText(
          /User-declared current project context—not inferred and not a snapshot stored with this result\. Review and acceptance remain your decisions\./u,
        )
        .count()) === 1,
    noControls:
      (await contextReviewSection
        .locator("button, input, textarea, select")
        .count()) === 0,
  };
  await contextReviewSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(60);
  screenshots.set(
    `${viewportId}-review-context-review`,
    await page.screenshot({ fullPage: false }),
  );
  const seenReceiptPersisted =
    fixtureState.attentionDisposition(fixtureState.initialResultKey.id)
      ?.kind === "needs_review";
  const seenEventKeyMatchesInitial =
    fixtureState.seenAttentionEventKeys.length === 1 &&
    fixtureState.seenAttentionEventKeys[0] === fixtureState.initialResultKey.id;
  const workspaceWriteCountAfterSeen = fixtureState.workspaceWriteCount;
  const attentionFailureCountAfterSeen =
    fixtureState.attentionEventFailureCount;
  await page.keyboard.press("Escape");
  await inspector.waitFor({ state: "detached", timeout: 5_000 });
  await page.waitForFunction(() =>
    document.activeElement
      ?.getAttribute("aria-label")
      ?.startsWith("Attention for "),
  );
  const triggerAfterSeen = await readAttentionTrigger(toggle);
  const drawerAfterSeen = await auditProjectDrawer(page, fixtureState);
  const digestAfterSeen = await auditActionableDigest(
    page,
    screenshots,
    viewportId,
    "after-seen",
    `Open digest, ${GLOBAL_ATTENTION_COUNT} actions, ${GLOBAL_NEEDS_REPLY_COUNT} reply needed, 0 decisions needed, 1 unread result`,
    fixtureState,
  );

  await waitForAttentionCount(page, PRIMARY_ATTENTION_COUNT);
  const triggerAfterSeenNavigation = await readAttentionTrigger(toggle);
  await toggle.click();
  await inbox.waitFor({ state: "visible", timeout: 5_000 });
  const itemCountAfterSeen = await inbox
    .locator("[data-attention-item]")
    .count();
  const secondaryCountAfterSeen = await inbox
    .locator("[data-attention-item]")
    .filter({ hasText: /Secondary (?:Agent|Office)/u })
    .count();
  await reviewItem.waitFor({ state: "visible", timeout: 5_000 });
  await reviewItem.click();
  await inspector.waitFor({ state: "visible", timeout: 5_000 });
  const openInCodex = inspector.getByRole("link", { name: /Open in Codex/u });
  const inspectorModal =
    (await inspector.getAttribute("role")) === "dialog" &&
    (await inspector.getAttribute("aria-modal")) === "true";
  const inspectorInitialFocus = await openInCodex.evaluate(
    (element) => document.activeElement === element,
  );
  const codexLink = await openInCodex.getAttribute("href");
  const inspectorTrap = await auditFocusTrap(page, inspector);
  await page.keyboard.press("Tab");
  const inspectorFocusWrapped = await inspector.evaluate((surface) => {
    const first = Array.from(
      surface.querySelectorAll(
        'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
      ),
    ).find((control) => control.getClientRects().length > 0);
    return document.activeElement === first;
  });

  const projectDecisions = await auditReviewProjectDecisions(
    page,
    inspector,
    screenshots,
    viewportId,
    fixtureState,
  );

  const exactCard = inspector.locator('[data-review-assessment="result"]');
  const workCard = inspector.locator('[data-review-assessment="work-item"]');
  await exactCard.waitFor({ state: "visible", timeout: 5_000 });
  await workCard.waitFor({ state: "visible", timeout: 5_000 });
  const exactRest = await inspectAssessmentCard(exactCard);
  const workRest = await inspectAssessmentCard(workCard);
  const scopeLabels = await inspector
    .locator("[data-review-assessment] header span")
    .allTextContents();
  const recordedLabels = await inspector
    .locator("[data-review-assessment] header b")
    .allTextContents();
  const exactDisclosure = exactCard.getByText("Review saved notes", {
    exact: true,
  });
  await exactDisclosure.focus();
  const exactDisclosureKeyboardReachable = await exactDisclosure.evaluate(
    (element) => document.activeElement === element,
  );
  await exactDisclosure.click();
  const exactDisclosureOpened =
    (await exactCard.locator("details").getAttribute("open")) !== null;
  const exactText = (await exactCard.innerText()).replace(/\s+/gu, " ").trim();
  await exactDisclosure.click();
  const selfCritiqueCount = await inspector
    .getByText("Agent self-critique: not reported.", { exact: true })
    .count();

  await workCard.getByRole("button", { name: "Record notes" }).click();
  const reviewSummary = workCard.getByLabel(/^Your assessment/u);
  await reviewSummary.waitFor({ state: "visible", timeout: 5_000 });
  await page.waitForFunction(
    () =>
      document.activeElement
        ?.closest("label")
        ?.textContent?.startsWith("Your assessment"),
    undefined,
    { timeout: 5_000 },
  );
  const initialEditorFocus = await reviewSummary.evaluate(
    (element) => document.activeElement === element,
  );
  const uncertainty = workCard.getByLabel(/^Uncertainties/u);
  await uncertainty.waitFor({ state: "visible", timeout: 5_000 });
  await uncertainty.focus();
  const editorFocusReached = await uncertainty.evaluate(
    (element) => document.activeElement === element,
  );
  await uncertainty.fill("Work-item behavior on narrow screens needs review.");
  const workEditor = await inspectAssessmentCard(workCard);
  screenshots.set(
    `${viewportId}-review-notes-editor`,
    await page.screenshot({ fullPage: false }),
  );
  await workCard.getByRole("button", { name: "Save notes" }).click();
  await workCard
    .getByText("You recorded", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  const saveStatus = workCard.getByRole("status");
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("role") === "status",
    undefined,
    { timeout: 5_000 },
  );
  const saveFocusHandoff = await saveStatus.evaluate(
    (element) => document.activeElement === element,
  );
  const workSaved = await inspectAssessmentCard(workCard);

  await inspector.getByRole("button", { name: "Accept result" }).click();
  const acceptanceWarning = inspector.locator("#accept-assessment-warning");
  await acceptanceWarning.waitFor({ state: "visible", timeout: 5_000 });
  const acceptanceWarningText = (await acceptanceWarning.innerText())
    .replace(/\s+/gu, " ")
    .trim();
  const confirmDecision = inspector.getByRole("button", {
    name: "Confirm decision",
  });
  const acceptanceWarningFocus = await confirmDecision.evaluate(
    (element) => document.activeElement === element,
  );
  const acceptanceWarningDescribedBy =
    await confirmDecision.getAttribute("aria-describedby");
  const acceptanceDefinitionAdvisory = inspector.locator(
    "#accept-definition-of-done-advisory",
  );
  const acceptanceDefinitionAdvisoryExact =
    (await acceptanceDefinitionAdvisory.innerText())
      .replace(/\s+/gu, " ")
      .trim() ===
    "Definition of Done has 3 current criteria. Coffice does not verify them automatically; acceptance is your decision.";
  const acceptanceConfirmEnabled = await confirmDecision.isEnabled();
  if (viewportId === "desktop") {
    screenshots.set(
      "desktop-review-acceptance-warning",
      await page.screenshot({ fullPage: false }),
    );
  }
  await inspector.getByRole("button", { name: "Back", exact: true }).click();
  if (viewportId === "desktop") {
    screenshots.set(
      "desktop-review-act",
      await page.screenshot({ fullPage: false }),
    );
  }
  const reviewedReceiptResponse = page.waitForResponse(
    (response) => {
      if (
        response.status() !== 503 ||
        response.request().method() !== "PATCH" ||
        response.headers()["x-coffice-synthetic-expected-failure"] !==
          "attention-event"
      ) {
        return false;
      }
      const mutation = response.request().postDataJSON()?.mutation;
      return (
        mutation?.type === "attention.event" &&
        mutation.eventKey === fixtureState.initialResultKey.id &&
        mutation.disposition?.kind === "reviewed"
      );
    },
    { timeout: 5_000 },
  );
  await inspector
    .getByRole("button", { name: "Mark reviewed", exact: true })
    .click();
  const durableResolutionStatus = inspector.getByText(
    "Reviewed in Plan. This completion no longer needs Attention.",
    { exact: true },
  );
  await durableResolutionStatus.waitFor({ state: "visible", timeout: 5_000 });
  await reviewedReceiptResponse;
  const durableResolutionStatusText = (
    await durableResolutionStatus.innerText()
  )
    .replace(/\s+/gu, " ")
    .trim();
  const resultReviewPersisted = fixtureState.resultIsReviewed(
    fixtureState.initialResultKey,
  );
  const seenReceiptPreservedAfterReviewFailure =
    fixtureState.attentionDisposition(fixtureState.initialResultKey.id)
      ?.kind === "needs_review";
  const attentionEventFailureRecorded =
    fixtureState.attentionEventFailureCount === 1 &&
    fixtureState.failedAttentionEventKeys.includes(
      fixtureState.initialResultKey.id,
    ) &&
    fixtureState.failedAttentionDispositionKinds.length === 1 &&
    fixtureState.failedAttentionDispositionKinds[0] === "reviewed";
  await page.keyboard.press("Escape");
  await inspector.waitFor({ state: "detached", timeout: 5_000 });
  await page.waitForFunction(() =>
    document.activeElement
      ?.getAttribute("aria-label")
      ?.startsWith("Attention for "),
  );
  const inspectorClosed = (await inspector.count()) === 0;
  const inspectorFocusRestored = await toggle.evaluate(
    (element) => document.activeElement === element,
  );

  await waitForAttentionCount(page, PRIMARY_ATTENTION_COUNT - 1);
  const triggerAfterResolution = await readAttentionTrigger(toggle);
  await toggle.click();
  await inbox.waitFor({ state: "visible", timeout: 5_000 });
  const itemCountAfterResolution = await inbox
    .locator("[data-attention-item]")
    .count();
  const scopeAfterResolution = await inbox.getAttribute(
    "data-attention-scope-project-id",
  );
  const containmentAfterResolution =
    await inspectAttentionPanelContainment(inbox);
  const secondaryCountAfterResolution = await inbox
    .locator("[data-attention-item]")
    .filter({ hasText: /Secondary (?:Agent|Office)/u })
    .count();
  const reviewedCompletionCount = await inbox
    .locator("[data-attention-item]")
    .filter({ hasText: "Acceptance Agent 04" })
    .count();
  await page.keyboard.press("Escape");
  await inbox.waitFor({ state: "detached", timeout: 5_000 });

  const drawerAfterResolution = await auditProjectDrawer(page, fixtureState);
  const digestAfterResolution = await auditActionableDigest(
    page,
    screenshots,
    viewportId,
    "after-resolution",
    `Open digest, ${GLOBAL_ATTENTION_COUNT - 1} actions, ${GLOBAL_NEEDS_REPLY_COUNT} reply needed, 0 decisions needed, 1 unread result`,
    fixtureState,
  );
  const workspaceWritesBeforeDeskReturn = fixtureState.workspaceWriteCount;
  const codexMutationsBeforeDeskReturn = fixtureState.codexRouteRequests.filter(
    (request) => request.method !== "GET" && request.method !== "HEAD",
  ).length;
  const workflowAfterResolution = await inspectSettledWorkflowAreas(
    page,
    { ...PRIMARY_WORKFLOW_ASSIGNMENTS, [REVIEW_TASK_TITLE]: "desk" },
    fixtureState,
  );
  const deskReturnAddedNoWorkspaceWrites =
    fixtureState.workspaceWriteCount === workspaceWritesBeforeDeskReturn;
  const deskReturnAddedNoCodexMutations =
    fixtureState.codexRouteRequests.filter(
      (request) => request.method !== "GET" && request.method !== "HEAD",
    ).length === codexMutationsBeforeDeskReturn;

  fixtureState.clearReviewDecisionFixture();
  const laterResultKey = fixtureState.publishDistinctResult();
  const laterObservationResponse = page.waitForResponse(
    (response) =>
      response.status() === 200 &&
      response.request().method() === "PATCH" &&
      response.request().postDataJSON()?.mutation?.type === "result.upsert",
    { timeout: 5_000 },
  );
  await enterTopDownOffice(page);
  await laterObservationResponse;
  await waitForAttentionCount(page, PRIMARY_ATTENTION_COUNT);
  const workspaceWritesBeforeLaterReviewPlacement =
    fixtureState.workspaceWriteCount;
  const codexMutationsBeforeLaterReviewPlacement =
    fixtureState.codexRouteRequests.filter(
      (request) => request.method !== "GET" && request.method !== "HEAD",
    ).length;
  const workflowAfterLaterResult = await inspectSettledWorkflowAreas(
    page,
    PRIMARY_WORKFLOW_ASSIGNMENTS,
    fixtureState,
  );
  const laterReviewPlacementAddedNoWorkspaceWrites =
    fixtureState.workspaceWriteCount ===
    workspaceWritesBeforeLaterReviewPlacement;
  const laterReviewPlacementAddedNoCodexMutations =
    fixtureState.codexRouteRequests.filter(
      (request) => request.method !== "GET" && request.method !== "HEAD",
    ).length === codexMutationsBeforeLaterReviewPlacement;
  const triggerAfterLaterResult = await readAttentionTrigger(toggle);
  await toggle.click();
  await inbox.waitFor({ state: "visible", timeout: 5_000 });
  const scopeAfterLaterResult = await inbox.getAttribute(
    "data-attention-scope-project-id",
  );
  const containmentAfterLaterResult =
    await inspectAttentionPanelContainment(inbox);
  const secondaryCountAfterLaterResult = await inbox
    .locator("[data-attention-item]")
    .filter({ hasText: /Secondary (?:Agent|Office)/u })
    .count();
  const laterReviewItem = inbox
    .locator("[data-attention-item]")
    .filter({ hasText: "Acceptance Agent 04" });
  await laterReviewItem.waitFor({ state: "visible", timeout: 5_000 });
  const laterCompletionCount = await laterReviewItem.count();
  const laterResultIsDistinct =
    resultKeyIdentity(laterResultKey) !==
    resultKeyIdentity(fixtureState.initialResultKey);
  const laterResultRemainsUnreviewed =
    !fixtureState.resultIsReviewed(laterResultKey);
  const laterResultPersisted = fixtureState.hasResult(laterResultKey);
  if (viewportId === "desktop") {
    await laterReviewItem.first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(80);
    screenshots.set(
      "desktop-attention-later-result",
      await page.screenshot({ fullPage: false }),
    );
  }
  await page.keyboard.press("Escape");
  await inbox.waitFor({ state: "detached", timeout: 5_000 });
  const drawerAfterLaterResult = await auditProjectDrawer(page, fixtureState);

  return {
    itemCount,
    initialTrigger,
    scopeProjectId,
    scopeHeadingCount,
    scopeIntroCount,
    itemTexts,
    secondaryItemCount,
    initialContainment,
    inboxModal,
    initialFocusOnItem,
    shellInert,
    inboxTrap,
    inboxFocusWrapped,
    inboxFocusRestored,
    inspectorModal,
    inspectorInitialFocus,
    codexLinkIsTaskDeepLink: /^codex:\/\/threads\/10000000-/u.test(
      codexLink ?? "",
    ),
    inspectorTrap,
    inspectorFocusWrapped,
    projectDecisions,
    definitionOfDone: reviewDefinitionOfDone,
    workItemRelationships: reviewWorkItemRelationships,
    projectContextReview: reviewProjectContextReview,
    assessment: {
      scopeLabels: scopeLabels.map((label) => label.trim()),
      recordedLabels: recordedLabels.map((label) => label.trim()),
      exactRest,
      workRest,
      workEditor,
      workSaved,
      exactDisclosureKeyboardReachable,
      exactDisclosureOpened,
      initialEditorFocus,
      editorFocusReached,
      saveFocusHandoff,
      editorExpanded: workEditor.height > workRest.height,
      exactAdvisoryWording:
        exactText.includes("Advisory next action") &&
        exactText.includes("Send a follow-up") &&
        exactText.includes("Confirm compact-layout behavior before accepting."),
      selfCritiqueCount,
      acceptanceWarningText,
      acceptanceWarningFocus,
      acceptanceWarningDescribedBy,
      acceptanceDefinitionAdvisoryExact,
      acceptanceConfirmEnabled,
    },
    lifecycle: {
      initialCompletionVisible,
      seenReceiptPersisted,
      seenEventKeyMatchesInitial,
      workspaceWriteCountAfterSeen,
      attentionFailureCountAfterSeen,
      triggerAfterSeen,
      drawerAfterSeen,
      digestAfterSeen,
      triggerAfterSeenNavigation,
      itemCountAfterSeen,
      secondaryCountAfterSeen,
      durableResolutionStatusText,
      resultReviewPersisted,
      seenReceiptPreservedAfterReviewFailure,
      attentionEventFailureRecorded,
      triggerAfterResolution,
      itemCountAfterResolution,
      scopeAfterResolution,
      containmentAfterResolution,
      secondaryCountAfterResolution,
      reviewedCompletionCount,
      drawerAfterResolution,
      digestAfterResolution,
      workflowAfterResolution,
      deskReturnAddedNoWorkspaceWrites,
      deskReturnAddedNoCodexMutations,
      triggerAfterLaterResult,
      scopeAfterLaterResult,
      containmentAfterLaterResult,
      secondaryCountAfterLaterResult,
      laterCompletionCount,
      drawerAfterLaterResult,
      laterResultIsDistinct,
      laterResultRemainsUnreviewed,
      laterResultPersisted,
      workflowAfterLaterResult,
      laterReviewPlacementAddedNoWorkspaceWrites,
      laterReviewPlacementAddedNoCodexMutations,
      assessmentWriteCount: fixtureState.assessmentWriteCount,
      resultObservationWriteCount: fixtureState.resultObservationWriteCount,
      resultReviewWriteCount: fixtureState.resultReviewWriteCount,
      attentionSeenWriteCount: fixtureState.attentionSeenWriteCount,
      seenAttentionEventKeys: [...fixtureState.seenAttentionEventKeys],
      attentionEventFailureCount: fixtureState.attentionEventFailureCount,
      failedAttentionDispositionKinds: [
        ...fixtureState.failedAttentionDispositionKinds,
      ],
      reviewedAttentionArrivedAfterResultReview:
        fixtureState.reviewedAttentionArrivedAfterResultReview,
    },
    inspectorClosed,
    inspectorFocusRestored,
  };
}

async function inspectProjectDecisionContainment(decisionLog) {
  return await decisionLog.evaluate((surface) => {
    const bounds = surface.getBoundingClientRect();
    const planner = surface.closest('[data-work-planner="true"]');
    const plannerBounds = planner?.getBoundingClientRect();
    const horizontallyContained = (element, containerBounds) => {
      const elementBounds = element.getBoundingClientRect();
      return (
        elementBounds.left >= containerBounds.left - 1 &&
        elementBounds.right <= containerBounds.right + 1
      );
    };
    const containedElements = Array.from(
      surface.querySelectorAll("article, form, details, button, textarea"),
    );
    return {
      withinPlanner:
        Boolean(plannerBounds) &&
        bounds.left >= plannerBounds.left - 1 &&
        bounds.right <= plannerBounds.right + 1,
      panelWithinViewportWidth:
        Boolean(plannerBounds) &&
        plannerBounds.left >= -1 &&
        plannerBounds.right <= window.innerWidth + 1,
      noHorizontalOverflow:
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1 &&
        (!planner || planner.scrollWidth <= planner.clientWidth + 1) &&
        surface.scrollWidth <= surface.clientWidth + 1,
      descendantsContained: containedElements.every((element) =>
        horizontallyContained(element, bounds),
      ),
      longContextContained:
        !surface.textContent?.includes(
          "ProjectDecisionContextWithAnIntentionallyLongUnbrokenTokenForResponsiveContainment",
        ) || surface.scrollWidth <= surface.clientWidth + 1,
    };
  });
}

async function readProjectDecisionHistory(details) {
  return await details
    .locator("[data-project-decision-history-event]")
    .evaluateAll((items) =>
      items.map((item) => ({
        action: item.getAttribute("data-project-decision-history-event"),
        label: item.querySelector("strong")?.textContent?.trim() ?? null,
        statement:
          item.querySelector(":scope > p")?.textContent?.trim() ?? null,
        detail:
          item.querySelector(":scope > small")?.textContent?.trim() ?? null,
        timestamp: item.querySelector("time")?.getAttribute("datetime") ?? null,
      })),
    );
}

async function auditProjectDecisionLog(
  page,
  planner,
  toggle,
  screenshots,
  viewportId,
  fixtureState,
) {
  const log = planner.locator(
    `[data-project-decision-log="${PRIMARY_PROJECT_ID}"]`,
  );
  await log.waitFor({ state: "visible", timeout: 5_000 });
  const placement = await planner.evaluate((surface) => {
    const directChild = (element) => {
      let current = element;
      while (current?.parentElement && current.parentElement !== surface) {
        current = current.parentElement;
      }
      return current?.parentElement === surface ? current : null;
    };
    const exactTextElement = (text) =>
      Array.from(surface.querySelectorAll("span, h3")).find(
        (element) => element.textContent?.trim() === text,
      );
    const children = Array.from(surface.children);
    const objective = directChild(exactTextElement("Current objective"));
    const decisions = directChild(
      surface.querySelector("[data-project-decision-log]"),
    );
    const milestones = directChild(exactTextElement("Milestones"));
    const objectiveIndex = children.indexOf(objective);
    const decisionIndex = children.indexOf(decisions);
    const milestoneIndex = children.indexOf(milestones);
    return {
      objectiveIndex,
      decisionIndex,
      milestoneIndex,
      afterObjectiveBeforeMilestones:
        objectiveIndex >= 0 &&
        objectiveIndex < decisionIndex &&
        decisionIndex < milestoneIndex,
    };
  });
  const initial = {
    sectionCount: await planner
      .locator(`[data-project-decision-log="${PRIMARY_PROJECT_ID}"]`)
      .count(),
    eyebrowCount: await log
      .getByText("User-approved choices", { exact: true })
      .count(),
    headingCount: await log
      .getByRole("heading", { name: "Project decision log", exact: true })
      .count(),
    noCurrentCount: await log
      .getByText("No current decisions", { exact: true })
      .count(),
    emptyHeadingCount: await log
      .getByText("Nothing recorded yet", { exact: true })
      .count(),
    helperCount: await log
      .getByText(
        "Only decisions you approve and record appear here. They stay private in Coffice and do not change tasks, results, or what Codex does.",
        { exact: true },
      )
      .count(),
    eventCount: fixtureState.projectDecisionEvents().length,
    containment: await inspectProjectDecisionContainment(log),
  };
  const invariantBefore = fixtureState.projectDecisionInvariantSnapshot();
  const codexRequestCountBefore = fixtureState.codexRouteRequests.length;

  const initialRecordButton = log.getByRole("button", {
    name: "Record decision",
    exact: true,
  });
  await initialRecordButton.focus();
  await page.keyboard.press("Enter");
  const initialStatement = log.getByLabel("Decision", { exact: true });
  await initialStatement.waitFor({ state: "visible", timeout: 5_000 });
  const initialEditorFocus = await waitForLocatorFocus(page, initialStatement);
  const initialEditorContainment = await inspectProjectDecisionContainment(log);
  screenshots.set(
    `${viewportId}-plan-project-decision-editor`,
    await page.screenshot({ fullPage: false }),
  );
  await page.keyboard.press("Escape");
  const editorEscapeFocusRestored = await waitForLocatorFocus(
    page,
    log.getByRole("button", { name: "Record decision", exact: true }),
  );
  const emptyAfterEditorEscape =
    (await log.getByLabel("Decision", { exact: true }).count()) === 0 &&
    (await log.getByText("Nothing recorded yet", { exact: true }).count()) ===
      1 &&
    fixtureState.projectDecisionEvents().length === 0;

  const recordButton = log.getByRole("button", {
    name: "Record decision",
    exact: true,
  });
  await recordButton.click();
  let recordInputs = await log.locator("textarea").all();
  if (recordInputs.length !== 2) {
    throw new Error(
      `Record decision expected two text areas; found ${recordInputs.length}.`,
    );
  }
  let decisionInput = recordInputs[0];
  let contextInput = recordInputs[1];
  await waitForLocatorFocus(page, decisionInput);
  await decisionInput.fill(INITIAL_PROJECT_DECISION);
  await page.waitForFunction(
    ({ selector, value }) =>
      document.querySelectorAll(selector)[0]?.value === value,
    {
      selector: "[data-project-decision-log] form textarea",
      value: INITIAL_PROJECT_DECISION,
    },
    { timeout: 5_000 },
  );
  recordInputs = await log.locator("form textarea").all();
  if (recordInputs.length !== 2) {
    throw new Error(
      `Record decision expected two stable text areas; found ${recordInputs.length}.`,
    );
  }
  decisionInput = recordInputs[0];
  contextInput = recordInputs[1];
  await contextInput.fill(INITIAL_PROJECT_DECISION_CONTEXT);
  await page.waitForFunction(
    ({ selector, statement, context }) => {
      const inputs = document.querySelectorAll(selector);
      return inputs[0]?.value === statement && inputs[1]?.value === context;
    },
    {
      selector: "[data-project-decision-log] form textarea",
      statement: INITIAL_PROJECT_DECISION,
      context: INITIAL_PROJECT_DECISION_CONTEXT,
    },
    { timeout: 5_000 },
  );
  const recordFormContainment = await inspectProjectDecisionContainment(log);
  await log.getByRole("button", { name: "Save decision", exact: true }).click();
  await log
    .getByText("Decision recorded.", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  const recordedCard = log.locator('[data-project-decision-current="true"]');
  await recordedCard.waitFor({ state: "attached", timeout: 5_000 });
  const recordStatusFocused = await log
    .getByText("Decision recorded.", { exact: true })
    .evaluate((element) => document.activeElement === element);
  let current = recordedCard;
  const recordedHeadingMatches = await current
    .getByRole("heading", { name: INITIAL_PROJECT_DECISION, exact: true })
    .count();
  const recorded = {
    currentCount: await current.count(),
    headingCount: recordedHeadingMatches,
    contextCount: await current
      .getByText(INITIAL_PROJECT_DECISION_CONTEXT, { exact: true })
      .count(),
    statusFocused: recordStatusFocused,
    containment: await inspectProjectDecisionContainment(log),
  };

  let correctButton = log.getByText("Correct wording", { exact: true });
  await correctButton.focus();
  await correctButton.click();
  {
    const inputs = await log.locator("textarea").all();
    decisionInput = inputs[0];
    contextInput = inputs[1];
  }
  await page.waitForTimeout(50);
  await log
    .getByRole("button", { name: "Save correction", exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  const correctionInputs = await log.locator("textarea").all();
  if (correctionInputs.length !== 2) {
    throw new Error(
      `Correct wording expected two text areas; found ${correctionInputs.length}.`,
    );
  }
  decisionInput = correctionInputs[0];
  contextInput = correctionInputs[1];
  const correction = {
    initialFocus: await waitForLocatorFocus(page, decisionInput),
    prefilledStatement: await decisionInput.inputValue(),
    prefilledContext: await contextInput.inputValue(),
    containment: await inspectProjectDecisionContainment(log),
  };
  await log.getByRole("button", { name: "Cancel", exact: true }).click();
  correction.cancelFocusRestored = await waitForLocatorFocus(
    page,
    correctButton,
  );
  correction.eventCountAfterCancel =
    fixtureState.projectDecisionEvents().length;

  await correctButton.click();
  {
    const inputs = await log.locator("textarea").all();
    decisionInput = inputs[0];
    contextInput = inputs[1];
  }
  await log
    .getByRole("button", { name: "Save correction", exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  {
    const inputs = await log.locator("textarea").all();
    decisionInput = inputs[0];
    contextInput = inputs[1];
  }
  await decisionInput.fill(CORRECTED_PROJECT_DECISION);
  const correctionPersisted = page.waitForResponse(
    (response) => {
      if (
        response.status() !== 200 ||
        response.request().method() !== "PATCH"
      ) {
        return false;
      }
      const mutation = response.request().postDataJSON()?.mutation;
      return (
        mutation?.type === "projectDecision.supersede" &&
        mutation.projectId === PRIMARY_PROJECT_ID &&
        mutation.supersessionKind === "correction" &&
        mutation.statement === CORRECTED_PROJECT_DECISION
      );
    },
    { timeout: 12_000 },
  );
  await log
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await correctionPersisted;
  await log
    .getByText("Decision wording corrected.", { exact: true })
    .waitFor({ state: "attached", timeout: 12_000 });
  current = log.locator('[data-project-decision-current="true"]');
  await current
    .getByRole("heading", { name: CORRECTED_PROJECT_DECISION, exact: true })
    .waitFor({ state: "attached", timeout: 12_000 });
  let history = current.locator(":scope > details");
  await history.getByText("History · 2 events", { exact: true }).click();
  correction.history = await readProjectDecisionHistory(history);

  const replaceLabel = `Replace current decision 1: ${CORRECTED_PROJECT_DECISION}`;
  const replaceButton = log.getByRole("button", {
    name: replaceLabel,
    exact: true,
  });
  await replaceButton.click();
  {
    const inputs = await log.locator("textarea").all();
    decisionInput = inputs[0];
    contextInput = inputs[1];
  }
  await log
    .getByRole("button", { name: "Replace decision", exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  {
    const inputs = await log.locator("textarea").all();
    decisionInput = inputs[0];
    contextInput = inputs[1];
  }
  const replacement = {
    initialFocus: await waitForLocatorFocus(page, decisionInput),
    initialStatement: await decisionInput.inputValue(),
    initialContext: await contextInput.inputValue(),
    containment: await inspectProjectDecisionContainment(log),
  };
  await decisionInput.fill(REPLACEMENT_PROJECT_DECISION);
  await contextInput.fill(REPLACEMENT_PROJECT_DECISION_CONTEXT);
  await log
    .getByRole("button", { name: "Replace decision", exact: true })
    .click();
  await log
    .getByText("Decision replaced.", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  current = log.locator('[data-project-decision-current="true"]');
  await current
    .getByRole("heading", { name: REPLACEMENT_PROJECT_DECISION, exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  history = current.locator(":scope > details");
  await history.getByText("History · 3 events", { exact: true }).click();
  replacement.history = await readProjectDecisionHistory(history);
  replacement.containmentAfterSave =
    await inspectProjectDecisionContainment(log);

  const withdrawLabel = `Withdraw current decision 1: ${REPLACEMENT_PROJECT_DECISION}`;
  let withdrawButton = log.getByRole("button", {
    name: withdrawLabel,
    exact: true,
  });
  await withdrawButton.focus();
  await withdrawButton.click();
  const reasonInput = log.getByLabel("Reason optional", { exact: true });
  await reasonInput.waitFor({ state: "visible", timeout: 5_000 });
  const withdrawal = {
    initialFocus: await waitForLocatorFocus(page, reasonInput),
    confirmationCount: await log
      .getByRole("button", { name: "Confirm withdrawal", exact: true })
      .count(),
    noticeCount: await log
      .getByText(
        "This removes the decision from the current list without a replacement. Its history is kept until this project is removed.",
        { exact: true },
      )
      .count(),
  };
  await reasonInput.fill(PROJECT_DECISION_WITHDRAWAL_REASON);
  await log.getByRole("button", { name: "Keep decision", exact: true }).click();
  withdrawal.keepFocusRestored = await waitForLocatorFocus(
    page,
    withdrawButton,
  );
  withdrawal.eventCountAfterKeep = fixtureState.projectDecisionEvents().length;

  withdrawButton = log.getByRole("button", {
    name: withdrawLabel,
    exact: true,
  });
  await withdrawButton.click();
  await reasonInput.fill(PROJECT_DECISION_WITHDRAWAL_REASON);
  withdrawal.formContainment = await inspectProjectDecisionContainment(log);
  await log
    .getByRole("button", { name: "Confirm withdrawal", exact: true })
    .click();
  await log
    .getByText("Decision withdrawn. Its history is still available.", {
      exact: true,
    })
    .waitFor({ state: "visible", timeout: 5_000 });
  withdrawal.statusFocused = await log
    .getByText("Decision withdrawn. Its history is still available.", {
      exact: true,
    })
    .evaluate((element) => document.activeElement === element);
  await log.getByText("Past decisions · 1 withdrawn", { exact: true }).click();
  let withdrawn = log.locator('[data-project-decision-current="false"]');
  history = withdrawn.locator(":scope > details");
  await history.getByText("History · 4 events", { exact: true }).click();
  withdrawal.history = await readProjectDecisionHistory(history);
  withdrawal.immutableHistory =
    (await history.locator("button, input, textarea, select").count()) === 0;
  withdrawal.currentCount = await log
    .locator('[data-project-decision-current="true"]')
    .count();
  withdrawal.emptyInEffectCount = await log
    .getByText("No decision is currently in effect", { exact: true })
    .count();
  withdrawal.containment = await inspectProjectDecisionContainment(log);
  screenshots.set(
    `${viewportId}-plan-project-decision-history`,
    await page.screenshot({ fullPage: false }),
  );

  const invariantAfter = fixtureState.projectDecisionInvariantSnapshot();
  const codexRequestsDuringStory = fixtureState.codexRouteRequests.slice(
    codexRequestCountBefore,
  );
  const persistedBeforeReopen = fixtureState.projectDecisionEvents();
  await page.keyboard.press("Escape");
  await planner.waitFor({ state: "detached", timeout: 5_000 });
  await page.waitForFunction(
    () => document.activeElement?.textContent?.trim() === "Plan",
  );
  const closeFocusRestored = await toggle.evaluate(
    (element) => document.activeElement === element,
  );
  await toggle.click();
  await planner.waitFor({ state: "visible", timeout: 5_000 });
  await log.waitFor({ state: "visible", timeout: 5_000 });
  await log.getByText("Past decisions · 1 withdrawn", { exact: true }).click();
  withdrawn = log.locator('[data-project-decision-current="false"]');
  history = withdrawn.locator(":scope > details");
  await history.getByText("History · 4 events", { exact: true }).click();
  const reopened = {
    history: await readProjectDecisionHistory(history),
    persistedEvents: fixtureState.projectDecisionEvents(),
    currentCount: await log
      .locator('[data-project-decision-current="true"]')
      .count(),
    containment: await inspectProjectDecisionContainment(log),
  };

  return {
    placement,
    initial,
    initialEditorFocus,
    initialEditorContainment,
    editorEscapeFocusRestored,
    emptyAfterEditorEscape,
    recordFormContainment,
    recorded,
    correction,
    replacement,
    withdrawal,
    reopened,
    closeFocusRestored,
    invariantUnchanged: invariantBefore === invariantAfter,
    codexRequestsDuringStory,
    persistedBeforeReopen,
    writeCount: fixtureState.projectDecisionWriteCount,
    requests: fixtureState.projectDecisionRequests.map((request) =>
      structuredClone(request),
    ),
  };
}

async function inspectMilestoneSequence(planner) {
  return await planner
    .locator("[data-milestone-position]")
    .evaluateAll((cards) =>
      cards.map((card) => {
        const heading = card.querySelector("h4");
        const summary = heading?.parentElement;
        return {
          position: Number(card.getAttribute("data-milestone-position")),
          title: heading?.textContent?.trim() ?? null,
          numberText:
            card
              .querySelector(':scope > div > span[aria-hidden="true"]')
              ?.textContent?.trim() ?? null,
          statusText:
            summary?.querySelector(":scope > span")?.textContent?.trim() ??
            null,
          orderMode: card.getAttribute("data-milestone-order-mode") === "true",
          orderGroupLabel:
            card.querySelector('[role="group"]')?.getAttribute("aria-label") ??
            null,
        };
      }),
    );
}

async function inspectMilestoneContainment(planner) {
  return await planner.evaluate((surface) => {
    const bounds = surface.getBoundingClientRect();
    const cards = Array.from(
      surface.querySelectorAll("[data-milestone-position]"),
    );
    const groups = Array.from(
      surface.querySelectorAll('[role="group"][aria-label^="Change order"]'),
    );
    const horizontallyContained = (element, containerBounds) => {
      const elementBounds = element.getBoundingClientRect();
      return (
        elementBounds.left >= containerBounds.left - 1 &&
        elementBounds.right <= containerBounds.right + 1
      );
    };
    return {
      panelWithinViewportWidth:
        bounds.left >= -1 && bounds.right <= window.innerWidth + 1,
      noHorizontalOverflow:
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1 &&
        surface.scrollWidth <= surface.clientWidth + 1,
      cardsContained: cards.every((card) =>
        horizontallyContained(card, bounds),
      ),
      controlsContained: groups.every((group) => {
        const cardBounds = group
          .closest("[data-milestone-position]")
          ?.getBoundingClientRect();
        if (!cardBounds || !horizontallyContained(group, cardBounds)) {
          return false;
        }
        const groupBounds = group.getBoundingClientRect();
        return Array.from(group.querySelectorAll("button")).every((button) =>
          horizontallyContained(button, groupBounds),
        );
      }),
      orderControlGroupCount: groups.length,
    };
  });
}

async function auditDefinitionOfDone(
  page,
  planner,
  screenshots,
  viewportId,
  fixtureState,
) {
  const waitForExactFocus = async (locator, missingMessage) => {
    const element = await locator.elementHandle();
    if (!element) throw new Error(missingMessage);
    await page.waitForFunction(
      (target) => document.activeElement === target,
      element,
      { timeout: 5_000 },
    );
    return true;
  };
  const writesBefore = fixtureState.workspaceWriteCount;
  const codexBefore = fixtureState.codexRouteRequests.filter(
    (request) => request.method !== "GET" && request.method !== "HEAD",
  ).length;
  const verificationBefore = fixtureState.verificationMutationCount();
  const expectedFirstSave = [
    "Review the exact completed result carefully.",
    DEFINITION_OF_DONE_LONG_ENTRY,
    "A new criterion created in Plan.",
  ];
  const firstCard = planner.locator('[data-milestone-position="1"]');
  const firstCurrent = firstCard.locator(
    '[data-definition-of-done-current="true"]',
  );
  const initialCountExact =
    (await firstCurrent
      .getByText("Definition of Done · 3", { exact: true })
      .count()) === 1;
  const initialDisclosure = firstCurrent.locator("details");
  const initialSummary = initialDisclosure.getByText("Definition of Done · 3", {
    exact: true,
  });
  await initialSummary.click();
  const initialDisclosureExpanded = await initialDisclosure.evaluate(
    (element) => element.open,
  );
  const initialEdit = firstCurrent.getByRole("button", {
    name: "Edit criteria",
  });
  await initialEdit.waitFor({ state: "visible", timeout: 5_000 });
  await initialEdit.click();
  let editor = firstCard.locator('[data-definition-of-done-editor="true"]');
  await editor.waitFor({ state: "visible", timeout: 5_000 });
  const initialFocus = await waitForExactFocus(
    editor.getByRole("textbox", { name: "Done criterion 1", exact: true }),
    "The first Definition of Done criterion did not render.",
  );
  const layout = await editor.evaluate((surface) => {
    const controls = Array.from(surface.querySelectorAll("button, textarea"));
    const active = document.activeElement;
    const activeStyle = active ? getComputedStyle(active) : null;
    return {
      controlsComfortable: controls.every((control) => {
        const style = getComputedStyle(control);
        return (
          control.getBoundingClientRect().height >= 44 &&
          Number.parseFloat(style.fontSize) >= 14
        );
      }),
      opaqueFocusOutline: (() => {
        if (!activeStyle || activeStyle.outlineStyle === "none") return false;
        const color = activeStyle.outlineColor;
        if (color === "transparent") return false;
        const rgba = color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/u);
        return !rgba || Number.parseFloat(rgba[1]) === 1;
      })(),
      noHorizontalOverflow:
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1 &&
        surface.scrollWidth <= surface.clientWidth + 1 &&
        controls.every(
          (control) => control.scrollWidth <= control.clientWidth + 1,
        ),
    };
  });
  await editor
    .getByRole("button", { name: "Move criterion 3 earlier", exact: true })
    .click();
  await waitForExactFocus(
    editor.getByRole("button", {
      name: "Move criterion 2 earlier",
      exact: true,
    }),
    "Moving the third Definition of Done criterion did not settle on its reordered row.",
  );
  if (
    !(await waitForTextareaValues(page, editor, [
      "Review the exact completed result.",
      DEFINITION_OF_DONE_LONG_ENTRY,
      DEFINITION_OF_DONE_PRIVATE_CANARY,
    ]))
  ) {
    throw new Error("The reordered Definition of Done rows did not settle.");
  }
  await editor
    .getByRole("button", { name: "Remove criterion 3", exact: true })
    .click();
  if (
    !(await waitForTextareaValues(page, editor, [
      "Review the exact completed result.",
      DEFINITION_OF_DONE_LONG_ENTRY,
    ]))
  ) {
    throw new Error("The removed Definition of Done row did not settle.");
  }
  await editor
    .getByRole("textbox", { name: "Done criterion 1", exact: true })
    .fill(expectedFirstSave[0]);
  if (
    !(await waitForTextareaValues(page, editor, [
      expectedFirstSave[0],
      expectedFirstSave[1],
    ]))
  ) {
    throw new Error("The edited Definition of Done row did not settle.");
  }
  await editor.getByRole("button", { name: "Add criterion" }).click();
  if (
    !(await waitForTextareaValues(page, editor, [
      expectedFirstSave[0],
      expectedFirstSave[1],
      "",
    ]))
  ) {
    throw new Error("The added Definition of Done row did not settle.");
  }
  await editor
    .getByRole("textbox", { name: "Done criterion 3", exact: true })
    .fill(expectedFirstSave[2]);
  if (!(await waitForTextareaValues(page, editor, expectedFirstSave))) {
    throw new Error("The completed Definition of Done draft did not settle.");
  }
  await editor.getByRole("button", { name: "Save changes" }).click();
  const firstStatus = planner.locator(
    '[data-definition-of-done-status="true"]',
  );
  await firstStatus
    .filter({ hasText: "Definition of Done saved." })
    .waitFor({ state: "visible", timeout: 5_000 });
  const saveFocus = await waitForExactFocus(
    firstCurrent.getByRole("button", { name: "Edit criteria" }),
    "The Definition of Done edit trigger did not return after saving.",
  );
  const saveDisclosureOpenAndTriggerVisible =
    (await firstCurrent
      .locator("details")
      .evaluate((element) => element.open)) &&
    (await firstCurrent
      .getByRole("button", { name: "Edit criteria" })
      .isVisible());
  const firstWorkspaceDefinition = fixtureState.definitionOfDone();
  const firstRequestDefinition =
    fixtureState.definitionOfDoneRequests.at(-1)?.mutation?.definitionOfDone ??
    [];
  const firstMutationEvidence = {
    workspaceLength: firstWorkspaceDefinition.length === 3,
    workspaceFirst: firstWorkspaceDefinition[0] === expectedFirstSave[0],
    workspaceSecond: firstWorkspaceDefinition[1] === expectedFirstSave[1],
    workspaceThird: firstWorkspaceDefinition[2] === expectedFirstSave[2],
    requestLength: firstRequestDefinition.length === 3,
    requestFirst: firstRequestDefinition[0] === expectedFirstSave[0],
    requestSecond: firstRequestDefinition[1] === expectedFirstSave[1],
    requestThird: firstRequestDefinition[2] === expectedFirstSave[2],
  };
  const firstMutationExact = Object.values(firstMutationEvidence).every(
    Boolean,
  );

  await firstCurrent.getByRole("button", { name: "Edit criteria" }).click();
  editor = firstCard.locator('[data-definition-of-done-editor="true"]');
  await editor
    .getByRole("textbox", { name: "Done criterion 1", exact: true })
    .fill("A conflicting draft remains editable.");
  if (
    !(await waitForTextareaValues(page, editor, [
      "A conflicting draft remains editable.",
      expectedFirstSave[1],
      expectedFirstSave[2],
    ]))
  ) {
    throw new Error("The conflicting Definition of Done draft did not settle.");
  }
  fixtureState.rejectNextDefinitionOfDoneMutationWithConcurrentStatus();
  await editor.getByRole("button", { name: "Save changes" }).click();
  const changedElsewhereCopy =
    "Definition of Done changed elsewhere. Your draft was not overwritten. Load the latest criteria before saving.";
  await editor
    .getByText(changedElsewhereCopy, { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  const recoveryControlAvailable =
    (await editor
      .getByRole("button", { name: "Use my draft", exact: true })
      .count()) === 1;
  const obsoleteConflictCopyAbsent =
    (await editor
      .getByText(
        "The workspace changed elsewhere. Your draft was not overwritten. Review the latest plan and save again.",
        { exact: true },
      )
      .count()) === 0;
  const unrelatedStatusPreserved =
    fixtureState.workItemStatus() === "in_progress";
  await editor.locator('[data-load-latest-definition="true"]').click();
  const reloadConfirmation = editor.getByRole("group", {
    name: "Load latest Definition of Done",
  });
  await reloadConfirmation.waitFor({ state: "visible", timeout: 5_000 });
  const reloadConfirmationInitialFocus = await waitForExactFocus(
    reloadConfirmation.getByRole("button", { name: "Keep my draft" }),
    "The Definition of Done reload confirmation did not render.",
  );
  await reloadConfirmation
    .getByRole("button", { name: "Keep my draft" })
    .click();
  const keepDraftPreserved =
    (await editor.getByText(changedElsewhereCopy, { exact: true }).count()) ===
      1 &&
    (await editor
      .getByRole("button", { name: "Use my draft", exact: true })
      .count()) === 1;
  await editor.getByRole("button", { name: "Use my draft" }).click();
  if (
    !(await waitForTextareaValues(page, editor, [
      "A conflicting draft remains editable.",
      expectedFirstSave[1],
      expectedFirstSave[2],
    ]))
  ) {
    throw new Error("The preserved Definition of Done draft did not reload.");
  }
  const conflictDraftPreserved =
    (await editor
      .getByRole("textbox", { name: "Done criterion 1", exact: true })
      .inputValue()) === "A conflicting draft remains editable.";
  const useDraftPreserved =
    conflictDraftPreserved &&
    (await planner
      .getByText(
        "Your preserved draft will replace the latest criteria if you save. Review it first.",
        { exact: true },
      )
      .count()) === 1;
  await editor
    .getByRole("textbox", { name: "Done criterion 1", exact: true })
    .fill("A preserved draft explicitly rebased on the latest plan.");
  if (
    !(await waitForTextareaValues(page, editor, [
      "A preserved draft explicitly rebased on the latest plan.",
      expectedFirstSave[1],
      expectedFirstSave[2],
    ]))
  ) {
    throw new Error("The rebased Definition of Done draft did not settle.");
  }
  fixtureState.rejectNextDefinitionOfDoneMutationWithConcurrentStatus();
  await editor.getByRole("button", { name: "Save changes" }).click();
  await editor
    .getByText(changedElsewhereCopy, { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  const secondConcurrentDefinitionChanged =
    JSON.stringify(fixtureState.definitionOfDone()) ===
    JSON.stringify([SECOND_CONCURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY]);
  await editor.locator('[data-load-latest-definition="true"]').click();
  await reloadConfirmation.waitFor({ state: "visible", timeout: 5_000 });
  await reloadConfirmation
    .getByRole("button", { name: "Discard draft and load latest" })
    .click();
  if (
    !(await waitForTextareaValues(page, editor, [
      SECOND_CONCURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
    ]))
  ) {
    throw new Error("The latest concurrent Definition of Done did not load.");
  }
  const concurrentDefinitionLoaded =
    (await editor
      .getByRole("textbox", { name: "Done criterion 1", exact: true })
      .inputValue()) === SECOND_CONCURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY;
  await editor.getByRole("button", { name: "Cancel" }).click();
  const conflictCancelFocus = await waitForExactFocus(
    firstCurrent.getByRole("button", { name: "Edit criteria" }),
    "The Definition of Done edit trigger did not return after conflict cancellation.",
  );
  const cancelDisclosureOpenAndTriggerVisible =
    (await firstCurrent
      .locator("details")
      .evaluate((element) => element.open)) &&
    (await firstCurrent
      .getByRole("button", { name: "Edit criteria" })
      .isVisible());
  const durableAfterConflict =
    JSON.stringify(fixtureState.definitionOfDone()) ===
    JSON.stringify([SECOND_CONCURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY]);

  await firstCurrent.getByRole("button", { name: "Edit criteria" }).click();
  await page.keyboard.press("Escape");
  const escapeFocusRestored = await waitForExactFocus(
    firstCurrent.getByRole("button", { name: "Edit criteria" }),
    "The Definition of Done edit trigger did not return after Escape.",
  );
  const escapeDisclosureOpenAndTriggerVisible =
    (await firstCurrent
      .locator("details")
      .evaluate((element) => element.open)) &&
    (await firstCurrent
      .getByRole("button", { name: "Edit criteria" })
      .isVisible());

  const secondCard = planner.locator('[data-milestone-position="2"]');
  const secondCurrent = secondCard.locator(
    '[data-definition-of-done-current="true"]',
  );
  await secondCurrent.getByRole("button", { name: "Define done" }).click();
  editor = secondCard.locator('[data-definition-of-done-editor="true"]');
  const emptyEditorAddCriterion = editor.getByRole("button", {
    name: "Add criterion",
  });
  const emptyEditorFocus = await waitForExactFocus(
    emptyEditorAddCriterion,
    "The empty Definition of Done editor did not open.",
  );
  await editor.getByRole("button", { name: "Add criterion" }).click();
  if (!(await waitForTextareaValues(page, editor, [""]))) {
    throw new Error("The empty Definition of Done row did not settle.");
  }
  await editor
    .getByRole("textbox", { name: "Done criterion 1", exact: true })
    .fill("Release criteria can be created and removed.");
  if (
    !(await waitForTextareaValues(page, editor, [
      "Release criteria can be created and removed.",
    ]))
  ) {
    throw new Error("The new Definition of Done criterion did not settle.");
  }
  await editor.getByRole("button", { name: "Save changes" }).click();
  await planner
    .locator('[data-definition-of-done-status="true"]')
    .filter({ hasText: "Definition of Done saved." })
    .waitFor({ state: "visible", timeout: 5_000 });
  await secondCurrent.getByRole("button", { name: "Edit criteria" }).click();
  editor = secondCard.locator('[data-definition-of-done-editor="true"]');
  await editor
    .getByRole("button", { name: "Remove criterion 1", exact: true })
    .click();
  if (!(await waitForTextareaValues(page, editor, []))) {
    throw new Error("The cleared Definition of Done draft did not settle.");
  }
  await editor.getByRole("button", { name: "Save changes" }).click();
  let confirmation = editor.getByRole("group", {
    name: "Confirm removal of Definition of Done",
  });
  await confirmation.waitFor({ state: "visible", timeout: 5_000 });
  await confirmation.getByRole("button", { name: "Back" }).click();
  const addCriterionAfterBack = editor.getByRole("button", {
    name: "Add criterion",
  });
  const backFocusRestored = await waitForExactFocus(
    addCriterionAfterBack,
    "The Definition of Done Add criterion control disappeared.",
  );
  await editor.getByRole("button", { name: "Save changes" }).click();
  confirmation = editor.getByRole("group", {
    name: "Confirm removal of Definition of Done",
  });
  await confirmation.getByRole("button", { name: "Remove criteria" }).click();
  await secondCurrent
    .getByText("No done criteria recorded.", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  const clearFocus = await waitForExactFocus(
    secondCurrent.getByRole("button", { name: "Define done" }),
    "The Definition of Done trigger did not return after clearing criteria.",
  );
  screenshots.set(
    `${viewportId}-plan-definition-of-done`,
    await page.screenshot({ fullPage: false }),
  );

  const privacy = await page.evaluate(
    async (forbidden) => {
      const snapshot = await fetch("/api/snapshot").then((response) =>
        response.text(),
      );
      const storage = `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}`;
      return {
        snapshotClean: forbidden.every((entry) => !snapshot.includes(entry)),
        storageClean: forbidden.every((entry) => !storage.includes(entry)),
        urlClean: forbidden.every((entry) => !location.href.includes(entry)),
      };
    },
    [
      DEFINITION_OF_DONE_PRIVATE_CANARY,
      CURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
      CONCURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
      SECOND_CONCURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
      DEFINITION_OF_DONE_LONG_ENTRY,
      "Review the exact completed result.",
      "Review the exact completed result carefully.",
      "A new criterion created in Plan.",
      "A conflicting draft remains editable.",
      "A preserved draft explicitly rebased on the latest plan.",
      "Release criteria can be created and removed.",
    ],
  );
  const intentEnvelopesExact =
    fixtureState.definitionOfDoneRequests.length === 5 &&
    fixtureState.definitionOfDoneRequests.every(
      (request) =>
        request.expectedRevision === request.acceptedRevision &&
        typeof request.mutationId === "string" &&
        request.mutationId.length > 0 &&
        request.mutation?.type === "workItem.definitionOfDone.set" &&
        request.mutation.projectId === PRIMARY_PROJECT_ID &&
        request.mutation.objectiveId === REVIEW_OBJECTIVE_ID &&
        Array.isArray(request.mutation.definitionOfDone),
    ) &&
    JSON.stringify(
      fixtureState.definitionOfDoneRequests.map(
        (request) => request.mutation.workItemId,
      ),
    ) ===
      JSON.stringify([
        REVIEW_WORK_ITEM_ID,
        REVIEW_WORK_ITEM_ID,
        REVIEW_WORK_ITEM_ID,
        RELEASE_MILESTONE_ID,
        RELEASE_MILESTONE_ID,
      ]) &&
    fixtureState.definitionOfDoneRequests.at(-1)?.mutation?.workItemId ===
      RELEASE_MILESTONE_ID &&
    fixtureState.definitionOfDoneRequests.at(-1)?.mutation?.definitionOfDone
      ?.length === 0;
  const expectedMutationSequence = [
    expectedFirstSave,
    [
      "A conflicting draft remains editable.",
      DEFINITION_OF_DONE_LONG_ENTRY,
      "A new criterion created in Plan.",
    ],
    [
      "A preserved draft explicitly rebased on the latest plan.",
      DEFINITION_OF_DONE_LONG_ENTRY,
      "A new criterion created in Plan.",
    ],
    ["Release criteria can be created and removed."],
    [],
  ];
  const actualMutationSequence = fixtureState.definitionOfDoneRequests.map(
    (request) => request.mutation.definitionOfDone,
  );
  const mutationSequenceEvidence = {
    first:
      JSON.stringify(actualMutationSequence[0]) ===
      JSON.stringify(expectedMutationSequence[0]),
    firstConflict:
      JSON.stringify(actualMutationSequence[1]) ===
      JSON.stringify(expectedMutationSequence[1]),
    secondConflict:
      JSON.stringify(actualMutationSequence[2]) ===
      JSON.stringify(expectedMutationSequence[2]),
    create:
      JSON.stringify(actualMutationSequence[3]) ===
      JSON.stringify(expectedMutationSequence[3]),
    clear:
      JSON.stringify(actualMutationSequence[4]) ===
      JSON.stringify(expectedMutationSequence[4]),
  };
  const mutationSequenceExact = Object.values(mutationSequenceEvidence).every(
    Boolean,
  );
  return {
    initialCountExact,
    initialDisclosureExpanded,
    initialFocus,
    layout,
    saveFocus,
    saveDisclosureOpenAndTriggerVisible,
    firstMutationExact,
    firstMutationEvidence,
    intentEnvelopesExact,
    mutationSequenceExact,
    mutationSequenceEvidence,
    conflictDraftPreserved,
    recoveryControlAvailable,
    obsoleteConflictCopyAbsent,
    unrelatedStatusPreserved,
    reloadConfirmationInitialFocus,
    keepDraftPreserved,
    concurrentDefinitionLoaded,
    useDraftPreserved,
    secondConcurrentDefinitionChanged,
    conflictCancelFocus,
    cancelDisclosureOpenAndTriggerVisible,
    durableAfterConflict,
    escapeFocusRestored,
    escapeDisclosureOpenAndTriggerVisible,
    emptyEditorFocus,
    backFocusRestored,
    clearFocus,
    cleared: (await secondCurrent.getByText("Not defined").count()) === 1,
    successfulWriteCount: fixtureState.definitionOfDoneWriteCount,
    requestCount: fixtureState.definitionOfDoneRequests.length,
    conflictCount: fixtureState.definitionOfDoneConflictCount,
    workspaceWriteDelta: fixtureState.workspaceWriteCount - writesBefore,
    codexMutationDelta:
      fixtureState.codexRouteRequests.filter(
        (request) => request.method !== "GET" && request.method !== "HEAD",
      ).length - codexBefore,
    verificationMutationDelta:
      fixtureState.verificationMutationCount() - verificationBefore,
    ...privacy,
  };
}

async function auditProjectRules(page, screenshots, viewportId, fixtureState) {
  const waitForExactFocus = async (locator, missingMessage) => {
    const element = await locator.elementHandle();
    if (!element) throw new Error(missingMessage);
    await page.waitForFunction(
      (target) => document.activeElement === target,
      element,
      { timeout: 5_000 },
    );
    return true;
  };
  const writesBefore = fixtureState.workspaceWriteCount;
  const mutationAttemptsBefore = fixtureState.workspaceMutationAttemptCount;
  const resultObservationWritesBefore =
    fixtureState.resultObservationWriteCount;
  const codexBefore = await codexMutationCount(fixtureState);
  const verificationBefore = fixtureState.verificationMutationCount();
  const counters = () => ({
    requests: fixtureState.projectRulesRequests.length,
    writes: fixtureState.projectRulesWriteCount,
    conflicts: fixtureState.projectRulesConflictCount,
    mutations: fixtureState.workspaceMutationAttemptCount,
  });
  const counterDeltas = [];
  const recordCounters = (before) => {
    const after = counters();
    counterDeltas.push({
      requests: after.requests - before.requests,
      writes: after.writes - before.writes,
      conflicts: after.conflicts - before.conflicts,
      mutations: after.mutations - before.mutations,
    });
  };
  const openPlan = async () => {
    const trigger = page.getByRole("button", { name: "Plan", exact: true });
    await trigger.focus();
    await trigger.click();
    const planner = page.locator('[data-work-planner="true"]');
    await planner.waitFor({ state: "visible", timeout: 5_000 });
    return { trigger, planner };
  };
  const reopen = async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await enterTopDownOffice(page);
    return openPlan();
  };
  await enterTopDownOffice(page);
  let { trigger, planner } = await openPlan();
  let surface = planner.locator('[data-project-rules="true"]');
  await surface.waitFor({ state: "visible", timeout: 5_000 });
  const rulesFirstWithoutLocalProject =
    (await surface
      .getByText("No project rules recorded.", { exact: true })
      .count()) === 1 &&
    (await surface
      .getByText(
        "Saving the first rule also creates this project's local Coffice plan.",
        { exact: true },
      )
      .count()) === 1;
  const addTrigger = surface.getByRole("button", {
    name: "Add project rules",
    exact: true,
  });
  await addTrigger.focus();
  const triggerKeyboardReachable = await addTrigger.evaluate(
    (element) => document.activeElement === element,
  );
  await addTrigger.click();
  let editor = surface.locator('[data-project-rules-editor="true"]');
  await editor.waitFor({ state: "visible", timeout: 5_000 });
  const draftBadgeExact =
    (await surface.getByText("Editing draft", { exact: true }).count()) === 1 &&
    (await surface.getByText("Not recorded", { exact: true }).count()) === 0;
  const initialEditorFocus = await waitForExactFocus(
    editor.getByRole("button", { name: "Add rule", exact: true }),
    "The empty Project Rules editor did not focus Add rule.",
  );
  await editor.getByRole("button", { name: "Add rule", exact: true }).click();
  const addFocus = await waitForExactFocus(
    editor.getByRole("textbox", { name: "Project rule 1", exact: true }),
    "Add rule did not focus its new Project Rule row.",
  );
  await editor
    .getByRole("textbox", { name: "Project rule 1", exact: true })
    .fill(PROJECT_RULE_INITIAL_CANARY);
  await editor.getByRole("button", { name: "Add rule", exact: true }).click();
  await editor
    .getByRole("textbox", { name: "Project rule 2", exact: true })
    .fill(PROJECT_RULE_LONG_CANARY);
  screenshots.set(
    `${viewportId}-plan-project-rules-populated-editor`,
    await page.screenshot({ fullPage: false }),
  );
  const layout = await editor.evaluate((root) => {
    const controls = Array.from(root.querySelectorAll("button, textarea"));
    const sameRow = (elements) =>
      elements.length < 2 ||
      elements.every(
        (element) =>
          Math.abs(
            element.getBoundingClientRect().top -
              elements[0].getBoundingClientRect().top,
          ) <= 1,
      );
    const rowActions = Array.from(
      root.querySelectorAll("[data-project-rule-row-key]"),
    ).map((row) => Array.from(row.querySelectorAll("button")));
    const submit = root.querySelector('button[type="submit"]');
    const footerActions = submit
      ? Array.from(submit.parentElement?.querySelectorAll("button") ?? [])
      : [];
    const activeStyle = getComputedStyle(document.activeElement);
    const outline = activeStyle.outlineColor;
    const alpha = outline.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/u);
    return {
      controlsComfortable: controls.every((control) => {
        const style = getComputedStyle(control);
        return (
          control.getBoundingClientRect().height >= 44 &&
          Number.parseFloat(style.fontSize) >= 14
        );
      }),
      opaqueFocus:
        activeStyle.outlineStyle !== "none" &&
        outline !== "transparent" &&
        (!alpha || Number.parseFloat(alpha[1]) === 1),
      noHorizontalOverflow:
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1 &&
        root.scrollWidth <= root.clientWidth + 1 &&
        controls.every(
          (control) => control.scrollWidth <= control.clientWidth + 1,
        ),
      longTokenContained: Array.from(root.querySelectorAll("textarea")).every(
        (control) => control.getBoundingClientRect().right <= innerWidth + 1,
      ),
      shortLandscapeActionsCompact:
        innerWidth <= 760 ||
        innerHeight > 560 ||
        (rowActions.every(sameRow) && sameRow(footerActions)),
    };
  });
  let beforeStep = counters();
  await editor.getByRole("button", { name: "Save rules", exact: true }).click();
  await surface
    .getByText("Project rules saved.", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  recordCounters(beforeStep);
  const firstRequest = fixtureState.projectRulesRequests[0];
  const firstUpsertExact =
    firstRequest?.expectedRevision === firstRequest?.acceptedRevision &&
    firstRequest?.mutation?.type === "project.upsert" &&
    JSON.stringify(firstRequest.mutation.project?.objectives) === "[]" &&
    JSON.stringify(firstRequest.mutation.project?.rules) ===
      JSON.stringify([PROJECT_RULE_INITIAL_CANARY, PROJECT_RULE_LONG_CANARY]);
  const firstSaveFocusRestored = await waitForExactFocus(
    surface.getByRole("button", { name: "Edit rules", exact: true }),
    "Project Rules did not restore focus after its first save.",
  );

  await surface
    .getByRole("button", { name: "Edit rules", exact: true })
    .click();
  editor = surface.locator('[data-project-rules-editor="true"]');
  await editor
    .getByRole("textbox", { name: "Project rule 1", exact: true })
    .fill(PROJECT_RULE_EDITED_CANARY);
  await editor.getByRole("button", { name: "Add rule", exact: true }).click();
  await editor
    .getByRole("textbox", { name: "Project rule 3", exact: true })
    .fill(PROJECT_RULE_ADDED_CANARY);
  await editor
    .getByRole("button", { name: "Move project rule 3 up", exact: true })
    .click();
  const moveFocus = await waitForExactFocus(
    editor.getByRole("button", { name: "Move project rule 2 up", exact: true }),
    "Moving a Project Rule did not keep focus on its moved row controls.",
  );
  await editor
    .getByRole("button", { name: "Move project rule 2 up", exact: true })
    .click();
  await editor
    .getByRole("button", { name: "Remove project rule 3", exact: true })
    .click();
  const removeFocus = await waitForExactFocus(
    editor.getByRole("textbox", { name: "Project rule 2", exact: true }),
    "Removing a Project Rule did not restore focus to the adjacent row.",
  );
  beforeStep = counters();
  await editor.getByRole("button", { name: "Save rules", exact: true }).click();
  await surface
    .getByText("Project rules saved.", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  await surface
    .getByRole("button", { name: "Edit rules", exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  await waitForFixtureCondition(
    () =>
      JSON.stringify(fixtureState.projectRules()) ===
      JSON.stringify([PROJECT_RULE_ADDED_CANARY, PROJECT_RULE_EDITED_CANARY]),
    "Edited Project Rules did not become durable.",
  );
  recordCounters(beforeStep);
  const editedOrder = [PROJECT_RULE_ADDED_CANARY, PROJECT_RULE_EDITED_CANARY];
  const editReorderRemoveExact =
    JSON.stringify(fixtureState.projectRules()) === JSON.stringify(editedOrder);

  await page.keyboard.press("Escape");
  await planner.waitFor({ state: "detached", timeout: 5_000 });
  const closeFocusRestored = await waitForLocatorFocus(page, trigger);
  ({ trigger, planner } = await openPlan());
  surface = planner.locator('[data-project-rules="true"]');
  const reopenedPersistenceExact =
    JSON.stringify(
      await surface.locator("details ol > li").allTextContents(),
    ) === JSON.stringify(editedOrder);
  const disclosure = surface.locator("details");
  const summary = disclosure.locator("summary");
  await summary.focus();
  const nativeDisclosureInitialFocus = await waitForLocatorFocus(page, summary);
  const nativeDisclosureInitiallyClosed = !(await disclosure.evaluate(
    (element) => element.open,
  ));
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.querySelector('[data-project-rules="true"] details')?.open,
    undefined,
    { timeout: 5_000 },
  );
  const nativeDisclosureKeyboardOpened = await disclosure.evaluate(
    (element) => element.open,
  );
  const nativeDisclosureOpenFocusRetained = await waitForLocatorFocus(
    page,
    summary,
  );
  const nativeDisclosureExactContentsVisible =
    JSON.stringify(await disclosure.locator("ol > li").allTextContents()) ===
      JSON.stringify(editedOrder) &&
    (await disclosure.locator("ol").isVisible()) &&
    (await surface
      .getByRole("button", { name: "Edit rules", exact: true })
      .isVisible());
  const nativeDisclosure =
    nativeDisclosureInitiallyClosed &&
    nativeDisclosureKeyboardOpened &&
    nativeDisclosureInitialFocus &&
    nativeDisclosureOpenFocusRetained &&
    nativeDisclosureExactContentsVisible;

  await surface
    .getByRole("button", { name: "Edit rules", exact: true })
    .click();
  editor = surface.locator('[data-project-rules-editor="true"]');
  await editor.waitFor({ state: "visible", timeout: 5_000 });
  await waitForExactFocus(
    editor.getByRole("textbox", { name: "Project rule 1", exact: true }),
    "Nested Project Rules editor did not focus its first rule before Escape.",
  );
  await page.keyboard.press("Escape");
  await editor.waitFor({ state: "detached", timeout: 5_000 });
  await surface
    .locator("details")
    .waitFor({ state: "visible", timeout: 5_000 });
  const nestedEscapeDisclosureRemountedOpen =
    (await surface.locator("details").evaluate((element) => element.open)) &&
    (await surface
      .getByRole("button", { name: "Edit rules", exact: true })
      .isVisible()) &&
    (await waitForLocatorFocus(
      page,
      surface.getByRole("button", { name: "Edit rules", exact: true }),
    ));
  await surface
    .getByRole("button", { name: "Edit rules", exact: true })
    .click();
  editor = surface.locator('[data-project-rules-editor="true"]');
  await editor.waitFor({ state: "visible", timeout: 5_000 });
  await waitForExactFocus(
    editor.getByRole("textbox", { name: "Project rule 1", exact: true }),
    "Nested Project Rules editor did not focus its first rule before Cancel.",
  );
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await editor.waitFor({ state: "detached", timeout: 5_000 });
  await surface
    .locator("details")
    .waitFor({ state: "visible", timeout: 5_000 });
  const nestedCancelDisclosureRemountedOpen =
    (await surface.locator("details").evaluate((element) => element.open)) &&
    (await surface
      .getByRole("button", { name: "Edit rules", exact: true })
      .isVisible()) &&
    (await waitForLocatorFocus(
      page,
      surface.getByRole("button", { name: "Edit rules", exact: true }),
    ));

  await surface
    .getByRole("button", { name: "Edit rules", exact: true })
    .click();
  editor = surface.locator('[data-project-rules-editor="true"]');
  await editor
    .getByRole("textbox", { name: "Project rule 1", exact: true })
    .fill(PROJECT_RULE_DRAFT_CONFLICT_CANARY);
  fixtureState.rejectNextProjectRulesMutation([PROJECT_RULE_CONCURRENT_CANARY]);
  beforeStep = counters();
  await editor.getByRole("button", { name: "Save rules", exact: true }).click();
  const conflict = editor.getByRole("alert");
  await conflict.waitFor({ state: "visible", timeout: 5_000 });
  recordCounters(beforeStep);
  const firstConflictDistinct =
    (await conflict.textContent())?.includes(
      "Project rules changed elsewhere",
    ) &&
    !(await conflict.textContent())?.includes(PROJECT_RULE_CONCURRENT_CANARY);
  await conflict
    .getByRole("button", { name: "Review latest rules", exact: true })
    .click();
  let confirmation = editor.getByRole("group", {
    name: "Confirm loading latest project rules",
  });
  const keepInitialFocus = await waitForExactFocus(
    confirmation.getByRole("button", { name: "Keep my draft", exact: true }),
    "Project Rules reload confirmation did not focus Keep my draft.",
  );
  await page.keyboard.press("Escape");
  const reloadEscapeRestoredFocus = await waitForExactFocus(
    conflict,
    "Project Rules did not restore conflict focus after Escape.",
  );
  await conflict
    .getByRole("button", { name: "Review latest rules", exact: true })
    .click();
  confirmation = editor.getByRole("group", {
    name: "Confirm loading latest project rules",
  });
  await confirmation
    .getByRole("button", { name: "Keep my draft", exact: true })
    .click();
  await conflict
    .getByRole("button", { name: "Use my draft", exact: true })
    .click();
  const useDraftPreserved =
    (await editor
      .getByRole("textbox", { name: "Project rule 1", exact: true })
      .inputValue()) === PROJECT_RULE_DRAFT_CONFLICT_CANARY;
  beforeStep = counters();
  await editor.getByRole("button", { name: "Save rules", exact: true }).click();
  await surface
    .getByText("Project rules saved.", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  await surface
    .getByRole("button", { name: "Edit rules", exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  await waitForFixtureCondition(
    () =>
      JSON.stringify(fixtureState.projectRules()) ===
      JSON.stringify([
        PROJECT_RULE_DRAFT_CONFLICT_CANARY,
        PROJECT_RULE_EDITED_CANARY,
      ]),
    "Rebased Project Rules did not become durable.",
  );
  recordCounters(beforeStep);

  await surface
    .getByRole("button", { name: "Edit rules", exact: true })
    .click();
  editor = surface.locator('[data-project-rules-editor="true"]');
  await editor
    .getByRole("textbox", { name: "Project rule 1", exact: true })
    .fill(PROJECT_RULE_SECOND_DRAFT_CANARY);
  fixtureState.rejectNextProjectRulesMutation([
    PROJECT_RULE_SECOND_CONCURRENT_CANARY,
  ]);
  beforeStep = counters();
  await editor.getByRole("button", { name: "Save rules", exact: true }).click();
  await editor.getByRole("alert").waitFor({ state: "visible", timeout: 5_000 });
  recordCounters(beforeStep);
  await editor
    .getByRole("button", { name: "Review latest rules", exact: true })
    .click();
  confirmation = editor.getByRole("group", {
    name: "Confirm loading latest project rules",
  });
  await confirmation
    .getByRole("button", { name: "Load latest rules", exact: true })
    .click();
  const loadLatestExact =
    (await editor
      .getByRole("textbox", { name: "Project rule 1", exact: true })
      .inputValue()) === PROJECT_RULE_SECOND_CONCURRENT_CANARY;
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();

  await surface
    .getByRole("button", { name: "Edit rules", exact: true })
    .click();
  editor = surface.locator('[data-project-rules-editor="true"]');
  fixtureState.bumpUnrelatedWorkspaceRevision();
  fixtureState.rejectNextProjectRulesMutation(fixtureState.projectRules());
  beforeStep = counters();
  await editor.getByRole("button", { name: "Save rules", exact: true }).click();
  await editor
    .getByRole("alert")
    .getByText(
      "The workspace changed elsewhere. Your project-rules draft was not overwritten.",
      { exact: true },
    )
    .waitFor({ state: "visible", timeout: 5_000 });
  recordCounters(beforeStep);
  const unrelatedWorkspaceChangeNotCalledRulesChange =
    (await editor
      .getByText("Project rules changed elsewhere", { exact: true })
      .count()) === 0;
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();

  await surface
    .getByRole("button", { name: "Edit rules", exact: true })
    .click();
  editor = surface.locator('[data-project-rules-editor="true"]');
  await editor
    .getByRole("button", { name: "Clear rules", exact: true })
    .click();
  confirmation = editor.getByRole("group", {
    name: "Confirm clearing project rules",
  });
  const clearBackInitialFocus = await waitForExactFocus(
    confirmation.getByRole("button", { name: "Back", exact: true }),
    "Project Rules clear confirmation did not focus Back.",
  );
  await page.keyboard.press("Escape");
  const clearEscapeRestoredEditor =
    JSON.stringify(
      await editor
        .getByRole("textbox", { name: /Project rule/u })
        .evaluateAll((elements) =>
          elements.map((element) =>
            "value" in element ? String(element.value) : "",
          ),
        ),
    ) === JSON.stringify([PROJECT_RULE_SECOND_CONCURRENT_CANARY]);
  await editor
    .getByRole("button", { name: "Clear rules", exact: true })
    .click();
  beforeStep = counters();
  await confirmation
    .getByRole("button", { name: "Clear rules", exact: true })
    .click();
  await surface
    .getByText("Project rules cleared.", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  await surface
    .getByRole("button", { name: "Add project rules", exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  await waitForFixtureCondition(
    () => fixtureState.projectRules().length === 0,
    "Cleared Project Rules remained durable in the fixture.",
  );
  recordCounters(beforeStep);
  const clearedExact = fixtureState.projectRules().length === 0;
  const clearSuccessFocus = await waitForExactFocus(
    surface.getByRole("button", { name: "Add project rules", exact: true }),
    "Project Rules did not restore focus after clearing.",
  );
  ({ trigger, planner } = await reopen());
  surface = planner.locator('[data-project-rules="true"]');
  const exactNoRulesState =
    (await surface
      .getByText("No project rules recorded.", { exact: true })
      .count()) === 1 &&
    (await surface.getByText("Not recorded", { exact: true }).count()) === 1;

  await surface
    .getByRole("button", { name: "Add project rules", exact: true })
    .click();
  editor = surface.locator('[data-project-rules-editor="true"]');
  await editor.getByRole("button", { name: "Add rule", exact: true }).click();
  await editor
    .getByRole("textbox", { name: "Project rule 1", exact: true })
    .fill(PROJECT_RULE_ORPHAN_CANARY);
  fixtureState.removeWorkspaceProject();
  fixtureState.rejectNextProjectRulesMutation([]);
  const orphanCountersBefore = counters();
  await editor.getByRole("button", { name: "Save rules", exact: true }).click();
  const orphan = editor.locator('[data-project-rules-orphaned="true"]');
  await orphan.waitFor({ state: "visible", timeout: 5_000 });
  recordCounters(orphanCountersBefore);
  const orphanInitialFocus = await waitForExactFocus(
    orphan,
    "The orphaned Project Rules draft did not receive focus.",
  );
  const orphanPreservedCopyableUnsaveable =
    (await orphan.textContent())?.includes(PROJECT_RULE_ORPHAN_CANARY) &&
    (await editor
      .getByRole("button", { name: "Save rules", exact: true })
      .count()) === 0 &&
    (await orphan
      .getByRole("button", { name: "Use my draft", exact: true })
      .count()) === 0 &&
    (await orphan
      .getByRole("button", { name: "Review latest rules", exact: true })
      .count()) === 0 &&
    (await orphan
      .getByRole("button", { name: "Keep my draft", exact: true })
      .count()) === 0 &&
    (await orphan
      .getByRole("button", { name: "Load latest rules", exact: true })
      .count()) === 0 &&
    (await orphan.getByRole("button").allTextContents()).join("|").trim() ===
      "Cancel" &&
    (await orphan.evaluate(
      (element) => getComputedStyle(element).userSelect,
    )) !== "none";
  const orphanNeverRecreated =
    fixtureState.workspaceProject() === null &&
    JSON.stringify({
      requests: counters().requests - orphanCountersBefore.requests,
      writes: counters().writes - orphanCountersBefore.writes,
      conflicts: counters().conflicts - orphanCountersBefore.conflicts,
      mutations: counters().mutations - orphanCountersBefore.mutations,
    }) ===
      JSON.stringify({ requests: 1, writes: 0, conflicts: 1, mutations: 1 }) &&
    !fixtureState.projectRulesConflictArmed();
  await orphan.getByRole("button", { name: "Cancel", exact: true }).click();
  const orphanCancelRestoredAdd =
    (await surface
      .getByRole("button", { name: "Add project rules", exact: true })
      .isVisible()) &&
    (await waitForLocatorFocus(
      page,
      surface.getByRole("button", { name: "Add project rules", exact: true }),
    ));

  const baselineProject = syntheticWorkspaceFixture(
    syntheticFixture(60_000, fixtureState.observedAt),
  ).projects[0];
  fixtureState.restoreWorkspaceProject(baselineProject, {
    rules: [PROJECT_RULE_CURRENT_A_CANARY],
  });
  fixtureState.renameProject(PRIMARY_PROJECT_ID, RENAMED_PRIMARY_PROJECT_NAME);
  ({ planner } = await reopen());
  surface = planner.locator('[data-project-rules="true"]');
  const stableIdRenameRetainsRules =
    (await surface
      .getByText(PROJECT_RULE_CURRENT_A_CANARY, { exact: true })
      .count()) === 1;
  await page.keyboard.press("Escape");
  fixtureState.removeProject(PRIMARY_PROJECT_ID);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { timeout: 30_000 });
  const sourceAbsentWithoutRuleLoss =
    JSON.stringify(fixtureState.projectRules()) ===
    JSON.stringify([PROJECT_RULE_CURRENT_A_CANARY]);
  fixtureState.readdProject(PRIMARY_PROJECT_ID);
  ({ planner } = await reopen());
  surface = planner.locator('[data-project-rules="true"]');
  const temporarySourceReturnRetainsRules =
    (await surface
      .getByText(PROJECT_RULE_CURRENT_A_CANARY, { exact: true })
      .count()) === 1;
  fixtureState.removeWorkspaceProject();
  ({ planner } = await reopen());
  surface = planner.locator('[data-project-rules="true"]');
  const explicitLocalRemovalReaddStartsEmpty =
    (await surface
      .getByText("No project rules recorded.", { exact: true })
      .count()) === 1 && fixtureState.workspaceProject() === null;

  screenshots.set(
    `${viewportId}-plan-project-rules`,
    await page.screenshot({ fullPage: false }),
  );
  const privacy = await page.evaluate((canaries) => {
    const storage = `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}`;
    const aria = Array.from(document.querySelectorAll("[aria-label]"))
      .map((element) => element.getAttribute("aria-label"))
      .join("|");
    return {
      storageClean: canaries.every((canary) => !storage.includes(canary)),
      ariaClean: canaries.every((canary) => !aria.includes(canary)),
      urlClean: canaries.every((canary) => !location.href.includes(canary)),
      domHasOnlyExpectedNoRulesCopy: canaries.every(
        (canary) => !document.documentElement.textContent.includes(canary),
      ),
    };
  }, PROJECT_RULE_CANARIES);
  const externalPrivacy = fixtureState.projectRulesExternalPrivacy(
    PROJECT_RULE_CANARIES,
  );
  const requests = fixtureState.projectRulesRequests;
  const expectedRulePayloads = [
    [PROJECT_RULE_INITIAL_CANARY, PROJECT_RULE_LONG_CANARY],
    [PROJECT_RULE_ADDED_CANARY, PROJECT_RULE_EDITED_CANARY],
    [PROJECT_RULE_DRAFT_CONFLICT_CANARY, PROJECT_RULE_EDITED_CANARY],
    [PROJECT_RULE_DRAFT_CONFLICT_CANARY, PROJECT_RULE_EDITED_CANARY],
    [PROJECT_RULE_SECOND_DRAFT_CANARY, PROJECT_RULE_EDITED_CANARY],
    [PROJECT_RULE_SECOND_CONCURRENT_CANARY],
    [],
    [PROJECT_RULE_ORPHAN_CANARY],
  ];
  const revisionsAndEnvelopesExact =
    requests.length === 8 &&
    requests.every(
      (request, index) =>
        typeof request.mutationId === "string" &&
        request.mutationId.length > 0 &&
        request.mutation?.type ===
          (index === 0 ? "project.upsert" : "project.rules.set") &&
        (index === 0
          ? request.mutation.project?.id === PRIMARY_PROJECT_ID &&
            request.mutation.project?.title === "Acceptance Office" &&
            JSON.stringify(request.mutation.project?.objectives) === "[]" &&
            JSON.stringify(request.mutation.project?.rules) ===
              JSON.stringify(expectedRulePayloads[index])
          : request.mutation.projectId === PRIMARY_PROJECT_ID &&
            JSON.stringify(request.mutation.rules) ===
              JSON.stringify(expectedRulePayloads[index])),
    ) &&
    new Set(requests.map((request) => request.mutationId)).size === 8 &&
    JSON.stringify(requests.map((request) => request.expectedRevision)) ===
      JSON.stringify([1, 2, 3, 4, 5, 6, 8, 9]) &&
    JSON.stringify(requests.map((request) => request.acceptedRevision)) ===
      JSON.stringify([1, 2, 3, 4, 5, 7, 8, 10]);
  const mutationSequenceExact =
    JSON.stringify(requests.map((request) => request.mutation.type)) ===
    JSON.stringify([
      "project.upsert",
      "project.rules.set",
      "project.rules.set",
      "project.rules.set",
      "project.rules.set",
      "project.rules.set",
      "project.rules.set",
      "project.rules.set",
    ]);
  const stepDeltasExact =
    JSON.stringify(counterDeltas) ===
    JSON.stringify([
      { requests: 1, writes: 1, conflicts: 0, mutations: 1 },
      { requests: 1, writes: 1, conflicts: 0, mutations: 1 },
      { requests: 1, writes: 0, conflicts: 1, mutations: 1 },
      { requests: 1, writes: 1, conflicts: 0, mutations: 1 },
      { requests: 1, writes: 0, conflicts: 1, mutations: 1 },
      { requests: 1, writes: 0, conflicts: 1, mutations: 1 },
      { requests: 1, writes: 1, conflicts: 0, mutations: 1 },
      { requests: 1, writes: 0, conflicts: 1, mutations: 1 },
    ]);
  return {
    rulesFirstWithoutLocalProject,
    draftBadgeExact,
    triggerKeyboardReachable,
    initialEditorFocus,
    addFocus,
    moveFocus,
    removeFocus,
    controlsComfortable: layout.controlsComfortable,
    opaqueFocus: layout.opaqueFocus,
    noHorizontalOverflow: layout.noHorizontalOverflow,
    longTokenContained: layout.longTokenContained,
    shortLandscapeActionsCompact: layout.shortLandscapeActionsCompact,
    firstUpsertExact,
    firstSaveFocusRestored,
    editReorderRemoveExact,
    closeFocusRestored,
    reopenedPersistenceExact,
    nativeDisclosure,
    nativeDisclosureInitiallyClosed,
    nativeDisclosureKeyboardOpened,
    nativeDisclosureOpenFocusRetained,
    nativeDisclosureExactContentsVisible,
    nestedEscapeDisclosureRemountedOpen,
    nestedCancelDisclosureRemountedOpen,
    firstConflictDistinct: Boolean(firstConflictDistinct),
    keepInitialFocus,
    reloadEscapeRestoredFocus,
    useDraftPreserved,
    loadLatestExact,
    unrelatedWorkspaceChangeNotCalledRulesChange,
    clearBackInitialFocus,
    clearEscapeRestoredEditor,
    clearSuccessFocus,
    clearedExact,
    exactNoRulesState,
    orphanPreservedCopyableUnsaveable: Boolean(
      orphanPreservedCopyableUnsaveable,
    ),
    orphanInitialFocus,
    orphanCancelRestoredAdd,
    orphanNeverRecreated,
    stableIdRenameRetainsRules,
    sourceAbsentWithoutRuleLoss,
    temporarySourceReturnRetainsRules,
    explicitLocalRemovalReaddStartsEmpty,
    revisionsAndEnvelopesExact,
    mutationSequenceExact,
    stepDeltasExact,
    conflictCount: fixtureState.projectRulesConflictCount,
    requestCount: requests.length,
    successfulWriteCount: fixtureState.projectRulesWriteCount,
    workspaceWriteDelta: fixtureState.workspaceWriteCount - writesBefore,
    workspaceMutationAttemptDelta:
      fixtureState.workspaceMutationAttemptCount - mutationAttemptsBefore,
    resultObservationWriteDelta:
      fixtureState.resultObservationWriteCount - resultObservationWritesBefore,
    codexMutationDelta: (await codexMutationCount(fixtureState)) - codexBefore,
    verificationMutationDelta:
      fixtureState.verificationMutationCount() - verificationBefore,
    storageClean: privacy.storageClean,
    ariaClean: privacy.ariaClean,
    urlClean: privacy.urlClean,
    domClean: privacy.domHasOnlyExpectedNoRulesCopy,
    publicSnapshotClean: externalPrivacy.publicSnapshotClean,
    publicEventSurfacesClean: externalPrivacy.publicEventSurfacesClean,
    structuralWorkspaceEventsClean:
      externalPrivacy.structuralWorkspaceEventsClean,
    codexRequestSurfacesClean: externalPrivacy.codexRequestSurfacesClean,
    verificationRequestSurfacesClean:
      externalPrivacy.verificationRequestSurfacesClean,
    pendingCodexBodiesClean: externalPrivacy.pendingCodexBodiesClean,
    codexOperationSurfacesClean: externalPrivacy.codexOperationSurfacesClean,
    liveVerificationSurfacesClean:
      externalPrivacy.liveVerificationSurfacesClean,
  };
}

async function auditProjectQualityBars(
  page,
  screenshots,
  viewportId,
  fixtureState,
) {
  const writesBefore = fixtureState.workspaceWriteCount;
  const attemptsBefore = fixtureState.workspaceMutationAttemptCount;
  const codexBefore = await codexMutationCount(fixtureState);
  const verificationBefore = fixtureState.verificationMutationCount();
  await enterTopDownOffice(page);
  const planTrigger = page.getByRole("button", { name: "Plan", exact: true });
  await planTrigger.click();
  let planner = page.locator('[data-work-planner="true"]');
  await planner.waitFor({ state: "visible", timeout: 5_000 });
  let surface = planner.locator('[data-project-quality-bars="true"]');
  await surface.waitFor({ state: "visible", timeout: 5_000 });
  const firstSaveStateExact =
    (await surface
      .getByText("No quality bars selected.", { exact: true })
      .count()) === 1 &&
    (await surface
      .getByText(
        "Saving the first selection also creates this project's local Coffice plan.",
        { exact: true },
      )
      .count()) === 1;
  const setTrigger = surface.getByRole("button", {
    name: "Set quality bars",
    exact: true,
  });
  await setTrigger.focus();
  const triggerKeyboardReachable = await waitForLocatorFocus(page, setTrigger);
  await setTrigger.click();
  let editor = surface.locator("form");
  await editor.waitFor({ state: "visible", timeout: 5_000 });
  const tests = editor.getByRole("checkbox", { name: "Tests", exact: true });
  const lint = editor.getByRole("checkbox", { name: "Lint", exact: true });
  const initialFocus = await waitForLocatorFocus(page, tests);
  await tests.check();
  await lint.check();
  const noDraftWrite =
    fixtureState.projectQualityBarsRequests.length === 0 &&
    fixtureState.projectQualityBarsWriteCount === 0;
  await lint.focus();
  screenshots.set(
    `${viewportId}-plan-project-quality-bars`,
    await page.screenshot({ fullPage: false }),
  );
  const editorLayout = await editor.evaluate((root) => {
    const controls = Array.from(root.querySelectorAll("button, input"));
    const focusSurface =
      document.activeElement?.closest("label") ?? document.activeElement;
    const activeStyle = getComputedStyle(focusSurface);
    const outline = activeStyle.outlineColor;
    const alpha = outline.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/u);
    return {
      controlsComfortable: controls.every((control) => {
        const style = getComputedStyle(control);
        const rect = control.getBoundingClientRect();
        return (
          control.matches('input[type="checkbox"]') ||
          (rect.height >= 44 && Number.parseFloat(style.fontSize) >= 14)
        );
      }),
      opaqueFocus:
        activeStyle.outlineStyle !== "none" &&
        outline !== "transparent" &&
        (!alpha || Number.parseFloat(alpha[1]) === 1),
      noHorizontalOverflow:
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1 &&
        root.scrollWidth <= root.clientWidth + 1,
    };
  });
  await editor
    .getByRole("button", { name: "Save quality bars", exact: true })
    .click();
  await surface
    .getByText("Quality bars saved.", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  const editTrigger = surface.getByRole("button", {
    name: "Edit quality bars",
    exact: true,
  });
  const firstSaveFocus = await waitForLocatorFocus(page, editTrigger);
  const firstRequest = fixtureState.projectQualityBarsRequests[0];
  const firstUpsertExact =
    firstRequest?.mutation?.type === "project.upsert" &&
    firstRequest.expectedRevision === firstRequest.acceptedRevision &&
    JSON.stringify(firstRequest.mutation.project?.objectives) === "[]" &&
    JSON.stringify(firstRequest.mutation.project?.qualityBars) ===
      JSON.stringify([
        { profileId: "test", profileVersion: "1" },
        { profileId: "lint", profileVersion: "1" },
      ]);

  await editTrigger.click();
  editor = surface.locator("form");
  await editor.getByRole("checkbox", { name: "Lint", exact: true }).uncheck();
  await editor
    .getByRole("checkbox", { name: "Production build", exact: true })
    .check();
  await editor
    .getByRole("button", { name: "Save quality bars", exact: true })
    .click();
  await surface
    .getByText("Quality bars saved.", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  await waitForFixtureCondition(
    () =>
      JSON.stringify(fixtureState.projectQualityBars()) ===
      JSON.stringify([
        { profileId: "test", profileVersion: "1" },
        { profileId: "build", profileVersion: "1" },
      ]),
    "Edited Project Quality Bars did not become durable.",
  );
  const secondRequest = fixtureState.projectQualityBarsRequests[1];
  const dedicatedMutationExact =
    secondRequest?.mutation?.type === "project.qualityBars.set" &&
    secondRequest.expectedRevision === secondRequest.acceptedRevision &&
    secondRequest.mutation.projectId === PRIMARY_PROJECT_ID &&
    JSON.stringify(secondRequest.mutation.qualityBars) ===
      JSON.stringify([
        { profileId: "test", profileVersion: "1" },
        { profileId: "build", profileVersion: "1" },
      ]);
  const details = surface.locator("details");
  const persistedExact =
    JSON.stringify(await details.locator("ol > li").allTextContents()) ===
    JSON.stringify(["Tests", "Production build"]);
  await surface
    .getByRole("button", { name: "Edit quality bars", exact: true })
    .click();
  editor = surface.locator("form");
  await editor
    .getByRole("button", { name: "Clear quality bars", exact: true })
    .click();
  const confirmation = editor.getByRole("group", {
    name: "Confirm clearing quality bars",
  });
  const clearBackFocus = await waitForLocatorFocus(
    page,
    confirmation.getByRole("button", { name: "Back", exact: true }),
  );
  await confirmation
    .getByRole("button", { name: "Clear quality bars", exact: true })
    .click();
  await surface
    .getByText("Quality bars cleared.", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  const clearExact = fixtureState.projectQualityBars().length === 0;
  const clearFocus = await waitForLocatorFocus(
    page,
    surface.getByRole("button", { name: "Set quality bars", exact: true }),
  );
  const requests = fixtureState.projectQualityBarsRequests;
  const envelopesExact =
    requests.length === 3 &&
    new Set(requests.map((request) => request.mutationId)).size === 3 &&
    requests.every(
      (request) =>
        typeof request.mutationId === "string" &&
        request.mutationId.length > 0 &&
        request.expectedRevision === request.acceptedRevision,
    ) &&
    requests[2]?.mutation?.type === "project.qualityBars.set" &&
    JSON.stringify(requests[2].mutation.qualityBars) === "[]";

  await page.keyboard.press("Escape");
  await planner.waitFor({ state: "detached", timeout: 5_000 });
  fixtureState.restoreQualityBarsReviewProject([
    { profileId: "test", profileVersion: "1" },
    { profileId: "build", profileVersion: "1" },
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });
  const { inspector } = await openSavedComparisonInspector(page, fixtureState);
  const review = inspector.locator(
    '[data-current-project-quality-bars="true"]',
  );
  await review.waitFor({ state: "visible", timeout: 5_000 });
  const reviewExact =
    (await review
      .getByText("Current project quality bars", { exact: true })
      .count()) === 1 &&
    (await review.getByText("Not ready", { exact: true }).count()) === 1 &&
    (await review.getByText("Tests", { exact: true }).count()) === 1 &&
    (await review.getByText("Passed", { exact: true }).count()) === 1 &&
    (await review.getByText("Production build", { exact: true }).count()) ===
      1 &&
    (await review.getByText("Failed", { exact: true }).count()) === 1 &&
    (await review.locator("button, input, textarea, select").count()) === 0 &&
    (await review
      .getByText(
        "Current project standard—not a snapshot stored with this result. Coffice does not run checks automatically or block acceptance.",
        { exact: true },
      )
      .count()) === 1;
  await review.scrollIntoViewIfNeeded();
  screenshots.set(
    `${viewportId}-review-project-quality-bars`,
    await page.screenshot({ fullPage: false }),
  );
  await inspector
    .getByRole("button", { name: "Accept result", exact: true })
    .click();
  const confirm = inspector.getByRole("button", {
    name: "Confirm decision",
    exact: true,
  });
  const acceptanceNotBlocked =
    !(await confirm.isDisabled()) &&
    (await inspector
      .getByText(
        "Current project quality bars: Not ready. Coffice does not run checks automatically or block acceptance.",
        { exact: true },
      )
      .count()) === 1;
  await inspector.getByRole("button", { name: "Back", exact: true }).click();
  const reviewLayout = await review.evaluate((root) => {
    const panel = root.closest('[data-review-act-inspector="true"]');
    const rootRect = root.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    return {
      contained:
        Boolean(panelRect) &&
        rootRect.left >= panelRect.left - 1 &&
        rootRect.right <= panelRect.right + 1,
      noHorizontalOverflow:
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1 &&
        root.scrollWidth <= root.clientWidth + 1,
    };
  });
  return {
    firstSaveStateExact,
    triggerKeyboardReachable,
    initialFocus,
    noDraftWrite,
    controlsComfortable: editorLayout.controlsComfortable,
    opaqueFocus: editorLayout.opaqueFocus,
    editorNoHorizontalOverflow: editorLayout.noHorizontalOverflow,
    firstUpsertExact,
    firstSaveFocus,
    dedicatedMutationExact,
    persistedExact,
    clearBackFocus,
    clearExact,
    clearFocus,
    envelopesExact,
    reviewExact,
    acceptanceNotBlocked,
    reviewContained: reviewLayout.contained,
    reviewNoHorizontalOverflow: reviewLayout.noHorizontalOverflow,
    requestCount: requests.length,
    successfulWriteCount: fixtureState.projectQualityBarsWriteCount,
    workspaceWriteDelta: fixtureState.workspaceWriteCount - writesBefore,
    workspaceMutationAttemptDelta:
      fixtureState.workspaceMutationAttemptCount - attemptsBefore,
    codexMutationDelta: (await codexMutationCount(fixtureState)) - codexBefore,
    verificationMutationDelta:
      fixtureState.verificationMutationCount() - verificationBefore,
  };
}

async function auditProjectContextReview(
  page,
  planner,
  screenshots,
  viewportId,
  fixtureState,
) {
  const baselineWrites = fixtureState.workspaceWriteCount;
  const baselineAttempts = fixtureState.workspaceMutationAttemptCount;
  const baselineCodex = fixtureState.codexRouteRequests.length;
  const baselineVerification = fixtureState.verificationRouteRequests.length;
  const surface = planner.locator('[data-project-context-review="true"]');
  await surface.waitFor({ state: "visible", timeout: 5_000 });
  const initialExact =
    (await surface
      .getByText("Needs context review · Stale", { exact: true })
      .count()) === 1 &&
    (await surface
      .getByText(PROJECT_CONTEXT_REVIEW_INITIAL_CANARY, { exact: true })
      .count()) === 1;
  const edit = surface.getByRole("button", { name: "Edit flag", exact: true });
  await edit.click();
  const stale = surface.getByRole("checkbox", { name: "Stale", exact: true });
  const contradictory = surface.getByRole("checkbox", {
    name: "Contradictory",
    exact: true,
  });
  const staleHandle = await stale.elementHandle();
  if (!staleHandle)
    throw new Error("Context-review stale checkbox is missing.");
  await page.waitForFunction(
    (element) => document.activeElement === element,
    staleHandle,
    { timeout: 5_000 },
  );
  const initialFocus = true;
  const initialSelectionExact =
    (await stale.isChecked()) && !(await contradictory.isChecked());
  await contradictory.click();
  await surface
    .getByRole("textbox", { name: "Review note optional", exact: true })
    .fill(PROJECT_CONTEXT_REVIEW_EDITED_CANARY);
  const noDraftWrite =
    fixtureState.workspaceWriteCount === baselineWrites &&
    fixtureState.projectContextReviewRequests.length === 0;
  screenshots.set(
    `${viewportId}-plan-context-review-editor`,
    await page.screenshot({ fullPage: false }),
  );
  await surface
    .getByRole("button", { name: "Save context flag", exact: true })
    .click();
  await surface
    .getByText("Project context flagged for review.", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  const firstSaveExact =
    JSON.stringify(fixtureState.projectContextReview()?.concerns) ===
      JSON.stringify(["stale", "contradictory"]) &&
    fixtureState.projectContextReview()?.note ===
      PROJECT_CONTEXT_REVIEW_EDITED_CANARY &&
    (await surface
      .getByText("Needs context review · Stale + Contradictory", {
        exact: true,
      })
      .count()) === 1;
  const firstSaveFocus = await edit.evaluate(
    (element) => document.activeElement === element,
  );

  await surface
    .getByRole("button", { name: "Mark context reviewed", exact: true })
    .click();
  const confirmation = surface.getByRole("group", {
    name: "Confirm context reviewed",
    exact: true,
  });
  await confirmation.waitFor({ state: "visible", timeout: 5_000 });
  const back = confirmation.getByRole("button", { name: "Back", exact: true });
  const confirmationFocus = await back.evaluate(
    (element) => document.activeElement === element,
  );
  await back.click();
  await page.waitForFunction(
    (element) => document.activeElement === element,
    await stale.elementHandle(),
    { timeout: 5_000 },
  );
  const backFocus = await stale.evaluate(
    (element) => document.activeElement === element,
  );
  await page.keyboard.press("Escape");
  await edit.waitFor({ state: "visible", timeout: 5_000 });
  const escapeFocus = await waitForLocatorFocus(page, edit);

  await surface
    .getByRole("button", { name: "Mark context reviewed", exact: true })
    .click();
  await confirmation.waitFor({ state: "visible", timeout: 5_000 });
  await confirmation
    .getByRole("button", { name: "Mark reviewed", exact: true })
    .click();
  await surface
    .getByText("Project context marked reviewed.", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  const cleared = fixtureState.projectContextReview() === null;
  const flag = surface.getByRole("button", {
    name: "Flag context",
    exact: true,
  });
  const clearFocus = await waitForLocatorFocus(page, flag);

  await flag.click();
  await surface.getByRole("checkbox", { name: "Stale", exact: true }).click();
  await surface
    .getByRole("textbox", { name: "Review note optional", exact: true })
    .fill(PROJECT_CONTEXT_REVIEW_INITIAL_CANARY);
  await surface
    .getByRole("button", { name: "Save context flag", exact: true })
    .click();
  await surface
    .getByText("Project context flagged for review.", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  const restoredExact =
    JSON.stringify(fixtureState.projectContextReview()?.concerns) ===
      JSON.stringify(["stale"]) &&
    fixtureState.projectContextReview()?.note ===
      PROJECT_CONTEXT_REVIEW_INITIAL_CANARY;
  const requests = fixtureState.projectContextReviewRequests;
  const envelopesExact =
    requests.length === 3 &&
    requests.every(
      (request) =>
        request.mutation.projectId === PRIMARY_PROJECT_ID &&
        request.expectedRevision === request.acceptedRevision &&
        typeof request.mutationId === "string" &&
        request.mutationId.length > 0,
    ) &&
    requests[0].mutation.type === "project.contextReview.set" &&
    JSON.stringify(requests[0].mutation.concerns) ===
      JSON.stringify(["stale", "contradictory"]) &&
    requests[1].mutation.type === "project.contextReview.clear" &&
    requests[2].mutation.type === "project.contextReview.set" &&
    JSON.stringify(requests[2].mutation.concerns) === JSON.stringify(["stale"]);
  const layout = await surface.evaluate((element) => {
    const controls = Array.from(
      element.querySelectorAll("button, input, textarea"),
    );
    return {
      comfortable: controls.every((control) => {
        const rect = control.getBoundingClientRect();
        const inputComfortable =
          control instanceof HTMLInputElement && control.type === "checkbox"
            ? rect.width >= 20 && rect.height >= 20
            : rect.height >= 44;
        return (
          inputComfortable &&
          Number.parseFloat(getComputedStyle(control).fontSize) >=
            (control instanceof HTMLInputElement ? 0 : 14)
        );
      }),
      noHorizontalOverflow: element.scrollWidth <= element.clientWidth + 1,
    };
  });
  const browserPrivacy = await page.evaluate(
    (canaries) => {
      const storage = `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}`;
      return {
        storageClean: canaries.every((canary) => !storage.includes(canary)),
        urlClean: canaries.every((canary) => !location.href.includes(canary)),
      };
    },
    [
      PROJECT_CONTEXT_REVIEW_INITIAL_CANARY,
      PROJECT_CONTEXT_REVIEW_EDITED_CANARY,
    ],
  );
  return {
    initialExact,
    initialFocus,
    initialSelectionExact,
    noDraftWrite,
    firstSaveExact,
    firstSaveFocus,
    confirmationFocus,
    backFocus,
    escapeFocus,
    cleared,
    clearFocus,
    restoredExact,
    envelopesExact,
    requestCount: requests.length,
    successfulWriteCount: fixtureState.projectContextReviewWriteCount,
    workspaceWriteDelta: fixtureState.workspaceWriteCount - baselineWrites,
    workspaceMutationAttemptDelta:
      fixtureState.workspaceMutationAttemptCount - baselineAttempts,
    codexMutationDelta: fixtureState.codexRouteRequests.length - baselineCodex,
    verificationMutationDelta:
      fixtureState.verificationRouteRequests.length - baselineVerification,
    controlsComfortable: layout.comfortable,
    noHorizontalOverflow: layout.noHorizontalOverflow,
    storageClean: browserPrivacy.storageClean,
    urlClean: browserPrivacy.urlClean,
  };
}

async function auditProjectReviewSchedule(
  page,
  planner,
  screenshots,
  viewportId,
  fixtureState,
) {
  const baselineWrites = fixtureState.workspaceWriteCount;
  const baselineAttempts = fixtureState.workspaceMutationAttemptCount;
  const baselineCodex = fixtureState.codexRouteRequests.length;
  const baselineVerification = fixtureState.verificationRouteRequests.length;
  const surface = planner.locator('[data-project-review-schedule="true"]');
  await surface.waitFor({ state: "visible", timeout: 5_000 });
  const initialExact =
    (await surface
      .getByText("Repeats every 7 days", { exact: true })
      .count()) === 1 &&
    fixtureState.projectReviewSchedule()?.repeatEveryDays === 7;
  const edit = surface.getByRole("button", {
    name: "Edit schedule",
    exact: true,
  });
  await edit.click();
  const due = surface.getByLabel("Next review your local time", {
    exact: true,
  });
  await due.waitFor({ state: "visible", timeout: 5_000 });
  const dueHandle = await due.elementHandle();
  if (!dueHandle) throw new Error("Scheduled-review date control is missing.");
  await page.waitForFunction(
    (element) => document.activeElement === element,
    dueHandle,
    { timeout: 5_000 },
  );
  const initialFocus = true;
  const nextLocal = await page.evaluate(() => {
    const date = new Date(Date.now() + 21 * 24 * 60 * 60 * 1_000);
    const pad = (value) => String(value).padStart(2, "0");
    return [
      date.getFullYear(),
      "-",
      pad(date.getMonth() + 1),
      "-",
      pad(date.getDate()),
      "T",
      pad(date.getHours()),
      ":",
      pad(date.getMinutes()),
    ].join("");
  });
  await due.fill(nextLocal);
  await surface.getByLabel("Repeat every days", { exact: true }).fill("14");
  const noDraftWrite =
    fixtureState.workspaceWriteCount === baselineWrites &&
    fixtureState.projectReviewScheduleRequests.length === 0;
  screenshots.set(
    viewportId + "-plan-scheduled-review",
    await page.screenshot({ fullPage: false }),
  );
  await surface
    .getByRole("button", { name: "Save schedule", exact: true })
    .click();
  await surface
    .getByText("Project review scheduled.", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  const saved = fixtureState.projectReviewSchedule();
  const firstSaveExact =
    saved?.repeatEveryDays === 14 &&
    Number.isFinite(Date.parse(saved?.nextReviewAt ?? "")) &&
    (await surface
      .getByText("Repeats every 14 days", { exact: true })
      .count()) === 1;
  const firstSaveFocus = await edit.evaluate(
    (element) => document.activeElement === element,
  );

  await edit.click();
  const completionDue = surface.getByLabel("Next review your local time", {
    exact: true,
  });
  await completionDue.waitFor({ state: "visible", timeout: 5_000 });
  const completionDueHandle = await completionDue.elementHandle();
  if (!completionDueHandle) {
    throw new Error("Scheduled-review completion date control is missing.");
  }
  await surface
    .getByRole("button", { name: "Mark reviewed", exact: true })
    .click();
  const confirmation = surface.getByRole("group", {
    name: "Confirm project review complete",
    exact: true,
  });
  await confirmation.waitFor({ state: "visible", timeout: 5_000 });
  const noAutomaticCheckCopy =
    (await confirmation
      .getByText("No quality check runs automatically.", { exact: false })
      .count()) === 1;
  const back = confirmation.getByRole("button", {
    name: "Back",
    exact: true,
  });
  const confirmationFocus = await back.evaluate(
    (element) => document.activeElement === element,
  );
  await back.click();
  await completionDue.waitFor({ state: "visible", timeout: 5_000 });
  const backDueHandle = await completionDue.elementHandle();
  if (!backDueHandle) {
    throw new Error("Scheduled-review date control did not remount.");
  }
  await page.waitForFunction(
    (element) => document.activeElement === element,
    backDueHandle,
    { timeout: 5_000 },
  );
  const backFocus = true;
  await surface
    .getByRole("button", { name: "Mark reviewed", exact: true })
    .click();
  await confirmation
    .getByRole("button", { name: "Mark project reviewed", exact: true })
    .click();
  await surface
    .getByText("Project reviewed. The next reminder was scheduled.", {
      exact: true,
    })
    .waitFor({ state: "visible", timeout: 5_000 });
  const completed = fixtureState.projectReviewSchedule();
  const completedExact =
    completed?.repeatEveryDays === 14 &&
    typeof completed?.lastReviewedAt === "string" &&
    Date.parse(completed.nextReviewAt) > Date.parse(completed.lastReviewedAt);
  const completeFocus = await waitForLocatorFocus(page, edit);
  const requests = fixtureState.projectReviewScheduleRequests;
  const envelopesExact =
    requests.length === 2 &&
    requests.every(
      (request) =>
        request.mutation.projectId === PRIMARY_PROJECT_ID &&
        request.expectedRevision === request.acceptedRevision &&
        typeof request.mutationId === "string" &&
        request.mutationId.length > 0,
    ) &&
    requests[0].mutation.type === "project.reviewSchedule.set" &&
    requests[0].mutation.repeatEveryDays === 14 &&
    requests[1].mutation.type === "project.reviewSchedule.complete";
  const layout = await surface.evaluate((element) => {
    const controls = Array.from(element.querySelectorAll("button, input"));
    return {
      comfortable: controls.every((control) => {
        const rect = control.getBoundingClientRect();
        const checkbox =
          control instanceof HTMLInputElement && control.type === "checkbox";
        return (
          (checkbox
            ? rect.width >= 20 && rect.height >= 20
            : rect.height >= 44) &&
          (checkbox ||
            Number.parseFloat(getComputedStyle(control).fontSize) >= 14)
        );
      }),
      noHorizontalOverflow: element.scrollWidth <= element.clientWidth + 1,
    };
  });
  return {
    initialExact,
    initialFocus,
    noDraftWrite,
    firstSaveExact,
    firstSaveFocus,
    noAutomaticCheckCopy,
    confirmationFocus,
    backFocus,
    completedExact,
    completeFocus,
    envelopesExact,
    requestCount: requests.length,
    successfulWriteCount: fixtureState.projectReviewScheduleWriteCount,
    workspaceWriteDelta: fixtureState.workspaceWriteCount - baselineWrites,
    workspaceMutationAttemptDelta:
      fixtureState.workspaceMutationAttemptCount - baselineAttempts,
    codexMutationDelta: fixtureState.codexRouteRequests.length - baselineCodex,
    verificationMutationDelta:
      fixtureState.verificationRouteRequests.length - baselineVerification,
    controlsComfortable: layout.comfortable,
    noHorizontalOverflow: layout.noHorizontalOverflow,
  };
}

async function auditWorkItemRelationships(
  page,
  planner,
  screenshots,
  viewportId,
  fixtureState,
) {
  const baselineWrites = fixtureState.workspaceWriteCount;
  const baselineAttempts = fixtureState.workspaceMutationAttemptCount;
  const baselineCodex = fixtureState.codexRouteRequests.length;
  const baselineVerification = fixtureState.verificationRouteRequests.length;
  const surface = planner
    .locator('[data-milestone-position="1"]')
    .locator('[data-work-item-relationships="true"]');
  await surface.waitFor({ state: "visible", timeout: 5_000 });
  const initialExact =
    (await surface.getByText("Work links · 1", { exact: true }).count()) ===
      1 &&
    (await surface.locator("ol > li").allTextContents()).some(
      (text) =>
        text.replace(/\s+/gu, " ").trim() ===
        `Depends on ${RELEASE_MILESTONE_TITLE}`,
    );
  const summary = surface.getByText("Work links · 1", { exact: true });
  await summary.focus();
  await page.keyboard.press("Enter");
  const edit = surface.getByRole("button", {
    name: "Edit work links",
    exact: true,
  });
  await edit.waitFor({ state: "visible", timeout: 5_000 });
  await edit.click();
  const add = surface.getByRole("button", {
    name: "Add work link",
    exact: true,
  });
  await add.waitFor({ state: "visible", timeout: 5_000 });
  const initialFocus = await waitForLocatorFocus(page, add);
  const kind = surface.getByRole("combobox", { name: "Link 1", exact: true });
  const target = surface.getByRole("combobox", {
    name: "Target work item",
    exact: true,
  });
  await kind.selectOption("hands_off_to");
  await target.selectOption({
    label: VERIFICATION_MILESTONE_TITLE,
  });
  const responsiveEditor = await surface
    .locator("select")
    .first()
    .evaluate((firstSelect, id) => {
      const row = firstSelect.closest("div");
      const controls = row
        ? Array.from(row.children).map((child) => child.getBoundingClientRect())
        : [];
      if (controls.length !== 3) return false;
      return id === "short-landscape"
        ? controls.every(
            (rect) => Math.abs(rect.bottom - controls[0].bottom) <= 2,
          )
        : id === "portrait"
          ? controls[1].top >= controls[0].bottom - 1
          : true;
    }, viewportId);
  const noDraftWrite =
    fixtureState.workspaceWriteCount === baselineWrites &&
    fixtureState.workItemRelationshipsRequests.length === 0;
  screenshots.set(
    `${viewportId}-plan-work-links-editor`,
    await page.screenshot({ fullPage: false }),
  );
  await surface
    .getByRole("button", { name: "Save work links", exact: true })
    .click();
  await surface
    .getByText("Work links saved.", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  const firstSaveExact =
    JSON.stringify(fixtureState.workItemRelationships()) ===
      JSON.stringify([
        {
          kind: "hands_off_to",
          targetObjectiveId: REVIEW_OBJECTIVE_ID,
          targetWorkItemId: VERIFICATION_MILESTONE_ID,
        },
      ]) &&
    (await surface.locator("ol > li").allInnerTexts()).some(
      (text) =>
        text.replace(/\s+/gu, " ").trim() ===
        `Hands off to ${VERIFICATION_MILESTONE_TITLE}`,
    );
  const firstSaveFocus = await edit.evaluate(
    (element) => document.activeElement === element,
  );

  await edit.click();
  await surface
    .getByRole("button", { name: "Remove work link 1", exact: true })
    .click();
  await surface
    .getByRole("button", { name: "Save work links", exact: true })
    .click();
  const clearGroup = surface.getByRole("group", {
    name: "Confirm clearing work links",
    exact: true,
  });
  await clearGroup.waitFor({ state: "visible", timeout: 5_000 });
  const back = clearGroup.getByRole("button", { name: "Back", exact: true });
  const clearConfirmationFocus = await back.evaluate(
    (element) => document.activeElement === element,
  );
  await back.click();
  await page.waitForFunction(
    (element) => document.activeElement === element,
    await add.elementHandle(),
    { timeout: 5_000 },
  );
  const backFocus = await add.evaluate(
    (element) => document.activeElement === element,
  );
  await surface
    .getByRole("button", { name: "Save work links", exact: true })
    .click();
  await clearGroup.waitFor({ state: "visible", timeout: 5_000 });
  await clearGroup
    .getByRole("button", { name: "Clear work links", exact: true })
    .click();
  await surface
    .getByText("Work links cleared.", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  const cleared = fixtureState.workItemRelationships().length === 0;
  const addLinks = surface.getByRole("button", {
    name: "Add work links",
    exact: true,
  });
  const clearFocus = await waitForLocatorFocus(page, addLinks);

  await addLinks.click();
  await surface
    .getByRole("button", { name: "Add work link", exact: true })
    .click();
  await surface
    .getByRole("button", { name: "Save work links", exact: true })
    .click();
  await surface
    .getByText("Work links saved.", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  const restoredExact =
    JSON.stringify(fixtureState.workItemRelationships()) ===
    JSON.stringify([
      {
        kind: "depends_on",
        targetObjectiveId: REVIEW_OBJECTIVE_ID,
        targetWorkItemId: RELEASE_MILESTONE_ID,
      },
    ]);
  const requests = fixtureState.workItemRelationshipsRequests;
  const envelopesExact =
    requests.length === 3 &&
    requests.every(
      (request) =>
        request.mutation?.type === "workItem.relationships.set" &&
        request.mutation.projectId === PRIMARY_PROJECT_ID &&
        request.mutation.objectiveId === REVIEW_OBJECTIVE_ID &&
        request.mutation.workItemId === REVIEW_WORK_ITEM_ID &&
        request.expectedRevision === request.acceptedRevision &&
        typeof request.mutationId === "string" &&
        request.mutationId.length > 0,
    ) &&
    requests[0].mutation.relationships[0]?.kind === "hands_off_to" &&
    requests[1].mutation.relationships.length === 0 &&
    requests[2].mutation.relationships[0]?.kind === "depends_on";
  const layout = await surface.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const controls = Array.from(element.querySelectorAll("button, select"));
    return {
      contained:
        rect.width <= element.parentElement.getBoundingClientRect().width + 1,
      noHorizontalOverflow: element.scrollWidth <= element.clientWidth + 1,
      comfortable: controls.every((control) => {
        const controlRect = control.getBoundingClientRect();
        return (
          controlRect.height >= 44 &&
          Number.parseFloat(getComputedStyle(control).fontSize) >= 14
        );
      }),
    };
  });
  return {
    initialExact,
    initialFocus,
    noDraftWrite,
    firstSaveExact,
    firstSaveFocus,
    clearConfirmationFocus,
    backFocus,
    cleared,
    clearFocus,
    restoredExact,
    envelopesExact,
    requestCount: requests.length,
    successfulWriteCount: fixtureState.workItemRelationshipsWriteCount,
    workspaceWriteDelta: fixtureState.workspaceWriteCount - baselineWrites,
    workspaceMutationAttemptDelta:
      fixtureState.workspaceMutationAttemptCount - baselineAttempts,
    codexMutationDelta: fixtureState.codexRouteRequests.length - baselineCodex,
    verificationMutationDelta:
      fixtureState.verificationRouteRequests.length - baselineVerification,
    controlsComfortable: layout.comfortable,
    responsiveEditor,
    contained: layout.contained,
    noHorizontalOverflow: layout.noHorizontalOverflow,
  };
}

async function auditPlanReviewAssessment(
  page,
  screenshots,
  viewportId,
  fixtureState,
) {
  const toggle = page.getByRole("button", { name: "Plan", exact: true });
  await toggle.focus();
  await toggle.click();
  const planner = page.locator('[data-work-planner="true"]');
  await planner.waitFor({ state: "visible", timeout: 5_000 });
  const modal =
    (await planner.getAttribute("role")) === "dialog" &&
    (await planner.getAttribute("aria-modal")) === "true";
  const milestoneHeading =
    (await planner.getByText("Milestones", { exact: true }).count()) === 1 &&
    (await planner.getByText("Ordered outcomes", { exact: true }).count()) ===
      1;
  const advisoryCopy =
    (await planner
      .getByText(
        "Order guides what comes next; it does not block other work.",
        { exact: true },
      )
      .count()) === 1;
  const initialMilestones = await inspectMilestoneSequence(planner);
  const initialPersistedWorkspaceOrder = fixtureState.milestoneOrder();
  const initialContainment = await inspectMilestoneContainment(planner);
  const projectContextReview = await auditProjectContextReview(
    page,
    planner,
    screenshots,
    viewportId,
    fixtureState,
  );
  const projectReviewSchedule = await auditProjectReviewSchedule(
    page,
    planner,
    screenshots,
    viewportId,
    fixtureState,
  );
  const decisions = await auditProjectDecisionLog(
    page,
    planner,
    toggle,
    screenshots,
    viewportId,
    fixtureState,
  );
  const definitionOfDone = await auditDefinitionOfDone(
    page,
    planner,
    screenshots,
    viewportId,
    fixtureState,
  );
  const workItemRelationships = await auditWorkItemRelationships(
    page,
    planner,
    screenshots,
    viewportId,
    fixtureState,
  );
  const card = planner.locator(
    '[data-milestone-position="1"] [data-review-assessment="work-item"]',
  );
  await card.waitFor({ state: "visible", timeout: 5_000 });
  const rest = await inspectAssessmentCard(card);
  const recordedLabel = await card.locator("header b").innerText();
  const savedDisclosure = card.getByText("Review saved notes", { exact: true });
  await savedDisclosure.focus();
  const savedDisclosureKeyboardReachable = await savedDisclosure.evaluate(
    (element) => document.activeElement === element,
  );
  const selfCritiqueCount = await card
    .getByText("Agent self-critique: not reported.", { exact: true })
    .count();
  await card.getByRole("button", { name: "Edit notes" }).click();
  const editor = await inspectAssessmentCard(card);
  const textarea = card.getByLabel(/^Your assessment/u);
  await page.waitForFunction(
    () =>
      document.activeElement
        ?.closest("label")
        ?.textContent?.startsWith("Your assessment"),
    undefined,
    { timeout: 5_000 },
  );
  const initialEditorFocus = await textarea.evaluate(
    (element) => document.activeElement === element,
  );
  screenshots.set(
    `${viewportId}-plan-notes-editor`,
    await page.screenshot({ fullPage: false }),
  );
  const focusTrap = await auditFocusTrap(page, planner);
  await page.keyboard.press("Tab");
  const focusWrapped = await planner.evaluate((surface) => {
    const first = Array.from(
      surface.querySelectorAll(
        'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
      ),
    ).find((control) => control.getClientRects().length > 0);
    return document.activeElement === first;
  });
  await card.getByRole("button", { name: "Cancel" }).click();
  await page.waitForFunction(
    () => document.activeElement?.textContent?.trim() === "Edit notes",
    undefined,
    { timeout: 5_000 },
  );
  const cancelFocusRestored = await card
    .getByRole("button", { name: "Edit notes" })
    .evaluate((element) => document.activeElement === element);

  const changeOrder = planner.getByRole("button", {
    name: "Change order",
    exact: true,
  });
  await changeOrder.focus();
  const changeOrderKeyboardReachable = await changeOrder.evaluate(
    (element) => document.activeElement === element,
  );
  await changeOrder.click();
  const done = planner.getByRole("button", { name: "Done", exact: true });
  await done.waitFor({ state: "visible", timeout: 5_000 });
  const orderModeEntered =
    (await done.getAttribute("aria-pressed")) === "true" &&
    (await done.evaluate((element) => document.activeElement === element));
  const orderModeMilestones = await inspectMilestoneSequence(planner);
  const initialBoundaryControls = {
    firstEarlierDisabled: await planner
      .getByRole("button", {
        name: milestoneMoveLabel(1, REVIEW_MILESTONE_TITLE, "earlier"),
        exact: true,
      })
      .isDisabled(),
    firstLaterEnabled: await planner
      .getByRole("button", {
        name: milestoneMoveLabel(1, REVIEW_MILESTONE_TITLE, "later"),
        exact: true,
      })
      .isEnabled(),
    middleEarlierEnabled: await planner
      .getByRole("button", {
        name: milestoneMoveLabel(2, RELEASE_MILESTONE_TITLE, "earlier"),
        exact: true,
      })
      .isEnabled(),
    middleLaterEnabled: await planner
      .getByRole("button", {
        name: milestoneMoveLabel(2, RELEASE_MILESTONE_TITLE, "later"),
        exact: true,
      })
      .isEnabled(),
    lastEarlierEnabled: await planner
      .getByRole("button", {
        name: milestoneMoveLabel(3, VERIFICATION_MILESTONE_TITLE, "earlier"),
        exact: true,
      })
      .isEnabled(),
    lastLaterDisabled: await planner
      .getByRole("button", {
        name: milestoneMoveLabel(3, VERIFICATION_MILESTONE_TITLE, "later"),
        exact: true,
      })
      .isDisabled(),
  };
  const moveThirdEarlier = planner.getByRole("button", {
    name: milestoneMoveLabel(3, VERIFICATION_MILESTONE_TITLE, "earlier"),
    exact: true,
  });
  await moveThirdEarlier.focus();
  const moveControlKeyboardFocus = await moveThirdEarlier.evaluate(
    (element) => document.activeElement === element,
  );
  await page.keyboard.press("Enter");
  const successStatus = `Moved ${VERIFICATION_MILESTONE_TITLE} to milestone 2 of 3.`;
  await planner
    .getByText(successStatus, { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  await page.waitForFunction(
    (label) => document.activeElement?.getAttribute("aria-label") === label,
    milestoneMoveLabel(2, VERIFICATION_MILESTONE_TITLE, "earlier"),
    { timeout: 5_000 },
  );
  const movedControl = planner.getByRole("button", {
    name: milestoneMoveLabel(2, VERIFICATION_MILESTONE_TITLE, "earlier"),
    exact: true,
  });
  const movedControlFocusRestored = await movedControl.evaluate(
    (element) => document.activeElement === element,
  );
  const reorderedMilestones = await inspectMilestoneSequence(planner);
  const reorderedBoundaryControls = {
    firstEarlierDisabled: await planner
      .getByRole("button", {
        name: milestoneMoveLabel(1, REVIEW_MILESTONE_TITLE, "earlier"),
        exact: true,
      })
      .isDisabled(),
    movedEarlierEnabled: await planner
      .getByRole("button", {
        name: milestoneMoveLabel(2, VERIFICATION_MILESTONE_TITLE, "earlier"),
        exact: true,
      })
      .isEnabled(),
    movedLaterEnabled: await planner
      .getByRole("button", {
        name: milestoneMoveLabel(2, VERIFICATION_MILESTONE_TITLE, "later"),
        exact: true,
      })
      .isEnabled(),
    lastEarlierEnabled: await planner
      .getByRole("button", {
        name: milestoneMoveLabel(3, RELEASE_MILESTONE_TITLE, "earlier"),
        exact: true,
      })
      .isEnabled(),
    lastLaterDisabled: await planner
      .getByRole("button", {
        name: milestoneMoveLabel(3, RELEASE_MILESTONE_TITLE, "later"),
        exact: true,
      })
      .isDisabled(),
  };
  const persistedReorderedWorkspaceOrder = fixtureState.milestoneOrder();
  const orderModeContainment = await inspectMilestoneContainment(planner);
  screenshots.set(
    `${viewportId}-plan-milestone-order`,
    await page.screenshot({ fullPage: false }),
  );

  await page.keyboard.press("Escape");
  await changeOrder.waitFor({ state: "visible", timeout: 5_000 });
  await page.waitForFunction(
    () => document.activeElement?.textContent?.trim() === "Change order",
    undefined,
    { timeout: 5_000 },
  );
  const orderModeEscapeFocusRestored = await changeOrder.evaluate(
    (element) => document.activeElement === element,
  );
  const orderModeExited =
    (await planner.locator('[data-milestone-order-mode="true"]').count()) ===
      0 &&
    (await planner.getByText(successStatus, { exact: true }).count()) === 0 &&
    (await planner
      .getByText("The release candidate passes its final quality checks.", {
        exact: true,
      })
      .count()) === 1;

  const addWork = planner.getByRole("button", {
    name: "Add work",
    exact: true,
  });
  await addWork.click();
  const workItemInput = planner.getByLabel("Work item", { exact: true });
  await workItemInput.waitFor({ state: "visible", timeout: 5_000 });
  const appendFormInitialFocus = await workItemInput.evaluate(
    (element) => document.activeElement === element,
  );
  await workItemInput.fill(APPENDED_MILESTONE_TITLE);
  await planner
    .getByLabel("Expected outcome", { exact: true })
    .fill(APPENDED_MILESTONE_OUTCOME);
  await planner.getByRole("button", { name: "Add criterion" }).click();
  await planner
    .getByRole("textbox", { name: "Done criterion 1", exact: true })
    .fill(APPENDED_DEFINITION_OF_DONE[1]);
  await planner.getByRole("button", { name: "Add criterion" }).click();
  await planner
    .getByRole("textbox", { name: "Done criterion 2", exact: true })
    .fill(APPENDED_DEFINITION_OF_DONE[0]);
  await planner
    .getByRole("button", { name: "Move criterion 2 earlier", exact: true })
    .click();
  await planner
    .getByRole("button", { name: "Add work item", exact: true })
    .click();
  const appendSuccessStatus = "Work item added.";
  await planner
    .getByText(appendSuccessStatus, { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  await planner
    .locator('[data-milestone-position="4"]')
    .getByRole("heading", { name: APPENDED_MILESTONE_TITLE, exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  const appendedMilestones = await inspectMilestoneSequence(planner);
  const appendedContainment = await inspectMilestoneContainment(planner);
  const appendedWorkspaceOrder = fixtureState.milestoneOrder();
  const appendedDefinitionVisible =
    JSON.stringify(
      await planner
        .locator('[data-milestone-position="4"] ol > li')
        .allTextContents(),
    ) === JSON.stringify(APPENDED_DEFINITION_OF_DONE);
  const appendFormClosed =
    (await planner.getByLabel("Work item", { exact: true }).count()) === 0;
  await page.waitForFunction(
    () => document.activeElement?.textContent?.trim() === "Add work",
    undefined,
    { timeout: 5_000 },
  );
  const appendFocusRestored = await addWork.evaluate(
    (element) => document.activeElement === element,
  );
  screenshots.set(
    `${viewportId}-plan-milestone-appended`,
    await page.screenshot({ fullPage: false }),
  );

  await page.keyboard.press("Escape");
  await planner.waitFor({ state: "detached", timeout: 5_000 });
  await page.waitForFunction(
    () => document.activeElement?.textContent?.trim() === "Plan",
  );
  const firstCloseFocusRestored = await toggle.evaluate(
    (element) => document.activeElement === element,
  );

  await toggle.click();
  await planner.waitFor({ state: "visible", timeout: 5_000 });
  const reopenedMilestones = await inspectMilestoneSequence(planner);
  const reopenedContainment = await inspectMilestoneContainment(planner);
  const reopenedInNormalMode =
    (await planner.locator('[data-milestone-order-mode="true"]').count()) === 0;
  const reopenedAppendedDefinitionExact =
    JSON.stringify(
      await planner
        .locator('[data-milestone-position="4"] ol > li')
        .allTextContents(),
    ) === JSON.stringify(APPENDED_DEFINITION_OF_DONE);
  const appendDefinitionMutationExact =
    JSON.stringify(
      fixtureState.milestoneAppendRequests.at(-1)?.workItem?.definitionOfDone,
    ) === JSON.stringify(APPENDED_DEFINITION_OF_DONE);
  await page.keyboard.press("Escape");
  await planner.waitFor({ state: "detached", timeout: 5_000 });
  await page.waitForFunction(
    () => document.activeElement?.textContent?.trim() === "Plan",
  );
  return {
    modal,
    projectContextReview,
    projectReviewSchedule,
    decisions,
    definitionOfDone,
    workItemRelationships,
    scopeLabel: rest.scope,
    recordedLabel: recordedLabel.trim(),
    savedDisclosureKeyboardReachable,
    rest,
    editor,
    editorExpanded: editor.height > rest.height,
    initialEditorFocus,
    selfCritiqueCount,
    cancelFocusRestored,
    focusTrap,
    focusWrapped,
    milestones: {
      heading: milestoneHeading,
      advisoryCopy,
      initial: initialMilestones,
      initialPersistedWorkspaceOrder,
      orderModeInitial: orderModeMilestones,
      reordered: reorderedMilestones,
      appended: appendedMilestones,
      reopened: reopenedMilestones,
      initialContainment,
      orderModeContainment,
      appendedContainment,
      reopenedContainment,
      changeOrderKeyboardReachable,
      orderModeEntered,
      moveControlKeyboardFocus,
      movedControlFocusRestored,
      orderModeEscapeFocusRestored,
      orderModeExited,
      reopenedInNormalMode,
      firstCloseFocusRestored,
      appendFormInitialFocus,
      appendFormClosed,
      appendFocusRestored,
      appendedDefinitionVisible,
      reopenedAppendedDefinitionExact,
      appendDefinitionMutationExact,
      initialBoundaryControls,
      reorderedBoundaryControls,
      successStatus,
      appendSuccessStatus,
      persistedReorderedWorkspaceOrder,
      appendedWorkspaceOrder,
      persistedWorkspaceOrder: fixtureState.milestoneOrder(),
      orderWriteCount: fixtureState.milestoneOrderWriteCount,
      orderRequests: fixtureState.milestoneOrderRequests.map((request) => ({
        ...request,
        orderedWorkItemIds: Array.isArray(request.orderedWorkItemIds)
          ? [...request.orderedWorkItemIds]
          : request.orderedWorkItemIds,
      })),
      appendWriteCount: fixtureState.milestoneAppendWriteCount,
      appendRequests: fixtureState.milestoneAppendRequests.map((request) => ({
        ...request,
        workItem:
          request.workItem && typeof request.workItem === "object"
            ? {
                ...Object.fromEntries(
                  Object.entries(request.workItem).filter(
                    ([key]) => key !== "definitionOfDone",
                  ),
                ),
                attempts: Array.isArray(request.workItem.attempts)
                  ? [...request.workItem.attempts]
                  : request.workItem.attempts,
              }
            : request.workItem,
      })),
    },
    focusRestored: await toggle.evaluate(
      (element) => document.activeElement === element,
    ),
  };
}

async function waitForDecisionMutation(page, type, status = 200) {
  return page.waitForResponse(
    (response) =>
      response.status() === status &&
      response.request().method() === "PATCH" &&
      response.request().postDataJSON()?.mutation?.type === type,
    { timeout: 5_000 },
  );
}

async function inspectDecisionCard(card) {
  return card.evaluate((surface) => {
    const bounds = surface.getBoundingClientRect();
    const controls = Array.from(
      surface.querySelectorAll("button, textarea, summary"),
    ).filter((element) => element.getClientRects().length > 0);
    return {
      withinViewport:
        bounds.left >= -1 &&
        bounds.right <= innerWidth + 1 &&
        bounds.top < innerHeight &&
        bounds.bottom > 0,
      noHorizontalOverflow:
        surface.scrollWidth <= surface.clientWidth + 1 &&
        controls.every((control) => {
          const controlBounds = control.getBoundingClientRect();
          return (
            control.scrollWidth <= control.clientWidth + 1 &&
            controlBounds.left >= bounds.left - 1 &&
            controlBounds.right <= bounds.right + 1
          );
        }),
      controlsComfortable: controls
        .filter((control) => control.matches("button, summary"))
        .every((control) => {
          const style = getComputedStyle(control);
          const controlBounds = control.getBoundingClientRect();
          return (
            Number.parseFloat(style.fontSize) >= 14 &&
            controlBounds.height >= 32
          );
        }),
    };
  });
}

async function openDecisionDigestItem(page, action) {
  await openCampus(page);
  const toggle = page.getByRole("button", { name: /^Open digest,/u });
  await toggle.click();
  const dialog = page.getByRole("dialog", { name: "Digest", exact: true });
  await dialog.waitFor({ state: "visible", timeout: 5_000 });
  const item = dialog.getByRole("button").filter({ hasText: action }).first();
  await item.waitFor({ state: "visible", timeout: 5_000 });
  await item.click();
  await dialog.waitFor({ state: "detached", timeout: 5_000 });
}

async function auditDecisionRequests(
  page,
  screenshots,
  viewportId,
  fixtureState,
) {
  const writesBefore = fixtureState.workspaceWriteCount;
  const codexMutationsBefore = fixtureState.codexRouteRequests.filter(
    (request) => request.method !== "GET" && request.method !== "HEAD",
  ).length;
  const planToggle = page.getByRole("button", { name: "Plan", exact: true });
  await planToggle.click();
  let planner = page.locator('[data-work-planner="true"]');
  await planner.waitFor({ state: "visible", timeout: 5_000 });
  let workCard = planner.locator(
    `[data-decision-requests="work-item"][data-decision-request-target*="${REVIEW_WORK_ITEM_ID}"]`,
  );
  await workCard.waitFor({ state: "visible", timeout: 5_000 });
  await workCard.getByRole("button", { name: "Add decision request" }).click();
  const workEditorInitialFocus = await waitForLocatorFocus(
    page,
    workCard.locator("[data-decision-request-editor] textarea"),
  );
  await workCard
    .locator("[data-decision-request-editor] textarea")
    .fill(DECISION_WORK_PROMPT);
  const createWorkResponse = waitForDecisionMutation(
    page,
    "decisionRequest.create",
  );
  await workCard.getByRole("button", { name: "Add request" }).click();
  await createWorkResponse;
  await workCard.getByRole("button", { name: "Edit", exact: true }).click();
  await workCard
    .locator("[data-decision-request-editor] textarea")
    .fill(DECISION_WORK_EDITED_PROMPT);
  const editWorkResponse = waitForDecisionMutation(
    page,
    "decisionRequest.update",
  );
  await workCard.getByRole("button", { name: "Save request" }).click();
  await editWorkResponse;
  await workCard.getByRole("button", { name: "Edit", exact: true }).click();
  const workDraft = workCard.locator("[data-decision-request-editor] textarea");
  await workDraft.fill(DECISION_WORK_DRAFT);
  fixtureState.rejectNextDecisionRequestMutation(
    DECISION_WORK_CONCURRENT_PROMPT,
  );
  const conflictResponse = waitForDecisionMutation(
    page,
    "decisionRequest.update",
    409,
  );
  await workCard.getByRole("button", { name: "Save request" }).click();
  await conflictResponse;
  await workCard
    .getByText("Decision changed elsewhere", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 });
  const staleDraftRetained =
    (await workDraft.inputValue()) === DECISION_WORK_DRAFT &&
    (await workCard.getByRole("button", { name: "Save request" }).isDisabled());
  await workCard.getByRole("button", { name: "Cancel" }).click();
  const workCardLayout = await inspectDecisionCard(workCard);
  if (viewportId === "desktop") {
    await workCard.scrollIntoViewIfNeeded();
    screenshots.set(
      "desktop-plan-decision-request",
      await page.screenshot({ fullPage: false }),
    );
  }
  await planner
    .getByRole("button", { name: "Close project plan", exact: true })
    .click();
  await planner.waitFor({ state: "detached", timeout: 5_000 });

  const latestResultKey = fixtureState.latestReviewResultKey();
  if (!latestResultKey) {
    throw new Error("Decision acceptance could not find the latest result.");
  }
  const attentionToggle = page.locator(
    'button[aria-controls="attention-inbox"]',
  );
  await attentionToggle.click();
  const inbox = page.locator('[data-attention-inbox="true"]');
  await inbox.waitFor({ state: "visible", timeout: 5_000 });
  const laterResultItem = inbox
    .locator('[data-attention-item="ready_for_review"]')
    .filter({ hasText: REVIEW_TASK_TITLE })
    .first();
  await laterResultItem.click();
  const inspector = page.locator('[data-review-act-inspector="true"]');
  await inspector.waitFor({ state: "visible", timeout: 5_000 });
  let resultCard = inspector.locator('[data-decision-requests="result"]');
  await resultCard.waitFor({ state: "visible", timeout: 5_000 });
  await resultCard
    .getByRole("button", { name: "Add decision request" })
    .click();
  const resultEditorInitialFocus = await waitForLocatorFocus(
    page,
    resultCard.locator("[data-decision-request-editor] textarea"),
  );
  await resultCard
    .locator("[data-decision-request-editor] textarea")
    .fill(DECISION_RESULT_PROMPT);
  const createResultResponse = waitForDecisionMutation(
    page,
    "decisionRequest.create",
  );
  await resultCard.getByRole("button", { name: "Add request" }).click();
  await createResultResponse;
  const resultCardLayout = await inspectDecisionCard(resultCard);
  await page.keyboard.press("Escape");
  await inspector.waitFor({ state: "detached", timeout: 5_000 });
  fixtureState.restoreUnreadAttention(latestResultKey.id);
  await page.reload({ waitUntil: "domcontentloaded" });
  await enterTopDownOffice(page);

  await waitForAttentionCount(page, PRIMARY_ATTENTION_COUNT + 2);
  const restoredAttentionToggle = page.locator(
    'button[aria-controls="attention-inbox"]',
  );
  const officeCounts = await readAttentionTrigger(restoredAttentionToggle);
  const drawer = await auditProjectDrawer(page, fixtureState);
  const campus = await openCampus(page);
  const campusRows = await readProjectAttentionRows(campus);
  const digestToggle = page.getByRole("button", { name: /^Open digest,/u });
  const digestCounts = {
    label: await digestToggle.getAttribute("aria-label"),
    count: await digestToggle.getAttribute("data-attention-count"),
    needsReplyCount: await digestToggle.getAttribute("data-needs-reply-count"),
    needsDecisionCount: await digestToggle.getAttribute(
      "data-needs-decision-count",
    ),
    unreadResultCount: await digestToggle.getAttribute(
      "data-unread-result-count",
    ),
  };
  await digestToggle.click();
  const digest = page.getByRole("dialog", { name: "Digest", exact: true });
  await digest.waitFor({ state: "visible", timeout: 5_000 });
  const digestText = (await digest.innerText()).replace(/\s+/gu, " ").trim();
  const digestDecisionLabels = digest.getByText("Decision needed", {
    exact: true,
  });
  const digestDecisionGroupCount = await digestDecisionLabels.evaluateAll(
    (labels) =>
      new Set(
        labels
          .map((label) => label.closest("section"))
          .filter((section) => section !== null),
      ).size,
  );
  const digestDecisionItemCount = await digestDecisionLabels.count();
  await page.keyboard.press("Escape");
  await digest.waitFor({ state: "detached", timeout: 5_000 });
  await enterProjectFromCampus(page, PRIMARY_PROJECT_ID, PRIMARY_TASK_COUNT);

  await restoredAttentionToggle.click();
  await inbox.waitFor({ state: "visible", timeout: 5_000 });
  const decisionItems = inbox.locator(
    '[data-attention-item="decision_needed"]',
  );
  const attentionCopy = (await decisionItems.allInnerTexts()).join(" ");
  const attentionPrivacySafe =
    (await decisionItems.count()) === 2 &&
    attentionCopy.includes("A decision you recorded is still open.") &&
    attentionCopy.includes("Review the work item decision") &&
    attentionCopy.includes("Review the exact result decision") &&
    DECISION_REQUEST_PRIVATE_CANARIES.every(
      (canary) => !attentionCopy.includes(canary),
    );
  const attentionContainment = await inspectAttentionPanelContainment(inbox);
  await page.keyboard.press("Escape");
  await inbox.waitFor({ state: "detached", timeout: 5_000 });

  const workRouteSeen = waitForDecisionMutation(page, "attention.event");
  await openDecisionDigestItem(page, "Review the work item decision");
  await workRouteSeen;
  planner = page.locator('[data-work-planner="true"]');
  await planner.waitFor({ state: "visible", timeout: 5_000 });
  workCard = planner.locator(
    `[data-decision-requests="work-item"][data-decision-request-target*="${REVIEW_WORK_ITEM_ID}"]`,
  );
  const exactWorkItemRoute =
    (await workCard.count()) === 1 &&
    (await workCard.getAttribute("data-decision-request-target"))?.includes(
      REVIEW_WORK_ITEM_ID,
    );
  await workCard.getByRole("button", { name: "Resolve" }).click();
  const resolveWorkResponse = waitForDecisionMutation(
    page,
    "decisionRequest.resolve",
  );
  await workCard.getByRole("button", { name: "Mark resolved" }).click();
  await resolveWorkResponse;
  await workCard.getByText("Resolved history (1)", { exact: true }).click();
  const reopenWorkResponse = waitForDecisionMutation(
    page,
    "decisionRequest.reopen",
  );
  await workCard.getByRole("button", { name: "Reopen" }).click();
  await reopenWorkResponse;
  await workCard.getByRole("button", { name: "Remove" }).click();
  const confirmWorkFocused = await waitForLocatorFocus(
    page,
    workCard.getByRole("button", { name: "Confirm remove" }),
  );
  const removeWorkResponse = waitForDecisionMutation(
    page,
    "decisionRequest.remove",
  );
  await workCard.getByRole("button", { name: "Confirm remove" }).click();
  await removeWorkResponse;
  await planner
    .getByRole("button", { name: "Close project plan", exact: true })
    .click();
  await planner.waitFor({ state: "detached", timeout: 5_000 });

  const resultRouteSeen = waitForDecisionMutation(page, "attention.event");
  const resultAttentionToggle = page.locator(
    'button[aria-controls="attention-inbox"]',
  );
  await resultAttentionToggle.click();
  await inbox.waitFor({ state: "visible", timeout: 5_000 });
  const resultDecisionItem = inbox
    .locator('[data-attention-item="decision_needed"]')
    .filter({ hasText: "Review the exact result decision" });
  await resultDecisionItem.click();
  await resultRouteSeen;
  await inspector.waitFor({ state: "visible", timeout: 5_000 });
  resultCard = inspector.locator('[data-decision-requests="result"]');
  await resultCard.waitFor({ state: "visible", timeout: 5_000 });
  const exactResultRoute =
    (await resultCard.count()) === 1 &&
    (await resultCard.getAttribute("data-decision-request-target"))?.includes(
      latestResultKey.id,
    );
  await resultCard.getByRole("button", { name: "Resolve" }).click();
  await resultCard
    .locator("[data-decision-request-editor] textarea")
    .fill(DECISION_RESULT_RESOLUTION);
  const resolveResultResponse = waitForDecisionMutation(
    page,
    "decisionRequest.resolve",
  );
  await resultCard.getByRole("button", { name: "Mark resolved" }).click();
  await resolveResultResponse;
  await page.keyboard.press("Escape");
  await inspector.waitFor({ state: "detached", timeout: 5_000 });
  await resultAttentionToggle.click();
  await inbox.waitFor({ state: "visible", timeout: 5_000 });
  const resolvedAttentionCopy = await inbox.innerText();
  const resolutionExcludedFromAttention =
    !resolvedAttentionCopy.includes(DECISION_RESULT_PROMPT) &&
    !resolvedAttentionCopy.includes(DECISION_RESULT_RESOLUTION) &&
    (await inbox.locator('[data-attention-item="decision_needed"]').count()) ===
      0;
  const reopenResultRouteSeen = waitForDecisionMutation(
    page,
    "attention.event",
  );
  const reopenResultItem = inbox
    .locator('[data-attention-item="ready_for_review"]')
    .filter({ hasText: REVIEW_TASK_TITLE })
    .first();
  await reopenResultItem.click();
  await reopenResultRouteSeen;
  await inspector.waitFor({ state: "visible", timeout: 5_000 });
  resultCard = inspector.locator('[data-decision-requests="result"]');
  await resultCard.waitFor({ state: "visible", timeout: 5_000 });
  await resultCard.getByText("Resolved history (1)", { exact: true }).click();
  const reopenResultResponse = waitForDecisionMutation(
    page,
    "decisionRequest.reopen",
  );
  await resultCard.getByRole("button", { name: "Reopen" }).click();
  await reopenResultResponse;
  await resultCard.getByRole("button", { name: "Remove" }).click();
  const confirmResultFocused = await waitForLocatorFocus(
    page,
    resultCard.getByRole("button", { name: "Confirm remove" }),
  );
  const removeResultResponse = waitForDecisionMutation(
    page,
    "decisionRequest.remove",
  );
  await resultCard.getByRole("button", { name: "Confirm remove" }).click();
  await removeResultResponse;
  await page.keyboard.press("Escape");
  await inspector.waitFor({ state: "detached", timeout: 5_000 });
  fixtureState.restoreUnreadAttention(latestResultKey.id);
  await page.reload({ waitUntil: "domcontentloaded" });
  await enterTopDownOffice(page);
  await waitForAttentionCount(page, PRIMARY_ATTENTION_COUNT);

  const primaryCountsExact = (evidence) =>
    evidence?.count === String(PRIMARY_ATTENTION_COUNT + 2) &&
    evidence.needsReplyCount === String(PRIMARY_NEEDS_REPLY_COUNT) &&
    evidence.needsDecisionCount === "2" &&
    evidence.unreadResultCount === String(PRIMARY_UNREAD_RESULT_COUNT);
  const countsExact =
    primaryCountsExact(officeCounts) &&
    officeCounts.label ===
      `Attention for Acceptance Office, ${PRIMARY_ATTENTION_COUNT + 2} actions, ${PRIMARY_NEEDS_REPLY_COUNT} reply needed, 2 decisions needed, ${PRIMARY_UNREAD_RESULT_COUNT} unread result` &&
    primaryCountsExact(drawer.projectRows[PRIMARY_PROJECT_ID]) &&
    drawer.projectRows[PRIMARY_PROJECT_ID].ariaLabel?.includes(
      "2 decisions needed",
    ) &&
    primaryCountsExact(campusRows[PRIMARY_PROJECT_ID]) &&
    campusRows[PRIMARY_PROJECT_ID].ariaLabel?.includes("2 decisions needed") &&
    digestCounts.count === String(GLOBAL_ATTENTION_COUNT + 2) &&
    digestCounts.needsReplyCount === String(GLOBAL_NEEDS_REPLY_COUNT) &&
    digestCounts.needsDecisionCount === "2" &&
    digestCounts.unreadResultCount === String(GLOBAL_UNREAD_RESULT_COUNT) &&
    digestCounts.label ===
      `Open digest, ${GLOBAL_ATTENTION_COUNT + 2} actions, ${GLOBAL_NEEDS_REPLY_COUNT} reply needed, 2 decisions needed, ${GLOBAL_UNREAD_RESULT_COUNT} unread results`;

  return {
    schemaVersion12: fixtureState.workspaceSchemaVersion() === 12,
    workEditorInitialFocus,
    resultEditorInitialFocus,
    staleDraftRetained,
    workCardLayout,
    resultCardLayout,
    countsExact,
    digestDecisionGroupCount,
    digestDecisionItemCount,
    digestPrivacySafe: DECISION_REQUEST_PRIVATE_CANARIES.every(
      (canary) => !digestText.includes(canary),
    ),
    attentionPrivacySafe,
    resolutionExcludedFromAttention,
    attentionContainment,
    exactWorkItemRoute,
    exactResultRoute,
    confirmWorkFocused,
    confirmResultFocused,
    remainingRequestCount: fixtureState.decisionRequests().length,
    writeCount: fixtureState.decisionRequestWriteCount,
    conflictCount: fixtureState.decisionRequestConflictCount,
    requestCount: fixtureState.decisionRequestRequests.length,
    requestSequenceExact:
      JSON.stringify(
        fixtureState.decisionRequestRequests.map((request) => request.type),
      ) ===
      JSON.stringify([
        "decisionRequest.create",
        "decisionRequest.update",
        "decisionRequest.update",
        "decisionRequest.create",
        "decisionRequest.resolve",
        "decisionRequest.reopen",
        "decisionRequest.remove",
        "decisionRequest.resolve",
        "decisionRequest.reopen",
        "decisionRequest.remove",
      ]),
    workspaceWriteDelta: fixtureState.workspaceWriteCount - writesBefore,
    codexMutationDelta:
      fixtureState.codexRouteRequests.filter(
        (request) => request.method !== "GET" && request.method !== "HEAD",
      ).length - codexMutationsBefore,
  };
}

async function auditActionableDigest(
  page,
  screenshots,
  viewportId,
  screenshotStage = "",
  expectedTriggerLabel = null,
  fixtureState = null,
) {
  const workspaceWritesBefore = fixtureState?.workspaceWriteCount ?? 0;
  const codexMutationsBefore =
    fixtureState?.codexRouteRequests.filter(
      (request) => request.method !== "GET" && request.method !== "HEAD",
    ).length ?? 0;
  const campus = await openCampus(page);
  if (expectedTriggerLabel) {
    await page
      .getByRole("button", { name: expectedTriggerLabel, exact: true })
      .waitFor({ state: "visible", timeout: 5_000 });
  }
  const projectCards = await readProjectAttentionRows(campus);

  const toggle = page.getByRole("button", { name: /^Open digest,/u });
  await toggle.focus();
  const triggerLabel = await toggle.getAttribute("aria-label");
  const triggerCounts = {
    count: await toggle.getAttribute("data-attention-count"),
    needsReplyCount: await toggle.getAttribute("data-needs-reply-count"),
    needsDecisionCount: await toggle.getAttribute("data-needs-decision-count"),
    unreadResultCount: await toggle.getAttribute("data-unread-result-count"),
    text: (await toggle.innerText()).replace(/\s+/gu, " ").trim(),
  };
  const countContainment = await campus.evaluate((surface) => {
    const controls = Array.from(
      surface.querySelectorAll(
        "button[data-attention-count][data-needs-reply-count][data-needs-decision-count][data-unread-result-count]",
      ),
    );
    return {
      controlCount: controls.length,
      noHorizontalOverflow:
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1 &&
        controls.every((control) => {
          const bounds = control.getBoundingClientRect();
          return (
            control.scrollWidth <= control.clientWidth + 1 &&
            bounds.left >= -1 &&
            bounds.right <= innerWidth + 1
          );
        }),
    };
  });
  await toggle.click();

  const dialog = page.getByRole("dialog", { name: "Digest", exact: true });
  await dialog.waitFor({ state: "visible", timeout: 5_000 });
  await page.waitForFunction(
    () =>
      document.activeElement?.matches("[data-dialog-initial-focus]") === true &&
      document.querySelector(".app-shell")?.inert === true,
    undefined,
    { timeout: 5_000 },
  );
  const summaryParts = (
    await dialog
      .locator('[aria-label="Digest summary"] > span')
      .allTextContents()
  ).map((part) => part.replace(/\s+/gu, " ").trim());
  const projectGroups = await dialog.locator("section").evaluateAll((groups) =>
    groups.map((group) => ({
      heading:
        group.querySelector("h3")?.textContent?.replace(/\s+/gu, " ").trim() ??
        null,
      countSummary:
        group.querySelector("p")?.textContent?.replace(/\s+/gu, " ").trim() ??
        null,
      itemCount: group.querySelectorAll("ul > li > button").length,
    })),
  );
  const initialFocusOnItem = await dialog.evaluate((surface) => {
    const active = document.activeElement;
    return (
      active?.matches("[data-dialog-initial-focus]") === true &&
      active.closest("li") !== null &&
      surface.contains(active)
    );
  });
  const structure = await dialog.evaluate((surface, expectedLongTitle) => {
    const backdrop = document.querySelector("[data-digest-backdrop]");
    const bounds = surface.getBoundingClientRect();
    const summaryCells = Array.from(
      surface.querySelectorAll('[aria-label="Digest summary"] > span'),
    );
    const firstItem = surface.querySelector("section ul > li > button");
    const firstItemBounds = firstItem?.getBoundingClientRect();
    const longTitle = Array.from(surface.querySelectorAll("button b")).find(
      (element) => element.textContent?.trim() === expectedLongTitle,
    );
    const longTitleBounds = longTitle?.getBoundingClientRect();
    const longTitleButtonBounds = longTitle
      ?.closest("button")
      ?.getBoundingClientRect();
    const itemButtons = Array.from(
      surface.querySelectorAll("section ul > li > button"),
    );
    return {
      modal:
        surface.getAttribute("role") === "dialog" &&
        surface.getAttribute("aria-modal") === "true",
      panelPortaledToBody: surface.parentElement === document.body,
      backdropPortaledToBody: backdrop?.parentElement === document.body,
      backdropHiddenAndUntabbable:
        backdrop?.getAttribute("aria-hidden") === "true" &&
        backdrop?.getAttribute("tabindex") === "-1",
      shellInert:
        document.querySelector(".app-shell")?.inert === true &&
        document.querySelector(".app-shell")?.getAttribute("aria-hidden") ===
          "true",
      summaryVisible: summaryCells.every((cell) => {
        const cellBounds = cell.getBoundingClientRect();
        return (
          cellBounds.height >= 24 &&
          cell.scrollHeight <= cell.clientHeight + 1 &&
          cellBounds.top >= bounds.top - 1 &&
          cellBounds.bottom <= bounds.bottom + 1
        );
      }),
      firstItemFullyVisible: Boolean(
        firstItemBounds &&
        firstItemBounds.top >= bounds.top - 1 &&
        firstItemBounds.bottom <= bounds.bottom + 1,
      ),
      panelWithinViewport:
        bounds.left >= -1 &&
        bounds.right <= innerWidth + 1 &&
        bounds.top >= -1 &&
        bounds.bottom <= innerHeight + 1,
      noHorizontalOverflow:
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1 &&
        surface.scrollWidth <= surface.clientWidth + 1 &&
        itemButtons.every(
          (button) => button.scrollWidth <= button.clientWidth + 1,
        ),
      longTitleContained: Boolean(
        longTitle &&
        longTitleBounds &&
        longTitleButtonBounds &&
        longTitle.scrollWidth <= longTitle.clientWidth + 1 &&
        longTitleBounds.left >= longTitleButtonBounds.left - 1 &&
        longTitleBounds.right <= longTitleButtonBounds.right + 1,
      ),
    };
  }, LONG_DIGEST_TASK_TITLE);

  screenshots.set(
    `${viewportId}-digest${screenshotStage ? `-${screenshotStage}` : ""}`,
    await page.screenshot({ fullPage: false }),
  );

  const focusTrap = await auditFocusTrap(page, dialog);
  await page.keyboard.press("Tab");
  const forwardFocusWrapped = await dialog.evaluate((surface) => {
    const first = Array.from(
      surface.querySelectorAll(
        'button:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])',
      ),
    ).find((control) => control.getClientRects().length > 0);
    return document.activeElement === first;
  });
  await page.keyboard.press("Shift+Tab");
  const backwardFocusWrapped = await dialog.evaluate((surface) => {
    const controls = Array.from(
      surface.querySelectorAll(
        'button:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((control) => control.getClientRects().length > 0);
    return document.activeElement === controls.at(-1);
  });

  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached", timeout: 5_000 });
  await page.waitForFunction(() =>
    document.activeElement
      ?.getAttribute("aria-label")
      ?.startsWith("Open digest"),
  );
  const focusRestored = await toggle.evaluate(
    (element) => document.activeElement === element,
  );

  await enterProjectFromCampus(page, PRIMARY_PROJECT_ID, PRIMARY_TASK_COUNT);

  return {
    opened: true,
    closed: (await dialog.count()) === 0,
    triggerLabel,
    triggerCounts,
    countContainment,
    projectCards,
    summaryParts,
    projectGroups,
    initialFocusOnItem,
    focusTrap,
    forwardFocusWrapped,
    backwardFocusWrapped,
    focusRestored,
    noWorkspaceWrites:
      fixtureState === null ||
      fixtureState.workspaceWriteCount === workspaceWritesBefore,
    noCodexMutations:
      fixtureState === null ||
      fixtureState.codexRouteRequests.filter(
        (request) => request.method !== "GET" && request.method !== "HEAD",
      ).length === codexMutationsBefore,
    ...structure,
  };
}

async function desktopAlertHarnessEvidence(page) {
  return page.evaluate(
    () => window.__cofficeDesktopAlertAcceptance?.evidence() ?? null,
  );
}

async function desktopAlertStorageEvidence(page) {
  return page.evaluate(() =>
    Object.fromEntries(
      Object.entries(window.localStorage)
        .filter(
          ([key]) =>
            key.startsWith("coffice:desktop-alert") ||
            key.startsWith("coffice.desktop-alert"),
        )
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function inspectDesktopAlertStorage(entries) {
  const preferenceEntry = Object.entries(entries).find(([key]) =>
    key.includes("preference"),
  );
  const ledgerEntry = Object.entries(entries).find(([key]) =>
    key.includes("ledger"),
  );
  const projectMutesEntry = Object.entries(entries).find(([key]) =>
    key.includes("project-mutes"),
  );
  try {
    const preference = preferenceEntry ? JSON.parse(preferenceEntry[1]) : null;
    const ledger = ledgerEntry ? JSON.parse(ledgerEntry[1]) : null;
    const projectMutes = projectMutesEntry
      ? JSON.parse(projectMutesEntry[1])
      : null;
    const digests = Array.isArray(ledger?.handledEventDigests)
      ? ledger.handledEventDigests
      : [];
    const mutedProjectDigests = Array.isArray(projectMutes?.mutedProjectDigests)
      ? projectMutes.mutedProjectDigests
      : [];
    return {
      separateRecords:
        Boolean(preferenceEntry) &&
        Boolean(ledgerEntry) &&
        preferenceEntry[0] !== ledgerEntry[0],
      threeSeparateRecords:
        Boolean(preferenceEntry) &&
        Boolean(ledgerEntry) &&
        Boolean(projectMutesEntry) &&
        new Set([preferenceEntry[0], ledgerEntry[0], projectMutesEntry[0]])
          .size === 3,
      preferenceEnabled:
        preference?.version === 1 && typeof preference.enabled === "boolean"
          ? preference.enabled
          : null,
      digestCount: digests.length,
      digestsAreSha256:
        digests.length > 0 &&
        digests.every(
          (digest) =>
            typeof digest === "string" && /^[a-f0-9]{64}$/u.test(digest),
        ),
      ledgerVersion: ledger?.version ?? null,
      saturated: ledger?.saturated ?? null,
      projectMutesPresent: Boolean(projectMutesEntry),
      projectMutesVersion: projectMutes?.version ?? null,
      mutedProjectDigestCount: mutedProjectDigests.length,
      mutedProjectDigestsAreSha256:
        mutedProjectDigests.length > 0 &&
        mutedProjectDigests.every(
          (digest) =>
            typeof digest === "string" && /^[a-f0-9]{64}$/u.test(digest),
        ),
      exactProjectMutesShape:
        projectMutes !== null &&
        JSON.stringify(Object.keys(projectMutes).sort()) ===
          JSON.stringify(["mutedProjectDigests", "version"]),
      projectMutesRaw: projectMutesEntry?.[1] ?? null,
    };
  } catch {
    return {
      separateRecords: false,
      threeSeparateRecords: false,
      preferenceEnabled: null,
      digestCount: -1,
      digestsAreSha256: false,
      ledgerVersion: null,
      saturated: null,
      projectMutesPresent: Boolean(projectMutesEntry),
      projectMutesVersion: null,
      mutedProjectDigestCount: -1,
      mutedProjectDigestsAreSha256: false,
      exactProjectMutesShape: false,
      projectMutesRaw: projectMutesEntry?.[1] ?? null,
    };
  }
}

function desktopAlertNotificationEntries(primary, peer, before = null) {
  const primaryStart = before?.primary ?? 0;
  const peerStart = before?.peer ?? 0;
  return [
    ...(primary?.notifications ?? [])
      .slice(primaryStart)
      .map((notification, offset) => ({
        owner: "primary",
        index: primaryStart + offset,
        notification,
      })),
    ...(peer?.notifications ?? [])
      .slice(peerStart)
      .map((notification, offset) => ({
        owner: "peer",
        index: peerStart + offset,
        notification,
      })),
  ];
}

function desktopAlertNotificationCounts(primary, peer) {
  return {
    primary: primary?.notifications.length ?? 0,
    peer: peer?.notifications.length ?? 0,
  };
}

async function waitForDesktopAlertLedgerCount(page, expectedCount) {
  await page.waitForFunction(
    (expected) =>
      JSON.parse(
        localStorage.getItem("coffice:desktop-alert-ledger:v1") ?? "null",
      )?.handledEventDigests?.length >= expected,
    expectedCount,
    { timeout: 12_000 },
  );
}

async function openDesktopAlertSettings(page) {
  await openCampus(page);
  const digestToggle = page.getByRole("button", { name: /^Open digest,/u });
  await digestToggle.click();
  const dialog = page.getByRole("dialog", { name: "Digest", exact: true });
  await dialog.waitFor({ state: "visible", timeout: 5_000 });
  const settings = dialog.locator("[data-desktop-alert-settings]");
  await settings.waitFor({ state: "visible", timeout: 5_000 });
  if (!(await settings.evaluate((element) => element.open))) {
    await settings.locator("summary").click();
  }
  return { dialog, settings };
}

async function dismissAttentionTransitionCue(page) {
  const cue = page.locator('[data-attention-transition-cue="true"]');
  if ((await cue.count()) === 0) return;
  const dismiss = cue.getByRole("button", {
    name: "Hide new Attention cues",
    exact: true,
  });
  if (await dismiss.isVisible()) await dismiss.click();
  await cue.waitFor({ state: "detached", timeout: 5_000 });
}

async function waitForCheckboxState(locator, checked) {
  await locator.waitFor({ state: "visible", timeout: 5_000 });
  const element = await locator.elementHandle();
  if (!element) throw new Error("Expected checkbox is unavailable.");
  try {
    await locator
      .page()
      .waitForFunction(
        ({ checkbox, expected }) =>
          checkbox instanceof HTMLInputElement &&
          checkbox.checked === expected &&
          !checkbox.disabled,
        { checkbox: element, expected: checked },
        { timeout: 5_000 },
      );
  } finally {
    await element.dispose();
  }
}

async function auditDesktopAlerts(
  page,
  screenshots,
  viewportId,
  fixtureState,
  errors,
) {
  const writesBefore = fixtureState.workspaceWriteCount;
  const seenWritesBefore = fixtureState.attentionSeenWriteCount;
  const codexMutationsBefore = fixtureState.codexRouteRequests.filter(
    (request) => request.method !== "GET" && request.method !== "HEAD",
  ).length;

  await enterTopDownOffice(page);
  await waitForAttentionCount(page, PRIMARY_ATTENTION_COUNT);
  await openCampus(page);
  const digestToggle = page.getByRole("button", { name: /^Open digest,/u });
  await digestToggle.click();
  const dialog = page.getByRole("dialog", { name: "Digest", exact: true });
  await dialog.waitFor({ state: "visible", timeout: 5_000 });

  const settings = dialog.locator("[data-desktop-alert-settings]");
  await settings.waitFor({ state: "visible", timeout: 5_000 });
  const summary = settings.locator("summary");
  const initial = await desktopAlertHarnessEvidence(page);
  const disclosureInitiallyClosed = !(await settings.evaluate(
    (element) => element.open,
  ));
  await summary.focus();
  const summaryKeyboardReachable = await summary.evaluate(
    (element) => document.activeElement === element,
  );
  await summary.click();
  const afterDisclosure = await desktopAlertHarnessEvidence(page);
  const disclosure = await settings.evaluate((surface) => {
    const bounds = surface.getBoundingClientRect();
    const summaryElement = surface.querySelector("summary");
    const action = surface.querySelector("button");
    const actionBounds = action?.getBoundingClientRect();
    const text = surface.textContent?.replace(/\s+/gu, " ").trim() ?? "";
    return {
      open: surface.open,
      text,
      status: surface
        .querySelector("[data-desktop-alert-status]")
        ?.getAttribute("data-desktop-alert-status"),
      summaryFontSize: summaryElement
        ? Number.parseFloat(getComputedStyle(summaryElement).fontSize)
        : 0,
      actionFontSize: action
        ? Number.parseFloat(getComputedStyle(action).fontSize)
        : 0,
      actionHeight: actionBounds?.height ?? 0,
      contained:
        bounds.left >= -1 &&
        bounds.right <= innerWidth + 1 &&
        surface.scrollWidth <= surface.clientWidth + 1 &&
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
    };
  });

  const primaryControl = settings.getByRole("checkbox", {
    name: "Desktop alerts for Acceptance Office",
    exact: true,
  });
  const secondaryControl = settings.getByRole("checkbox", {
    name: "Desktop alerts for Secondary Office",
    exact: true,
  });
  const holdingControl = settings.getByRole("checkbox", {
    name: "Desktop alerts for Unassigned sessions",
    exact: true,
  });
  await Promise.all([
    waitForCheckboxState(primaryControl, true),
    waitForCheckboxState(secondaryControl, true),
    waitForCheckboxState(holdingControl, true),
  ]);
  await primaryControl.focus();
  const projectControlKeyboardReachable = await primaryControl.evaluate(
    (element) => document.activeElement === element,
  );
  const exactHoldingLabel =
    (
      await holdingControl
        .locator("xpath=ancestor::label[1]/span")
        .textContent()
    )
      ?.replace(/\s+/gu, " ")
      .trim() === "Unassigned sessions";

  const enable = settings.getByRole("button", {
    name: "Enable desktop alerts",
    exact: true,
  });
  await enable.focus();
  const actionKeyboardReachable = await enable.evaluate(
    (element) => document.activeElement === element,
  );
  await enable.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-desktop-alert-status]")
        ?.getAttribute("data-desktop-alert-status") === "on",
    undefined,
    { timeout: 5_000 },
  );
  await page.waitForTimeout(250);
  const enabled = await desktopAlertHarnessEvidence(page);
  const baselineStorage = await desktopAlertStorageEvidence(page);
  const baselineStorageState = inspectDesktopAlertStorage(baselineStorage);

  const peer = await page.context().newPage();
  attachErrorCapture(peer, errors);
  const peerFixtureState = await installSyntheticFixture(peer, {
    pollIntervalMs: 250,
    observedAt: fixtureState.observedAt,
    desktopAlertHarness: {
      resetStorage: false,
      permission: "granted",
    },
  });
  await enterTopDownOffice(peer);
  await waitForAttentionCount(peer, PRIMARY_ATTENTION_COUNT);
  await peer.waitForTimeout(250);

  const peerSurface = await openDesktopAlertSettings(peer);
  const peerPrimaryControl = peerSurface.settings.getByRole("checkbox", {
    name: "Desktop alerts for Acceptance Office",
    exact: true,
  });
  const peerHoldingControl = peerSurface.settings.getByRole("checkbox", {
    name: "Desktop alerts for Unassigned sessions",
    exact: true,
  });
  await Promise.all([
    waitForCheckboxState(peerPrimaryControl, true),
    waitForCheckboxState(peerHoldingControl, true),
  ]);

  const mutePermissionBefore = {
    primary: (await desktopAlertHarnessEvidence(page))?.permissionRequests,
    peer: (await desktopAlertHarnessEvidence(peer))?.permissionRequests,
  };
  const muteWritesBefore =
    fixtureState.workspaceWriteCount + peerFixtureState.workspaceWriteCount;
  const muteCodexBefore =
    fixtureState.codexRouteRequests.filter(
      (request) => request.method !== "GET" && request.method !== "HEAD",
    ).length +
    peerFixtureState.codexRouteRequests.filter(
      (request) => request.method !== "GET" && request.method !== "HEAD",
    ).length;
  await Promise.all([
    page.evaluate(() => {
      window.__cofficeDesktopAlertAcceptance?.setForeground(false);
    }),
    peer.evaluate(() => {
      window.__cofficeDesktopAlertAcceptance?.setForeground(false);
    }),
  ]);
  const notificationsBeforeMuteRace = desktopAlertNotificationCounts(
    await desktopAlertHarnessEvidence(page),
    await desktopAlertHarnessEvidence(peer),
  );
  await page.evaluate(async (lockName) => {
    let release = () => undefined;
    let markAcquired = () => undefined;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const acquired = new Promise((resolve) => {
      markAcquired = resolve;
    });
    window.__cofficeProjectMuteLockGate = { release };
    void navigator.locks.request(lockName, { mode: "exclusive" }, async () => {
      markAcquired();
      await held;
    });
    await acquired;
  }, "coffice:desktop-alert-project-mutes:v1");
  await primaryControl.click();
  await page.waitForFunction(
    async (lockName) =>
      (await navigator.locks.query()).pending.some(
        (lock) => lock.name === lockName && lock.mode === "exclusive",
      ),
    "coffice:desktop-alert-project-mutes:v1",
    { timeout: 5_000 },
  );
  const [muteRaceEvent] = fixtureState.publishTaskTransitions([
    {
      taskId: "10000000-0000-4000-8000-000000000003",
      value: "waiting_for_user",
    },
  ]);
  const [peerMuteRaceEvent] = peerFixtureState.publishTaskTransitions([
    {
      taskId: "10000000-0000-4000-8000-000000000003",
      value: "waiting_for_user",
    },
  ]);
  await Promise.all([
    waitForSnapshotRefresh(page),
    waitForSnapshotRefresh(peer),
  ]);
  await page.waitForFunction(
    async (lockName) =>
      (await navigator.locks.query()).pending
        .filter((lock) => lock.name === lockName)
        .some((lock) => lock.mode === "shared"),
    "coffice:desktop-alert-project-mutes:v1",
    { timeout: 5_000 },
  );
  const muteRacePendingOrder = await page.evaluate(
    async (lockName) =>
      (await navigator.locks.query()).pending
        .filter((lock) => lock.name === lockName)
        .map((lock) => lock.mode),
    "coffice:desktop-alert-project-mutes:v1",
  );
  const muteRaceWriterIndex = muteRacePendingOrder.indexOf("exclusive");
  const muteRaceReaderIndex = muteRacePendingOrder.indexOf("shared");
  const muteRaceWriterQueuedBeforeReader =
    muteRaceWriterIndex >= 0 &&
    muteRaceReaderIndex >= 0 &&
    muteRaceWriterIndex < muteRaceReaderIndex;
  await page.evaluate(() => {
    window.__cofficeProjectMuteLockGate?.release();
    delete window.__cofficeProjectMuteLockGate;
  });
  await Promise.all([
    waitForCheckboxState(primaryControl, false),
    waitForCheckboxState(peerPrimaryControl, false),
  ]);
  await waitForDesktopAlertLedgerCount(
    page,
    baselineStorageState.digestCount + 1,
  );
  await page.waitForTimeout(250);
  const muteRacePrimary = await desktopAlertHarnessEvidence(page);
  const muteRacePeer = await desktopAlertHarnessEvidence(peer);
  const muteRaceStorage = await desktopAlertStorageEvidence(page);
  const muteRaceStorageState = inspectDesktopAlertStorage(muteRaceStorage);
  const muteRaceExactProjectControlTransition =
    !(await primaryControl.isChecked()) &&
    !(await peerPrimaryControl.isChecked()) &&
    muteRaceStorageState.mutedProjectDigestCount === 1;
  const muteRaceNotifications = desktopAlertNotificationEntries(
    muteRacePrimary,
    muteRacePeer,
    notificationsBeforeMuteRace,
  );
  await Promise.all([
    dismissAttentionTransitionCue(page),
    dismissAttentionTransitionCue(peer),
  ]);
  await holdingControl.click();
  await Promise.all([
    waitForCheckboxState(holdingControl, false),
    waitForCheckboxState(peerHoldingControl, false),
  ]);
  const afterMuteHarness = await desktopAlertHarnessEvidence(page);
  const peerAfterMuteHarness = await desktopAlertHarnessEvidence(peer);
  const crossTabMuteReflected =
    !(await primaryControl.isChecked()) &&
    !(await peerPrimaryControl.isChecked()) &&
    !(await holdingControl.isChecked()) &&
    !(await peerHoldingControl.isChecked());
  const afterMuteStorage = await desktopAlertStorageEvidence(page);
  const afterMuteStorageState = inspectDesktopAlertStorage(afterMuteStorage);
  const muteRecordForbidden = [
    PRIMARY_PROJECT_ID,
    SECONDARY_PROJECT_ID,
    HOLDING_PROJECT_ID,
    "Acceptance Office",
    "Secondary Office",
    "Unassigned sessions",
  ];
  const muteRecordIsContentFree = muteRecordForbidden.every(
    (fragment) =>
      !(afterMuteStorageState.projectMutesRaw ?? "").includes(fragment),
  );
  const muteMutationIsLocalOnly =
    afterMuteHarness?.permissionRequests === mutePermissionBefore.primary &&
    peerAfterMuteHarness?.permissionRequests === mutePermissionBefore.peer &&
    fixtureState.workspaceWriteCount + peerFixtureState.workspaceWriteCount ===
      muteWritesBefore &&
    fixtureState.codexRouteRequests.filter(
      (request) => request.method !== "GET" && request.method !== "HEAD",
    ).length +
      peerFixtureState.codexRouteRequests.filter(
        (request) => request.method !== "GET" && request.method !== "HEAD",
      ).length ===
      muteCodexBefore;

  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached", timeout: 5_000 });
  await peer.keyboard.press("Escape");
  await peerSurface.dialog.waitFor({ state: "detached", timeout: 5_000 });
  await page.waitForTimeout(80);
  await Promise.all([
    dismissAttentionTransitionCue(page),
    dismissAttentionTransitionCue(peer),
  ]);

  await peer.evaluate(() => {
    window.__cofficeDesktopAlertAcceptance?.setForeground(false);
  });
  await page.evaluate(() => {
    window.__cofficeDesktopAlertAcceptance?.setForeground(true);
  });
  await page.waitForTimeout(100);

  const [foregroundEvent] = fixtureState.publishTaskTransitions([
    {
      taskId: "20000000-0000-4000-8000-000000000001",
      value: "blocked",
    },
  ]);
  const [peerForegroundEvent] = peerFixtureState.publishTaskTransitions([
    {
      taskId: "20000000-0000-4000-8000-000000000001",
      value: "blocked",
    },
  ]);
  await Promise.all([
    waitForSnapshotRefresh(page),
    waitForSnapshotRefresh(peer),
  ]);
  await waitForDesktopAlertLedgerCount(
    page,
    afterMuteStorageState.digestCount + 1,
  );
  const cue = page.locator('[data-attention-transition-cue="true"]');
  const peerCue = peer.locator('[data-attention-transition-cue="true"]');
  await Promise.all([
    cue.waitFor({ state: "visible", timeout: 5_000 }),
    peerCue.waitFor({ state: "visible", timeout: 5_000 }),
  ]);
  await page.waitForTimeout(250);
  const foreground = await desktopAlertHarnessEvidence(page);
  const peerForeground = await desktopAlertHarnessEvidence(peer);
  const foregroundStorage = await desktopAlertStorageEvidence(page);
  const foregroundStorageState = inspectDesktopAlertStorage(foregroundStorage);
  await Promise.all([
    dismissAttentionTransitionCue(page),
    dismissAttentionTransitionCue(peer),
  ]);

  await page.evaluate(() => {
    window.__cofficeDesktopAlertAcceptance?.setForeground(false);
  });
  await peer.evaluate(() => {
    window.__cofficeDesktopAlertAcceptance?.setForeground(false);
  });
  await page.waitForTimeout(100);
  const notificationsBeforeAllMuted = desktopAlertNotificationCounts(
    foreground,
    peerForeground,
  );
  const [allMutedEvent] = fixtureState.publishTaskTransitions([
    {
      taskId: HOLDING_TASK_ID,
      value: "waiting_for_user",
    },
  ]);
  const [peerAllMutedEvent] = peerFixtureState.publishTaskTransitions([
    {
      taskId: HOLDING_TASK_ID,
      value: "waiting_for_user",
    },
  ]);
  await Promise.all([
    waitForSnapshotRefresh(page),
    waitForSnapshotRefresh(peer),
  ]);
  await waitForDesktopAlertLedgerCount(
    page,
    foregroundStorageState.digestCount + 1,
  );
  await page.waitForTimeout(250);
  const allMutedPrimary = await desktopAlertHarnessEvidence(page);
  const allMutedPeer = await desktopAlertHarnessEvidence(peer);
  const allMutedStorage = await desktopAlertStorageEvidence(page);
  const allMutedStorageState = inspectDesktopAlertStorage(allMutedStorage);
  const allMutedNotifications = desktopAlertNotificationEntries(
    allMutedPrimary,
    allMutedPeer,
    notificationsBeforeAllMuted,
  );
  await Promise.all([
    dismissAttentionTransitionCue(page),
    dismissAttentionTransitionCue(peer),
  ]);

  const notificationsBeforeMixed = desktopAlertNotificationCounts(
    allMutedPrimary,
    allMutedPeer,
  );
  const mixedEvents = fixtureState.publishTaskTransitions([
    {
      taskId: "10000000-0000-4000-8000-000000000007",
      value: "waiting_for_user",
    },
    {
      taskId: "20000000-0000-4000-8000-000000000001",
      value: "waiting_for_user",
    },
    {
      taskId: "20000000-0000-4000-8000-000000000002",
      value: "failed",
    },
  ]);
  const peerMixedEvents = peerFixtureState.publishTaskTransitions([
    {
      taskId: "10000000-0000-4000-8000-000000000007",
      value: "waiting_for_user",
    },
    {
      taskId: "20000000-0000-4000-8000-000000000001",
      value: "waiting_for_user",
    },
    {
      taskId: "20000000-0000-4000-8000-000000000002",
      value: "failed",
    },
  ]);
  await Promise.all([
    waitForSnapshotRefresh(page),
    waitForSnapshotRefresh(peer),
  ]);
  await waitForDesktopAlertLedgerCount(
    page,
    allMutedStorageState.digestCount + mixedEvents.length,
  );
  await page.waitForTimeout(250);
  const mixedPrimary = await desktopAlertHarnessEvidence(page);
  const mixedPeer = await desktopAlertHarnessEvidence(peer);
  const mixedStorage = await desktopAlertStorageEvidence(page);
  const mixedStorageState = inspectDesktopAlertStorage(mixedStorage);
  const mixedNotifications = desktopAlertNotificationEntries(
    mixedPrimary,
    mixedPeer,
    notificationsBeforeMixed,
  );
  const mixedWinner = mixedNotifications[0] ?? null;
  const mixedNotification = mixedWinner?.notification ?? null;
  const mixedPayloadText = JSON.stringify(mixedNotification ?? {});
  const publishedBeforeRename = [
    foregroundEvent,
    peerForegroundEvent,
    muteRaceEvent,
    peerMuteRaceEvent,
    allMutedEvent,
    peerAllMutedEvent,
    ...mixedEvents,
    ...peerMixedEvents,
  ];
  const forbiddenPayloadFragments = [
    PRIMARY_PROJECT_ID,
    SECONDARY_PROJECT_ID,
    HOLDING_PROJECT_ID,
    "Acceptance Office",
    "Secondary Office",
    RENAMED_PRIMARY_PROJECT_NAME,
    "Holding Agent 01",
    ...publishedBeforeRename.flatMap((event) => [
      event.eventKey,
      event.taskId,
      event.taskTitle,
      event.projectId,
      event.value,
      event.observedAt,
    ]),
    "waiting_for_user",
    "blocked",
  ];

  const mixedWinnerPage = mixedWinner?.owner === "peer" ? peer : page;
  const mixedWinnerFixture =
    mixedWinner?.owner === "peer" ? peerFixtureState : fixtureState;
  const expectedMixedTarget = mixedEvents[1];
  const routeReceipt = mixedWinnerPage.waitForResponse(
    (response) => {
      if (
        response.status() !== 200 ||
        response.request().method() !== "PATCH"
      ) {
        return false;
      }
      const mutation = response.request().postDataJSON()?.mutation;
      return (
        mutation?.type === "attention.event" &&
        mutation.eventKey === expectedMixedTarget.eventKey &&
        mutation.disposition?.kind === "needs_review"
      );
    },
    { timeout: 5_000 },
  );
  const clicked = await mixedWinnerPage.evaluate(
    (index) => window.__cofficeDesktopAlertAcceptance?.clickNotification(index),
    mixedWinner?.index ?? -1,
  );
  await routeReceipt;
  const mixedInspector = mixedWinnerPage.locator(
    '[data-review-act-inspector="true"]',
  );
  await mixedInspector.waitFor({ state: "visible", timeout: 5_000 });
  const exactMixedRoute =
    (await mixedInspector.getByRole("heading", { level: 2 }).textContent())
      ?.replace(/\s+/gu, " ")
      .trim() === "Secondary Agent 01";
  const afterClick = await desktopAlertHarnessEvidence(mixedWinnerPage);
  await mixedInspector
    .getByRole("button", { name: "Close review inspector", exact: true })
    .click();
  await mixedInspector.waitFor({ state: "detached", timeout: 5_000 });
  await Promise.all([
    dismissAttentionTransitionCue(page),
    dismissAttentionTransitionCue(peer),
  ]);

  fixtureState.renameProject(PRIMARY_PROJECT_ID, RENAMED_PRIMARY_PROJECT_NAME);
  peerFixtureState.renameProject(
    PRIMARY_PROJECT_ID,
    RENAMED_PRIMARY_PROJECT_NAME,
  );
  await Promise.all([
    waitForSnapshotRefresh(page),
    waitForSnapshotRefresh(peer),
  ]);
  const renamedSurface = await openDesktopAlertSettings(page);
  const peerRenamedSurface = await openDesktopAlertSettings(peer);
  const renamedControl = renamedSurface.settings.getByRole("checkbox", {
    name: `Desktop alerts for ${RENAMED_PRIMARY_PROJECT_NAME}`,
    exact: true,
  });
  const peerRenamedControl = peerRenamedSurface.settings.getByRole("checkbox", {
    name: `Desktop alerts for ${RENAMED_PRIMARY_PROJECT_NAME}`,
    exact: true,
  });
  await Promise.all([
    waitForCheckboxState(renamedControl, false),
    waitForCheckboxState(peerRenamedControl, false),
  ]);
  const renameRetainedMute = true;
  await page.keyboard.press("Escape");
  await renamedSurface.dialog.waitFor({ state: "detached", timeout: 5_000 });
  await peer.keyboard.press("Escape");
  await peerRenamedSurface.dialog.waitFor({
    state: "detached",
    timeout: 5_000,
  });

  const notificationsBeforeRenamedMuted = desktopAlertNotificationCounts(
    mixedPrimary,
    mixedPeer,
  );
  const [renamedMutedEvent] = fixtureState.publishTaskTransitions([
    {
      taskId: "10000000-0000-4000-8000-000000000004",
      value: "failed",
    },
  ]);
  const [peerRenamedMutedEvent] = peerFixtureState.publishTaskTransitions([
    {
      taskId: "10000000-0000-4000-8000-000000000004",
      value: "failed",
    },
  ]);
  await Promise.all([
    waitForSnapshotRefresh(page),
    waitForSnapshotRefresh(peer),
  ]);
  await waitForDesktopAlertLedgerCount(page, mixedStorageState.digestCount + 1);
  await page.waitForTimeout(250);
  const renamedMutedPrimary = await desktopAlertHarnessEvidence(page);
  const renamedMutedPeer = await desktopAlertHarnessEvidence(peer);
  const renamedMutedStorage = await desktopAlertStorageEvidence(page);
  const renamedMutedStorageState =
    inspectDesktopAlertStorage(renamedMutedStorage);
  const renamedMutedNotifications = desktopAlertNotificationEntries(
    renamedMutedPrimary,
    renamedMutedPeer,
    notificationsBeforeRenamedMuted,
  );
  await Promise.all([
    dismissAttentionTransitionCue(page),
    dismissAttentionTransitionCue(peer),
  ]);

  const notificationsBeforeRemoveReadd = desktopAlertNotificationCounts(
    renamedMutedPrimary,
    renamedMutedPeer,
  );
  const muteRecordBeforeRemove =
    renamedMutedStorageState.projectMutesRaw ?? null;
  fixtureState.removeProject(PRIMARY_PROJECT_ID);
  peerFixtureState.removeProject(PRIMARY_PROJECT_ID);
  await Promise.all([
    waitForSnapshotRefresh(page),
    waitForSnapshotRefresh(peer),
  ]);
  const removedSurface = await openDesktopAlertSettings(page);
  const peerRemovedSurface = await openDesktopAlertSettings(peer);
  const removedPrimaryControl = removedSurface.settings.getByRole("checkbox", {
    name: `Desktop alerts for ${RENAMED_PRIMARY_PROJECT_NAME}`,
    exact: true,
  });
  const peerRemovedPrimaryControl = peerRemovedSurface.settings.getByRole(
    "checkbox",
    {
      name: `Desktop alerts for ${RENAMED_PRIMARY_PROJECT_NAME}`,
      exact: true,
    },
  );
  await Promise.all([
    removedPrimaryControl.waitFor({ state: "detached", timeout: 5_000 }),
    peerRemovedPrimaryControl.waitFor({ state: "detached", timeout: 5_000 }),
  ]);
  const removedRowHidden =
    (await removedPrimaryControl.count()) === 0 &&
    (await peerRemovedPrimaryControl.count()) === 0;
  const muteRecordWhileRemoved = inspectDesktopAlertStorage(
    await desktopAlertStorageEvidence(page),
  ).projectMutesRaw;
  await page.keyboard.press("Escape");
  await removedSurface.dialog.waitFor({ state: "detached", timeout: 5_000 });
  await peer.keyboard.press("Escape");
  await peerRemovedSurface.dialog.waitFor({
    state: "detached",
    timeout: 5_000,
  });
  fixtureState.readdProject(PRIMARY_PROJECT_ID);
  peerFixtureState.readdProject(PRIMARY_PROJECT_ID);
  await Promise.all([
    waitForSnapshotRefresh(page),
    waitForSnapshotRefresh(peer),
  ]);

  const unmuteSurface = await openDesktopAlertSettings(page);
  const peerUnmuteSurface = await openDesktopAlertSettings(peer);
  const unmuteControl = unmuteSurface.settings.getByRole("checkbox", {
    name: `Desktop alerts for ${RENAMED_PRIMARY_PROJECT_NAME}`,
    exact: true,
  });
  const peerUnmuteControl = peerUnmuteSurface.settings.getByRole("checkbox", {
    name: `Desktop alerts for ${RENAMED_PRIMARY_PROJECT_NAME}`,
    exact: true,
  });
  await Promise.all([
    waitForCheckboxState(unmuteControl, false),
    waitForCheckboxState(peerUnmuteControl, false),
  ]);
  await page.waitForTimeout(250);
  const removeReaddStorageState = inspectDesktopAlertStorage(
    await desktopAlertStorageEvidence(page),
  );
  const removeReaddRetainedMute =
    removedRowHidden &&
    muteRecordBeforeRemove !== null &&
    muteRecordWhileRemoved === muteRecordBeforeRemove &&
    removeReaddStorageState.projectMutesRaw === muteRecordBeforeRemove &&
    desktopAlertNotificationEntries(
      await desktopAlertHarnessEvidence(page),
      await desktopAlertHarnessEvidence(peer),
      notificationsBeforeRemoveReadd,
    ).length === 0 &&
    removeReaddStorageState.digestCount ===
      renamedMutedStorageState.digestCount;
  const beforeUnmuteHarness = await desktopAlertHarnessEvidence(page);
  const beforePeerUnmuteHarness = await desktopAlertHarnessEvidence(peer);
  const beforeUnmuteCounts = desktopAlertNotificationCounts(
    beforeUnmuteHarness,
    beforePeerUnmuteHarness,
  );
  await unmuteControl.click();
  await Promise.all([
    waitForCheckboxState(unmuteControl, true),
    waitForCheckboxState(peerUnmuteControl, true),
  ]);
  await page.waitForTimeout(350);
  const afterUnmuteHarness = await desktopAlertHarnessEvidence(page);
  const afterPeerUnmuteHarness = await desktopAlertHarnessEvidence(peer);
  const unmuteDidNotReplay =
    desktopAlertNotificationEntries(
      afterUnmuteHarness,
      afterPeerUnmuteHarness,
      beforeUnmuteCounts,
    ).length === 0 &&
    inspectDesktopAlertStorage(await desktopAlertStorageEvidence(page))
      .digestCount === renamedMutedStorageState.digestCount;
  await page.keyboard.press("Escape");
  await unmuteSurface.dialog.waitFor({ state: "detached", timeout: 5_000 });
  await peer.keyboard.press("Escape");
  await peerUnmuteSurface.dialog.waitFor({
    state: "detached",
    timeout: 5_000,
  });

  const notificationsBeforeLater = desktopAlertNotificationCounts(
    afterUnmuteHarness,
    afterPeerUnmuteHarness,
  );
  const [laterEvent] = fixtureState.publishTaskTransitions([
    {
      taskId: "10000000-0000-4000-8000-000000000008",
      value: "waiting_for_user",
    },
  ]);
  const [peerLaterEvent] = peerFixtureState.publishTaskTransitions([
    {
      taskId: "10000000-0000-4000-8000-000000000008",
      value: "waiting_for_user",
    },
  ]);
  await Promise.all([
    waitForSnapshotRefresh(page),
    waitForSnapshotRefresh(peer),
  ]);
  await waitForDesktopAlertLedgerCount(
    page,
    renamedMutedStorageState.digestCount + 1,
  );
  await page.waitForTimeout(250);
  const laterPrimary = await desktopAlertHarnessEvidence(page);
  const laterPeer = await desktopAlertHarnessEvidence(peer);
  const laterNotifications = desktopAlertNotificationEntries(
    laterPrimary,
    laterPeer,
    notificationsBeforeLater,
  );
  const laterNotification = laterNotifications[0]?.notification ?? null;
  const laterPayloadText = JSON.stringify(laterNotification ?? {});
  const storageAfterDelivery = await desktopAlertStorageEvidence(page);
  const deliveredStorageState =
    inspectDesktopAlertStorage(storageAfterDelivery);
  forbiddenPayloadFragments.push(
    ...[
      renamedMutedEvent,
      peerRenamedMutedEvent,
      laterEvent,
      peerLaterEvent,
    ].flatMap((event) => [
      event.eventKey,
      event.taskId,
      event.taskTitle,
      event.projectId,
      event.value,
      event.observedAt,
    ]),
  );
  await Promise.all([
    dismissAttentionTransitionCue(page),
    dismissAttentionTransitionCue(peer),
  ]);

  await page.evaluate(() => {
    window.__cofficeDesktopAlertAcceptance?.setForeground(true);
  });
  const finalSurface = await openDesktopAlertSettings(page);
  const peerFinalSurface = await openDesktopAlertSettings(peer);
  const finalSettings = finalSurface.settings;
  const finalHoldingControl = finalSettings.getByRole("checkbox", {
    name: "Desktop alerts for Unassigned sessions",
    exact: true,
  });
  const peerFinalHoldingControl = peerFinalSurface.settings.getByRole(
    "checkbox",
    {
      name: "Desktop alerts for Unassigned sessions",
      exact: true,
    },
  );
  await Promise.all([
    waitForCheckboxState(finalHoldingControl, false),
    waitForCheckboxState(peerFinalHoldingControl, false),
  ]);
  const reset = finalSettings.getByRole("button", {
    name: "Reset all muted delivery scopes",
    exact: true,
  });
  const resetControlComfortable = await reset.evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    return (
      bounds.height >= 44 &&
      Number.parseFloat(getComputedStyle(button).fontSize) >= 14
    );
  });
  await reset.focus();
  const resetKeyboardReachable = await reset.evaluate(
    (element) => document.activeElement === element,
  );
  await reset.click();
  const resetCancel = finalSettings.getByRole("button", {
    name: "Keep current mutes",
    exact: true,
  });
  await resetCancel.waitFor({ state: "visible", timeout: 5_000 });
  const resetConfirmationComfortable = await finalSettings
    .locator(
      '[role="group"][aria-label="Confirm reset of muted delivery scopes"]',
    )
    .evaluate((group) => {
      const bounds = group.getBoundingClientRect();
      const body = group.closest('[role="dialog"]');
      const bodyBounds = body?.getBoundingClientRect();
      const buttons = Array.from(group.querySelectorAll("button"));
      return (
        Boolean(bodyBounds) &&
        bounds.left >= bodyBounds.left - 1 &&
        bounds.right <= bodyBounds.right + 1 &&
        buttons.length === 2 &&
        buttons.every((button) => {
          const buttonBounds = button.getBoundingClientRect();
          return (
            buttonBounds.height >= 44 &&
            Number.parseFloat(getComputedStyle(button).fontSize) >= 14
          );
        })
      );
    });
  const resetInitialFocus = await waitForLocatorFocus(page, resetCancel);
  screenshots.set(
    `${viewportId}-desktop-alert-reset-confirmation`,
    await page.screenshot({ fullPage: false }),
  );
  await page.keyboard.press("Escape");
  await resetCancel.waitFor({ state: "detached", timeout: 5_000 });
  const resetEscapeKeptDigest = await finalSurface.dialog.isVisible();
  const resetEscapeRestoredFocus = await waitForLocatorFocus(page, reset);
  await reset.click();
  const resetConfirm = finalSettings.getByRole("button", {
    name: "Resume all future alerts",
    exact: true,
  });
  await resetConfirm.waitFor({ state: "visible", timeout: 5_000 });
  const countsBeforeReset = desktopAlertNotificationCounts(
    await desktopAlertHarnessEvidence(page),
    await desktopAlertHarnessEvidence(peer),
  );
  const ledgerCountBeforeReset = deliveredStorageState.digestCount;
  await resetConfirm.click();
  await reset.waitFor({ state: "detached", timeout: 5_000 });
  await Promise.all([
    waitForCheckboxState(finalHoldingControl, true),
    waitForCheckboxState(peerFinalHoldingControl, true),
  ]);
  await page.waitForTimeout(80);
  const resetSuccessFocusInDialog = await finalSurface.dialog.evaluate(
    (surface) => {
      const active = document.activeElement;
      return Boolean(
        active &&
        surface.contains(active) &&
        active.matches("summary, button, input") &&
        !active.matches(":disabled"),
      );
    },
  );
  const afterResetHarness = await desktopAlertHarnessEvidence(page);
  const peerAfterResetHarness = await desktopAlertHarnessEvidence(peer);
  const afterResetStorage = await desktopAlertStorageEvidence(page);
  const afterResetStorageState = inspectDesktopAlertStorage(afterResetStorage);
  const resetReflectedAcrossTabs =
    (await finalHoldingControl.isChecked()) &&
    (await peerFinalHoldingControl.isChecked());
  const resetWasDeliveryQuiet =
    desktopAlertNotificationEntries(
      afterResetHarness,
      peerAfterResetHarness,
      countsBeforeReset,
    ).length === 0 &&
    afterResetStorageState.digestCount === ledgerCountBeforeReset;
  const onBeforeDisable =
    (await finalSettings
      .locator("[data-desktop-alert-status]")
      .getAttribute("data-desktop-alert-status")) === "on";
  await finalSettings
    .getByRole("button", { name: "Turn off desktop alerts", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-desktop-alert-status]")
        ?.getAttribute("data-desktop-alert-status") === "off",
    undefined,
    { timeout: 5_000 },
  );
  const disabled = await desktopAlertHarnessEvidence(page);
  const offProjectControlsAvailable =
    (await finalHoldingControl.isVisible()) &&
    (await finalHoldingControl.isEnabled()) &&
    (await finalHoldingControl.isChecked());
  const finalStorage = await desktopAlertStorageEvidence(page);
  const finalStorageState = inspectDesktopAlertStorage(finalStorage);
  const finalContainment = await finalSettings.evaluate((surface) => {
    const panel = surface.closest('[role="dialog"]');
    const scrollBody = surface.parentElement;
    const bounds = surface.getBoundingClientRect();
    const panelBounds = panel?.getBoundingClientRect();
    const bodyBounds = scrollBody?.getBoundingClientRect();
    const buttons = Array.from(surface.querySelectorAll("button"));
    const projectLabels = Array.from(
      surface.querySelectorAll('fieldset label:has(input[type="checkbox"])'),
    );
    return {
      withinViewport:
        Boolean(panelBounds) &&
        panelBounds.left >= -1 &&
        panelBounds.right <= innerWidth + 1 &&
        panelBounds.top >= -1 &&
        panelBounds.bottom <= innerHeight + 1,
      noHorizontalOverflow:
        Boolean(bodyBounds) &&
        bounds.left >= bodyBounds.left - 1 &&
        bounds.right <= bodyBounds.right + 1 &&
        surface.scrollWidth <= surface.clientWidth + 1 &&
        scrollBody.scrollWidth <= scrollBody.clientWidth + 1 &&
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      controlsComfortable:
        projectLabels.length >= 3 &&
        buttons.every((button) => {
          const controlBounds = button.getBoundingClientRect();
          return (
            controlBounds.height >= 44 &&
            Number.parseFloat(getComputedStyle(button).fontSize) >= 14
          );
        }) &&
        projectLabels.every((label) => {
          const labelBounds = label.getBoundingClientRect();
          const text = label.querySelector("span") ?? label;
          return (
            labelBounds.height >= 44 &&
            Number.parseFloat(getComputedStyle(text).fontSize) >= 14
          );
        }),
    };
  });
  screenshots.set(
    `${viewportId}-desktop-alert-settings`,
    await page.screenshot({ fullPage: false }),
  );
  await page.keyboard.press("Escape");
  await finalSurface.dialog.waitFor({ state: "detached", timeout: 5_000 });
  await peer.keyboard.press("Escape");
  await peerFinalSurface.dialog.waitFor({
    state: "detached",
    timeout: 5_000,
  });

  const codexMutationsAfter = fixtureState.codexRouteRequests.filter(
    (request) => request.method !== "GET" && request.method !== "HEAD",
  ).length;
  const peerCodexMutationsAfter = peerFixtureState.codexRouteRequests.filter(
    (request) => request.method !== "GET" && request.method !== "HEAD",
  ).length;
  const persistedText = JSON.stringify({
    afterMuteStorage,
    storageAfterDelivery,
    finalStorage,
  });
  const storageContainsRawContent = forbiddenPayloadFragments.some((fragment) =>
    persistedText.includes(fragment),
  );
  const nativeWebLocksAvailable = await page.evaluate(
    () => typeof navigator.locks?.request === "function",
  );
  await peer.close();

  return {
    disclosureInitiallyClosed,
    summaryKeyboardReachable,
    actionKeyboardReachable,
    projectControlKeyboardReachable,
    exactHoldingLabel,
    disclosure,
    requestCountBeforeDisclosure: initial?.permissionRequests ?? -1,
    requestCountAfterDisclosure: afterDisclosure?.permissionRequests ?? -1,
    enabled,
    baselineNotificationCount: enabled?.notifications.length ?? -1,
    baselineStorage,
    baselineStorageState,
    afterMuteStorage,
    afterMuteStorageState,
    muteRecordIsContentFree,
    muteMutationIsLocalOnly,
    crossTabMuteReflected,
    muteDeliveryRace: {
      sameEventKey: muteRaceEvent.eventKey === peerMuteRaceEvent.eventKey,
      notificationCount: muteRaceNotifications.length,
      claimCount:
        muteRaceStorageState.digestCount - baselineStorageState.digestCount,
      writerWon:
        muteRaceWriterQueuedBeforeReader &&
        muteRaceExactProjectControlTransition &&
        muteRaceStorageState.mutedProjectDigestCount === 1 &&
        muteRaceStorageState.exactProjectMutesShape,
    },
    foregroundNotificationCount:
      (foreground?.notifications.length ?? -1) +
      (peerForeground?.notifications.length ?? -1),
    foregroundClaimPersisted:
      foregroundStorageState.digestCount ===
      afterMuteStorageState.digestCount + 1,
    foregroundStorageState,
    allMuted: {
      sameEventKey: allMutedEvent.eventKey === peerAllMutedEvent.eventKey,
      notificationCount: allMutedNotifications.length,
      claimCount:
        allMutedStorageState.digestCount - foregroundStorageState.digestCount,
    },
    mixed: {
      sameEventKeys:
        JSON.stringify(mixedEvents.map((event) => event.eventKey)) ===
        JSON.stringify(peerMixedEvents.map((event) => event.eventKey)),
      notificationCount: mixedNotifications.length,
      claimCount:
        mixedStorageState.digestCount - allMutedStorageState.digestCount,
      notification: mixedNotification,
      exactPayloadShape:
        mixedNotification?.title === "Coffice" &&
        mixedNotification.options?.body ===
          "New actions are ready. Open Coffice to review them." &&
        mixedNotification.options?.silent === true &&
        typeof mixedNotification.options?.tag === "string" &&
        mixedNotification.options.tag.length > 0 &&
        JSON.stringify(Object.keys(mixedNotification.options).sort()) ===
          JSON.stringify(["body", "silent", "tag"]),
      payloadIsContentFree: forbiddenPayloadFragments.every(
        (fragment) => !mixedPayloadText.includes(fragment),
      ),
      expectedTargetEventKey: expectedMixedTarget.eventKey,
      clicked,
      clickClosedNotification:
        afterClick?.notifications[mixedWinner?.index ?? -1]?.closed === true,
      focusAttempted: (afterClick?.focusCalls ?? 0) === 1,
      exactRoute: exactMixedRoute,
      winnerSeenEventKeys: mixedWinnerFixture.seenAttentionEventKeys,
    },
    rename: {
      retainedMute: renameRetainedMute,
      removeReaddRetainedMute,
      sameEventKey:
        renamedMutedEvent.eventKey === peerRenamedMutedEvent.eventKey,
      notificationCount: renamedMutedNotifications.length,
      claimCount:
        renamedMutedStorageState.digestCount - mixedStorageState.digestCount,
    },
    unmuteDidNotReplay,
    later: {
      sameEventKey: laterEvent.eventKey === peerLaterEvent.eventKey,
      notificationCount: laterNotifications.length,
      claimCount:
        deliveredStorageState.digestCount -
        renamedMutedStorageState.digestCount,
      exactPayloadShape:
        laterNotification?.title === "Coffice" &&
        laterNotification.options?.body ===
          "A new action is ready. Open Coffice to review it." &&
        laterNotification.options?.silent === true &&
        typeof laterNotification.options?.tag === "string" &&
        laterNotification.options.tag.length > 0 &&
        JSON.stringify(Object.keys(laterNotification.options).sort()) ===
          JSON.stringify(["body", "silent", "tag"]),
      payloadIsContentFree: forbiddenPayloadFragments.every(
        (fragment) => !laterPayloadText.includes(fragment),
      ),
    },
    controls: {
      resetKeyboardReachable,
      resetControlComfortable,
      resetConfirmationComfortable,
      resetInitialFocus,
      resetEscapeKeptDigest,
      resetEscapeRestoredFocus,
      resetSuccessFocusInDialog,
      resetWasDeliveryQuiet,
      resetReflectedAcrossTabs,
      offProjectControlsAvailable,
    },
    notification: mixedNotification,
    exactPayloadShape:
      mixedNotification?.title === "Coffice" &&
      mixedNotification.options?.silent === true &&
      typeof mixedNotification.options?.tag === "string" &&
      mixedNotification.options.tag.length > 0 &&
      JSON.stringify(Object.keys(mixedNotification.options).sort()) ===
        JSON.stringify(["body", "silent", "tag"]),
    payloadIsContentFree: forbiddenPayloadFragments.every(
      (fragment) =>
        !mixedPayloadText.includes(fragment) &&
        !laterPayloadText.includes(fragment),
    ),
    storageAfterDelivery,
    deliveredStorageState,
    storageContainsRawContent,
    workspaceWritesDuringStory:
      fixtureState.workspaceWriteCount -
      writesBefore +
      peerFixtureState.workspaceWriteCount,
    seenWritesDuringStory:
      fixtureState.attentionSeenWriteCount -
      seenWritesBefore +
      peerFixtureState.attentionSeenWriteCount,
    seenEventKeysDuringStory: [
      ...fixtureState.seenAttentionEventKeys.slice(seenWritesBefore),
      ...peerFixtureState.seenAttentionEventKeys,
    ],
    expectedSeenEventKey: expectedMixedTarget.eventKey,
    codexMutationsDuringStory:
      codexMutationsAfter - codexMutationsBefore + peerCodexMutationsAfter,
    onBeforeDisable,
    disabled,
    finalStorage,
    finalStorageState,
    finalContainment,
    crossTab: {
      sameForegroundEventKey:
        foregroundEvent.eventKey === peerForegroundEvent.eventKey,
      visibleHiddenNotificationCount:
        (foreground?.notifications.length ?? -1) +
        (peerForeground?.notifications.length ?? -1),
      visibleHiddenClaimCount:
        foregroundStorageState.digestCount - afterMuteStorageState.digestCount,
      nativeWebLocksAvailable,
    },
  };
}

async function auditProjectAttentionScoping(page, fixtureState) {
  await enterProjectFromCampus(
    page,
    SECONDARY_PROJECT_ID,
    SECONDARY_TASK_COUNT,
  );
  await waitForAttentionCount(page, SECONDARY_ATTENTION_COUNT);
  const secondaryWorkflow = await inspectSettledWorkflowAreas(
    page,
    {
      "Secondary Agent 01": "desk",
      "Secondary Agent 02": "review",
    },
    fixtureState,
  );
  const secondaryToggle = attentionToggle(page);
  const secondaryTrigger = await readAttentionTrigger(secondaryToggle);
  await secondaryToggle.focus();
  await secondaryToggle.click();
  const inbox = page.locator('[data-attention-inbox="true"]');
  await inbox.waitFor({ state: "visible", timeout: 5_000 });
  const secondary = {
    trigger: secondaryTrigger,
    scopeProjectId: await inbox.getAttribute("data-attention-scope-project-id"),
    scopeHeadingCount: await inbox
      .getByRole("heading", {
        name: "Secondary Office attention",
        exact: true,
      })
      .count(),
    scopeIntroCount: await inbox
      .getByText("Only current observed actions for Secondary Office.", {
        exact: true,
      })
      .count(),
    itemCount: await inbox.locator("[data-attention-item]").count(),
    itemTexts: (
      await inbox.locator("[data-attention-item]").allTextContents()
    ).map((item) => item.replace(/\s+/gu, " ").trim()),
    primaryItemCount: await inbox
      .locator("[data-attention-item]")
      .filter({ hasText: /Acceptance (?:Agent|Office)/u })
      .count(),
    initialFocusOnItem: await page.evaluate(() =>
      Boolean(document.activeElement?.closest("[data-attention-item]")),
    ),
    containment: await inspectAttentionPanelContainment(inbox),
    workflow: secondaryWorkflow,
  };
  await page.keyboard.press("Escape");
  await inbox.waitFor({ state: "detached", timeout: 5_000 });
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("aria-controls") ===
      "attention-inbox",
  );
  secondary.focusRestored = await secondaryToggle.evaluate(
    (element) => document.activeElement === element,
  );

  await enterProjectFromCampus(page, HOLDING_PROJECT_ID, HOLDING_TASK_COUNT);
  await waitForAttentionCount(page, HOLDING_ATTENTION_COUNT);
  const holdingWorkflow = await inspectSettledWorkflowAreas(
    page,
    { "Holding Agent 01": "desk" },
    fixtureState,
  );
  const holdingToggle = attentionToggle(page);
  const holdingTrigger = await readAttentionTrigger(holdingToggle);
  await holdingToggle.focus();
  await holdingToggle.click();
  await inbox.waitFor({ state: "visible", timeout: 5_000 });
  const holding = {
    trigger: holdingTrigger,
    scopeProjectId: await inbox.getAttribute("data-attention-scope-project-id"),
    scopeHeadingCount: await inbox
      .getByRole("heading", {
        name: "Unassigned Sessions attention",
        exact: true,
      })
      .count(),
    scopeIntroCount: await inbox
      .getByText("Only current observed actions for Unassigned Sessions.", {
        exact: true,
      })
      .count(),
    itemCount: await inbox.locator("[data-attention-item]").count(),
    emptyHeadingCount: await inbox
      .getByText("No current actions", { exact: true })
      .count(),
    emptyCopy: (await inbox.innerText()).replace(/\s+/gu, " ").trim(),
    initialFocusOnClose:
      (await page.evaluate(() =>
        document.activeElement?.getAttribute("aria-label"),
      )) === "Close attention inbox",
    containment: await inspectAttentionPanelContainment(inbox),
    workflow: holdingWorkflow,
  };
  await page.keyboard.press("Escape");
  await inbox.waitFor({ state: "detached", timeout: 5_000 });
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("aria-controls") ===
      "attention-inbox",
  );
  holding.focusRestored = await holdingToggle.evaluate(
    (element) => document.activeElement === element,
  );
  const holdingPlanToggle = page.getByRole("button", {
    name: "Plan",
    exact: true,
  });
  await holdingPlanToggle.focus();
  await holdingPlanToggle.click();
  const holdingPlanner = page.locator('[data-work-planner="true"]');
  await holdingPlanner.waitFor({ state: "visible", timeout: 5_000 });
  holding.projectDecisionLogOmitted =
    (await holdingPlanner.locator("[data-project-decision-log]").count()) ===
      0 &&
    (await holdingPlanner
      .getByRole("heading", { name: "Project decision log", exact: true })
      .count()) === 0;
  await page.keyboard.press("Escape");
  await holdingPlanner.waitFor({ state: "detached", timeout: 5_000 });
  await page.waitForFunction(
    () => document.activeElement?.textContent?.trim() === "Plan",
  );
  holding.planFocusRestored = await holdingPlanToggle.evaluate(
    (element) => document.activeElement === element,
  );

  await enterProjectFromCampus(page, PRIMARY_PROJECT_ID, PRIMARY_TASK_COUNT);
  await waitForAttentionCount(page, PRIMARY_ATTENTION_COUNT);
  const restoredPrimaryTrigger = await readAttentionTrigger(
    attentionToggle(page),
  );

  return { secondary, holding, restoredPrimaryTrigger };
}

async function inspectLayout(page, viewport) {
  return page.evaluate(
    ({ expectedWidth, expectedHeight, expectedTaskCount, viewportId }) => {
      const rect = (element) => {
        const bounds = element?.getBoundingClientRect();
        return bounds
          ? {
              left: bounds.left,
              top: bounds.top,
              right: bounds.right,
              bottom: bounds.bottom,
              width: bounds.width,
              height: bounds.height,
            }
          : null;
      };
      const room = document.querySelector('[data-topdown-room="true"]');
      const stage = room?.parentElement ?? null;
      const officeFrame = document.querySelector(
        'main[data-office-viewport="true"] > div',
      );
      const product = document.querySelector(
        '[data-product-office-renderer="topdown"]',
      );
      const roomViewport = stage?.parentElement ?? null;
      const roomRect = rect(room);
      const stageRect = rect(stage);
      const officeFrameRect = rect(officeFrame);
      const productRect = rect(product);
      const worldWidth = Number(stage?.getAttribute("data-world-width"));
      const worldHeight = Number(stage?.getAttribute("data-world-height"));
      const declaredScale = Number(stage?.getAttribute("data-world-scale"));
      const widthScale = roomRect ? roomRect.width / worldWidth : 0;
      const heightScale = roomRect ? roomRect.height / worldHeight : 0;
      const chairs = Array.from(
        document.querySelectorAll("[data-chair-state]"),
      ).map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          width: bounds.width,
          height: bounds.height,
          ratio: bounds.height ? bounds.width / bounds.height : 0,
        };
      });
      const assignedDeskIndices = Array.from(
        document.querySelectorAll("[data-agent-state]"),
      ).map((element) => element.getAttribute("data-assigned-desk"));
      const documentElement = document.documentElement;
      const maxRoomScrollLeft = Math.max(
        0,
        (roomViewport?.scrollWidth ?? 0) - (roomViewport?.clientWidth ?? 0),
      );
      const maxRoomScrollTop = Math.max(
        0,
        (roomViewport?.scrollHeight ?? 0) - (roomViewport?.clientHeight ?? 0),
      );
      const previousRoomScroll = {
        left: roomViewport?.scrollLeft ?? 0,
        top: roomViewport?.scrollTop ?? 0,
      };
      if (roomViewport) {
        roomViewport.scrollLeft = maxRoomScrollLeft;
        roomViewport.scrollTop = maxRoomScrollTop;
      }
      const roomPanProbe = {
        left: roomViewport?.scrollLeft ?? 0,
        top: roomViewport?.scrollTop ?? 0,
      };
      if (roomViewport) {
        roomViewport.scrollLeft = previousRoomScroll.left;
        roomViewport.scrollTop = previousRoomScroll.top;
      }
      const oldRendererCount = document.querySelectorAll(
        '[data-boss-camera-scene="true"], [data-pixi-office-shell], canvas[data-phaser], canvas[data-engine]',
      ).length;
      const centeredDifference = officeFrameRect
        ? Math.abs(
            officeFrameRect.left + officeFrameRect.width / 2 - innerWidth / 2,
          )
        : Number.POSITIVE_INFINITY;
      const countControls = Array.from(
        document.querySelectorAll(
          "button[data-attention-count][data-needs-reply-count][data-needs-decision-count][data-unread-result-count]",
        ),
      );

      return {
        viewport: { width: innerWidth, height: innerHeight },
        expectedViewport: { width: expectedWidth, height: expectedHeight },
        rendererCount: document.querySelectorAll(
          '[data-product-office-renderer="topdown"]',
        ).length,
        roomCount: document.querySelectorAll('[data-topdown-room="true"]')
          .length,
        oldRendererCount,
        deskCount: document.querySelectorAll("[data-desk-state]").length,
        chairCount: chairs.length,
        actorCount: document.querySelectorAll("[data-agent-state]").length,
        expectedTaskCount,
        uniqueAssignedDeskCount: new Set(assignedDeskIndices).size,
        world: {
          width: worldWidth,
          height: worldHeight,
          declaredScale,
          widthScale,
          heightScale,
          uniformScaleError: Math.abs(widthScale - heightScale),
          declarationError: Math.max(
            Math.abs(widthScale - declaredScale),
            Math.abs(heightScale - declaredScale),
          ),
          roomRect,
          stageRect,
          scrollWidth: roomViewport?.scrollWidth ?? 0,
          scrollHeight: roomViewport?.scrollHeight ?? 0,
          clientWidth: roomViewport?.clientWidth ?? 0,
          clientHeight: roomViewport?.clientHeight ?? 0,
          viewportVisible: Boolean(
            roomViewport &&
            roomViewport.clientWidth >= 40 &&
            roomViewport.clientHeight >= 40,
          ),
          internalPan: {
            maxScrollLeft: maxRoomScrollLeft,
            maxScrollTop: maxRoomScrollTop,
            overflowAvailable: maxRoomScrollLeft > 1 || maxRoomScrollTop > 1,
            reachedHorizontalEnd:
              maxRoomScrollLeft <= 1 ||
              Math.abs(roomPanProbe.left - maxRoomScrollLeft) <= 1,
            reachedVerticalEnd:
              maxRoomScrollTop <= 1 ||
              Math.abs(roomPanProbe.top - maxRoomScrollTop) <= 1,
          },
        },
        chairs,
        officeFrame: {
          rect: officeFrameRect,
          bounded: Boolean(officeFrameRect && officeFrameRect.width <= 1561),
          contained: Boolean(
            officeFrameRect &&
            productRect &&
            officeFrameRect.width > 1 &&
            officeFrameRect.height > 1 &&
            officeFrameRect.left >= productRect.left - 1 &&
            officeFrameRect.top >= productRect.top - 1 &&
            officeFrameRect.right <= productRect.right + 1 &&
            officeFrameRect.bottom <= productRect.bottom + 1,
          ),
          centeredDifference,
        },
        document: {
          scrollWidth: documentElement.scrollWidth,
          scrollHeight: documentElement.scrollHeight,
          clientWidth: documentElement.clientWidth,
          clientHeight: documentElement.clientHeight,
          noHorizontalOverflow:
            documentElement.scrollWidth <= documentElement.clientWidth + 1,
          noVerticalOverflow:
            documentElement.scrollHeight <= documentElement.clientHeight + 1,
          windowScrollIsZero:
            Math.abs(window.scrollX) <= 1 && Math.abs(window.scrollY) <= 1,
          selectedOfficeFitsViewport: Boolean(
            productRect &&
            productRect.left >= -1 &&
            productRect.top >= -1 &&
            productRect.right <= innerWidth + 1 &&
            productRect.bottom <= innerHeight + 1,
          ),
          shortViewportUsesRoomPan:
            viewportId !== "short-landscape" ||
            maxRoomScrollLeft > 1 ||
            maxRoomScrollTop > 1,
        },
        countWayfinding: {
          controlCount: countControls.length,
          contained: countControls.every((control) => {
            const bounds = control.getBoundingClientRect();
            return (
              bounds.left >= -1 &&
              bounds.right <= innerWidth + 1 &&
              control.scrollWidth <= control.clientWidth + 1 &&
              Array.from(control.children).every((child) => {
                const childBounds = child.getBoundingClientRect();
                return (
                  childBounds.left >= bounds.left - 1 &&
                  childBounds.right <= bounds.right + 1
                );
              })
            );
          }),
        },
        brokenImages: Array.from(document.images)
          .filter((image) => image.complete && image.naturalWidth === 0)
          .map((image) => image.currentSrc || image.src),
        frameworkErrorOverlay: Boolean(
          document.querySelector(
            '[data-nextjs-dialog-overlay], nextjs-portal [role="dialog"], .vite-error-overlay, #webpack-dev-server-client-overlay',
          ),
        ),
      };
    },
    {
      expectedWidth: viewport.width,
      expectedHeight: viewport.height,
      expectedTaskCount: PRIMARY_TASK_COUNT,
      viewportId: viewport.id,
    },
  );
}

async function auditAccessibility(page) {
  const summarize = async () => {
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    return {
      violationCount: audit.violations.length,
      affectedNodeCount: audit.violations.reduce(
        (count, violation) => count + violation.nodes.length,
        0,
      ),
      rules: audit.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodeCount: violation.nodes.length,
        targets: violation.nodes.flatMap((node) => node.target.map(String)),
      })),
    };
  };

  await enterTopDownOffice(page);
  await openCampus(page);
  await page.locator(".campus").waitFor({ state: "visible", timeout: 5_000 });
  const campus = await summarize();
  await enterTopDownOffice(page);
  const office = await summarize();
  return { campus, office, structuralOnly: true };
}

function acceptanceFailures(result) {
  const failures = [];
  const require = (condition, message) => {
    if (!condition) failures.push(message);
  };
  require(result.accessibility?.campus?.violationCount === 0 &&
    result.accessibility?.office?.violationCount === 0 &&
    result.accessibility?.structuralOnly ===
      true, "the automated WCAG A/AA audit reported a campus or office violation");
  const countLabel = (count, singular) =>
    `${count} ${singular}${count === 1 ? "" : "s"}`;
  const repliesNeededLabel = (count) =>
    `${count} ${count === 1 ? "reply" : "replies"} needed`;
  const countAttributesMatch = (
    evidence,
    total,
    needsReply,
    unreadResults,
    needsDecision = 0,
  ) =>
    evidence?.count === String(total) &&
    evidence?.needsReplyCount === String(needsReply) &&
    evidence?.needsDecisionCount === String(needsDecision) &&
    evidence?.unreadResultCount === String(unreadResults);
  const projectCountIs = (
    rows,
    projectId,
    total,
    needsReply,
    unreadResults,
  ) => {
    const row = rows?.[projectId];
    return (
      countAttributesMatch(row, total, needsReply, unreadResults) &&
      row.text.includes(countLabel(total, "action")) &&
      (needsReply === 0 || row.text.includes(repliesNeededLabel(needsReply))) &&
      (unreadResults === 0 || row.text.includes(`${unreadResults} unread`)) &&
      row.ariaLabel?.includes(repliesNeededLabel(needsReply)) &&
      row.ariaLabel?.includes(countLabel(unreadResults, "unread result"))
    );
  };
  const projectCountsAreUnknown = (rows, projectId) => {
    const row = rows?.[projectId];
    return (
      row?.count === "—" &&
      row.needsReplyCount === "—" &&
      row.needsDecisionCount === "—" &&
      row.unreadResultCount === "—" &&
      row.ariaLabel?.includes("Current actions not ready")
    );
  };
  const attentionPanelIsContained = (containment) =>
    containment?.panelWithinViewport && containment?.noHorizontalOverflow;
  const projectDecisionIsContained = (containment) =>
    containment?.withinPlanner &&
    containment?.panelWithinViewportWidth &&
    containment?.noHorizontalOverflow &&
    containment?.descendantsContained &&
    containment?.longContextContained;
  const currentContextLayoutIsContained = (layout) =>
    layout?.panelWithinViewport &&
    layout?.noHorizontalOverflow &&
    layout?.controlsComfortable &&
    layout?.previewBounded;

  const currentPlanContext = result.currentPlanContext;
  const projectRules = result.projectRules;
  const projectQualityBars = result.projectQualityBars;
  const savedResultComparison = result.savedResultComparison;
  require(savedResultComparison?.closedDefault &&
    savedResultComparison?.optionCount === 2 &&
    savedResultComparison?.optionsExact &&
    savedResultComparison?.initialAttributionExact &&
    savedResultComparison?.copyContract &&
    savedResultComparison?.excludedRelationshipsAndEarlierCycle, "Compare saved evidence did not preserve exact reference/alternative attribution, canonical order, or frozen structural copy");
  require(savedResultComparison?.switchExact &&
    savedResultComparison?.removalDidNotSubstitute, "Compare saved evidence did not switch exact candidates or invalidate a removed selection without ordinal substitution");
  require(savedResultComparison?.openFocus &&
    savedResultComparison?.closeFocusRestored &&
    savedResultComparison?.closeClearedSwitchStatus &&
    savedResultComparison?.escapeFocusRestored &&
    savedResultComparison?.triggerComfortable &&
    savedResultComparison?.triggerOpaqueFocus &&
    savedResultComparison?.pickerOpaqueFocus, "Compare saved evidence lost its keyboard focus handoff, focus recovery, readable control size, or opaque focus treatment");
  require(savedResultComparison?.layout?.expectedColumnLayout &&
    savedResultComparison?.layout?.cardCount === 2 &&
    savedResultComparison?.layout?.controlsComfortable &&
    savedResultComparison?.layout?.panelWithinViewport &&
    savedResultComparison?.layout?.surfaceWithinInspector &&
    savedResultComparison?.layout?.noHorizontalOverflow &&
    savedResultComparison?.layout?.descendantsContained &&
    savedResultComparison?.layout
      ?.compactScrolls, "Compare saved evidence did not use two wide columns, one portrait column, or remain contained and scrollable at a supported viewport");
  require(savedResultComparison?.initialPrivacyClean &&
    savedResultComparison?.switchedPrivacyClean &&
    savedResultComparison?.reportPrivacySafe &&
    savedResultComparison?.logPrivacySafe &&
    savedResultComparison?.scalarOnlyReport, "Compare saved evidence exposed excluded content or identifiers in its DOM/ARIA, URL/storage, report, or log surfaces");
  require(savedResultComparison?.workspaceWriteDelta === 0 &&
    savedResultComparison?.workspaceMutationAttemptDelta === 0 &&
    savedResultComparison?.resultObservationWriteDelta === 0 &&
    savedResultComparison?.codexMutationDelta === 0 &&
    savedResultComparison?.verificationMutationDelta ===
      0, "Compare saved evidence caused a workspace, result-observation, Codex, or verification mutation");
  require(projectRules?.rulesFirstWithoutLocalProject &&
    projectRules?.firstUpsertExact &&
    projectRules?.editReorderRemoveExact &&
    projectRules?.reopenedPersistenceExact &&
    projectRules?.nativeDisclosure &&
    projectRules?.nativeDisclosureInitiallyClosed &&
    projectRules?.nativeDisclosureKeyboardOpened &&
    projectRules?.nativeDisclosureOpenFocusRetained &&
    projectRules?.nativeDisclosureExactContentsVisible &&
    projectRules?.clearedExact &&
    projectRules?.exactNoRulesState, "Project Rules did not create its exact rules-first local plan or persist edit, reorder, remove, clear, and reopen state");
  require(projectRules?.firstConflictDistinct &&
    projectRules?.keepInitialFocus &&
    projectRules?.reloadEscapeRestoredFocus &&
    projectRules?.useDraftPreserved &&
    projectRules?.loadLatestExact &&
    projectRules?.unrelatedWorkspaceChangeNotCalledRulesChange &&
    projectRules?.conflictCount ===
      4, "Project Rules did not preserve distinct conflict drafts through Keep/Use-draft/Load semantics or mislabeled an unrelated revision");
  require(projectRules?.orphanPreservedCopyableUnsaveable &&
    projectRules?.orphanInitialFocus &&
    projectRules?.orphanCancelRestoredAdd &&
    projectRules?.orphanNeverRecreated &&
    projectRules?.stableIdRenameRetainsRules &&
    projectRules?.sourceAbsentWithoutRuleLoss &&
    projectRules?.temporarySourceReturnRetainsRules &&
    projectRules?.explicitLocalRemovalReaddStartsEmpty, "Project Rules did not preserve stable-ID and source-absence state or safely strand a deleted-plan draft");
  require(projectRules?.revisionsAndEnvelopesExact &&
    projectRules?.mutationSequenceExact &&
    projectRules?.stepDeltasExact &&
    projectRules?.requestCount === 8 &&
    projectRules?.successfulWriteCount === 4 &&
    projectRules?.workspaceWriteDelta === 4 &&
    projectRules?.workspaceMutationAttemptDelta === 8 &&
    projectRules?.resultObservationWriteDelta === 0 &&
    projectRules?.codexMutationDelta === 0 &&
    projectRules?.verificationMutationDelta ===
      0, "Project Rules emitted an unexpected mutation sequence or side effect");
  require(projectRules?.triggerKeyboardReachable &&
    projectRules?.initialEditorFocus &&
    projectRules?.addFocus &&
    projectRules?.moveFocus &&
    projectRules?.removeFocus &&
    projectRules?.firstSaveFocusRestored &&
    projectRules?.closeFocusRestored &&
    projectRules?.nestedEscapeDisclosureRemountedOpen &&
    projectRules?.nestedCancelDisclosureRemountedOpen &&
    projectRules?.clearBackInitialFocus &&
    projectRules?.clearEscapeRestoredEditor &&
    projectRules?.clearSuccessFocus &&
    projectRules?.draftBadgeExact &&
    projectRules?.controlsComfortable &&
    projectRules?.opaqueFocus &&
    projectRules?.longTokenContained &&
    projectRules?.shortLandscapeActionsCompact &&
    projectRules?.noHorizontalOverflow, "Project Rules failed its keyboard, focus, sizing, or responsive-containment contract");
  require(projectRules?.storageClean &&
    projectRules?.ariaClean &&
    projectRules?.urlClean &&
    projectRules?.domClean &&
    projectRules?.publicSnapshotClean &&
    projectRules?.publicEventSurfacesClean &&
    projectRules?.structuralWorkspaceEventsClean &&
    projectRules?.codexRequestSurfacesClean &&
    projectRules?.verificationRequestSurfacesClean &&
    projectRules?.pendingCodexBodiesClean &&
    projectRules?.codexOperationSurfacesClean &&
    projectRules?.liveVerificationSurfacesClean &&
    projectRules?.reportPrivacySafe &&
    projectRules?.logPrivacySafe &&
    projectRules?.scalarOnlyReport, "Project Rules exposed private fixture text outside its intended transient surfaces or emitted non-scalar report evidence");
  require(projectQualityBars?.firstSaveStateExact &&
    projectQualityBars?.firstUpsertExact &&
    projectQualityBars?.dedicatedMutationExact &&
    projectQualityBars?.persistedExact &&
    projectQualityBars?.clearExact &&
    projectQualityBars?.envelopesExact &&
    projectQualityBars?.requestCount === 3 &&
    projectQualityBars?.successfulWriteCount === 3 &&
    projectQualityBars?.workspaceWriteDelta === 3 &&
    projectQualityBars?.workspaceMutationAttemptDelta === 3 &&
    projectQualityBars?.codexMutationDelta === 0 &&
    projectQualityBars?.verificationMutationDelta ===
      0, "Project Quality Bars did not persist the exact create/edit/clear intents or emitted an unexpected side effect");
  require(projectQualityBars?.triggerKeyboardReachable &&
    projectQualityBars?.initialFocus &&
    projectQualityBars?.noDraftWrite &&
    projectQualityBars?.firstSaveFocus &&
    projectQualityBars?.clearBackFocus &&
    projectQualityBars?.clearFocus &&
    projectQualityBars?.controlsComfortable &&
    projectQualityBars?.opaqueFocus &&
    projectQualityBars?.editorNoHorizontalOverflow &&
    projectQualityBars?.reviewContained &&
    projectQualityBars?.reviewNoHorizontalOverflow, "Project Quality Bars failed its keyboard, focus, sizing, or responsive containment contract");
  require(projectQualityBars?.reviewExact &&
    projectQualityBars?.acceptanceNotBlocked &&
    projectQualityBars?.scalarOnlyReport, "Project Quality Bars did not show the exact result readiness summary or preserve user acceptance authority");
  require(currentPlanContext?.historicalSourceVisible &&
    currentPlanContext?.exactSourceProjectStillVisible &&
    currentPlanContext?.historicalRulesUseSourceProjectOnly &&
    currentPlanContext?.historicalRulesExact &&
    currentPlanContext?.historicalRulesAdvisoryExact &&
    currentPlanContext?.historicalRulesReadOnly &&
    currentPlanContext?.historicalDefinitionCurrent &&
    currentPlanContext?.historicalDefinitionOrderExact &&
    currentPlanContext?.historicalDefinitionHasNoControls &&
    currentPlanContext?.helperDescribesCurrentDestination, "current plan insertion did not distinguish the exact historical source criteria from the task's current destination");
  require(currentPlanContext?.composeInitialFocus &&
    currentPlanContext?.insertionFocusAndCaret &&
    currentPlanContext?.confirmationInitialFocus &&
    currentPlanContext?.escapeConfirmationRetainedEdit &&
    currentPlanContext?.backRetainedEdit &&
    currentPlanContext?.explicitCancelRestoredFocus &&
    currentPlanContext?.escapeComposeCancelled &&
    currentPlanContext?.escapeComposeClearedDraft &&
    currentPlanContext?.operationFocused, "current plan insertion lost the frozen compose, confirmation, Escape, Back, cancel, or completion focus contract");
  require(currentPlanContext?.insertionExact &&
    currentPlanContext?.privacyExact &&
    currentPlanContext?.exactPreview &&
    currentPlanContext?.previewContract &&
    currentPlanContext?.disclosureExact &&
    currentPlanContext?.previewKeyboardScrollableAndFocused, "current plan insertion or confirmation preview included the wrong context or violated its privacy/copy contract");
  require(currentPlanContext?.insertHadNoWrites &&
    currentPlanContext?.cancelHadNoWrites &&
    currentPlanContext?.exactDispatch &&
    currentPlanContext?.exactlyOneAction &&
    currentPlanContext?.noVerificationOrWorkspaceMutation &&
    currentPlanContext?.oversizedBlocked &&
    currentPlanContext?.projectRulesExcludedFromDraft, "current plan insertion wrote before confirmation, included Project Rules, dispatched the wrong action count, or mutated verification/workspace state");
  require(currentPlanContext?.structuralOperationOnly &&
    currentPlanContext?.transientTextCleared &&
    currentPlanContext?.reportPrivacySafe &&
    currentPlanContext?.instructionDigestShape?.currentDecisionCount === 2 &&
    currentPlanContext?.instructionDigestShape?.length > 0 &&
    currentPlanContext?.instructionDigestShape?.lineCount >=
      10, "current plan follow-up text escaped the transient boundary or the structural operation retained content");
  require(currentPlanContext?.entryControlLayout?.comfortable &&
    currentPlanContext?.entryControlLayout?.opaqueFocusOutline &&
    currentContextLayoutIsContained(currentPlanContext?.composeLayout) &&
    currentContextLayoutIsContained(
      currentPlanContext?.confirmationLayout,
    ), "current plan compose/confirmation controls were too small, unbounded, or horizontally overflowing");
  const failedCheckRepair = result.failedCheckRepair;
  require(failedCheckRepair?.noReceiptRowAbsent &&
    failedCheckRepair?.laterPassRowAbsent &&
    failedCheckRepair?.oversizedCandidateDisabled &&
    failedCheckRepair?.safetyCandidateDisabled &&
    failedCheckRepair?.emptyOnlyInsertion &&
    failedCheckRepair?.helperExact, "failed-check repair entry did not honor newest-exact receipt precedence, empty-only insertion, safety, or no-truncation availability");
  require(failedCheckRepair?.insertionExact &&
    failedCheckRepair?.latestExactReceiptOnly &&
    failedCheckRepair?.privacyExact &&
    failedCheckRepair?.exactPreview &&
    failedCheckRepair?.previewContract &&
    failedCheckRepair?.disclosureExact &&
    failedCheckRepair?.previewKeyboardScrollableAndFocused &&
    failedCheckRepair?.reportPrivacySafe, "failed-check repair draft, preview, structural source, or privacy exclusions were not exact");
  require(failedCheckRepair?.composeInitialFocus &&
    failedCheckRepair?.entryKeyboardFocus &&
    failedCheckRepair?.insertionFocusAndCaret &&
    failedCheckRepair?.confirmationInitialFocus &&
    failedCheckRepair?.escapeConfirmationRetainedEdit &&
    failedCheckRepair?.backRetainedEdit &&
    failedCheckRepair?.explicitCancelRestoredFocus &&
    failedCheckRepair?.escapeComposeCancelled &&
    failedCheckRepair?.escapeComposeClearedDraft &&
    failedCheckRepair?.operationFocused, "failed-check repair lost the frozen keyboard, edit, Escape, Back, cancel, caret, or completion focus contract");
  require(failedCheckRepair?.staleReceiptPreservedDraft &&
    failedCheckRepair?.staleReceiptPreventedDispatch &&
    failedCheckRepair?.staleSourcePreservedDraft &&
    failedCheckRepair?.staleSourcePreventedDispatch, "failed-check repair did not preserve and demote edited text after exact receipt or source eligibility invalidation");
  require(failedCheckRepair?.insertHadNoWrites &&
    failedCheckRepair?.cancelHadNoWrites &&
    failedCheckRepair?.exactDispatch &&
    failedCheckRepair?.exactlyOneAction &&
    failedCheckRepair?.noVerificationOrWorkspaceMutation &&
    failedCheckRepair?.receiptCountUnchanged &&
    failedCheckRepair?.verificationReadsOnly &&
    failedCheckRepair?.routeCounts?.codexMutations === 1 &&
    failedCheckRepair?.routeCounts?.verificationGets > 0 &&
    failedCheckRepair?.routeCounts?.verificationMutations === 0 &&
    failedCheckRepair?.routeCounts?.workspaceMutationAttempts === 0 &&
    failedCheckRepair?.projectRulesSourcePresent &&
    failedCheckRepair?.projectRulesExcludedFromDraft, "failed-check repair wrote before confirmation, included Project Rules, reran verification, mutated Plan, or dispatched other than one confirmed follow-up");
  require(failedCheckRepair?.structuralOperationOnly &&
    failedCheckRepair?.transientTextCleared &&
    failedCheckRepair?.instructionShape?.activeDecisionCount === 2 &&
    failedCheckRepair?.instructionShape?.length > 0 &&
    failedCheckRepair?.instructionShape?.lineCount >=
      15, "failed-check repair retained raw instruction content or reported an incomplete structural shape");
  require(failedCheckRepair?.entryControlLayout?.comfortable &&
    failedCheckRepair?.entryControlLayout?.opaqueFocusOutline &&
    currentContextLayoutIsContained(failedCheckRepair?.composeLayout) &&
    currentContextLayoutIsContained(
      failedCheckRepair?.confirmationLayout,
    ), "failed-check repair controls or preview were too small, unbounded, or horizontally overflowing");
  const multiRootRepository = result.multiRootRepository;
  require(multiRootRepository?.cold?.campusRootCount === 3 &&
    multiRootRepository?.cold?.campusNeutral &&
    multiRootRepository?.cold?.campusAccessible &&
    multiRootRepository?.cold?.campusNoPrimaryMood &&
    multiRootRepository?.cold?.inspectorRootCount === 3 &&
    multiRootRepository?.cold?.refreshingCount === 3 &&
    multiRootRepository?.cold?.exactOrder &&
    multiRootRepository?.cold?.noInventedTimestamp &&
    multiRootRepository?.cold?.noLegacyEvidence &&
    multiRootRepository?.cold?.detailsCount ===
      0, "cold multi-root evidence did not preserve exact root order/count as neutral path-free refreshing placeholders");
  require(multiRootRepository?.settled?.campusRootCount === 3 &&
    multiRootRepository?.settled?.campusNeutral &&
    multiRootRepository?.settled?.campusAccessible &&
    multiRootRepository?.settled?.campusNoPrimaryMood &&
    multiRootRepository?.settled?.inspectorRootCount === 3 &&
    multiRootRepository?.settled?.exactOrder &&
    multiRootRepository?.settled?.freshCount === 2 &&
    multiRootRepository?.settled?.unavailableCount === 1 &&
    multiRootRepository?.settled?.explanationExact &&
    multiRootRepository?.settled?.attributionExact &&
    multiRootRepository?.settled?.noWholeProjectClaim &&
    multiRootRepository?.settled?.changedTotalAppearsOnce &&
    multiRootRepository?.settled?.primaryExact &&
    multiRootRepository?.settled?.additionalExact &&
    multiRootRepository?.settled?.unavailableExact &&
    multiRootRepository?.settled?.primaryDetailsExact &&
    multiRootRepository?.settled
      ?.additionalDetailsExact, "settled multi-root evidence merged roots, changed their order, or reported the wrong independent states/totals/details");
  require(multiRootRepository?.settled?.primaryKeyboardFocus &&
    multiRootRepository?.settled?.additionalKeyboardFocus &&
    multiRootRepository?.settled?.primaryControlComfortable &&
    multiRootRepository?.settled?.additionalControlComfortable &&
    multiRootRepository?.settled?.primaryOpaqueFocus &&
    multiRootRepository?.settled?.additionalOpaqueFocus &&
    multiRootRepository?.settled?.primaryNativeMarker &&
    multiRootRepository?.settled?.additionalNativeMarker &&
    multiRootRepository?.settled?.primaryOpenedIndependently &&
    multiRootRepository?.settled?.additionalOpenedIndependently &&
    multiRootRepository?.settled?.primaryClosedWithFocus &&
    multiRootRepository?.settled
      ?.additionalClosedWithFocus, "multi-root repository disclosures lost native keyboard affordance, independent state, focus, or the 44px/14px/opaque-focus contract");
  require(multiRootRepository?.settled?.panelWithinViewport &&
    multiRootRepository?.settled?.noHorizontalOverflow &&
    multiRootRepository?.settled?.descendantsContained &&
    multiRootRepository?.settled?.longBranchWraps &&
    multiRootRepository?.settled
      ?.compactScrolls, "multi-root repository evidence or its long branch escaped the responsive Review & Act surface");
  require(multiRootRepository?.single?.campusRootCount === 1 &&
    multiRootRepository?.single?.campusMoodUnchanged &&
    multiRootRepository?.single?.campusNoMultiRootCopy &&
    multiRootRepository?.single?.compactCopyUnchanged &&
    multiRootRepository?.single?.noMultiRootGroup &&
    multiRootRepository?.single?.detailsCount === 1 &&
    multiRootRepository?.single
      ?.contained, "legacy one-root evidence did not preserve its existing compact campus and Review & Act presentation");
  require(multiRootRepository?.bounded?.campusExactCount &&
    multiRootRepository?.bounded?.globalCountsExact &&
    multiRootRepository?.bounded?.campusCompactVisible &&
    multiRootRepository?.bounded?.campusCompactAccessible &&
    multiRootRepository?.bounded?.campusNoPrimaryMood &&
    multiRootRepository?.bounded?.inspectorExactCount &&
    multiRootRepository?.bounded?.copyExact &&
    multiRootRepository?.bounded?.noPartialDom &&
    multiRootRepository?.bounded?.noLegacyEvidence &&
    multiRootRepository?.bounded?.noFalseParserFailureCopy &&
    multiRootRepository?.bounded
      ?.contained, "bounded-out repository evidence invented partial root cards or lost its exact compact count/copy/containment");
  require(multiRootRepository?.privacyBoundariesClean &&
    multiRootRepository?.reportPrivacySafe &&
    multiRootRepository?.scalarOnlyReport &&
    multiRootRepository?.workspaceWrites === 0 &&
    multiRootRepository?.workspaceMutationAttempts === 0 &&
    multiRootRepository?.codexMutations === 0 &&
    multiRootRepository?.verificationMutations ===
      0, "multi-root evidence leaked a raw root canary or caused a workspace, Codex, or verification mutation");
  const workflowMatches = (snapshot, expected) =>
    Object.entries(expected).every(([name, area]) => {
      const actor = snapshot?.assignments?.[name];
      return (
        actor?.desired === area &&
        actor?.heading === null &&
        actor?.settled === area &&
        actor?.motion !== "walking" &&
        actor?.assignedDesk !== null
      );
    });
  require(result.layout.rendererCount ===
    1, "top-down renderer is not uniquely mounted");
  require(result.layout.roomCount ===
    1, "top-down room is not uniquely mounted");
  require(result.layout.oldRendererCount ===
    0, "a rejected renderer is still mounted");
  require(result.layout.deskCount ===
    result.layout
      .expectedTaskCount, `expected ${result.layout.expectedTaskCount} desks, found ${result.layout.deskCount}`);
  require(result.layout.actorCount ===
    result.layout
      .expectedTaskCount, `expected ${result.layout.expectedTaskCount} actors, found ${result.layout.actorCount}`);
  require(result.layout.chairCount ===
    result.layout.deskCount, "chair count does not match desk count");
  require(result.layout.uniqueAssignedDeskCount ===
    result.layout.actorCount, "agents do not have unique desk assignments");
  require(result.layout.world.uniformScaleError <=
    0.002, `world scale is non-uniform (${result.layout.world.uniformScaleError})`);
  require(result.layout.world.declarationError <=
    0.002, "rendered world scale disagrees with its declared scale");
  require(result.layout.chairs.every(
    ({ ratio }) => Math.abs(ratio - 1) <= 0.02,
  ), "one or more circular chairs rendered as ellipses");
  require(result.layout.officeFrame
    .bounded, "office composition is not width-bounded");
  require(result.layout.officeFrame
    .contained, "office viewport is clipped outside the selected-office frame");
  require(result.layout.world
    .viewportVisible, "office room viewport has no usable visible area");
  if (result.id === "ultrawide") {
    require(result.layout.officeFrame.centeredDifference <=
      2, "bounded office composition is not centered on the ultrawide viewport");
  }
  require(result.layout.document
    .noHorizontalOverflow, "document has horizontal overflow");
  require(result.layout.document
    .noVerticalOverflow, "selected-project document exceeds the viewport");
  require(result.layout.document
    .windowScrollIsZero, "selected-project window scrolled away from the fixed viewport");
  require(result.layout.document
    .selectedOfficeFitsViewport, "selected office does not fit inside the viewport");
  require(result.layout.world.internalPan.reachedHorizontalEnd &&
    result.layout.world.internalPan
      .reachedVerticalEnd, "room viewport overflow cannot be navigated internally");
  require(result.layout.document
    .shortViewportUsesRoomPan, "short landscape has no internal room pan range");
  const loadingCounts = result.loadingCounts;
  require(projectCountsAreUnknown(
    loadingCounts.campusRows,
    PRIMARY_PROJECT_ID,
  ) &&
    projectCountsAreUnknown(loadingCounts.campusRows, SECONDARY_PROJECT_ID) &&
    projectCountsAreUnknown(loadingCounts.campusRows, HOLDING_PROJECT_ID) &&
    loadingCounts.digestTrigger.disabled &&
    loadingCounts.digestTrigger.count === "—" &&
    loadingCounts.digestTrigger.needsReplyCount === "—" &&
    loadingCounts.digestTrigger.unreadResultCount === "—" &&
    loadingCounts.officeTrigger.label ===
      "Attention for Acceptance Office is loading" &&
    loadingCounts.officeTrigger.count === "—" &&
    loadingCounts.officeTrigger.needsReplyCount === "—" &&
    loadingCounts.officeTrigger.unreadResultCount === "—" &&
    projectCountsAreUnknown(
      loadingCounts.drawer.projectRows,
      PRIMARY_PROJECT_ID,
    ) &&
    projectCountsAreUnknown(
      loadingCounts.drawer.projectRows,
      SECONDARY_PROJECT_ID,
    ) &&
    projectCountsAreUnknown(
      loadingCounts.drawer.projectRows,
      HOLDING_PROJECT_ID,
    ) &&
    loadingCounts.campusCountContainment.controlCount === 4 &&
    loadingCounts.campusCountContainment.noHorizontalOverflow &&
    loadingCounts.officeCountContained &&
    loadingCounts.drawer.countContainment.rowCount === 3 &&
    loadingCounts.drawer.countContainment.panelWithinViewport &&
    loadingCounts.drawer.countContainment
      .noHorizontalOverflow, "loading count surfaces claimed zero or omitted an unknown count attribute");
  require(countAttributesMatch(
    loadingCounts.resolvedOfficeTrigger,
    PRIMARY_ATTENTION_COUNT,
    PRIMARY_NEEDS_REPLY_COUNT,
    PRIMARY_UNREAD_RESULT_COUNT,
  ), "the held loading counts did not resolve to the canonical Acceptance totals");
  require(loadingCounts.noWorkspaceWrites &&
    loadingCounts.noCodexMutations &&
    loadingCounts.drawer.noWorkspaceWrites &&
    loadingCounts.drawer
      .noCodexMutations, "loading or reading the count-only wayfinding wrote the workspace or called a Codex action route");
  require(result.layout.countWayfinding.controlCount === 1 &&
    result.layout.countWayfinding
      .contained, "the office count wayfinding clipped or overflowed its supported viewport");
  require(result.layout.brokenImages.length ===
    0, "one or more images are broken");
  require(!result.layout
    .frameworkErrorOverlay, "a framework error overlay is visible");
  require(result.workflow.zones.meeting.exists &&
    result.workflow.zones.meeting.title === "Meeting area" &&
    result.workflow.zones.meeting.purpose ===
      "Current Attention · needs reply" &&
    result.workflow.zones.meeting.assignedCount === "1" &&
    result.workflow.zones.meeting.withinRoom &&
    result.workflow.zones.review.exists &&
    result.workflow.zones.review.title === "Review area" &&
    result.workflow.zones.review.purpose ===
      "Current Attention · exact result to review" &&
    result.workflow.zones.review.assignedCount === "1" &&
    result.workflow.zones.review
      .withinRoom, "named workflow areas were missing, miscounted, or outside the uniformly scaled room");
  require(workflowMatches(
    result.workflow,
    PRIMARY_WORKFLOW_ASSIGNMENTS,
  ), "Current Attention did not produce the exact settled meeting, review, and desk assignments");
  require(result.workflow.workspaceWriteCount === 0 &&
    result.workflow.codexMutationCount ===
      0, "initial workflow wayfinding wrote the workspace or sent a Codex mutation");
  const transitionCue = result.transitionCue;
  require(transitionCue.baselineSilent &&
    transitionCue.baselineWorkspaceWriteCount === 0 &&
    transitionCue.baselineCodexMutationCount ===
      0, "the first authoritative Attention backlog produced a cue or a side effect instead of becoming a silent session baseline");
  require(transitionCue.focusNotStolen &&
    transitionCue.closeRestoredFocus, "the in-app Attention cue stole focus on arrival or failed to return focus to the Coffice brand when closed");
  require(transitionCue.initial.count === 1 &&
    transitionCue.initial.text.includes("New Attention") &&
    transitionCue.initial.text.includes("Needs your reply") &&
    transitionCue.initial.text.includes("Acceptance Agent 03") &&
    transitionCue.initial.text.includes("Acceptance Office") &&
    transitionCue.initial.text.includes("1 more new action") &&
    transitionCue.initial.text.includes("Open task") &&
    !transitionCue.initial.text.includes(
      "Codex is waiting for your response",
    ) &&
    !transitionCue.initial.text.includes(
      "Open the task and respond",
    ), "the in-app Attention cue did not show one safe canonical transition with its bounded batch count");
  require(transitionCue.initial.regionRole === "region" &&
    transitionCue.initial.live === "polite" &&
    transitionCue.initial.atomic === "true" &&
    transitionCue.initial.announcement.includes("Needs your reply") &&
    transitionCue.initial.announcement.includes(
      "Acceptance Agent 03",
    ), "the in-app Attention cue did not expose an atomic polite status announcement and labelled region");
  require(transitionCue.initial.inFlow &&
    transitionCue.initial.belowHeader &&
    transitionCue.initial.withinViewport &&
    transitionCue.initial.noHorizontalOverflow &&
    transitionCue.initial.primaryHeight >= 43.5 &&
    transitionCue.initial.closeWidth >= 43.5 &&
    transitionCue.initial.closeHeight >= 43.5 &&
    transitionCue.initial.primaryFontSize >= 14 &&
    transitionCue.initial.identityFontSize >= 14 &&
    transitionCue.initial
      .motionless, "the in-flow Attention cue escaped the viewport, overlapped the header, used undersized controls or copy, or added motion");
  require(transitionCue.firstBatchEventKeys.length === 2 &&
    transitionCue.firstItemStable &&
    transitionCue.suppressedByModal &&
    transitionCue.modalResumeStayedSilent &&
    transitionCue.closeHadNoWrites &&
    transitionCue.oldBatchDidNotCascade, "the in-app cue did not preserve one stable batch, suppress itself for a modal, or consume the batch without side effects");
  require(transitionCue.holdingCopy.includes("Needs your reply") &&
    transitionCue.holdingCopy.includes("Holding Agent 01") &&
    transitionCue.holdingCopy.includes("Holding area") &&
    transitionCue.holdingCopy.includes("Open task") &&
    transitionCue.exactHoldingRoute &&
    transitionCue.cueSuppressedByInspector, "the new holding-area cue did not use safe copy, route to its exact task, or yield to the inspector modal");
  require(transitionCue.holdingTriggerAfterSeen.label ===
    "Attention for Unassigned Sessions, 1 action, 1 reply needed, 0 decisions needed, 0 unread results" &&
    countAttributesMatch(transitionCue.holdingTriggerAfterSeen, 1, 1, 0) &&
    transitionCue.holdingTriggerAfterSeen.badge ===
      "1 1 reply needed", "opening and marking the exact holding reply seen incorrectly decremented its reply count");
  require(transitionCue.verificationCopy.includes("Quality check failed") &&
    transitionCue.verificationCopy.includes("Acceptance Agent 04") &&
    transitionCue.verificationCopy.includes("Acceptance Office") &&
    transitionCue.verificationCopy.includes("Open stored result") &&
    transitionCue.exactStoredResultRoute, "the failed-quality-check cue did not route to its exact stored result and receipt");
  require(transitionCue.cueWorkspaceWriteCount === 2 &&
    transitionCue.attentionSeenWriteCount === 2 &&
    JSON.stringify(transitionCue.seenAttentionEventKeys) ===
      JSON.stringify(transitionCue.expectedSeenEventKeys) &&
    transitionCue.codexMutationCount ===
      0, "opening two transition cues did not write exactly their two seen receipts, or it called a Codex action route");
  require(result.drawer.opened &&
    result.drawer.closed, "project drawer did not open and close");
  require(result.drawer.currentProjectCount ===
    1, "project drawer lost current-project state");
  require(result.drawer.projectCount ===
    3, "project drawer did not expose both projects and the holding area");
  require(result.drawer.searchVisible, "project drawer search is missing");
  require(result.drawer.modal, "project drawer is not an accessible modal");
  require(result.drawer
    .initialFocusOnSearch, "project drawer did not focus search on open");
  require(result.drawer
    .shellInert, "project drawer did not make the application inert");
  require(result.drawer.focusWrapped, "project drawer focus trap did not wrap");
  require(result.drawer
    .focusRestored, "project drawer did not restore trigger focus");
  require(result.drawer.noWorkspaceWrites &&
    result.drawer.noCodexMutations &&
    result.drawer.countContainment.rowCount === 3 &&
    result.drawer.countContainment.panelWithinViewport &&
    result.drawer.countContainment
      .noHorizontalOverflow, "the project count drawer overflowed or caused a workspace or Codex action write");
  require(projectCountIs(
    result.drawer.projectRows,
    PRIMARY_PROJECT_ID,
    PRIMARY_ATTENTION_COUNT,
    PRIMARY_NEEDS_REPLY_COUNT,
    PRIMARY_UNREAD_RESULT_COUNT,
  ) &&
    projectCountIs(
      result.drawer.projectRows,
      SECONDARY_PROJECT_ID,
      SECONDARY_ATTENTION_COUNT,
      SECONDARY_NEEDS_REPLY_COUNT,
      SECONDARY_UNREAD_RESULT_COUNT,
    ) &&
    projectCountIs(
      result.drawer.projectRows,
      HOLDING_PROJECT_ID,
      HOLDING_ATTENTION_COUNT,
      HOLDING_NEEDS_REPLY_COUNT,
      HOLDING_UNREAD_RESULT_COUNT,
    ), "project drawer action counts do not match the canonical project scopes");
  require(result.review.itemCount ===
    PRIMARY_ATTENTION_COUNT, "Acceptance Attention did not contain exactly four actions");
  require(result.review.initialTrigger.label ===
    `Attention for Acceptance Office, ${PRIMARY_ATTENTION_COUNT} actions, ${PRIMARY_NEEDS_REPLY_COUNT} reply needed, 0 decisions needed, ${PRIMARY_UNREAD_RESULT_COUNT} unread result` &&
    result.review.initialTrigger.projectId === PRIMARY_PROJECT_ID &&
    countAttributesMatch(
      result.review.initialTrigger,
      PRIMARY_ATTENTION_COUNT,
      PRIMARY_NEEDS_REPLY_COUNT,
      PRIMARY_UNREAD_RESULT_COUNT,
    ) &&
    result.review.initialTrigger.badge ===
      `${PRIMARY_ATTENTION_COUNT} ${PRIMARY_NEEDS_REPLY_COUNT} reply needed ${PRIMARY_UNREAD_RESULT_COUNT} unread`, "Acceptance Attention trigger and badges did not expose the scoped total, reply, decision, and unread counts");
  require(result.review.scopeProjectId === PRIMARY_PROJECT_ID &&
    result.review.scopeHeadingCount === 1 &&
    result.review.scopeIntroCount === 1 &&
    result.review.secondaryItemCount === 0 &&
    result.review.itemTexts.every(
      (item) => !/Secondary (?:Agent|Office)/u.test(item),
    ), "Acceptance Attention admitted a Secondary action");
  require(attentionPanelIsContained(
    result.review.initialContainment,
  ), "Acceptance Attention escaped the viewport or overflowed horizontally");
  require(result.review
    .inboxModal, "attention inbox is not an accessible modal dialog");
  require(result.review
    .initialFocusOnItem, "attention inbox initial focus is not actionable");
  require(result.review
    .shellInert, "attention inbox did not make the application inert");
  require(result.review
    .inboxFocusWrapped, "attention inbox focus trap did not wrap");
  require(result.review
    .inboxFocusRestored, "attention inbox did not restore trigger focus");
  require(result.review
    .inspectorModal, "Review & Act is not an accessible modal dialog");
  require(result.review
    .inspectorInitialFocus, "Review & Act initial focus is incorrect");
  require(result.review
    .codexLinkIsTaskDeepLink, "Review & Act lacks a task deep link");
  require(result.review
    .inspectorFocusWrapped, "Review & Act focus trap did not wrap");
  const reviewDecisions = result.review.projectDecisions;
  require(!reviewDecisions.collapsed.open &&
    !reviewDecisions.collapsed.bodyVisible &&
    reviewDecisions.keyboardFocusBeforeOpen &&
    reviewDecisions.expanded.open &&
    reviewDecisions.expanded.summaryFocused &&
    reviewDecisions.closedByKeyboard, "current project decisions were not collapsed by default or keyboard-operable without losing focus");
  require(reviewDecisions.expanded.projectId === PRIMARY_PROJECT_ID &&
    reviewDecisions.expanded.ariaLabel ===
      "2 current project decisions for Acceptance Office" &&
    reviewDecisions.expanded.currentCount === 2 &&
    JSON.stringify(reviewDecisions.expanded.ids) ===
      JSON.stringify([REVIEW_DECISION_SECOND_ID, REVIEW_DECISION_CURRENT_ID]) &&
    reviewDecisions.expanded.longStatementPresent &&
    reviewDecisions.expanded.plainContextPresent &&
    reviewDecisions.expanded.secondStatementPresent &&
    reviewDecisions.expanded.supersededAbsent &&
    reviewDecisions.expanded.withdrawnAbsent &&
    reviewDecisions.expanded
      .markupNotInterpreted, "Review & Act did not show only the two active heads from the exact source project as plain text and newest first");
  require(reviewDecisions.expanded.withinInspector &&
    reviewDecisions.expanded.withinViewport &&
    reviewDecisions.expanded
      .noHorizontalOverflow, "current project decisions or their long unbroken text escaped Review & Act or the viewport");
  require(reviewDecisions.noWorkspaceWrites &&
    reviewDecisions.noCodexMutations, "viewing current project decisions wrote the workspace or called a Codex action route");
  require(result.review.assessment.scopeLabels.includes("Exact result") &&
    result.review.assessment.scopeLabels.includes(
      "Work item",
    ), "Review & Act did not expose both exact-result and work-item scopes");
  require(result.review.definitionOfDone?.sectionCount === 1 &&
    result.review.definitionOfDone?.exactCount &&
    result.review.definitionOfDone?.currentCriteriaVisible &&
    result.review.definitionOfDone?.exactOrder &&
    result.review.definitionOfDone?.noEditOrCheckControls &&
    result.review.definitionOfDone
      ?.advisoryExact, "Review & Act did not show the current advisory Definition of Done distinctly from historical result evidence");
  require(result.review.workItemRelationships?.sectionCount === 1 &&
    result.review.workItemRelationships?.exactCount &&
    result.review.workItemRelationships?.exactSourceLink &&
    result.review.workItemRelationships?.noEditOrCheckControls &&
    result.review.workItemRelationships
      ?.advisoryExact, "Review & Act did not show the exact source work item's current advisory links read-only");
  require(result.review.projectContextReview?.sectionCount === 1 &&
    result.review.projectContextReview?.exactConcern &&
    result.review.projectContextReview?.exactNote &&
    result.review.projectContextReview?.advisoryExact &&
    result.review.projectContextReview
      ?.noControls, "Review & Act did not show the exact source project's user-declared context concern read-only");
  require(result.review.assessment.recordedLabels.includes("You recorded") &&
    result.review.assessment.recordedLabels.includes(
      "Nothing recorded",
    ), "Review & Act did not distinguish recorded and empty assessment states");
  require(!result.review.assessment.exactRest.formVisible &&
    !result.review.assessment.workRest.formVisible &&
    result.review.assessment.exactRest.savedDetailsCount === 1 &&
    !result.review.assessment.exactRest.savedDetailsOpen &&
    result.review.assessment.workRest.savedDetailsCount === 0 &&
    result.review.assessment.exactRest.noHorizontalOverflow &&
    result.review.assessment.workRest
      .noHorizontalOverflow, "Review & Act assessment cards were not compact and contained at rest");
  require(result.review.assessment.workEditor.formVisible &&
    result.review.assessment.workEditor.noHorizontalOverflow &&
    result.review.assessment.workEditor.withinViewportWidth &&
    result.review.assessment
      .editorExpanded, "Review & Act assessment editor did not expand or contain its controls");
  require(result.review.assessment
    .editorFocusReached, "Review & Act assessment editor controls were not keyboard focusable");
  require(result.review.assessment.workSaved.state ===
    "You recorded", "Review & Act did not render the saved user-authored assessment");
  require(result.review.assessment.workSaved.savedDetailsCount === 1 &&
    !result.review.assessment.workSaved.savedDetailsOpen &&
    result.review.assessment.exactDisclosureKeyboardReachable &&
    result.review.assessment
      .exactDisclosureOpened, "saved assessment details were not closed by default and keyboard reachable");
  require(result.review.assessment
    .exactAdvisoryWording, "Review & Act omitted advisory next-action wording or its note");
  require(result.review.assessment.selfCritiqueCount ===
    1, "Review & Act did not report absent agent self-critique exactly once");
  require(result.review.assessment.initialEditorFocus &&
    result.review.assessment.editorFocusReached &&
    result.review.assessment
      .saveFocusHandoff, "Review & Act assessment editor focus handoffs were incomplete");
  require(result.review.assessment.acceptanceWarningText.includes(
    "2 unresolved review notes remain across the exact result and work item.",
  ) &&
    result.review.assessment.acceptanceWarningText.includes(
      "1 saved advisory next action does not recommend acceptance.",
    ) &&
    result.review.assessment.acceptanceWarningText.includes(
      "Accepting keeps these annotations and does not perform or clear any advisory action.",
    ), "acceptance confirmation omitted its assessment advisory warning");
  require(result.review.assessment.acceptanceWarningFocus &&
    result.review.assessment.acceptanceDefinitionAdvisoryExact &&
    result.review.assessment.acceptanceConfirmEnabled &&
    result.review.assessment.acceptanceWarningDescribedBy?.includes(
      "accept-definition-of-done-advisory",
    ) &&
    result.review.assessment.acceptanceWarningDescribedBy?.includes(
      "accept-assessment-warning",
    ), "acceptance warnings were not associated with the enabled focused confirmation action");
  require(result.review.lifecycle
    .initialCompletionVisible, "the synthetic completion was not initially visible in Attention");
  require(result.review.lifecycle.seenReceiptPersisted &&
    result.review.lifecycle.seenEventKeyMatchesInitial &&
    result.review.lifecycle.workspaceWriteCountAfterSeen === 1 &&
    result.review.lifecycle.attentionFailureCountAfterSeen === 0 &&
    result.review.lifecycle.attentionSeenWriteCount === 1 &&
    result.review.lifecycle.seenAttentionEventKeys.length ===
      1, "opening the scoped result did not persist exactly one needs-review receipt for its exact event key");
  require(result.review.lifecycle.triggerAfterSeen.label ===
    `Attention for Acceptance Office, ${PRIMARY_ATTENTION_COUNT} actions, ${PRIMARY_NEEDS_REPLY_COUNT} reply needed, 0 decisions needed, 0 unread results` &&
    countAttributesMatch(
      result.review.lifecycle.triggerAfterSeen,
      PRIMARY_ATTENTION_COUNT,
      PRIMARY_NEEDS_REPLY_COUNT,
      0,
    ) &&
    result.review.lifecycle.triggerAfterSeen.badge ===
      `${PRIMARY_ATTENTION_COUNT} ${PRIMARY_NEEDS_REPLY_COUNT} reply needed` &&
    result.review.lifecycle.triggerAfterSeenNavigation.label ===
      `Attention for Acceptance Office, ${PRIMARY_ATTENTION_COUNT} actions, ${PRIMARY_NEEDS_REPLY_COUNT} reply needed, 0 decisions needed, 0 unread results` &&
    countAttributesMatch(
      result.review.lifecycle.triggerAfterSeenNavigation,
      PRIMARY_ATTENTION_COUNT,
      PRIMARY_NEEDS_REPLY_COUNT,
      0,
    ) &&
    result.review.lifecycle.itemCountAfterSeen === PRIMARY_ATTENTION_COUNT &&
    result.review.lifecycle.secondaryCountAfterSeen ===
      0, "marking the scoped result seen changed the Acceptance total or admitted a foreign action");
  require(projectCountIs(
    result.review.lifecycle.drawerAfterSeen.projectRows,
    PRIMARY_PROJECT_ID,
    PRIMARY_ATTENTION_COUNT,
    PRIMARY_NEEDS_REPLY_COUNT,
    0,
  ) &&
    projectCountIs(
      result.review.lifecycle.drawerAfterSeen.projectRows,
      SECONDARY_PROJECT_ID,
      SECONDARY_ATTENTION_COUNT,
      SECONDARY_NEEDS_REPLY_COUNT,
      SECONDARY_UNREAD_RESULT_COUNT,
    ) &&
    projectCountIs(
      result.review.lifecycle.drawerAfterSeen.projectRows,
      HOLDING_PROJECT_ID,
      HOLDING_ATTENTION_COUNT,
      HOLDING_NEEDS_REPLY_COUNT,
      HOLDING_UNREAD_RESULT_COUNT,
    ), "marking the scoped result seen changed a project drawer total");
  const digestAfterSeen = result.review.lifecycle.digestAfterSeen;
  const primaryDigestAfterSeen = digestAfterSeen.projectGroups.find((group) =>
    group.heading?.startsWith("Acceptance Office"),
  );
  const secondaryDigestAfterSeen = digestAfterSeen.projectGroups.find((group) =>
    group.heading?.startsWith("Secondary Office"),
  );
  require(digestAfterSeen.opened &&
    digestAfterSeen.closed &&
    digestAfterSeen.triggerLabel ===
      `Open digest, ${GLOBAL_ATTENTION_COUNT} actions, ${GLOBAL_NEEDS_REPLY_COUNT} reply needed, 0 decisions needed, 1 unread result` &&
    countAttributesMatch(
      digestAfterSeen.triggerCounts,
      GLOBAL_ATTENTION_COUNT,
      GLOBAL_NEEDS_REPLY_COUNT,
      1,
    ) &&
    digestAfterSeen.triggerCounts.text ===
      `Digest ${GLOBAL_ATTENTION_COUNT} actions ${GLOBAL_NEEDS_REPLY_COUNT} reply needed 1 unread` &&
    digestAfterSeen.summaryParts.includes("1 reply needed") &&
    digestAfterSeen.summaryParts.includes("1 unread result") &&
    digestAfterSeen.summaryParts.includes("3 other actions") &&
    digestAfterSeen.projectGroups.length === 2 &&
    primaryDigestAfterSeen?.itemCount === PRIMARY_ATTENTION_COUNT &&
    primaryDigestAfterSeen?.countSummary === "1 reply · 3 other actions" &&
    secondaryDigestAfterSeen?.itemCount === SECONDARY_ATTENTION_COUNT &&
    secondaryDigestAfterSeen?.countSummary === "1 unread result" &&
    projectCountIs(
      digestAfterSeen.projectCards,
      PRIMARY_PROJECT_ID,
      PRIMARY_ATTENTION_COUNT,
      PRIMARY_NEEDS_REPLY_COUNT,
      0,
    ) &&
    projectCountIs(
      digestAfterSeen.projectCards,
      SECONDARY_PROJECT_ID,
      SECONDARY_ATTENTION_COUNT,
      SECONDARY_NEEDS_REPLY_COUNT,
      SECONDARY_UNREAD_RESULT_COUNT,
    ) &&
    projectCountIs(
      digestAfterSeen.projectCards,
      HOLDING_PROJECT_ID,
      HOLDING_ATTENTION_COUNT,
      HOLDING_NEEDS_REPLY_COUNT,
      HOLDING_UNREAD_RESULT_COUNT,
    ) &&
    digestAfterSeen.noWorkspaceWrites &&
    digestAfterSeen.noCodexMutations &&
    digestAfterSeen.countContainment.controlCount === 4 &&
    digestAfterSeen.countContainment.noHorizontalOverflow &&
    result.review.lifecycle.drawerAfterSeen.noWorkspaceWrites &&
    result.review.lifecycle.drawerAfterSeen.noCodexMutations &&
    result.review.lifecycle.drawerAfterSeen.countContainment.rowCount === 3 &&
    result.review.lifecycle.drawerAfterSeen.countContainment
      .noHorizontalOverflow, "marking the scoped result seen did not move one unread result to other actions while preserving all totals, or reading the counts caused side effects");
  require(result.review.lifecycle
    .resultReviewPersisted, "marking reviewed did not persist the exact result review");
  require(result.review.lifecycle.resultReviewWriteCount ===
    1, "the lifecycle check did not write exactly one durable result review");
  require(result.review.lifecycle.attentionEventFailureCount === 1 &&
    result.review.lifecycle.attentionEventFailureRecorded &&
    result.review.lifecycle
      .reviewedAttentionArrivedAfterResultReview, "the lifecycle check did not exercise the deliberate reviewed Attention-receipt failure after the durable result review");
  require(result.review.lifecycle
    .seenReceiptPreservedAfterReviewFailure, "the failed reviewed receipt did not preserve the earlier needs-review disposition");
  require(result.review.lifecycle.durableResolutionStatusText ===
    "Reviewed in Plan. This completion no longer needs Attention.", "Review & Act did not explain that durable review remains authoritative");
  require(workflowMatches(result.review.lifecycle.workflowAfterResolution, {
    ...PRIMARY_WORKFLOW_ASSIGNMENTS,
    [REVIEW_TASK_TITLE]: "desk",
  }) &&
    result.review.lifecycle.workflowAfterResolution.zones.review
      .assignedCount === "0" &&
    result.review.lifecycle.workflowAfterResolution.zones.meeting
      .assignedCount === "1" &&
    result.review.lifecycle.deskReturnAddedNoWorkspaceWrites &&
    result.review.lifecycle
      .deskReturnAddedNoCodexMutations, "review resolution did not settle the exact actor back at its owned desk without side effects");
  require(result.review.lifecycle.reviewedCompletionCount === 0 &&
    result.review.lifecycle.itemCountAfterResolution ===
      result.review.itemCount -
        1, "the reviewed completion remained in Attention after its separate receipt failed");
  require(result.review.lifecycle.triggerAfterResolution.label ===
    `Attention for Acceptance Office, ${PRIMARY_ATTENTION_COUNT - 1} actions, ${PRIMARY_NEEDS_REPLY_COUNT} reply needed, 0 decisions needed, 0 unread results` &&
    countAttributesMatch(
      result.review.lifecycle.triggerAfterResolution,
      PRIMARY_ATTENTION_COUNT - 1,
      PRIMARY_NEEDS_REPLY_COUNT,
      0,
    ) &&
    result.review.lifecycle.triggerAfterResolution.badge ===
      `${PRIMARY_ATTENTION_COUNT - 1} ${PRIMARY_NEEDS_REPLY_COUNT} reply needed` &&
    result.review.lifecycle.scopeAfterResolution === PRIMARY_PROJECT_ID &&
    result.review.lifecycle.secondaryCountAfterResolution === 0 &&
    attentionPanelIsContained(
      result.review.lifecycle.containmentAfterResolution,
    ), "reviewing the result did not update and contain the Acceptance-scoped Attention surfaces");
  require(projectCountIs(
    result.review.lifecycle.drawerAfterResolution.projectRows,
    PRIMARY_PROJECT_ID,
    PRIMARY_ATTENTION_COUNT - 1,
    PRIMARY_NEEDS_REPLY_COUNT,
    0,
  ) &&
    projectCountIs(
      result.review.lifecycle.drawerAfterResolution.projectRows,
      SECONDARY_PROJECT_ID,
      SECONDARY_ATTENTION_COUNT,
      SECONDARY_NEEDS_REPLY_COUNT,
      SECONDARY_UNREAD_RESULT_COUNT,
    ) &&
    projectCountIs(
      result.review.lifecycle.drawerAfterResolution.projectRows,
      HOLDING_PROJECT_ID,
      HOLDING_ATTENTION_COUNT,
      HOLDING_NEEDS_REPLY_COUNT,
      HOLDING_UNREAD_RESULT_COUNT,
    ) &&
    result.review.lifecycle.drawerAfterResolution.noWorkspaceWrites &&
    result.review.lifecycle.drawerAfterResolution.noCodexMutations &&
    result.review.lifecycle.drawerAfterResolution.countContainment.rowCount ===
      3 &&
    result.review.lifecycle.drawerAfterResolution.countContainment
      .noHorizontalOverflow, "reviewing the result did not update the drawer without changing other project scopes, or reading it caused side effects");
  const digestAfterResolution = result.review.lifecycle.digestAfterResolution;
  const primaryDigestAfterResolution = digestAfterResolution.projectGroups.find(
    (group) => group.heading?.startsWith("Acceptance Office"),
  );
  const secondaryDigestAfterResolution =
    digestAfterResolution.projectGroups.find((group) =>
      group.heading?.startsWith("Secondary Office"),
    );
  require(digestAfterResolution.triggerLabel ===
    `Open digest, ${GLOBAL_ATTENTION_COUNT - 1} actions, ${GLOBAL_NEEDS_REPLY_COUNT} reply needed, 0 decisions needed, 1 unread result` &&
    countAttributesMatch(
      digestAfterResolution.triggerCounts,
      GLOBAL_ATTENTION_COUNT - 1,
      GLOBAL_NEEDS_REPLY_COUNT,
      1,
    ) &&
    digestAfterResolution.triggerCounts.text ===
      `Digest ${GLOBAL_ATTENTION_COUNT - 1} actions ${GLOBAL_NEEDS_REPLY_COUNT} reply needed 1 unread` &&
    digestAfterResolution.summaryParts.includes("1 reply needed") &&
    digestAfterResolution.summaryParts.includes("1 unread result") &&
    digestAfterResolution.summaryParts.includes("2 other actions") &&
    primaryDigestAfterResolution?.itemCount === PRIMARY_ATTENTION_COUNT - 1 &&
    primaryDigestAfterResolution?.countSummary ===
      "1 reply · 2 other actions" &&
    secondaryDigestAfterResolution?.itemCount === SECONDARY_ATTENTION_COUNT &&
    secondaryDigestAfterResolution?.countSummary === "1 unread result" &&
    projectCountIs(
      digestAfterResolution.projectCards,
      PRIMARY_PROJECT_ID,
      PRIMARY_ATTENTION_COUNT - 1,
      PRIMARY_NEEDS_REPLY_COUNT,
      0,
    ) &&
    projectCountIs(
      digestAfterResolution.projectCards,
      SECONDARY_PROJECT_ID,
      SECONDARY_ATTENTION_COUNT,
      SECONDARY_NEEDS_REPLY_COUNT,
      SECONDARY_UNREAD_RESULT_COUNT,
    ) &&
    projectCountIs(
      digestAfterResolution.projectCards,
      HOLDING_PROJECT_ID,
      HOLDING_ATTENTION_COUNT,
      HOLDING_NEEDS_REPLY_COUNT,
      HOLDING_UNREAD_RESULT_COUNT,
    ) &&
    digestAfterResolution.noWorkspaceWrites &&
    digestAfterResolution.noCodexMutations &&
    digestAfterResolution.countContainment.controlCount === 4 &&
    digestAfterResolution.countContainment
      .noHorizontalOverflow, "reviewing the result did not update the campus and global digest consistently, or reading the counts caused side effects");
  require(result.review.lifecycle.laterResultIsDistinct &&
    result.review.lifecycle.laterResultPersisted &&
    result.review.lifecycle.resultObservationWriteCount === 1 &&
    result.review.lifecycle.laterResultRemainsUnreviewed &&
    result.review.lifecycle.laterCompletionCount ===
      1, "a later distinct result did not surface as a new Attention item");
  require(workflowMatches(
    result.review.lifecycle.workflowAfterLaterResult,
    PRIMARY_WORKFLOW_ASSIGNMENTS,
  ) &&
    result.review.lifecycle.workflowAfterLaterResult.zones.review
      .assignedCount === "1" &&
    result.review.lifecycle.laterReviewPlacementAddedNoWorkspaceWrites &&
    result.review.lifecycle
      .laterReviewPlacementAddedNoCodexMutations, "a later exact result did not restore review-area wayfinding without side effects");
  require(result.review.lifecycle.triggerAfterLaterResult.label ===
    `Attention for Acceptance Office, ${PRIMARY_ATTENTION_COUNT} actions, ${PRIMARY_NEEDS_REPLY_COUNT} reply needed, 0 decisions needed, ${PRIMARY_UNREAD_RESULT_COUNT} unread result` &&
    countAttributesMatch(
      result.review.lifecycle.triggerAfterLaterResult,
      PRIMARY_ATTENTION_COUNT,
      PRIMARY_NEEDS_REPLY_COUNT,
      PRIMARY_UNREAD_RESULT_COUNT,
    ) &&
    result.review.lifecycle.triggerAfterLaterResult.badge ===
      `${PRIMARY_ATTENTION_COUNT} ${PRIMARY_NEEDS_REPLY_COUNT} reply needed ${PRIMARY_UNREAD_RESULT_COUNT} unread` &&
    result.review.lifecycle.scopeAfterLaterResult === PRIMARY_PROJECT_ID &&
    result.review.lifecycle.secondaryCountAfterLaterResult === 0 &&
    attentionPanelIsContained(
      result.review.lifecycle.containmentAfterLaterResult,
    ) &&
    projectCountIs(
      result.review.lifecycle.drawerAfterLaterResult.projectRows,
      PRIMARY_PROJECT_ID,
      PRIMARY_ATTENTION_COUNT,
      PRIMARY_NEEDS_REPLY_COUNT,
      PRIMARY_UNREAD_RESULT_COUNT,
    ) &&
    projectCountIs(
      result.review.lifecycle.drawerAfterLaterResult.projectRows,
      SECONDARY_PROJECT_ID,
      SECONDARY_ATTENTION_COUNT,
      SECONDARY_NEEDS_REPLY_COUNT,
      SECONDARY_UNREAD_RESULT_COUNT,
    ) &&
    projectCountIs(
      result.review.lifecycle.drawerAfterLaterResult.projectRows,
      HOLDING_PROJECT_ID,
      HOLDING_ATTENTION_COUNT,
      HOLDING_NEEDS_REPLY_COUNT,
      HOLDING_UNREAD_RESULT_COUNT,
    ) &&
    result.review.lifecycle.drawerAfterLaterResult.noWorkspaceWrites &&
    result.review.lifecycle.drawerAfterLaterResult.noCodexMutations &&
    result.review.lifecycle.drawerAfterLaterResult.countContainment.rowCount ===
      3 &&
    result.review.lifecycle.drawerAfterLaterResult.countContainment
      .noHorizontalOverflow, "the later result did not reopen only the Acceptance scope, or count inspection caused side effects");
  require(result.review
    .inspectorClosed, "Review & Act did not close with Escape");
  require(result.review
    .inspectorFocusRestored, "Review & Act did not restore focus");
  require(result.review.workspaceWriteCount === 4 &&
    result.review.lifecycle.assessmentWriteCount ===
      1, "synthetic seen, assessment, result-review, and result-observation saves did not stay within the mocked workspace route");
  require(result.plan.modal, "Plan is not an accessible modal dialog");
  const decisions = result.plan.decisions;
  require(decisions.placement.afterObjectiveBeforeMilestones &&
    decisions.initial.sectionCount === 1 &&
    decisions.initial.eyebrowCount === 1 &&
    decisions.initial.headingCount === 1 &&
    decisions.initial.noCurrentCount === 1 &&
    decisions.initial.emptyHeadingCount === 1 &&
    decisions.initial.helperCount === 1 &&
    decisions.initial.eventCount ===
      0, "the empty project decision log was missing, duplicated, or misplaced in Plan");
  require(decisions.initialEditorFocus &&
    decisions.editorEscapeFocusRestored &&
    decisions.emptyAfterEditorEscape &&
    decisions.recorded.statusFocused &&
    decisions.correction.initialFocus &&
    decisions.correction.cancelFocusRestored &&
    decisions.replacement.initialFocus &&
    decisions.withdrawal.initialFocus &&
    decisions.withdrawal.keepFocusRestored &&
    decisions.withdrawal.statusFocused &&
    decisions.closeFocusRestored, "project decision editors did not preserve autofocus, Escape, cancel, status, and modal focus handoffs");
  require(decisions.recorded.currentCount === 1 &&
    decisions.recorded.headingCount === 1 &&
    decisions.recorded.contextCount === 1 &&
    decisions.correction.prefilledStatement === INITIAL_PROJECT_DECISION &&
    decisions.correction.prefilledContext ===
      INITIAL_PROJECT_DECISION_CONTEXT &&
    decisions.correction.eventCountAfterCancel === 1 &&
    decisions.replacement.initialStatement === "" &&
    decisions.replacement.initialContext === "" &&
    decisions.withdrawal.confirmationCount === 1 &&
    decisions.withdrawal.noticeCount === 1 &&
    decisions.withdrawal.eventCountAfterKeep ===
      3, "record, correction, replacement, or withdrawal did not expose its intended explicit editing semantics");
  const expectedCorrectionHistory = [
    {
      action: "superseded",
      label: "Corrected previous wording",
      statement: CORRECTED_PROJECT_DECISION,
      detail: INITIAL_PROJECT_DECISION_CONTEXT,
    },
    {
      action: "recorded",
      label: "Decision recorded",
      statement: INITIAL_PROJECT_DECISION,
      detail: INITIAL_PROJECT_DECISION_CONTEXT,
    },
  ];
  const expectedReplacementHistory = [
    {
      action: "superseded",
      label: "Replaced previous decision",
      statement: REPLACEMENT_PROJECT_DECISION,
      detail: REPLACEMENT_PROJECT_DECISION_CONTEXT,
    },
    ...expectedCorrectionHistory,
  ];
  const expectedWithdrawnHistory = [
    {
      action: "withdrawn",
      label: "Withdrawn without replacement",
      statement: REPLACEMENT_PROJECT_DECISION,
      detail: `Reason: ${PROJECT_DECISION_WITHDRAWAL_REASON}`,
    },
    ...expectedReplacementHistory,
  ];
  const historyWithoutTimestamps = (history) =>
    history.map(({ action, label, statement, detail }) => ({
      action,
      label,
      statement,
      detail,
    }));
  require(JSON.stringify(
    historyWithoutTimestamps(decisions.correction.history),
  ) === JSON.stringify(expectedCorrectionHistory) &&
    JSON.stringify(historyWithoutTimestamps(decisions.replacement.history)) ===
      JSON.stringify(expectedReplacementHistory) &&
    JSON.stringify(historyWithoutTimestamps(decisions.withdrawal.history)) ===
      JSON.stringify(expectedWithdrawnHistory) &&
    decisions.withdrawal.history.every((event) =>
      Number.isFinite(Date.parse(event.timestamp)),
    ) &&
    decisions.withdrawal.immutableHistory &&
    decisions.withdrawal.currentCount === 0 &&
    decisions.withdrawal.emptyInEffectCount ===
      1, "project decision history was not immutable, complete, and newest-first after withdrawal");
  const decisionEvents = decisions.persistedBeforeReopen;
  const decisionRequests = decisions.requests.map(
    (request) => request.mutation,
  );
  const decisionIds = decisionEvents.map((event) => event.id);
  require(decisions.writeCount === 4 &&
    decisionEvents.length === 4 &&
    new Set(decisionIds).size === 4 &&
    decisionEvents.every(
      (event) =>
        event.projectId === PRIMARY_PROJECT_ID &&
        event.authorship === "user" &&
        Number.isFinite(Date.parse(event.recordedAt)),
    ) &&
    decisionEvents.every(
      (event, index) =>
        index === 0 ||
        Date.parse(event.recordedAt) >=
          Date.parse(decisionEvents[index - 1].recordedAt),
    ) &&
    decisionEvents[0]?.action === "recorded" &&
    decisionEvents[0]?.statement === INITIAL_PROJECT_DECISION &&
    decisionEvents[0]?.context === INITIAL_PROJECT_DECISION_CONTEXT &&
    decisionEvents[1]?.action === "superseded" &&
    decisionEvents[1]?.supersedesId === decisionEvents[0]?.id &&
    decisionEvents[1]?.supersessionKind === "correction" &&
    decisionEvents[1]?.statement === CORRECTED_PROJECT_DECISION &&
    decisionEvents[1]?.context === INITIAL_PROJECT_DECISION_CONTEXT &&
    decisionEvents[2]?.action === "superseded" &&
    decisionEvents[2]?.supersedesId === decisionEvents[1]?.id &&
    decisionEvents[2]?.supersessionKind === "replacement" &&
    decisionEvents[2]?.statement === REPLACEMENT_PROJECT_DECISION &&
    decisionEvents[2]?.context === REPLACEMENT_PROJECT_DECISION_CONTEXT &&
    decisionEvents[3]?.action === "withdrawn" &&
    decisionEvents[3]?.supersedesId === decisionEvents[2]?.id &&
    decisionEvents[3]?.reason ===
      PROJECT_DECISION_WITHDRAWAL_REASON, "the mocked workspace did not persist the exact four-event decision lineage");
  require(decisions.requests.length === 4 &&
    decisions.requests.every(
      (request, index) =>
        request.expectedRevision === request.acceptedRevision &&
        (index === 0 ||
          request.acceptedRevision ===
            decisions.requests[index - 1].acceptedRevision + 1) &&
        typeof request.mutationId === "string" &&
        request.mutationId.length > 0 &&
        request.mutation.id === decisionEvents[index]?.id &&
        !Object.hasOwn(request.mutation, "recordedAt") &&
        !Object.hasOwn(request.mutation, "authorship"),
    ) &&
    decisionRequests[0]?.type === "projectDecision.record" &&
    decisionRequests[1]?.type === "projectDecision.supersede" &&
    decisionRequests[1]?.supersessionKind === "correction" &&
    decisionRequests[1]?.supersedesId === decisionRequests[0]?.id &&
    decisionRequests[2]?.type === "projectDecision.supersede" &&
    decisionRequests[2]?.supersessionKind === "replacement" &&
    decisionRequests[2]?.supersedesId === decisionRequests[1]?.id &&
    decisionRequests[3]?.type === "projectDecision.withdraw" &&
    decisionRequests[3]?.supersedesId ===
      decisionRequests[2]
        ?.id, "project decision saves were not four strict revision-bound, browser-identified mutations");
  require(decisions.invariantUnchanged &&
    decisions.codexRequestsDuringStory.length ===
      0, "project decision edits changed other workspace state or called a Codex action route");
  require(JSON.stringify(decisions.reopened.persistedEvents) ===
    JSON.stringify(decisions.persistedBeforeReopen) &&
    JSON.stringify(historyWithoutTimestamps(decisions.reopened.history)) ===
      JSON.stringify(expectedWithdrawnHistory) &&
    decisions.reopened.currentCount ===
      0, "project decision history did not survive closing and reopening Plan exactly");
  require([
    decisions.initial.containment,
    decisions.initialEditorContainment,
    decisions.recordFormContainment,
    decisions.recorded.containment,
    decisions.correction.containment,
    decisions.replacement.containment,
    decisions.replacement.containmentAfterSave,
    decisions.withdrawal.formContainment,
    decisions.withdrawal.containment,
    decisions.reopened.containment,
  ].every(
    projectDecisionIsContained,
  ), "the project decision log, editors, or expanded history escaped Plan horizontally");
  const definitionOfDone = result.plan.definitionOfDone;
  require(definitionOfDone?.initialCountExact &&
    definitionOfDone?.initialDisclosureExpanded &&
    definitionOfDone?.initialFocus &&
    definitionOfDone?.saveFocus &&
    definitionOfDone?.saveDisclosureOpenAndTriggerVisible &&
    definitionOfDone?.clearFocus &&
    definitionOfDone?.emptyEditorFocus &&
    definitionOfDone?.backFocusRestored &&
    definitionOfDone?.escapeFocusRestored &&
    definitionOfDone?.escapeDisclosureOpenAndTriggerVisible &&
    definitionOfDone?.conflictCancelFocus &&
    definitionOfDone?.cancelDisclosureOpenAndTriggerVisible &&
    definitionOfDone?.reloadConfirmationInitialFocus, "Definition of Done create/edit/clear/reload controls lost their exact copy or focus handoffs");
  require(definitionOfDone?.firstMutationExact &&
    definitionOfDone?.intentEnvelopesExact &&
    definitionOfDone?.mutationSequenceExact &&
    definitionOfDone?.conflictDraftPreserved &&
    definitionOfDone?.recoveryControlAvailable &&
    definitionOfDone?.obsoleteConflictCopyAbsent &&
    definitionOfDone?.keepDraftPreserved &&
    definitionOfDone?.concurrentDefinitionLoaded &&
    definitionOfDone?.useDraftPreserved &&
    definitionOfDone?.durableAfterConflict &&
    definitionOfDone?.unrelatedStatusPreserved &&
    definitionOfDone?.cleared &&
    definitionOfDone?.successfulWriteCount === 3 &&
    definitionOfDone?.requestCount === 5 &&
    definitionOfDone?.conflictCount === 2 &&
    definitionOfDone?.workspaceWriteDelta ===
      3, "Definition of Done did not persist exact intent-only mutations or preserve concurrent unrelated state and the rejected draft");
  require(definitionOfDone?.codexMutationDelta === 0 &&
    definitionOfDone?.verificationMutationDelta === 0 &&
    definitionOfDone?.reportPrivacySafe &&
    definitionOfDone?.logPrivacySafe &&
    definitionOfDone?.scalarOnlyReport &&
    definitionOfDone?.snapshotClean &&
    definitionOfDone?.storageClean &&
    definitionOfDone?.urlClean, "Definition of Done leaked into a snapshot/browser surface or invoked Codex/verification");
  require(definitionOfDone?.layout?.controlsComfortable &&
    definitionOfDone?.layout?.opaqueFocusOutline &&
    definitionOfDone?.layout
      ?.noHorizontalOverflow, "Definition of Done controls violated the 44px/14px/opaque-focus/containment contract");
  const workItemRelationships = result.plan.workItemRelationships;
  require(workItemRelationships?.initialExact &&
    workItemRelationships?.initialFocus &&
    workItemRelationships?.noDraftWrite &&
    workItemRelationships?.firstSaveExact &&
    workItemRelationships?.firstSaveFocus &&
    workItemRelationships?.clearConfirmationFocus &&
    workItemRelationships?.backFocus &&
    workItemRelationships?.cleared &&
    workItemRelationships?.clearFocus &&
    workItemRelationships?.restoredExact &&
    workItemRelationships?.envelopesExact &&
    workItemRelationships?.requestCount === 3 &&
    workItemRelationships?.successfulWriteCount === 3 &&
    workItemRelationships?.workspaceWriteDelta === 3 &&
    workItemRelationships?.workspaceMutationAttemptDelta === 3 &&
    workItemRelationships?.codexMutationDelta === 0 &&
    workItemRelationships?.verificationMutationDelta ===
      0, "work-item links did not preserve their exact advisory intent, clear flow, focus, or zero-side-effect contract");
  require(workItemRelationships?.controlsComfortable &&
    workItemRelationships?.responsiveEditor &&
    workItemRelationships?.contained &&
    workItemRelationships?.noHorizontalOverflow, "work-item link controls violated the 44px/14px/responsive containment contract");
  const projectContextReview = result.plan.projectContextReview;
  require(projectContextReview?.initialExact &&
    projectContextReview?.initialFocus &&
    projectContextReview?.initialSelectionExact &&
    projectContextReview?.noDraftWrite &&
    projectContextReview?.firstSaveExact &&
    projectContextReview?.firstSaveFocus &&
    projectContextReview?.confirmationFocus &&
    projectContextReview?.backFocus &&
    projectContextReview?.escapeFocus &&
    projectContextReview?.cleared &&
    projectContextReview?.clearFocus &&
    projectContextReview?.restoredExact &&
    projectContextReview?.envelopesExact &&
    projectContextReview?.requestCount === 3 &&
    projectContextReview?.successfulWriteCount === 3 &&
    projectContextReview?.workspaceWriteDelta === 3 &&
    projectContextReview?.workspaceMutationAttemptDelta === 3 &&
    projectContextReview?.codexMutationDelta === 0 &&
    projectContextReview?.verificationMutationDelta === 0 &&
    projectContextReview?.controlsComfortable &&
    projectContextReview?.storageClean &&
    projectContextReview?.urlClean &&
    projectContextReview?.reportPrivacySafe &&
    projectContextReview?.logPrivacySafe &&
    projectContextReview?.scalarOnlyReport &&
    projectContextReview?.noHorizontalOverflow, "project context review did not preserve explicit user authority, focus, exact intents, or containment");
  const projectReviewSchedule = result.plan.projectReviewSchedule;
  require(projectReviewSchedule?.initialExact &&
    projectReviewSchedule?.initialFocus &&
    projectReviewSchedule?.noDraftWrite &&
    projectReviewSchedule?.firstSaveExact &&
    projectReviewSchedule?.firstSaveFocus &&
    projectReviewSchedule?.noAutomaticCheckCopy &&
    projectReviewSchedule?.confirmationFocus &&
    projectReviewSchedule?.backFocus &&
    projectReviewSchedule?.completedExact &&
    projectReviewSchedule?.completeFocus &&
    projectReviewSchedule?.envelopesExact &&
    projectReviewSchedule?.requestCount === 2 &&
    projectReviewSchedule?.successfulWriteCount === 2 &&
    projectReviewSchedule?.workspaceWriteDelta === 2 &&
    projectReviewSchedule?.workspaceMutationAttemptDelta === 2 &&
    projectReviewSchedule?.codexMutationDelta === 0 &&
    projectReviewSchedule?.verificationMutationDelta === 0 &&
    projectReviewSchedule?.controlsComfortable &&
    projectReviewSchedule?.noHorizontalOverflow &&
    projectReviewSchedule?.scalarOnlyReport, "scheduled project review did not preserve explicit completion, manual checks, focus, exact intents, or containment");
  const initialMilestoneTitles = result.plan.milestones.initial.map(
    (milestone) => milestone.title,
  );
  const reorderedMilestoneTitles = result.plan.milestones.reordered.map(
    (milestone) => milestone.title,
  );
  const appendedMilestoneTitles = result.plan.milestones.appended.map(
    (milestone) => milestone.title,
  );
  const reopenedMilestoneTitles = result.plan.milestones.reopened.map(
    (milestone) => milestone.title,
  );
  const expectedInitialTitles = [
    REVIEW_MILESTONE_TITLE,
    RELEASE_MILESTONE_TITLE,
    VERIFICATION_MILESTONE_TITLE,
  ];
  const expectedReorderedTitles = [
    REVIEW_MILESTONE_TITLE,
    VERIFICATION_MILESTONE_TITLE,
    RELEASE_MILESTONE_TITLE,
  ];
  const expectedFinalTitles = [
    ...expectedReorderedTitles,
    APPENDED_MILESTONE_TITLE,
  ];
  require(result.plan.milestones.heading &&
    result.plan.milestones
      .advisoryCopy, "Plan did not explain ordered advisory milestones");
  require(JSON.stringify(initialMilestoneTitles) ===
    JSON.stringify(expectedInitialTitles) &&
    JSON.stringify(result.plan.milestones.initialPersistedWorkspaceOrder) ===
      JSON.stringify(INITIAL_MILESTONE_ORDER) &&
    result.plan.milestones.initial.every(
      (milestone, index) =>
        milestone.position === index + 1 &&
        milestone.numberText === String(index + 1) &&
        milestone.statusText?.startsWith(`Milestone ${index + 1} ·`),
    ), "Plan did not render the fixture's three numbered non-chronological milestones");
  require(result.plan.milestones.orderModeEntered &&
    result.plan.milestones.orderModeInitial.length === 3 &&
    result.plan.milestones.orderModeInitial.every(
      (milestone, index) =>
        milestone.orderMode &&
        milestone.orderGroupLabel ===
          milestoneOrderGroupLabel(index + 1, expectedInitialTitles[index]),
    ), "Change order did not enter the compact milestone-ordering mode");
  require(Object.values(result.plan.milestones.initialBoundaryControls).every(
    Boolean,
  ) &&
    Object.values(result.plan.milestones.reorderedBoundaryControls).every(
      Boolean,
    ), "milestone ordering exposed an invalid first, middle, or last boundary control");
  require(result.plan.milestones.changeOrderKeyboardReachable &&
    result.plan.milestones.moveControlKeyboardFocus &&
    result.plan.milestones.movedControlFocusRestored &&
    result.plan.milestones.orderModeEscapeFocusRestored &&
    result.plan.milestones.firstCloseFocusRestored &&
    result.plan
      .focusRestored, "milestone ordering did not preserve its keyboard focus handoffs");
  require(JSON.stringify(reorderedMilestoneTitles) ===
    JSON.stringify(expectedReorderedTitles) &&
    result.plan.milestones.reordered.every(
      (milestone, index) =>
        milestone.orderGroupLabel ===
        milestoneOrderGroupLabel(index + 1, expectedReorderedTitles[index]),
    ) &&
    result.plan.milestones.successStatus ===
      `Moved ${VERIFICATION_MILESTONE_TITLE} to milestone 2 of 3.`, "moving the third milestone earlier did not render the confirmed order and status");
  const orderRequest = result.plan.milestones.orderRequests.at(-1);
  require(result.plan.milestones.orderWriteCount === 1 &&
    result.plan.milestones.orderRequests.length === 1 &&
    orderRequest?.type === "workItem.reorder" &&
    orderRequest.projectId === PRIMARY_PROJECT_ID &&
    orderRequest.objectiveId === REVIEW_OBJECTIVE_ID &&
    orderRequest.expectedRevision === orderRequest.acceptedRevision &&
    typeof orderRequest.mutationId === "string" &&
    orderRequest.mutationId.length > 0 &&
    JSON.stringify(orderRequest.orderedWorkItemIds) ===
      JSON.stringify(
        REORDERED_MILESTONE_ORDER,
      ), "Plan did not persist exactly one revision-bound milestone permutation PATCH");
  const appendRequest = result.plan.milestones.appendRequests.at(-1);
  const appendedWorkItemId = appendRequest?.workItem?.id;
  const expectedFinalIds = [...REORDERED_MILESTONE_ORDER, appendedWorkItemId];
  require(result.plan.milestones.appendWriteCount === 1 &&
    result.plan.milestones.appendRequests.length === 1 &&
    appendRequest?.type === "workItem.upsert" &&
    appendRequest.projectId === PRIMARY_PROJECT_ID &&
    appendRequest.objectiveId === REVIEW_OBJECTIVE_ID &&
    appendRequest.expectedRevision === appendRequest.acceptedRevision &&
    typeof appendRequest.mutationId === "string" &&
    appendRequest.mutationId.length > 0 &&
    typeof appendedWorkItemId === "string" &&
    /^work-[A-Za-z0-9._:-]+$/u.test(appendedWorkItemId) &&
    appendRequest.workItem.title === APPENDED_MILESTONE_TITLE &&
    appendRequest.workItem.expectedOutcome === APPENDED_MILESTONE_OUTCOME &&
    result.plan.milestones.appendDefinitionMutationExact &&
    appendRequest.workItem.status === "planned" &&
    Array.isArray(appendRequest.workItem.attempts) &&
    appendRequest.workItem.attempts.length === 0 &&
    appendRequest.workItem.createdAt === appendRequest.workItem.updatedAt &&
    Number.isFinite(
      Date.parse(appendRequest.workItem.createdAt),
    ), "Plan did not persist exactly one strict revision-bound new milestone PATCH");
  require(result.plan.milestones.appendFormInitialFocus &&
    result.plan.milestones.appendFormClosed &&
    result.plan.milestones.appendFocusRestored &&
    result.plan.milestones.appendedDefinitionVisible &&
    result.plan.milestones.reopenedAppendedDefinitionExact &&
    result.plan.milestones.appendSuccessStatus === "Work item added." &&
    JSON.stringify(appendedMilestoneTitles) ===
      JSON.stringify(expectedFinalTitles) &&
    result.plan.milestones.appended.at(-1)?.position === 4 &&
    result.plan.milestones.appended.at(-1)?.numberText ===
      "4", "the real Add work form did not append the fourth numbered milestone");
  require(result.plan.milestones.orderModeExited &&
    result.plan.milestones.reopenedInNormalMode &&
    JSON.stringify(reopenedMilestoneTitles) ===
      JSON.stringify(expectedFinalTitles) &&
    JSON.stringify(result.plan.milestones.persistedReorderedWorkspaceOrder) ===
      JSON.stringify(REORDERED_MILESTONE_ORDER) &&
    JSON.stringify(result.plan.milestones.appendedWorkspaceOrder) ===
      JSON.stringify(expectedFinalIds) &&
    JSON.stringify(result.plan.milestones.persistedWorkspaceOrder) ===
      JSON.stringify(
        expectedFinalIds,
      ), "the reordered and appended milestone sequence did not survive closing and reopening Plan");
  require([
    result.plan.milestones.initialContainment,
    result.plan.milestones.orderModeContainment,
    result.plan.milestones.appendedContainment,
    result.plan.milestones.reopenedContainment,
  ].every(
    (containment) =>
      containment.panelWithinViewportWidth &&
      containment.noHorizontalOverflow &&
      containment.cardsContained &&
      containment.controlsContained,
  ) &&
    result.plan.milestones.orderModeContainment.orderControlGroupCount ===
      3, "milestone cards or order controls escaped the Plan panel or viewport");
  require(result.plan.scopeLabel ===
    "Work item", "Plan did not expose the work-item assessment scope");
  require(result.plan.recordedLabel ===
    "You recorded", "Plan did not render the saved user-authored assessment");
  require(!result.plan.rest.formVisible &&
    result.plan.rest.savedDetailsCount === 1 &&
    !result.plan.rest.savedDetailsOpen &&
    result.plan.savedDisclosureKeyboardReachable &&
    result.plan.rest
      .noHorizontalOverflow, "Plan assessment card was not compact and contained at rest");
  require(result.plan.editor.formVisible &&
    result.plan.editor.noHorizontalOverflow &&
    result.plan.editor.withinViewportWidth &&
    result.plan
      .editorExpanded, "Plan assessment editor did not expand or contain its controls");
  require(result.plan.initialEditorFocus &&
    result.plan
      .cancelFocusRestored, "Plan assessment editor focus handoffs were incomplete");
  require(result.plan.selfCritiqueCount ===
    0, "Plan duplicated absent self-critique copy on an ordinary work-item card");
  require(result.plan.focusTrap.count >= 2 &&
    result.plan
      .focusWrapped, "Plan assessment editor broke the modal focus trap");
  require(result.plan.focusRestored, "Plan did not restore its trigger focus");
  const decisionAcceptance = result.decisionRequests;
  require(decisionAcceptance.schemaVersion12 &&
    decisionAcceptance.workEditorInitialFocus &&
    decisionAcceptance.resultEditorInitialFocus &&
    decisionAcceptance.staleDraftRetained &&
    decisionAcceptance.confirmWorkFocused &&
    decisionAcceptance.confirmResultFocused, "decision-request editors did not preserve explicit focus, confirmation, or the stale-revision draft");
  require(decisionAcceptance.workCardLayout.withinViewport &&
    decisionAcceptance.workCardLayout.noHorizontalOverflow &&
    decisionAcceptance.workCardLayout.controlsComfortable &&
    decisionAcceptance.resultCardLayout.withinViewport &&
    decisionAcceptance.resultCardLayout.noHorizontalOverflow &&
    decisionAcceptance.resultCardLayout.controlsComfortable &&
    attentionPanelIsContained(
      decisionAcceptance.attentionContainment,
    ), "decision-request Plan, Review, or Attention surfaces escaped the viewport or became undersized");
  require(decisionAcceptance.countsExact &&
    decisionAcceptance.digestDecisionGroupCount === 1 &&
    decisionAcceptance.digestDecisionItemCount ===
      2, "needs-decision counts or accessible names disagreed across the office, drawer, campus, Attention, and Digest");
  require(decisionAcceptance.attentionPrivacySafe &&
    decisionAcceptance.resolutionExcludedFromAttention &&
    decisionAcceptance.digestPrivacySafe &&
    decisionAcceptance.reportPrivacySafe &&
    decisionAcceptance.logPrivacySafe &&
    decisionAcceptance.scalarOnlyReport, "decision prompts or resolutions escaped their private Plan/Review context");
  require(decisionAcceptance.exactWorkItemRoute &&
    decisionAcceptance.exactResultRoute, "decision actions did not route to the exact work item in Plan and exact stored result in Review");
  require(decisionAcceptance.writeCount === 9 &&
    decisionAcceptance.conflictCount === 1 &&
    decisionAcceptance.remainingRequestCount === 0 &&
    decisionAcceptance.codexMutationDelta === 0 &&
    decisionAcceptance.requestCount === 10 &&
    decisionAcceptance.requestSequenceExact, "decision create/edit/resolve/reopen/confirmed-remove lifecycle was incomplete or crossed the Codex boundary");
  require(result.digest.opened &&
    result.digest.closed, "actionable digest did not open and close");
  require(result.digest.triggerLabel ===
    `Open digest, ${GLOBAL_ATTENTION_COUNT} actions, ${GLOBAL_NEEDS_REPLY_COUNT} reply needed, 0 decisions needed, ${GLOBAL_UNREAD_RESULT_COUNT} unread results` &&
    countAttributesMatch(
      result.digest.triggerCounts,
      GLOBAL_ATTENTION_COUNT,
      GLOBAL_NEEDS_REPLY_COUNT,
      GLOBAL_UNREAD_RESULT_COUNT,
    ) &&
    result.digest.triggerCounts.text ===
      `Digest ${GLOBAL_ATTENTION_COUNT} actions ${GLOBAL_NEEDS_REPLY_COUNT} reply needed ${GLOBAL_UNREAD_RESULT_COUNT} unread`, "digest trigger counts are incorrect");
  require(projectCountIs(
    result.digest.projectCards,
    PRIMARY_PROJECT_ID,
    PRIMARY_ATTENTION_COUNT,
    PRIMARY_NEEDS_REPLY_COUNT,
    PRIMARY_UNREAD_RESULT_COUNT,
  ) &&
    projectCountIs(
      result.digest.projectCards,
      SECONDARY_PROJECT_ID,
      SECONDARY_ATTENTION_COUNT,
      SECONDARY_NEEDS_REPLY_COUNT,
      SECONDARY_UNREAD_RESULT_COUNT,
    ) &&
    projectCountIs(
      result.digest.projectCards,
      HOLDING_PROJECT_ID,
      HOLDING_ATTENTION_COUNT,
      HOLDING_NEEDS_REPLY_COUNT,
      HOLDING_UNREAD_RESULT_COUNT,
    ), "campus project cards do not show the exact project-scoped total, reply, decision, and unread counts");
  require(result.digest.noWorkspaceWrites &&
    result.digest.noCodexMutations &&
    result.digest.countContainment.controlCount === 4 &&
    result.digest.countContainment
      .noHorizontalOverflow, "global/campus count wayfinding overflowed or caused a workspace or Codex action write");
  require(result.digest.modal, "actionable digest is not an accessible modal");
  require(result.digest
    .panelPortaledToBody, "actionable digest panel is not portaled outside the app shell");
  require(result.digest
    .backdropPortaledToBody, "actionable digest backdrop is not portaled outside the app shell");
  require(result.digest
    .backdropHiddenAndUntabbable, "digest backdrop is exposed to assistive technology or keyboard focus");
  require(result.digest
    .shellInert, "actionable digest did not make the application inert");
  require(result.digest
    .initialFocusOnItem, "actionable digest initial focus is not actionable");
  require(result.digest
    .summaryVisible, "actionable digest summary was clipped or compressed");
  require(result.digest
    .firstItemFullyVisible, "actionable digest did not show one complete action initially");
  require(result.digest.summaryParts.includes("1 reply needed") &&
    result.digest.summaryParts.includes("2 unread results") &&
    result.digest.summaryParts.includes(
      "2 other actions",
    ), "digest summary counts are incorrect");
  const primaryDigestGroup = result.digest.projectGroups.find((group) =>
    group.heading?.startsWith("Acceptance Office"),
  );
  const secondaryDigestGroup = result.digest.projectGroups.find((group) =>
    group.heading?.startsWith("Secondary Office"),
  );
  require(result.digest.projectGroups.length ===
    2, "digest did not preserve its two project groups");
  require(primaryDigestGroup?.itemCount ===
    4, "primary digest group has the wrong action count");
  require(primaryDigestGroup?.countSummary ===
    "1 reply · 1 unread result · 2 other actions", "primary digest group summary is incorrect");
  require(secondaryDigestGroup?.itemCount ===
    1, "secondary digest group has the wrong action count");
  require(secondaryDigestGroup?.countSummary ===
    "1 unread result", "secondary digest group summary is incorrect");
  require(result.digest.focusTrap.count >=
    2, "actionable digest has no usable focus targets");
  require(result.digest
    .forwardFocusWrapped, "actionable digest forward focus trap did not wrap");
  require(result.digest
    .backwardFocusWrapped, "actionable digest reverse focus trap did not wrap");
  require(result.digest
    .focusRestored, "actionable digest did not restore trigger focus");
  require(result.digest
    .panelWithinViewport, "actionable digest escaped the viewport");
  require(result.digest
    .noHorizontalOverflow, "actionable digest introduced horizontal overflow");
  require(result.digest
    .longTitleContained, "actionable digest did not contain the long fixture title");
  const desktopAlerts = result.desktopAlerts;
  require(desktopAlerts.disclosureInitiallyClosed &&
    desktopAlerts.summaryKeyboardReachable &&
    desktopAlerts.actionKeyboardReachable &&
    desktopAlerts.projectControlKeyboardReachable &&
    desktopAlerts.exactHoldingLabel &&
    desktopAlerts.requestCountBeforeDisclosure === 0 &&
    desktopAlerts.requestCountAfterDisclosure ===
      0, "desktop-alert disclosure or project controls requested permission without an explicit Enable action, mislabeled the holding scope, or were not keyboard reachable");
  require(desktopAlerts.disclosure.open &&
    desktopAlerts.disclosure.status === "off" &&
    desktopAlerts.disclosure.text.includes("every open Coffice page") &&
    desktopAlerts.disclosure.text.includes("Coffice must remain open") &&
    desktopAlerts.disclosure.text.includes("never include a project name") &&
    desktopAlerts.disclosure.text.includes("notification history") &&
    desktopAlerts.disclosure.summaryFontSize >= 14 &&
    desktopAlerts.disclosure.actionFontSize >= 14 &&
    desktopAlerts.disclosure.actionHeight >= 44 &&
    desktopAlerts.disclosure
      .contained, "desktop-alert disclosure was incomplete, undersized, or escaped the Digest");
  require(desktopAlerts.enabled?.permissionRequests === 1 &&
    desktopAlerts.enabled.permission === "granted" &&
    desktopAlerts.baselineNotificationCount === 0 &&
    desktopAlerts.baselineStorageState.separateRecords &&
    !desktopAlerts.baselineStorageState.projectMutesPresent &&
    desktopAlerts.baselineStorageState.preferenceEnabled === true &&
    desktopAlerts.baselineStorageState.digestCount === GLOBAL_ATTENTION_COUNT &&
    desktopAlerts.baselineStorageState.digestsAreSha256 &&
    desktopAlerts.baselineStorageState.ledgerVersion === 1 &&
    desktopAlerts.baselineStorageState.saturated ===
      false, "explicit desktop-alert enablement did not request exactly once, baseline silently, or persist only digest identities");
  require(desktopAlerts.crossTabMuteReflected &&
    desktopAlerts.muteMutationIsLocalOnly &&
    desktopAlerts.muteRecordIsContentFree &&
    Object.keys(desktopAlerts.afterMuteStorage).length === 3 &&
    desktopAlerts.afterMuteStorageState.threeSeparateRecords &&
    desktopAlerts.afterMuteStorageState.projectMutesVersion === 1 &&
    desktopAlerts.afterMuteStorageState.mutedProjectDigestCount === 2 &&
    desktopAlerts.afterMuteStorageState.mutedProjectDigestsAreSha256 &&
    desktopAlerts.afterMuteStorageState
      .exactProjectMutesShape, "project desktop-delivery choices did not reflect across tabs, wrote outside browser-local state, or persisted raw project identity instead of an exact digest-only third record");
  require(desktopAlerts.muteDeliveryRace.sameEventKey &&
    desktopAlerts.muteDeliveryRace.writerWon &&
    desktopAlerts.muteDeliveryRace.notificationCount === 0 &&
    desktopAlerts.muteDeliveryRace.claimCount ===
      1, "a queued exclusive mute write did not linearize ahead of the later shared delivery decision under native Web Locks");
  require(desktopAlerts.foregroundNotificationCount === 0 &&
    desktopAlerts.foregroundClaimPersisted &&
    desktopAlerts.foregroundStorageState
      .digestsAreSha256, "a foreground Attention transition was not silently and durably suppressed");
  require(desktopAlerts.allMuted.sameEventKey &&
    desktopAlerts.allMuted.notificationCount === 0 &&
    desktopAlerts.allMuted.claimCount ===
      1, "an all-muted cross-tab transition was not claimed exactly once without a desktop alert");
  require(desktopAlerts.mixed.sameEventKeys &&
    desktopAlerts.mixed.notificationCount === 1 &&
    desktopAlerts.mixed.claimCount === 3 &&
    desktopAlerts.mixed.exactPayloadShape &&
    desktopAlerts.mixed.payloadIsContentFree &&
    desktopAlerts.mixed.expectedTargetEventKey ===
      desktopAlerts.expectedSeenEventKey, "a mixed muted/unmuted batch did not claim every event and create exactly one generic plural alert for its two eligible actions");
  require(desktopAlerts.rename.retainedMute &&
    desktopAlerts.rename.removeReaddRetainedMute &&
    desktopAlerts.rename.sameEventKey &&
    desktopAlerts.rename.notificationCount === 0 &&
    desktopAlerts.rename.claimCount === 1 &&
    desktopAlerts.unmuteDidNotReplay &&
    desktopAlerts.later.sameEventKey &&
    desktopAlerts.later.notificationCount === 1 &&
    desktopAlerts.later.claimCount === 1 &&
    desktopAlerts.later.exactPayloadShape &&
    desktopAlerts.later
      .payloadIsContentFree, "rename, unmute/no-replay, or later-distinct-event delivery did not preserve the exact project identity contract");
  require(!desktopAlerts.storageContainsRawContent &&
    Object.keys(desktopAlerts.storageAfterDelivery).length === 3 &&
    desktopAlerts.deliveredStorageState.digestCount ===
      desktopAlerts.foregroundStorageState.digestCount + 6 &&
    desktopAlerts.deliveredStorageState.threeSeparateRecords &&
    desktopAlerts.deliveredStorageState.mutedProjectDigestCount === 1 &&
    desktopAlerts.deliveredStorageState.exactProjectMutesShape &&
    desktopAlerts.deliveredStorageState
      .digestsAreSha256, "desktop-alert persistence exposed raw Attention content or did not keep separate preference, delivery-ledger, and project-mute records");
  require(desktopAlerts.mixed.clicked &&
    desktopAlerts.mixed.clickClosedNotification &&
    desktopAlerts.mixed.focusAttempted &&
    desktopAlerts.mixed.exactRoute &&
    desktopAlerts.workspaceWritesDuringStory === 1 &&
    desktopAlerts.seenWritesDuringStory === 1 &&
    JSON.stringify(desktopAlerts.seenEventKeysDuringStory) ===
      JSON.stringify([desktopAlerts.expectedSeenEventKey]) &&
    desktopAlerts.codexMutationsDuringStory ===
      0, "the mixed-batch alert click did not revalidate and route the first eligible canonical task with only its existing seen receipt");
  require(desktopAlerts.controls.resetKeyboardReachable &&
    desktopAlerts.controls.resetControlComfortable &&
    desktopAlerts.controls.resetConfirmationComfortable &&
    desktopAlerts.controls.resetInitialFocus &&
    desktopAlerts.controls.resetEscapeKeptDigest &&
    desktopAlerts.controls.resetEscapeRestoredFocus &&
    desktopAlerts.controls.resetSuccessFocusInDialog &&
    desktopAlerts.controls.resetWasDeliveryQuiet &&
    desktopAlerts.controls.offProjectControlsAvailable &&
    desktopAlerts.controls
      .resetReflectedAcrossTabs, "the project-mute reset confirmation did not preserve focus, honor Escape before the Digest, stay delivery-quiet, or reflect across tabs");
  require(desktopAlerts.onBeforeDisable &&
    desktopAlerts.disabled?.permissionRequests === 1 &&
    desktopAlerts.disabled.permission === "granted" &&
    desktopAlerts.finalStorageState.preferenceEnabled === false &&
    desktopAlerts.finalStorageState.digestCount ===
      desktopAlerts.deliveredStorageState.digestCount &&
    desktopAlerts.finalStorageState.threeSeparateRecords &&
    desktopAlerts.finalStorageState.projectMutesVersion === 1 &&
    desktopAlerts.finalStorageState.mutedProjectDigestCount === 0 &&
    desktopAlerts.finalStorageState.exactProjectMutesShape &&
    desktopAlerts.finalContainment.withinViewport &&
    desktopAlerts.finalContainment.noHorizontalOverflow &&
    desktopAlerts.finalContainment
      .controlsComfortable, "desktop-alert disablement or project-delivery controls were not truthful, readable, or contained");
  require(desktopAlerts.crossTab.nativeWebLocksAvailable &&
    desktopAlerts.crossTab.sameForegroundEventKey &&
    desktopAlerts.crossTab.visibleHiddenNotificationCount === 0 &&
    desktopAlerts.crossTab.visibleHiddenClaimCount ===
      1, "real same-origin pages did not atomically let the visible page win the foreground delivery race");
  require(result.projectAttention.secondary.trigger.label ===
    `Attention for Secondary Office, ${SECONDARY_ATTENTION_COUNT} action, ${SECONDARY_NEEDS_REPLY_COUNT} replies needed, 0 decisions needed, ${SECONDARY_UNREAD_RESULT_COUNT} unread result` &&
    result.projectAttention.secondary.trigger.projectId ===
      SECONDARY_PROJECT_ID &&
    countAttributesMatch(
      result.projectAttention.secondary.trigger,
      SECONDARY_ATTENTION_COUNT,
      SECONDARY_NEEDS_REPLY_COUNT,
      SECONDARY_UNREAD_RESULT_COUNT,
    ) &&
    result.projectAttention.secondary.trigger.badge ===
      `${SECONDARY_ATTENTION_COUNT} ${SECONDARY_UNREAD_RESULT_COUNT} unread` &&
    result.projectAttention.secondary.scopeProjectId === SECONDARY_PROJECT_ID &&
    result.projectAttention.secondary.scopeHeadingCount === 1 &&
    result.projectAttention.secondary.scopeIntroCount === 1 &&
    result.projectAttention.secondary.itemCount === SECONDARY_ATTENTION_COUNT &&
    result.projectAttention.secondary.itemTexts.length === 1 &&
    result.projectAttention.secondary.itemTexts[0].includes(
      "Secondary Agent 02",
    ) &&
    result.projectAttention.secondary.itemTexts[0].includes(
      "Secondary Office",
    ) &&
    result.projectAttention.secondary.primaryItemCount ===
      0, "Secondary Attention did not contain exactly its one canonical action");
  require(result.projectAttention.secondary.initialFocusOnItem &&
    result.projectAttention.secondary.focusRestored &&
    attentionPanelIsContained(
      result.projectAttention.secondary.containment,
    ), "Secondary Attention focus or containment failed");
  require(workflowMatches(result.projectAttention.secondary.workflow, {
    "Secondary Agent 01": "desk",
    "Secondary Agent 02": "review",
  }) &&
    result.projectAttention.secondary.workflow.zones.meeting.assignedCount ===
      "0" &&
    result.projectAttention.secondary.workflow.zones.review.assignedCount ===
      "1", "Secondary workflow wayfinding did not use its exact current Attention assignment");
  require(result.projectAttention.holding.trigger.label ===
    "Attention for Unassigned Sessions, 0 actions, 0 replies needed, 0 decisions needed, 0 unread results" &&
    result.projectAttention.holding.trigger.projectId === HOLDING_PROJECT_ID &&
    countAttributesMatch(
      result.projectAttention.holding.trigger,
      HOLDING_ATTENTION_COUNT,
      HOLDING_NEEDS_REPLY_COUNT,
      HOLDING_UNREAD_RESULT_COUNT,
    ) &&
    result.projectAttention.holding.trigger.badge ===
      String(HOLDING_ATTENTION_COUNT) &&
    result.projectAttention.holding.scopeProjectId === HOLDING_PROJECT_ID &&
    result.projectAttention.holding.scopeHeadingCount === 1 &&
    result.projectAttention.holding.scopeIntroCount === 1 &&
    result.projectAttention.holding.itemCount === HOLDING_ATTENTION_COUNT &&
    result.projectAttention.holding.emptyHeadingCount === 1 &&
    result.projectAttention.holding.emptyCopy.includes(
      "Unassigned Sessions has no current Attention items.",
    ), "holding Attention was not an exact, project-scoped empty state");
  require(result.projectAttention.holding.initialFocusOnClose &&
    result.projectAttention.holding.focusRestored &&
    attentionPanelIsContained(
      result.projectAttention.holding.containment,
    ), "holding Attention empty-state focus or containment failed");
  require(workflowMatches(result.projectAttention.holding.workflow, {
    "Holding Agent 01": "desk",
  }) &&
    result.projectAttention.holding.workflow.zones.meeting.assignedCount ===
      "0" &&
    result.projectAttention.holding.workflow.zones.review.assignedCount ===
      "0", "unassignment alone moved the holding task away from its owned desk");
  require(result.projectAttention.holding.projectDecisionLogOmitted &&
    result.projectAttention.holding
      .planFocusRestored, "the holding area exposed a project decision log or broke Plan focus restoration");
  require(result.projectAttention.restoredPrimaryTrigger.label ===
    `Attention for Acceptance Office, ${PRIMARY_ATTENTION_COUNT} actions, ${PRIMARY_NEEDS_REPLY_COUNT} reply needed, 0 decisions needed, ${PRIMARY_UNREAD_RESULT_COUNT} unread result` &&
    result.projectAttention.restoredPrimaryTrigger.projectId ===
      PRIMARY_PROJECT_ID &&
    countAttributesMatch(
      result.projectAttention.restoredPrimaryTrigger,
      PRIMARY_ATTENTION_COUNT,
      PRIMARY_NEEDS_REPLY_COUNT,
      PRIMARY_UNREAD_RESULT_COUNT,
    ) &&
    result.projectAttention.restoredPrimaryTrigger.badge ===
      `${PRIMARY_ATTENTION_COUNT} ${PRIMARY_NEEDS_REPLY_COUNT} reply needed ${PRIMARY_UNREAD_RESULT_COUNT} unread`, "project-scope navigation did not restore the Acceptance office and its canonical counts for existing layout checks");
  require(result.errors.consoleErrors.length ===
    0, "browser console errors were reported");
  const expectedAttentionFailures =
    result.review.lifecycle.attentionEventFailureCount;
  const expectedDefinitionConflicts =
    result.plan.definitionOfDone?.conflictCount ?? 0;
  const expectedProjectRulesConflicts = result.projectRules?.conflictCount ?? 0;
  const expectedDecisionConflicts = result.decisionRequests?.conflictCount ?? 0;
  const expectedConsole503 =
    "Failed to load resource: the server responded with a status of 503 (Service Unavailable)";
  const expectedConsole409 =
    "Failed to load resource: the server responded with a status of 409 (Conflict)";
  require(result.errors.expectedConsoleErrors.length ===
    expectedAttentionFailures +
      expectedDefinitionConflicts +
      expectedProjectRulesConflicts +
      expectedDecisionConflicts &&
    result.errors.expectedConsoleErrors.filter(
      (message) => message === expectedConsole503,
    ).length === expectedAttentionFailures &&
    result.errors.expectedConsoleErrors.filter(
      (message) => message === expectedConsole409,
    ).length ===
      expectedDefinitionConflicts +
        expectedProjectRulesConflicts +
        expectedDecisionConflicts, "the deliberate Attention failure and workspace conflicts did not produce exactly their classified browser console signals");
  require(result.errors.pageErrors.length ===
    0, "uncaught page errors were reported");
  require(result.errors.requestFailures.length ===
    0, "network requests failed");
  require(result.errors.responseFailures.length ===
    0, "HTTP error responses were reported");
  const expectedWorkspaceResponseFailures =
    result.errors.expectedResponseFailures.filter(
      (failure) => new URL(failure.url).pathname === "/api/workspace",
    );
  require(result.errors.expectedResponseFailures.length ===
    expectedAttentionFailures +
      expectedDefinitionConflicts +
      expectedProjectRulesConflicts +
      expectedDecisionConflicts &&
    expectedWorkspaceResponseFailures.length ===
      result.errors.expectedResponseFailures.length &&
    expectedWorkspaceResponseFailures.filter(
      (failure) => failure.status === 503,
    ).length === expectedAttentionFailures &&
    expectedWorkspaceResponseFailures.filter(
      (failure) => failure.status === 409,
    ).length ===
      expectedDefinitionConflicts +
        expectedProjectRulesConflicts +
        expectedDecisionConflicts, "the deliberate Attention-receipt failure and workspace conflicts were not isolated and classified");
  return failures;
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
const executablePath = resolveBrowserExecutable();
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--disable-gpu", "--disable-software-rasterizer"],
});
const screenshots = new Map();
const results = [];

try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      reducedMotion: viewport.id === "desktop" ? "no-preference" : "reduce",
      contrast: viewport.id === "desktop" ? "more" : "no-preference",
      forcedColors: viewport.id === "compact" ? "active" : "none",
    });
    let page = await context.newPage();
    const errors = createErrorEvidence();
    attachErrorCapture(page, errors);
    try {
      if (ACCESSIBILITY_ONLY) {
        await installSyntheticFixture(page);
        const accessibility = await auditAccessibility(page);
        results.push({
          id: viewport.id,
          accessibility,
          errors,
          failures:
            accessibility.campus.violationCount === 0 &&
            accessibility.office.violationCount === 0
              ? []
              : ["the automated WCAG A/AA audit reported a violation"],
        });
        continue;
      }
      const loadingFixtureState = await installSyntheticFixture(page, {
        holdWorkspace: true,
      });
      let loadingCounts;
      try {
        loadingCounts = await auditLoadingAttentionCounts(
          page,
          screenshots,
          viewport.id,
          loadingFixtureState,
        );
      } finally {
        loadingFixtureState.releaseWorkspace();
      }
      await page.close();
      page = await context.newPage();
      attachErrorCapture(page, errors);
      const transitionFixtureState = await installSyntheticFixture(page, {
        pollIntervalMs: 250,
      });
      const transitionCue = await auditAttentionTransitionCue(
        page,
        screenshots,
        viewport.id,
        transitionFixtureState,
      );
      await page.close();
      page = await context.newPage();
      attachErrorCapture(page, errors);
      const desktopAlertFixtureState = await installSyntheticFixture(page, {
        pollIntervalMs: 250,
        desktopAlertHarness: {
          resetStorage: true,
          permission: "default",
        },
      });
      const desktopAlerts = await auditDesktopAlerts(
        page,
        screenshots,
        viewport.id,
        desktopAlertFixtureState,
        errors,
      );
      await page.close();
      page = await context.newPage();
      attachErrorCapture(page, errors);
      const currentPlanContextFixtureState = await installSyntheticFixture(
        page,
        {
          currentPlanContextHarness: true,
        },
      );
      const currentPlanContext = await auditCurrentPlanContextInsertion(
        page,
        screenshots,
        viewport.id,
        currentPlanContextFixtureState,
      );
      const forbiddenCurrentPlanContextReportFragments = [
        CURRENT_PLAN_CONTEXT_DRAFT,
        CURRENT_CONTEXT_OBJECTIVE_TITLE,
        CURRENT_CONTEXT_OBJECTIVE_OUTCOME,
        CURRENT_CONTEXT_WORK_ITEM_TITLE,
        CURRENT_CONTEXT_WORK_ITEM_OUTCOME,
        CURRENT_CONTEXT_DECISION_STATEMENT,
        CURRENT_CONTEXT_DECISION_RECORDED_CONTEXT,
        CURRENT_CONTEXT_DECISION_SECOND_STATEMENT,
        REVIEW_DECISION_SECOND_STATEMENT,
        HISTORICAL_CONTEXT_PRIVATE_PATH,
        HISTORICAL_CONTEXT_WITHDRAWN_STATEMENT,
        CURRENT_CONTEXT_WITHDRAWN_STATEMENT,
        CURRENT_CONTEXT_DECISION_ORIGINAL_ID,
        CURRENT_CONTEXT_DECISION_CURRENT_ID,
        CURRENT_CONTEXT_DECISION_SECOND_ID,
        CURRENT_CONTEXT_DECISION_WITHDRAWN_ID,
        CURRENT_CONTEXT_DECISION_WITHDRAWAL_ID,
        DEFINITION_OF_DONE_PRIVATE_CANARY,
        CURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
        CONCURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
        SECOND_CONCURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
        DEFINITION_OF_DONE_LONG_ENTRY,
        "Review the exact completed result.",
        ...PROJECT_RULE_CANARIES,
      ];
      currentPlanContext.reportPrivacySafe =
        forbiddenCurrentPlanContextReportFragments.every(
          (fragment) => !JSON.stringify(currentPlanContext).includes(fragment),
        );
      await page.close();
      page = await context.newPage();
      attachErrorCapture(page, errors);
      const failedCheckRepairFixtureState = await installSyntheticFixture(
        page,
        {
          failedCheckRepairHarness: true,
        },
      );
      const failedCheckRepair = await auditFailedCheckRepairFollowUp(
        page,
        screenshots,
        viewport.id,
        failedCheckRepairFixtureState,
      );
      const forbiddenFailedCheckRepairReportFragments = [
        FAILED_CHECK_REPAIR_DRAFT,
        "Ship the review-note workflow",
        "A reviewer can record judgment and choose the next step safely.",
        REVIEW_MILESTONE_TITLE,
        "The completed slice is assessed before it is accepted.",
        REVIEW_DECISION_LONG_STATEMENT,
        REVIEW_DECISION_PLAIN_CONTEXT,
        REVIEW_DECISION_SECOND_STATEMENT,
        FAILED_CHECK_REPAIR_OLDER_RECEIPT_ID,
        FAILED_CHECK_REPAIR_LATEST_RECEIPT_ID,
        FAILED_CHECK_REPAIR_OTHER_RECEIPT_ID,
        FAILED_CHECK_REPAIR_OLDER_RESULT_ID,
        PRIMARY_PROJECT_ID,
        REVIEW_OBJECTIVE_ID,
        REVIEW_WORK_ITEM_ID,
        REVIEW_ATTEMPT_ID,
        REVIEW_TASK_ID,
        REVIEW_TASK_TITLE,
        FAILED_CHECK_REPAIR_PRIVATE_PATH,
        FAILED_CHECK_REPAIR_PRIVATE_COMMAND,
        FAILED_CHECK_REPAIR_PRIVATE_OUTPUT,
        FAILED_CHECK_REPAIR_PRIVATE_REFERENCE,
        FAILED_CHECK_REPAIR_ASSESSMENT_SUMMARY,
        FAILED_CHECK_REPAIR_ASSESSMENT_RISK,
        FAILED_CHECK_REPAIR_ASSESSMENT_NEXT_ACTION,
        DEFINITION_OF_DONE_PRIVATE_CANARY,
        CURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
        CONCURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
        SECOND_CONCURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
        DEFINITION_OF_DONE_LONG_ENTRY,
        "Review the exact completed result.",
        "Timed out",
        "Could not start",
        "Failed · exit 23",
        "acceptance-repair-private-newer-same-profile-receipt",
        "b".repeat(64),
        "c".repeat(64),
        "d".repeat(64),
        "e".repeat(64),
        ...PROJECT_RULE_CANARIES,
      ];
      failedCheckRepair.reportPrivacySafe =
        forbiddenFailedCheckRepairReportFragments.every(
          (fragment) => !JSON.stringify(failedCheckRepair).includes(fragment),
        );
      await page.close();
      page = await context.newPage();
      attachErrorCapture(page, errors);
      const multiRootFixtureState = await installSyntheticFixture(page, {
        multiRootHarness: true,
        pollIntervalMs: 250,
      });
      const multiRootRepository = await auditMultiRootRepositoryEvidence(
        page,
        screenshots,
        viewport.id,
        multiRootFixtureState,
      );
      multiRootRepository.reportPrivacySafe =
        MULTI_ROOT_PRIVATE_CANARIES.every(
          (canary) => !JSON.stringify(multiRootRepository).includes(canary),
        ) &&
        !JSON.stringify(multiRootRepository).includes(
          MULTI_ROOT_PRIMARY_BRANCH,
        ) &&
        !JSON.stringify(multiRootRepository).includes(
          MULTI_ROOT_ADDITIONAL_BRANCH,
        ) &&
        !JSON.stringify(multiRootRepository).includes(MULTI_ROOT_SINGLE_BRANCH);
      multiRootRepository.scalarOnlyReport =
        containsOnlyBooleanAndCountEvidence(multiRootRepository);
      await page.close();
      page = await context.newPage();
      attachErrorCapture(page, errors);
      const projectRulesFixtureState = await installSyntheticFixture(page, {
        projectRulesHarness: true,
      });
      const projectRules = await auditProjectRules(
        page,
        screenshots,
        viewport.id,
        projectRulesFixtureState,
      );
      projectRules.reportPrivacySafe = PROJECT_RULE_CANARIES.every(
        (canary) => !JSON.stringify(projectRules).includes(canary),
      );
      projectRules.logPrivacySafe = PROJECT_RULE_CANARIES.every(
        (canary) => !JSON.stringify(errors).includes(canary),
      );
      projectRules.scalarOnlyReport =
        containsOnlyBooleanAndCountEvidence(projectRules);
      await page.close();
      page = await context.newPage();
      attachErrorCapture(page, errors);
      const projectQualityBarsFixtureState = await installSyntheticFixture(
        page,
        {
          projectQualityBarsHarness: true,
        },
      );
      const projectQualityBars = await auditProjectQualityBars(
        page,
        screenshots,
        viewport.id,
        projectQualityBarsFixtureState,
      );
      projectQualityBars.scalarOnlyReport =
        containsOnlyBooleanAndCountEvidence(projectQualityBars);
      await page.close();
      page = await context.newPage();
      attachErrorCapture(page, errors);
      const savedComparisonFixtureState = await installSyntheticFixture(page, {
        savedResultComparisonHarness: true,
      });
      const savedResultComparison = await auditSavedResultComparison(
        page,
        screenshots,
        viewport.id,
        savedComparisonFixtureState,
      );
      savedResultComparison.reportPrivacySafe =
        SAVED_COMPARISON_PRIVATE_CANARIES.every(
          (canary) => !JSON.stringify(savedResultComparison).includes(canary),
        );
      savedResultComparison.logPrivacySafe =
        SAVED_COMPARISON_PRIVATE_CANARIES.every(
          (canary) => !JSON.stringify(errors).includes(canary),
        );
      savedResultComparison.scalarOnlyReport =
        containsOnlyBooleanAndCountEvidence(savedResultComparison);
      await page.close();
      page = await context.newPage();
      attachErrorCapture(page, errors);
      const fixtureState = await installSyntheticFixture(page);
      const accessibility = await auditAccessibility(page);
      await waitForAttentionCount(page, PRIMARY_ATTENTION_COUNT);
      const workflow = await inspectSettledWorkflowAreas(
        page,
        PRIMARY_WORKFLOW_ASSIGNMENTS,
        fixtureState,
      );
      screenshots.set(
        `${viewport.id}-workflow-meeting`,
        await captureWorkflowAreaView(page, "meeting"),
      );
      screenshots.set(
        `${viewport.id}-workflow-review`,
        await captureWorkflowAreaView(page, "review"),
      );
      const drawer = await auditProjectDrawer(page, fixtureState);
      if (viewport.id === "desktop") {
        await page
          .getByRole("button", { name: "Projects", exact: true })
          .click();
        screenshots.set(
          "desktop-projects",
          await page.screenshot({ fullPage: false }),
        );
        await page
          .getByRole("dialog", { name: "Projects", exact: true })
          .getByRole("button", { name: "Close projects" })
          .click();
      }
      const review = await auditReviewWorkspace(
        page,
        screenshots,
        viewport.id,
        fixtureState,
      );
      review.workspaceWriteCount = fixtureState.workspaceWriteCount;
      const plan = await auditPlanReviewAssessment(
        page,
        screenshots,
        viewport.id,
        fixtureState,
      );
      plan.definitionOfDone.reportPrivacySafe = [
        DEFINITION_OF_DONE_PRIVATE_CANARY,
        CURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
        CONCURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
        SECOND_CONCURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
        DEFINITION_OF_DONE_LONG_ENTRY,
        "Review the exact completed result.",
        "Review the exact completed result carefully.",
        "A new criterion created in Plan.",
        "A conflicting draft remains editable.",
        "A preserved draft explicitly rebased on the latest plan.",
        "Release criteria can be created and removed.",
        ...APPENDED_DEFINITION_OF_DONE,
      ].every((fragment) => !JSON.stringify(plan).includes(fragment));
      plan.definitionOfDone.logPrivacySafe = [
        DEFINITION_OF_DONE_PRIVATE_CANARY,
        CURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
        CONCURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
        SECOND_CONCURRENT_DEFINITION_OF_DONE_PRIVATE_CANARY,
        DEFINITION_OF_DONE_LONG_ENTRY,
        "Review the exact completed result.",
        "Review the exact completed result carefully.",
        "A new criterion created in Plan.",
        "A conflicting draft remains editable.",
        "A preserved draft explicitly rebased on the latest plan.",
        "Release criteria can be created and removed.",
        ...APPENDED_DEFINITION_OF_DONE,
      ].every((fragment) => !JSON.stringify(errors).includes(fragment));
      plan.definitionOfDone.scalarOnlyReport =
        containsOnlyBooleanAndCountEvidence(plan.definitionOfDone);
      plan.projectContextReview.reportPrivacySafe = [
        PROJECT_CONTEXT_REVIEW_INITIAL_CANARY,
        PROJECT_CONTEXT_REVIEW_EDITED_CANARY,
      ].every((fragment) => !JSON.stringify(plan).includes(fragment));
      plan.projectContextReview.logPrivacySafe = [
        PROJECT_CONTEXT_REVIEW_INITIAL_CANARY,
        PROJECT_CONTEXT_REVIEW_EDITED_CANARY,
      ].every((fragment) => !JSON.stringify(errors).includes(fragment));
      plan.projectContextReview.scalarOnlyReport =
        containsOnlyBooleanAndCountEvidence(plan.projectContextReview);
      plan.projectReviewSchedule.scalarOnlyReport =
        containsOnlyBooleanAndCountEvidence(plan.projectReviewSchedule);
      const decisionRequests = await auditDecisionRequests(
        page,
        screenshots,
        viewport.id,
        fixtureState,
      );
      decisionRequests.reportPrivacySafe =
        DECISION_REQUEST_PRIVATE_CANARIES.every(
          (canary) => !JSON.stringify(decisionRequests).includes(canary),
        );
      decisionRequests.logPrivacySafe = DECISION_REQUEST_PRIVATE_CANARIES.every(
        (canary) => !JSON.stringify(errors).includes(canary),
      );
      decisionRequests.scalarOnlyReport =
        containsOnlyBooleanAndCountEvidence(decisionRequests);
      const digest = await auditActionableDigest(
        page,
        screenshots,
        viewport.id,
        "",
        `Open digest, ${GLOBAL_ATTENTION_COUNT} actions, ${GLOBAL_NEEDS_REPLY_COUNT} reply needed, 0 decisions needed, ${GLOBAL_UNREAD_RESULT_COUNT} unread results`,
        fixtureState,
      );
      const projectAttention = await auditProjectAttentionScoping(
        page,
        fixtureState,
      );
      const layout = await inspectLayout(page, viewport);
      screenshots.set(viewport.id, await page.screenshot({ fullPage: false }));
      const result = {
        id: viewport.id,
        loadingCounts,
        accessibility,
        layout,
        workflow,
        drawer,
        review,
        plan,
        decisionRequests,
        digest,
        projectAttention,
        transitionCue,
        desktopAlerts,
        currentPlanContext,
        failedCheckRepair,
        multiRootRepository,
        projectRules,
        projectQualityBars,
        savedResultComparison,
        errors,
      };
      result.failures = acceptanceFailures(result);
      results.push(result);
    } catch (error) {
      screenshots.set(
        `${viewport.id}-error`,
        await page.screenshot({ fullPage: false }).catch(() => Buffer.from("")),
      );
      results.push({
        id: viewport.id,
        errors,
        failures: [error instanceof Error ? error.message : String(error)],
      });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

await Promise.all(
  [...screenshots]
    .filter(([, contents]) => contents.length > 0)
    .map(([name, contents]) =>
      writeFile(path.join(OUTPUT_DIRECTORY, `${name}.png`), contents),
    ),
);

const report = {
  checkedAt: new Date().toISOString(),
  url: assertLocalAcceptanceUrl(BASE_URL),
  browser: path.basename(executablePath),
  fixture: FIXTURE_ID,
  privacy:
    "Screenshots and report contain synthetic structural fixture data only.",
  host: `${os.platform()} ${os.release()}`,
  viewports: VIEWPORTS,
  results,
};
await writeFile(
  path.join(OUTPUT_DIRECTORY, "report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

for (const result of results) {
  const statusLabel = result.failures.length ? "FAIL" : "PASS";
  console.log(`${statusLabel} ${result.id}`);
  for (const failure of result.failures) console.error(`  - ${failure}`);
}

if (results.some((result) => result.failures.length)) process.exitCode = 1;
