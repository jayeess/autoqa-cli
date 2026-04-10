/**
 * Shared types used by every module in AutoQA.
 *
 * The DOM map produced by the crawler is the single source of truth
 * that drives matrix generation and Claude-powered test authoring,
 * so these interfaces must stay lean and LLM-friendly: no noise,
 * no styling, no positional coordinates — only the attributes a test
 * author would actually reach for when writing assertions.
 */

/** What category of interactive element this is. */
export type ElementKind =
  | 'button'
  | 'input'
  | 'textarea'
  | 'select'
  | 'link'
  | 'checkbox'
  | 'radio'
  | 'other';

/**
 * A single interactive element captured from the page.
 *
 * Every field except `tag`, `kind`, and `suggestedLocator` is optional:
 * we omit empty/missing values entirely so the resulting JSON stays
 * minimal and LLM-legible.
 */
export interface DomElement {
  /** Lowercase tag name (e.g. "input", "button", "a"). */
  tag: string;
  /** High-level classification used by matrix-gen and test-writer. */
  kind: ElementKind;
  /** DOM id attribute. */
  id?: string;
  /** `name` attribute — critical for form fields. */
  name?: string;
  /** `type` attribute for inputs and buttons (e.g. "email", "submit"). */
  type?: string;
  /** `data-testid` — the most stable selector hint for tests. */
  testId?: string;
  /** ARIA role (explicit or implicit). */
  role?: string;
  /** Accessible name — derived from aria-label, aria-labelledby, or <label>. */
  ariaLabel?: string;
  /** Trimmed, truncated inner text. */
  text?: string;
  /** Placeholder text for inputs/textareas. */
  placeholder?: string;
  /** Resolved absolute href for anchors. */
  href?: string;
  /** `value` attribute (never captured for password inputs). */
  value?: string;
  /** Whether the field is marked `required`. */
  required?: boolean;
  /** Whether the element is disabled. */
  disabled?: boolean;
  /** A Playwright locator expression the LLM can paste straight into tests. */
  suggestedLocator: string;
}

/**
 * A `<form>` and its child fields, grouped so matrix-gen can reason
 * about form-level test cases (happy path, validation, submission).
 */
export interface DomForm {
  id?: string;
  name?: string;
  action?: string;
  method?: string;
  testId?: string;
  ariaLabel?: string;
  /** All non-submit interactive fields inside the form. */
  fields: DomElement[];
  /** The form's submit button, if one was found. */
  submit?: DomElement;
}

/** Test case categories emitted by matrix-gen. */
export type TestCategory = 'Functional' | 'Regression' | 'Negative' | 'Accessibility';

/**
 * A single row of the generated test matrix.
 * Each case maps 1:1 to a Markdown table row *and* to a JSON record
 * that can be pushed to the Supabase `test_matrices.cases` column.
 */
export interface TestCase {
  /** Stable identifier within the matrix (e.g. "TC-001"). */
  id: string;
  category: TestCategory;
  /** Human-readable element description ("Login form", "Submit button"). */
  element: string;
  /** What the test should do. */
  action: string;
  /** What the test should assert afterwards. */
  expected: string;
  /** Optional back-reference to the source element's kind. */
  elementKind?: ElementKind | 'form';
  /** Optional Playwright locator for the element under test. */
  elementLocator?: string;
  /** Optional grouping (e.g. form name) used for Markdown section headings. */
  section?: string;
}

/**
 * Structured matrix produced by matrix-gen. This is the shape we
 * render to Markdown *and* push to Supabase.
 */
export interface TestMatrix {
  sourceUrl: string;
  pageTitle: string;
  capturedAt: string;
  generatedAt: string;
  totalCases: number;
  cases: TestCase[];
}

/** The full DOM snapshot produced by `autoqa scan`. */
export interface DomMap {
  /** The URL originally requested. */
  url: string;
  /** The URL after any redirects. */
  finalUrl: string;
  /** The `<title>` of the loaded page. */
  title: string;
  /** ISO timestamp of when the scan completed. */
  capturedAt: string;
  /** Viewport the page was rendered in. */
  viewport: { width: number; height: number };
  /** Forms and their grouped fields. */
  forms: DomForm[];
  /** Loose buttons not inside a form. */
  buttons: DomElement[];
  /** Loose inputs/selects/textareas not inside a form. */
  inputs: DomElement[];
  /** Links on the page. */
  links: DomElement[];
  /** Other role-based interactive elements (e.g. `[role="button"]` divs). */
  other: DomElement[];
}
