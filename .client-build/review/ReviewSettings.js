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
function Field(props) {
    return React.createElement('div', { 'data-review-field': '' }, React.createElement('label', { 'data-review-label': '' }, props.label), props.children, props.hint ? React.createElement('p', { 'data-review-hint': '' }, props.hint) : null);
}
function SecretField(props) {
    return Field({
        label: props.label,
        hint: props.present ? 'A value is stored. Leave blank to keep it.' : 'Not set.',
        children: React.createElement('input', {
            type: 'password',
            value: props.value,
            placeholder: props.present ? 'stored — type to replace' : 'not set',
            disabled: props.disabled,
            autoComplete: 'new-password',
            'data-review-secret': '',
            onChange: (e) => props.onChange(e.target.value),
        }),
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
        label: String(key),
        children: React.createElement('input', {
            type: 'text',
            value: cfg[key] ?? '',
            placeholder,
            disabled: busy,
            'data-review-input': String(key),
            onChange: (e) => setCfg((c) => ({ ...c, [key]: e.target.value })),
            onBlur: (e) => void save({ [key]: e.target.value }),
        }),
    });
    const toggle = (key, title) => Field({
        label: title,
        children: React.createElement('input', {
            type: 'checkbox',
            checked: cfg[key] === true,
            disabled: busy,
            'aria-label': title,
            'data-review-toggle': String(key),
            onChange: (e) => void save({ [key]: e.target.checked }),
        }),
    });
    return React.createElement('div', { 'data-review-root': '' }, React.createElement('h2', { 'data-review-title': '' }, 'GitLab and Review'), notice
        ? React.createElement('p', { 'data-review-notice': '', 'data-tone': notice.tone, role: 'status' }, notice.text)
        : null, React.createElement('div', { 'data-review-actions': '' }, React.createElement('button', { type: 'button', disabled: busy, onClick: () => void refresh() }, 'Refresh')), text('gitlabBaseUrl', 'https://gitlab.example.com'), text('botUsername', 'maestro-bot'), SecretField({
        label: 'GitLab token',
        present: cfg.hasGitlabToken === true,
        value: gitlabToken,
        disabled: busy,
        onChange: setGitlabToken,
    }), React.createElement('button', {
        type: 'button',
        disabled: busy || gitlabToken === '',
        'data-review-save-secret': 'gitlabToken',
        onClick: () => void save({ gitlabToken }),
    }, 'Save token'), SecretField({
        label: 'Webhook secret',
        present: cfg.hasWebhookSecret === true,
        value: webhookSecret,
        disabled: busy,
        onChange: setWebhookSecret,
    }), React.createElement('button', {
        type: 'button',
        disabled: busy || webhookSecret === '',
        'data-review-save-secret': 'webhookSecret',
        onClick: () => void save({ webhookSecret }),
    }, 'Save secret'), text('webhookPort', '3081'), toggle('autoRereviewOnPush', 'Re-review on push'), toggle('autoReviewOnAssign', 'Review on assign'), text('agentTimeoutMs', '600000'), text('reviewSessionRetentionDays', '30'));
}
//# sourceMappingURL=ReviewSettings.js.map