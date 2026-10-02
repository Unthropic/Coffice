import type { AttentionDisposition, AttentionItem } from "./attention-inbox";

export type AttentionDigestCategory =
  "needs_reply" | "needs_decision" | "unread_results" | "other_actions";

export interface AttentionDigestCounts {
  needsReply: number;
  needsDecision: number;
  unreadResults: number;
  otherActions: number;
  total: number;
}

export interface AttentionDigestEntry {
  item: AttentionItem;
  category: AttentionDigestCategory;
}

export interface AttentionDigestGroup {
  key: string;
  projectId: string | null;
  projectName: string;
  items: readonly AttentionDigestEntry[];
  counts: AttentionDigestCounts;
}

export interface AttentionDigest {
  groups: readonly AttentionDigestGroup[];
  counts: AttentionDigestCounts;
}

export interface AttentionProjectRoute {
  id: string;
  name: string;
}

export interface AttentionProjectProjection {
  digest: AttentionDigest;
  byProjectId: ReadonlyMap<string, AttentionDigestGroup>;
}

export const ATTENTION_DIGEST_HOLDING_GROUP_KEY = "__holding__";
export const ATTENTION_DIGEST_HOLDING_GROUP_NAME = "Holding area";

function emptyCounts(): AttentionDigestCounts {
  return {
    needsReply: 0,
    needsDecision: 0,
    unreadResults: 0,
    otherActions: 0,
    total: 0,
  };
}

function increment(
  counts: AttentionDigestCounts,
  category: AttentionDigestCategory,
): void {
  counts.total += 1;
  if (category === "needs_reply") counts.needsReply += 1;
  else if (category === "needs_decision") counts.needsDecision += 1;
  else if (category === "unread_results") counts.unreadResults += 1;
  else counts.otherActions += 1;
}

function categoryFor(
  item: AttentionItem,
  disposition: AttentionDisposition | undefined,
): AttentionDigestCategory {
  if (item.kind === "needs_input") return "needs_reply";
  if (item.kind === "decision_needed") return "needs_decision";
  if (item.kind === "ready_for_review" && !disposition) {
    return "unread_results";
  }
  return "other_actions";
}

interface MutableAttentionDigestGroup {
  key: string;
  projectId: string | null;
  projectName: string;
  items: AttentionDigestEntry[];
  counts: AttentionDigestCounts;
}

/**
 * Groups the already ordered, currently actionable Attention items. The first
 * appearance of a project determines its group position, so the inbox's
 * priority order remains authoritative without a second sorting policy.
 */
export function selectAttentionDigest(
  items: readonly AttentionItem[],
  dispositionFor: (eventKey: string) => AttentionDisposition | undefined = () =>
    undefined,
): AttentionDigest {
  const counts = emptyCounts();
  const groups = new Map<string, MutableAttentionDigestGroup>();
  const seenEventKeys = new Set<string>();

  for (const item of items) {
    if (seenEventKeys.has(item.eventKey)) continue;
    seenEventKeys.add(item.eventKey);

    const hasProject = Boolean(item.projectId.trim());
    const key = hasProject
      ? `project:${item.projectId}`
      : ATTENTION_DIGEST_HOLDING_GROUP_KEY;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        projectId: hasProject ? item.projectId : null,
        projectName:
          hasProject && item.projectName.trim()
            ? item.projectName
            : ATTENTION_DIGEST_HOLDING_GROUP_NAME,
        items: [],
        counts: emptyCounts(),
      };
      groups.set(key, group);
    }

    const category = categoryFor(item, dispositionFor(item.eventKey));
    group.items.push({ item, category });
    increment(group.counts, category);
    increment(counts, category);
  }

  return { groups: [...groups.values()], counts };
}

/**
 * Projects the canonical Attention items into exact project routes without
 * applying another admission policy. Non-empty item project IDs remain the
 * sole ownership key, including the synthetic projectless route ID. Visible
 * routes with no current items are retained with zero counts for shared UI
 * rollups.
 */
export function selectAttentionProjectProjection(
  items: readonly AttentionItem[],
  visibleProjects: readonly AttentionProjectRoute[] = [],
  dispositionFor: (eventKey: string) => AttentionDisposition | undefined = () =>
    undefined,
): AttentionProjectProjection {
  const digest = selectAttentionDigest(items, dispositionFor);
  const byProjectId = new Map<string, AttentionDigestGroup>();

  for (const group of digest.groups) {
    if (group.projectId !== null) byProjectId.set(group.projectId, group);
  }

  for (const project of visibleProjects) {
    if (!project.id.trim() || byProjectId.has(project.id)) continue;
    byProjectId.set(project.id, {
      key: `project:${project.id}`,
      projectId: project.id,
      projectName: project.name.trim() || project.id,
      items: [],
      counts: emptyCounts(),
    });
  }

  return { digest, byProjectId };
}
