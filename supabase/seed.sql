-- ---------------------------------------------------------------------------
-- AutoQA — demo seed data
--
-- Populates `test_matrices` and `bug_reports` with realistic-looking rows so
-- the dashboard has something to show for portfolio demos before you run
-- the CLI for real. Timestamps are anchored to `now()` so the UI's relative
-- dates ("3 minutes ago", "yesterday") always look fresh.
--
-- Safe to re-run: the seed wipes its own demo rows first (anything where
-- source_url / source_spec starts with 'https://demo.autoqa.dev' or the
-- spec path begins with 'tests/demo/'). Real CLI data stays untouched.
--
-- Usage: Supabase SQL Editor → New query → paste → Run.
-- ---------------------------------------------------------------------------

-- Remove any previous demo rows so re-seeding is idempotent.
DELETE FROM bug_reports    WHERE source_spec LIKE 'tests/demo/%';
DELETE FROM test_matrices  WHERE source_url  LIKE 'https://demo.autoqa.dev/%';

-- ---------- Matrix #1 — TodoMVC (Vanilla JS) ----------
INSERT INTO test_matrices (source_url, page_title, captured_at, generated_at, total_cases, cases)
VALUES (
  'https://demo.autoqa.dev/todomvc',
  'TodoMVC — Vanilla JavaScript',
  now() - interval '2 hours 14 minutes',
  now() - interval '2 hours 10 minutes',
  12,
  '[
    {"id":"TC-01","title":"New todo can be added via Enter key","priority":"high","category":"happy-path"},
    {"id":"TC-02","title":"Empty todo input does not create an item","priority":"high","category":"validation"},
    {"id":"TC-03","title":"Completed todos move to the completed filter","priority":"medium","category":"happy-path"},
    {"id":"TC-04","title":"Double-click enables edit mode on an existing todo","priority":"medium","category":"interaction"},
    {"id":"TC-05","title":"Clear-completed button removes all checked todos","priority":"high","category":"happy-path"},
    {"id":"TC-06","title":"Footer counter reflects the live active-todo count","priority":"medium","category":"stateful"},
    {"id":"TC-07","title":"Escape key aborts an in-progress edit","priority":"low","category":"interaction"},
    {"id":"TC-08","title":"Todo with only whitespace is trimmed then discarded","priority":"high","category":"validation"},
    {"id":"TC-09","title":"Active filter hides completed todos","priority":"medium","category":"filter"},
    {"id":"TC-10","title":"Todos persist across page reloads","priority":"high","category":"persistence"},
    {"id":"TC-11","title":"Toggle-all marks every todo complete in one click","priority":"medium","category":"bulk"},
    {"id":"TC-12","title":"Accessibility: every control has an accessible name","priority":"high","category":"a11y"}
  ]'::jsonb
);

-- ---------- Matrix #2 — Shopping cart ----------
INSERT INTO test_matrices (source_url, page_title, captured_at, generated_at, total_cases, cases)
VALUES (
  'https://demo.autoqa.dev/shop/checkout',
  'Acme Store — Secure Checkout',
  now() - interval '1 day 4 hours',
  now() - interval '1 day 4 hours',
  15,
  '[
    {"id":"TC-01","title":"Cart total updates when quantity changes","priority":"high","category":"happy-path"},
    {"id":"TC-02","title":"Invalid promo code surfaces a clear error","priority":"high","category":"validation"},
    {"id":"TC-03","title":"Shipping cost recalculates on ZIP-code change","priority":"high","category":"happy-path"},
    {"id":"TC-04","title":"Credit card field rejects non-numeric input","priority":"medium","category":"validation"},
    {"id":"TC-05","title":"Place-order button is disabled until terms are accepted","priority":"high","category":"guard"},
    {"id":"TC-06","title":"Guest checkout flow completes without an account","priority":"high","category":"happy-path"},
    {"id":"TC-07","title":"Saved addresses auto-fill when signed in","priority":"medium","category":"happy-path"},
    {"id":"TC-08","title":"Out-of-stock items cannot be added to the cart","priority":"high","category":"edge"},
    {"id":"TC-09","title":"Tax calculation matches the subtotal × rate for each state","priority":"medium","category":"calculation"},
    {"id":"TC-10","title":"Order confirmation page shows the correct reference ID","priority":"high","category":"happy-path"},
    {"id":"TC-11","title":"Back button after purchase does not resubmit the order","priority":"high","category":"safety"},
    {"id":"TC-12","title":"Empty cart redirects to product catalog","priority":"low","category":"navigation"},
    {"id":"TC-13","title":"Gift-message textarea enforces the 200-char limit","priority":"low","category":"validation"},
    {"id":"TC-14","title":"Loyalty points apply correctly at checkout","priority":"medium","category":"calculation"},
    {"id":"TC-15","title":"Accessibility: checkout is navigable with keyboard only","priority":"high","category":"a11y"}
  ]'::jsonb
);

-- ---------- Matrix #3 — SaaS signup ----------
INSERT INTO test_matrices (source_url, page_title, captured_at, generated_at, total_cases, cases)
VALUES (
  'https://demo.autoqa.dev/saas/signup',
  'Linear Clone — Create your workspace',
  now() - interval '3 days 2 hours',
  now() - interval '3 days 2 hours',
  9,
  '[
    {"id":"TC-01","title":"Email validation catches malformed addresses","priority":"high","category":"validation"},
    {"id":"TC-02","title":"Password strength meter updates live as user types","priority":"medium","category":"ui"},
    {"id":"TC-03","title":"Duplicate workspace slug shows an inline error","priority":"high","category":"validation"},
    {"id":"TC-04","title":"OAuth button initiates the Google SSO flow","priority":"high","category":"integration"},
    {"id":"TC-05","title":"Continue is disabled until all required fields are valid","priority":"high","category":"guard"},
    {"id":"TC-06","title":"Verification email is sent after successful signup","priority":"high","category":"side-effect"},
    {"id":"TC-07","title":"Clicking terms link opens a new tab","priority":"low","category":"navigation"},
    {"id":"TC-08","title":"Signup survives network interruption with a clear retry","priority":"medium","category":"resilience"},
    {"id":"TC-09","title":"Screen reader announces inline validation errors","priority":"high","category":"a11y"}
  ]'::jsonb
);

-- ---------- Matrix #4 — Dashboard app (most recent) ----------
INSERT INTO test_matrices (source_url, page_title, captured_at, generated_at, total_cases, cases)
VALUES (
  'https://demo.autoqa.dev/app/dashboard',
  'Linear Clone — Project Dashboard',
  now() - interval '18 minutes',
  now() - interval '15 minutes',
  11,
  '[
    {"id":"TC-01","title":"New issue appears at the top of the board when created","priority":"high","category":"happy-path"},
    {"id":"TC-02","title":"Drag-and-drop moves an issue between columns","priority":"high","category":"interaction"},
    {"id":"TC-03","title":"Filter by assignee hides non-matching issues","priority":"medium","category":"filter"},
    {"id":"TC-04","title":"Keyboard shortcut C opens the create-issue dialog","priority":"medium","category":"a11y"},
    {"id":"TC-05","title":"Issue count badge matches the column body count","priority":"low","category":"consistency"},
    {"id":"TC-06","title":"Long issue titles truncate with an ellipsis","priority":"low","category":"ui"},
    {"id":"TC-07","title":"Deleting an issue shows an undo toast for 5 seconds","priority":"medium","category":"safety"},
    {"id":"TC-08","title":"Real-time updates appear without a page refresh","priority":"high","category":"sync"},
    {"id":"TC-09","title":"Dark mode toggle persists across sessions","priority":"low","category":"persistence"},
    {"id":"TC-10","title":"Mobile layout collapses the sidebar into a hamburger","priority":"medium","category":"responsive"},
    {"id":"TC-11","title":"Accessibility: focus trap works inside modal dialogs","priority":"high","category":"a11y"}
  ]'::jsonb
);

-- ---------- Bug reports ----------
-- A realistic mix — some failures, one timeout, one flaky assertion, spread
-- over the last few days so the dashboard's "relative time" rendering looks
-- natural. The error stacks are trimmed to keep the seed readable.

INSERT INTO bug_reports (test_id, test_title, describe_path, source_spec, status, expected, actual, error_message, error_stack, duration_ms, run_at) VALUES
(
  'TC-02',
  'Empty todo input does not create an item',
  'TodoMVC › creation guardrails',
  'tests/demo/todomvc.spec.ts',
  'failed',
  'No new .todo-list li should appear after pressing Enter on an empty input.',
  'A blank <li> was appended to the list, leaving the UI in a broken state.',
  'expect(locator).toHaveCount(expected) — Expected: 0, Received: 1',
  'Error: expect(locator).toHaveCount(expected)
    at TodoMVC.spec.ts:24:38
    at Locator.expect (playwright/lib/locator.js:1122:24)',
  1847,
  now() - interval '8 minutes'
),
(
  'TC-08',
  'Todo with only whitespace is trimmed then discarded',
  'TodoMVC › creation guardrails',
  'tests/demo/todomvc.spec.ts',
  'failed',
  'Input value of "   " should be trimmed and produce no new todo.',
  'A todo titled "   " was added with three rendered spaces.',
  'expect(locator).toHaveCount(expected) — Expected: 0, Received: 1',
  'Error: expect(locator).toHaveCount(expected)
    at TodoMVC.spec.ts:58:38',
  1602,
  now() - interval '8 minutes'
),
(
  'TC-02',
  'Invalid promo code surfaces a clear error',
  'Checkout › validation',
  'tests/demo/checkout.spec.ts',
  'failed',
  'An error banner with text matching /invalid.*promo/i should appear within 3s.',
  'The page reloaded without any visible error; promo field silently cleared.',
  'TimeoutError: locator.waitFor: Timeout 3000ms exceeded.',
  'TimeoutError: locator.waitFor: Timeout 3000ms exceeded.
    at Checkout.spec.ts:47:12
    waiting for getByRole(''alert'', { name: /invalid.*promo/i })',
  3001,
  now() - interval '1 day 3 hours'
),
(
  'TC-05',
  'Place-order button is disabled until terms are accepted',
  'Checkout › purchase guard',
  'tests/demo/checkout.spec.ts',
  'failed',
  'Place-order button should have the disabled attribute when terms checkbox is unchecked.',
  'The button was enabled immediately on page load regardless of checkbox state.',
  'expect(locator).toBeDisabled() — Locator was enabled',
  'Error: expect(locator).toBeDisabled()
    at Checkout.spec.ts:102:43
    locator: getByRole(''button'', { name: /place order/i })',
  1189,
  now() - interval '1 day 3 hours'
),
(
  'TC-09',
  'Tax calculation matches the subtotal × rate for each state',
  'Checkout › pricing',
  'tests/demo/checkout.spec.ts',
  'failed',
  'Tax row should read "$8.75" for a $100 subtotal in California (8.75%).',
  'Tax row shows "$0.00" — state selector value was not read during recalculation.',
  'expect(received).toBe(expected) // $8.75 !== $0.00',
  'AssertionError: expect(received).toBe(expected)
    at Checkout.spec.ts:134:30',
  2213,
  now() - interval '1 day 3 hours'
),
(
  'TC-03',
  'Duplicate workspace slug shows an inline error',
  'Signup › validation',
  'tests/demo/signup.spec.ts',
  'failed',
  'Inline error "Slug already taken" should render beneath the workspace-slug input.',
  'Form submitted successfully and redirected to /onboarding, creating a second workspace with a conflicting slug.',
  'expect(locator).toBeVisible() — Expected the error text locator to be visible',
  'Error: expect(locator).toBeVisible()
    at Signup.spec.ts:72:22
    locator: text=/slug already taken/i',
  1524,
  now() - interval '2 days 23 hours'
),
(
  'TC-06',
  'Verification email is sent after successful signup',
  'Signup › side effects',
  'tests/demo/signup.spec.ts',
  'timedOut',
  'Verification email should be recorded in the outbox within 10s of signup.',
  'No outbox entry appeared within 10s — mail queue worker is likely stalled.',
  'Test timeout of 10000ms exceeded while waiting for outbox fixture to populate.',
  'TimeoutError: Test timeout of 10000ms exceeded.
    at Signup.spec.ts:98:5',
  10001,
  now() - interval '3 days'
),
(
  'TC-02',
  'Drag-and-drop moves an issue between columns',
  'Dashboard › board interaction',
  'tests/demo/dashboard.spec.ts',
  'failed',
  'Issue card should appear in the destination column after a drag from "Todo" to "In Progress".',
  'Card snapped back to its original column; native HTML5 drag events did not fire.',
  'expect(locator).toContainText(expected) — destination column missing the card',
  'Error: expect(locator).toContainText(expected)
    at Dashboard.spec.ts:61:38',
  2984,
  now() - interval '12 minutes'
),
(
  'TC-08',
  'Real-time updates appear without a page refresh',
  'Dashboard › sync',
  'tests/demo/dashboard.spec.ts',
  'failed',
  'An issue created in another tab should appear within 2s via websocket push.',
  'Card only appeared after a manual F5 refresh — websocket connection is idle.',
  'expect(locator).toBeVisible() — Timed out after 2000ms',
  'Error: expect(locator).toBeVisible()
    at Dashboard.spec.ts:140:30',
  2011,
  now() - interval '11 minutes'
);

-- Done. Refresh https://autoqa-dashboard.onrender.com and the Command Center
-- should show 4 matrices, 47 total cases, and 9 bug reports.
