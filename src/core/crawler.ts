/**
 * crawler.ts — Playwright-backed DOM extractor.
 *
 * Goal: visit a target URL and emit a compact JSON map of every
 * interactive element, with *only* the attributes an LLM actually
 * needs to reason about the page and write assertions. We deliberately
 * skip visual/styling information, bounding boxes, and anything that
 * would add noise to the prompt sent to Claude in `test-writer.ts`.
 *
 * Attributes we capture (when present):
 *   - tag, role (explicit or implicit)
 *   - id, name, type, data-testid
 *   - accessible name (aria-label / aria-labelledby / <label> for)
 *   - inner text (trimmed + truncated)
 *   - placeholder, href, value
 *   - required, disabled
 *
 * And for every element we also emit a `suggestedLocator` — a ready-to-paste
 * Playwright locator expression following the Playwright team's priority:
 *     data-testid > id > role+name > name > placeholder > text > tag
 */

import { chromium, type Browser } from 'playwright';
import type { DomMap, DomElement, DomForm } from '../types/index.js';

export interface CrawlerOptions {
  url: string;
  headless?: boolean;
  timeoutMs?: number;
  viewport?: { width: number; height: number };
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
}

const DEFAULTS: Required<Omit<CrawlerOptions, 'url'>> = {
  headless: true,
  timeoutMs: 30_000,
  viewport: { width: 1280, height: 800 },
  waitUntil: 'networkidle',
};

/**
 * Crawl a single URL and return a DomMap describing its interactive DOM.
 *
 * Side-effect free: no files are written here — the caller (scan command)
 * decides where to persist the result.
 */
export async function crawl(options: CrawlerOptions): Promise<DomMap> {
  const cfg = { ...DEFAULTS, ...options };

  const browser: Browser = await chromium.launch({ headless: cfg.headless });
  try {
    const context = await browser.newContext({ viewport: cfg.viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(cfg.timeoutMs);

    await page.goto(cfg.url, {
      waitUntil: cfg.waitUntil,
      timeout: cfg.timeoutMs,
    });

    // Everything inside extractDomInPage runs in the browser context
    // and must therefore be self-contained (no Node imports, no closure
    // references to anything outside the function body).
    const extracted = await page.evaluate(extractDomInPage);
    const title = await page.title();
    const finalUrl = page.url();

    return {
      url: cfg.url,
      finalUrl,
      title,
      capturedAt: new Date().toISOString(),
      viewport: cfg.viewport,
      forms: extracted.forms,
      buttons: extracted.buttons,
      inputs: extracted.inputs,
      links: extracted.links,
      other: extracted.other,
    };
  } finally {
    await browser.close();
  }
}

/* ------------------------------------------------------------------ */
/*  Page-context extractor                                             */
/* ------------------------------------------------------------------ */

/**
 * Runs inside the browser via `page.evaluate`. Keep this function
 * self-contained: TypeScript types get erased at compile time, but any
 * runtime value referenced from the outer module would be undefined
 * in the page context.
 */
function extractDomInPage(): {
  forms: DomForm[];
  buttons: DomElement[];
  inputs: DomElement[];
  links: DomElement[];
  other: DomElement[];
} {
  const MAX_TEXT = 120;

  const truncate = (s: string | null | undefined): string | undefined => {
    if (!s) return undefined;
    const trimmed = s.trim().replace(/\s+/g, ' ');
    if (!trimmed) return undefined;
    return trimmed.length > MAX_TEXT ? trimmed.slice(0, MAX_TEXT) + '…' : trimmed;
  };

  const escape = (s: string): string => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  const isVisible = (el: Element): boolean => {
    const htmlEl = el as HTMLElement;
    const rect = htmlEl.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(htmlEl);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (style.opacity === '0') return false;
    return true;
  };

  const implicitRole = (el: Element): string | undefined => {
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case 'button':
        return 'button';
      case 'a':
        return (el as HTMLAnchorElement).href ? 'link' : undefined;
      case 'input': {
        const type = (el as HTMLInputElement).type;
        if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        return 'textbox';
      }
      case 'textarea':
        return 'textbox';
      case 'select':
        return 'combobox';
      default:
        return undefined;
    }
  };

  const getAccessibleName = (el: Element): string | undefined => {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return truncate(ariaLabel);

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return truncate(labelEl.textContent);
    }

    // Associated <label for="..."> elements for form controls.
    if ('labels' in el) {
      const labels = (el as HTMLInputElement).labels;
      if (labels && labels.length > 0) {
        return truncate(labels[0].textContent);
      }
    }

    return undefined;
  };

  const classifyKind = (el: Element): DomElement['kind'] => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a') return 'link';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    if (tag === 'input') {
      const type = (el as HTMLInputElement).type;
      if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      return 'input';
    }
    const role = el.getAttribute('role');
    if (role === 'button') return 'button';
    if (role === 'link') return 'link';
    if (role === 'checkbox') return 'checkbox';
    if (role === 'radio') return 'radio';
    return 'other';
  };

  /**
   * Build a Playwright-ready locator string for the LLM to drop into tests.
   * Order follows the Playwright team's official selector priority.
   */
  const suggestLocator = (el: Element, accessibleName: string | undefined): string => {
    const tag = el.tagName.toLowerCase();

    const testId = el.getAttribute('data-testid');
    if (testId) return `page.getByTestId('${escape(testId)}')`;

    const id = el.getAttribute('id');
    if (id) return `page.locator('#${escape(id)}')`;

    const role = el.getAttribute('role') || implicitRole(el);
    if (role && accessibleName) {
      return `page.getByRole('${role}', { name: '${escape(accessibleName)}' })`;
    }

    const name = el.getAttribute('name');
    if (name) return `page.locator('${tag}[name="${escape(name)}"]')`;

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.placeholder) return `page.getByPlaceholder('${escape(el.placeholder)}')`;
    }

    if (tag === 'a' || tag === 'button') {
      const text = truncate(el.textContent);
      if (text) {
        const locatorRole = tag === 'a' ? 'link' : 'button';
        return `page.getByRole('${locatorRole}', { name: '${escape(text)}' })`;
      }
    }

    return `page.locator('${tag}')`;
  };

  /**
   * Serialize a single element into our LLM-friendly shape.
   * We omit every empty/absent attribute so the JSON stays minimal.
   */
  const serialize = (el: Element): DomElement => {
    const tag = el.tagName.toLowerCase();
    const accessibleName = getAccessibleName(el);
    const kind = classifyKind(el);

    const out: DomElement = {
      tag,
      kind,
      suggestedLocator: suggestLocator(el, accessibleName),
    };

    const id = el.getAttribute('id');
    if (id) out.id = id;

    const name = el.getAttribute('name');
    if (name) out.name = name;

    const testId = el.getAttribute('data-testid');
    if (testId) out.testId = testId;

    const role = el.getAttribute('role') || implicitRole(el);
    if (role) out.role = role;

    if (accessibleName) out.ariaLabel = accessibleName;

    if (el instanceof HTMLInputElement) {
      out.type = el.type;
      if (el.placeholder) out.placeholder = el.placeholder;
      // Never capture password values.
      if (el.value && el.type !== 'password') out.value = el.value;
      if (el.required) out.required = true;
      if (el.disabled) out.disabled = true;
      // Boundary-relevant attributes for numeric, date, range, and text inputs.
      const minAttr = el.getAttribute('min');
      if (minAttr !== null) out.min = minAttr;
      const maxAttr = el.getAttribute('max');
      if (maxAttr !== null) out.max = maxAttr;
      const stepAttr = el.getAttribute('step');
      if (stepAttr !== null) out.step = stepAttr;
      if (el.minLength >= 0 && el.getAttribute('minlength') !== null) {
        out.minLength = el.minLength;
      }
      if (el.maxLength >= 0 && el.getAttribute('maxlength') !== null) {
        out.maxLength = el.maxLength;
      }
      const patternAttr = el.getAttribute('pattern');
      if (patternAttr) out.pattern = patternAttr;
    } else if (el instanceof HTMLTextAreaElement) {
      if (el.placeholder) out.placeholder = el.placeholder;
      if (el.value) out.value = el.value;
      if (el.required) out.required = true;
      if (el.disabled) out.disabled = true;
      if (el.minLength >= 0 && el.getAttribute('minlength') !== null) {
        out.minLength = el.minLength;
      }
      if (el.maxLength >= 0 && el.getAttribute('maxlength') !== null) {
        out.maxLength = el.maxLength;
      }
    } else if (el instanceof HTMLSelectElement) {
      if (el.value) out.value = el.value;
      if (el.required) out.required = true;
      if (el.disabled) out.disabled = true;
    } else if (el instanceof HTMLButtonElement) {
      out.type = el.type || 'button';
      if (el.disabled) out.disabled = true;
      const text = truncate(el.textContent);
      if (text) out.text = text;
    } else if (el instanceof HTMLAnchorElement) {
      if (el.href) out.href = el.href;
      const text = truncate(el.textContent);
      if (text) out.text = text;
    } else {
      // Custom/role-based interactive (e.g. <div role="button">).
      const text = truncate(el.textContent);
      if (text) out.text = text;
    }

    return out;
  };

  // 1. Collect every interactive element on the page.
  const interactiveSelector = [
    'button',
    'a[href]',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="textbox"]',
    '[role="combobox"]',
  ].join(',');

  // 2. Walk each visible <form> first so we can group its fields cohesively.
  const forms: DomForm[] = [];
  const claimed = new Set<Element>();

  document.querySelectorAll('form').forEach((formEl) => {
    if (!isVisible(formEl)) return;

    const fields: DomElement[] = [];
    let submit: DomElement | undefined;

    formEl.querySelectorAll(interactiveSelector).forEach((child) => {
      if (!isVisible(child)) return;
      claimed.add(child);

      const serialized = serialize(child);
      if (serialized.kind === 'button' && serialized.type === 'submit' && !submit) {
        submit = serialized;
        return;
      }
      fields.push(serialized);
    });

    const form: DomForm = { fields };
    if (formEl.id) form.id = formEl.id;
    const formName = formEl.getAttribute('name');
    if (formName) form.name = formName;
    const action = formEl.getAttribute('action');
    if (action) form.action = action;
    const method = formEl.getAttribute('method');
    if (method) form.method = method;
    const formTestId = formEl.getAttribute('data-testid');
    if (formTestId) form.testId = formTestId;
    const formAria = getAccessibleName(formEl);
    if (formAria) form.ariaLabel = formAria;
    if (submit) form.submit = submit;

    forms.push(form);
  });

  // 3. Bucket any remaining loose interactive elements by kind.
  const buttons: DomElement[] = [];
  const inputs: DomElement[] = [];
  const links: DomElement[] = [];
  const other: DomElement[] = [];

  document.querySelectorAll(interactiveSelector).forEach((el) => {
    if (claimed.has(el)) return;
    if (!isVisible(el)) return;

    const serialized = serialize(el);
    switch (serialized.kind) {
      case 'button':
        buttons.push(serialized);
        break;
      case 'link':
        links.push(serialized);
        break;
      case 'input':
      case 'textarea':
      case 'select':
      case 'checkbox':
      case 'radio':
        inputs.push(serialized);
        break;
      default:
        other.push(serialized);
    }
  });

  return { forms, buttons, inputs, links, other };
}
