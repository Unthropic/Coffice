import { constants, accessSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const THREAD_TABLE = "threads";
const DATABASE_TIMEOUT_MS = 1_000;
const MAX_DISPLAY_TITLE_LENGTH = 160;

const REQUIRED_THREAD_COLUMNS = [
  "id",
  "title",
  "name",
  "cwd",
  "created_at",
  "updated_at",
  "thread_source",
  "archived",
  "preview",
] as const;

const VISIBLE_THREADS_QUERY = `
  SELECT
    id,
    title,
    name,
    cwd,
    created_at,
    updated_at,
    thread_source
  FROM ${THREAD_TABLE}
  WHERE archived = 0
    AND preview <> ''
    AND (thread_source IS NULL OR thread_source = 'user')
  ORDER BY updated_at DESC, id ASC
`;

export type CodexThreadTimestamp = number | string | null;

export interface CodexVisibleThread {
  id: string;
  title: string | null;
  name: string | null;
  cwd: string | null;
  createdAt: CodexThreadTimestamp;
  updatedAt: CodexThreadTimestamp;
  threadSource: "user" | null;
}

export type CodexThreadStateResult =
  | { status: "ready"; threads: CodexVisibleThread[] }
  | { status: "missing" }
  | { status: "unsupported" }
  | { status: "unavailable" };

type SqliteRecord = Record<string, unknown>;

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function hasSupportedSchema(database: DatabaseSync): boolean {
  const rows = database
    .prepare("SELECT name FROM pragma_table_info('threads')")
    .all() as SqliteRecord[];
  const columns = new Set(
    rows.flatMap((row) => (typeof row.name === "string" ? [row.name] : [])),
  );

  return REQUIRED_THREAD_COLUMNS.every((column) => columns.has(column));
}

function conciseDisplayTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const title = value.replace(/\s+/g, " ").trim();
  if (
    title.length === 0 ||
    /<\/?[a-z][^>]*>/i.test(title) ||
    /codex_delegation/i.test(title)
  ) {
    return null;
  }

  if (title.length <= MAX_DISPLAY_TITLE_LENGTH) return title;
  return `${title.slice(0, MAX_DISPLAY_TITLE_LENGTH - 1).trimEnd()}…`;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function timestamp(value: unknown): CodexThreadTimestamp {
  return typeof value === "number" || typeof value === "string" ? value : null;
}

function visibleThread(row: SqliteRecord): CodexVisibleThread | undefined {
  if (typeof row.id !== "string" || row.id.length === 0) return undefined;

  return {
    id: row.id,
    title: conciseDisplayTitle(row.title),
    name: conciseDisplayTitle(row.name),
    cwd: nullableText(row.cwd),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    threadSource: row.thread_source === "user" ? "user" : null,
  };
}

/**
 * Reads only the current, user-visible Codex thread metadata needed to build a
 * roster. The database is Codex-owned and is always opened read-only.
 */
export function readCodexThreadState(
  databasePath: string,
): CodexThreadStateResult {
  try {
    accessSync(databasePath, constants.R_OK);
  } catch (error) {
    return { status: isMissingFile(error) ? "missing" : "unavailable" };
  }

  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, {
      readOnly: true,
      timeout: DATABASE_TIMEOUT_MS,
    });

    if (!hasSupportedSchema(database)) return { status: "unsupported" };

    const threads = (
      database.prepare(VISIBLE_THREADS_QUERY).all() as SqliteRecord[]
    )
      .map(visibleThread)
      .filter((thread): thread is CodexVisibleThread => thread !== undefined);

    return { status: "ready", threads };
  } catch {
    return { status: "unavailable" };
  } finally {
    database?.close();
  }
}
