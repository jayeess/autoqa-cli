/**
 * `autoqa generate-matrix` command handler.
 *
 * Reads a DOM map JSON, builds a structured TestMatrix, writes a
 * Markdown document locally, and optionally pushes the structured
 * matrix to Supabase when `--push-supabase` is provided.
 */

import ora from 'ora';
import { buildMatrix, renderMatrixMarkdown, pushMatrixToSupabase } from '../core/matrix-gen.js';
import { readJson, writeText } from '../utils/file-io.js';
import { isSupabaseConfigured } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';
import type { DomMap } from '../types/index.js';

export interface GenerateMatrixCommandOptions {
  input: string;
  output: string;
  pushSupabase?: boolean;
}

export async function runGenerateMatrix(
  options: GenerateMatrixCommandOptions,
): Promise<void> {
  logger.section('generate-matrix');
  logger.info(`Input:  ${options.input}`);
  logger.info(`Output: ${options.output}`);
  logger.info(`Push to Supabase: ${options.pushSupabase ? 'yes' : 'no'}`);

  // Fail fast on misconfiguration before doing any work.
  if (options.pushSupabase && !isSupabaseConfigured()) {
    logger.error(
      '--push-supabase was provided but SUPABASE_URL / SUPABASE_ANON_KEY are not set. ' +
        'Add them to .env (see .env.example).',
    );
    process.exitCode = 1;
    return;
  }

  let domMap: DomMap;
  try {
    domMap = await readJson<DomMap>(options.input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to read DOM map at ${options.input}: ${message}`);
    process.exitCode = 1;
    return;
  }

  const spinner = ora({ text: 'Building test matrix…', color: 'cyan' }).start();

  try {
    const matrix = buildMatrix(domMap);
    const markdown = renderMatrixMarkdown(matrix);
    spinner.stop();

    const absolutePath = await writeText(options.output, markdown);
    logger.success(`Markdown matrix written to ${absolutePath}`);
    logger.info(
      `Generated ${matrix.totalCases} test case(s) ` +
        `from ${domMap.forms.length} form(s), ${domMap.buttons.length} button(s), ` +
        `${domMap.inputs.length} input(s), ${domMap.links.length} link(s).`,
    );

    if (options.pushSupabase) {
      const pushSpinner = ora({
        text: 'Pushing matrix to Supabase…',
        color: 'cyan',
      }).start();
      try {
        const rowId = await pushMatrixToSupabase(matrix);
        pushSpinner.stop();
        logger.success(`Matrix pushed to Supabase (test_matrices.id = ${rowId}).`);
      } catch (err) {
        pushSpinner.stop();
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Supabase push failed: ${message}`);
        // Markdown was still written locally — surface a non-zero exit so
        // CI pipelines fail loudly, but don't erase the local artifact.
        process.exitCode = 1;
      }
    }

    console.log();
  } catch (err) {
    spinner.stop();
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Matrix generation failed: ${message}`);
    process.exitCode = 1;
  }
}
