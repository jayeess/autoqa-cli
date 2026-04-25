/**
 * `autoqa run` command handler.
 *
 * Spawns Playwright with the JSON reporter, captures the payload from
 * stdout (Playwright still prints JSON on non-zero exit when tests
 * fail — that's the whole point of the reporter), and pipes it through
 * `core/reporter.ts` to produce a Markdown bug report. Optionally
 * pushes every failing case to Supabase via the existing
 * service-role client.
 *
 * This closes the loop on AutoQA's pipeline:
 *    scan → generate-matrix → write-tests → run → bug report
 */

import { spawn } from 'node:child_process';
import ora from 'ora';

import {
  parsePlaywrightResults,
  renderBugReportMarkdown,
  pushBugReportsToSupabase,
  type BugReportSummary,
} from '../core/reporter.js';
import { writeText } from '../utils/file-io.js';
import { isSupabaseConfigured } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';

export interface RunCommandOptions {
  /** Optional spec file / glob to forward to Playwright. */
  spec?: string;
  /** Output path for the rendered Markdown bug report. */
  output: string;
  /** Push failing reports to the Supabase `bug_reports` table. */
  pushSupabase?: boolean;
  /** Optional explicit Playwright config file. */
  config?: string;
}

export async function runTests(options: RunCommandOptions): Promise<void> {
  logger.section('run');
  if (options.spec) logger.info(`Spec:    ${options.spec}`);
  if (options.config) logger.info(`Config:  ${options.config}`);
  logger.info(`Output:  ${options.output}`);
  logger.info(`Push to Supabase: ${options.pushSupabase ? 'yes' : 'no'}`);

  if (options.pushSupabase && !isSupabaseConfigured()) {
    logger.error(
      '--push-supabase was provided but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. ' +
        'Add them to .env (see .env.example).',
    );
    process.exitCode = 1;
    return;
  }

  const spinner = ora({
    text: 'Executing Playwright test suite…',
    color: 'cyan',
  }).start();

  let jsonPayload: string;
  try {
    jsonPayload = await runPlaywright(options);
  } catch (err) {
    spinner.stop();
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Playwright invocation failed: ${message}`);
    process.exitCode = 1;
    return;
  }

  spinner.stop();

  let summary: BugReportSummary;
  try {
    summary = parsePlaywrightResults(jsonPayload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to parse Playwright JSON output: ${message}`);
    process.exitCode = 1;
    return;
  }

  // Always render a report — even on all-pass, so the artifact is there.
  try {
    const markdown = renderBugReportMarkdown(summary);
    const absolutePath = await writeText(options.output, markdown);

    if (summary.reports.length === 0) {
      logger.success(
        `All ${summary.totalTests} test(s) passed. Report written to ${absolutePath}`,
      );
    } else {
      logger.warn(
        `${summary.failedTests} failure(s) out of ${summary.totalTests} test(s). ` +
          `Report written to ${absolutePath}`,
      );
      // Signal failure to CI without erasing the local artifact.
      process.exitCode = 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to render or write bug report: ${message}`);
    process.exitCode = 1;
    return;
  }

  if (options.pushSupabase && summary.reports.length > 0) {
    const pushSpinner = ora({
      text: 'Pushing bug reports to Supabase…',
      color: 'cyan',
    }).start();
    try {
      const n = await pushBugReportsToSupabase(summary);
      pushSpinner.stop();
      logger.success(`Pushed ${n} bug report(s) to Supabase.`);
    } catch (err) {
      pushSpinner.stop();
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Supabase push failed: ${message}`);
      process.exitCode = 1;
    }
  }

  console.log();
}

/* ------------------------------------------------------------------ */
/*  Child-process helpers                                              */
/* ------------------------------------------------------------------ */

/**
 * Spawn `npx playwright test --reporter=json` and capture its stdout.
 * Resolves with the raw JSON string regardless of exit code, because
 * Playwright still emits a complete report when tests fail.
 */
function runPlaywright(options: RunCommandOptions): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const args = ['playwright', 'test', '--reporter=json'];
    if (options.config) args.push(`--config=${options.config}`);
    if (options.spec) args.push(options.spec);

    const child = spawn('npx', args, {
      env: process.env,
      // Inherit stderr so users still see Playwright's spinner / warnings,
      // but capture stdout (that's where the JSON payload lives).
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    const chunks: Buffer[] = [];
    child.stdout?.on('data', (c: Buffer) => {
      chunks.push(c);
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', () => {
      const out = Buffer.concat(chunks).toString('utf-8').trim();
      if (!out) {
        reject(
          new Error(
            'Playwright produced no JSON output on stdout. ' +
              'Is Playwright installed and is a playwright.config.ts present?',
          ),
        );
        return;
      }
      // Playwright may prepend lines before the JSON (rare but possible).
      // Clip to the first "{" to be safe.
      const firstBrace = out.indexOf('{');
      resolve(firstBrace > 0 ? out.slice(firstBrace) : out);
    });
  });
}
