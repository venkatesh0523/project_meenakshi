"use client";

import { useEffect, useMemo, useState } from "react";

function parseSerialJson(line) {
  try {
    return JSON.parse(line);
  } catch (error) {
    return null;
  }
}

export default function WifiSerialProvisioner({
  devices,
  knownWifiNetworks,
  selectedDevice,
  saveWifiAction
}) {
  const [port, setPort] = useState(null);
  const [networks, setNetworks] = useState([]);
  const [manualWifi, setManualWifi] = useState("");
  const [selectedWifi, setSelectedWifi] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [status, setStatus] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [isSavingToBoard, setIsSavingToBoard] = useState(false);
  const [serialSupported, setSerialSupported] = useState(false);

  useEffect(() => {
    setSerialSupported("serial" in navigator);
  }, []);
  const wifiChoices = useMemo(() => {
    const choices = new Map();

    knownWifiNetworks.forEach((ssid) => {
      if (ssid) {
        choices.set(ssid, { ssid, label: ssid, source: "saved" });
      }
    });

    networks.forEach((network) => {
      if (network.ssid) {
        choices.set(network.ssid, {
          ssid: network.ssid,
          label: `${network.ssid} (${network.rssi} dBm${network.secure ? ", secure" : ", open"})`,
          source: "scan"
        });
      }
    });

    return Array.from(choices.values());
  }, [knownWifiNetworks, networks]);

  async function getPort() {
    if (port) {
      return port;
    }

    if (!serialSupported) {
      throw new Error("USB Serial is available in Chrome or Edge on desktop.");
    }

    const selectedPort = await navigator.serial.requestPort();
    await selectedPort.open({ baudRate: 115200 });
    setPort(selectedPort);
    return selectedPort;
  }

  async function writeSerialLine(selectedPort, payload) {
    const writer = selectedPort.writable.getWriter();
    await writer.write(new TextEncoder().encode(`${JSON.stringify(payload)}\n`));
    writer.releaseLock();
  }

  async function waitForSerialMessage(selectedPort, expectedType, timeoutMs = 12000) {
    const reader = selectedPort.readable.getReader();
    const decoder = new TextDecoder();
    const deadline = Date.now() + timeoutMs;
    let buffer = "";

    try {
      while (Date.now() < deadline) {
        const readResult = await Promise.race([
          reader.read(),
          new Promise((resolve) => {
            setTimeout(() => resolve({ timeout: true }), 350);
          })
        ]);

        if (readResult.timeout) {
          continue;
        }

        if (readResult.done) {
          break;
        }

        buffer += decoder.decode(readResult.value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const line of lines) {
          const message = parseSerialJson(line.trim());
          if (message?.type === expectedType) {
            return message;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    throw new Error("The Arduino did not reply in time.");
  }

  async function scanWifi() {
    setStatus("");
    setIsScanning(true);

    try {
      const selectedPort = await getPort();
      await writeSerialLine(selectedPort, { type: "scanWifi" });
      const message = await waitForSerialMessage(selectedPort, "wifiNetworks");
      setNetworks(message.networks || []);
      setStatus("Wi-Fi scan complete. Choose a network below.");
    } catch (error) {
      setStatus(error.message || "Unable to scan Wi-Fi from the Arduino.");
    } finally {
      setIsScanning(false);
    }
  }

  async function saveWifiToBoard() {
    const ssid = manualWifi || selectedWifi;

    if (!ssid || !wifiPassword) {
      setStatus("Choose a Wi-Fi network and enter the password first.");
      return;
    }

    setIsSavingToBoard(true);
    setStatus("");

    try {
      const selectedPort = await getPort();
      await writeSerialLine(selectedPort, {
        type: "saveWifi",
        ssid,
        password: wifiPassword
      });
      const message = await waitForSerialMessage(selectedPort, "wifiSaved");
      setStatus(message.message || "Wi-Fi sent to Arduino. Save it in the dashboard too.");
    } catch (error) {
      setStatus(error.message || "Unable to send Wi-Fi to the Arduino.");
    } finally {
      setIsSavingToBoard(false);
    }
  }

  return (
    <div className="serialProvisioner">
      <div className="serialHeader">
        <div>
          <strong>Available Wi-Fi From Arduino</strong>
          <p className="empty">
            Connect the board over USB, scan from the board, then save the same network in the dashboard.
          </p>
        </div>
        <button
          className="button buttonGhost"
          type="button"
          onClick={scanWifi}
          disabled={isScanning || !serialSupported}
        >
          {isScanning ? "Scanning..." : "Scan Wi-Fi"}
        </button>
      </div>

      {!serialSupported ? (
        <p className="banner bannerError">
          USB Serial needs Chrome or Edge on desktop.
        </p>
      ) : null}

      <form action={saveWifiAction} className="connectDeviceForm">
        <label className="fieldGroup">
          <span className="fieldLabel">Device</span>
          <select className="input" name="deviceId" defaultValue={selectedDevice} required>
            <option value="" disabled>
              Select device
            </option>
            {devices.map((device) => (
              <option key={device.device_id} value={device.device_id}>
                {device.device_name} ({device.device_id})
              </option>
            ))}
          </select>
        </label>
        <label className="fieldGroup">
          <span className="fieldLabel">Available Wi-Fi</span>
          <select
            className="input"
            name="selectedWifi"
            value={selectedWifi}
            onChange={(event) => {
              setSelectedWifi(event.target.value);
              setManualWifi("");
            }}
          >
            <option value="">Select Wi-Fi network</option>
            {wifiChoices.map((choice) => (
              <option key={`${choice.source}-${choice.ssid}`} value={choice.ssid}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <label className="fieldGroup">
          <span className="fieldLabel">New Wi-Fi name (SSID)</span>
          <input
            className="input"
            name="manualWifi"
            placeholder="Enter Wi-Fi name"
            value={manualWifi}
            onChange={(event) => {
              setManualWifi(event.target.value);
              setSelectedWifi("");
            }}
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
        <p className="fieldHint">
          The scan runs on the Arduino board over USB. Save to Arduino writes the credentials to the board; Save Wi-Fi and Connect stores them in the dashboard.
        </p>
        {status ? <p className="fieldHint serialStatus">{status}</p> : null}
        <div className="connectDeviceActions">
          <button
            className="button buttonGhost"
            type="button"
            onClick={saveWifiToBoard}
            disabled={isSavingToBoard || !serialSupported}
          >
            {isSavingToBoard ? "Sending..." : "Save to Arduino"}
          </button>
          <button className="button buttonOn" type="submit">
            Save Wi-Fi and Connect
          </button>
          <a className="button buttonGhost buttonLink" href="/">
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
