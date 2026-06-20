export type Captured = { text: string; screenshotPath?: string | null };

export interface Processor {
  type: string;
  schema: object;
  systemPrompt: string;
  capture(url: string, ctx: { id: string }): Promise<Captured>;
  validate(raw: unknown): unknown;
  buildEntry(ctx: {
    id: string;
    url: string;
    analysis: any;
    captured: Captured;
    agent: { id: string; model: string | null };
    existing?: Record<string, unknown>;
  }): Record<string, unknown>;
  summarize?(entry: Record<string, unknown>): string[];
}

const registry: Record<string, Processor> = {};

export function registerProcessor(p: Processor): void {
  registry[p.type] = p;
}

export function getProcessor(type: string): Processor {
  const p = registry[type];
  if (!p) throw new Error(`No processor registered for type "${type}"`);
  return p;
}
