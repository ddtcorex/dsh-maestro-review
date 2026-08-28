export interface ReviewRequest { provider: string; projectPath: string; mrId: string; profile: 'magento2'|'generic'|'laravel'|'custom'; }
export interface ReviewProvider { id: string; intake(req: Request): Promise<ReviewRequest>; postFindings(f: any[]): Promise<void>; }
