/**
 * McpReplay — deterministic playback of recorded managed-agent runs.
 *
 * Loads a McpTape recording by runId and returns the cached PlanResult.
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

export async function loadRecording(runId: string): Promise<McpTapeRecording | null> {
  // Strict allowlist of runId chars to keep the read inside TAPE_DIR.
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(runId)) return null;
  try {
    const raw = await fs.readFile(path.join(TAPE_DIR, `${runId}.json`), 'utf8');
    return JSON.parse(raw) as McpTapeRecording;
  } catch {
    return null;
  }
}
