/**
 * Tiny chalk-based logger used by every command handler.
 *
 * Centralizing console output here keeps command files clean and
 * gives us one place to swap in a structured logger later.
 */

import chalk from 'chalk';

export const logger = {
  section(title: string): void {
    console.log(chalk.cyan.bold(`\n[autoqa ${title}]`));
  },
  info(msg: string): void {
    console.log(chalk.gray(`  ${msg}`));
  },
  success(msg: string): void {
    console.log(chalk.green(`  [ok] ${msg}`));
  },
  warn(msg: string): void {
    console.log(chalk.yellow(`  [warn] ${msg}`));
  },
  error(msg: string): void {
    console.log(chalk.red(`  [err] ${msg}`));
  },
};
