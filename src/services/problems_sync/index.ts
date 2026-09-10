import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { z } from "zod/v4";
import { Problem } from "../../data/db/models/problem";
import { SyncState } from "../../data/db/models/sync_state";
import { Assignment } from "../../data/db/models/assignment";
import { AssignmentSolution } from "../../data/db/models/assignment_solution";
import { envVars, logger } from "../../config";
import {
  PROBLEMS_SYNC_STATE_ID,
  ASSIGNMENT_DIFFICULTY,
  ASSIGNMENT_ACCESS_LEVEL,
} from "../../utils";
import type { ProblemsSyncJobPayload } from "../job_queue";
import { Pool } from 'pg';
import { executeTestInIsolatedSchema, checkDenyList, loadDatasetSql, type TestProblem, type DenyViolation } from "../test_executor";
import TaskQueueClient from "../job_queue";

// ---------------------------------------------------------------------------
// Minimal YAML subset parser.
//
// No YAML dependency is vendored in the gateway, so this module parses only
// the flat subset emitted by problem files: top-level `key: value` scalars,
// `key: |` / `key: |-` block literals, and `key:` + `- item` string lists.
// Anything else (nested maps, anchors, tabs) throws and the file is skipped
// without failing the whole job.
// ---------------------------------------------------------------------------

type Scalar = string | number | boolean | null;

const parseScalar = (raw: string): Scalar => {
  const t = raw.trim();
  if (t === "" || t === "~" || t === "null") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+$/.test(t)) return Number(t);
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    return t
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
};

const parseProblemYamlSubset = (raw: string): Record<string, unknown> => {
  const doc: Record<string, unknown> = {};
  const lines = raw.split("\n");
  let i = 0;

  const indentOf = (line: string): number => line.match(/^ */)![0].length;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      i += 1;
      continue;
    }
    if (line.startsWith(" ") || line.startsWith("\t")) {
      throw new Error(`Unexpected indented line ${i + 1} without a parent key`);
    }
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) throw new Error(`Unparseable line ${i + 1}: ${line}`);
    const key = m[1]!;
    const rest = m[2]!;
    if (key in doc) throw new Error(`Duplicate key: ${key}`);

    if (rest === "|" || rest === "|-" || rest === ">") {
      const keepNewline = rest !== "|-";
      i += 1;
      const block: string[] = [];
      while (
        i < lines.length &&
        (lines[i]!.trim() === "" || indentOf(lines[i]!) > 0)
      ) {
        const bl = lines[i]!;
        block.push(
          bl.trim() === "" ? "" : bl.replace(/^  /, "").replace(/^ /, ""),
        );
        i += 1;
      }
      while (block.length > 0 && block[block.length - 1] === "") block.pop();
      doc[key] = block.join("\n") + (keepNewline ? "\n" : "");
      continue;
    }

    if (rest !== "") {
      doc[key] = parseScalar(rest);
      i += 1;
      continue;
    }

    // `key:` followed by a `- item` list.
    i += 1;
    const items: Scalar[] = [];
    while (i < lines.length && lines[i]!.trim() !== "") {
      const item = lines[i]!;
      const lm = item.match(/^\s+-\s+(.*)$/);
      if (!lm) break;
      items.push(parseScalar(lm[1]!));
      i += 1;
    }
    if (items.length === 0) throw new Error(`Empty block for key: ${key}`);
    doc[key] = items;
  }

  return doc;
};

// ---------------------------------------------------------------------------
// Validation (mirrors schemas/problem-v1.json; strict: LeetCode extras fail)
// ---------------------------------------------------------------------------

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ProblemYamlSchema = z.strictObject({
  id: z.string().regex(UUID_V7_RE, "id must be UUID v7"),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, "slug must be URL-safe"),
  title: z.string().min(1),
  description: z.string().min(1),
  difficulty: z.enum(ASSIGNMENT_DIFFICULTY),
  mode: z.enum(ASSIGNMENT_ACCESS_LEVEL),
  category: z.string().min(1),
  datasets: z.array(z.string().min(1)).default([]),
  sampleInput: z.array(z.string().min(1)).min(1),
  sampleOutput: z.string().min(1),
  initSql: z.string().min(1),
  solutionSql: z.string().min(1),
  validationSql: z.string().min(1).optional(),
  overlaySql: z.string().min(1).optional(),
  orderMatters: z.boolean(),
  origin: z.enum(["first-party", "community"]).default("first-party"),
  contributor: z.string().min(1).optional(),
  author: z.string().min(1),
  license: z.string().min(1),
  schema_version: z.literal(1),
});

type ParsedProblem = z.infer<typeof ProblemYamlSchema>;

export interface ProblemFileChange {
  path: string;
  status: "added" | "modified" | "removed";
  content?: string;
  sha?: string;
}

export interface ProblemsSyncJobData extends ProblemsSyncJobPayload {
  // Test/dev escape hatch: explicit file list bypasses local-dir fetching.
  files?: ProblemFileChange[];
  // Forced-resync HEAD ids when the tree cannot be listed (tests).
  headIds?: string[];
}

export interface ProblemsSyncResult {
  upserted: number;
  skipped: number;
  tombstoned: number;
}

const isProblemPath = (p: string): boolean =>
  p.startsWith("problems/") && p.endsWith(".yaml");

const categoryOf = (p: string): string | null => {
  const parts = p.split("/");
  return parts.length === 3 ? (parts[1] ?? null) : null;
};

const parseAndValidate = (
  raw: string,
  path: string,
): ParsedProblem | null => {
  let doc: Record<string, unknown>;
  try {
    doc = parseProblemYamlSubset(raw);
  } catch (err) {
    logger.warn({ err, path }, "Skipping problem file: unparseable YAML");
    return null;
  }
  const parsed = ProblemYamlSchema.safeParse(doc);
  if (!parsed.success) {
    logger.warn(
      { path, issues: parsed.error.issues.map((x) => x.message) },
      "Skipping problem file: schema validation failed",
    );
    return null;
  }
  if (parsed.data.category !== categoryOf(path)) {
    logger.warn(
      { path, category: parsed.data.category },
      "Skipping problem file: category does not match directory",
    );
    return null;
  }
  return parsed.data;
};

const goldNameFromProblemPath = (problemPath: string): string => {
  const rel = problemPath.replace(/^problems\//, "").replace(/\.ya?ml$/i, "");
  return `${rel.split("/").join("__")}.gold`;
};

export const applyProblemFiles = async (
  files: ProblemFileChange[],
  opts?: {
    gitSha?: string;
    testPool?: Pool;
    datasetsDir?: string;
    goldDir?: string;
  },
): Promise<ProblemsSyncResult> => {
  let upserted = 0;
  let skipped = 0;
  let tombstoned = 0;

  for (const file of files) {
    if (!isProblemPath(file.path)) continue;

    if (file.status === "removed" || file.content == null) {
      if (file.status !== "removed") {
        logger.warn({ path: file.path }, "Skipping problem file: no content");
        skipped += 1;
        continue;
      }
      await Problem.findOneAndUpdate(
        { path: file.path, deletedAt: null },
        {
          $set: {
            deletedAt: new Date(),
            ...(opts?.gitSha === undefined ? {} : { gitSha: opts.gitSha }),
          },
        },
        {},
      );
      tombstoned += 1;
      continue;
    }

    const parsed = parseAndValidate(file.content, file.path);
    if (!parsed) {
      skipped += 1;
      continue;
    }

    // Deny-list enforcement on all SQL fields
    const sqlFields = ['initSql', 'solutionSql', 'validationSql', 'overlaySql'];
    let denyViolations: DenyViolation[] = [];
    for (const field of sqlFields) {
      const sql = (parsed as any)[field];
      if (sql) {
        denyViolations.push(...checkDenyList(sql).map(v => ({ ...v, sql: `${field}: ${v.sql}` })));
      }
    }
    if (denyViolations.length > 0) {
      logger.warn(
        { path: file.path, violations: denyViolations.map(v => v.pattern) },
        "Skipping problem file: deny-list violation",
      );
      skipped += 1;
      continue;
    }

    // Tests before write: run tests in isolated PG schema
    if (opts?.testPool && opts?.datasetsDir) {
      let sampleOutput = parsed.sampleOutput;
      if (opts.goldDir) {
        try {
          sampleOutput = await readFile(
            join(opts.goldDir, goldNameFromProblemPath(file.path)),
            "utf8",
          );
        } catch {
          // YAML sampleOutput is often a header sketch; gold is C2 SoT when present.
        }
      }
      const testProblem: TestProblem = {
        datasets: (parsed.datasets || []).map((slug: string) => ({ slug })),
        overlaySql: parsed.overlaySql,
        initSql: (parsed.datasets || []).length > 0 ? undefined : parsed.initSql,
        solutionSql: parsed.solutionSql,
        validationSql: parsed.validationSql,
        sampleOutput,
        orderMatters: parsed.orderMatters,
        mode: parsed.mode,
      };
      let testResult;
      try {
        testResult = await executeTestInIsolatedSchema(
          testProblem,
          opts.datasetsDir,
          opts.testPool,
        );
      } catch (err) {
        logger.warn(
          { path: file.path, err },
          "Skipping problem file: tests threw (zero DB write)",
        );
        skipped += 1;
        continue;
      }
      if (!testResult.passed) {
        logger.warn(
          { path: file.path, error: testResult.error },
          "Skipping problem file: tests failed (zero DB write)",
        );
        skipped += 1;
        continue;
      }
    }

    try {
      const gitSha = opts?.gitSha ?? file.sha;
      await Problem.findOneAndUpdate(
        { id: parsed.id },
        {
          $set: {
            ...parsed,
            path: file.path,
            ...(gitSha === undefined ? {} : { gitSha }),
            deletedAt: null,
          },
        },
        { upsert: true },
      );
      upserted += 1;
    } catch (err) {
      logger.warn({ err, path: file.path }, "Skipping problem file: upsert failed");
      skipped += 1;
    }
  }

  return { upserted, skipped, tombstoned };
};

export const tombstoneIdsNotIn = async (
  headIds: string[],
): Promise<number> => {
  const stale = await Problem.find(
    { id: { $nin: headIds }, deletedAt: null },
    { id: 1 },
  ).lean();
  if (stale.length === 0) return 0;
  await Problem.updateMany(
    { id: { $in: stale.map((d) => d.id) } },
    { $set: { deletedAt: new Date() } },
  );
  return stale.length;
};

const listLocalProblemFiles = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (abs: string, rel: string) => {
    const entries = await readdir(abs, { withFileTypes: true });
    for (const e of entries) {
      const a = join(abs, e.name);
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) await walk(a, r);
      else if (e.isFile() && r.startsWith("problems/") && r.endsWith(".yaml")) {
        out.push(r.split(sep).join("/"));
      }
    }
  };
  await walk(dir, "");
  return out;
};

const loadLocalChanges = async (
  dir: string,
  data: ProblemsSyncJobPayload,
): Promise<{ files: ProblemFileChange[]; headIds?: string[] }> => {
  if (data.forced) {
    const paths = await listLocalProblemFiles(dir);
    const files: ProblemFileChange[] = [];
    for (const p of paths) {
      try {
        files.push({
          path: p,
          status: "modified",
          content: await readFile(join(dir, p), "utf8"),
        });
      } catch (err) {
        logger.warn({ err, path: p }, "Skipping problem file: unreadable");
      }
    }
    return { files, headIds: undefined };
  }

  const changed = new Map<string, "added" | "modified" | "removed">();
  for (const c of data.commits ?? []) {
    for (const p of c.added ?? []) if (!changed.has(p)) changed.set(p, "added");
    for (const p of c.modified ?? []) if (!changed.has(p)) changed.set(p, "modified");
    for (const p of c.removed ?? []) changed.set(p, "removed");
  }
  const files: ProblemFileChange[] = [];
  for (const [p, status] of changed) {
    if (!isProblemPath(p)) continue;
    if (status === "removed") {
      files.push({ path: p, status });
      continue;
    }
    try {
      files.push({ path: p, status, content: await readFile(join(dir, p), "utf8") });
    } catch (err) {
      logger.warn(
        { err, path: p },
        "Skipping problem file: missing from local dir (GitHub blob fetch is a later slice)",
      );
    }
  }
  return { files };
};

const fetchRemoteChanges = async (
  data: ProblemsSyncJobPayload,
): Promise<ProblemFileChange[]> => {
  // No local fixture dir and no embedded files: without a GitHub App token
  // (later slice) only removals can be applied from the push payload.
  const files: ProblemFileChange[] = [];
  for (const c of data.commits ?? []) {
    for (const p of c.removed ?? []) {
      if (isProblemPath(p)) files.push({ path: p, status: "removed" });
    }
  }
  if ((data.commits ?? []).length > 0 && files.length === 0) {
    try {
      const repo = envVars.GITHUB_PROBLEMS_REPO;
      const sha = data.afterSha;
      if (sha) {
        const res = await fetch(
          `https://raw.githubusercontent.com/${repo}/${sha}/problems`,
          { signal: AbortSignal.timeout(5000) },
        );
        logger.info(
          { repo, sha, status: res.status },
          "Remote problem tree probe (full fetch is a later slice)",
        );
      }
    } catch (err) {
      logger.warn({ err }, "Remote problem probe failed; applying removals only");
    }
  }
  return files;
};

export const processProblemsSyncJob = async (
  data: ProblemsSyncJobData,
): Promise<ProblemsSyncResult> => {
  let files = data.files;
  let headIds = data.headIds;
  const localDir = envVars.GITHUB_PROBLEMS_LOCAL_DIR;

  // Drift handler §2.6: detect force-push / history rewrite via beforeSha vs stored lastSha
  // If beforeSha exists and differs from stored lastSha (and it's not the zero SHA for new branch),
  // trigger full resync from HEAD by setting forced=true and clearing files to force re-listing.
  if (data.beforeSha && data.beforeSha !== "0000000000000000000000000000000000000000") {
    const stored = await SyncState.findOne({ _id: PROBLEMS_SYNC_STATE_ID }).lean();
    if (stored?.lastSha && data.beforeSha !== stored.lastSha) {
      logger.info(
        { beforeSha: data.beforeSha, storedLastSha: stored.lastSha, afterSha: data.afterSha },
        "Drift detected: force-push or history rewrite — triggering full resync from HEAD",
      );
      // Force full resync: behave as if forced=true with no explicit files
      data.forced = true;
      files = undefined;
      headIds = undefined;
    }
  }

  if (!files) {
    if (localDir) {
      const loaded = await loadLocalChanges(localDir, data);
      files = loaded.files;
      if (data.forced && !headIds) {
        headIds = [];
        for (const f of files) {
          if (f.content) {
            const parsed = parseAndValidate(f.content, f.path);
            if (parsed) headIds.push(parsed.id);
          }
        }
      }
    } else {
      files = await fetchRemoteChanges(data);
    }
  }

  // Create test pool for tests-before-write gate
  const { Pool } = await import('pg');
  const testPool = new Pool({
    host: envVars.SANDBOX_PG_HOST,
    port: envVars.SANDBOX_PG_PORT,
    user: envVars.SANDBOX_PG_USER,
    password: envVars.SANDBOX_PG_PASSWORD,
    database: envVars.SANDBOX_PG_DATABASE,
  });

  // localDir is the problems repo root (problems/ + datasets/ + gold/).
  const datasetsDir = localDir ? join(localDir, "datasets") : "datasets";
  const goldDir = localDir ? join(localDir, "gold") : undefined;

  const result = await applyProblemFiles(files ?? [], {
    gitSha: data.afterSha,
    testPool,
    datasetsDir,
    goldDir,
  });

  // Close test pool after use
  await testPool.end();

  // After tests pass and problems upserted, create Assignment + AssignmentSolution + enqueue seed job
  if (result.upserted > 0 && files) {
    for (const file of files) {
      if (!isProblemPath(file.path) || file.status === 'removed' || !file.content) continue;
      const parsed = parseAndValidate(file.content, file.path);
      if (!parsed) continue;

      try {
        let initSql = "";
        for (const slug of parsed.datasets || []) {
          const ds = await loadDatasetSql(slug, datasetsDir);
          initSql += `${ds.schema}\n${ds.seed}\n`;
        }
        if (parsed.overlaySql) initSql += `${parsed.overlaySql}\n`;
        if (!(parsed.datasets || []).length && parsed.initSql) {
          initSql += `${parsed.initSql}\n`;
        }

        // Create Assignment
        const assignment = await Assignment.findOneAndUpdate(
          { title: parsed.title },
          {
            $set: {
              title: parsed.title,
              description: parsed.description,
              difficulty: parsed.difficulty,
              mode: parsed.mode,
              sampleInput: parsed.sampleInput,
              sampleOutput: parsed.sampleOutput,
              pgSchemaReady: false,
              origin: parsed.origin,
              contributor: parsed.contributor,
            },
          },
          { upsert: true, new: true },
        );

        // Create AssignmentSolution
        await AssignmentSolution.findOneAndUpdate(
          { assignmentId: assignment._id },
          {
            $set: {
              assignmentId: assignment._id,
              solutionSql: parsed.solutionSql,
              validationSql: parsed.validationSql,
              initSql,
              orderMatters: parsed.orderMatters,
            },
          },
          { upsert: true },
        );

        // Enqueue admin seed job
        await TaskQueueClient.enqueueAdminAssignmentSeedJob({
          assignmentId: assignment._id,
          initSql,
        });

        logger.info({ assignmentId: assignment._id }, "Created Assignment + AssignmentSolution + enqueued seed job");
      } catch (err) {
        logger.error({ err, problemId: parsed.id }, "Failed to create Assignment/Solution/seed job");
      }
    }
  }

  if (data.forced && headIds) {
    result.tombstoned += await tombstoneIdsNotIn(headIds);
  }

  try {
    await SyncState.findOneAndUpdate(
      { _id: PROBLEMS_SYNC_STATE_ID },
      {
        $set: {
          repo: envVars.GITHUB_PROBLEMS_REPO,
          lastSha: data.afterSha,
          lastDeliveryId: data.deliveryId,
          lastSyncAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (err) {
    logger.error({ err }, "Failed to update problems sync_state");
    throw err;
  }

  logger.info(
    { deliveryId: data.deliveryId, ...result },
    "Problems sync job done",
  );
  return result;
};
