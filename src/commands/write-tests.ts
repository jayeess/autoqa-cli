/**
 * `autoqa write-tests` command handler.
 *
 * Reads a DOM map (and optionally a pre-built matrix), builds one
 * on-the-fly if needed, sends both to Claude via core/test-writer,
 * and writes the resulting `.spec.ts` file plus a sidecar `.raw.md`
 * containing the unfiltered model response (handy for debugging
 * when the generated spec looks off).
 *
 * All business logic lives in core — this file is only I/O,
 * logging, and exit-code wrangling.
 */

import { join, resolve } from 'node:path';
import ora from 'ora';

import { buildMatrix } from '../core/matrix-gen.js';
import { writeTestsWithClaude } from '../core/test-writer.js';
import { readJson, writeText } from '../utils/file-io.js';
import { logger } from '../utils/logger.js';
import type { DomMap, TestMatrix } from '../types/index.js';

export interface WriteTestsCommandOptions {
  /** Path to a DOM map JSON (produced by `autoqa scan`). */
  input: string;
  /** Directory to write the generated spec file into. */
  output: string;
  /** Claude model id. */
  model: string;
  /** Optional path to a pre-built matrix JSON. If absent, one is generated. */
  matrix?: string;
}

export async function runWriteTests(options: WriteTestsCommandOptions): Promise<void> {
  logger.section('write-tests');
  logger.info(`Input:   ${options.input}`);
  logger.info(`Output:  ${options.output}`);
  logger.info(`Model:   ${options.model}`);
  if (options.matrix) {
    logger.info(`Matrix:  ${options.matrix}`);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    logger.error('ANTHROPIC_API_KEY is not set. Add it to your .env file.');
    process.exitCode = 1;
    return;
  }

  // 1. Load the DOM map.
  let domMap: DomMap;
  try {
    domMap = await readJson<DomMap>(options.input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to read DOM map at ${options.input}: ${message}`);
    process.exitCode = 1;
    return;
  }

  // 2. Load a matrix from disk if the user supplied one, otherwise
  //    regenerate it deterministically from the DOM map.
  let matrix: TestMatrix;
  if (options.matrix) {
    try {
      matrix = await readJson<TestMatrix>(options.matrix);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to read matrix at ${options.matrix}: ${message}`);
      process.exitCode = 1;
      return;
    }
  } else {
    matrix = buildMatrix(domMap);
    logger.info(`Generated ${matrix.totalCases} case(s) from DOM map on the fly.`);
  }

  // 3. Call Claude.
  const spinner = ora({
    text: `Asking ${options.model} to write ${matrix.totalCases} Playwright test(s)…`,
    color: 'cyan',
  }).start();

  try {
    const result = await writeTestsWithClaude({
      domMap,
      matrix,
      model: options.model,
    });
    spinner.stop();

    // 4. Write the executable spec + a raw sidecar for debugging.
    const specPath = resolve(join(options.output, result.filename));
    const rawPath = specPath.replace(/\.spec\.ts$/, '.raw.md');

    await writeText(specPath, result.spec);
    await writeText(rawPath, result.raw);

    logger.success(`Spec written to ${specPath}`);
    logger.info(`Raw Claude response saved to ${rawPath}`);
    if (result.usage) {
      logger.info(
        `Tokens used: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`,
      );
    }
    console.log();
  } catch (err) {
    spinner.stop();
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Test generation failed: ${message}`);
    process.exitCode = 1;
  }
}
