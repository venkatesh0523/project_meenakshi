"use client";

import { useEffect, useState } from "react";
import DashboardSwitchTileButton from "./DashboardSwitchTileButton";

function formatDeviceDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

function normalizeVariableType(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (normalized === "bool") {
    return "boolean";
  }

  if (normalized === "integer") {
    return "int";
  }

  if (["boolean", "int", "string"].includes(normalized)) {
    return normalized;
  }

  return "boolean";
}

function formatVariableValue(value) {
  return value ? "true" : "false";
}

function formatDashboardTileValue(tile) {
  const variableType = normalizeVariableType(tile?.variable_type);

  if (variableType === "int") {
    return tile?.current_value_text || "0";
  }

  if (variableType === "string") {
    return tile?.current_value_text || "-";
  }

  return formatVariableValue(Boolean(tile?.current_value));
}

export default function DashboardLiveBoard({ dashboardId, initialTiles }) {
  const [tiles, setTiles] = useState(Array.isArray(initialTiles) ? initialTiles : []);

  useEffect(() => {
    setTiles(Array.isArray(initialTiles) ? initialTiles : []);
  }, [initialTiles]);

  useEffect(() => {
    let cancelled = false;

    async function refreshTiles() {
      try {
        const response = await fetch(`/api/dashboards/${dashboardId}/live`, {
          cache: "no-store"
        });

        if (!response.ok) {
          return;
        }

        const body = await response.json();
        if (!cancelled && Array.isArray(body?.tiles)) {
          setTiles(body.tiles);
        }
      } catch (error) {
        // Keep the last known tile state when refresh fails.
      }
    }

    refreshTiles();
    const intervalId = setInterval(refreshTiles, 500);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [dashboardId]);

  if (!tiles.length) {
    return (
      <div className="historyCard dashboardEmptyBoard">
        <strong>No tiles yet</strong>
        <p className="sectionCopy">Click Add and choose a widget to place it on the dashboard.</p>
      </div>
    );
  }

  return tiles.map((tile) => (
    <article className={`dashboardCanvasTile dashboardCanvasTile${tile.tile_type}`} key={tile.id}>
      <div className="dashboardCanvasTileHead">
        <strong>{String(tile.tile_type || "").replace(/_/g, " ")}</strong>
        <span className="dashboardCanvasExample">Live</span>
      </div>

      <div className="dashboardCanvasTileBody">
        {tile.tile_type === "switch" ? (
          <div className="dashboardSwitchForm">
            <DashboardSwitchTileButton
              isOn={Boolean(tile.current_value)}
              dashboardId={dashboardId}
              tileId={tile.id}
            />
          </div>
        ) : null}

        {tile.tile_type === "status" ? (
          <div className="dashboardStatusPreview">{tile.current_value ? "ON" : "OFF"}</div>
        ) : null}

        {tile.tile_type === "button" ? (
          <div className="dashboardButtonPreview">
            <span />
          </div>
        ) : null}

        {tile.tile_type === "value_display" ? (
          <div className="dashboardValuePreview">
            <strong>{formatDashboardTileValue(tile)}</strong>
            <span>{tile.variable_name || "Value"}</span>
          </div>
        ) : null}

        {tile.tile_type === "led" ? (
          <div className="dashboardLedPreview">
            <span className={`dashboardLedBulb ${tile.current_value ? "dashboardLedBulbOn" : ""}`} />
            <strong>{tile.current_value ? "LED ON" : "LED OFF"}</strong>
          </div>
        ) : null}

        {tile.tile_type === "sidebar" ? (
          <div className="dashboardSidebarPreview">
            <strong>{tile.tile_name}</strong>
            <span>{tile.variable_name || "Linked variable"}</span>
          </div>
        ) : null}

        {!["switch", "status", "button", "value_display", "led", "sidebar"].includes(tile.tile_type) ? (
          <div className="dashboardGenericPreview">
            <strong>{tile.tile_name}</strong>
          </div>
        ) : null}
      </div>

      <div className="dashboardCanvasTileMeta dashboardCanvasTileMetaView">
        <span>{tile.variable_name || "Linked variable"}</span>
        <strong>{formatDeviceDate(tile.current_value_updated_at || tile.updated_at)}</strong>
      </div>
    </article>
  ));
}
