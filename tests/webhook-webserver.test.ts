import { describe, it, expect, vi } from 'vitest'
import { apply } from '../src/host/providers/gitlab.js'

function fakeWebServer() {
  const routes: { path: string, handler: any }[] = []
  return {
    port: 3080,
    register: (route: any) => { routes.push(route); return () => { const i = routes.indexOf(route); if (i>=0) routes.splice(i,1) } },
    getRoutes: () => routes,
  }
}
describe('maestro-review-webhook webServer', () => {
  it('registers exactly two routes on webServer', async () => {
    const ws = fakeWebServer()
    const ctx: any = { effect: (fn: any) => fn(), emit: vi.fn(), logger: { warn: vi.fn() } }
    ctx.webServer = ws
    // @ts-ignore
    apply(ctx, { secret: 's', botUsername: 'maestro-bot' })
    expect(ws.getRoutes().map(r=>r.path).sort()).toEqual(['/hooks/gitlab-mr','/hooks/gitlab-mr/trigger'].sort())
  })
  it('rejects without x-gitlab-token with 401 via webServer handler', async () => {
    const ws = fakeWebServer()
    const ctx: any = { effect: (fn:any)=>fn(), emit: vi.fn() }
    ctx.webServer = ws
    apply(ctx, { secret: 'secret123' })
    const route = ws.getRoutes().find(r=>r.path==='/hooks/gitlab-mr')!
    const res = { writeHead: vi.fn().mockReturnThis(), end: vi.fn() }
    const req: any = { method: 'POST', url: '/hooks/gitlab-mr', headers: {}, on: (e:string,cb:any)=> e==='end' && cb() }
    // handler is expected to be registered; we test via invoking route.handler
    await route.handler(req, res)
    // fake loadUserConfig stub needed — this test will fail until apply uses webServer
    // wait for async handler (void + then chain) to settle
    await new Promise(r => setTimeout(r, 50))
    expect(res.writeHead).toHaveBeenCalledWith(401)
  })
})
