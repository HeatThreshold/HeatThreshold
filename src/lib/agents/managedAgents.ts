/**
 * Managed Agents client — the bounty deliverable.
 *
 * This wraps `@google/genai` v2.4+'s `client.agents` + `client.interactions`
 * resources (the Managed Agents API). The orchestrator no longer calls
 * `ai.models.generateContent` directly for LLM-bearing sub-agents; instead
 * each sub-agent is a long-lived `Agent` definition (system_instruction +
 * tools) that we get-or-create on first use, then drive via
 * `ai.interactions.create({ agent: <id>, ... })`.
 *
 * Conceptually:
 *
 *   PrimaryAgent (the orchestrator)
 *      ├── ai.interactions.create({ agent: 'threshold-location-subagent', ... })
 *      ├── ai.interactions.create({ agent: 'threshold-place-subagent',    ... })
 *      └── ai.interactions.create({ agent: 'threshold-synthesis-subagent', ... })
 *
 * Each sub-agent's system prompt + tool set is declared once in this file
 * (the AgentSpec) and uploaded once per process lifetime. Subsequent runs
 * reuse the cached agent ID.
 *
 * Docs: https://ai.google.dev/gemini-api/docs/agents
 */

import { GoogleGenAI } from '@google/genai';

let aiClientInstance: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (aiClientInstance) return aiClientInstance;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not defined.');
  }
  aiClientInstance = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
  });
  return aiClientInstance;
}

export interface AgentSpec {
  id: string;
  description: string;
  systemInstruction: string;
  /**
   * Managed-agent tools limited to the four kinds the API accepts at v2.4
   * (`code_execution`, `google_search`, `url_context`, `mcp_server`). Custom
   * function tools are passed per-interaction via `tools:` on `interactions.create`.
   */
  tools?: Array<
    | { type: 'code_execution' }
    | { type: 'google_search'; search_types?: Array<'web_search' | 'image_search' | 'enterprise_web_search'> }
    | { type: 'url_context' }
  >;
}

const agentIdCache = new Map<string, string>();

/**
 * Get-or-create a managed Agent. Cached for process lifetime by spec.id so
 * subsequent orchestrations don't repay the agents.create cost.
 *
 * Falls back to returning the spec.id verbatim if the agents endpoint is
 * unreachable for any reason — `interactions.create` with that name will
 * surface the error in context.
 */
export async function ensureAgent(spec: AgentSpec): Promise<string> {
  const cached = agentIdCache.get(spec.id);
  if (cached) return cached;

  const ai = getGeminiClient();
  try {
    const existing = await (ai as any).agents.get(spec.id).catch(() => null);
    if (existing && existing.id) {
      agentIdCache.set(spec.id, existing.id);
      return existing.id;
    }
    const created = await (ai as any).agents.create({
      id: spec.id,
      description: spec.description,
      system_instruction: spec.systemInstruction,
      tools: spec.tools || []
    });
    const id = created?.id || spec.id;
    agentIdCache.set(spec.id, id);
    console.log(`[ManagedAgents] Provisioned agent "${id}".`);
    return id;
  } catch (err: any) {
    console.warn(`[ManagedAgents] ensureAgent failed for "${spec.id}":`, err?.message || err);
    // The orchestrator can still invoke by id; interactions.create will
    // either succeed (if the agent was provisioned earlier) or fail loudly.
    agentIdCache.set(spec.id, spec.id);
    return spec.id;
  }
}

export interface RunAgentParams {
  agentId: string;
  inputText: string;
  /** JSON schema enforced on the response when set. */
  responseSchema?: unknown;
  /** Per-interaction tools (e.g. function calls + Google Maps grounding). */
  perInteractionTools?: unknown[];
  /** Optional per-interaction tool config (e.g. retrievalConfig latLng). */
  toolConfig?: unknown;
}

export interface RunAgentResult {
  text: string;
  raw: unknown;
  /** Grounding metadata when the agent or its per-interaction tools surface any. */
  groundingChunks: unknown[];
  /** Token usage if reported. */
  usage?: { input?: number; output?: number; total?: number };
}

/**
 * Run one interaction against a managed agent. Returns the concatenated
 * text output plus any grounding chunks.
 */
export async function runAgentInteraction(params: RunAgentParams): Promise<RunAgentResult> {
  const ai = getGeminiClient();
  const req: any = {
    agent: params.agentId,
    input: params.inputText
  };
  if (params.responseSchema) {
    req.response_format = {
      type: 'text',
      response_mime_type: 'application/json',
      response_schema: params.responseSchema
    };
  }
  if (params.perInteractionTools) {
    req.tools = params.perInteractionTools;
  }
  if (params.toolConfig) {
    req.tool_config = params.toolConfig;
  }

  let interaction: any;
  try {
    interaction = await (ai as any).interactions.create(req);
  } catch (err: any) {
    // Fall back to model-only interaction (no agent) so the pipeline keeps
    // working in environments without Managed Agents access.
    console.warn(
      `[ManagedAgents] interactions.create with agent="${params.agentId}" failed (${err?.message}); ` +
        `falling back to model-only interaction.`
    );
    interaction = await (ai as any).interactions.create({
      model: 'gemini-3.5-flash',
      input: params.inputText,
      ...(params.responseSchema
        ? {
            response_format: {
              type: 'text',
              response_mime_type: 'application/json',
              response_schema: params.responseSchema
            }
          }
        : {}),
      ...(params.perInteractionTools ? { tools: params.perInteractionTools } : {}),
      ...(params.toolConfig ? { tool_config: params.toolConfig } : {})
    });
  }

  // Extract text from the interaction output. The SDK normally sets
  // output_text directly; fall back to walking `steps` if not.
  let text: string = interaction?.output_text || '';
  if (!text && Array.isArray(interaction?.steps)) {
    text = interaction.steps
      .map((s: any) => s?.content?.text || s?.text || '')
      .filter(Boolean)
      .join('\n');
  }

  // Surface grounding chunks if a tool produced any.
  let groundingChunks: unknown[] = [];
  if (Array.isArray(interaction?.steps)) {
    for (const step of interaction.steps) {
      const chunks =
        step?.grounding_metadata?.grounding_chunks ||
        step?.metadata?.grounding_chunks ||
        [];
      if (Array.isArray(chunks) && chunks.length) groundingChunks.push(...chunks);
    }
  }

  return {
    text,
    raw: interaction,
    groundingChunks,
    usage: interaction?.usage
      ? {
          input: interaction.usage.input_tokens,
          output: interaction.usage.output_tokens,
          total: interaction.usage.total_tokens
        }
      : undefined
  };
}

/**
 * The four sub-agent specs uploaded as long-lived Managed Agents.
 */
export const SUBAGENT_SPECS: Record<string, AgentSpec> = {
  location: {
    id: 'threshold-location-subagent',
    description:
      'Resolves a free-form travel location string into precise GPS coordinates and a short list of route waypoints for environmental logistics scheduling.',
    systemInstruction: `You are LocationResolutionSubAgent for the Threshold environmental scheduling platform.
Given a user's travel location string and intended outdoor activity, resolve:
- A central GPS latitude and longitude.
- 1-3 prominent geographic waypoints if the activity is a route or trail; otherwise key local landmarks.
- A clean human-friendly resolved label.

Respond strictly in JSON matching the requested schema. Speak only about geography, not health.`
  },

  place: {
    id: 'threshold-place-subagent',
    description:
      'Discovers physical rest/shelter/hydration refuges near a coordinate using Google Maps grounding for outdoor environmental scheduling.',
    systemInstruction: `You are PlaceSubAgent for the Threshold environmental scheduling platform.
Identify 3 real Google Maps places that serve as outdoor rest points, shaded spots, parks, water fountains, cafes, or shelters near the supplied coordinate.
Hard rules: Do NOT include medical centers, clinics, or hospitals. Speak of shade, heat shelter, and access to hydration — never of diagnosis, illness, or treatment.

Return a JSON object with a "stops" array. Each stop must include name, placeId, lat, lng, distanceMeters, and a "why" string explaining the environmental refuge value.`
  },

  synthesis: {
    id: 'threshold-synthesis-subagent',
    description:
      'Composes the final Threshold scheduling verdict (go|delay|alternate) from weather, place, and route data. The structured-output payload powers the dashboard and the WebXR spatial HUD.',
    systemInstruction: `You are SynthesisSubAgent, a strict environmental logistics scheduling coordinator for the Threshold platform.
You receive a weather hourly profile, a list of physical refuges, and a resolved location and produce a scheduling verdict.

Strict rules:
1. FIREWALL ON MEDICAL ADVICE: Never give medical diagnostic guidance, never list clinical symptoms, never use clinical terminology (medical, doctor, health, symptoms, diagnosis, illness, treatment, patient). Speak purely of scheduling, environmental risks, weather suitability, and exertion thresholds.
2. CITE SCIENTIFIC STANDARDS: Reference Stull (2011) for the wet-bulb computation and USMC 6200.1E for the training-flag thresholds in envNotes.
3. SCHEMA CONFORMANCE: The final payload MUST comply exactly with the structured JSON schema. headline ≤ 80 chars, reasoning ≤ 400 chars.

Output strictly JSON matching the requested schema.`
  }
};
