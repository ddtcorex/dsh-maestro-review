import { describe, expect, it } from 'vitest'
import { pinRotationText, reviewDigestText } from '../src/host/notify.ts'

describe('notify text builders', () => {
  it('renders the review digest outcome line with an optional summary', () => {
    const html1 = reviewDigestText({ projectPath: 'group/project', mrIid: 12, status: 'completed', summary: 'All good' })
    expect(html1).toContain('🤖 Maestro Review')
    expect(html1).toContain('group/project')
    expect(html1).toContain('!12')
    expect(html1).toContain('✅ Completed')
    expect(html1).toContain('All good')
    expect(html1).toContain('<code>group/project</code>')
    expect(html1).toContain('<b>Status:</b>')
    const html2 = reviewDigestText({ projectPath: 'group/project', mrIid: 13, status: 'failed', summary: undefined })
    expect(html2).toContain('group/project')
    expect(html2).toContain('!13')
    expect(html2).toContain('⚠️ Failed')
  })

  it('renders rich review digest with mode/profile/findings and escapes HTML', () => {
    const html = reviewDigestText({
      projectPath: 'group/project', mrIid: 7, status: 'completed', summary: 'Fix <x> & check',
      mode: 'deep', profile: 'magento2', gitlabBaseUrl: 'https://git.example.com',
      findings: { newCount: 2, replyCount: 1, failedCount: 0 },
    })
    expect(html).toContain('<code>deep</code>')
    expect(html).toContain('<code>magento2</code>')
    expect(html).toContain('2 new')
    expect(html).toContain('1 reply')
    expect(html).toContain('Fix &lt;x&gt; &amp; check')
    expect(html).toContain('https://git.example.com/group/project/-/merge_requests/7')
    expect(html).toContain('View MR')
  })

  it('renders the PIN rotation notice', () => {
    expect(pinRotationText('87654321')).toBe('DSH public access PIN was rotated\nNew PIN: 87654321')
  })
})
