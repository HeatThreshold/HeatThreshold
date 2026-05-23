/**
 * McpTape — disk-or-blob persistence layer for completed managed-agent runs.
 *
 * Storage strategy:
 *   - Production (Vercel + BLOB_READ_WRITE_TOKEN set): writes to Vercel Blob
 *     so runs survive past the function instance's lifetime and any cold
 *     start. Each run is a public-but-unguessable blob at
 *     mcp-traces/<runId>.json.
 *   - Local dev (no token, writeable fs): writes to mcp-traces/<runId>.json
 *     under the repo root. The pre-existing developer workflow.
 *
 * The two backends are interchangeable — McpReplay tries blob first, then
 * filesystem, so demos can mix baked-in fixtures with live captures.
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
const BLOB_PREFIX = 'mcp-traces';

function shouldUseBlob(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

async function ensureDir() {
  try {
    await fs.mkdir(TAPE_DIR, { recursive: true });
  } catch {
    /* already exists or read-only fs */
  }
}

// ============================================================================
// Write path
// ============================================================================

export async function recordRun(
  result: PlanResult,
  spans: PlatAtlasSpan
): Promise<string> {
  const runId = result.id || spans.spanId;
  const recording: McpTapeRecording = {
    runId,
    recordedAt: new Date().toISOString(),
    request: result.request,
    result,
    spans
  };
  const payload = JSON.stringify(recording, null, 2);

  if (shouldUseBlob()) {
    try {
      const { put } = await import('@vercel/blob');
      await put(`${BLOB_PREFIX}/${runId}.json`, payload, {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true
      });
      return runId;
    } catch (err) {
      console.warn('[McpTape] Blob write failed, falling back to fs:', err);
    }
  }

  await ensureDir();
  const filePath = path.join(TAPE_DIR, `${runId}.json`);
  try {
    await fs.writeFile(filePath, payload, 'utf8');
  } catch (err) {
    // Read-only fs on Vercel without a blob token — log and move on. The
    // returned runId is still valid for in-memory reads during the same
    // function instance.
    console.warn('[McpTape] fs.writeFile failed (read-only fs?):', err);
  }
  return runId;
}

// ============================================================================
// List path
// ============================================================================

export async function listRecordings(): Promise<
  Array<{ runId: string; recordedAt: string; request: PlanResult['request'] }>
> {
  if (shouldUseBlob()) {
    try {
      const { list } = await import('@vercel/blob');
      const result = await list({ prefix: `${BLOB_PREFIX}/`, limit: 100 });
      const recordings = await Promise.all(
        result.blobs.map(async b => {
          try {
            const r = await (await fetch(b.url)).json() as McpTapeRecording;
            return { runId: r.runId, recordedAt: r.recordedAt, request: r.request };
          } catch {
            return null;
          }
        })
      );
      return recordings
        .filter((x): x is { runId: string; recordedAt: string; request: PlanResult['request'] } => !!x)
        .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));
    } catch (err) {
      console.warn('[McpTape] Blob list failed, falling back to fs:', err);
    }
  }

  // Filesystem path
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
