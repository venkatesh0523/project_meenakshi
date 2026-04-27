"use client";

import { useState, useTransition } from "react";

export default function DashboardSwitchTileButton({ isOn, dashboardId, tileId }) {
  const [currentValue, setCurrentValue] = useState(isOn);
  const [isPending, startTransition] = useTransition();

  async function handleToggle() {
    const nextValue = !currentValue;
    setCurrentValue(nextValue);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/dashboard-tiles/${tileId}/toggle`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            dashboardId,
            nextValue
          })
        });

        if (!response.ok) {
          setCurrentValue(!nextValue);
          return;
        }

        const body = await response.json();
        setCurrentValue(Boolean(body?.currentValue));
      } catch (error) {
        setCurrentValue(!nextValue);
      }
    });
  }

  return (
    <button
      className={`dashboardSwitchButton ${currentValue ? "dashboardSwitchButtonOn" : ""}`}
      type="button"
      disabled={isPending}
      aria-pressed={currentValue}
      onClick={handleToggle}
    >
      <span className="dashboardSwitchButtonLabel">{isPending ? "Updating..." : currentValue ? "ON" : "OFF"}</span>
      <span className="dashboardSwitchButtonKnob" />
    </button>
  );
}
