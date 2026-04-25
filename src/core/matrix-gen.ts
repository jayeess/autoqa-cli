/**
 * matrix-gen.ts — turns a DomMap into a systematic test matrix.
 *
 * Produces three artifacts from one input:
 *   1. A structured `TestMatrix` (JS object)        — buildMatrix()
 *   2. A Markdown document for human review         — renderMatrixMarkdown()
 *   3. A row pushed to the Supabase `test_matrices` — pushMatrixToSupabase()
 *
 * The test-case heuristics here are deliberately deterministic — we
 * don't call Claude at this stage. The matrix is meant to be a clean
 * human-reviewable spec; Step 4 (test-writer) is where the LLM turns
 * each case into executable Playwright code.
 *
 * Test case categories generated:
 *   - Functional: happy-path interactions (fill form, click button, follow link)
 *   - Negative:   validation failures (missing required fields, disabled state)
 *   - Regression: rendering / presence checks that guard against drift
 *   - Accessibility: basic a11y hygiene (buttons have accessible names, etc.)
 */

import type {
  DomMap,
  DomElement,
  DomForm,
  TestCase,
  TestMatrix,
  TestCategory,
} from '../types/index.js';
import { getSupabaseClient } from '../utils/supabase-client.js';

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/** Build a structured TestMatrix from a DOM map. Pure, synchronous, testable. */
export function buildMatrix(domMap: DomMap): TestMatrix {
  const cases: TestCase[] = [];
  const idGen = makeIdGenerator();

  // 1. Form-level cases
  domMap.forms.forEach((form, index) => {
    const section = describeForm(form, index);
    cases.push(...casesForForm(form, section, idGen));
  });

  // 2. Loose button cases
  domMap.buttons.forEach((btn) => {
    cases.push(...casesForButton(btn, 'Buttons', idGen));
  });

  // 3. Loose input cases (not inside a form)
  domMap.inputs.forEach((input) => {
    cases.push(...casesForLooseInput(input, 'Inputs', idGen));
  });

  // 4. Link navigation cases
  domMap.links.forEach((link) => {
    cases.push(...casesForLink(link, 'Links', idGen));
  });

  // 5. Custom role-based interactives
  domMap.other.forEach((el) => {
    cases.push(...casesForOther(el, 'Other Interactive', idGen));
  });

  return {
    sourceUrl: domMap.url,
    pageTitle: domMap.title,
    capturedAt: domMap.capturedAt,
    generatedAt: new Date().toISOString(),
    totalCases: cases.length,
    cases,
  };
}

/** Render a TestMatrix to a human-reviewable Markdown document. */
export function renderMatrixMarkdown(matrix: TestMatrix): string {
  const lines: string[] = [];

  lines.push(`# Test Matrix: ${escapeMd(matrix.pageTitle || matrix.sourceUrl)}`);
  lines.push('');
  lines.push(`> **Source URL:** ${matrix.sourceUrl}`);
  lines.push(`> **DOM captured at:** ${matrix.capturedAt}`);
  lines.push(`> **Matrix generated at:** ${matrix.generatedAt}`);
  lines.push(`> **Total cases:** ${matrix.totalCases}`);
  lines.push('');

  // Category breakdown
  const byCategory = countBy(matrix.cases, (c) => c.category);
  lines.push('## Summary');
  lines.push('');
  (['Functional', 'Negative', 'Regression', 'Accessibility'] as TestCategory[]).forEach(
    (cat) => {
      const count = byCategory[cat] ?? 0;
      lines.push(`- **${cat}:** ${count}`);
    },
  );
  lines.push('');

  // Group cases by section for readability
  const sections = groupBy(matrix.cases, (c) => c.section ?? 'Uncategorized');
  for (const [section, sectionCases] of sections) {
    lines.push(`## ${section}`);
    lines.push('');
    lines.push('| ID | Category | Element | Action | Expected Result |');
    lines.push('|----|----------|---------|--------|-----------------|');
    for (const c of sectionCases) {
      lines.push(
        `| ${c.id} | ${c.category} | ${escapeMd(c.element)} | ${escapeMd(c.action)} | ${escapeMd(c.expected)} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Push a TestMatrix to the `test_matrices` Supabase table.
 *
 * Expected table shape (create this in Supabase before using):
 *
 *   create table test_matrices (
 *     id           uuid primary key default gen_random_uuid(),
 *     source_url   text not null,
 *     page_title   text,
 *     captured_at  timestamptz,
 *     generated_at timestamptz not null default now(),
 *     total_cases  integer not null,
 *     cases        jsonb   not null
 *   );
 *
 * Returns the inserted row's id on success.
 */
export async function pushMatrixToSupabase(matrix: TestMatrix): Promise<string> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('test_matrices')
    .insert({
      source_url: matrix.sourceUrl,
      page_title: matrix.pageTitle,
      captured_at: matrix.capturedAt,
      generated_at: matrix.generatedAt,
      total_cases: matrix.totalCases,
      cases: matrix.cases,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Supabase insert failed: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error('Supabase insert returned no id.');
  }

  return data.id as string;
}

/* ------------------------------------------------------------------ */
/*  Case generation helpers                                            */
/* ------------------------------------------------------------------ */

type IdGen = () => string;

function makeIdGenerator(): IdGen {
  let n = 0;
  return () => {
    n += 1;
    return `TC-${String(n).padStart(3, '0')}`;
  };
}

function describeForm(form: DomForm, index: number): string {
  if (form.ariaLabel) return `Form: ${form.ariaLabel}`;
  if (form.name) return `Form: ${form.name}`;
  if (form.id) return `Form: #${form.id}`;
  if (form.testId) return `Form: [data-testid="${form.testId}"]`;
  return `Form #${index + 1}`;
}

function describeElement(el: DomElement): string {
  if (el.ariaLabel) return `${capitalize(el.kind)} "${el.ariaLabel}"`;
  if (el.text) return `${capitalize(el.kind)} "${el.text}"`;
  if (el.testId) return `${capitalize(el.kind)} [data-testid="${el.testId}"]`;
  if (el.name) return `${capitalize(el.kind)} [name="${el.name}"]`;
  if (el.id) return `${capitalize(el.kind)} #${el.id}`;
  if (el.placeholder) return `${capitalize(el.kind)} "${el.placeholder}"`;
  return `<${el.tag}> element`;
}

function casesForForm(form: DomForm, section: string, idGen: IdGen): TestCase[] {
  const cases: TestCase[] = [];
  const formLabel = section;
  const submitLocator = form.submit?.suggestedLocator;

  // Happy path — fill every field with valid input and submit.
  const fillable = form.fields.filter((f) =>
    ['input', 'textarea', 'select'].includes(f.kind),
  );
  if (fillable.length > 0 && form.submit) {
    cases.push({
      id: idGen(),
      category: 'Functional',
      element: formLabel,
      action: `Fill all ${fillable.length} field(s) with valid values and submit.`,
      expected:
        'Form submits successfully, no validation errors appear, and the user is advanced to the next state (navigation, success message, or network request).',
      elementKind: 'form',
      elementLocator: submitLocator,
      section,
    });
  }

  // Negative — submit empty when required fields exist.
  const requiredFields = form.fields.filter((f) => f.required);
  if (requiredFields.length > 0 && form.submit) {
    cases.push({
      id: idGen(),
      category: 'Negative',
      element: formLabel,
      action: 'Leave all required fields blank and attempt to submit.',
      expected: `Form does not submit; validation errors are shown on ${requiredFields.length} required field(s): ${requiredFields
        .map((f) => describeElement(f))
        .join(', ')}.`,
      elementKind: 'form',
      elementLocator: submitLocator,
      section,
    });
  }

  // Per-required-field negative cases
  requiredFields.forEach((field) => {
    cases.push({
      id: idGen(),
      category: 'Negative',
      element: describeElement(field),
      action: 'Submit the form with this required field left blank.',
      expected:
        'A validation error is displayed for this field and the form is not submitted.',
      elementKind: field.kind,
      elementLocator: field.suggestedLocator,
      section,
    });
  });

  // Type-specific functional + boundary cases (email, url, tel, number, date, password, etc.)
  form.fields.forEach((field) => {
    for (const c of casesForTypedInput(field, section)) {
      cases.push({ ...c, id: idGen() });
    }
  });

  // Regression — form is rendered
  cases.push({
    id: idGen(),
    category: 'Regression',
    element: formLabel,
    action: 'Load the page and inspect the form.',
    expected: `Form renders with ${form.fields.length} visible field(s)${form.submit ? ' and a submit control' : ''}.`,
    elementKind: 'form',
    elementLocator: submitLocator,
    section,
  });

  // Accessibility — form has an accessible name
  if (!form.ariaLabel) {
    cases.push({
      id: idGen(),
      category: 'Accessibility',
      element: formLabel,
      action: 'Check the form for an accessible name (aria-label / aria-labelledby).',
      expected: 'Form exposes an accessible name to assistive technology.',
      elementKind: 'form',
      section,
    });
  }

  return cases;
}

/**
 * Returns zero or more un-ID'd test cases for type-specific validation
 * (format errors, boundary values, masking). The caller assigns ids.
 */
function casesForTypedInput(
  field: DomElement,
  section: string,
): Array<Omit<TestCase, 'id'>> {
  if (field.kind !== 'input') return [];

  const label = describeElement(field);
  const locator = field.suggestedLocator;
  const kind = field.kind;
  const ctx = { element: label, elementKind: kind, elementLocator: locator, section };

  switch (field.type) {
    case 'email':
      return [
        {
          ...ctx,
          category: 'Negative',
          action: 'Enter a malformed email (e.g. "not-an-email") and blur the field.',
          expected: 'The field reports an invalid email format error.',
        },
      ];

    case 'url':
      return [
        {
          ...ctx,
          category: 'Negative',
          action: 'Enter a non-URL string (e.g. "foo") and blur the field.',
          expected: 'The field reports an invalid URL format error.',
        },
      ];

    case 'number':
    case 'range':
      return casesForNumericInput(field, ctx);

    case 'date':
    case 'datetime-local':
    case 'month':
    case 'week':
    case 'time':
      return casesForDateInput(field, ctx);

    case 'tel':
      return [
        {
          ...ctx,
          category: 'Functional',
          action: 'Enter a well-formed phone number.',
          expected: 'The value is accepted without validation errors.',
        },
      ];

    case 'password':
      return [
        {
          ...ctx,
          category: 'Functional',
          action: 'Type a value and verify it is masked from view.',
          expected: 'Entered characters are obscured (bullets/asterisks).',
        },
      ];

    case 'text':
    case 'search':
      return casesForTextLengthInput(field, ctx);

    default:
      return [];
  }
}

/** Shared context shape for a typed-input case factory. */
type TypedCaseCtx = {
  element: string;
  elementKind: DomElement['kind'];
  elementLocator: string;
  section: string;
};

/**
 * Boundary-value coverage for number/range inputs.
 * Uses whatever min/max/step were captured; otherwise emits generic boundary cases.
 */
function casesForNumericInput(
  field: DomElement,
  ctx: TypedCaseCtx,
): Array<Omit<TestCase, 'id'>> {
  const cases: Array<Omit<TestCase, 'id'>> = [
    {
      ...ctx,
      category: 'Negative',
      action: 'Enter non-numeric characters.',
      expected: 'The field rejects the input or reports a numeric validation error.',
    },
  ];

  if (field.min !== undefined) {
    cases.push({
      ...ctx,
      category: 'Functional',
      action: `Enter the minimum allowed value (${field.min}).`,
      expected: 'Value is accepted without validation errors.',
    });
    cases.push({
      ...ctx,
      category: 'Negative',
      action: `Enter a value one unit below min (${decrementBound(field.min, field.step)}).`,
      expected: 'Field reports a range-underflow validation error.',
    });
  }

  if (field.max !== undefined) {
    cases.push({
      ...ctx,
      category: 'Functional',
      action: `Enter the maximum allowed value (${field.max}).`,
      expected: 'Value is accepted without validation errors.',
    });
    cases.push({
      ...ctx,
      category: 'Negative',
      action: `Enter a value one unit above max (${incrementBound(field.max, field.step)}).`,
      expected: 'Field reports a range-overflow validation error.',
    });
  }

  // If neither min nor max was declared, still provide generic edge coverage.
  if (field.min === undefined && field.max === undefined) {
    cases.push(
      {
        ...ctx,
        category: 'Functional',
        action: 'Enter zero (0).',
        expected: 'Value is accepted and stored as 0.',
      },
      {
        ...ctx,
        category: 'Functional',
        action: 'Enter a negative number (e.g. -1).',
        expected:
          'If the field allows negatives, value is accepted; otherwise a validation error is reported.',
      },
      {
        ...ctx,
        category: 'Functional',
        action: 'Enter a very large number (e.g. 999999999).',
        expected:
          'Value is accepted or rejected consistently with the field\'s intended range.',
      },
    );
  }

  if (field.step !== undefined && field.step !== 'any') {
    cases.push({
      ...ctx,
      category: 'Negative',
      action: `Enter a value that does not align with step=${field.step} (e.g. an off-step fractional value).`,
      expected: 'Field reports a step-mismatch validation error.',
    });
  }

  return cases;
}

/**
 * Boundary-value coverage for date/datetime/month/week/time inputs.
 */
function casesForDateInput(
  field: DomElement,
  ctx: TypedCaseCtx,
): Array<Omit<TestCase, 'id'>> {
  const cases: Array<Omit<TestCase, 'id'>> = [
    {
      ...ctx,
      category: 'Negative',
      action: 'Enter a malformed date string (e.g. "2023-13-45").',
      expected: 'Field rejects the value or reports an invalid date error.',
    },
  ];

  if (field.min !== undefined) {
    cases.push(
      {
        ...ctx,
        category: 'Functional',
        action: `Enter the earliest allowed date (${field.min}).`,
        expected: 'Date is accepted without validation errors.',
      },
      {
        ...ctx,
        category: 'Negative',
        action: `Enter a date before min (${field.min}).`,
        expected: 'Field reports a date range-underflow error.',
      },
    );
  }

  if (field.max !== undefined) {
    cases.push(
      {
        ...ctx,
        category: 'Functional',
        action: `Enter the latest allowed date (${field.max}).`,
        expected: 'Date is accepted without validation errors.',
      },
      {
        ...ctx,
        category: 'Negative',
        action: `Enter a date after max (${field.max}).`,
        expected: 'Field reports a date range-overflow error.',
      },
    );
  }

  return cases;
}

/**
 * Length-boundary coverage for text/search inputs with minlength / maxlength.
 */
function casesForTextLengthInput(
  field: DomElement,
  ctx: TypedCaseCtx,
): Array<Omit<TestCase, 'id'>> {
  const cases: Array<Omit<TestCase, 'id'>> = [];

  if (field.minLength !== undefined && field.minLength > 0) {
    cases.push(
      {
        ...ctx,
        category: 'Functional',
        action: `Enter exactly minlength (${field.minLength}) characters.`,
        expected: 'Value is accepted.',
      },
      {
        ...ctx,
        category: 'Negative',
        action: `Enter one character below minlength (${field.minLength - 1}).`,
        expected: 'Field reports a too-short validation error.',
      },
    );
  }

  if (field.maxLength !== undefined && field.maxLength > 0) {
    cases.push(
      {
        ...ctx,
        category: 'Functional',
        action: `Enter exactly maxlength (${field.maxLength}) characters.`,
        expected: 'Value is accepted.',
      },
      {
        ...ctx,
        category: 'Negative',
        action: `Attempt to enter one character above maxlength (${field.maxLength + 1}).`,
        expected: 'Input is truncated to maxlength or a too-long error is reported.',
      },
    );
  }

  if (field.pattern !== undefined) {
    cases.push({
      ...ctx,
      category: 'Negative',
      action: `Enter a value that does not match the pattern /${field.pattern}/.`,
      expected: 'Field reports a pattern-mismatch validation error.',
    });
  }

  return cases;
}

/** Best-effort arithmetic on a bound value, preserving formatting for dates. */
function decrementBound(value: string, step?: string): string {
  const stepNum = step && step !== 'any' ? Number.parseFloat(step) : 1;
  const n = Number.parseFloat(value);
  if (Number.isFinite(n) && Number.isFinite(stepNum)) {
    return String(n - stepNum);
  }
  return `< ${value}`;
}

function incrementBound(value: string, step?: string): string {
  const stepNum = step && step !== 'any' ? Number.parseFloat(step) : 1;
  const n = Number.parseFloat(value);
  if (Number.isFinite(n) && Number.isFinite(stepNum)) {
    return String(n + stepNum);
  }
  return `> ${value}`;
}

function casesForButton(btn: DomElement, section: string, idGen: IdGen): TestCase[] {
  const label = describeElement(btn);
  const cases: TestCase[] = [
    {
      id: idGen(),
      category: 'Functional',
      element: label,
      action: 'Click the button.',
      expected:
        'The associated action is triggered (navigation, modal, network request, or state change).',
      elementKind: btn.kind,
      elementLocator: btn.suggestedLocator,
      section,
    },
    {
      id: idGen(),
      category: 'Regression',
      element: label,
      action: 'Load the page.',
      expected: 'Button renders, is visible, and is enabled (unless intentionally disabled).',
      elementKind: btn.kind,
      elementLocator: btn.suggestedLocator,
      section,
    },
  ];

  if (btn.disabled) {
    cases.push({
      id: idGen(),
      category: 'Negative',
      element: label,
      action: 'Attempt to click the disabled button.',
      expected: 'Click has no effect; no action is triggered.',
      elementKind: btn.kind,
      elementLocator: btn.suggestedLocator,
      section,
    });
  }

  if (!btn.ariaLabel && !btn.text) {
    cases.push({
      id: idGen(),
      category: 'Accessibility',
      element: label,
      action: 'Inspect the button for an accessible name.',
      expected: 'Button exposes an accessible name via text, aria-label, or title.',
      elementKind: btn.kind,
      elementLocator: btn.suggestedLocator,
      section,
    });
  }

  return cases;
}

function casesForLooseInput(el: DomElement, section: string, idGen: IdGen): TestCase[] {
  const label = describeElement(el);
  const cases: TestCase[] = [
    {
      id: idGen(),
      category: 'Functional',
      element: label,
      action:
        el.kind === 'checkbox' || el.kind === 'radio'
          ? 'Toggle the control.'
          : el.kind === 'select'
            ? 'Select an option.'
            : 'Type a valid value into the field.',
      expected: 'The value is reflected in the control state.',
      elementKind: el.kind,
      elementLocator: el.suggestedLocator,
      section,
    },
  ];

  if (el.required) {
    cases.push({
      id: idGen(),
      category: 'Negative',
      element: label,
      action: 'Leave the required control empty and trigger validation.',
      expected: 'A validation error is displayed for the required field.',
      elementKind: el.kind,
      elementLocator: el.suggestedLocator,
      section,
    });
  }

  if (el.kind === 'input') {
    for (const c of casesForTypedInput(el, section)) {
      cases.push({ ...c, id: idGen() });
    }
  }

  return cases;
}

function casesForLink(link: DomElement, section: string, idGen: IdGen): TestCase[] {
  const label = describeElement(link);
  const target = link.href ?? '(no href)';
  return [
    {
      id: idGen(),
      category: 'Functional',
      element: label,
      action: `Click the link.`,
      expected: `Navigation occurs to ${target}.`,
      elementKind: link.kind,
      elementLocator: link.suggestedLocator,
      section,
    },
    {
      id: idGen(),
      category: 'Regression',
      element: label,
      action: 'Load the page.',
      expected: `Link is present and its href resolves to ${target}.`,
      elementKind: link.kind,
      elementLocator: link.suggestedLocator,
      section,
    },
  ];
}

function casesForOther(el: DomElement, section: string, idGen: IdGen): TestCase[] {
  return [
    {
      id: idGen(),
      category: 'Functional',
      element: describeElement(el),
      action: `Interact with the ${el.role ?? el.kind} element.`,
      expected: 'The element responds to interaction as expected for its role.',
      elementKind: el.kind,
      elementLocator: el.suggestedLocator,
      section,
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Small pure helpers                                                 */
/* ------------------------------------------------------------------ */

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/** Escape characters that would break a Markdown table cell. */
function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function countBy<T, K extends string>(items: T[], key: (item: T) => K): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Group items preserving insertion order, returned as a Map for stability. */
function groupBy<T, K extends string>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) {
      bucket.push(item);
    } else {
      out.set(k, [item]);
    }
  }
  return out;
}
