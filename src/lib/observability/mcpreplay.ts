/**
 * McpReplay — deterministic playback of recorded managed-agent runs.
 *
 * Read order:
 *   1. Vercel Blob (when BLOB_READ_WRITE_TOKEN is configured) — picks up
 *      whatever the live function instance wrote during recordRun.
 *   2. Local filesystem mcp-traces/<runId>.json — picks up baked-in fixtures
 *      shipped via vercel.json's includeFiles directive, and local dev runs.
 *
 * Used by:
 *   - GET /api/replay/:runId → return PlanResult (drives ?replay=<id>)
 *   - GET /api/trace/:runId  → return span tree (drives /trace/:runId)
 *
 * This is the demo safety net: if the live managed-agents call fails on
 * stage, the same code path renders an identical card from a cached run.
 */

import fs from 'fs/promises';
import path from 'path';
import type { McpTapeRecording } from './mcptape';

const TAPE_DIR = path.join(process.cwd(), 'mcp-traces');
const BLOB_PREFIX = 'mcp-traces';

const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

export async function loadRecording(runId: string): Promise<McpTapeRecording | null> {
  if (!RUN_ID_PATTERN.test(runId)) return null;

  // 1. Vercel Blob (writeable on the function in production)
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { head } = await import('@vercel/blob');
      const info = await head(`${BLOB_PREFIX}/${runId}.json`);
      if (info?.url) {
        const res = await fetch(info.url);
        if (res.ok) {
          return await res.json() as McpTapeRecording;
        }
      }
    } catch {
      // Blob head returns 404 / NotFound for missing keys — that's expected.
      // Fall through to filesystem.
    }
  }

  // 2. Filesystem (read-only on Vercel but holds baked-in fixtures)
  try {
    const raw = await fs.readFile(path.join(TAPE_DIR, `${runId}.json`), 'utf8');
    return JSON.parse(raw) as McpTapeRecording;
  } catch {
    return null;
  }
}
