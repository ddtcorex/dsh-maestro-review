"use strict";
/**
 * Mark this plugin's row in the DSH settings navigation so a style block can
 * replace the shell's fallback gear with the maestro glyph.
 *
 * DSH 0.1.x projects only `id`, `order`, and `label` from a `settings.section`
 * registration and picks icons from a closed built-in list, so each external
 * plugin identifies its own localized row by visible text after the dialog
 * mounts. The marker owns no shell structure and is removed on disposal.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SETTINGS_NAV_MARKER = void 0;
exports.registerSettingsNavIcon = registerSettingsNavIcon;
exports.SETTINGS_NAV_MARKER = 'data-maestro-gateway-settings-nav';
function registerSettingsNavIcon(label, root) {
    if (typeof document === 'undefined' && root === undefined) {
        // Node-side import safety (tests inject a stub root instead).
        return () => { };
    }
    const scope = (root ?? document);
    let disposed = false;
    const sync = () => {
        if (disposed)
            return;
        const currentLabel = label().trim();
        const buttons = scope.querySelectorAll('[role="dialog"] nav button');
        for (const button of Array.from(buttons)) {
            const el = button;
            const matches = currentLabel.length > 0 &&
                button.textContent != null &&
                button.textContent.trim() === currentLabel;
            if (matches)
                el.setAttribute(exports.SETTINGS_NAV_MARKER, '');
            else
                el.removeAttribute(exports.SETTINGS_NAV_MARKER);
        }
    };
    sync();
    let observer = null;
    if (typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(sync);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    return () => {
        disposed = true;
        if (observer !== null)
            observer.disconnect();
        for (const element of Array.from(scope.querySelectorAll(`[${exports.SETTINGS_NAV_MARKER}]`))) {
            element.removeAttribute(exports.SETTINGS_NAV_MARKER);
        }
    };
}
//# sourceMappingURL=settings-nav-icon.js.map