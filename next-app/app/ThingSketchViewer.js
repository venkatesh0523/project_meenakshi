"use client";

import { useState } from "react";

export default function ThingSketchViewer({ file }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(file?.content || "");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      setCopied(false);
    }
  }

  if (!file) {
    return null;
  }

  return (
    <div className="thingSketchViewer">
      <div className="thingSketchToolbar">
        <div className="thingSketchToolbarCopy">
          <strong>{file.label}</strong>
          <span>Copy this file, paste it into Arduino IDE, then upload from the IDE.</span>
        </div>
        <button className="button buttonGhost" type="button" onClick={handleCopy}>
          {copied ? "Copied" : "Copy Code"}
        </button>
      </div>
      <pre className="thingSketchCode">
        <code>{file.content}</code>
      </pre>
    </div>
  );
}
