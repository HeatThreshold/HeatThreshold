export interface CoolingStop {
  name: string;
  placeId: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  why: string;
  mapsUri?: string;
  streetViewUri?: string;
}

export interface SpatialPoint {
  lat: number;
  lng: number;
  label: string;
  streetViewUri?: string;
  /** Compass heading (deg) to look toward when entering this point in first-person */
  heading?: number;
}

/**
 * One ground-anchored navigation arrow emitted by NavigationArrowsSubAgent.
 * The XR scene projects these onto the floor at the user's local frame and
 * orients them along `bearingDeg` (true north = 0, clockwise).
 */
export interface NavigationArrow {
  lat: number;
  lng: number;
  /** Bearing from this anchor toward the next step, 0-360 (true north). */
  bearingDeg: number;
  /** Distance in meters until the next maneuver (used for "in 80m" labels). */
  distanceMeters: number;
  /** Short turn-by-turn instruction stripped of HTML. */
  instruction: string;
  /** 'straight' | 'left' | 'right' | 'sharp-left' | 'sharp-right' | 'slight-left' | 'slight-right' | 'uturn' | 'arrive'. */
  maneuver: string;
}

/**
 * Sun position sample along the route at the planned activity time, used by
 * SunPathSubAgent and rendered as shaded vs exposed segments in XR.
 */
export interface SunSample {
  lat: number;
  lng: number;
  /** Solar azimuth in deg, 0=N, 90=E, 180=S, 270=W. */
  azimuthDeg: number;
  /** Solar elevation in deg above horizon (<0 = night). */
  elevationDeg: number;
  /** Fraction of segment estimated to be shaded (0=fully exposed, 1=fully shaded). */
  shadeFactor: number;
}

export interface SpatialData {
  origin: SpatialPoint;
  waypoints: SpatialPoint[];
  headingNote: string;
  directionsPath?: Array<{ lat: number; lng: number }>;
  navigationArrows?: NavigationArrow[];
  sunSamples?: SunSample[];
}

export interface SuggestedBreak {
  lat: number;
  lng: number;
  label: string;
  timeOffsetMinutes: number;
  durationMinutes: number;
  type: 'water' | 'shade' | 'rest';
  streetViewUri?: string;
}

export interface PlanOutput {
  verdict: 'go' | 'delay' | 'alternate';
  departBy: string | null;
  delayUntil: string | null;
  headline: string;
  reasoning: string;
  wetBulbPeakF: number;
  flag: 'white' | 'green' | 'yellow' | 'red' | 'black';
  coolingStops: CoolingStop[];
  spatial: SpatialData;
  envNotes: string[];
  workRestRatio?: string;
  suggestedBreaks?: SuggestedBreak[];
}


export interface AgentTraceItem {
  agentName: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  durationMs: number;
  outputSummary?: string;
}

export interface PlanResult extends PlanOutput {
  id?: string;
  agentTrace: AgentTraceItem[];
  /** PlatAtlas span tree recorded for the run (used by /trace/:runId). */
  traceSpans?: unknown;
  /** When this PlanResult was served from a McpTape recording, the runId. */
  replayedFrom?: string;
  groundingChunks?: any[];
  /**
   * Maps Imagery Grounding widget token from the PlaceSubAgent interaction.
   * The dashboard renders a Google Maps widget anchored to this token, which
   * paints Street View + place photos + reviews for the exact refuges the
   * model referenced. See https://mapsplatform.google.com/maps-products/grounding/
   */
  mapsWidgetContextToken?: string | null;
  timestamp: string;
  request: {
    location: string;
    activity: string;
    time: string;
  };
}
