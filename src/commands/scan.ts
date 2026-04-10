/**
 * `autoqa scan` command handler.
 *
 * Thin wrapper: parses options, delegates to core/crawler, and writes
 * the resulting DOM map to disk. Business logic lives in core — this
 * file only deals with I/O, logging, and exit codes.
 */

import ora from 'ora';
import { crawl } from '../core/crawler.js';
import { writeJson } from '../utils/file-io.js';
import { logger } from '../utils/logger.js';

export interface ScanCommandOptions {
  url: string;
  output: string;
  headless: boolean;
  timeout: string;
}

export async function runScan(options: ScanCommandOptions): Promise<void> {
  logger.section('scan');
  logger.info(`URL:      ${options.url}`);
  logger.info(`Output:   ${options.output}`);
  logger.info(`Headless: ${options.headless}`);

  const timeoutMs = Number.parseInt(options.timeout, 10);
  if (Number.isNaN(timeoutMs) || timeoutMs <= 0) {
    logger.error(`Invalid --timeout value: "${options.timeout}"`);
    process.exitCode = 1;
    return;
  }

  const spinner = ora({ text: 'Launching browser & crawling DOM…', color: 'cyan' }).start();

  try {
    const domMap = await crawl({
      url: options.url,
      headless: options.headless,
      timeoutMs,
    });
    spinner.stop();

    const absolutePath = await writeJson(options.output, domMap);

    const total =
      domMap.forms.reduce((n, f) => n + f.fields.length + (f.submit ? 1 : 0), 0) +
      domMap.buttons.length +
      domMap.inputs.length +
      domMap.links.length +
      domMap.other.length;

    logger.success(`DOM map written to ${absolutePath}`);
    logger.info(
      `Summary: ${domMap.forms.length} forms, ${domMap.buttons.length} buttons, ` +
        `${domMap.inputs.length} inputs, ${domMap.links.length} links, ` +
        `${domMap.other.length} other (${total} interactive elements total)`,
    );
    console.log();
  } catch (err) {
    spinner.stop();
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Crawl failed: ${message}`);
    process.exitCode = 1;
  }
}
