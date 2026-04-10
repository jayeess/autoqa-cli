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

  // Type-specific functional cases (email, url, tel, number, password)
  form.fields.forEach((field) => {
    const typeCase = casesForTypedInput(field, section);
    if (typeCase) cases.push({ ...typeCase, id: idGen() });
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

/** Returns an un-ID'd TestCase (caller assigns id). Returns null when no type-specific case applies. */
function casesForTypedInput(
  field: DomElement,
  section: string,
): Omit<TestCase, 'id'> | null {
  if (field.kind !== 'input') return null;

  switch (field.type) {
    case 'email':
      return {
        category: 'Negative',
        element: describeElement(field),
        action: 'Enter a malformed email (e.g. "not-an-email") and blur the field.',
        expected: 'The field reports an invalid email format error.',
        elementKind: field.kind,
        elementLocator: field.suggestedLocator,
        section,
      };
    case 'url':
      return {
        category: 'Negative',
        element: describeElement(field),
        action: 'Enter a non-URL string (e.g. "foo") and blur the field.',
        expected: 'The field reports an invalid URL format error.',
        elementKind: field.kind,
        elementLocator: field.suggestedLocator,
        section,
      };
    case 'number':
      return {
        category: 'Negative',
        element: describeElement(field),
        action: 'Enter non-numeric characters.',
        expected: 'The field rejects the input or reports a numeric validation error.',
        elementKind: field.kind,
        elementLocator: field.suggestedLocator,
        section,
      };
    case 'tel':
      return {
        category: 'Functional',
        element: describeElement(field),
        action: 'Enter a well-formed phone number.',
        expected: 'The value is accepted without validation errors.',
        elementKind: field.kind,
        elementLocator: field.suggestedLocator,
        section,
      };
    case 'password':
      return {
        category: 'Functional',
        element: describeElement(field),
        action: 'Type a value and verify it is masked from view.',
        expected: 'Entered characters are obscured (bullets/asterisks).',
        elementKind: field.kind,
        elementLocator: field.suggestedLocator,
        section,
      };
    default:
      return null;
  }
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
    const typeCase = casesForTypedInput(el, section);
    if (typeCase) cases.push({ ...typeCase, id: idGen() });
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
