import type { ReviewProvider, ReviewRequest } from './interface.js'

export const githubProvider: ReviewProvider = {
  id: 'github',
  async intake(_req: Request): Promise<ReviewRequest> {
    throw new Error('github not implemented')
  },
  async postFindings(_findings: any[]): Promise<void> {
    throw new Error('not implemented')
  },
}
