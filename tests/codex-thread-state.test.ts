import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { readCodexThreadState } from "../src/lib/codex-thread-state";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "coffice-thread-state-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createDatabase(databasePath: string): DatabaseSync {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      title TEXT,
      name TEXT,
      cwd TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      thread_source TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      preview TEXT,
      first_user_message TEXT
    )
  `);
  return database;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("readCodexThreadState", () => {
  it("returns only current user-visible threads and preserves safe metadata", () => {
    const directory = temporaryDirectory();
    const databasePath = path.join(directory, "state.sqlite");
    const database = createDatabase(databasePath);
    const insert = database.prepare(`
      INSERT INTO threads (
        id, title, name, cwd, created_at, updated_at, thread_source,
        archived, preview, first_user_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      "visible-user",
      "Build the Langflow canvas",
      "Langflow Builder",
      "C:\\Projects\\Langflow",
      101,
      201,
      "user",
      0,
      "Visible preview marker",
      "private prompt must not be returned",
    );
    insert.run(
      "visible-null-source",
      "Review the connector",
      null,
      "C:\\Projects\\Langflow",
      102,
      202,
      null,
      0,
      "Visible preview marker",
      "another private prompt",
    );
    insert.run(
      "archived",
      "Archived task",
      "Old task",
      "C:\\Projects\\Langflow",
      103,
      203,
      "user",
      1,
      "Visible preview marker",
      "private",
    );
    insert.run(
      "blank-preview",
      "Hidden task",
      "Hidden task",
      "C:\\Projects\\Langflow",
      104,
      204,
      "user",
      0,
      "",
      "private",
    );
    insert.run(
      "subagent",
      "Internal helper",
      "Helper",
      "C:\\Projects\\Langflow",
      105,
      205,
      "subagent",
      0,
      "Visible preview marker",
      "private",
    );
    database.close();

    const result = readCodexThreadState(databasePath);

    expect(result).toEqual({
      status: "ready",
      threads: [
        {
          id: "visible-null-source",
          title: "Review the connector",
          name: null,
          cwd: "C:\\Projects\\Langflow",
          createdAt: 102,
          updatedAt: 202,
          threadSource: null,
        },
        {
          id: "visible-user",
          title: "Build the Langflow canvas",
          name: "Langflow Builder",
          cwd: "C:\\Projects\\Langflow",
          createdAt: 101,
          updatedAt: 201,
          threadSource: "user",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("private prompt");
    expect(JSON.stringify(result)).not.toContain("preview");

    const renamedPath = path.join(directory, "closed.sqlite");
    renameSync(databasePath, renamedPath);
    expect(renamedPath).toContain("closed.sqlite");
  });

  it("distinguishes a missing database from an unsupported schema", () => {
    const directory = temporaryDirectory();
    const missingPath = path.join(directory, "missing.sqlite");

    expect(readCodexThreadState(missingPath)).toEqual({ status: "missing" });

    const unsupportedPath = path.join(directory, "unsupported.sqlite");
    const database = new DatabaseSync(unsupportedPath);
    database.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT)");
    database.close();

    expect(readCodexThreadState(unsupportedPath)).toEqual({
      status: "unsupported",
    });
  });

  it("normalizes display titles while rejecting internal markup", () => {
    const directory = temporaryDirectory();
    const databasePath = path.join(directory, "state.sqlite");
    const database = createDatabase(databasePath);
    const insert = database.prepare(`
      INSERT INTO threads (
        id, title, name, cwd, created_at, updated_at, thread_source,
        archived, preview, first_user_message
      ) VALUES (?, ?, ?, ?, ?, ?, 'user', 0, 'visible', 'private')
    `);

    insert.run(
      "multiline",
      "First line\nsecond display-title line",
      "  Human-readable name  ",
      "C:\\Projects\\Langflow",
      1,
      1,
    );
    insert.run(
      "markup",
      "<codex_delegation>implement this task</codex_delegation>",
      "<agent>internal helper</agent>",
      "C:\\Projects\\Langflow",
      2,
      2,
    );
    insert.run(
      "oversized",
      "T".repeat(161),
      "N".repeat(161),
      "C:\\Projects\\Langflow",
      3,
      3,
    );
    database.close();

    expect(readCodexThreadState(databasePath)).toEqual({
      status: "ready",
      threads: [
        {
          id: "oversized",
          title: `${"T".repeat(159)}…`,
          name: `${"N".repeat(159)}…`,
          cwd: "C:\\Projects\\Langflow",
          createdAt: 3,
          updatedAt: 3,
          threadSource: "user",
        },
        {
          id: "markup",
          title: null,
          name: null,
          cwd: "C:\\Projects\\Langflow",
          createdAt: 2,
          updatedAt: 2,
          threadSource: "user",
        },
        {
          id: "multiline",
          title: "First line second display-title line",
          name: "Human-readable name",
          cwd: "C:\\Projects\\Langflow",
          createdAt: 1,
          updatedAt: 1,
          threadSource: "user",
        },
      ],
    });
  });

  it("reports an existing non-database path as unavailable", () => {
    const directory = temporaryDirectory();

    expect(readCodexThreadState(directory)).toEqual({ status: "unavailable" });
  });
});
