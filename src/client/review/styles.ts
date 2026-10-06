/**
 * Token-native styling for the review settings section. Every colour and
 * radius resolves through a `--dsw-*` alias, so the section follows the shell
 * theme instead of carrying a palette of its own.
 *
 * The iOS block holds text fields at 16px on coarse pointers: iOS WebKit
 * magnifies the viewport for a focused field below that size, and a magnified
 * sheet never blurs back.
 */
export const REVIEW_CSS = `
[data-review-root], [data-review-root] * { box-sizing: border-box; }
[data-review-root] {
  display: flex; flex-direction: column; gap: 12px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px; line-height: 1.5;
  min-width: 0; width: 100%; max-width: 640px;
}

/* House header: badge + title + one-line status. */
[data-review-header] { display: flex; gap: 10px; align-items: flex-start; padding: 2px 2px 8px; }
[data-review-heading] { display: flex; flex-direction: column; min-width: 0; }
[data-review-title] { margin: 0; font-size: 15px; font-weight: 600; line-height: 22px; }
[data-review-status] { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
[data-review-status] [data-review-notice] { margin: 0; }
[data-review-status] [data-review-notice][data-tone="ok"] { color: var(--dsw-alias-state-success-primary); }
[data-review-status] [data-review-notice][data-tone="bad"] { color: var(--dsw-alias-state-error-primary); }

[data-review-actions] { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
[data-review-actions] button {
  min-height: 32px; padding: 0 12px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
  color: inherit; font: inherit; cursor: pointer;
}
[data-review-actions] button:disabled { opacity: 0.55; cursor: default; }
[data-review-actions] button:focus-visible { outline: 2px solid var(--dsw-alias-border-l2); outline-offset: 2px; }

/* House row: label and hint left, control held right, hairline between. */
[data-review-row] {
  display: flex; align-items: center; gap: 8px;
  padding: 16px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); min-width: 0;
}
[data-review-row]:last-of-type { border-bottom: none; }
[data-review-row-text] { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; padding-right: 48px; }
[data-review-control] { flex: none; display: flex; align-items: center; justify-content: flex-end; gap: 8px; min-height: 36px; }
/* Declared once. These two rules previously existed twice — the 12px/600 pair
   sat AFTER the house values and won on source order at equal specificity, so
   the whole tab rendered at the old weight and the old hint size. */
[data-review-label] { font-size: 14px; font-weight: 400; line-height: 22px; color: var(--dsw-alias-label-primary); }
[data-review-hint] { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }

/* A secret whose value is committed by a button: input and save travel
   together on ONE row. The button used to sit on a row of its own below the
   field — the group was a column and the button was align-self: flex-end —
   which orphaned it from the control it saves. It stays disabled until the
   field holds something, so proximity to that field is the point. */
[data-review-secret-group] { display: flex; flex-direction: row; align-items: center; gap: 8px; min-width: 220px; }
[data-review-secret-group] input { flex: 1 1 auto; min-width: 0; }
[data-review-secret-group] button {
  flex: none; align-self: center; min-height: 44px; padding: 0 12px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
  color: inherit; font: inherit; cursor: pointer;
}
[data-review-secret-group] button:disabled { opacity: 0.55; cursor: default; }
[data-review-secret-group] button:focus-visible { outline: 2px solid var(--dsw-alias-border-l2); outline-offset: 2px; }

/* Every row control gets the same box — the shared settings field box, copied
   from the host's own form primitive (ui-primitives ConfigField) so this tab
   follows the shell instead of carrying a geometry of its own. Only
   min-height: 44px is Maestro's: it is the touch target AGENTS.md requires,
   which the host's line-box sizing does not give.
   The password type belongs in this list: without it the two secret fields
   rendered at the UA default — 21px tall, no radius — beside their neighbours
   in the same column. */
[data-review-control] input[type="text"], [data-review-control] input[type="password"], [data-review-control] select {
  min-height: 44px; padding: 6px 12px; border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary); font: inherit;
}
[data-review-control] input:focus-visible, [data-review-control] select:focus-visible {
  outline: 2px solid var(--dsw-alias-border-l2); outline-offset: 2px;
}
/* The checkbox is the one control the harness draws at its own size; without
   this it rendered at the UA's 13px. Same values as the reference row. */
[data-review-control] input[type="checkbox"] {
  width: 16px; height: 16px; margin: 0; flex: none;
  accent-color: var(--dsw-alias-brand-primary, #0A84FF);
}

[data-review-pin], [data-review-lan] { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
[data-review-pin] code, [data-review-lan] code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 2px 6px; border-radius: 6px; background: var(--dsw-alias-bg-layer-2);
}
[data-review-pin] button, [data-review-lan] button {
  min-height: 32px; padding: 0 10px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
  color: inherit; font: inherit; cursor: pointer;
}

@media (max-width: 640px) {
  /* Below the measure the row stacks: a right-held control has no room left,
     and a wrapped one reads as a third column. */
  [data-review-row] { flex-direction: column; align-items: stretch; gap: 8px; }
  [data-review-row-text] { padding-right: 0; }
  /* Every field takes the full row width, with or without a Save button: the
     button stays on the same row and the input takes the rest. */
  [data-review-control] { justify-content: flex-start; width: 100%; }
  [data-review-control] input[type="text"], [data-review-control] input[type="password"], [data-review-control] select { flex: 1 1 auto; min-width: 0; width: 100%; }
  [data-review-secret-group] { width: 100%; min-width: 0; }
  /* A checkbox row does not stack: label and hint stay left, the box is held
     right as a 44px tap target on the same line. Stacked, it left a lone 16px
     box on a line of its own under the label. */
  [data-review-row]:has(> [data-review-control] > input[type="checkbox"]:only-child) { flex-direction: row; align-items: center; gap: 12px; }
  [data-review-row]:has(> [data-review-control] > input[type="checkbox"]:only-child) [data-review-control] { flex: none; width: auto; min-width: 44px; min-height: 44px; justify-content: center; }
}

@media (max-width: 480px) {
  [data-review-actions] button { flex: 1 1 auto; min-height: 40px; }
}

/* iOS 16px field floor: the magnifier fires below this on a focused field. */
@media (max-width: 1023px) and (pointer: coarse) {
  html[data-mobile-nav-ios] [data-review-root] input,
  html[data-mobile-nav-ios] [data-review-root] select { font-size: 16px !important; }
}
`