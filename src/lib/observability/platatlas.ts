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
  }

  /**
   * Records a child span attached to the PrimaryAgent root. Safe to call
   * concurrently — every span knows its parent at call time, so Promise.all
   * fan-out for parallel sub-agents (Weather + Place) doesn't corrupt the
   * tree shape.
   */
  async withSpan<T>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    work: () => Promise<T>,
    summarize?: (value: T) => string
  ): Promise<T> {
    const span: PlatAtlasSpan = {
      spanId: randomUUID(),
      parentSpanId: this.root.spanId,
      name,
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationMs: 0,
      status: 'running',
      attributes,
      children: []
    };
    this.root.children.push(span);

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
