/**
 * Small filesystem helpers for reading and writing the artifacts
 * produced and consumed by the AutoQA pipeline (DOM maps, matrices,
 * generated spec files).
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/** Write any JSON-serializable value to disk, creating parents as needed. */
export async function writeJson(filePath: string, data: unknown): Promise<string> {
  const absolute = resolve(filePath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, JSON.stringify(data, null, 2), 'utf-8');
  return absolute;
}

/** Read and parse a JSON file. */
export async function readJson<T>(filePath: string): Promise<T> {
  const content = await readFile(resolve(filePath), 'utf-8');
  return JSON.parse(content) as T;
}

/** Write a UTF-8 text file (Markdown, spec files, etc.), creating parents. */
export async function writeText(filePath: string, content: string): Promise<string> {
  const absolute = resolve(filePath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf-8');
  return absolute;
}
