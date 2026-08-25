import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, LngLatBoundsLike, Map } from "maplibre-gl";
import type { RouteSpeedPoint } from "../../shared/contracts";
import { buildSpeedRoutes } from "../lib/routeSpeed";

interface RouteMapProps {
  routes: Array<Array<[number, number]>>;
  heatCells?: Array<{ longitude: number; latitude: number; visits: number }>;
  activePoint?: [number, number] | null;
  speedRoutes?: RouteSpeedPoint[][];
  averageSpeeds?: Array<number | null>;
  compact?: boolean;
}

const EMPTY_HEAT_CELLS: NonNullable<RouteMapProps["heatCells"]> = [];

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
      paint: {
        "raster-saturation": -0.1,
        "raster-contrast": 0.16,
        "raster-brightness-min": 0.02,
        "raster-brightness-max": 0.86,
      },
    },
  ],
};

export function RouteMap({ routes, heatCells = EMPTY_HEAT_CELLS, activePoint, speedRoutes, averageSpeeds, compact = false }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const speedData = speedRoutes ? buildSpeedRoutes(speedRoutes, averageSpeeds) : null;

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
          features: speedData
            ? speedData.segments.map((segment, index) => ({
                type: "Feature" as const,
                properties: { index, speedMps: segment.speedMps ?? -1 },
                geometry: { type: "LineString" as const, coordinates: segment.coordinates },
              }))
            : routes.map((coordinates, index) => ({
                type: "Feature" as const,
                properties: { index },
                geometry: { type: "LineString" as const, coordinates },
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
        paint: {
          "line-color": speedData?.range
            ? [
                "case",
                ["<", ["get", "speedMps"], 0],
                "#0788c2",
                [
                  "interpolate", ["linear"], ["get", "speedMps"],
                  speedData.range.low, "#2586d9",
                  (speedData.range.low + speedData.range.high) / 2, "#d6e22e",
                  speedData.range.high, "#ff6659",
                ],
              ]
            : "#0788c2",
          "line-width": compact ? 3 : 4,
          "line-opacity": 1,
        },
      });
      map.addSource("active-point", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: activePoint
            ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: activePoint } }]
            : [],
        },
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
  }, [averageSpeeds, compact, heatCells, routes, speedRoutes]);

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

  return (
    <div className={`route-map-shell ${compact ? "route-map-shell--compact" : ""}`}>
      <div className={`route-map ${compact ? "route-map--compact" : ""}`} ref={containerRef} />
      {speedData?.range && (
        <div className="speed-legend" aria-label="Escala de velocidad de la ruta">
          <span><b>Lento</b>{Math.round(speedData.range.low * 3.6)} km/h</span>
          <i aria-hidden="true" />
          <span><b>Rápido</b>{Math.round(speedData.range.high * 3.6)} km/h</span>
        </div>
      )}
    </div>
  );
}
