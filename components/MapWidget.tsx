"use client";

import { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

interface MapWidgetProps {
  location: string;
  handState: { x: number; y: number; mode: string; hands: number };
}

function MapController({ handState, bounds }: { handState: MapWidgetProps["handState"], bounds: L.LatLngBounds | null }) {
  const map = useMap();

  useEffect(() => {
    // Invalidate size to ensure all tiles render once the holographic container expands
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 250);

    if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }

    return () => clearTimeout(timer);
  }, [bounds, map]);

  useEffect(() => {
    let velocityX = 0;
    let velocityY = 0;
    let velocityZoom = 0;
    let rAF: number;
    const DAMPING = 0.85;

    const onPan = (e: any) => {
      const { dx, dy } = e.detail;
      velocityX -= dx * 80;
      velocityY -= dy * 80;
    };

    const onZoom = (e: any) => {
      const { factor } = e.detail;
      if (factor < 0.95) velocityZoom += 0.08;
      else if (factor > 1.05) velocityZoom -= 0.08;
    };

    const loop = () => {
      if (Math.abs(velocityX) > 0.5 || Math.abs(velocityY) > 0.5) {
        map.panBy([velocityX, velocityY], { animate: false });
      }
      
      if (Math.abs(velocityZoom) > 0.005) {
        map.setZoom(map.getZoom() + velocityZoom, { animate: false });
      }

      velocityX *= DAMPING;
      velocityY *= DAMPING;
      velocityZoom *= DAMPING;

      rAF = requestAnimationFrame(loop);
    };

    loop();

    window.addEventListener("map-pan", onPan);
    window.addEventListener("map-zoom", onZoom);

    return () => {
      cancelAnimationFrame(rAF);
      window.removeEventListener("map-pan", onPan);
      window.removeEventListener("map-zoom", onZoom);
    };
  }, [map]);

  return null;
}

export default function MapWidget({ location, handState }: MapWidgetProps) {
  const [startCoords, setStartCoords] = useState<[number, number] | null>(null);
  const [endCoords, setEndCoords] = useState<[number, number] | null>(null);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [bounds, setBounds] = useState<L.LatLngBounds | null>(null);

  useEffect(() => {
    // Configure default leaflet marker icons safely on client
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
      iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
      shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
    });
  }, []);

  useEffect(() => {
    const geocode = async (query: string): Promise<[number, number]> => {
      try {
        const res = await fetch(`/api/geocode?query=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          if (data && typeof data.lat === "number" && typeof data.lon === "number") {
            return [data.lat, data.lon];
          }
        }
      } catch (err) {
        console.warn("Geocoding failed, using Mohali fallback", err);
      }
      return [30.7046, 76.7179]; // Mohali baseline
    };

    const fetchRoute = async (start: [number, number], end: [number, number]) => {
      try {
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`);
        const data = await res.json();
        if (data && data.routes && data.routes.length > 0) {
          const coords = data.routes[0].geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]);
          setRouteCoords(coords);
          
          const latLngs = coords.map((c: [number, number]) => L.latLng(c[0], c[1]));
          setBounds(L.latLngBounds(latLngs));
          return;
        }
      } catch (e) {
        console.warn("Routing unavailable:", e);
      }

      // If driving route not found (cross-sea or OSRM unavailable), direct line & fit bounds
      setRouteCoords([start, end]);
      setBounds(L.latLngBounds([L.latLng(start[0], start[1]), L.latLng(end[0], end[1])]));
    };

    const initializeMap = async () => {
      try {
        let start: [number, number] = [30.7046, 76.7179]; // Mohali baseline
        const end = await geocode(location);
        setEndCoords(end);

        if ("geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(
            async (pos) => {
              start = [pos.coords.latitude, pos.coords.longitude];
              setStartCoords(start);
              fetchRoute(start, end);
            },
            () => {
              setStartCoords(start);
              fetchRoute(start, end);
            },
            { timeout: 2000, maximumAge: 60000 }
          );
        } else {
          setStartCoords(start);
          fetchRoute(start, end);
        }
      } catch (e) {
        console.error("Map initialization error:", e);
        setStartCoords([30.7046, 76.7179]);
        setEndCoords([30.7046, 76.7179]);
      }
    };

    initializeMap();
  }, [location]);

  if (error) {
    return <div className="holographic-map-error">SYSTEM ERROR: {error.toUpperCase()}</div>;
  }

  if (!startCoords || !endCoords) {
    return <div className="holographic-map-loading">SATELLITE LINK ESTABLISHING...</div>;
  }

  return (
    <div className="holographic-map-container">
      <div className="holographic-map-overlay"></div>
      <MapContainer 
        center={endCoords} 
        zoom={13} 
        zoomSnap={0.1}
        zoomDelta={0.1}
        style={{ height: "100%", width: "100%", background: "#000" }} 
        zoomControl={false} 
        attributionControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <Marker position={startCoords}>
          <Popup>YOUR LOCATION</Popup>
        </Marker>
        <Marker position={endCoords}>
          <Popup>{location.toUpperCase()}</Popup>
        </Marker>
        {routeCoords.length > 0 && (
          <Polyline positions={routeCoords} color="#ff5500" weight={4} opacity={0.8} dashArray="10, 10" />
        )}
        <MapController handState={handState} bounds={bounds} />
      </MapContainer>
    </div>
  );
}
