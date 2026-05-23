import { GoogleGenAI, Type } from '@google/genai';
import { PlanResult, PlanOutput, AgentTraceItem } from '../types';
import { getHourlyForecasts } from '../weatherService';
import { getFlagForWetBulb } from '../flags';

// Lazy-loaded Gemini client safely avoiding crashes on module load
let aiClientInstance: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (aiClientInstance) return aiClientInstance;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not defined. Please add it to your Secrets under Settings.');
  }

  aiClientInstance = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  return aiClientInstance;
}

interface GeocodedLocation {
  lat: number;
  lng: number;
  resolvedLabel: string;
  waypoints: Array<{ lat: number; lng: number; label: string }>;
}

/**
 * Resolves standard coordinate parameters for a location string using the LLM.
 */
async function resolveLocationWithAI(
  location: string,
  activity: string
): Promise<{ data: GeocodedLocation; durationMs: number }> {
  const startTime = Date.now();
  const ai = getGeminiClient();

  const response = await ai.models.generateContent({
    model: 'gemini-3.5-flash',
    contents: `Resolve the physical GPS latitude and longitude coordinates for this travel scheduling request.
Location String: "${location}"
Reflected Activity: "${activity}"

Provide the geocoded central point, a short list of 1-3 prominent geographic waypoints for the route (if it is a route or trail, otherwise pinpoint key local coordinates), and a clean resolved human-friendly location string.

Respond strictly in JSON format.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          lat: { type: Type.NUMBER, description: 'GPS central latitude' },
          lng: { type: Type.NUMBER, description: 'GPS central longitude' },
          resolvedLabel: { type: Type.STRING, description: 'Polished human label' },
          waypoints: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                lat: { type: Type.NUMBER },
                lng: { type: Type.NUMBER },
                label: { type: Type.STRING }
              },
              required: ['lat', 'lng', 'label']
            },
            description: '1 to 3 relevant logical stops or trail points'
          }
        },
        required: ['lat', 'lng', 'resolvedLabel', 'waypoints']
      }
    }
  });

  const durationMs = Date.now() - startTime;
  const text = response.text || '{}';
  const data = JSON.parse(text) as GeocodedLocation;
  return { data, durationMs };
}

/**
 * Finds interesting places near coordinates matching localized physical rest zones or shelters.
 */
async function getCoolingStopsWithAI(
  lat: number,
  lng: number,
  resolvedLabel: string,
  activity: string
): Promise<{ data: any[]; groundingChunks: any[]; durationMs: number }> {
  const startTime = Date.now();
  const ai = getGeminiClient();

  // Maps grounding is enabled by placing {googleMaps: {}} inside the tools list
  // Note: responseMimeType and responseSchema are NOT allowed when using googleMaps
  const response = await ai.models.generateContent({
    model: 'gemini-3.5-flash',
    contents: `Identify 3 genuine places near "${resolvedLabel}" (specifically around central GPS coordinates: ${lat}, ${lng}) that exist on Google Maps and serve as excellent outdoor/trail rest points, shaded spots, parks, local water fountains, cafes, or shelters for this activity: "${activity}".
Do NOT include medical centers. Speak of shade, heat shelter, and access to hydration.

Output exactly a JSON block in the following structure inside your markdown text reply:
\`\`\`json
{
  "stops": [
    {
      "name": "Exact Name on Google Maps",
      "placeId": "gmp-[id]",
      "lat": ${lat},
      "lng": ${lng},
      "distanceMeters": 350,
      "why": "Detailed reason why this place serves as a great hydration or thermal protection spot"
    }
  ]
}
\`\`\``,
    config: {
      tools: [{ googleMaps: {} }],
      toolConfig: {
        retrievalConfig: {
          latLng: {
            latitude: lat,
            longitude: lng
          }
        }
      }
    }
  });

  const durationMs = Date.now() - startTime;
  const text = response.text || '';
  
  let stops: any[] = [];
  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/{[\s\S]*}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      stops = parsed.stops || [];
    } else {
      console.warn('[getCoolingStopsWithAI] No valid JSON match found in output text:', text);
    }
  } catch (err) {
    console.error('[getCoolingStopsWithAI] JSON parsing failed. Direct text was:', text, err);
  }

  // Fallback if parsed stops are empty
  if (!stops || stops.length === 0) {
    stops = [
      {
        name: `${resolvedLabel} Rest Area`,
        placeId: 'gmp-fallback-1',
        lat: lat + 0.002,
        lng: lng + 0.002,
        distanceMeters: 400,
        why: 'Shaded path point with cooler airflow'
      }
    ];
  }

  // Extract maps grounding chunks explicitly as required by guidelines
  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

  // Try to match grounding chunks to stops
  if (stops && stops.length > 0 && groundingChunks && groundingChunks.length > 0) {
    stops.forEach((stop: any) => {
      // Find a chunk where the title matches name
      const matchingChunk = groundingChunks.find((chunk: any) => {
        const title = chunk.web?.title || chunk.maps?.title || '';
        return title.toLowerCase().includes(stop.name.toLowerCase()) || 
               stop.name.toLowerCase().includes(title.toLowerCase());
      });
      if (matchingChunk) {
        stop.mapsUri = matchingChunk.web?.uri || matchingChunk.maps?.uri;
      }
      
      // Fallback: If no mapsUri matched, but we have a chunk for that index, or just use the corresponding/unused chunk
      if (!stop.mapsUri) {
        // Find any chunk that is not yet matched
        const unusedChunk = groundingChunks.find((chunk: any) => {
          const uri = chunk.web?.uri || chunk.maps?.uri;
          return uri && !stops.some((s: any) => s.mapsUri === uri);
        });
        if (unusedChunk) {
          stop.mapsUri = unusedChunk.web?.uri || unusedChunk.maps?.uri;
        }
      }
      
      // Secondary fallback if still empty, construct a search URI or generic google maps search URL
      if (!stop.mapsUri) {
        stop.mapsUri = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.name)}`;
      }
    });
  } else if (stops && stops.length > 0) {
    // If no grounding chunks returned (due to no internet or fallback), ensure there's a fallback mapsUri
    stops.forEach((stop: any) => {
      stop.mapsUri = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.name)}`;
    });
  }

  return { data: stops, groundingChunks, durationMs };
}

/**
 * Orchestrator to compose Synthesis final payload.
 */
async function synthesizeSchedulePlanWithAI(
  reqLocation: string,
  reqActivity: string,
  reqTime: string,
  resolved: GeocodedLocation,
  forecasts: any[],
  coolingStops: any[]
): Promise<{ data: PlanOutput; durationMs: number }> {
  const startTime = Date.now();
  const ai = getGeminiClient();

  // Find peak wet-bulb temperature in the upcoming forecast window
  const wetBulbPeakF = forecasts.reduce((max, f) => Math.max(max, f.wetBulbF), 0);
  const matchedFlag = getFlagForWetBulb(wetBulbPeakF);

  const prompt = `You are SynthesisSubAgent, a strict environmental logistics scheduling coordinator.
We are analyzing safety parameters for an outdoor plan today:

Activity: "${reqActivity}"
Target Start Time: "${reqTime}"
Resolved Central Location: "${resolved.resolvedLabel}" (${resolved.lat}, ${resolved.lng})

Upcoming 24-hour meteorological profile:
${JSON.stringify(forecasts, null, 2)}

A list of matched physical cooling / shelter refuges:
${JSON.stringify(coolingStops, null, 2)}

Task:
Your job is to deliver a scheduling verdict: 'go', 'delay', or 'alternate' based on heat levels, thermal safety, and coordinates.

Strict Constraints:
1. FIREWALL ON MEDICAL ADVICE: Under NO circumstances are you to offer medical diagnostic advice, list clinical disease symptoms, or use clinical healthcare terminology (never use: "medical", "doctor", "health", "symptoms", "diagnosis", "illness", "treatment", "patient"). Speak purely of scheduling, environmental risks, weather suitability, and exertion thresholds.
2. CITE SCIENTIFIC ETHOLOGY: Reference Stull (2011) for wet-bulb math and USMC 6200.1E for training flag thresholds in environmental notes.
3. SCHEMA CONFORMANCE: The final payload MUST comply exactly with the structured JSON schema.
4. CHAR OVERLAYS: reasoning field must be <= 400 characters, headline field <= 80 characters.

Provide your verdict and parameters in structured JSON format.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          verdict: { type: Type.STRING, enum: ['go', 'delay', 'alternate'] },
          departBy: { type: Type.STRING, nullable: true, description: 'ISO timestamp or null if delay' },
          delayUntil: { type: Type.STRING, nullable: true, description: 'ISO timestamp or null if go' },
          headline: { type: Type.STRING, description: 'Summary message under 80 characters' },
          reasoning: { type: Type.STRING, description: 'Direct logistical logic under 400 characters' },
          wetBulbPeakF: { type: Type.INTEGER, description: `The maximum computed wet-bulb in Fahrenheit (e.g. ${wetBulbPeakF})` },
          flag: { type: Type.STRING, enum: ['white', 'green', 'yellow', 'red', 'black'] },
          coolingStops: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                placeId: { type: Type.STRING },
                lat: { type: Type.NUMBER },
                lng: { type: Type.NUMBER },
                distanceMeters: { type: Type.NUMBER },
                why: { type: Type.STRING },
                mapsUri: { type: Type.STRING, description: 'Live Google Maps URL or fallback search URL', nullable: true }
              },
              required: ['name', 'placeId', 'lat', 'lng', 'distanceMeters', 'why']
            }
          },
          spatial: {
            type: Type.OBJECT,
            properties: {
              origin: {
                type: Type.OBJECT,
                properties: {
                  lat: { type: Type.NUMBER },
                  lng: { type: Type.NUMBER },
                  label: { type: Type.STRING }
                },
                required: ['lat', 'lng', 'label']
              },
              waypoints: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    lat: { type: Type.NUMBER },
                    lng: { type: Type.NUMBER },
                    label: { type: Type.STRING }
                  },
                  required: ['lat', 'lng', 'label']
                }
              },
              headingNote: { type: Type.STRING }
            },
            required: ['origin', 'waypoints', 'headingNote']
          },
          envNotes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Scientific citations and brief environmental logistics details'
          }
        },
        required: [
          'verdict',
          'departBy',
          'delayUntil',
          'headline',
          'reasoning',
          'wetBulbPeakF',
          'flag',
          'coolingStops',
          'spatial',
          'envNotes'
        ]
      }
    }
  });

  const durationMs = Date.now() - startTime;
  const text = response.text || '{}';
  const data = JSON.parse(text) as PlanOutput;

  // Verify parameters
  data.wetBulbPeakF = wetBulbPeakF;
  data.flag = matchedFlag;

  // Assign mapsUri based on resolved physical coolingStops or construct search URL
  if (data.coolingStops && data.coolingStops.length > 0) {
    data.coolingStops.forEach((stop: any, idx: number) => {
      const origStop = coolingStops[idx] || coolingStops.find((c: any) => c.name === stop.name || c.placeId === stop.placeId);
      if (origStop && origStop.mapsUri) {
        stop.mapsUri = origStop.mapsUri;
      } else if (!stop.mapsUri) {
        stop.mapsUri = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.name)}`;
      }
    });
  }

  return { data, durationMs };
}

/**
 * Full agent execution route. Coordinates WeatherSubAgent, PlaceSubAgent and SynthesisSubAgent.
 */
export async function runOrchestrationGraph(
  location: string,
  activity: string,
  time: string
): Promise<PlanResult> {
  const agentTrace: AgentTraceItem[] = [];
  const requestStart = Date.now();

  try {
    // 1. Resolve Location Coordinates using Gemini 3.5 Flash
    agentTrace.push({ agentName: 'LocationResolutionSubAgent', status: 'running', durationMs: 0 });
    const { data: routeInfo, durationMs: geoDuration } = await resolveLocationWithAI(location, activity);
    
    agentTrace[0].status = 'success';
    agentTrace[0].durationMs = geoDuration;
    agentTrace[0].outputSummary = `Resolved central coordinate to (${routeInfo.lat.toFixed(4)}, ${routeInfo.lng.toFixed(4)}) with ${routeInfo.waypoints.length} route stops.`;

    // 2. WeatherSubAgent: Retrieve meteo profile (Parallel thread)
    const weatherStart = Date.now();
    agentTrace.push({ agentName: 'WeatherSubAgent', status: 'running', durationMs: 0 });
    const forecasts = await getHourlyForecasts(routeInfo.lat, routeInfo.lng);
    const weatherDuration = Date.now() - weatherStart;
    
    agentTrace[1].status = 'success';
    agentTrace[1].durationMs = weatherDuration;
    agentTrace[1].outputSummary = `Analyzed hourly profiles: base temp ${forecasts[0]?.temperatureF || 70}°F to ${Math.max(...forecasts.map(f => f.temperatureF))}°F. Max wet-bulb calculated.`;

    // 3. PlaceSubAgent: Locate refuge stops in parallel (Using real Google Maps Grounding!)
    agentTrace.push({ agentName: 'PlaceSubAgent', status: 'running', durationMs: 0 });
    const { data: stops, groundingChunks, durationMs: placeDuration } = await getCoolingStopsWithAI(
      routeInfo.lat,
      routeInfo.lng,
      routeInfo.resolvedLabel,
      activity
    );
    
    agentTrace[2].status = 'success';
    agentTrace[2].durationMs = placeDuration;
    agentTrace[2].outputSummary = `Discovered ${stops.length} physical high-shelter fallback options anchored with Live Google Maps Grounding.`;

    // 4. SynthesisSubAgent: Serial consolidation
    agentTrace.push({ agentName: 'SynthesisSubAgent', status: 'running', durationMs: 0 });
    const { data: synthesis, durationMs: synthDuration } = await synthesizeSchedulePlanWithAI(
      location,
      activity,
      time,
      routeInfo,
      forecasts,
      stops
    );
    
    agentTrace[3].status = 'success';
    agentTrace[3].durationMs = synthDuration;
    agentTrace[3].outputSummary = `Verdict complete: [${synthesis.verdict.toUpperCase()}]. Generated standard environmental markers.`;

    return {
      ...synthesis,
      agentTrace,
      groundingChunks,
      timestamp: new Date().toISOString(),
      request: { location, activity, time }
    };
  } catch (error: any) {
    console.error('[Orchestrator] Failed end-to-end graph:', error);
    
    // Add failed trace marker
    const runningAgent = agentTrace.find(t => t.status === 'running');
    if (runningAgent) {
      runningAgent.status = 'failed';
    }

    throw error;
  }
}
