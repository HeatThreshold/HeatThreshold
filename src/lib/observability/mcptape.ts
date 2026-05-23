/**
 * McpTape — disk persistence layer for completed managed-agent runs.
 *
 * One JSON blob per runId in `mcp-traces/`, containing the full PlanResult,
 * the PlatAtlas span tree, the request input, and the LLM responses. McpReplay
 * reads these back to power the `?replay=<runId>` demo safety net.
 */

import fs from 'fs/promises';
import path from 'path';
import type { PlanResult } from '../types';
import type { PlatAtlasSpan } from './platatlas';

export interface McpTapeRecording {
  runId: string;
  recordedAt: string;
  request: PlanResult['request'];
  result: PlanResult;
  spans: PlatAtlasSpan;
}

const TAPE_DIR = path.join(process.cwd(), 'mcp-traces');

async function ensureDir() {
  try {
    await fs.mkdir(TAPE_DIR, { recursive: true });
  } catch {
    /* already exists */
  }
}

export async function recordRun(
  result: PlanResult,
  spans: PlatAtlasSpan
): Promise<string> {
  await ensureDir();
  const runId = result.id || spans.spanId;
  const recording: McpTapeRecording = {
    runId,
    recordedAt: new Date().toISOString(),
    request: result.request,
    result,
    spans
  };
  const filePath = path.join(TAPE_DIR, `${runId}.json`);
  await fs.writeFile(filePath, JSON.stringify(recording, null, 2), 'utf8');
  return runId;
}

export async function listRecordings(): Promise<
  Array<{ runId: string; recordedAt: string; request: PlanResult['request'] }>
> {
  await ensureDir();
  let files: string[];
  try {
    files = await fs.readdir(TAPE_DIR);
  } catch {
    return [];
  }
  const recordings: Array<{ runId: string; recordedAt: string; request: PlanResult['request'] }> = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(TAPE_DIR, f), 'utf8');
      const r = JSON.parse(raw) as McpTapeRecording;
      if (r.runId && r.request) {
        recordings.push({ runId: r.runId, recordedAt: r.recordedAt, request: r.request });
      }
    } catch {
      /* skip malformed */
    }
  }
  recordings.sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));
  return recordings;
}
