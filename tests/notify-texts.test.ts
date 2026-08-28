import { describe, expect, it } from 'vitest'
import { pinRotationText, reviewDigestText } from '../src/host/notify.ts'

describe('notify text builders', () => {
  it('renders the review digest outcome line with an optional summary', () => {
    expect(reviewDigestText({ projectPath: 'group/project', mrIid: 12, status: 'completed', summary: 'All good' }))
      .toBe('Maestro review of group/project !12: ✅ completed\nAll good')
    expect(reviewDigestText({ projectPath: 'group/project', mrIid: 13, status: 'failed', summary: undefined }))
      .toBe('Maestro review of group/project !13: ⚠️ failed')
  })

  it('renders the PIN rotation notice', () => {
    expect(pinRotationText('87654321')).toBe('DSH public access PIN was rotated\nNew PIN: 87654321')
  })
})
