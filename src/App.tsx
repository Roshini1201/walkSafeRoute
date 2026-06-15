import { useState, useEffect, useRef } from "react";
import { 
  Navigation, 
  MapPin, 
  ShieldAlert, 
  Moon, 
  Sun, 
  Activity, 
  Info, 
  AlertCircle, 
  Compass, 
  ShieldCheck, 
  CheckCircle2, 
  Heart,
  ChevronRight,
  ExternalLink,
  Shield,
  ThumbsUp
} from "lucide-react";

// Access global Leaflet L loaded from index.html
declare let L: any;

interface MetroStation {
  name: string;
  coords: [number, number];
  description: string;
}

interface DangerZone {
  lat: number;
  lng: number;
  risk: number;
  name: string;
}

interface RouteInfo {
  distance: number; // in km
  duration: number; // in mins
  coords: [number, number][];
  score: number;
}

interface AlternativeRoute {
  coords: [number, number][];
  score: number;
  name: string;
  description: string;
  distanceMultiplier: number;
  index: number;
}

const METRO_STATIONS: MetroStation[] = [
  { name: "Raidurg Metro", coords: [17.4448, 78.3772], description: "Hitech City corridor, extensive security coverage" },
  { name: "Ameerpet Metro", coords: [17.4358, 78.4438], description: "Commercial core, heavy pedestrian density & bright streetlighting" },
  { name: "Nampally Station", coords: [17.4074, 78.4772], description: "Transit node with active police checks" },
  { name: "Hitech City Metro", coords: [17.4437, 78.3822], description: "Corporate tech belt, well-lit pedestrian pathways" },
  { name: "Charminar Area", coords: [17.3616, 78.4747], description: "Heritage market sector; contains some narrow dark alleys" },
  { name: "Secunderabad East Metro", coords: [17.4346, 78.5020], description: "Well-traveled railway interchange promenade" }
];

// Utility for Haversine distance in meters
function getDistance(coord1: [number, number], coord2: [number, number]): number {
  const R = 6371000; // Earth radius in meters
  const dLat = (coord2[0] - coord1[0]) * Math.PI / 180;
  const dLng = (coord2[1] - coord1[1]) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(coord1[0] * Math.PI / 180) * Math.cos(coord2[0] * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Score calculation based on every 3rd point of coordinates
function scoreRoute(coords: [number, number][], zones: DangerZone[]): number {
  let score = 60; // Starting base score

  for (let i = 0; i < coords.length; i += 3) {
    const point = coords[i];
    let pointPenalty = 0;

    zones.forEach(z => {
      const d = getDistance(point, [z.lat, z.lng]);
      if (d < 80) {
        pointPenalty = Math.max(pointPenalty, 40); // Within 80m: -40pts
      } else if (d < 150) {
        pointPenalty = Math.max(pointPenalty, 25); // Within 150m: -25pts
      }
    });

    score -= pointPenalty;
  }

  // Clamp final score strictly between 0 and 100
  return Math.max(0, Math.min(100, score));
}

export default function App() {
  // Theme & App State
  const [isLightMode, setIsLightMode] = useState<boolean>(false);
  const [selectedStationIndex, setSelectedStationIndex] = useState<number>(0);
  const [startCoords, setStartCoords] = useState<[number, number]>(METRO_STATIONS[0].coords);
  const [destCoords, setDestCoords] = useState<[number, number] | null>(null);
  
  // Routing Engine State
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [routeData, setRouteData] = useState<RouteInfo | null>(null);
  const [dangerZones, setDangerZones] = useState<DangerZone[]>([]);
  const [alternatives, setAlternatives] = useState<AlternativeRoute[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState<number>(0); // 0 = Fastest, 1+ = Alternatives
  const [useOverpass, setUseOverpass] = useState<boolean>(false);

  // Map element references
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  
  // Leaflet Layer References (so we can update them without reinitialization bugs)
  const startMarkerRef = useRef<any>(null);
  const destMarkerRef = useRef<any>(null);
  const polylineFastestRef = useRef<any>(null);
  const polylineSafestRef = useRef<any>(null);
  const dangerCirclesRef = useRef<any[]>([]);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    
    const L_init = (window as any).L;
    if (!L_init) return;

    if (!mapRef.current) {
      // Create Leaflet map centered at Hyderabad
      const map = L_init.map(mapContainerRef.current, {
        zoomControl: false,
        zoomAnimation: true,
        fadeAnimation: true
      }).setView(METRO_STATIONS[0].coords, 14);

      // Add custom zoom controls at bottom-right
      L_init.control.zoom({ position: "bottomright" }).addTo(map);
      mapRef.current = map;

      // Handle map clicks to set destination
      map.on("click", (e: any) => {
        const latlng = e.latlng;
        setDestCoords([latlng.lat, latlng.lng]);
      });
    }

    return () => {
      // Safe cleanup is handled on unmount if requested, but persistent app can keep map active
    };
  }, []);

  // Set up resize observer and map layout invalidators to keep Leaflet synchronized
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleResize = () => {
      map.invalidateSize();
    };

    window.addEventListener("resize", handleResize);

    // Initial resize triggering
    map.invalidateSize();
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 250);

    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timer);
    };
  }, [routeData, selectedRouteIndex]);

  // Update theme settings and basemaps dynamically
  useEffect(() => {
    const map = mapRef.current;
    const L_inst = (window as any).L;
    if (!map || !L_inst) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    // Use high-contrast CartoDB tile configurations
    const tileUrl = isLightMode
      ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

    const attr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

    tileLayerRef.current = L_inst.tileLayer(tileUrl, {
      attribution: attr,
      maxZoom: 19
    }).addTo(map);

  }, [isLightMode]);

  // Center Map on Selected Start Metro Station
  const handleStationChange = (index: number) => {
    setSelectedStationIndex(index);
    const coords = METRO_STATIONS[index].coords;
    setStartCoords(coords);
    
    // Clear route on selecting new metro node
    setDestCoords(null);
    setRouteData(null);
    setDangerZones([]);
    setAlternatives([]);
    setSelectedRouteIndex(0);

    if (mapRef.current) {
      mapRef.current.setView(coords, 15);
    }
  };

  // Generate synthetic danger zones scattered around the route
  const generateSyntheticDangerZones = (coords: [number, number][]): DangerZone[] => {
    const zones: DangerZone[] = [];
    const N = coords.length;
    if (N < 4) return [];

    // Exclude the starting 20% of path to keep metro surrounding clear
    const startIndex = Math.max(1, Math.floor(N * 0.15));
    const endIndex = N - 1;
    const numZones = 8 + Math.floor(Math.random() * 5); // 8 to 12 as requested

    const riskLabels = [
      "Overcast Laneway (No Lamp Posts)",
      "Unlit Direct Sidewalk Corridor",
      "Dimly-Lit Underpass Access",
      "Footway Lacking Lighting Assets",
      "Hedge-Sheltered Pedestrian Curve",
      "Closed Warehouse Secondary Lane",
      "Unilluminated Construction Border",
      "Dark Cut-Through Blind Alley",
      "Industrial Estate Footpath Block",
      "Unmanned High-Risk Bypass"
    ];

    for (let z = 0; z < numZones; z++) {
      // Select coordinate index along path
      const pathIdx = startIndex + Math.floor(Math.random() * (endIndex - startIndex));
      const curr = coords[pathIdx];
      const next = coords[pathIdx + 1] || coords[pathIdx - 1];

      // Perpendicular deflection vector
      const dLat = next[0] - curr[0];
      const dLng = next[1] - curr[1];
      let perpLat = -dLng;
      let perpLng = dLat;

      // Normalize perp vector
      const len = Math.sqrt(perpLat * perpLat + perpLng * perpLng);
      if (len > 0) {
        perpLat /= len;
        perpLng /= len;
      } else {
        perpLat = 1;
        perpLng = 0;
      }

      // Deflection of 100m to 400m
      const minDeg = 0.0009; // ~100m
      const maxDeg = 0.0036; // ~400m
      const distanceDeflect = minDeg + Math.random() * (maxDeg - minDeg);
      const directionSide = Math.random() < 0.5 ? 1 : -1;

      const zoneLat = curr[0] + perpLat * distanceDeflect * directionSide;
      const zoneLng = curr[1] + perpLng * distanceDeflect * directionSide;

      zones.push({
        lat: zoneLat,
        lng: zoneLng,
        risk: Math.random() < 0.5 ? 3 : 4,
        name: riskLabels[z % riskLabels.length]
      });
    }

    return zones;
  };

  // Perform Routing Calculations
  const handleFindSafeRoute = async () => {
    if (!startCoords || !destCoords) return;
    setIsGenerating(true);

    try {
      // Fetch walking route coordinates from public OSRM matching precision
      const url = `https://router.project-osrm.org/route/v1/foot/${startCoords[1]},${startCoords[0]};${destCoords[1]},${destCoords[0]}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      const data = await res.json();

      if (!data.routes || data.routes.length === 0) {
        alert("Pedestrian route could not be found between selected spots. Please select an on-road point.");
        setIsGenerating(false);
        return;
      }

      const route = data.routes[0];
      const geoCoords = route.geometry.coordinates; // [[lng, lat]]
      const fastestCoords: [number, number][] = geoCoords.map((c: any) => [c[1], c[0]]);

      const distValue = route.distance / 1000;
      const timeVal = Math.ceil(route.duration / 60);

      // STEP 1: Attempt Overpass API Query with timeout fallback
      let zonesList: DangerZone[] = [];
      let overpassLoaded = false;
      const midPoint = fastestCoords[Math.floor(fastestCoords.length / 2)];

      try {
        const query = `[out:json][timeout:5];(way["lit"="no"](around:800,${midPoint[0]},${midPoint[1]});way["highway"="footway"](around:800,${midPoint[0]},${midPoint[1]}););out center 15;`;
        const overpassRes = await fetch("https://overpass-api.de/api/interpreter", {
          method: "POST",
          body: query
        });

        if (overpassRes.ok) {
          const overpassData = await overpassRes.json();
          if (overpassData.elements && overpassData.elements.length >= 3) {
            const labelPool = [
              "Unlit Alley Connector", "Dark Footpath Area", "Dimly lit Street Intersection", 
              "Secondary road lacking lighting", "Overgrown Sidewalk segment", "Blind Turn Link"
            ];
            
            zonesList = overpassData.elements
              .filter((el: any) => el.center && el.center.lat)
              .map((el: any, i: number) => {
                const rawName = el.tags?.name || el.tags?.highway || labelPool[i % labelPool.length];
                return {
                  lat: el.center.lat,
                  lng: el.center.lon,
                  risk: el.tags?.lit === "no" ? 4 : 3,
                  name: `OSM unlit: ${rawName}`
                };
              });

            if (zonesList.length >= 4) overpassLoaded = true;
          }
        }
      } catch (overpassErr) {
        console.warn("Overpass API failed or timed out. Falling back to synthetic layout.", overpassErr);
      }

      // Fallback if Overpass yielded limited parameters
      if (!overpassLoaded) {
        setUseOverpass(false);
        zonesList = generateSyntheticDangerZones(fastestCoords);
      } else {
        setUseOverpass(true);
      }

      setDangerZones(zonesList);

      // STEP 2: Score fastest route coordinates
      const fastestScore = scoreRoute(fastestCoords, zonesList);

      // STEP 3: Generate 4-6 alternative deflection paths
      // Shift vectors representing physical pedestrian detours
      const deflections = [
        { dLat: 0.0020, dLng: 0.0020, name: "North-East Safety Loop", desc: "Loops slightly northwards through premium avenue with functional lighting" },
        { dLat: 0.0020, dLng: -0.0020, name: "North-West Well-lit Bypass", desc: "Deflects westwards toward heavily populated main security corridors" },
        { dLat: -0.0020, dLng: 0.0020, name: "South-East Commercial Detour", desc: "Arches south-east along active storefronts with neon advertising illumination" },
        { dLat: -0.0020, dLng: -0.0020, name: "South-West Residential Passage", desc: "Slightly wide loop following manned residential complex gates" },
        { dLat: 0, dLng: 0.0026, name: "Eastern Inner Security Block", desc: "Curves wide east tracking a perimeter monitored by office block cameras" },
        { dLat: 0, dLng: -0.0026, name: "Western Promenade Drive", desc: "Symmetrical detour via central road containing continuous streetlamps" }
      ];

      const computedAlternatives: AlternativeRoute[] = deflections.map((def, idx) => {
        const N = fastestCoords.length;
        
        // Sine scale shift to smoothly curve intermediate points while gluing Start & End markers
        const altPoints: [number, number][] = fastestCoords.map((coord, i) => {
          if (i === 0 || i === N - 1) return [...coord] as [number, number]; // pin start/end
          const weight = Math.sin((i / (N - 1)) * Math.PI); // peak shift at midpoint wave shape
          return [
            coord[0] + def.dLat * weight,
            coord[1] + def.dLng * weight
          ];
        });

        const altScore = scoreRoute(altPoints, zonesList);

        return {
          coords: altPoints,
          score: altScore,
          name: def.name,
          description: def.desc,
          distanceMultiplier: 1.06 + idx * 0.015,
          index: idx + 1
        };
      });

      setRouteData({
        distance: distValue,
        duration: timeVal,
        coords: fastestCoords,
        score: fastestScore
      });

      setAlternatives(computedAlternatives);

      // Fulfill requirement 7: Select safer route index automatically if one scores at least 10 points higher
      const higherScoringAlts = computedAlternatives.filter(a => a.score >= fastestScore + 10);
      if (higherScoringAlts.length > 0) {
        // Find maximum alternative score
        higherScoringAlts.sort((a, b) => b.score - a.score);
        setSelectedRouteIndex(higherScoringAlts[0].index); // select safest route option
      } else {
        setSelectedRouteIndex(0); // fallback default is fastest (or equivalent)
      }

    } catch (e) {
      console.error(e);
      alert("An unexpected error occurred during map routing. Please refresh and try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Sync Overlay Layers with active React state
  useEffect(() => {
    const map = mapRef.current;
    const L_inst = (window as any).L;
    if (!map || !L_inst) return;

    // A. Clean up old layers
    if (polylineFastestRef.current) {
      map.removeLayer(polylineFastestRef.current);
      polylineFastestRef.current = null;
    }
    if (polylineSafestRef.current) {
      map.removeLayer(polylineSafestRef.current);
      polylineSafestRef.current = null;
    }
    dangerCirclesRef.current.forEach(c => map.removeLayer(c));
    dangerCirclesRef.current = [];

    // B. Draw Start Marker
    if (startCoords) {
      if (!startMarkerRef.current) {
        const startIcon = L_inst.divIcon({
          className: "clean-start-icon",
          html: `
            <div class="relative flex items-center justify-center">
              <span class="absolute inline-flex h-6 w-6 rounded-full bg-blue-500 opacity-60 animate-ping"></span>
              <div class="relative w-5 h-5 rounded-full bg-blue-600 border-2 border-white shadow-lg flex items-center justify-center">
                <div class="w-1.5 h-1.5 rounded-full bg-white"></div>
              </div>
            </div>
          `,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });
        startMarkerRef.current = L_inst.marker(startCoords, { icon: startIcon }).addTo(map);
      } else {
        startMarkerRef.current.setLatLng(startCoords);
      }
      
      startMarkerRef.current.bindTooltip(
        `<div class="font-sans font-semibold text-gray-800 text-xs py-0.5 px-1 bg-white border border-gray-100 rounded shadow-sm">Start: ${METRO_STATIONS[selectedStationIndex].name}</div>`,
        { permanent: true, direction: "top", offset: [0, -10] }
      );
    }

    // C. Draw Destination Marker
    if (destCoords) {
      if (!destMarkerRef.current) {
        const destIcon = L_inst.divIcon({
          className: "clean-dest-icon",
          html: `
            <div class="relative flex items-center justify-center">
              <span class="absolute inline-flex h-5 w-5 rounded-full bg-rose-400 opacity-40 animate-pulse"></span>
              <div class="relative w-5 h-5 rounded-full bg-rose-500 border-2 border-white shadow-xl flex items-center justify-center">
                <div class="w-1.5 h-1.5 rounded-full bg-white"></div>
              </div>
            </div>
          `,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });
        destMarkerRef.current = L_inst.marker(destCoords, { icon: destIcon }).addTo(map);
      } else {
        destMarkerRef.current.setLatLng(destCoords);
      }

      destMarkerRef.current.bindTooltip(
        `<div class="font-sans font-semibold text-rose-700 text-xs py-0.5 px-1 bg-rose-50 border border-rose-100 rounded shadow-xs">Destination Pin</div>`,
        { permanent: true, direction: "top", offset: [0, -10] }
      );
    } else {
      if (destMarkerRef.current) {
        map.removeLayer(destMarkerRef.current);
        destMarkerRef.current = null;
      }
    }

    // D. Draw Danger Areas
    dangerZones.forEach((z) => {
      const circle = L_inst.circle([z.lat, z.lng], {
        radius: 90,
        color: "#f87171",
        fillColor: "#ef4444",
        fillOpacity: isLightMode ? 0.22 : 0.32,
        weight: 1.5,
        className: "pulsing-danger-overlay"
      }).addTo(map);

      circle.bindPopup(
        `<div class="font-sans px-2 py-1"><p class="font-bold text-red-600 text-sm flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-red-400 animate-pulse"></span>${z.name}</p><p class="text-xs text-gray-500 mt-1">High probability of dark or low foot-traffic surroundings. Pedestrians avoid.</p></div>`
      );

      dangerCirclesRef.current.push(circle);
    });

    // E. Draw Polylines based on calculated indexes
    if (routeData) {
      const isAltActive = selectedRouteIndex > 0;
      
      // Draw fastest as dashed blue line
      polylineFastestRef.current = L_inst.polyline(routeData.coords, {
        color: "#3b82f6",
        weight: selectedRouteIndex === 0 ? 5 : 3.5,
        dashArray: selectedRouteIndex === 0 ? "2, 1" : "8, 8",
        opacity: selectedRouteIndex === 0 ? 0.95 : 0.45
      }).addTo(map);

      // Draw the selected route alternative as green solid polyline
      if (isAltActive && alternatives[selectedRouteIndex - 1]) {
        const activeAlt = alternatives[selectedRouteIndex - 1];
        polylineSafestRef.current = L_inst.polyline(activeAlt.coords, {
          color: "#10b981", // vibrant emerald green
          weight: 6,
          opacity: 0.95
        }).addTo(map);
      } else {
        // If fastest is also the current safest selection, color fastest as green solid polyline
        polylineSafestRef.current = L_inst.polyline(routeData.coords, {
          color: "#10b981",
          weight: 6,
          opacity: 0.95
        }).addTo(map);
      }

      // Auto fit scope
      const boundCoords = [startCoords];
      if (destCoords) boundCoords.push(destCoords);
      
      if (isAltActive && alternatives[selectedRouteIndex - 1]) {
        // Include middle alternative point to envelope view correctly
        const alt = alternatives[selectedRouteIndex - 1];
        boundCoords.push(alt.coords[Math.floor(alt.coords.length / 2)]);
      }

      map.fitBounds(L_inst.latLngBounds(boundCoords), { padding: [50, 50] });
    }

  }, [startCoords, destCoords, dangerZones, routeData, alternatives, selectedRouteIndex, isLightMode]);

  // Extract metrics based on selected index
  const activeScore = (() => {
    if (!routeData) return 0;
    if (selectedRouteIndex === 0) return routeData.score;
    const currentAlt = alternatives[selectedRouteIndex - 1];
    return currentAlt ? currentAlt.score : routeData.score;
  })();

  const activeDistance = (() => {
    if (!routeData) return 0;
    if (selectedRouteIndex === 0) return routeData.distance;
    const currentAlt = alternatives[selectedRouteIndex - 1];
    return currentAlt ? routeData.distance * currentAlt.distanceMultiplier : routeData.distance;
  })();

  const activeDuration = (() => {
    if (!routeData) return 0;
    if (selectedRouteIndex === 0) return routeData.duration;
    const currentAlt = alternatives[selectedRouteIndex - 1];
    return currentAlt ? Math.ceil(routeData.duration * currentAlt.distanceMultiplier) : routeData.duration;
  })();

  // Contextual helper classes for Safety Levels
  const getSafetyClassification = (score: number) => {
    if (score >= 80) {
      return {
        label: "✅ Excellent Night Safety",
        desc: "Streets are well-lit with active sidewalks and security coverage. Safe local commute.",
        textColor: "text-emerald-500",
        bgColor: "bg-emerald-500/10 border-emerald-500/25",
        ringColor: "border-emerald-500 text-emerald-500",
        tips: ["Perfect for typical solo nighttime walking.", "Full sidewalk illumination intact.", "Frequent public transport stops nearby."]
      };
    } else if (score >= 50) {
      return {
        label: "⚠️ Moderate - Stay Alert",
        desc: "Mostly uncompromised, but includes isolated corners or unlit crossings near midpoint.",
        textColor: "text-amber-500",
        bgColor: "bg-amber-500/10 border-amber-500/25",
        ringColor: "border-amber-500 text-amber-500",
        tips: ["Keep earplugs out and remain highly vigilant.", "Walk briskly and avoid stationary phone calls.", "Maintain line-of-sight to commercial shopfronts."]
      };
    } else if (score >= 30) {
      return {
        label: "🔴 Avoid Nighttime Exposure",
        desc: "Multiple danger clusters detected. Streetlamps are broken or roadways lack pavements.",
        textColor: "text-orange-500",
        bgColor: "bg-orange-500/10 border-orange-500/25",
        ringColor: "border-orange-500 text-orange-500",
        tips: ["Share your live safety status link with family.", "A safety-shifted alternative route is highly recommended.", "Ignore dark alley shortcuts regardless of distance saved."]
      };
    } else {
      return {
        label: "🚨 High Risk Commute Zone",
        desc: "Extreme danger. Route intersects multiple unlit passages or isolated residential alleys.",
        textColor: "text-rose-500",
        bgColor: "bg-rose-500/10 border-rose-500/25",
        ringColor: "border-rose-500 text-rose-500",
        tips: ["Highly recommend taking local autos or Uber instead.", "Avoid walking this sector unaccompanied after 8 PM.", "Keep a mechanical personal defense alert active."]
      };
    }
  };

  const safetyInfo = getSafetyClassification(activeScore);

  // Check if a better route is present
  const holdsSaferAlternative = alternatives.some(item => item.score >= (routeData?.score || 0) + 10);

  return (
    <div className={`h-screen w-full flex flex-col lg:flex-row overflow-hidden font-sans transition-colors duration-500 ${isLightMode ? "bg-[#f8fafc] text-slate-900" : "bg-slate-950 text-slate-200"}`}>
      
      {/* Visual background atmospheric lights in dark mode */}
      {!isLightMode && (
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl pointer-events-none z-0" />
      )}

      {/* LEFT: Sidebar oriented dashboard controller (High Density Layout) */}
      <aside className={`w-full lg:w-96 shrink-0 flex flex-col h-[50vh] lg:h-full border-b lg:border-b-0 lg:border-r relative z-10 ${isLightMode ? "bg-white border-slate-200 shadow-sm" : "bg-slate-900 border-[#1e293b]"}`}>
        
        {/* Sidebar Title Header */}
        <div className={`p-5 border-b flex items-center justify-between shrink-0 ${isLightMode ? "border-slate-100" : "border-[#1e293b]"}`}>
          <div>
            <div className="flex items-center space-x-2 mb-1">
              <div className={`w-3 h-3 rounded-full ${isLightMode ? "bg-emerald-500" : "bg-emerald-500 shadow-[0_0_8px_#10b981]"}`} />
              <h1 className={`text-xl font-bold tracking-tight ${isLightMode ? "text-slate-900" : "text-white"}`}>WalkSafe Route</h1>
            </div>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-extrabold font-mono leading-none">Pedestrian Secure v2.4</p>
          </div>

          {/* Theme day/night aesthetic toggle */}
          <button 
            onClick={() => setIsLightMode(!isLightMode)}
            className={`p-2 rounded-lg transition-all border ${isLightMode ? "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100" : "bg-slate-800 border-[#1e293b] text-slate-300 hover:bg-slate-700"}`}
            title="Toggle Theme"
          >
            {isLightMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
        </div>

        {/* Scrollable controls list */}
        <div className="p-5 flex-1 overflow-y-auto space-y-5">
          
          {/* 1. START LOCATION SELECT */}
          <div className="space-y-1.5">
            <label className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider block">Starting Point</label>
            <div className="relative">
              <select 
                value={selectedStationIndex}
                onChange={(e) => handleStationChange(Number(e.target.value))}
                className={`w-full border rounded-lg py-2.5 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 appearance-none font-medium ${isLightMode ? "bg-slate-50 border-slate-200 text-slate-800" : "bg-slate-800 border-[#1e293b] text-slate-200"}`}
              >
                {METRO_STATIONS.map((st, i) => (
                  <option key={st.name} value={i}>
                    🚇 {st.name}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-[10px]">
                ▼
              </div>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 italic leading-tight">
              {METRO_STATIONS[selectedStationIndex].description}
            </p>
          </div>

          {/* 2. DESTINATION LOCK DISPLAY */}
          <div className="space-y-1.5">
            <label className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider block">Destination Pin</label>
            <div className={`border rounded-lg p-3 transition-colors ${destCoords ? (isLightMode ? "bg-rose-50/40 border-rose-100" : "bg-rose-950/20 border-rose-900/40") : (isLightMode ? "bg-slate-100/60 border-slate-200" : "bg-slate-800/40 border-[#1e293b]")}`}>
              {destCoords ? (
                <div>
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-rose-500 rounded-full animate-pulse" />
                    <span className="text-sm font-mono tracking-tight font-semibold text-rose-500">
                      {destCoords[0].toFixed(5)}, {destCoords[1].toFixed(5)}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">Commuter destination target locked.</p>
                </div>
              ) : (
                <div>
                  <div className="flex items-center space-x-1.5 text-slate-500 dark:text-slate-400">
                    <MapPin className="w-4 h-4 shrink-0 text-slate-500" />
                    <span className="text-xs font-semibold">Tether Point Missing</span>
                  </div>
                  <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5">Click any place on the map to tether your destination.</p>
                </div>
              )}
            </div>
          </div>

          {/* 3. EXECUTE CALCULATION BUTTON */}
          <button
            disabled={!destCoords || isGenerating}
            onClick={handleFindSafeRoute}
            className={`w-full py-3.5 px-4 rounded-xl font-bold text-sm tracking-wide flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95 ${!destCoords ? "bg-slate-850 text-slate-500 border border-[#1e293b]/70 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer shadow-emerald-900/10 hover:shadow-emerald-500/20"}`}
          >
            {isGenerating ? (
              <>
                <Activity className="w-4 h-4 animate-spin text-white" />
                <span className="font-mono text-xs uppercase tracking-wider">Querying lighting logs...</span>
              </>
            ) : (
              <>
                <Navigation className="w-4 h-4 text-white" />
                <span className="uppercase tracking-wider font-bold">Find Safe Route</span>
              </>
            )}
          </button>

          {/* 4. STATISTICS SUMMARY GRID */}
          {routeData && (
            <div className="grid grid-cols-2 gap-3 pt-1 animate-fade-in">
              <div className={`p-3 rounded-lg border ${isLightMode ? "bg-slate-50 border-slate-100" : "bg-slate-800/40 border-[#1e293b]"}`}>
                <p className="text-[10px] text-slate-500 uppercase font-mono">Distance</p>
                <p className="text-lg font-bold tracking-tight">
                  {activeDistance.toFixed(2)}{" "}
                  <span className="text-xs font-normal text-slate-500">km</span>
                </p>
              </div>
              <div className={`p-3 rounded-lg border ${isLightMode ? "bg-slate-50 border-slate-100" : "bg-slate-800/40 border-[#1e293b]"}`}>
                <p className="text-[10px] text-slate-500 uppercase font-mono">Walk Time</p>
                <p className="text-lg font-bold tracking-tight">
                  {activeDuration}{" "}
                  <span className="text-xs font-normal text-slate-500">min</span>
                </p>
              </div>
            </div>
          )}

          {/* 5. ACTIVE HEALTH GAUGE */}
          {routeData && (
            <div className="space-y-4">
              
              {/* Routing Tabs Selection Deck */}
              <div className={`p-1 rounded-xl flex gap-1 border ${isLightMode ? "bg-slate-100 border-slate-200" : "bg-slate-950 border-[#1e293b]"}`}>
                <button
                  onClick={() => setSelectedRouteIndex(0)}
                  className={`flex-1 py-2 px-2.5 rounded-lg text-center transition-all ${
                    selectedRouteIndex === 0
                      ? isLightMode
                        ? "bg-white text-slate-900 shadow-xs font-bold"
                        : "bg-slate-800 text-white shadow font-bold"
                      : isLightMode
                      ? "text-slate-600 hover:text-slate-950 hover:bg-white/50"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/50"
                  }`}
                >
                  <p className={`text-[10px] uppercase font-mono tracking-wider font-semibold ${selectedRouteIndex === 0 ? (isLightMode ? "text-slate-950" : "text-white") : (isLightMode ? "text-slate-600" : "text-slate-400")}`}>Fastest Path</p>
                  <p className={`text-xs mt-0.5 ${selectedRouteIndex === 0 ? (isLightMode ? "text-slate-700" : "text-slate-300") : (isLightMode ? "text-slate-500" : "text-slate-500")}`}>{routeData.score}% Safety</p>
                </button>
                <button
                  onClick={() => setSelectedRouteIndex(1)}
                  className={`flex-1 py-2 px-2.5 rounded-lg text-center transition-all relative ${
                    selectedRouteIndex === 1
                      ? isLightMode
                        ? "bg-white text-slate-900 shadow-xs font-bold"
                        : "bg-emerald-600 text-white shadow font-bold"
                      : isLightMode
                      ? "text-slate-600 hover:text-slate-950 hover:bg-white/50"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/50"
                  }`}
                >
                  <p className={`text-[10px] uppercase font-mono tracking-wider font-semibold ${selectedRouteIndex === 1 ? (isLightMode ? "text-slate-950" : "text-white") : (isLightMode ? "text-slate-600" : "text-slate-400")}`}>Safer Alternate</p>
                  <p className={`text-xs mt-0.5 ${selectedRouteIndex === 1 ? (isLightMode ? "text-emerald-700 dark:text-emerald-300" : "text-emerald-100") : (isLightMode ? "text-slate-500" : "text-slate-500")}`}>{(alternatives[0]?.score) || 60}% Safety</p>
                  {holdsSaferAlternative && (
                    <span className="absolute -top-1 right-1 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                  )}
                </button>
              </div>

              {/* The Immersive High-Density Safety Rating Card */}
              <div className={`p-4 rounded-xl border relative overflow-hidden transition-all ${isLightMode ? "bg-slate-50 border-slate-200/80" : "bg-slate-800/80 border-[#1e293b]"}`}>
                <div className="flex justify-between items-end mb-2">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Safety Score</p>
                    <p className={`text-4xl font-black mt-0.5 tracking-tighter ${activeScore >= 80 ? "text-emerald-400" : activeScore >= 50 ? "text-amber-400" : "text-rose-500"}`}>
                      {activeScore}%
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`text-[10px] px-2 py-1 rounded-full font-extrabold uppercase tracking-tight border ${activeScore >= 80 ? "bg-emerald-400/10 text-emerald-400 border-emerald-400/20" : activeScore >= 50 ? "bg-amber-400/10 text-amber-400 border-amber-400/20" : "bg-rose-500/10 text-rose-500 border-rose-500/20"}`}>
                      {activeScore >= 80 ? "Very Safe" : activeScore >= 50 ? "Moderate" : "High Risk"}
                    </span>
                  </div>
                </div>

                <p className={`text-xs leading-relaxed mt-2 ${isLightMode ? "text-slate-700 font-medium" : "text-slate-300"}`}>
                  {selectedRouteIndex === 1 ? (
                    <span>🌲 Safer alternative route shifts coords to prioritize illuminated paths and avoid unlit hazards.</span>
                  ) : (
                    <span>⚡ OSRM computed fastest walking line. Intersects some dark pedestrian segments.</span>
                  )}
                </p>

                {/* Ambient bottom score bar representing progress directly on the container */}
                <div 
                  className={`absolute bottom-0 left-0 h-1 transition-all duration-700 ${activeScore >= 80 ? "bg-emerald-500" : activeScore >= 50 ? "bg-amber-500" : "bg-rose-500"}`} 
                  style={{ width: `${activeScore}%` }} 
                />
              </div>

              {/* 6. AVOIDED DANGER ZONES DIRECTORY */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider">Hazard Intersections Avoided</label>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 bg-rose-500/10 border border-rose-500/20 rounded text-rose-500 font-bold">
                    {dangerZones.length} unlit nodes
                  </span>
                </div>
                
                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 font-mono">
                  {dangerZones.slice(0, 5).map((z, idx) => {
                    const currentCoords = selectedRouteIndex === 0 ? routeData.coords : (alternatives[selectedRouteIndex - 1]?.coords || routeData.coords);
                    let minD = 9999;
                    currentCoords.forEach(pt => {
                      const d = getDistance(pt, [z.lat, z.lng]);
                      if (d < minD) minD = d;
                    });
                    const isCritical = minD < 100;

                    return (
                      <div 
                        key={idx} 
                        className={`p-2.5 rounded border text-[10px] flex justify-between items-center ${isCritical ? (isLightMode ? "bg-rose-50 border-rose-100" : "bg-rose-950/15 border-rose-900/20") : (isLightMode ? "bg-slate-100/70 border-slate-200/50" : "bg-slate-800/20 border-[#1e293b]/50")}`}
                      >
                        <div className="truncate pr-2">
                          <p className={`font-semibold truncate ${isLightMode ? "text-slate-800" : "text-slate-300"}`}>
                            ⚠️ {z.name}
                          </p>
                        </div>
                        <span className={`shrink-0 font-bold ${isCritical ? "text-rose-500" : "text-slate-500"}`}>
                          {Math.round(minD)}m
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 7. WALKSAFE GUIDELINES ADAPTIVE INSTRUCTIONS */}
              <div className={`p-3.5 rounded-lg border text-xs leading-relaxed ${isLightMode ? "bg-slate-50 border-slate-100" : "bg-[#0b1329]/50 border-slate-800"}`}>
                <div className="font-semibold text-slate-400 text-[10px] uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Heart className="w-3.5 h-3.5 text-rose-500 animate-pulse" /> Safety Action Plan
                </div>
                <ul className="space-y-1.5 text-slate-400">
                  {safetyInfo.tips.map((tip, tIdx) => (
                    <li key={tIdx} className="flex gap-2 items-start text-[11px]">
                      <span className="text-emerald-500 font-extrabold">✓</span>
                      <span className={isLightMode ? "text-slate-700" : "text-slate-300"}>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>

            </div>
          )}

          {/* INITIAL AWAITING CARD */}
          {!routeData && (
            <div className={`p-5 rounded-xl border text-center ${isLightMode ? "bg-slate-50 border-slate-200/70" : "bg-slate-900/40 border-[#1e293b]"}`}>
              <ShieldCheck className="w-8 h-8 text-slate-500 mx-auto mb-3 animate-pulse" />
              <h3 className="text-xs font-extrabold uppercase tracking-widest mb-1.5">No Route Active</h3>
              <p className="text-[11px] text-slate-500 leading-relaxed max-w-sm mx-auto">
                Tether a point on the interactive right map canvas, then hit Find Safe Route to pull dynamic ambient streetlighting logs.
              </p>
              
              <div className="mt-4 grid grid-cols-2 gap-2 text-left font-mono">
                <div className="p-2 border border-slate-800/10 bg-white/5 rounded">
                  <p className="text-[9px] text-slate-500 uppercase">Lit Priority</p>
                  <p className="text-[10px] mt-0.5 truncate text-slate-300">Avoiding dark areas</p>
                </div>
                <div className="p-2 border border-slate-800/10 bg-white/5 rounded">
                  <p className="text-[9px] text-slate-500 uppercase">Alternate loop</p>
                  <p className="text-[10px] mt-0.5 truncate text-slate-300">Detour calculation</p>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer info strip at bottom of sidebar */}
        <div className={`p-4 border-t text-[10px] text-slate-500 font-bold uppercase tracking-wider font-mono flex justify-between shrink-0 ${isLightMode ? "bg-slate-50 border-slate-200" : "bg-slate-950/40 border-[#1e293b]"}`}>
          <span>PWA Ready</span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            OSM Loaded
          </span>
        </div>
      </aside>

      {/* RIGHT: High-Fidelity Leaflet Map Stage with Radial Grid and HUD overlay */}
      <main className="flex-1 relative h-[50vh] lg:h-full bg-slate-950 overflow-hidden flex flex-col">
        
        {/* Abstract design radial grid overlay (High Density Theme Vibe!) */}
        <div className="absolute inset-0 opacity-[0.06] pointer-events-none z-10" style={{ backgroundImage: "radial-gradient(#ffffff 1px, transparent 1px)", backgroundSize: "45px 45px" }} />
        
        {/* Leaflet Map Frame */}
        <div 
          id="map" 
          ref={mapContainerRef} 
          className="w-full h-full flex-1 relative z-0"
        />

        {/* Floating Custom HUD overlays */}
        <div className="absolute top-4 left-4 z-40 flex flex-col gap-2 pointer-events-none">
          
          <div className="bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-800 text-white text-[10px] font-bold uppercase tracking-wider font-mono flex items-center gap-2 shadow-xl">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
            </span>
            <span>OSM Active Sandbox Terminal</span>
          </div>

          {routeData && (
            <div className="bg-[#10b981]/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-emerald-500/20 text-white text-[10px] font-bold uppercase tracking-wider font-mono flex items-center gap-2 shadow-xl">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Safe Alternatives Active</span>
            </div>
          )}

        </div>

        {/* Floating commuter help box if destination is missing */}
        {!destCoords && (
          <div className="absolute bottom-6 left-6 right-6 md:right-auto md:max-w-xs z-40 p-4 bg-slate-900/95 backdrop-blur-md text-white rounded-xl border border-slate-800 flex gap-3 shadow-2xl items-start">
            <div className="p-2 rounded-lg bg-yellow-500/10 text-yellow-500 shrink-0 mt-0.5">
              <AlertCircle className="w-4 h-4 animate-bounce" />
            </div>
            <div className="font-sans text-xs">
              <p className="font-bold text-yellow-400 leading-none mb-1">Tether Coordinates Wanted</p>
              <p className="text-[11px] text-slate-300 leading-normal">
                Click any coordinate on the map pane to set the endpoint sidewalk, then launch calculation.
              </p>
            </div>
          </div>
        )}

        {/* HUD bottom Legend panel */}
        <div className="absolute bottom-4 right-4 z-40 bg-slate-900/90 backdrop-blur-md p-3 rounded-xl border border-slate-800/80 shadow-2xl flex flex-col sm:flex-row sm:items-center gap-4 text-[10px] font-mono uppercase tracking-wide text-slate-300 pointer-events-auto">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-1 bg-blue-500 block rounded" />
            <span className="text-[10px] font-bold text-slate-400">Fastest (OSRM)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-1 bg-emerald-500 block rounded" />
            <span className="text-[10px] font-bold text-slate-400">Safe Loop</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500/25 border border-red-500/50 block" />
            <span className="text-[10px] font-bold text-slate-400">Unlit Hazard Zone</span>
          </div>
        </div>

      </main>

    </div>
  );
}
