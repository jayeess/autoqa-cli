# Test Matrix: Sign in

> **Source URL:** https://example.test/login
> **DOM captured at:** 2026-04-10T00:00:00.000Z
> **Matrix generated at:** 2026-04-10T07:27:07.780Z
> **Total cases:** 12

## Summary

- **Functional:** 5
- **Negative:** 4
- **Regression:** 3
- **Accessibility:** 0

## Form: Sign in

| ID | Category | Element | Action | Expected Result |
|----|----------|---------|--------|-----------------|
| TC-001 | Functional | Form: Sign in | Fill all 2 field(s) with valid values and submit. | Form submits successfully, no validation errors appear, and the user is advanced to the next state (navigation, success message, or network request). |
| TC-002 | Negative | Form: Sign in | Leave all required fields blank and attempt to submit. | Form does not submit; validation errors are shown on 2 required field(s): Input "Email", Input "Password". |
| TC-003 | Negative | Input "Email" | Submit the form with this required field left blank. | A validation error is displayed for this field and the form is not submitted. |
| TC-004 | Negative | Input "Password" | Submit the form with this required field left blank. | A validation error is displayed for this field and the form is not submitted. |
| TC-005 | Negative | Input "Email" | Enter a malformed email (e.g. "not-an-email") and blur the field. | The field reports an invalid email format error. |
| TC-006 | Functional | Input "Password" | Type a value and verify it is masked from view. | Entered characters are obscured (bullets/asterisks). |
| TC-007 | Regression | Form: Sign in | Load the page and inspect the form. | Form renders with 3 visible field(s) and a submit control. |

## Buttons

| ID | Category | Element | Action | Expected Result |
|----|----------|---------|--------|-----------------|
| TC-008 | Functional | Button "Open menu" | Click the button. | The associated action is triggered (navigation, modal, network request, or state change). |
| TC-009 | Regression | Button "Open menu" | Load the page. | Button renders, is visible, and is enabled (unless intentionally disabled). |

## Inputs

| ID | Category | Element | Action | Expected Result |
|----|----------|---------|--------|-----------------|
| TC-010 | Functional | Input [name="search"] | Type a valid value into the field. | The value is reflected in the control state. |

## Links

| ID | Category | Element | Action | Expected Result |
|----|----------|---------|--------|-----------------|
| TC-011 | Functional | Link "Forgot password?" | Click the link. | Navigation occurs to https://example.test/forgot. |
| TC-012 | Regression | Link "Forgot password?" | Load the page. | Link is present and its href resolves to https://example.test/forgot. |
