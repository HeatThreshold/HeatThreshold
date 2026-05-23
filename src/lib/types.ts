export interface CoolingStop {
  name: string;
  placeId: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  why: string;
  mapsUri?: string;
}

export interface SpatialPoint {
  lat: number;
  lng: number;
  label: string;
}

export interface SpatialData {
  origin: SpatialPoint;
  waypoints: SpatialPoint[];
  headingNote: string;
}

export interface PlanOutput {
  verdict: 'go' | 'delay' | 'alternate';
  departBy: string | null;
  delayUntil: string | null;
  headline: string; // <= 80 chars
  reasoning: string; // <= 400 chars
  wetBulbPeakF: number;
  flag: 'white' | 'green' | 'yellow' | 'red' | 'black';
  coolingStops: CoolingStop[];
  spatial: SpatialData;
  envNotes: string[];
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
  groundingChunks?: any[];
  timestamp: string;
  request: {
    location: string;
    activity: string;
    time: string;
  };
}
