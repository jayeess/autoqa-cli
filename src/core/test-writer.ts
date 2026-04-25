/**
 * test-writer.ts — Claude-powered Playwright spec author.
 *
 * Takes a DOM map and a TestMatrix and asks Claude to turn every case
 * into a robust, modern Playwright TypeScript spec file. This module
 * is the *pure* brains of the operation: no filesystem, no CLI parsing,
 * no process.env lookups beyond the SDK's own ANTHROPIC_API_KEY fallback.
 * The matching command handler (`src/commands/write-tests.ts`) is
 * responsible for reading inputs and writing outputs.
 *
 * Responsibilities:
 *   1. Build a system prompt that constrains Claude to emit only code,
 *      wrapped in a single ```typescript fence, with heavy test.step()
 *      usage and resilient locators.
 *   2. Build a user prompt containing the DOM map + matrix + metadata.
 *   3. Call `client.messages.create` with `claude-opus-4-6` and a
 *      generous max_tokens.
 *   4. Extract the first text block from the discriminated-union
 *      response, then strip any conversational preamble and markdown
 *      fences so what we return is pure executable TypeScript.
 *   5. Validate the result looks like a Playwright spec (has at least
 *      one `import` and one `test(` call).
 *
 * We keep every step exported as a small helper so the downstream unit
 * tests (vitest, pending) can exercise the parser in isolation without
 * hitting the network.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { DomMap, TestMatrix } from '../types/index.js';

/** Input to the test-writer. Everything except `apiKey` is required. */
export interface WriteTestsOptions {
  /** DOM map produced by `autoqa scan`. */
  domMap: DomMap;
  /** Structured test matrix produced by `autoqa generate-matrix`. */
  matrix: TestMatrix;
  /** Claude model ID. Defaults to `claude-opus-4-6`. */
  model?: string;
  /** Max tokens for the completion. Defaults to 16000. */
  maxTokens?: number;
  /** Optional API key override; the SDK otherwise reads ANTHROPIC_API_KEY. */
  apiKey?: string;
}

/** Output of the test-writer. Pure data — the caller decides where to write it. */
export interface WriteTestsResult {
  /** Cleaned, executable .spec.ts content — no fences, no prose. */
  spec: string;
  /** Unfiltered Claude response text, kept for debugging / `.raw.md` sidecar. */
  raw: string;
  /** Suggested filename (no directory), e.g. "login-form.spec.ts". */
  filename: string;
  /** The exact model used for the generation. */
  model: string;
  /** Token usage reported by the API, if available. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

const DEFAULT_MODEL = 'claude-opus-4-6';
const DEFAULT_MAX_TOKENS = 16_000;

/* ------------------------------------------------------------------ */
/*  Public entry point                                                 */
/* ------------------------------------------------------------------ */

/**
 * Generate a Playwright `.spec.ts` file body from a DOM map and matrix.
 *
 * Throws a descriptive error if the API key is missing, the API call
 * fails, or the response can't be parsed into a plausible spec file.
 */
export async function writeTestsWithClaude(
  options: WriteTestsOptions,
): Promise<WriteTestsResult> {
  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to your .env file or pass it explicitly.',
    );
  }

  const client = new Anthropic({ apiKey });

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(options.domMap, options.matrix);

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    // Use the SDK's typed error classes rather than string-matching.
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error(
        'Claude API authentication failed. Check your ANTHROPIC_API_KEY.',
      );
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new Error('Claude API rate limit hit. Wait a moment and retry.');
    }
    if (err instanceof Anthropic.BadRequestError) {
      throw new Error(`Claude API rejected the request: ${err.message}`);
    }
    if (err instanceof Anthropic.APIError) {
      throw new Error(`Claude API error (${err.status ?? '?'}): ${err.message}`);
    }
    throw err;
  }

  const raw = extractTextFromResponse(response);
  if (!raw.trim()) {
    throw new Error('Claude returned an empty response.');
  }

  const spec = stripMarkdownFences(raw);
  validateLooksLikeSpec(spec);

  const filename = buildSpecFilename(options.domMap, options.matrix);

  return {
    spec,
    raw,
    filename,
    model,
    usage: response.usage
      ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        }
      : undefined,
  };
}

/* ------------------------------------------------------------------ */
/*  Prompt construction                                                */
/* ------------------------------------------------------------------ */

/**
 * The system prompt that constrains Claude to emit only a single
 * code block. Kept exported so unit tests can assert on its content.
 */
export function buildSystemPrompt(): string {
  return `You are a Senior QA Automation Engineer who writes production-grade Playwright end-to-end tests in TypeScript.

Your job: given a JSON description of a web page's interactive DOM and a structured test matrix, emit a single complete Playwright spec file that implements every case in the matrix.

# Output format (STRICT)

- Return EXACTLY ONE fenced code block, starting with \`\`\`typescript and ending with \`\`\`.
- The code block must contain a complete, self-contained \`.spec.ts\` file.
- Do NOT emit any text before the opening fence or after the closing fence. No greetings, no explanations, no "Here is…".
- Do NOT wrap the output in JSON. Do NOT produce multiple files.

# Required imports & structure

- Import from \`@playwright/test\`: \`import { test, expect } from '@playwright/test';\`
- Use a single top-level \`test.describe(...)\` block titled after the page (e.g. the page title or URL).
- Use \`test.beforeEach\` to navigate to the target URL before every test.
- Group related cases into nested \`test.describe\` blocks when the matrix has clear sections (e.g. one per form).
- Emit ONE \`test(...)\` per row in the matrix, titled with the matrix ID and a short human summary: \`test('TC-001 — Submit login form with valid credentials', async ({ page }) => { … })\`.

# Readability requirements

- Inside every test, break the work into multiple \`test.step('...', async () => { ... })\` blocks.
  At minimum: one step for "arrange" (filling fields), one for "act" (click / submit), one for "assert".
- Use descriptive step labels that read like a manual QA checklist.

# Locator priority (resilient selectors only)

Use Playwright's built-in resilient locators in this priority order. Never fall back to brittle CSS selectors when a higher-priority option exists in the DOM map:

1. \`page.getByTestId('...')\` — when the element has a \`testId\`.
2. \`page.getByRole('role', { name: '...' })\` — when the element has an ARIA role and an accessible name.
3. \`page.getByLabel('...')\` — for form fields with an associated label.
4. \`page.getByPlaceholder('...')\` — when placeholder is available.
5. \`page.getByText('...')\` — for static text matches.
6. \`page.locator('#id')\` or \`page.locator('[name="…"]')\` — only as a last resort.

If the DOM map provides a \`suggestedLocator\` for an element, prefer it — it was already built using this priority.

# Assertions

- Use \`expect\` with auto-retrying locator assertions: \`await expect(locator).toBeVisible()\`, \`toHaveText(...)\`, \`toHaveValue(...)\`, \`toBeEnabled()\`, etc.
- For validation / negative cases, assert that an error message becomes visible OR that the form does not advance (URL unchanged, submit still present).
- For navigation cases, assert \`await expect(page).toHaveURL(...)\`.
- Never use arbitrary \`waitForTimeout\` calls — rely on auto-waiting locators.

# Data choices

- Use obviously fake, deterministic test data: \`user@example.com\`, \`Password123!\`, \`Test User\`, etc.
- Never invent real-looking credentials.
- For boundary-value cases, use the exact values supplied in the matrix action.

# Robustness

- Wrap navigation in the beforeEach, not in every test.
- Use \`page.goto(URL, { waitUntil: 'domcontentloaded' })\` — avoid 'networkidle' for test speed unless the page absolutely needs it.
- Prefer \`await locator.fill('...')\` over \`type\` for text input.
- Prefer \`await locator.check()\` / \`.uncheck()\` for checkboxes.

Remember: your entire response must be a single \`\`\`typescript ... \`\`\` block. Any text outside that block will break the downstream parser.`;
}

/**
 * The user prompt serializes the inputs and tells Claude exactly
 * which target URL to use. Kept exported for testability.
 */
export function buildUserPrompt(domMap: DomMap, matrix: TestMatrix): string {
  const targetUrl = domMap.finalUrl || domMap.url;
  const pageTitle = domMap.title || '(untitled page)';

  return `Generate the Playwright spec file for the following page.

# Target URL
${targetUrl}

# Page title
${pageTitle}

# DOM map (captured by Playwright)
\`\`\`json
${JSON.stringify(domMap, null, 2)}
\`\`\`

# Test matrix (${matrix.totalCases} cases to implement)
\`\`\`json
${JSON.stringify(matrix, null, 2)}
\`\`\`

# Instructions
- Implement EVERY case in the matrix as a \`test(...)\` whose title starts with the case id.
- Use the DOM map to choose the most resilient locator for each element — prefer \`suggestedLocator\` values when they exist.
- Group tests into \`test.describe\` blocks matching the matrix \`section\` values.
- Use \`test.beforeEach\` to navigate to the target URL above.
- Emit ONE \`\`\`typescript code block containing the full spec file. Nothing else.`;
}

/* ------------------------------------------------------------------ */
/*  Response parsing                                                   */
/* ------------------------------------------------------------------ */

/**
 * Walk the discriminated-union `content` array and concatenate every
 * text block. Non-text blocks (tool_use, thinking, etc.) are ignored.
 */
export function extractTextFromResponse(response: Anthropic.Message): string {
  const parts: string[] = [];
  for (const block of response.content) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

/**
 * Strip conversational preamble and markdown code fences, returning
 * pure executable TypeScript.
 *
 * Strategy:
 *   1. Look for fenced code blocks (```ts / ```typescript / ```javascript / ```).
 *   2. If one or more fences exist, return the *largest* block — Claude
 *      occasionally emits a small illustrative block followed by the real
 *      one, so picking by length is safer than "first match".
 *   3. If NO fences exist, fall back to the raw text *only* if it already
 *      looks like code (starts with `import` / `const` / `test(` / `//` /
 *      `/*`). Otherwise throw — silently writing prose to a .spec.ts
 *      would bury the error.
 */
export function stripMarkdownFences(raw: string): string {
  const fenceRegex = /```(?:typescript|ts|tsx|javascript|js)?\s*\r?\n([\s\S]*?)\r?\n?```/gi;

  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(raw)) !== null) {
    blocks.push(match[1]);
  }

  if (blocks.length > 0) {
    // Pick the largest block — defends against Claude emitting a stub
    // example before the real answer.
    const largest = blocks.reduce((a, b) => (a.length >= b.length ? a : b));
    return largest.trim() + '\n';
  }

  // No fences. Only accept the raw response if it plausibly IS the code.
  const trimmed = raw.trim();
  const startsLikeCode =
    /^\s*(import\b|const\b|let\b|var\b|\/\/|\/\*|test\s*\(|test\.describe\s*\(|export\b)/.test(
      trimmed,
    );

  if (startsLikeCode) {
    return trimmed + '\n';
  }

  throw new Error(
    'Claude response did not contain a fenced code block and does not look like raw TypeScript. ' +
      'The first 200 characters of the response were: ' +
      JSON.stringify(raw.slice(0, 200)),
  );
}

/**
 * Sanity check: the extracted body should contain the core hallmarks
 * of a Playwright spec. Throws a descriptive error if not — cheaper to
 * catch here than to discover hours later when a test run fails.
 */
export function validateLooksLikeSpec(spec: string): void {
  if (!/from\s+['"]@playwright\/test['"]/.test(spec)) {
    throw new Error(
      "Generated spec is missing `from '@playwright/test'` import. The parser may have grabbed the wrong block.",
    );
  }
  if (!/\btest\s*\(/.test(spec) && !/\btest\.describe\s*\(/.test(spec)) {
    throw new Error(
      'Generated spec contains no `test(` or `test.describe(` calls. The parser may have grabbed the wrong block.',
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Filename helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Build a slug-based spec filename from the page title (or URL host
 * if the title is empty). Always returns something ending in
 * `.spec.ts`.
 */
export function buildSpecFilename(domMap: DomMap, matrix: TestMatrix): string {
  const raw =
    matrix.pageTitle ||
    domMap.title ||
    safeHostFromUrl(domMap.finalUrl || domMap.url) ||
    'autoqa';
  return `${slugify(raw)}.spec.ts`;
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'autoqa';
}

function safeHostFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
