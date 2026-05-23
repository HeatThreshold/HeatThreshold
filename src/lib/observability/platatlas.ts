/**
 * PlatAtlas — lightweight span recorder for the managed-agents pipeline.
 *
 * Each `withSpan` invocation wraps a single sub-agent (or any timed unit of
 * work) and records: name, start/end timestamps, status, input/output
 * summaries, and a parent-child tree relationship. The resulting tree is
 * embedded in every PlanResult under `traceSpans`, persisted by McpTape, and
 * served by the trace viewer endpoint.
 */

import { randomUUID } from 'crypto';

export interface PlatAtlasSpan {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  status: 'running' | 'success' | 'failed';
  attributes: Record<string, string | number | boolean>;
  outputSummary?: string;
  error?: string;
  children: PlatAtlasSpan[];
}

export class PlatAtlasRecorder {
  readonly runId: string;
  private root: PlatAtlasSpan;
  private currentStack: PlatAtlasSpan[] = [];

  constructor(runId?: string) {
    this.runId = runId || randomUUID();
    this.root = {
      spanId: this.runId,
      parentSpanId: null,
      name: 'PrimaryAgent',
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationMs: 0,
      status: 'running',
      attributes: { runId: this.runId },
      children: []
    };
    this.currentStack.push(this.root);
  }

  /**
   * Records a child span. The async work is the second argument; PlatAtlas
   * times it, captures status, and appends a span to the active parent.
   */
  async withSpan<T>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    work: () => Promise<T>,
    summarize?: (value: T) => string
  ): Promise<T> {
    const parent = this.currentStack[this.currentStack.length - 1];
    const span: PlatAtlasSpan = {
      spanId: randomUUID(),
      parentSpanId: parent.spanId,
      name,
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationMs: 0,
      status: 'running',
      attributes,
      children: []
    };
    parent.children.push(span);
    this.currentStack.push(span);

    const startedNs = Date.now();
    try {
      const result = await work();
      span.endedAt = new Date().toISOString();
      span.durationMs = Date.now() - startedNs;
      span.status = 'success';
      if (summarize) {
        try { span.outputSummary = summarize(result); } catch { /* ignore */ }
      }
      return result;
    } catch (err: any) {
      span.endedAt = new Date().toISOString();
      span.durationMs = Date.now() - startedNs;
      span.status = 'failed';
      span.error = err?.message || String(err);
      throw err;
    } finally {
      this.currentStack.pop();
    }
  }

  finalize(status: 'success' | 'failed' = 'success'): PlatAtlasSpan {
    this.root.endedAt = new Date().toISOString();
    this.root.durationMs =
      new Date(this.root.endedAt).getTime() -
      new Date(this.root.startedAt).getTime();
    this.root.status = status;
    return this.root;
  }

  /** Read-only access to the in-progress tree (used for streaming). */
  snapshot(): PlatAtlasSpan {
    return this.root;
  }
}
