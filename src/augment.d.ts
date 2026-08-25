declare module '@deepseek-ai/dsh-host-webserver' {}
declare module '@deepseek-ai/dsh-client-connection' {}
declare module '@deepseek-ai/dsh-client-ui-slots' {}
declare module '@deepseek-ai/dsh-client-ui-settings' {}
declare module '@deepseek-ai/dsh-host-apiproxy/api' {
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
    connection: { rpc: { handle: (channel: string, handler: any, opts?: any) => () => void; call: any } }
    maestroTunnel: {
      status(): any
      start(): Promise<any>
      stop(): Promise<any>
      proxyStatus(): any
      reloadConfig(): Promise<void>
      initialReady(): Promise<void>
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
  }
}
