"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

function ConnectButton() {
  const { pending } = useFormStatus();

  return (
    <button className="button buttonOn" type="submit" disabled={pending}>
      {pending ? "Connecting..." : "Connect"}
    </button>
  );
}

export default function WifiSerialProvisioner({
  devices,
  selectedDevice,
  saveWifiAction
}) {
  const [deviceId, setDeviceId] = useState(selectedDevice);
  const [manualWifi, setManualWifi] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");

  return (
    <div className="serialProvisioner">
      <form action={saveWifiAction} className="connectDeviceForm">
        <label className="fieldGroup">
          <span className="fieldLabel">Device ID</span>
          <input
            className="input"
            name="deviceId"
            placeholder="a119c318-d7c7-41af-972d-5587e8506a43"
            value={deviceId}
            list="knownDeviceOptions"
            onChange={(event) => setDeviceId(event.target.value)}
            required
          />
          <datalist id="knownDeviceOptions">
            {devices.map((device) => (
              <option key={device.device_id} value={device.device_id}>
                {device.device_name}
              </option>
            ))}
          </datalist>
        </label>
        <label className="fieldGroup">
          <span className="fieldLabel">Name</span>
          <input
            className="input"
            name="deviceName"
            defaultValue="Meenakshi"
          />
        </label>
        <input name="deviceType" type="hidden" value="arduino" />
        <input name="boardModel" type="hidden" value="Arduino UNO R4 WiFi" />
        <input name="fqbn" type="hidden" value="arduino:renesas_uno:unor4wifi" />
        <input name="location" type="hidden" value="Greenhouse Bay A" />
        <label className="fieldGroup">
          <span className="fieldLabel">Device Secret</span>
          <input
            className="input"
            name="deviceSecret"
            defaultValue="PVs5mxEQlVoYnB2GgfS--FtH"
            required
          />
        </label>
        <label className="fieldGroup">
          <span className="fieldLabel">Serial Number</span>
          <input
            className="input"
            name="serialNumber"
            defaultValue="E072A1E0B760"
          />
        </label>
        <label className="fieldGroup">
          <span className="fieldLabel">Wi-Fi name (SSID)</span>
          <input
            className="input"
            name="manualWifi"
            placeholder="Telia-B798AC"
            value={manualWifi}
            onChange={(event) => setManualWifi(event.target.value)}
            required
          />
        </label>
        <label className="fieldGroup">
          <span className="fieldLabel">Wi-Fi password</span>
          <input
            className="input"
            name="wifiPassword"
            placeholder="Wi-Fi password"
            type="password"
            value={wifiPassword}
            onChange={(event) => setWifiPassword(event.target.value)}
            required
          />
        </label>
        <div className="connectDeviceActions">
          <ConnectButton />
        </div>
      </form>
    </div>
  );
}
