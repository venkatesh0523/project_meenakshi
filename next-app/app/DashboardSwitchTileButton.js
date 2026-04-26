"use client";

import { useFormStatus } from "react-dom";

export default function DashboardSwitchTileButton({ isOn }) {
  const { pending } = useFormStatus();

  return (
    <button
      className={`dashboardSwitchButton ${isOn ? "dashboardSwitchButtonOn" : ""}`}
      type="submit"
      disabled={pending}
      aria-pressed={isOn}
    >
      <span className="dashboardSwitchButtonLabel">{pending ? "Updating..." : isOn ? "ON" : "OFF"}</span>
      <span className="dashboardSwitchButtonKnob" />
    </button>
  );
}
