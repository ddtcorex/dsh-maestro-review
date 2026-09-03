// Standalone LLM agent for the headless review runner.
// Calls OpenCode-go (DeepSeek provider) with the MR diff and parses findings.
// Never logs API keys; reads apiKey from cfg passed in by cli.runners.ts.

export interface ReviewFinding {
  path: string
  line?: number
  message: string
  severity?: 'security' | 'perf' | 'convention' | 'style' | 'info'
}

export interface AgentResult {
  findings: ReviewFinding[]
  summary: string
}

export interface AgentConfig {
  provider: string           // 'opencode-go'
  baseUrl: string            // e.g. https://api.openode.ai/v1
  apiKey: string
  model: string              // e.g. muse-spark-1.3-contributor
  mode: 'quick' | 'deep'
}

interface GitlabChange {
  old_path: string
  new_path: string
  diff: string
}

/** Build the diff prompt sent to the LLM. */
function buildPrompt(changes: GitlabChange[], cfg: AgentConfig): string {
  const files = changes
    .map((c) => `### ${c.new_path}\n${c.diff}`)
    .join('\n\n')
  return [
    'You are "Maestro", an expert Magento 2 + Hyvä frontend code reviewer.',
    '',
    'You will be given a GitLab merge request diff. Review the changes and return a JSON array of findings.',
    '',
    'Each finding MUST be JSON object:',
    `{"file":"src/app/Code/Module/File.php","line":42,"message":"why this is bad","severity":"perf"}`,
    '',
    'severity values: security, perf, convention, style, info. Omit line when the finding is file-wide.',
    '',
    '**Rules:**',
    '- Flag XSS (unescaped output in .phtml via echo/$block escaping helpers)',
    '- Flag unoptimized image loading (missing loading="lazy" on <img>)',
    '- Flag Magento anti-patterns (non-frozen di.xml, incorrect cache types)',
    '- Flag Hyvä/Alpine misuse (x-data on wrong element, missing x-cloak)',
    '- Keep messages under 180 chars, no trailing periods.',
    '- Return ONLY a JSON array, nothing else, even if empty.',
    '',
    `Mode: ${cfg.mode}`,
    '',
    '### MR diff:',
    files,
    '',
    'Findings (JSON array):',
  ].join('\n')
}

function parseFindings(text: string): ReviewFinding[] {
  const trimmed = text.trim()
  if (!trimmed.startsWith('[')) return []
  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
      .map((f) => ({
        path: String(f.file ?? f.path ?? ''),
        line: typeof f.line === 'number' ? f.line : undefined,
        message: String(f.message ?? f.body ?? ''),
        severity: (f.severity as ReviewFinding['severity']) ?? 'info',
      }))
      .filter((f) => f.path)
  } catch {
    return []
  }
}

/**
 * Creates an agent result by calling OpenCode-go and parsing findings.
 * Falls back to a graceful summary on any error so the runner never crashes.
 */
export async function createReviewAgent(
  cfg: AgentConfig,
  changes: GitlabChange[],
  fetchImpl: typeof fetch = fetch
): Promise<AgentResult> {
  if (!cfg.apiKey) {
    return { findings: [], summary: `Diff-only review for ${changes.length} file(s) (no LLM API key configured).` }
  }
  const body = JSON.stringify({
    model: cfg.model,
    messages: [{ role: 'user', content: buildPrompt(changes, cfg) }],
    temperature: 0.1,
    max_tokens: 2048,
  })
  let resp: Response
  try {
    resp = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { findings: [], summary: `LLM review failed (network): ${msg.slice(0, 120)}` }
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '')
    return { findings: [], summary: `LLM review failed (HTTP ${resp.status}): ${txt.slice(0, 120)}` }
  }
  const data: { choices?: Array<{ message?: { content?: string } }> } = await resp.json()
  const content = data.choices?.[0]?.message?.content ?? ''
  const findings = parseFindings(content)
  if (findings.length > 0) {
    return {
      findings,
      summary: `LLM diff review: ${findings.length} finding(s) across ${changes.length} file(s).`,
    }
  }
  return { findings: [], summary: `Diff-only review for ${changes.length} file(s): no findings.` }
}
