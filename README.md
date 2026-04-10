# AutoQA CLI

> **An AI-assisted QA automation architect that lives in your terminal.**
> Map any web app, generate a systematic test matrix, have Claude write
> production-grade Playwright tests, run them, and file standardized bug
> reports — all from a single CLI.

AutoQA CLI is an end-to-end QA pipeline that closes the loop between
exploratory testing, test authoring, execution, and reporting. It is
designed as a co-pilot for a human QA engineer: deterministic where it
should be (DOM capture, matrix generation, result parsing) and
model-powered where it pays off (turning a test matrix into executable
Playwright TypeScript).

---

## Features

- **Deterministic DOM capture** — a Playwright-backed crawler emits a
  noise-free JSON map of every interactive element on a target page,
  with accessible names, ARIA roles, boundary attributes, and a
  ready-to-paste locator per element.
- **Systematic test matrix generation** — every DOM element is expanded
  into Functional / Negative / Regression / Accessibility cases,
  including boundary-value coverage for number, date, and
  text-length inputs. No LLM involvement at this stage — the matrix is
  a pure, reproducible spec.
- **AI-powered Playwright authoring** — the DOM map and matrix are
  handed to Claude (`claude-opus-4-6`) with a strict system prompt
  demanding resilient locators, `test.step()` narration, and a single
  fenced code block. A hardened parser strips conversational output so
  what lands on disk is pure executable `.spec.ts`.
- **Bug reports you can ship** — after running the generated tests,
  failing cases are rendered into a systematic Markdown report with
  Expected Result, Actual Result, and Error Trace sections.
- **Supabase integration** — matrices and bug reports can be pushed
  straight to a Supabase project via an `--push-supabase` flag, ready
  to power a live dashboard.

---

## Architecture

```
   ┌───────────┐   ┌──────────────────┐   ┌──────────────┐   ┌──────────┐
   │  scan     │──▶│  generate-matrix │──▶│  write-tests │──▶│   run    │
   └───────────┘   └──────────────────┘   └──────────────┘   └──────────┘
        │                  │                    │                  │
        ▼                  ▼                    ▼                  ▼
   dom-map.json      test-matrix.md        *.spec.ts         bug-report.md
   (Playwright)      (deterministic)       (Claude API)       (Playwright
                                                                + parser)
                             │                                      │
                             └──────────┐             ┌─────────────┘
                                        ▼             ▼
                                  Supabase: test_matrices · bug_reports
```

### Tech stack

| Layer            | Tool                                                |
| ---------------- | --------------------------------------------------- |
| Runtime          | Node.js ≥ 18, TypeScript (ES2022, NodeNext)         |
| CLI framework    | Commander.js                                        |
| Browser          | Playwright (Chromium)                               |
| LLM              | Anthropic Claude via `@anthropic-ai/sdk`            |
| Persistence      | Supabase (Postgres + service-role key)              |
| Validation       | Zod                                                 |
| UX               | chalk, ora                                          |
| Test runner      | Vitest (unit) · Playwright Test (end-to-end)        |

### Project layout

```
autoqa-cli/
├── src/
│   ├── index.ts                  # CLI entry point (Commander)
│   ├── commands/                 # thin command handlers (I/O + logging)
│   │   ├── scan.ts
│   │   ├── generate-matrix.ts
│   │   ├── write-tests.ts
│   │   └── run-tests.ts
│   ├── core/                     # pure business logic (unit-testable)
│   │   ├── crawler.ts            # Playwright DOM extractor
│   │   ├── matrix-gen.ts         # deterministic matrix + markdown
│   │   ├── test-writer.ts        # Claude prompt + fence parser
│   │   └── reporter.ts           # Playwright JSON → bug report
│   ├── utils/                    # cross-cutting helpers
│   │   ├── file-io.ts
│   │   ├── logger.ts
│   │   └── supabase-client.ts
│   └── types/index.ts            # shared type definitions
└── output/                       # generated artifacts
    ├── dom-maps/
    ├── matrices/
    ├── specs/
    └── bug-reports/
```

---

## Prerequisites

- **Node.js 18+** and **npm** (or pnpm / yarn).
- **Chromium** — installed by Playwright on first run.
- An **Anthropic API key** (required for `write-tests`).
- *(Optional)* a **Supabase** project for persistence.

## Installation

```bash
git clone https://github.com/jayeess/autoqa-cli.git
cd autoqa-cli
npm install
npx playwright install chromium
cp .env.example .env
# edit .env and fill in your API keys
```

Build the TypeScript sources (or use `npm run dev` for tsx-powered dev runs):

```bash
npm run build
npm link          # make `autoqa` globally available
```

## Configuration

All configuration lives in `.env`. See `.env.example` for the full template.

| Variable                    | Required for                  | Notes                                       |
| --------------------------- | ----------------------------- | ------------------------------------------- |
| `ANTHROPIC_API_KEY`         | `write-tests`                 | Standard Claude API key.                    |
| `ANTHROPIC_MODEL`           | `write-tests` (optional)      | Override the default `claude-opus-4-6`.     |
| `SUPABASE_URL`              | any `--push-supabase` flag    | From Project Settings → API.                |
| `SUPABASE_SERVICE_ROLE_KEY` | any `--push-supabase` flag    | **Service role** key — bypasses RLS.        |

> ⚠️ **Never** ship the service-role key to a browser bundle. AutoQA is a
> trusted backend utility that runs on a developer machine or CI runner.

---

## Commands

### `autoqa scan`

Crawl a target URL with Playwright and emit a compact JSON DOM map of
every interactive element — buttons, forms, inputs, links, and ARIA
role-based custom widgets. Captures `id`, `name`, `data-testid`,
accessible names, inner text, and boundary attributes (`min`, `max`,
`step`, `minlength`, `maxlength`, `pattern`). Every element also gets a
ready-to-paste `suggestedLocator`.

```bash
autoqa scan \
  --url https://example.com/login \
  --output ./output/dom-maps/login.json
```

| Flag                  | Default                              | Description                         |
| --------------------- | ------------------------------------ | ----------------------------------- |
| `-u, --url <url>`     | _(required)_                         | Target URL.                         |
| `-o, --output <path>` | `./output/dom-maps/dom-map.json`     | Where to write the DOM map.         |
| `--headless`          | `true`                               | Run Chromium headless.              |
| `--no-headless`       | —                                    | Run with a visible browser.         |
| `--timeout <ms>`      | `30000`                              | Navigation timeout.                 |

### `autoqa generate-matrix`

Read a DOM map and generate a systematic Markdown test matrix with
columns: `ID | Category | Element | Action | Expected Result`. Cases
are deterministic and cover four categories:

- **Functional** — happy-path interactions and boundary-value
  coverage for number / date / text-length inputs.
- **Negative** — empty required fields, malformed email/URL/date,
  off-step / underflow / overflow / pattern-mismatch inputs.
- **Regression** — rendering and presence checks.
- **Accessibility** — accessible names on forms and buttons.

```bash
autoqa generate-matrix \
  --input ./output/dom-maps/login.json \
  --output ./output/matrices/login.md \
  --push-supabase
```

| Flag                  | Default                              | Description                          |
| --------------------- | ------------------------------------ | ------------------------------------ |
| `-i, --input <path>`  | _(required)_                         | DOM map JSON.                        |
| `-o, --output <path>` | `./output/matrices/test-matrix.md`   | Markdown output path.                |
| `--push-supabase`     | `false`                              | Also insert into `test_matrices`.    |

### `autoqa write-tests`

Hand the DOM map and matrix to Claude and emit a single Playwright
`.spec.ts` file. The system prompt demands resilient locators
(`getByTestId` → `getByRole` → `getByLabel` → `getByPlaceholder`),
heavy `test.step()` narration, and a single fenced code block. A
hardened parser strips conversational preamble and validates the
output before writing. A `.raw.md` sidecar is saved next to the spec
for debugging.

```bash
autoqa write-tests \
  --input ./output/dom-maps/login.json \
  --output ./output/specs \
  --model claude-opus-4-6
```

| Flag                  | Default                   | Description                                       |
| --------------------- | ------------------------- | ------------------------------------------------- |
| `-i, --input <path>`  | _(required)_              | DOM map JSON.                                     |
| `-o, --output <path>` | `./output/specs`          | Directory for the generated `.spec.ts`.           |
| `-m, --model <id>`    | `claude-opus-4-6`         | Claude model id.                                  |
| `--matrix <path>`     | _(auto-generated)_        | Reuse a pre-built matrix JSON instead of rebuilding. |

### `autoqa run`

Execute Playwright with the JSON reporter, parse the output, and
render a systematic Markdown bug report for every failing test —
Expected Result, Actual Result, and full Error Trace. Optionally push
every failure to the Supabase `bug_reports` table so a downstream
dashboard can surface them live.

```bash
autoqa run \
  --spec ./output/specs/login.spec.ts \
  --output ./output/bug-reports/login.md \
  --push-supabase
```

| Flag                  | Default                                     | Description                            |
| --------------------- | ------------------------------------------- | -------------------------------------- |
| `-s, --spec <path>`   | _(all tests in config)_                     | Spec file or glob.                     |
| `-c, --config <path>` | _(Playwright default)_                      | Path to a `playwright.config.ts`.      |
| `-o, --output <path>` | `./output/bug-reports/bug-report.md`        | Markdown output path.                  |
| `--push-supabase`     | `false`                                     | Insert every failure into `bug_reports`. |

---

## End-to-end workflow

```bash
# 1. Capture the target page's interactive DOM.
autoqa scan --url https://example.com/login \
  -o ./output/dom-maps/login.json

# 2. Generate a deterministic test matrix.
autoqa generate-matrix -i ./output/dom-maps/login.json \
  -o ./output/matrices/login.md

# 3. Have Claude write a Playwright spec for every row in the matrix.
autoqa write-tests -i ./output/dom-maps/login.json \
  -o ./output/specs

# 4. Run the tests and file a bug report for any failures.
autoqa run -s ./output/specs/login.spec.ts \
  -o ./output/bug-reports/login.md
```

> **Playwright config.** `autoqa run` delegates to `npx playwright
> test`, so it relies on a standard `playwright.config.ts` to know
> where spec files live. Point `testDir` at `./output/specs` (or pass
> `--spec` explicitly) and you are ready to go.

---

## Supabase schema

If you opt into `--push-supabase`, create these two tables in your
Supabase project before running the commands. Both are designed to be
denormalized so the CLI can push in a single `insert`:

```sql
create table test_matrices (
  id           uuid primary key default gen_random_uuid(),
  source_url   text not null,
  page_title   text,
  captured_at  timestamptz,
  generated_at timestamptz not null default now(),
  total_cases  integer not null,
  cases        jsonb   not null
);

create table bug_reports (
  id             uuid primary key default gen_random_uuid(),
  test_id        text,
  test_title     text not null,
  full_title     text,
  describe_path  text,
  source_spec    text,
  line           integer,
  "column"       integer,
  status         text not null,
  expected       text,
  actual         text,
  error_message  text,
  error_stack    text,
  duration_ms    integer,
  captured_at    timestamptz,
  run_at         timestamptz not null default now()
);
```

---

## Development

```bash
npm run dev          # run the CLI under tsx with live TS
npm run build        # compile to dist/
npm run test         # vitest unit tests
npm run lint         # eslint src/**/*.ts
npm run format       # prettier write
```

### Design philosophy

- **Thin commands, fat core.** Every file in `src/commands/` is a thin
  I/O wrapper that delegates to a pure function in `src/core/`. This
  makes the business logic unit-testable without touching the
  filesystem, the network, or `process.argv`.
- **Deterministic where it can be.** The crawler, matrix generator,
  and result parser are fully deterministic. The LLM is only invoked
  for the step where it provides real leverage: turning a matrix into
  a production-grade `.spec.ts`.
- **Resilient by default.** The test-writer system prompt enforces
  Playwright's recommended locator priority (`getByTestId` → role →
  label → placeholder → text), and the output parser refuses to save
  anything that doesn't look like a valid Playwright spec.

---

## Roadmap

- Multi-page crawl with configurable depth.
- Visual-regression snapshots as a new matrix category.
- CI/CD helpers (GitHub Actions template, JUnit reporter).
- Slack / Linear / GitHub Issues sinks for the bug reporter.
- Live web dashboard (hosted on Render) reading from Supabase.

---

## License

MIT

---

Built as a portfolio project demonstrating end-to-end QA automation
engineering with an LLM in the loop — from exploratory DOM capture to
production-grade test authoring to closed-loop bug reporting.
