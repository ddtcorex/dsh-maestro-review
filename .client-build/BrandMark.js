"use strict";
/**
 * The Maestro M badge this package's settings header draws.
 *
 * A copy of `dsh-maestro-core/src/client/config/components/BrandMark.tsx`, for
 * the structural reason its own header explains: one plugin's client bundle
 * cannot import another's. The glyph and tile come from `./maestro-mark.ts`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MaestroMark = MaestroMark;
exports.BrandBadge = BrandBadge;
const react_1 = require("react");
const maestro_mark_js_1 = require("./maestro-mark.js");
function MaestroMark(props) {
    const s = props.size ?? 16;
    return (0, react_1.createElement)('svg', { width: s, height: s, viewBox: maestro_mark_js_1.MAESTRO_MARK_VIEWBOX, fill: 'none', 'aria-hidden': 'true' }, (0, react_1.createElement)('path', { d: maestro_mark_js_1.MAESTRO_MARK_PATH, stroke: 'currentColor', strokeWidth: maestro_mark_js_1.MAESTRO_MARK_STROKE_WIDTH, strokeLinecap: 'round', strokeLinejoin: 'round' }));
}
/**
 * The 28px brand tile. Its colour, border, shadow and radius are the brand and
 * are not negotiable — a token-only background resolves to near-white on some
 * dark themes, which is why the fixed tile exists.
 */
function BrandBadge(props) {
    const outer = props.outer ?? 28;
    const size = props.size ?? 16;
    const radius = props.radius ?? 8;
    return (0, react_1.createElement)('span', {
        'data-maestro-logo': '',
        style: {
            width: outer, height: outer, borderRadius: radius, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: `var(--dsw-alias-brand-primary, ${maestro_mark_js_1.MAESTRO_BRAND_TILE})`, backgroundColor: maestro_mark_js_1.MAESTRO_BRAND_TILE, color: '#fff', flex: 'none',
            border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 0 0 1px var(--dsw-alias-border-l1)', boxSizing: 'border-box',
            ...props.style,
        },
    }, (0, react_1.createElement)(MaestroMark, { size }));
}
//# sourceMappingURL=BrandMark.js.map