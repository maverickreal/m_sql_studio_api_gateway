import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../../config';

// Test execution config
const STATEMENT_TIMEOUT_MS = 5000;

// Deny-list patterns
export const SQL_DENY_PATTERNS = [
  { pattern: /\bCOPY\b/i, name: 'COPY' },
  { pattern: /\bGRANT\b/i, name: 'GRANT' },
  { pattern: /\bREVOKE\b/i, name: 'REVOKE' },
  { pattern: /\bALTER\s+SYSTEM\b/i, name: 'ALTER SYSTEM' },
  { pattern: /\bSET\s+ROLE\b/i, name: 'SET ROLE' },
  { pattern: /\bSET\s+SESSION\s+AUTHORIZATION\b/i, name: 'SET SESSION AUTHORIZATION' },
  { pattern: /\bCREATE\s+EXTENSION\b/i, name: 'CREATE EXTENSION' },
  { pattern: /\bdblink\b/i, name: 'dblink' },
  { pattern: /\bfile_fdw\b/i, name: 'file_fdw' },
  { pattern: /\bpg_read_file\b/i, name: 'pg_read_file' },
  { pattern: /\bpg_ls_dir\b/i, name: 'pg_ls_dir' },
  { pattern: /\blo_import\b/i, name: 'lo_import' },
  { pattern: /\blo_export\b/i, name: 'lo_export' },
  { pattern: /\bCOPY\s+.*TO\s+PROGRAM\b/i, name: 'COPY TO PROGRAM' },
  { pattern: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i, name: 'DROP TABLE/DATABASE/SCHEMA' },
  { pattern: /\bALTER\s+TABLE\b/i, name: 'ALTER TABLE' },
];

export interface DatasetRef {
  slug: string;
}

export interface TestProblem {
  datasets: DatasetRef[];
  overlaySql?: string;
  initSql?: string;
  solutionSql: string;
  validationSql?: string;
  sampleOutput?: string;
  orderMatters: boolean;
  mode: 'read' | 'write';
}

export interface TestResult {
  passed: boolean;
  error?: string;
}

export interface DenyViolation {
  pattern: string;
  sql: string;
}

export function checkDenyList(sqlContent: string): DenyViolation[] {
  const violations: DenyViolation[] = [];
  if (!sqlContent) return violations;
  for (const { pattern, name } of SQL_DENY_PATTERNS) {
    if (pattern.test(sqlContent)) {
      violations.push({ pattern: name, sql: sqlContent.substring(0, 200) });
    }
  }
  return violations;
}

export async function loadDatasetSql(slug: string, datasetsDir: string): Promise<{ schema: string; seed: string }> {
  const schemaPath = join(datasetsDir, slug, 'schema.sql');
  const seedPath = join(datasetsDir, slug, 'seed.sql');
  const schema = await readFile(schemaPath, 'utf8');
  const seed = await readFile(seedPath, 'utf8');
  return { schema, seed };
}

export async function executeTestInIsolatedSchema(
  problem: TestProblem,
  datasetsDir: string,
  pool: Pool,
): Promise<TestResult> {
  // Use crypto.randomUUID for deterministic unique schema names
  const { randomUUID } = await import('crypto');
  const schemaName = `test_${randomUUID().replace(/-/g, '_')}`;
  const client = await pool.connect();
  try {
    // Create isolated schema
    await client.query(`CREATE SCHEMA "${schemaName}"`);
    await client.query(`SET search_path TO "${schemaName}"`);
    await client.query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`);

    // Apply datasets
    for (const ds of problem.datasets) {
      const { schema, seed } = await loadDatasetSql(ds.slug, datasetsDir);
      await client.query(schema);
      await client.query(seed);
    }

    // Apply overlay SQL
    if (problem.overlaySql) {
      await client.query(problem.overlaySql);
    }

    // Apply init SQL
    if (problem.initSql) {
      await client.query(problem.initSql);
    }

    // Check deny-list on all SQL
    const allSql = [
      ...problem.datasets.map(d => `dataset:${d.slug}`),
      problem.overlaySql,
      problem.initSql,
      problem.solutionSql,
      problem.validationSql,
    ].filter(Boolean).join('\n');
    
    const denyViolations = checkDenyList(allSql);
    if (denyViolations.length > 0) {
      return {
        passed: false,
        error: `Deny-list hit: ${denyViolations.map(v => v.pattern).join(', ')}`,
      };
    }

    // Execute solution
    try {
      const result = await client.query(problem.solutionSql);
      
      if (problem.mode === 'read') {
        if (problem.sampleOutput) {
          const cell = (v: unknown): string => {
            if (v instanceof Date) return v.toISOString().slice(0, 10);
            if (v == null) return "";
            return String(v);
          };
          const stripGoldNoise = (s: string): string =>
            s
              .split("\n")
              .filter((l) => !/^(psql:|ERROR:|DETAIL:)/.test(l))
              .join("\n")
              .trim();
          const actualRows = result.rows
            .map((r) => Object.values(r).map(cell).join("\t"))
            .join("\n");
          const expected = stripGoldNoise(problem.sampleOutput);
          const actual = actualRows.trim();
          
          if (problem.orderMatters) {
            if (actual !== expected) {
              return { passed: false, error: `Output mismatch (order matters).\nExpected:\n${expected}\nActual:\n${actual}` };
            }
          } else {
            // Order-independent comparison
            const expectedLines = expected.split('\n').sort();
            const actualLines = actual.split('\n').sort();
            if (expectedLines.length !== actualLines.length || !expectedLines.every((l, i) => l === actualLines[i])) {
              return { passed: false, error: `Output mismatch.\nExpected:\n${expected}\nActual:\n${actual}` };
            }
          }
        }
      } else if (problem.mode === 'write') {
        // Run validation SQL
        if (problem.validationSql) {
          const valResult = await client.query(problem.validationSql);
          if (valResult.rows.length === 0 || (valResult.rows[0] as any).correct === 0) {
            return { passed: false, error: 'Validation SQL returned incorrect result' };
          }
        }
      }

      return { passed: true };
    } catch (execErr: any) {
      return { passed: false, error: `Execution failed: ${execErr.message}` };
    }
  } finally {
    // Cleanup
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } catch (cleanupErr) {
      logger.warn({ cleanupErr }, 'Failed to cleanup test schema');
    }
    client.release();
  }
}
