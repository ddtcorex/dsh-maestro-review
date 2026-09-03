import { describe, it, expect } from 'vitest'
import { collectLintFindings, lintResultText } from '../src/host/govard-audit-lint-tool.js'

const compatFinding = { tool: 'M2-LINT-COMPAT', message: 'Internal error: Class "Zend_Db_Select" not found while analysing file /source/app/code/BeBe9/X.php' }
const phpcsFinding = { tool: 'phpcs', path: 'a.php', line: 10, rule: 'Magento2.Security.Xss', message: 'x' }

function envelope(findings: unknown[]): unknown {
  return { results: [{ evidence: { php_results: [{ php_version: '8.2', findings }] } }] }
}

describe('collectLintFindings', () => {
  it('collects nested envelope findings into buckets incl. compat', () => {
    const out = collectLintFindings(envelope([compatFinding, phpcsFinding]))
    expect(out.compat).toHaveLength(1)
    expect(out.compat[0].message).toContain('Zend_Db_Select')
    expect(out.phpcsViolations).toHaveLength(1)
    expect(out.total).toBe(2)
  })
  it('still reads the legacy top-level findings array', () => {
    const out = collectLintFindings({ findings: [phpcsFinding] })
    expect(out.phpcsViolations).toHaveLength(1)
    expect(out.total).toBe(1)
  })
  it('returns empty buckets when no findings shape matches', () => {
    expect(collectLintFindings({ status: 'passed' }).total).toBe(0)
  })
})

describe('lintResultText with compat', () => {
  it('counts compat and shows its message', () => {
    const text = lintResultText({ ok: false, exitCode: 1, lint: { phpcs: { violations: [] }, phpstan: { errors: [] }, pubMediaGuard: { violations: [] }, compat: { findings: [{ tool: 'M2-LINT-COMPAT', message: 'Internal error: Class "Zend_Db_Select" not found' }] } }, summary: { findingCount: 1 }, diagnostics: '' } as never)
    expect(text).toContain('1 finding(s)')
    expect(text).toContain('compat 1')
    expect(text).toContain('Zend_Db_Select')
  })
})
