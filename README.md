# WalkSafe Route - Pedestrian Safety Navigation

A pedestrian safety navigation web application built with **React, Vite, and Tailwind CSS (v4)**, designed specifically for late-night commuters, women, and transit users. It empowers pedestrians by calculating the safest walking paths from metropolitan transit hubs to local destination nodes, mapping unlit roadways and offering a dynamic alternate route selection system.

---

## 🚀 Key Functional Modules

1. **Illuminated Map Overlay (Leaflet.js)**:
   - Centered on major metropolitan transit points.
   - Dual aesthetic modes: **Night Safety Mode** (using CartoDB Dark Matter tiles, perfect for high-contrast nighttime commuting) and **Daylight Sandboxing** (using CartoDB Positron tiles).

2. **Smart Destination Lock-On**:
   - Commuters can click anywhere on the interactive map surface to drop a custom pinpoint marker which instantly updates the destination coordinates.

3. **Multi-Route Analysis Engine**:
   - Queries the public OpenStreetMap Routing Machine (OSRM) for the optimal direct pedestrian walking pathway.
   - Renders the path as a custom glowing blue dashed vector overlay.

4. **OSM Overpass API & Fallback Scanner**:
   - Performs query-scans of nearby unlit lanes or footway segments.
   - Contains a robust smart perpendicular-deflection fallback algorithm to scatter **8–12 synthetic danger zones** (radius of ~90m) if external API latency spikes occur.

5. **Advanced Detour Projector (Alternative Routing)**:
   - Projects **6 organic detour loop vectors** applying sinusoidal physics curves that clamp the Start Metro and Destination Pins while smoothly bowing intermediate paths around mid-corridor hazard zones.
   - Evaluates alternative ratings; if one scores at least 10 points higher, users are presented with a vibrant emerald-green path.

6. **Commuter Dashboard Panels**:
   - Displays real-time metrics (Distance, Duration, Safety Ratings).
   - Horizontal sliding tab panels to toggle immediately between the **Fastest Path** and **Alternate Loop** options.
   - Lists nearby unlit hazards with precise distance markers.
   - Highlights safety checklist steps customized based on score levels.

7. **PWA Offline Shell**:
   - Registers a service worker (`/sw.js`) and manifests custom system icons (`/public/manifest.json`), empowering standalone mobile installation and offline functionality.
