export function buildReportJson(cfg: any, result: any, headSha: string) {
  return { projectId: cfg.sourceProjectId, mrIid: cfg.mrIid, headSha, mode: cfg.mode, ...result, generatedAt: new Date().toISOString() }
}
