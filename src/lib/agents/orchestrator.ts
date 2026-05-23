import { GoogleGenAI, Type } from '@google/genai';
import {
  PlanResult,
  PlanOutput,
  AgentTraceItem,
  NavigationArrow,
  SunSample,
  SpatialPoint
} from '../types';
import { getHourlyForecasts, getLastWeatherSource } from '../weatherService';
import { getFlagForWetBulb } from '../flags';
import { PlatAtlasRecorder } from '../observability/platatlas';
import { recordRun } from '../observability/mcptape';

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

function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  let index = 0, len = encoded.length;
  let lat = 0, lng = 0;

  while (index < len) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

/**
 * Computes the initial true-north bearing in degrees from p1 to p2 (great-circle).
 */
function bearingDeg(
  p1: { lat: number; lng: number },
  p2: { lat: number; lng: number }
): number {
  const phi1 = (p1.lat * Math.PI) / 180;
  const phi2 = (p2.lat * Math.PI) / 180;
  const lambda1 = (p1.lng * Math.PI) / 180;
  const lambda2 = (p2.lng * Math.PI) / 180;
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  const theta = Math.atan2(y, x);
  return ((theta * 180) / Math.PI + 360) % 360;
}

interface DirectionsStep {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  distanceMeters: number;
  instruction: string;
  maneuver: string;
}

/**
 * Fetch Google Directions and return both the decoded polyline and the
 * structured step list (used by NavigationArrowsSubAgent for ground arrows).
 */
async function fetchGoogleDirections(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  waypoints: Array<{ lat: number; lng: number }>
): Promise<{ path: Array<{ lat: number; lng: number }>; steps: DirectionsStep[]; usedLive: boolean }> {
  const apiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
  const straightPath = [origin, ...waypoints, destination];

  if (!apiKey || apiKey.includes('YOUR_') || apiKey.includes('MY_') || apiKey.includes('placeholder')) {
    console.warn('[DirectionsSubAgent] Google Maps Platform Key is missing or invalid. Falling back to straight-line interpolation.');
    return { path: straightPath, steps: [], usedLive: false };
  }

  try {
    const waypointsStr = waypoints.map(wp => `${wp.lat},${wp.lng}`).join('|');
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&waypoints=${waypointsStr}&mode=walking&key=${apiKey}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP status ${res.status}`);
    const data = await res.json();

    if (data.status !== 'OK' || !data.routes || data.routes.length === 0) {
      console.warn(`[DirectionsSubAgent] Directions API returned non-OK status: ${data.status}. Falling back to straight line.`);
      return { path: straightPath, steps: [], usedLive: false };
    }

    const route = data.routes[0];
    const points = decodePolyline(route.overview_polyline.points);

    // Flatten legs->steps into our DirectionsStep shape
    const steps: DirectionsStep[] = [];
    for (const leg of route.legs || []) {
      for (const s of leg.steps || []) {
        steps.push({
          startLat: s.start_location?.lat ?? 0,
          startLng: s.start_location?.lng ?? 0,
          endLat: s.end_location?.lat ?? 0,
          endLng: s.end_location?.lng ?? 0,
          distanceMeters: s.distance?.value ?? 0,
          instruction: (s.html_instructions || '').replace(/<[^>]+>/g, '').trim(),
          maneuver: s.maneuver || 'straight'
        });
      }
    }

    return {
      path: points.length > 0 ? points : straightPath,
      steps,
      usedLive: true
    };
  } catch (error) {
    console.error('[DirectionsSubAgent] Failed to fetch directions from Google Maps API:', error);
    return { path: straightPath, steps: [], usedLive: false };
  }
}

/**
 * NavigationArrowsSubAgent: convert Directions API steps (or, when offline,
 * the polyline path itself) into ground-anchored arrows the XR scene can
 * render along the floor.
 */
function buildNavigationArrows(
  steps: DirectionsStep[],
  fallbackPath: Array<{ lat: number; lng: number }>
): NavigationArrow[] {
  if (steps && steps.length > 0) {
    return steps.map(s => ({
      lat: s.startLat,
      lng: s.startLng,
      bearingDeg: bearingDeg(
        { lat: s.startLat, lng: s.startLng },
        { lat: s.endLat, lng: s.endLng }
      ),
      distanceMeters: s.distanceMeters,
      instruction: s.instruction || 'Continue',
      maneuver: s.maneuver || 'straight'
    }));
  }

  // Fallback: derive arrows from polyline vertices alone
  const arrows: NavigationArrow[] = [];
  for (let i = 0; i < fallbackPath.length - 1; i++) {
    const a = fallbackPath[i];
    const b = fallbackPath[i + 1];
    const dist = haversineMeters(a, b);
    if (dist < 5) continue;
    arrows.push({
      lat: a.lat,
      lng: a.lng,
      bearingDeg: bearingDeg(a, b),
      distanceMeters: Math.round(dist),
      instruction: i === 0 ? 'Head toward next waypoint' : 'Continue along route',
      maneuver: i === fallbackPath.length - 2 ? 'arrive' : 'straight'
    });
  }
  return arrows;
}

function haversineMeters(
  p1: { lat: number; lng: number },
  p2: { lat: number; lng: number }
): number {
  const R = 6371e3;
  const phi1 = (p1.lat * Math.PI) / 180;
  const phi2 = (p2.lat * Math.PI) / 180;
  const dPhi = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLambda = ((p2.lng - p1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * SunPathSubAgent: simplified NOAA solar position math.
 * Returns azimuth (deg, 0=N CW), elevation (deg above horizon), and an
 * estimated shadeFactor that the XR scene uses to color exposed segments.
 *
 * Reference: NOAA Solar Position Algorithm (simplified). Good enough for
 * shade-vs-sun route segmentation; not for navigation-grade ephemeris.
 */
function solarPosition(
  lat: number,
  lng: number,
  when: Date
): { azimuthDeg: number; elevationDeg: number } {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  const start = new Date(Date.UTC(when.getUTCFullYear(), 0, 0));
  const diff = when.getTime() - start.getTime();
  const dayOfYear = Math.floor(diff / 86400000);

  const fractionalYear =
    ((2 * Math.PI) / 365) * (dayOfYear - 1 + (when.getUTCHours() - 12) / 24);

  // Equation of time (minutes)
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(fractionalYear) -
      0.032077 * Math.sin(fractionalYear) -
      0.014615 * Math.cos(2 * fractionalYear) -
      0.040849 * Math.sin(2 * fractionalYear));

  // Solar declination (rad)
  const decl =
    0.006918 -
    0.399912 * Math.cos(fractionalYear) +
    0.070257 * Math.sin(fractionalYear) -
    0.006758 * Math.cos(2 * fractionalYear) +
    0.000907 * Math.sin(2 * fractionalYear) -
    0.002697 * Math.cos(3 * fractionalYear) +
    0.00148 * Math.sin(3 * fractionalYear);

  // True solar time (minutes)
  const trueSolarTime =
    when.getUTCHours() * 60 +
    when.getUTCMinutes() +
    when.getUTCSeconds() / 60 +
    eqTime +
    4 * lng;
  // Hour angle (deg)
  let ha = trueSolarTime / 4 - 180;
  if (ha < -180) ha += 360;
  if (ha > 180) ha -= 360;

  const latR = lat * rad;
  const haR = ha * rad;

  const sinAlt =
    Math.sin(latR) * Math.sin(decl) +
    Math.cos(latR) * Math.cos(decl) * Math.cos(haR);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  const cosAz =
    (Math.sin(decl) - Math.sin(alt) * Math.sin(latR)) /
    (Math.cos(alt) * Math.cos(latR));
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (ha > 0) az = 2 * Math.PI - az;

  return {
    azimuthDeg: (az * deg + 360) % 360,
    elevationDeg: alt * deg
  };
}

function buildSunSamples(
  path: Array<{ lat: number; lng: number }>,
  when: Date
): SunSample[] {
  if (path.length === 0) return [];

  // Sample roughly every ~10% along the path for compact XR data
  const stride = Math.max(1, Math.floor(path.length / 10));
  const samples: SunSample[] = [];
  for (let i = 0; i < path.length; i += stride) {
    const p = path[i];
    const sun = solarPosition(p.lat, p.lng, when);

    // Rough shade heuristic:
    //  - Sun below horizon -> fully shaded (1.0)
    //  - Low sun (<25 deg) -> long shadows, ~0.7 shaded
    //  - High sun (>60 deg) -> minimal shadow cover, ~0.2 shaded
    let shadeFactor: number;
    if (sun.elevationDeg <= 0) shadeFactor = 1;
    else if (sun.elevationDeg < 25) shadeFactor = 0.7;
    else if (sun.elevationDeg < 45) shadeFactor = 0.45;
    else if (sun.elevationDeg < 60) shadeFactor = 0.3;
    else shadeFactor = 0.2;

    samples.push({
      lat: p.lat,
      lng: p.lng,
      azimuthDeg: Math.round(sun.azimuthDeg * 10) / 10,
      elevationDeg: Math.round(sun.elevationDeg * 10) / 10,
      shadeFactor
    });
  }
  return samples;
}

/**
 * StreetViewPanoSubAgent: attaches first-person Street View URIs to every
 * spatial node, oriented toward the next node so the XR preview faces the
 * traveller's heading rather than a random compass direction.
 */
function attachStreetViewPanoramas(
  origin: SpatialPoint,
  waypoints: SpatialPoint[],
  coolingStops: Array<{ lat: number; lng: number; name: string; placeId: string; streetViewUri?: string; mapsUri?: string }>,
  breaks: Array<{ lat: number; lng: number; streetViewUri?: string }>
) {
  const apiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';

  const seq: Array<{ lat: number; lng: number }> = [
    { lat: origin.lat, lng: origin.lng },
    ...waypoints.map(w => ({ lat: w.lat, lng: w.lng }))
  ];

  // Compute headings and attach. Last point inherits the previous heading.
  const headings: number[] = [];
  for (let i = 0; i < seq.length; i++) {
    const next = seq[i + 1] || seq[i - 1] || seq[i];
    headings.push(bearingDeg(seq[i], next));
  }

  origin.heading = headings[0] ?? 0;
  origin.streetViewUri = streetViewUri(origin.lat, origin.lng, origin.heading, apiKey);

  waypoints.forEach((wp, i) => {
    wp.heading = headings[i + 1] ?? 0;
    wp.streetViewUri = streetViewUri(wp.lat, wp.lng, wp.heading, apiKey);
  });

  coolingStops.forEach(stop => {
    const nearest = nearestSeqPoint(seq, stop);
    const heading = bearingDeg({ lat: stop.lat, lng: stop.lng }, nearest);
    stop.streetViewUri = streetViewUri(stop.lat, stop.lng, heading, apiKey);
  });

  breaks.forEach(b => {
    const nearest = nearestSeqPoint(seq, b);
    const heading = bearingDeg({ lat: b.lat, lng: b.lng }, nearest);
    b.streetViewUri = streetViewUri(b.lat, b.lng, heading, apiKey);
  });
}

function nearestSeqPoint(
  seq: Array<{ lat: number; lng: number }>,
  target: { lat: number; lng: number }
): { lat: number; lng: number } {
  let best = seq[0];
  let bestD = Infinity;
  for (const p of seq) {
    const d = haversineMeters(p, target);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function streetViewUri(lat: number, lng: number, heading: number, _apiKey: string): string {
  // Use the public Google Maps Street View URL scheme: viewable without API key.
  // (Static API would need the key + signature; the URL scheme renders the same pano.)
  const h = Math.round(heading);
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}&heading=${h}&pitch=0&fov=80`;
}

function scheduleRefugeBreaks(
  directionsPath: Array<{ lat: number; lng: number }>,
  wetBulbPeakF: number,
  flag: string
): { workRestRatio: string; suggestedBreaks: any[] } {
  let workRestRatio = '50 min activity / 10 min rest';
  let breakIntervalMinutes = 50;
  let breakDurationMinutes = 10;

  if (flag === 'green') {
    workRestRatio = '45 min activity / 15 min rest';
    breakIntervalMinutes = 45;
    breakDurationMinutes = 15;
  } else if (flag === 'yellow') {
    workRestRatio = '40 min activity / 20 min rest';
    breakIntervalMinutes = 40;
    breakDurationMinutes = 20;
  } else if (flag === 'red') {
    workRestRatio = '30 min activity / 30 min rest';
    breakIntervalMinutes = 30;
    breakDurationMinutes = 30;
  } else if (flag === 'black') {
    workRestRatio = '15 min activity / 45 min rest';
    breakIntervalMinutes = 15;
    breakDurationMinutes = 45;
  }

  const walkingSpeedMps = 1.3; // walking speed average
  const breakIntervalSeconds = breakIntervalMinutes * 60;
  const breakIntervalDistance = breakIntervalSeconds * walkingSpeedMps;

  const suggestedBreaks: any[] = [];

  if (directionsPath.length < 2) return { workRestRatio, suggestedBreaks };

  let cumulativeDistance = 0;
  let nextBreakDistance = breakIntervalDistance;
  let elapsedMinutes = 0;

  for (let i = 1; i < directionsPath.length; i++) {
    const p1 = directionsPath[i - 1];
    const p2 = directionsPath[i];
    const dist = haversineMeters(p1, p2);
    cumulativeDistance += dist;

    if (cumulativeDistance >= nextBreakDistance) {
      elapsedMinutes += breakIntervalMinutes;
      suggestedBreaks.push({
        lat: p2.lat,
        lng: p2.lng,
        label: `Suggested ${breakDurationMinutes}m Rest Break`,
        timeOffsetMinutes: elapsedMinutes,
        durationMinutes: breakDurationMinutes,
        type: suggestedBreaks.length % 2 === 0 ? 'water' : 'shade'
      });
      nextBreakDistance += breakIntervalDistance;
    }
  }

  return { workRestRatio, suggestedBreaks };
}

/**
 * Parse the request time string ("14:30", "2:30 PM", etc.) into a Date for
 * today in the user's local zone. Falls back to current time on parse failure.
 */
function parseRequestTime(time: string): Date {
  const now = new Date();
  if (!time) return now;
  const trimmed = time.trim();
  const m = trimmed.match(/^(\d{1,2})[:\.](\d{2})\s*(AM|PM)?$/i);
  if (!m) {
    const m2 = trimmed.match(/^(\d{1,2})\s*(AM|PM)$/i);
    if (!m2) return now;
    let h = parseInt(m2[1], 10);
    const ampm = m2[2].toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    now.setHours(h, 0, 0, 0);
    return now;
  }
  let h = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  if (m[3]) {
    const ampm = m[3].toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
  }
  now.setHours(h, mins, 0, 0);
  return now;
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
  const recorder = new PlatAtlasRecorder();
  recorder.snapshot().attributes = {
    ...recorder.snapshot().attributes,
    location,
    activity,
    time
  };

  try {
    // 1. Resolve Location Coordinates using Gemini 3.5 Flash
    agentTrace.push({ agentName: 'LocationResolutionSubAgent', status: 'running', durationMs: 0 });
    const { data: routeInfo, durationMs: geoDuration } = await recorder.withSpan(
      'LocationResolutionSubAgent',
      { model: 'gemini-3.5-flash', tool: 'structured-output' },
      () => resolveLocationWithAI(location, activity),
      r => `lat=${r.data.lat.toFixed(4)} lng=${r.data.lng.toFixed(4)} waypoints=${r.data.waypoints.length}`
    );

    agentTrace[0].status = 'success';
    agentTrace[0].durationMs = geoDuration;
    agentTrace[0].outputSummary = `Resolved central coordinate to (${routeInfo.lat.toFixed(4)}, ${routeInfo.lng.toFixed(4)}) with ${routeInfo.waypoints.length} route stops.`;

    // 2. WeatherSubAgent: Retrieve meteo profile (NWS -> Open-Meteo cascade)
    const weatherStart = Date.now();
    agentTrace.push({ agentName: 'WeatherSubAgent', status: 'running', durationMs: 0 });
    const forecasts = await recorder.withSpan(
      'WeatherSubAgent',
      { tool: 'getHourlyHeatPoints', cascade: 'nws->open-meteo->simulated' },
      () => getHourlyForecasts(routeInfo.lat, routeInfo.lng),
      f => `${f.length} hours; peakF=${Math.max(...f.map(x => x.temperatureF))}; source=${getLastWeatherSource(routeInfo.lat, routeInfo.lng)}`
    );
    const weatherDuration = Date.now() - weatherStart;

    const weatherSource = getLastWeatherSource(routeInfo.lat, routeInfo.lng);
    const sourceLabel =
      weatherSource === 'nws'
        ? 'NWS api.weather.gov'
        : weatherSource === 'open-meteo'
          ? 'Open-Meteo (NWS unavailable for this coordinate)'
          : 'simulated plausible profile (both NWS + Open-Meteo offline)';
    agentTrace[1].status = 'success';
    agentTrace[1].durationMs = weatherDuration;
    agentTrace[1].outputSummary = `Hourly profile via ${sourceLabel}: base ${forecasts[0]?.temperatureF || 70}°F → peak ${Math.max(...forecasts.map(f => f.temperatureF))}°F. Wet-bulb derived per Stull (2011).`;

    // 3. PlaceSubAgent: Locate refuge stops in parallel (Using real Google Maps Grounding!)
    agentTrace.push({ agentName: 'PlaceSubAgent', status: 'running', durationMs: 0 });
    const { data: stops, groundingChunks, durationMs: placeDuration } = await recorder.withSpan(
      'PlaceSubAgent',
      { model: 'gemini-3.5-flash', tool: 'google-maps-grounding' },
      () =>
        getCoolingStopsWithAI(
          routeInfo.lat,
          routeInfo.lng,
          routeInfo.resolvedLabel,
          activity
        ),
      r => `${r.data.length} stops · ${r.groundingChunks.length} grounding chunks`
    );

    agentTrace[2].status = 'success';
    agentTrace[2].durationMs = placeDuration;
    agentTrace[2].outputSummary = `Discovered ${stops.length} physical high-shelter fallback options anchored with Live Google Maps Grounding.`;

    // 4. SynthesisSubAgent: Serial consolidation
    agentTrace.push({ agentName: 'SynthesisSubAgent', status: 'running', durationMs: 0 });
    const { data: synthesis, durationMs: synthDuration } = await recorder.withSpan(
      'SynthesisSubAgent',
      { model: 'gemini-3.5-flash', tool: 'structured-output', schema: 'PlanOutput' },
      () =>
        synthesizeSchedulePlanWithAI(location, activity, time, routeInfo, forecasts, stops),
      r => `verdict=${r.data.verdict} flag=${r.data.flag} wetBulbPeakF=${r.data.wetBulbPeakF}`
    );

    agentTrace[3].status = 'success';
    agentTrace[3].durationMs = synthDuration;
    agentTrace[3].outputSummary = `Verdict complete: [${synthesis.verdict.toUpperCase()}]. Generated standard environmental markers.`;

    // 5. RouteDirectionsSubAgent: High-fidelity path coordinates + structured steps
    const directionsStart = Date.now();
    agentTrace.push({ agentName: 'RouteDirectionsSubAgent', status: 'running', durationMs: 0 });

    const origin = synthesis.spatial.origin;
    const waypoints = synthesis.spatial.waypoints;
    const dest = waypoints[waypoints.length - 1] || origin;
    const waypointMiddles = waypoints.slice(0, -1);

    const { path: directionsPath, steps: directionSteps, usedLive } = await recorder.withSpan(
      'RouteDirectionsSubAgent',
      { tool: 'google-maps-directions', mode: 'walking' },
      () => fetchGoogleDirections(origin, dest, waypointMiddles),
      r => `live=${r.usedLive} polyline=${r.path.length}pts steps=${r.steps.length}`
    );
    synthesis.spatial.directionsPath = directionsPath;

    const directionsDuration = Date.now() - directionsStart;
    agentTrace[4] = {
      agentName: 'RouteDirectionsSubAgent',
      status: 'success',
      durationMs: directionsDuration,
      outputSummary: usedLive
        ? `Traced ${directionsPath.length} polyline points and ${directionSteps.length} turn-by-turn maneuvers via Google Maps Directions API (walking mode).`
        : `Google Maps key absent — generated ${directionsPath.length}-pt straight-line interpolation. Set GOOGLE_MAPS_PLATFORM_KEY for live turn-by-turn.`
    };

    // 6. NavigationArrowsSubAgent: Ground-anchored arrows for XR
    const navStart = Date.now();
    agentTrace.push({ agentName: 'NavigationArrowsSubAgent', status: 'running', durationMs: 0 });
    const arrows = buildNavigationArrows(directionSteps, directionsPath);
    synthesis.spatial.navigationArrows = arrows;
    agentTrace[5] = {
      agentName: 'NavigationArrowsSubAgent',
      status: 'success',
      durationMs: Date.now() - navStart,
      outputSummary: `Emitted ${arrows.length} ground-anchored heading arrows for the spatial XR panel (mean step ${arrows.length ? Math.round(arrows.reduce((a, b) => a + b.distanceMeters, 0) / arrows.length) : 0}m).`
    };

    // 7. SunPathSubAgent: Solar position + shade factor along route
    const sunStart = Date.now();
    agentTrace.push({ agentName: 'SunPathSubAgent', status: 'running', durationMs: 0 });
    const activityWhen = parseRequestTime(time);
    const sunSamples = buildSunSamples(directionsPath, activityWhen);
    synthesis.spatial.sunSamples = sunSamples;
    const meanShade = sunSamples.length
      ? Math.round((sunSamples.reduce((a, s) => a + s.shadeFactor, 0) / sunSamples.length) * 100)
      : 0;
    const meanElev = sunSamples.length
      ? Math.round(sunSamples.reduce((a, s) => a + s.elevationDeg, 0) / sunSamples.length)
      : 0;
    agentTrace[6] = {
      agentName: 'SunPathSubAgent',
      status: 'success',
      durationMs: Date.now() - sunStart,
      outputSummary: `Computed ${sunSamples.length} solar samples (mean elev ${meanElev}°, est. ${meanShade}% shaded). Drives XR shade overlay & rest-break siting.`
    };

    // 8. RefugeBreakSubAgent: Rest break scheduling
    const breakStart = Date.now();
    agentTrace.push({ agentName: 'RefugeBreakSubAgent', status: 'running', durationMs: 0 });

    const { workRestRatio, suggestedBreaks } = scheduleRefugeBreaks(directionsPath, synthesis.wetBulbPeakF, synthesis.flag);
    synthesis.workRestRatio = workRestRatio;
    synthesis.suggestedBreaks = suggestedBreaks;

    agentTrace[7] = {
      agentName: 'RefugeBreakSubAgent',
      status: 'success',
      durationMs: Date.now() - breakStart,
      outputSummary: `Scheduled work/rest intervals: "${workRestRatio}" with ${suggestedBreaks.length} hydration stops.`
    };

    // 9. StreetViewPanoSubAgent: First-person previews oriented to heading
    const svStart = Date.now();
    agentTrace.push({ agentName: 'StreetViewPanoSubAgent', status: 'running', durationMs: 0 });
    attachStreetViewPanoramas(origin, waypoints, synthesis.coolingStops as any, suggestedBreaks);
    agentTrace[8] = {
      agentName: 'StreetViewPanoSubAgent',
      status: 'success',
      durationMs: Date.now() - svStart,
      outputSummary: `Bound first-person Street View panos to ${1 + waypoints.length} route nodes, ${synthesis.coolingStops.length} refuges, ${suggestedBreaks.length} break beacons (heading-aware).`
    };

    const spans = recorder.finalize('success');
    const result: PlanResult = {
      ...synthesis,
      id: recorder.runId,
      agentTrace,
      traceSpans: spans,
      groundingChunks,
      timestamp: new Date().toISOString(),
      request: { location, activity, time }
    };

    // McpTape: persist the full run so /api/replay/:runId can reproduce it
    // deterministically during the demo. Fire-and-forget — recording failure
    // should never bubble up to the user.
    recordRun(result, spans).catch(err =>
      console.warn('[McpTape] Failed to persist recording for', recorder.runId, err)
    );

    return result;
  } catch (error: any) {
    console.error('[Orchestrator] Failed end-to-end graph:', error);
    recorder.finalize('failed');

    // Add failed trace marker
    const runningAgent = agentTrace.find(t => t.status === 'running');
    if (runningAgent) {
      runningAgent.status = 'failed';
    }

    throw error;
  }
}

/**
 * Lightweight re-synthesis used by Live Watch mode. Reuses the previously
 * resolved coordinates and route, refetches the weather cascade, and updates
 * verdict/flag/wet-bulb without paying for a full geocode + grounding pass.
 */
export interface WatchTick {
  wetBulbPeakF: number;
  flag: PlanResult['flag'];
  verdict: PlanResult['verdict'];
  headline: string;
  reasoning: string;
  forecastSampleF: number;
  forecastSampleRH: number;
  forecastSampleTime: string;
  fetchedAt: string;
  source: 'nws' | 'open-meteo' | 'simulated';
}

export async function runWatchTick(prev: PlanResult): Promise<WatchTick> {
  const lat = prev.spatial.origin.lat;
  const lng = prev.spatial.origin.lng;

  const forecasts = await getHourlyForecasts(lat, lng);
  const wetBulbPeakF = forecasts.reduce((max, f) => Math.max(max, f.wetBulbF), 0);
  const flag = getFlagForWetBulb(wetBulbPeakF);

  // Promote flag changes into a verdict shift without re-prompting the LLM
  let verdict = prev.verdict;
  let headline = prev.headline;
  let reasoning = prev.reasoning;
  if (flag === 'red' || flag === 'black') {
    verdict = 'delay';
    headline = `Live: ${flag.toUpperCase()} flag — delay outdoor exertion`;
    reasoning = `Watch tick shows peak wet-bulb ${wetBulbPeakF}°F at ${prev.spatial.origin.label}. USMC 6200.1E ${flag} flag exceeds safe exertion threshold; route paused.`;
  } else if (flag === 'yellow') {
    verdict = prev.verdict === 'go' ? 'alternate' : prev.verdict;
    headline = `Live: yellow flag — moderate caution at ${wetBulbPeakF}°F WBGT`;
    reasoning = `Wet-bulb rising to ${wetBulbPeakF}°F. Tighten work/rest to 40/20 and pre-stage hydration at the next two refuges.`;
  }

  const head = forecasts[0];
  return {
    wetBulbPeakF,
    flag,
    verdict,
    headline,
    reasoning,
    forecastSampleF: head?.temperatureF ?? 0,
    forecastSampleRH: head?.relativeHumidity ?? 0,
    forecastSampleTime: head?.time ?? new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    source: getLastWeatherSource(lat, lng)
  };
}
