import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, LngLatBoundsLike, Map } from "maplibre-gl";

interface RouteMapProps {
  routes: Array<Array<[number, number]>>;
  heatCells?: Array<{ longitude: number; latitude: number; visits: number }>;
  activePoint?: [number, number] | null;
  compact?: boolean;
}

const style: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    { id: "paper", type: "background", paint: { "background-color": "#dfe8e8" } },
    {
      id: "osm",
      type: "raster",
      source: "osm",
      paint: { "raster-saturation": -0.65, "raster-contrast": -0.08, "raster-brightness-max": 0.92 },
    },
  ],
};

export function RouteMap({ routes, heatCells = [], activePoint, compact = false }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: [-3.7, 40.4],
      zoom: 5,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    if (!compact) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("heat-cells", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: heatCells.map((cell) => ({ type: "Feature", properties: { visits: cell.visits }, geometry: { type: "Point", coordinates: [cell.longitude, cell.latitude] } })),
        },
      });
      map.addLayer({
        id: "heat-cells",
        source: "heat-cells",
        type: "heatmap",
        maxzoom: 16,
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "visits"], 1, 0.25, 8, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 7, 0.7, 15, 2.2],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 7, 6, 15, 22],
          "heatmap-opacity": 0.8,
          "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(39,168,223,0)", 0.25, "rgba(39,168,223,.45)", 0.62, "#27a8df", 1, "#d6e22e"],
        },
      });
      map.addSource("routes", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: routes.map((coordinates, index) => ({
            type: "Feature",
            properties: { index },
            geometry: { type: "LineString", coordinates },
          })),
        },
      });
      map.addLayer({
        id: "route-shadow",
        source: "routes",
        type: "line",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#f8fbfb", "line-width": compact ? 6 : 8, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "route-line",
        source: "routes",
        type: "line",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#146c94", "line-width": compact ? 3 : 4, "line-opacity": 0.95 },
      });
      map.addSource("active-point", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "active-point",
        source: "active-point",
        type: "circle",
        paint: {
          "circle-radius": 7,
          "circle-color": "#d6e22e",
          "circle-stroke-color": "#1e2428",
          "circle-stroke-width": 3,
        },
      });
      const coordinates = [...routes.flat(), ...heatCells.map((cell) => [cell.longitude, cell.latitude] as [number, number])];
      if (coordinates.length) {
        const bounds = coordinates.reduce(
          (value, coordinate) => value.extend(coordinate),
          new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
        );
        map.fitBounds(bounds as LngLatBoundsLike, { padding: compact ? 28 : 48, duration: 0, maxZoom: 15 });
      }
    });
    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, [compact, heatCells, routes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    const source = map.getSource("active-point") as GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: activePoint
        ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: activePoint } }]
        : [],
    });
  }, [activePoint]);

  return <div className={`route-map ${compact ? "route-map--compact" : ""}`} ref={containerRef} />;
}
