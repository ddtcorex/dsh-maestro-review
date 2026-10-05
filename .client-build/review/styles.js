"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REVIEW_CSS = void 0;
/**
 * Token-native styling for the review settings section. Every colour and
 * radius resolves through a `--dsw-*` alias, so the section follows the shell
 * theme instead of carrying a palette of its own.
 *
 * The iOS block holds text fields at 16px on coarse pointers: iOS WebKit
 * magnifies the viewport for a focused field below that size, and a magnified
 * sheet never blurs back.
 */
exports.REVIEW_CSS = `
[data-review-root], [data-review-root] * { box-sizing: border-box; }
[data-review-root] {
  display: flex; flex-direction: column; gap: 12px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px; line-height: 1.5;
  min-width: 0; width: 100%; max-width: 640px;
}

[data-review-title] { margin: 0; font-size: 15px; font-weight: 600; line-height: 22px; }

[data-review-notice] { margin: 0; font-size: 12px; }
[data-review-notice][data-tone="ok"] { color: var(--dsw-alias-state-success-primary); }
[data-review-notice][data-tone="bad"] { color: var(--dsw-alias-state-error-primary); }

[data-review-actions] { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
[data-review-actions] button {
  min-height: 32px; padding: 0 12px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
  color: inherit; font: inherit; cursor: pointer;
}
[data-review-actions] button:disabled { opacity: 0.55; cursor: default; }
[data-review-actions] button:focus-visible { outline: 2px solid var(--dsw-alias-border-l2); outline-offset: 2px; }

[data-review-field] { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
[data-review-label] { font-size: 12px; font-weight: 600; }
[data-review-hint] { margin: 0; font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-secondary); }

[data-review-field] input[type="text"], [data-review-field] select {
  min-height: 32px; padding: 0 10px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);
  color: inherit; font: inherit;
}
[data-review-field] input[type="text"]:focus-visible, [data-review-field] select:focus-visible {
  outline: 2px solid var(--dsw-alias-border-l2); outline-offset: 2px;
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

@media (max-width: 480px) {
  [data-review-actions] button { flex: 1 1 auto; min-height: 40px; }
}

/* iOS 16px field floor: the magnifier fires below this on a focused field. */
@media (max-width: 1023px) and (pointer: coarse) {
  html[data-mobile-nav-ios] [data-review-root] input,
  html[data-mobile-nav-ios] [data-review-root] select { font-size: 16px !important; }
}
`;
//# sourceMappingURL=styles.js.map