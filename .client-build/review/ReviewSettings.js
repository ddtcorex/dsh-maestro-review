"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewSettings = ReviewSettings;
/**
 * The GitLab and Review keys `dsh-maestro-review` owns, and nothing else.
 *
 * Secrets follow a three-state rule and are never rendered back: the server
 * answers `hasGitlabToken` / `hasWebhookSecret` instead of the value, a blank
 * field keeps what is stored, and a filled field replaces it.
 */
const React = __importStar(require("react"));
const BrandMark_js_1 = require("../BrandMark.js");
/**
 * What each setting is called on screen.
 *
 * The page used to label every field with `String(key)`, so it read
 * "gitlabBaseUrl" and "reviewSessionRetentionDays" to anyone who had not
 * opened the store. The key stays as the `data-review-input` value and the
 * wire name; only the visible label changes.
 */
const FIELD_LABELS = {
    gitlabBaseUrl: 'GitLab base URL',
    botUsername: 'Bot username',
    webhookPort: 'Webhook port',
    autoRereviewOnPush: 'Re-review on push',
    autoReviewOnAssign: 'Review on assign',
    agentTimeoutMs: 'Agent timeout (ms)',
    reviewSessionRetentionDays: 'Session retention (days)',
};
/**
 * One setting, in the house pattern's two-column row: label and hint left,
 * control held right. `htmlFor`/`id` are what give the control its accessible
 * name — the previous markup rendered a bare `<label>` beside an input with no
 * `id`, so nothing was associated.
 */
function Field(props) {
    return React.createElement('div', { 'data-review-row': '' }, React.createElement('div', { 'data-review-row-text': '' }, React.createElement('label', { 'data-review-label': '', htmlFor: props.id }, props.label), props.hint ? React.createElement('p', { 'data-review-hint': '' }, props.hint) : null), React.createElement('div', { 'data-review-control': '' }, props.children));
}
function SecretField(props) {
    return Field({
        id: props.id,
        label: props.label,
        hint: props.present ? 'A value is stored. Leave blank to keep it.' : 'Not set.',
        children: React.createElement('div', { 'data-review-secret-group': '' }, React.createElement('input', {
            id: props.id,
            type: 'password',
            value: props.value,
            placeholder: props.present ? 'stored — type to replace' : 'not set',
            disabled: props.disabled,
            autoComplete: 'new-password',
            'data-review-secret': '',
            onChange: (e) => props.onChange(e.target.value),
        }), 
        // The save belongs to this field: it stays disabled until the field
        // holds something, and floating it below the row left it orphaned.
        React.createElement('button', {
            type: 'button',
            disabled: props.disabled || props.value === '',
            'data-review-save-secret': props.name,
            onClick: props.onSave,
        }, 'Save')),
    });
}
function ReviewSettings(props) {
    const { rpcCall } = props;
    const [cfg, setCfg] = React.useState({});
    const [gitlabToken, setGitlabToken] = React.useState('');
    const [webhookSecret, setWebhookSecret] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [notice, setNotice] = React.useState(null);
    const fail = React.useCallback((e) => {
        setNotice({ tone: 'bad', text: e instanceof Error ? e.message : String(e) });
    }, []);
    const refresh = React.useCallback(async () => {
        setBusy(true);
        try {
            setCfg((await rpcCall('maestro.getConfig')) ?? {});
        }
        catch (e) {
            fail(e);
        }
        finally {
            setBusy(false);
        }
    }, [rpcCall, fail]);
    React.useEffect(() => {
        void refresh();
    }, [refresh]);
    const save = React.useCallback(async (patch) => {
        setBusy(true);
        try {
            await rpcCall('maestro.saveConfig', patch);
            // Blank means keep, so the local field clears only after the save
            // landed; otherwise a failed save would silently drop what was typed.
            if ('gitlabToken' in patch)
                setGitlabToken('');
            if ('webhookSecret' in patch)
                setWebhookSecret('');
            setNotice({ tone: 'ok', text: 'Saved.' });
            await refresh();
        }
        catch (e) {
            fail(e);
        }
        finally {
            setBusy(false);
        }
    }, [rpcCall, refresh, fail]);
    const text = (key, placeholder = '') => Field({
        id: `review-${String(key)}`,
        label: FIELD_LABELS[key] ?? String(key),
        children: React.createElement('input', {
            id: `review-${String(key)}`,
            type: 'text',
            value: cfg[key] ?? '',
            placeholder,
            disabled: busy,
            'data-review-input': String(key),
            onChange: (e) => setCfg((c) => ({ ...c, [key]: e.target.value })),
            onBlur: (e) => void save({ [key]: e.target.value }),
        }),
    });
    const toggle = (key) => Field({
        id: `review-${String(key)}`,
        label: FIELD_LABELS[key] ?? String(key),
        children: React.createElement('input', {
            id: `review-${String(key)}`,
            type: 'checkbox',
            checked: cfg[key] === true,
            disabled: busy,
            'data-review-toggle': String(key),
            onChange: (e) => void save({ [key]: e.target.checked }),
        }),
    });
    return React.createElement('div', { 'data-review-root': '' }, 
    // House header: badge, title, one-line status. The notice lives here so it
    // reports without pushing the rows down.
    React.createElement('div', { 'data-review-header': '' }, React.createElement(BrandMark_js_1.BrandBadge, { style: { alignSelf: 'flex-start', marginTop: 2 } }), React.createElement('div', { 'data-review-heading': '' }, React.createElement('h2', { 'data-review-title': '' }, 'GitLab and Review'), React.createElement('div', { 'data-review-status': '' }, notice
        ? React.createElement('p', { 'data-review-notice': '', 'data-tone': notice.tone, role: 'status' }, notice.text)
        : React.createElement('span', null, 'GitLab credentials and review triggers.')))), React.createElement('div', { 'data-review-actions': '' }, React.createElement('button', { type: 'button', disabled: busy, onClick: () => void refresh() }, 'Refresh')), text('gitlabBaseUrl', 'https://gitlab.example.com'), text('botUsername', 'maestro-bot'), SecretField({
        id: 'review-gitlab-token',
        name: 'gitlabToken',
        label: 'GitLab token',
        present: cfg.hasGitlabToken === true,
        value: gitlabToken,
        disabled: busy,
        onChange: setGitlabToken,
        onSave: () => void save({ gitlabToken }),
    }), SecretField({
        id: 'review-webhook-secret',
        name: 'webhookSecret',
        label: 'Webhook secret',
        present: cfg.hasWebhookSecret === true,
        value: webhookSecret,
        disabled: busy,
        onChange: setWebhookSecret,
        onSave: () => void save({ webhookSecret }),
    }), text('webhookPort', '3081'), toggle('autoRereviewOnPush'), toggle('autoReviewOnAssign'), text('agentTimeoutMs', '600000'), text('reviewSessionRetentionDays', '30'));
}
//# sourceMappingURL=ReviewSettings.js.map