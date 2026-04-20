"use client";

import { useFormStatus } from "react-dom";

export default function LedToggleButton({ isOn }) {
  const { pending } = useFormStatus();

  return (
    <button
      className={`button ${isOn ? "buttonOff" : "buttonOn"}`}
      type="submit"
      disabled={pending}
    >
      {pending ? "Sending..." : isOn ? "Turn LED Off" : "Turn LED On"}
    </button>
  );
}
