import { Type } from '@google/genai';
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
import {
  ensureAgent,
  runAgentInteraction,
  SUBAGENT_SPECS
} from './managedAgents';

interface GeocodedLocation {
  lat: number;
  lng: number;
  resolvedLabel: string;
  waypoints: Array<{ lat: number; lng: number; label: string }>;
}

/**
 * LocationResolutionSubAgent — invokes the managed agent
 * `threshold-location-subagent` (see SUBAGENT_SPECS.location). Returns the
 * geocoded center, 1-3 waypoints, and a resolved label.
 */
async function resolveLocationWithAI(
  location: string,
  activity: string
): Promise<{ data: GeocodedLocation; durationMs: number }> {
  const startTime = Date.now();
  const agentId = await ensureAgent(SUBAGENT_SPECS.location);
  const result = await runAgentInteraction({
    agentId,
    inputText: `Resolve coordinates for this travel scheduling request.
Location String: "${location}"
Reflected Activity: "${activity}"

Provide the geocoded central point, a list of 1-3 waypoints, and a clean resolved human-friendly location string.`,
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
  });

  const durationMs = Date.now() - startTime;
  const data = JSON.parse(result.text || '{}') as GeocodedLocation;
  return { data, durationMs };
}

/**
 * PlaceSubAgent — invokes the managed agent `threshold-place-subagent`
 * (see SUBAGENT_SPECS.place) with per-interaction Google Maps grounding
 * pinned to the supplied lat/lng. Maps grounding is passed as a
 * per-interaction tool because the Managed Agents `Agent.tools` enum at
 * v2.4 does not include `google_maps` directly.
 */
async function getCoolingStopsWithAI(
  lat: number,
  lng: number,
  resolvedLabel: string,
  activity: string
): Promise<{ data: any[]; groundingChunks: any[]; durationMs: number }> {
  const startTime = Date.now();
  const agentId = await ensureAgent(SUBAGENT_SPECS.place);

  const result = await runAgentInteraction({
    agentId,
    inputText: `Identify 3 genuine places near "${resolvedLabel}" (around central GPS coordinates: ${lat}, ${lng}) that exist on Google Maps and serve as outdoor/trail rest points, shaded spots, parks, water fountains, cafes, or shelters for: "${activity}".

Output exactly one JSON block inside your markdown reply:
\`\`\`json
{
  "stops": [
    {
      "name": "Exact Name on Google Maps",
      "placeId": "gmp-[id]",
      "lat": ${lat},
      "lng": ${lng},
      "distanceMeters": 350,
      "why": "Why this is a good environmental refuge"
    }
  ]
}
\`\`\``,
    perInteractionTools: [{ googleMaps: {} }],
    toolConfig: {
      retrievalConfig: {
        latLng: { latitude: lat, longitude: lng }
      }
    }
  });

  const durationMs = Date.now() - startTime;
  const text = result.text || '';

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

  // Grounding chunks from the managed-agents interaction. Falls back to the
  // raw candidate-shape path for environments where the SDK normalizes the
  // interaction into a generateContent-style envelope.
  const groundingChunks: any[] = [
    ...result.groundingChunks,
    ...(((result.raw as any)?.candidates?.[0]?.groundingMetadata?.groundingChunks) || [])
  ];

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
 * SynthesisSubAgent — invokes the managed agent `threshold-synthesis-subagent`
 * (see SUBAGENT_SPECS.synthesis) and returns the final PlanOutput JSON.
 *
 * The system instruction lives on the managed agent itself (the medical-advice
 * firewall, the Stull/USMC citation requirement, the schema conformance rule).
 * The per-interaction input only carries the live data context.
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

  // Find peak wet-bulb temperature in the upcoming forecast window
  const wetBulbPeakF = forecasts.reduce((max, f) => Math.max(max, f.wetBulbF), 0);
  const matchedFlag = getFlagForWetBulb(wetBulbPeakF);
  const agentId = await ensureAgent(SUBAGENT_SPECS.synthesis);

  const input = `Compose a scheduling verdict for this Threshold run.

Activity: "${reqActivity}"
Target Start Time: "${reqTime}"
Resolved Central Location: "${resolved.resolvedLabel}" (${resolved.lat}, ${resolved.lng})

Upcoming 24-hour meteorological profile:
${JSON.stringify(forecasts, null, 2)}

Physical refuges identified by PlaceSubAgent:
${JSON.stringify(coolingStops, null, 2)}

Computed peak wet-bulb (Stull 2011): ${wetBulbPeakF}°F (matched flag: ${matchedFlag}).

Respond with the structured JSON only.`;

  const result = await runAgentInteraction({
    agentId,
    inputText: input,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        verdict: { type: Type.STRING, enum: ['go', 'delay', 'alternate'] },
        departBy: { type: Type.STRING, nullable: true, description: 'ISO timestamp or null if delay' },
        delayUntil: { type: Type.STRING, nullable: true, description: 'ISO timestamp or null if go' },
        headline: { type: Type.STRING, description: 'Summary message under 80 characters' },
        reasoning: { type: Type.STRING, description: 'Direct logistical logic under 400 characters' },
        wetBulbPeakF: { type: Type.INTEGER, description: `Peak wet-bulb in Fahrenheit (e.g. ${wetBulbPeakF})` },
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
  });

  const durationMs = Date.now() - startTime;
  const data = JSON.parse(result.text || '{}') as PlanOutput;

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

interface OptimizedViaPoint {
  kind: 'waypoint' | 'refuge';
  originalIndex: number;
  newIndex: number;
  lat: number;
  lng: number;
  label: string;
}

interface DirectionsResult {
  path: Array<{ lat: number; lng: number }>;
  steps: DirectionsStep[];
  usedLive: boolean;
  optimizedOrder: OptimizedViaPoint[];
  reorderedFromOriginal: boolean;
}

/**
 * Fetch Google Directions and return the decoded polyline, structured steps,
 * AND the optimized via-point ordering. Middle waypoints and cooling-stop
 * refuges are combined into a single via-point list, prefixed with the
 * Directions API's `optimize:true` flag so Google's TSP solver reorders them
 * by geographic proximity. Origin and destination are pinned and never
 * reordered.
 */
function travelModeForActivity(activity: string): 'bicycling' | 'walking' | 'driving' {
  const a = activity.toLowerCase();
  if (/bik(e|ing)|cycl(e|ing)|pedal/.test(a)) return 'bicycling';
  if (/driv(e|ing)|car|truck/.test(a)) return 'driving';
  // walking covers jogging/running/hiking/strolling — Google Directions
  // doesn't have a running mode so we use walking paths.
  return 'walking';
}

async function fetchGoogleDirections(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  middleWaypoints: Array<{ lat: number; lng: number; label?: string }>,
  refuges: Array<{ lat: number; lng: number; name?: string }> = [],
  activity: string = ''
): Promise<DirectionsResult> {
  const apiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
  // Original via-point order, indexed for RouteOptimizationSubAgent reporting.
  const viaPoints: Array<OptimizedViaPoint> = [
    ...middleWaypoints.map((wp, i) => ({
      kind: 'waypoint' as const,
      originalIndex: i,
      newIndex: i,
      lat: wp.lat,
      lng: wp.lng,
      label: wp.label || `Waypoint ${i + 1}`
    })),
    ...refuges.map((r, i) => ({
      kind: 'refuge' as const,
      originalIndex: i,
      newIndex: middleWaypoints.length + i,
      lat: r.lat,
      lng: r.lng,
      label: r.name || `Refuge ${i + 1}`
    }))
  ];
  const straightPath = [origin, ...viaPoints.map(v => ({ lat: v.lat, lng: v.lng })), destination];

  if (!apiKey || apiKey.includes('YOUR_') || apiKey.includes('MY_') || apiKey.includes('placeholder')) {
    console.warn('[DirectionsSubAgent] Google Maps Platform Key is missing or invalid. Falling back to straight-line interpolation.');
    return { path: straightPath, steps: [], usedLive: false, optimizedOrder: viaPoints, reorderedFromOriginal: false };
  }

  if (viaPoints.length === 0) {
    // No via points — just origin → destination, no optimization needed.
    // Fall through to the direct request below.
  }

  try {
    const viaStr = viaPoints.map(v => `via:${v.lat},${v.lng}`).join('|');
    // `optimize:true` reorders the via points by Google's TSP solver while
    // pinning origin and destination. The `via:` prefix makes each one a
    // pass-through with no "arrival" stop, which is what we want for refuges.
    const waypointsParam = viaPoints.length > 0
      ? `&waypoints=optimize:true|${viaStr}`
      : '';
    const travelMode = travelModeForActivity(activity);
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}${waypointsParam}&mode=${travelMode}&key=${apiKey}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP status ${res.status}`);
    const data = await res.json();

    if (data.status !== 'OK' || !data.routes || data.routes.length === 0) {
      console.warn(`[DirectionsSubAgent] Directions API returned non-OK status: ${data.status}. Falling back to straight line.`);
      return { path: straightPath, steps: [], usedLive: false, optimizedOrder: viaPoints, reorderedFromOriginal: false };
    }

    const route = data.routes[0];
    const points = decodePolyline(route.overview_polyline.points);

    // route.waypoint_order is the permutation Google chose. Re-apply it so
    // the optimizedOrder list reflects the actual sequence the polyline
    // traverses.
    const waypointOrder: number[] = Array.isArray(route.waypoint_order)
      ? route.waypoint_order
      : viaPoints.map((_, i) => i);
    const reordered: OptimizedViaPoint[] = waypointOrder.map((origIdx, newIdx) => ({
      ...viaPoints[origIdx],
      newIndex: newIdx
    }));
    const reorderedFromOriginal = waypointOrder.some((v, i) => v !== i);

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
      usedLive: true,
      optimizedOrder: reordered,
      reorderedFromOriginal
    };
  } catch (error) {
    console.error('[DirectionsSubAgent] Failed to fetch directions from Google Maps API:', error);
    return { path: straightPath, steps: [], usedLive: false, optimizedOrder: viaPoints, reorderedFromOriginal: false };
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
      { managed_agent: SUBAGENT_SPECS.location.id, tool: 'structured-output' },
      () => resolveLocationWithAI(location, activity),
      r => `lat=${r.data.lat.toFixed(4)} lng=${r.data.lng.toFixed(4)} waypoints=${r.data.waypoints.length}`
    );

    agentTrace[0].status = 'success';
    agentTrace[0].durationMs = geoDuration;
    agentTrace[0].outputSummary = `Managed agent ${SUBAGENT_SPECS.location.id} resolved center (${routeInfo.lat.toFixed(4)}, ${routeInfo.lng.toFixed(4)}) + ${routeInfo.waypoints.length} waypoints.`;

    // 2 + 3. PARALLEL FAN-OUT — WeatherSubAgent and PlaceSubAgent are managed
    // agents that depend on routeInfo but not on each other, so the
    // PrimaryAgent dispatches them concurrently per the Managed Agents
    // parallel-agent pattern.
    const parallelStart = Date.now();
    agentTrace.push({ agentName: 'WeatherSubAgent', status: 'running', durationMs: 0 });
    const weatherTraceIdx = agentTrace.length - 1;
    agentTrace.push({ agentName: 'PlaceSubAgent', status: 'running', durationMs: 0 });
    const placeTraceIdx = agentTrace.length - 1;

    const [forecasts, placeResult] = await Promise.all([
      recorder.withSpan(
        'WeatherSubAgent',
        { tool: 'getHourlyHeatPoints', cascade: 'nws->open-meteo->simulated' },
        () => getHourlyForecasts(routeInfo.lat, routeInfo.lng),
        f => `${f.length} hours; peakF=${Math.max(...f.map(x => x.temperatureF))}; source=${getLastWeatherSource(routeInfo.lat, routeInfo.lng)}`
      ),
      recorder.withSpan(
        'PlaceSubAgent',
        { managed_agent: SUBAGENT_SPECS.place.id, tool: 'google-maps-grounding' },
        () =>
          getCoolingStopsWithAI(
            routeInfo.lat,
            routeInfo.lng,
            routeInfo.resolvedLabel,
            activity
          ),
        r => `${r.data.length} stops · ${r.groundingChunks.length} grounding chunks`
      )
    ]);
    const parallelDuration = Date.now() - parallelStart;

    const weatherSource = getLastWeatherSource(routeInfo.lat, routeInfo.lng);
    const sourceLabel =
      weatherSource === 'nws'
        ? 'NWS api.weather.gov'
        : weatherSource === 'open-meteo'
          ? 'Open-Meteo (NWS unavailable for this coordinate)'
          : 'simulated plausible profile (both NWS + Open-Meteo offline)';
    agentTrace[weatherTraceIdx].status = 'success';
    agentTrace[weatherTraceIdx].durationMs = parallelDuration;
    agentTrace[weatherTraceIdx].outputSummary = `Hourly profile via ${sourceLabel}: base ${forecasts[0]?.temperatureF || 70}°F → peak ${Math.max(...forecasts.map(f => f.temperatureF))}°F. Wet-bulb derived per Stull (2011). [parallel with PlaceSubAgent]`;

    const { data: stops, groundingChunks } = placeResult;
    agentTrace[placeTraceIdx].status = 'success';
    agentTrace[placeTraceIdx].durationMs = parallelDuration;
    agentTrace[placeTraceIdx].outputSummary = `Managed agent ${SUBAGENT_SPECS.place.id} discovered ${stops.length} physical refuges via Google Maps Grounding. [parallel with WeatherSubAgent]`;

    // 4. SynthesisSubAgent: Serial consolidation
    agentTrace.push({ agentName: 'SynthesisSubAgent', status: 'running', durationMs: 0 });
    const { data: synthesis, durationMs: synthDuration } = await recorder.withSpan(
      'SynthesisSubAgent',
      { managed_agent: SUBAGENT_SPECS.synthesis.id, tool: 'structured-output', schema: 'PlanOutput' },
      () =>
        synthesizeSchedulePlanWithAI(location, activity, time, routeInfo, forecasts, stops),
      r => `verdict=${r.data.verdict} flag=${r.data.flag} wetBulbPeakF=${r.data.wetBulbPeakF}`
    );

    agentTrace[3].status = 'success';
    agentTrace[3].durationMs = synthDuration;
    agentTrace[3].outputSummary = `Managed agent ${SUBAGENT_SPECS.synthesis.id} returned verdict [${synthesis.verdict.toUpperCase()}], flag ${synthesis.flag}, ${synthesis.coolingStops.length} refuges.`;

    // 5. RouteDirectionsSubAgent + RouteOptimizationSubAgent: Google Directions
    // with `optimize:true` on the combined waypoints+refuges via-point list.
    // Origin and destination are pinned; everything in between is reordered
    // by Google's TSP solver for minimum total walking distance.
    const directionsStart = Date.now();
    agentTrace.push({ agentName: 'RouteDirectionsSubAgent', status: 'running', durationMs: 0 });

    const origin = synthesis.spatial.origin;
    const waypoints = synthesis.spatial.waypoints;
    const dest = waypoints[waypoints.length - 1] || origin;
    const waypointMiddles = waypoints.slice(0, -1).map(w => ({ lat: w.lat, lng: w.lng, label: w.label }));
    const refugeViaPoints = synthesis.coolingStops.map(s => ({ lat: s.lat, lng: s.lng, name: s.name }));

    const travelMode = travelModeForActivity(activity);
    const { path: directionsPath, steps: directionSteps, usedLive, optimizedOrder, reorderedFromOriginal } = await recorder.withSpan(
      'RouteDirectionsSubAgent',
      {
        tool: 'google-maps-directions',
        mode: travelMode,
        viaPoints: waypointMiddles.length + refugeViaPoints.length,
        optimize: 'true'
      },
      () => fetchGoogleDirections(origin, dest, waypointMiddles, refugeViaPoints, activity),
      r => `live=${r.usedLive} mode=${travelMode} polyline=${r.path.length}pts steps=${r.steps.length} reordered=${r.reorderedFromOriginal}`
    );
    synthesis.spatial.directionsPath = directionsPath;

    const directionsDuration = Date.now() - directionsStart;
    agentTrace[4] = {
      agentName: 'RouteDirectionsSubAgent',
      status: 'success',
      durationMs: directionsDuration,
      outputSummary: usedLive
        ? `Traced ${directionsPath.length} polyline points and ${directionSteps.length} turn-by-turn maneuvers through ${waypointMiddles.length} required waypoints + ${refugeViaPoints.length} refuges via Google Maps Directions API (walking mode, optimize:true).`
        : `Google Maps key absent — generated ${directionsPath.length}-pt straight-line interpolation through ${waypointMiddles.length + refugeViaPoints.length} via points. Set GOOGLE_MAPS_PLATFORM_KEY for live turn-by-turn.`
    };

    // 5b. RouteOptimizationSubAgent: documents the reorder so the trace + UI
    // can explain why refuges appear in a different sequence than they were
    // discovered. This is deterministic (Google's TSP solver), but the agent
    // boundary makes the optimization visible in PlatAtlas and the dashboard.
    const optimStart = Date.now();
    agentTrace.push({ agentName: 'RouteOptimizationSubAgent', status: 'running', durationMs: 0 });
    await recorder.withSpan(
      'RouteOptimizationSubAgent',
      { algorithm: 'tsp-via-google-directions', reorderedFromOriginal: String(reorderedFromOriginal) },
      async () => optimizedOrder,
      o => `${o.length} via points · ${o.filter(v => v.kind === 'refuge').length} refuges · reordered=${reorderedFromOriginal}`
    );
    const optimSummary = reorderedFromOriginal
      ? `Reordered ${optimizedOrder.length} via points (${optimizedOrder.filter(v => v.kind === 'refuge').length} refuges threaded into the route). New sequence: ${optimizedOrder.map(v => v.label).join(' → ')}.`
      : `${optimizedOrder.length} via points already in optimal order; no reorder needed.`;
    agentTrace[agentTrace.length - 1] = {
      agentName: 'RouteOptimizationSubAgent',
      status: 'success',
      durationMs: Date.now() - optimStart,
      outputSummary: optimSummary
    };

    // 6. NavigationArrowsSubAgent: Ground-anchored arrows for XR
    const navStart = Date.now();
    agentTrace.push({ agentName: 'NavigationArrowsSubAgent', status: 'running', durationMs: 0 });
    const navIdx = agentTrace.length - 1;
    const arrows = buildNavigationArrows(directionSteps, directionsPath);
    synthesis.spatial.navigationArrows = arrows;
    agentTrace[navIdx] = {
      agentName: 'NavigationArrowsSubAgent',
      status: 'success',
      durationMs: Date.now() - navStart,
      outputSummary: `Emitted ${arrows.length} ground-anchored heading arrows for the spatial XR panel (mean step ${arrows.length ? Math.round(arrows.reduce((a, b) => a + b.distanceMeters, 0) / arrows.length) : 0}m).`
    };

    // 7. SunPathSubAgent: Solar position + shade factor along route
    const sunStart = Date.now();
    agentTrace.push({ agentName: 'SunPathSubAgent', status: 'running', durationMs: 0 });
    const sunIdx = agentTrace.length - 1;
    const activityWhen = parseRequestTime(time);
    const sunSamples = buildSunSamples(directionsPath, activityWhen);
    synthesis.spatial.sunSamples = sunSamples;
    const meanShade = sunSamples.length
      ? Math.round((sunSamples.reduce((a, s) => a + s.shadeFactor, 0) / sunSamples.length) * 100)
      : 0;
    const meanElev = sunSamples.length
      ? Math.round(sunSamples.reduce((a, s) => a + s.elevationDeg, 0) / sunSamples.length)
      : 0;
    agentTrace[sunIdx] = {
      agentName: 'SunPathSubAgent',
      status: 'success',
      durationMs: Date.now() - sunStart,
      outputSummary: `Computed ${sunSamples.length} solar samples (mean elev ${meanElev}°, est. ${meanShade}% shaded). Drives XR shade overlay & rest-break siting.`
    };

    // 8. RefugeBreakSubAgent: Rest break scheduling
    const breakStart = Date.now();
    agentTrace.push({ agentName: 'RefugeBreakSubAgent', status: 'running', durationMs: 0 });
    const breakIdx = agentTrace.length - 1;

    const { workRestRatio, suggestedBreaks } = scheduleRefugeBreaks(directionsPath, synthesis.wetBulbPeakF, synthesis.flag);
    synthesis.workRestRatio = workRestRatio;
    synthesis.suggestedBreaks = suggestedBreaks;

    agentTrace[breakIdx] = {
      agentName: 'RefugeBreakSubAgent',
      status: 'success',
      durationMs: Date.now() - breakStart,
      outputSummary: `Scheduled work/rest intervals: "${workRestRatio}" with ${suggestedBreaks.length} hydration stops.`
    };

    // 9. StreetViewPanoSubAgent: First-person previews oriented to heading
    const svStart = Date.now();
    agentTrace.push({ agentName: 'StreetViewPanoSubAgent', status: 'running', durationMs: 0 });
    const svIdx = agentTrace.length - 1;
    attachStreetViewPanoramas(origin, waypoints, synthesis.coolingStops as any, suggestedBreaks);
    agentTrace[svIdx] = {
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
