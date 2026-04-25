/**
 * reporter.ts — Playwright results parser and bug-report emitter.
 *
 * The closing-the-loop module for AutoQA: after `autoqa run` executes the
 * generated spec files via Playwright's JSON reporter, this module:
 *
 *   1. Parses the raw JSON output into a flat list of structured
 *      `BugReport` records (one per failed / timed-out / interrupted test).
 *   2. Renders a systematic Markdown bug report — every entry follows the
 *      classic QA shape: Expected Result, Actual Result, Error Trace.
 *   3. Optionally pushes each failure to the Supabase `bug_reports` table
 *      via the existing service-role client, so a downstream dashboard
 *      can surface them live.
 *
 * Design notes:
 * - Defensive JSON parsing: the Playwright reporter shape has shifted a
 *   few times between minor versions, so we read only the fields we need
 *   and tolerate missing/extra properties.
 * - ANSI escape codes are stripped from messages and stack traces — they
 *   render as garbage in Markdown and Supabase text columns.
 * - The matrix test-case id is lifted out of the test title when present
 *   (our test-writer prompts Claude to prefix every `test(...)` title
 *   with `TC-NNN`), so each bug can be traced back to the matrix row
 *   that defined it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../utils/supabase-client.js';

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

/** A single failing-test record ready to render or push. */
export interface BugReport {
  /** Matrix case id extracted from the test title (e.g. "TC-001"), or a synthetic id. */
  testId: string;
  /** The raw `test(...)` title. */
  title: string;
  /** `describe › nested › test` path for context. */
  fullTitle: string;
  /** `describe › nested` parent chain, if any. */
  describePath?: string;
  /** Absolute or workspace-relative spec file. */
  file?: string;
  /** Line in the spec file where the test starts. */
  line?: number;
  /** Column in the spec file where the test starts. */
  column?: number;
  /** The Playwright status for the last attempt. */
  status: 'failed' | 'timedOut' | 'interrupted';
  /** Human-readable "what should have happened". */
  expected: string;
  /** Human-readable "what actually happened". */
  actual: string;
  /** First line of the Playwright assertion / error message. */
  errorMessage?: string;
  /** Full (truncated) error stack trace with ANSI codes stripped. */
  errorStack?: string;
  /** Duration of the failing test run, in milliseconds. */
  durationMs?: number;
  /** ISO timestamp when this report was generated. */
  capturedAt: string;
}

/** Overall summary of a Playwright run, including all failing reports. */
export interface BugReportSummary {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  flakyTests: number;
  skippedTests: number;
  durationMs: number;
  reports: BugReport[];
  runAt: string;
}

/* ------------------------------------------------------------------ */
/*  Playwright JSON reporter — minimal shape                           */
/* ------------------------------------------------------------------ */

interface PwError {
  message?: string;
  stack?: string;
  snippet?: string;
  location?: { file?: string; line?: number; column?: number };
  value?: string;
}

interface PwTestResult {
  status?: string;
  duration?: number;
  error?: PwError;
  errors?: PwError[];
}

interface PwTest {
  projectName?: string;
  results?: PwTestResult[];
  expectedStatus?: string;
}

interface PwSpec {
  title: string;
  ok?: boolean;
  file?: string;
  line?: number;
  column?: number;
  tests?: PwTest[];
}

interface PwSuite {
  title?: string;
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}

interface PwReport {
  stats?: {
    expected?: number;
    unexpected?: number;
    skipped?: number;
    flaky?: number;
    duration?: number;
  };
  suites?: PwSuite[];
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string): string => s.replace(ANSI_RE, '');

/**
 * Parse a raw Playwright JSON reporter payload (or an already-parsed
 * object) into a flat, sortable summary of failing tests.
 *
 * Throws if `raw` is a string and not valid JSON.
 */
export function parsePlaywrightResults(raw: string | PwReport): BugReportSummary {
  const json: PwReport = typeof raw === 'string' ? (JSON.parse(raw) as PwReport) : raw;
  const runAt = new Date().toISOString();
  const reports: BugReport[] = [];

  let testCounter = 0;

  const walk = (suites: PwSuite[] | undefined, parents: string[]): void => {
    if (!suites || suites.length === 0) return;

    for (const suite of suites) {
      const parentPath = suite.title ? [...parents, suite.title] : [...parents];

      for (const spec of suite.specs ?? []) {
        for (const t of spec.tests ?? []) {
          testCounter += 1;

          const results = t.results ?? [];
          // Use the last attempt — Playwright records retries in order.
          const result = results.length > 0 ? results[results.length - 1] : undefined;
          if (!result) continue;

          const status = result.status;
          if (
            status !== 'failed' &&
            status !== 'timedOut' &&
            status !== 'interrupted'
          ) {
            continue;
          }

          const err = result.error ?? (result.errors ?? [])[0];
          const describePath = parentPath.join(' › ');
          const fullTitle = [...parentPath, spec.title].filter(Boolean).join(' › ');

          reports.push({
            testId: extractMatrixId(spec.title) ?? `TC-${String(testCounter).padStart(3, '0')}`,
            title: spec.title,
            fullTitle,
            describePath: describePath || undefined,
            file: spec.file ?? suite.file,
            line: spec.line,
            column: spec.column,
            status: status as BugReport['status'],
            expected: deriveExpected(spec.title),
            actual: deriveActual(err, status),
            errorMessage: err?.message ? stripAnsi(err.message).slice(0, 4000) : undefined,
            errorStack: err?.stack ? stripAnsi(err.stack).slice(0, 8000) : undefined,
            durationMs: result.duration,
            capturedAt: runAt,
          });
        }
      }

      walk(suite.suites, parentPath);
    }
  };

  walk(json.suites, []);

  const stats = json.stats ?? {};
  const expected = stats.expected ?? 0;
  const unexpected = stats.unexpected ?? reports.length;
  const flaky = stats.flaky ?? 0;
  const skipped = stats.skipped ?? 0;

  return {
    totalTests: expected + unexpected + flaky + skipped,
    passedTests: expected,
    failedTests: unexpected,
    flakyTests: flaky,
    skippedTests: skipped,
    durationMs: stats.duration ?? 0,
    reports,
    runAt,
  };
}

/**
 * Render a `BugReportSummary` as a systematic Markdown document —
 * header block with run stats, then one section per failure with
 * Expected Result / Actual Result / Error Trace.
 */
export function renderBugReportMarkdown(summary: BugReportSummary): string {
  const lines: string[] = [];

  lines.push('# AutoQA Bug Report');
  lines.push('');
  lines.push(`> **Run at:** ${summary.runAt}`);
  lines.push(`> **Duration:** ${(summary.durationMs / 1000).toFixed(2)}s`);
  lines.push(
    `> **Totals:** ${summary.totalTests} total · ` +
      `${summary.passedTests} passed · ` +
      `${summary.failedTests} failed · ` +
      `${summary.flakyTests} flaky · ` +
      `${summary.skippedTests} skipped`,
  );
  lines.push('');

  if (summary.reports.length === 0) {
    lines.push('## Result');
    lines.push('');
    lines.push('All tests passed. No bug reports to file.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('## Summary');
  lines.push('');
  lines.push('| # | ID | Title | Status | Duration |');
  lines.push('|---|----|-------|--------|----------|');
  summary.reports.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | ${r.testId} | ${escapeMd(r.title)} | ${r.status} | ${r.durationMs ?? '-'}ms |`,
    );
  });
  lines.push('');

  lines.push('## Failures');
  lines.push('');

  summary.reports.forEach((r, i) => {
    lines.push(`### ${i + 1}. ${r.testId} — ${escapeMd(r.title)}`);
    lines.push('');
    if (r.describePath) lines.push(`- **Section:** ${escapeMd(r.describePath)}`);
    if (r.file) {
      const loc = r.line ? `${r.file}:${r.line}` : r.file;
      lines.push(`- **File:** \`${loc}\``);
    }
    lines.push(`- **Status:** \`${r.status}\``);
    if (r.durationMs !== undefined) lines.push(`- **Duration:** ${r.durationMs}ms`);
    lines.push('');

    lines.push('**Expected Result:**');
    lines.push('');
    lines.push(`> ${escapeMd(r.expected)}`);
    lines.push('');

    lines.push('**Actual Result:**');
    lines.push('');
    lines.push(`> ${escapeMd(r.actual)}`);
    lines.push('');

    if (r.errorMessage) {
      lines.push('**Error Message:**');
      lines.push('');
      lines.push('```');
      lines.push(r.errorMessage);
      lines.push('```');
      lines.push('');
    }

    if (r.errorStack) {
      lines.push('**Error Trace:**');
      lines.push('');
      lines.push('```');
      lines.push(r.errorStack);
      lines.push('```');
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}

/**
 * Push every failing report in `summary` to the Supabase `bug_reports`
 * table. Safe to call when there are zero failures (returns 0 without
 * touching the client).
 *
 * Expected table shape (create this in Supabase before using):
 *
 *   create table bug_reports (
 *     id             uuid primary key default gen_random_uuid(),
 *     test_id        text,
 *     test_title     text not null,
 *     full_title     text,
 *     describe_path  text,
 *     source_spec    text,
 *     line           integer,
 *     "column"       integer,
 *     status         text not null,
 *     expected       text,
 *     actual         text,
 *     error_message  text,
 *     error_stack    text,
 *     duration_ms    integer,
 *     captured_at    timestamptz,
 *     run_at         timestamptz not null default now()
 *   );
 *
 * Returns the number of rows inserted.
 */
export async function pushBugReportsToSupabase(
  summary: BugReportSummary,
): Promise<number> {
  if (summary.reports.length === 0) return 0;

  const supabase: SupabaseClient = getSupabaseClient();

  const rows = summary.reports.map((r) => ({
    test_id: r.testId,
    test_title: r.title,
    full_title: r.fullTitle,
    describe_path: r.describePath ?? null,
    source_spec: r.file ?? null,
    line: r.line ?? null,
    column: r.column ?? null,
    status: r.status,
    expected: r.expected,
    actual: r.actual,
    error_message: r.errorMessage ?? null,
    error_stack: r.errorStack ?? null,
    duration_ms: r.durationMs ?? null,
    captured_at: r.capturedAt,
    run_at: summary.runAt,
  }));

  const { error } = await supabase.from('bug_reports').insert(rows);
  if (error) {
    throw new Error(`Supabase insert failed: ${error.message}`);
  }
  return rows.length;
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

/** Lift a matrix id out of a test title like `"TC-001 — Submit login"`. */
function extractMatrixId(title: string): string | undefined {
  const m = title.match(/\bTC-\d{2,}\b/);
  return m?.[0];
}

/** Derive a human-readable "expected" sentence from the test title. */
function deriveExpected(title: string): string {
  const m = title.match(/^\s*TC-\d+\s*[—\-–:]\s*(.+)$/);
  const summary = (m?.[1] ?? title).trim();
  return `"${summary}" should complete with every assertion satisfied.`;
}

/** Derive a human-readable "actual" sentence from the error payload. */
function deriveActual(err: PwError | undefined, status: string): string {
  if (status === 'timedOut') {
    return 'Test timed out before reaching a final assertion.';
  }
  if (status === 'interrupted') {
    return 'Test was interrupted before reaching a final assertion.';
  }
  if (err?.message) {
    const firstLine = stripAnsi(err.message)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    if (firstLine) return firstLine.slice(0, 500);
  }
  return 'Test failed (no error message recorded).';
}

/** Escape characters that would break a Markdown table cell / blockquote. */
function escapeMd(s: string): string {
  return s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}
