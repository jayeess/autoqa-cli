#!/usr/bin/env node

/**
 * AutoQA CLI — Entry Point
 *
 * A developer tool that maps a target web app's DOM, generates a test matrix,
 * and auto-writes Playwright E2E tests using the Claude API.
 */

import { Command, CommanderError } from 'commander';
import chalk from 'chalk';
import dotenv from 'dotenv';

import { runScan } from './commands/scan.js';

// Load environment variables from .env (e.g. ANTHROPIC_API_KEY)
dotenv.config();

const program = new Command();

program
  .name('autoqa')
  .description(
    'AutoQA CLI — DOM mapping, test matrix generation, and AI-powered Playwright test authoring.',
  )
  .version('0.1.0');

/**
 * Command: scan
 * -------------
 * Crawls the target URL with Playwright and extracts interactive DOM
 * elements (forms, buttons, inputs, links) into a JSON map.
 */
program
  .command('scan')
  .description('Crawl a URL and extract its interactive DOM elements into a JSON map.')
  .requiredOption('-u, --url <url>', 'Target URL to scan')
  .option(
    '-o, --output <path>',
    'Output path for the DOM map JSON file',
    './output/dom-maps/dom-map.json',
  )
  .option('--headless', 'Run the browser in headless mode', true)
  .option('--no-headless', 'Run the browser with a visible UI (overrides --headless)')
  .option('--timeout <ms>', 'Navigation timeout in milliseconds', '30000')
  .action(async (options) => {
    await runScan(options);
  });

/**
 * Command: generate-matrix
 * ------------------------
 * Reads a DOM map JSON and produces a Markdown test matrix outlining
 * planned functional and regression test cases.
 */
program
  .command('generate-matrix')
  .description('Generate a Markdown test matrix from a DOM map JSON file.')
  .requiredOption('-i, --input <path>', 'Path to the DOM map JSON file')
  .option(
    '-o, --output <path>',
    'Output path for the generated Markdown matrix',
    './output/matrices/test-matrix.md',
  )
  .action(async (options) => {
    console.log(chalk.cyan.bold('\n[autoqa generate-matrix]'));
    console.log(chalk.gray(`  Input:  ${options.input}`));
    console.log(chalk.gray(`  Output: ${options.output}`));
    console.log(chalk.yellow('\n  TODO: wire up src/core/matrix-gen.ts (Step 3)\n'));
  });

/**
 * Command: write-tests
 * --------------------
 * Sends the DOM map to the Claude API and generates executable
 * Playwright .spec.ts files.
 */
program
  .command('write-tests')
  .description('Use Claude to generate Playwright .spec.ts files from a DOM map.')
  .requiredOption('-i, --input <path>', 'Path to the DOM map JSON file')
  .option(
    '-o, --output <path>',
    'Output directory for generated .spec.ts files',
    './output/specs',
  )
  .option(
    '-m, --model <model>',
    'Claude model ID to use for test generation',
    'claude-opus-4-6',
  )
  .action(async (options) => {
    console.log(chalk.cyan.bold('\n[autoqa write-tests]'));
    console.log(chalk.gray(`  Input:  ${options.input}`));
    console.log(chalk.gray(`  Output: ${options.output}`));
    console.log(chalk.gray(`  Model:  ${options.model}`));

    if (!process.env.ANTHROPIC_API_KEY) {
      console.log(
        chalk.red('\n  ERROR: ANTHROPIC_API_KEY is not set. Add it to your .env file.\n'),
      );
      process.exitCode = 1;
      return;
    }

    console.log(chalk.yellow('\n  TODO: wire up src/core/test-writer.ts (Step 4)\n'));
  });

// Commander's exitOverride lets us format real errors nicely while
// still letting built-in help/version output exit cleanly.
program.exitOverride();

// Show help when no subcommand was provided.
if (process.argv.slice(2).length === 0) {
  program.outputHelp();
  process.exit(0);
}

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof CommanderError) {
    // Help/version/validation output — commander has already printed
    // its own message, so just honor its suggested exit code.
    process.exit(err.exitCode);
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(chalk.red(`\nautoqa: ${message}\n`));
  process.exit(1);
});
