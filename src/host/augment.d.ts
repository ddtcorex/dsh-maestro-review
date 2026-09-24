import type { ModelSelection } from '@deepseek-ai/dsh-agent'

declare module '@deepseek-ai/dsh-host-webserver' {}
declare module '@deepseek-ai/dsh-client-ui-slots' {}
declare module '@deepseek-ai/dsh-client-ui-settings' {}
declare module '@deepseek-ai/dsh-client-connection' {
  export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: any }
  export type RpcErrorDetailsMap = { 'bad-request': { issues: any[] } }
}
declare module '@deepseek-ai/dsh-tools' {
  export function defineTool(...args: any[]): any
}

import '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: { port: number; register: any }
    // `handle` takes exactly (channel, handler): the Host never read an
    // `{ authority: 'loopback' }` third argument, so this shape must not
    // advertise one (dropped at the call site in #129).
    connection: { rpc: { handle: (channel: string, handler: any) => () => void; call: any } }
    maestroTunnel: {
      status(): any
      start(): Promise<any>
      stop(): Promise<any>
      proxyStatus(): any
      reloadConfig(): Promise<void>
      initialReady(): Promise<void>
      getPin(): Promise<string>
      rotatePin(): Promise<string>
      getLanPin(): Promise<string>
      rotateLanPin(): Promise<string>
    }
    logger?: {
      info?: (...args: any[]) => void
      warn?: (...args: any[]) => void
      error?: (...args: any[]) => void
    }
    tools: { register: any; preExecute?: any }
    agents: any
    sessions: any
    skills: any
    /** DSH default-model service (injected by the host; structural shape only). */
    agentDefaultModel: {
      currentSelection(): ModelSelection
    }
    sessionTitle: { rename(session: unknown, title: string): Promise<unknown> | unknown }
    /** Current agent identity inside an agent-scoped context (WeakMap key). */
    agent?: object
  }
}
