import React, { useEffect, useRef, useState } from 'react';
import { SpatialData, CoolingStop } from '../lib/types';
import { MapPin, Navigation, Info, Lock } from 'lucide-react';
import { APIProvider, Map, Marker, InfoWindow } from '@vis.gl/react-google-maps';

interface MapEmbedProps {
  spatial: SpatialData;
  coolingStops: CoolingStop[];
}

// Custom hook to draw a polyline on the Google Map
function RoutePolyline({ points }: { points: Array<{ lat: number; lng: number }> }) {
  const mapRef = React.useContext((APIProvider as any)._mapContext); 
  // Safety: standard fallback if context is not exported or different version
  const map = mapRef?.map || null;

  useEffect(() => {
    if (!map || points.length < 2) return;
    const polyline = new google.maps.Polyline({
      path: points,
      geodesic: true,
      strokeColor: '#6366f1',
      strokeOpacity: 0.8,
      strokeWeight: 4,
    });
    polyline.setMap(map);
    return () => {
      polyline.setMap(null);
    };
  }, [map, points]);

  return null;
}

export function MapEmbed({ spatial, coolingStops }: MapEmbedProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const [isLeafletLoaded, setIsLeafletLoaded] = useState(false);
  const [hasMapError, setHasMapError] = useState(false);
  const [selectedStop, setSelectedStop] = useState<CoolingStop | null>(null);
  
  // Choose GIS Engine
  const gmpApiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
  const [useGoogleMaps, setUseGoogleMaps] = useState(!!gmpApiKey);

  // Sync state if Key gets added dynamically
  useEffect(() => {
    if (gmpApiKey) {
      setUseGoogleMaps(true);
    }
  }, [gmpApiKey]);

  // Dynamically load Leaflet from CDN if Google Maps key not used or user requests fallback
  useEffect(() => {
    if (useGoogleMaps) return;
    if (typeof window === 'undefined') return;

    if ((window as any).L) {
      setIsLeafletLoaded(true);
      return;
    }

    // Embed Leaflet CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
    link.crossOrigin = '';
    document.head.appendChild(link);

    // Embed Leaflet JS script
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    script.crossOrigin = '';
    script.onload = () => {
      setIsLeafletLoaded(true);
    };
    script.onerror = () => {
      console.warn('[MapEmbed] Failed to download Leaflet scripts from unpkg CDN. Using offline SVG blueprint view.');
      setHasMapError(true);
    };
    document.body.appendChild(script);
  }, [useGoogleMaps]);

  // Initialize and update the Leaflet Map
  useEffect(() => {
    if (useGoogleMaps || !isLeafletLoaded || !mapContainerRef.current || hasMapError) return;

    const L = (window as any).L;
    if (!L) return;

    // Destroy existing map instance to avoid re-initialization errors
    if (leafletMapRef.current) {
      leafletMapRef.current.remove();
      leafletMapRef.current = null;
    }

    try {
      const centerLat = spatial.origin.lat;
      const centerLng = spatial.origin.lng;

      // Create a new map instance
      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
        scrollWheelZoom: false
      }).setView([centerLat, centerLng], 13);

      leafletMapRef.current = map;

      // Add OpenStreetMap tile layers
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);

      const bounds: any[] = [];

      // Setup custom marker symbols
      const createHtmlIcon = (color: string, numberLabel?: string) => {
        return L.divIcon({
          className: 'custom-leaflet-icon',
          html: `<div style="
            background-color: ${color}; 
            width: 24px; 
            height: 24px; 
            border-radius: 50%; 
            border: 2px solid white; 
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 10px;
            font-weight: bold;
            font-family: inherit;
          ">${numberLabel || ''}</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });
      };

      // Plot Origin (Blue)
      const originIcon = createHtmlIcon('#3576df', 'O');
      L.marker([spatial.origin.lat, spatial.origin.lng], { icon: originIcon })
        .addTo(map)
        .bindPopup(`<b>Origin: ${spatial.origin.label}</b>`)
        .openPopup();
      bounds.push([spatial.origin.lat, spatial.origin.lng]);

      // Plot Waypoints (Magenta/Orange)
      spatial.waypoints.forEach((wp, index) => {
        if (!wp.lat || !wp.lng) return;
        const waypointIcon = createHtmlIcon('#f97316', `${index + 1}`);
        L.marker([wp.lat, wp.lng], { icon: waypointIcon })
          .addTo(map)
          .bindPopup(`<b>Waypoint ${index + 1}: ${wp.label}</b>`);
        bounds.push([wp.lat, wp.lng]);
      });

      // Plot Cooling Stops (Green)
      coolingStops.forEach((stop) => {
        if (!stop.lat || !stop.lng) return;
        const stopIcon = createHtmlIcon('#10b981', '✚');
        const navigateBtn = stop.mapsUri ? 
          `<div style="margin-top: 8px;"><a href="${stop.mapsUri}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 4px; background-color: #1a73e8; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold; text-decoration: none; font-size: 11px;">Navigate ↗</a></div>` : '';
        L.marker([stop.lat, stop.lng], { icon: stopIcon })
          .addTo(map)
          .bindPopup(`<b>${stop.name}</b><br/><i>Cooling Shelter</i><br/>${stop.why}${navigateBtn}`);
        bounds.push([stop.lat, stop.lng]);
      });

      // Connect with route polyline
      const routePoints = [
        [spatial.origin.lat, spatial.origin.lng],
        ...spatial.waypoints.map(wp => [wp.lat, wp.lng])
      ];
      L.polyline(routePoints, { color: '#6366f1', weight: 4, opacity: 0.8 }).addTo(map);

      // Fit map view to cover all items
      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    } catch (err) {
      console.error('[MapEmbed] Failed to render Leaflet fallback map:', err);
      setHasMapError(true);
    }
  }, [useGoogleMaps, isLeafletLoaded, spatial, coolingStops, hasMapError]);

  return (
    <div className="space-y-3">
      {/* Dynamic Header with Selection for Maps Provider */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider font-mono">
          <Navigation className="w-3.5 h-3.5 text-[#1a73e8] shrink-0" />
          {useGoogleMaps ? 'Google Maps GIS Live' : 'Open GIS Fallback'}
        </div>
        
        <div className="flex gap-1">
          {gmpApiKey ? (
            <button
              onClick={() => setUseGoogleMaps(!useGoogleMaps)}
              className="text-[9px] font-mono uppercase bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-0.5 rounded border border-slate-200 tracking-tighter"
            >
              Toggle Provider
            </button>
          ) : (
            <span className="text-[8px] font-mono uppercase text-[#b06000] bg-[#fef7e0] px-1.5 py-0.5 rounded border border-[#fde293] tracking-tighter shrink-0 flex items-center gap-0.5 font-bold">
              <Lock className="w-2 h-2" /> Google Maps Key Missing
            </span>
          )}
        </div>
      </div>

      <div className="relative border border-slate-200 rounded-xl overflow-hidden shadow-sm h-64 md:h-80 bg-slate-100 flex items-center justify-center">
        {/* Step-by-Step Instructions Panel overlay if Google Maps is expected but Key is missing */}
        {!gmpApiKey && useGoogleMaps && (
          <div className="absolute inset-0 bg-slate-50/95 z-10 flex flex-col items-center justify-center p-6 text-center">
            <Lock className="w-7 h-7 text-[#fbbc05] mb-2 animate-bounce" />
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider font-sans mb-1.5">
              Premium Google Maps Locked
            </h4>
            <p className="text-[11px] text-slate-500 max-w-xs leading-relaxed mb-4">
              Unlock real-time street views and routes. To configure:
              <br/>
              <b>1.</b> Copy your Google Maps API Key.
              <br/>
              <b>2.</b> Open AI Studio <b>Settings → Secrets</b> panel.
              <br/>
              <b>3.</b> Set the key name: <b>GOOGLE_MAPS_PLATFORM_KEY</b>.
            </p>
            <button
              onClick={() => setUseGoogleMaps(false)}
              className="px-3.5 py-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white font-bold uppercase tracking-wider text-[10px] rounded-lg shadow-sm transition-colors cursor-pointer border border-[#1a73e8]"
            >
              Use Offline Free GIS Map
            </button>
          </div>
        )}

        {/* 1. Google Maps View if Key is available */}
        {useGoogleMaps && gmpApiKey ? (
          <APIProvider apiKey={gmpApiKey}>
            <div className="w-full h-full z-0">
              <Map
                defaultCenter={{ lat: spatial.origin.lat, lng: spatial.origin.lng }}
                defaultZoom={13}
                gestureHandling="cooperative"
                disableDefaultUI={false}
                // CRITICAL SECURITY REQUIREMENT FOR GOOGLE MAPS SKILL
                internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                className="w-full h-full"
              >
                {/* Origin Marker */}
                <Marker 
                  position={{ lat: spatial.origin.lat, lng: spatial.origin.lng }} 
                  title={`[O] ${spatial.origin.label}`}
                  label="O"
                />

                {/* Waypoints */}
                {spatial.waypoints.map((wp, i) => (
                  <Marker
                    key={`wp-${i}`}
                    position={{ lat: wp.lat, lng: wp.lng }}
                    title={`Waypoint ${i + 1}: ${wp.label}`}
                    label={(i + 1).toString()}
                  />
                ))}

                {/* Cooling Stops */}
                {coolingStops.map((stop, i) => (
                  <Marker
                    key={`stop-${stop.placeId}`}
                    position={{ lat: stop.lat, lng: stop.lng }}
                    title={`[✚] ${stop.name}`}
                    label="+"
                    onClick={() => setSelectedStop(stop)}
                  />
                ))}

                {selectedStop && (
                  <InfoWindow
                    position={{ lat: selectedStop.lat, lng: selectedStop.lng }}
                    onCloseClick={() => setSelectedStop(null)}
                  >
                    <div className="p-1.5 max-w-[200px] text-slate-800 font-sans">
                      <p className="font-bold text-xs text-slate-900">{selectedStop.name}</p>
                      <p className="text-[10px] text-slate-500 mt-1 leading-snug">{selectedStop.why}</p>
                      {selectedStop.mapsUri && (
                        <div className="mt-2.5 text-right">
                          <a
                            href={selectedStop.mapsUri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 px-2 py-1 bg-[#1a73e8] text-white hover:bg-[#1557b0] text-[9px] font-bold rounded shadow-xs"
                          >
                            <span>Navigate ↗</span>
                          </a>
                        </div>
                      )}
                    </div>
                  </InfoWindow>
                )}

                {/* Direct Polyline Connection */}
                <RoutePolyline 
                  points={[
                    { lat: spatial.origin.lat, lng: spatial.origin.lng },
                    ...spatial.waypoints.map(wp => ({ lat: wp.lat, lng: wp.lng }))
                  ]}
                />
              </Map>
            </div>
          </APIProvider>
        ) : hasMapError ? (
          /* vector blueprint */
          <div className="absolute inset-0 bg-slate-50 flex flex-col items-center justify-center p-6 text-center select-none font-sans">
            <div className="absolute top-3 right-3 text-[10px] font-mono text-zinc-400 bg-zinc-200/50 px-2 py-0.5 rounded flex items-center gap-1">
              <Info className="w-3 h-3" /> CDN Offline Blueprint Mode
            </div>
            
            <svg className="w-11/12 h-44 opacity-80 text-indigo-200 max-w-[400px]" viewBox="0 0 100 50">
              <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
                <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#e2e8f0" strokeWidth="0.5"/>
              </pattern>
              <rect width="100" height="50" fill="url(#grid)" />
              
              <path d="M 20 40 Q 50 10 80 30" fill="none" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="3,1" />
              
              <circle cx="20" cy="40" r="3" fill="#3b82f6" />
              <circle cx="50" cy="15" r="3.2" fill="#ef4444" />
              <circle cx="80" cy="30" r="3" fill="#10b981" />
              
              <text x="21" y="45" fontSize="3" fontWeight="bold" fill="#1e293b">Origin: {spatial.origin.label}</text>
              <text x="51" y="22" fontSize="3" fontWeight="bold" fill="#1e293b">{spatial.waypoints[0]?.label || 'Route Point'}</text>
              <text x="71" y="36" fontSize="3" fontWeight="bold" fill="#1e293b">{spatial.waypoints[1]?.label || 'Destination'}</text>
            </svg>
            
            <p className="text-zinc-500 text-xs font-medium max-w-sm">
              Vector schematic generated from GPS: {spatial.origin.lat.toFixed(3)}, {spatial.origin.lng.toFixed(3)}. {spatial.headingNote}
            </p>
          </div>
        ) : !isLeafletLoaded ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            <div className="text-xs text-slate-400 font-mono tracking-wide">Syncing GIS layers...</div>
          </div>
        ) : (
          /* Actual interactive Leaflet Div container */
          <div ref={mapContainerRef} className="w-full h-full z-0" />
        )}
      </div>

      <div className="text-xs text-slate-500 dark:text-slate-400 font-medium leading-relaxed bg-slate-50 dark:bg-slate-900/60 p-3 rounded-lg border border-slate-100 dark:border-slate-800/60 font-mono flex items-start gap-1.5 align-middle">
        <Info className="w-4 h-4 text-[#1a73e8]/80 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-slate-700 dark:text-slate-300">Route Note:</span> {spatial.headingNote}
        </div>
      </div>
    </div>
  );
}
