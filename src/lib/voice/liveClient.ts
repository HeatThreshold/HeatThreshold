/**
 * Browser-side bridge to the Gemini Live API.
 *
 *   browser  ── mic 16kHz PCM ──▶  Gemini Live (WebSocket)
 *   browser  ◀── 24kHz audio ──   Gemini Live
 *           ◀── functionCall ──
 *   browser  ── POST /api/plan ──▶  Heat Threshold server
 *   browser  ── toolResponse ───▶  Gemini Live
 *
 * The session uses an ephemeral token minted by POST /api/live/token, so
 * the GEMINI_API_KEY never reaches this file. The system instruction +
 * runThresholdPlan tool declaration are locked into the token, so all this
 * code does is plumb audio + route tool calls back to /api/plan.
 */

import { GoogleGenAI, Modality, type Session } from '@google/genai';
import type { PlanResult } from '../types';

export type VoiceStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'tool-running'
  | 'error'
  | 'closed';

export interface VoiceEvents {
  onStatus: (s: VoiceStatus, detail?: string) => void;
  onTranscript: (turn: { who: 'user' | 'assistant'; text: string }) => void;
  onPlan: (plan: PlanResult) => void;
  onError: (e: Error) => void;
}

const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;
const CAPTURE_FRAME = 4096;

export class VoiceSession {
  private session: Session | null = null;
  private inCtx: AudioContext | null = null;
  private outCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private playheadTime = 0;
  private closed = false;
  private pendingUserTranscript = '';
  private pendingAssistantTranscript = '';

  constructor(private readonly ev: VoiceEvents) {}

  async start(): Promise<void> {
    this.ev.onStatus('connecting');
    try {
      const tokenRes = await fetch('/api/live/token', { method: 'POST' });
      if (!tokenRes.ok) {
        const body = await tokenRes.json().catch(() => ({}));
        throw new Error(body.error || `Token mint failed: HTTP ${tokenRes.status}`);
      }
      const { token, model } = await tokenRes.json();
      if (!token) throw new Error('Server returned an empty ephemeral token.');

      const ai = new GoogleGenAI({ apiKey: token, apiVersion: 'v1alpha' } as any);

      this.session = await (ai as any).live.connect({
        model,
        config: {
          // Locked server-side; sent here for SDK shape compliance.
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        },
        callbacks: {
          onopen: () => this.ev.onStatus('listening'),
          onmessage: (msg: any) => this.handleServerMessage(msg),
          onerror: (e: any) => {
            this.ev.onStatus('error', e?.message || 'Live API error');
            this.ev.onError(new Error(e?.message || 'Live API error'));
          },
          onclose: () => {
            if (!this.closed) this.ev.onStatus('closed');
          }
        }
      });

      await this.startMic();
    } catch (err: any) {
      this.ev.onStatus('error', err.message);
      this.ev.onError(err);
      this.stop();
      throw err;
    }
  }

  stop(): void {
    this.closed = true;
    try { this.processor?.disconnect(); } catch {}
    try { this.source?.disconnect(); } catch {}
    try { this.micStream?.getTracks().forEach(t => t.stop()); } catch {}
    try { this.inCtx?.close(); } catch {}
    try { this.outCtx?.close(); } catch {}
    try { (this.session as any)?.close?.(); } catch {}
    this.processor = null;
    this.source = null;
    this.micStream = null;
    this.inCtx = null;
    this.outCtx = null;
    this.session = null;
    this.ev.onStatus('closed');
  }

  private async startMic(): Promise<void> {
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });
    // Browsers will resample for us when we set sampleRate on the context.
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    this.inCtx = new Ctx({ sampleRate: INPUT_SAMPLE_RATE });
    this.outCtx = new Ctx({ sampleRate: OUTPUT_SAMPLE_RATE });
    this.playheadTime = this.outCtx.currentTime;

    this.source = this.inCtx.createMediaStreamSource(this.micStream);
    this.processor = this.inCtx.createScriptProcessor(CAPTURE_FRAME, 1, 1);
    this.processor.onaudioprocess = (e) => {
      if (!this.session || this.closed) return;
      const float = e.inputBuffer.getChannelData(0);
      const pcm16 = float32ToPcm16(float);
      const b64 = pcm16ToBase64(pcm16);
      try {
        (this.session as any).sendRealtimeInput({
          audio: { data: b64, mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` }
        });
      } catch (err) {
        console.warn('[Voice] sendRealtimeInput failed', err);
      }
    };
    this.source.connect(this.processor);
    this.processor.connect(this.inCtx.destination);
  }

  private handleServerMessage(msg: any): void {
    // Tool call → /api/plan → tool response
    if (msg?.toolCall?.functionCalls?.length) {
      for (const fc of msg.toolCall.functionCalls) {
        this.handleToolCall(fc);
      }
      return;
    }

    // Streaming audio + transcripts from the model
    const sc = msg?.serverContent;
    if (sc) {
      const inputTx = sc.inputTranscription?.text;
      if (inputTx) {
        this.pendingUserTranscript += inputTx;
      }
      const outputTx = sc.outputTranscription?.text;
      if (outputTx) {
        this.pendingAssistantTranscript += outputTx;
      }

      const parts = sc.modelTurn?.parts;
      if (Array.isArray(parts)) {
        for (const p of parts) {
          const inline = p?.inlineData;
          if (inline?.data && typeof inline?.mimeType === 'string' && inline.mimeType.startsWith('audio/')) {
            this.queueAudio(inline.data);
            this.ev.onStatus('speaking');
          }
        }
      }

      if (sc.turnComplete) {
        if (this.pendingUserTranscript.trim()) {
          this.ev.onTranscript({ who: 'user', text: this.pendingUserTranscript.trim() });
          this.pendingUserTranscript = '';
        }
        if (this.pendingAssistantTranscript.trim()) {
          this.ev.onTranscript({ who: 'assistant', text: this.pendingAssistantTranscript.trim() });
          this.pendingAssistantTranscript = '';
        }
        this.ev.onStatus('listening');
      }
    }
  }

  private async handleToolCall(fc: { id?: string; name?: string; args?: any }): Promise<void> {
    if (fc.name !== 'runThresholdPlan') {
      // Unknown tool — politely tell the model so it can recover.
      this.replyToTool(fc, { error: `Unknown tool: ${fc.name}` });
      return;
    }
    this.ev.onStatus('tool-running', 'runThresholdPlan');
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: String(fc.args?.location || ''),
          activity: String(fc.args?.activity || ''),
          time:     String(fc.args?.time || '')
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const plan: PlanResult = await res.json();
      this.ev.onPlan(plan);
      // Slim the response — the model only needs to read the verdict aloud.
      this.replyToTool(fc, {
        verdict: plan.verdict,
        flag: plan.flag,
        headline: plan.headline,
        reasoning: plan.reasoning,
        peakWetBulbF: plan.wetBulbPeakF,
        coolingStops: (plan.coolingStops || []).slice(0, 3).map(s => s.name),
        runId: plan.id
      });
    } catch (err: any) {
      this.replyToTool(fc, { error: err.message || 'Plan request failed' });
    } finally {
      this.ev.onStatus('thinking');
    }
  }

  private replyToTool(fc: { id?: string; name?: string }, response: Record<string, unknown>): void {
    if (!this.session) return;
    try {
      (this.session as any).sendToolResponse({
        functionResponses: [{
          id: fc.id,
          name: fc.name,
          response
        }]
      });
    } catch (err) {
      console.warn('[Voice] sendToolResponse failed', err);
    }
  }

  private queueAudio(b64: string): void {
    if (!this.outCtx) return;
    const pcm = base64ToInt16(b64);
    const float = pcm16ToFloat32(pcm);
    const buf = this.outCtx.createBuffer(1, float.length, OUTPUT_SAMPLE_RATE);
    buf.getChannelData(0).set(float);
    const src = this.outCtx.createBufferSource();
    src.buffer = buf;
    src.connect(this.outCtx.destination);
    const startAt = Math.max(this.playheadTime, this.outCtx.currentTime);
    src.start(startAt);
    this.playheadTime = startAt + buf.duration;
  }
}

function float32ToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function pcm16ToFloat32(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = input[i] / (input[i] < 0 ? 0x8000 : 0x7fff);
  }
  return out;
}

function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

function base64ToInt16(b64: string): Int16Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // Live API returns little-endian PCM16.
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
}
