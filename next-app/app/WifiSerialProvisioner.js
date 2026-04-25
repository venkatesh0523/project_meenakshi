"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function buildPortLabel(port) {
  const info = typeof port?.getInfo === "function" ? port.getInfo() : {};
  const vendor = info.usbVendorId ? `0x${info.usbVendorId.toString(16)}` : "USB";
  const product = info.usbProductId ? `0x${info.usbProductId.toString(16)}` : "serial";
  return `${vendor}:${product}`;
}

export default function WifiSerialProvisioner({
  saveWifiAction
}) {
  const timeoutRef = useRef(null);
  const formRef = useRef(null);
  const portRef = useRef(null);
  const readerRef = useRef(null);
  const writerRef = useRef(null);
  const submitRequestedRef = useRef(false);

  const [step, setStep] = useState("detect");
  const [deviceName, setDeviceName] = useState("Twyla");
  const [selectedWifi, setSelectedWifi] = useState("");
  const [manualWifi, setManualWifi] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [serialSupported, setSerialSupported] = useState(false);
  const [serialConnected, setSerialConnected] = useState(false);
  const [serialBusy, setSerialBusy] = useState(false);
  const [serialMessage, setSerialMessage] = useState("Connect your Arduino board with USB to continue.");
  const [serialError, setSerialError] = useState("");
  const [serialStatus, setSerialStatus] = useState("Idle");
  const [portLabel, setPortLabel] = useState("USB");
  const [serialNetworks, setSerialNetworks] = useState([]);
  const [serialLogs, setSerialLogs] = useState([]);

  const networkOptions = useMemo(() => [...new Set(serialNetworks.filter(Boolean))], [serialNetworks]);

  const activeWifi = selectedWifi || manualWifi;
  const canUseSerial = serialSupported && typeof window !== "undefined" && "isSecureContext" in window && window.isSecureContext;

  useEffect(() => {
    setSerialSupported(typeof navigator !== "undefined" && "serial" in navigator);
  }, []);

  useEffect(() => {
    return () => {
      clearPendingTimeout();
      void disconnectPort();
    };
  }, []);

  function pushSerialLog(message) {
    setSerialLogs((current) => [...current, message].slice(-8));
  }

  function clearPendingTimeout() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  function startPendingTimeout(kind) {
    clearPendingTimeout();
    timeoutRef.current = window.setTimeout(() => {
      setSerialBusy(false);

      if (kind === "scan") {
        setSerialStatus("Wi-Fi scan timed out");
        setSerialMessage("The board did not return any Wi-Fi networks.");
        setSerialError("Board did not answer Wi-Fi scan. Check that arduino_mqtt_device.ino is uploaded and Serial Monitor is closed.");
        pushSerialLog("Timed out waiting for wifiNetworks from board.");
        return;
      }

      if (kind === "save") {
        setSerialStatus("Board did not confirm Wi-Fi save");
        setSerialMessage("The board did not confirm that Wi-Fi credentials were saved.");
        setSerialError("Board did not answer saveWifi. Check the uploaded sketch, USB connection, and that no other app is using the serial port.");
        pushSerialLog("Timed out waiting for wifiSaved from board.");
      }
    }, 12000);
  }

  async function disconnectPort() {
    submitRequestedRef.current = false;
    clearPendingTimeout();

    if (readerRef.current) {
      try {
        await readerRef.current.cancel();
      } catch (error) {
        // Ignore cancellation errors during teardown.
      }
      readerRef.current.releaseLock();
      readerRef.current = null;
    }

    if (writerRef.current) {
      writerRef.current.releaseLock();
      writerRef.current = null;
    }

    if (portRef.current) {
      try {
        await portRef.current.close();
      } catch (error) {
        // Ignore close errors during teardown.
      }
      portRef.current = null;
    }

    setSerialConnected(false);
    setSerialStatus("Disconnected");
  }

  async function sendSerialCommand(payload) {
    if (!writerRef.current) {
      throw new Error("Serial connection is not ready.");
    }

    const message = `${JSON.stringify(payload)}\n`;
    const encoded = new TextEncoder().encode(message);
    await writerRef.current.write(encoded);
  }

  function handleBoardMessage(message) {
    if (message.type === "wifiNetworks") {
      clearPendingTimeout();
      const nextNetworks = Array.isArray(message.networks)
        ? message.networks.map((network) => network?.ssid).filter(Boolean)
        : [];

      setSerialNetworks(nextNetworks);
      setSerialBusy(false);
      setSerialStatus("Wi-Fi scan complete");
      setSerialMessage(nextNetworks.length > 0 ? "Wi-Fi scan complete. Choose a network below." : "No Wi-Fi networks found.");
      setSerialError("");
      pushSerialLog(nextNetworks.length > 0 ? `Board returned ${nextNetworks.length} Wi-Fi networks.` : "Board returned no Wi-Fi networks.");
      return;
    }

    if (message.type === "wifiSaved") {
      clearPendingTimeout();
      setSerialBusy(false);
      setSerialError("");
      setSerialStatus("Wi-Fi saved on board");
      setSerialMessage(message.message || "Wi-Fi saved on the board. Finishing cloud provisioning...");
      pushSerialLog(message.message || "Board confirmed Wi-Fi credentials were saved.");

      if (!submitRequestedRef.current && formRef.current) {
        submitRequestedRef.current = true;
        setSerialStatus("Cloud provisioning started");
        pushSerialLog("Submitting cloud provisioning form.");
        formRef.current.requestSubmit();
      }
      return;
    }

    if (message.type === "wifiError") {
      clearPendingTimeout();
      setSerialBusy(false);
      setSerialStatus("Board reported an error");
      setSerialError(message.message || "Unable to save Wi-Fi on the board.");
      pushSerialLog(message.message || "Board reported a Wi-Fi error.");
      return;
    }
  }

  async function readSerialLoop(port) {
    const decoder = new TextDecoder();
    let buffer = "";

    while (port.readable) {
      const reader = port.readable.getReader();
      readerRef.current = reader;

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
              pushSerialLog(trimmed);
            }
            if (!trimmed.startsWith("{")) {
              continue;
            }

            try {
              const parsed = JSON.parse(trimmed);
              handleBoardMessage(parsed);
            } catch (error) {
              // Ignore non-JSON serial logs.
            }
          }
        }
      } finally {
        reader.releaseLock();
        if (readerRef.current === reader) {
          readerRef.current = null;
        }
      }
    }
  }

  async function connectBoard() {
    if (!canUseSerial) {
      setSerialError("USB provisioning requires Web Serial, which works on localhost or HTTPS in a supported browser.");
      return;
    }

    setSerialBusy(true);
    setSerialError("");
    setSerialStatus("Waiting for browser permission");
    setSerialMessage("Waiting for board permission...");
    setSerialLogs([]);

    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });

      portRef.current = port;
      writerRef.current = port.writable.getWriter();
      setPortLabel(buildPortLabel(port));
      setSerialConnected(true);
      setSerialBusy(false);
      setSerialStatus("Board connected");
      setSerialMessage("Device connected. Ready to retrieve board information.");
      pushSerialLog(`Connected to board on ${buildPortLabel(port)}.`);
      setStep("confirm");

      void readSerialLoop(port).catch((error) => {
        setSerialError(`Serial connection lost: ${error.message}`);
        setSerialBusy(false);
        setSerialConnected(false);
        setSerialStatus("Serial connection lost");
        pushSerialLog(`Serial connection lost: ${error.message}`);
        clearPendingTimeout();
      });
    } catch (error) {
      setSerialBusy(false);
      setSerialStatus("Connection failed");
      setSerialError(error.message || "Unable to connect to the board.");
      pushSerialLog(error.message || "Unable to connect to the board.");
    }
  }

  async function scanNetworks() {
    if (!serialConnected) {
      setSerialError("Connect the board first.");
      return;
    }

    setStep("network");
    setSerialBusy(true);
    setSerialError("");
    setSerialStatus("Scanning Wi-Fi");
    setSerialMessage("Scanning Wi-Fi networks from the board...");
    pushSerialLog("Requested Wi-Fi network scan from board.");

    try {
      await sendSerialCommand({ type: "scanWifi" });
      startPendingTimeout("scan");
    } catch (error) {
      clearPendingTimeout();
      setSerialBusy(false);
      setSerialStatus("Wi-Fi scan failed");
      setSerialError(error.message || "Unable to scan Wi-Fi networks.");
      pushSerialLog(error.message || "Unable to scan Wi-Fi networks.");
    }
  }

  async function saveWifiToBoard() {
    if (!serialConnected) {
      setSerialError("Connect the board first.");
      return;
    }

    if (!activeWifi || !wifiPassword) {
      setSerialError("Choose a Wi-Fi network and enter the password.");
      return;
    }

    submitRequestedRef.current = false;
    setSerialBusy(true);
    setSerialError("");
    setSerialStatus("Sending Wi-Fi credentials");
    setSerialMessage("Pushing Wi-Fi settings to the board...");
    pushSerialLog(`Sending Wi-Fi credentials for ${activeWifi}.`);

    try {
      await sendSerialCommand({
        type: "saveWifi",
        ssid: activeWifi,
        password: wifiPassword
      });
      startPendingTimeout("save");
    } catch (error) {
      clearPendingTimeout();
      setSerialBusy(false);
      setSerialStatus("Provisioning failed");
      setSerialError(error.message || "Unable to send Wi-Fi settings to the board.");
      pushSerialLog(error.message || "Unable to send Wi-Fi settings to the board.");
    }
  }

  return (
    <div className="serialWizard">
      {step === "detect" ? (
        <section className="serialWizardCard">
          <div className="serialWizardBanner">
            <strong>Device detection (Cable)</strong>
            <span aria-hidden="true">⇢</span>
          </div>

          <div className="serialWizardIllustration" aria-hidden="true">
            <span className="serialWizardCable" />
            <span className="serialWizardBoard">∞</span>
          </div>

          <div className="serialWizardIntro">
            <h4>Connect your board to your computer</h4>
            <p>
              This flow now talks to your Arduino board over USB. Grant serial access, and we will scan Wi-Fi networks
              directly from the device.
            </p>
          </div>

          <div className="serialWizardSummary">
            <span>USB provisioning</span>
            <strong>{serialStatus}</strong>
            <p>{serialMessage}</p>
          </div>

          <div className="serialWizardActions serialWizardActionsStart">
            <button className="button buttonOn serialWizardPrimary" type="button" onClick={connectBoard} disabled={serialBusy}>
              {serialBusy ? "Connecting..." : serialConnected ? "Reconnect Board" : "Connect Board"}
            </button>
          </div>

          <div className="serialWizardTable">
            <div className="serialWizardTableHead">
              <span>Type</span>
              <span>USB Port</span>
            </div>
            <button type="button" className="serialWizardTableRow" onClick={connectBoard} disabled={serialBusy}>
              <strong>{serialConnected ? "Arduino UNO R4 WiFi" : "Click to connect Arduino board"}</strong>
              <span>{serialConnected ? portLabel : serialBusy ? "Connecting..." : "USB"}</span>
            </button>
          </div>
        </section>
      ) : null}

      {step === "confirm" ? (
        <section className="serialWizardCard">
          <div className="serialWizardBanner">
            <strong>Device detection (Cable)</strong>
            <span aria-hidden="true">⇢</span>
          </div>

          <div className="serialWizardConnected">
            <div className="serialWizardIllustration serialWizardIllustrationConnected" aria-hidden="true">
              <span className="serialWizardCable" />
              <span className="serialWizardBoard serialWizardBoardLarge">▣</span>
            </div>

            <div className="serialWizardIntro">
              <h4>Arduino UNO R4 WiFi connected</h4>
              <p>{serialMessage}</p>
            </div>

            <div className="serialWizardSummary">
              <span>Board status</span>
              <strong>{serialStatus}</strong>
              <p>Port: {portLabel}</p>
            </div>

            <div className="serialWizardActions">
              <button className="button buttonGhost serialWizardSecondary" type="button" onClick={() => setStep("detect")}>
                Change Device
              </button>
              <button className="button buttonGhost serialWizardSecondary" type="button" onClick={connectBoard} disabled={serialBusy}>
                {serialBusy ? "Connecting..." : "Reconnect Board"}
              </button>
              <button className="button buttonOn serialWizardPrimary" type="button" onClick={scanNetworks} disabled={serialBusy}>
                {serialBusy ? "Scanning..." : "Continue"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {step === "network" ? (
        <section className="serialWizardCard serialWizardCardWide">
          <div className="serialWizardDeviceHeader">
            <div>
              <strong>Arduino UNO R4 WiFi - {deviceName}</strong>
              <span className="serialWizardConnectedBadge">Connected</span>
            </div>
            <button className="button buttonGhost serialWizardCompactButton" type="button" onClick={() => setStep("confirm")}>
              Show less
            </button>
          </div>

          <div className="serialWizardTimeline">
            <div className="serialWizardStep serialWizardStepComplete">
              <span className="serialWizardStepMarker">✓</span>
              <div className="serialWizardStepContent">
                <div className="serialWizardStepTop">
                  <strong>Device name</strong>
                </div>
                <label className="fieldGroup">
                  <input className="input" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} />
                </label>
              </div>
            </div>

            <div className="serialWizardStep">
              <span className="serialWizardStepMarker serialWizardStepMarkerActive">2</span>
              <div className="serialWizardStepContent">
                <form ref={formRef} action={saveWifiAction} className="serialWizardNetworkCard">
                  <input name="deviceType" type="hidden" value="arduino" />
                  <input name="boardModel" type="hidden" value="Arduino UNO R4 WiFi" />
                  <input name="fqbn" type="hidden" value="arduino:renesas_uno:unor4wifi" />
                  <input name="location" type="hidden" value="Greenhouse Bay A" />
                  <input name="serialNumber" type="hidden" value={portLabel} />
                  <input name="deviceName" type="hidden" value={deviceName} />
                  <input name="selectedWifi" type="hidden" value={selectedWifi} />

                  <div className="serialWizardNetworkHeader">
                    <div>
                      <strong>Select a network</strong>
                      <p>{serialMessage}</p>
                    </div>
                    <button className="button buttonGhost serialWizardCompactButton" type="button" onClick={scanNetworks} disabled={serialBusy}>
                      {serialBusy ? "Scanning..." : "Scan Again"}
                    </button>
                  </div>

                  <div className="serialWizardNetworkList">
                    {networkOptions.map((network) => (
                      <button
                        key={network}
                        type="button"
                        className={`serialWizardNetworkRow ${selectedWifi === network ? "serialWizardNetworkRowActive" : ""}`}
                        onClick={() => {
                          setSelectedWifi(network);
                          setManualWifi(network);
                        }}
                      >
                        <span className="serialWizardWifiIcon" aria-hidden="true">◔</span>
                        <strong>{network}</strong>
                      </button>
                    ))}
                  </div>

                  {networkOptions.length === 0 ? (
                    <p className="banner bannerError">
                      No scanned Wi-Fi networks yet. Click `Scan Again` or enter the Wi-Fi name manually.
                    </p>
                  ) : null}

                  <label className="fieldGroup">
                    <span className="fieldLabel">Or enter Wi-Fi name manually</span>
                    <input
                      className="input"
                      name="manualWifi"
                      placeholder="Wi-Fi SSID"
                      value={manualWifi}
                      onChange={(event) => {
                        setManualWifi(event.target.value);
                        setSelectedWifi(event.target.value);
                      }}
                    />
                  </label>

                  <label className="fieldGroup">
                    <span className="fieldLabel">Wi-Fi password</span>
                    <input
                      className="input"
                      name="wifiPassword"
                      placeholder="Enter Wi-Fi password"
                      type="password"
                      value={wifiPassword}
                      onChange={(event) => setWifiPassword(event.target.value)}
                      required
                    />
                  </label>

                  <div className="serialWizardSummary">
                    <span>Cloud provisioning</span>
                    <strong>{activeWifi ? `Selected network: ${activeWifi}` : "Choose a network to continue"}</strong>
                    <p>{serialStatus}: {serialMessage}</p>
                  </div>

                  {serialError ? <p className="banner bannerError">{serialError}</p> : null}
                  {!serialError && serialStatus === "Cloud provisioning started" ? (
                    <p className="banner bannerSuccess">Board confirmed Wi-Fi save. Waiting for cloud provisioning to finish.</p>
                  ) : null}
                  {!canUseSerial ? (
                    <p className="banner bannerError">
                      USB provisioning requires Web Serial in a secure context. Use `localhost` or HTTPS in Chrome/Edge.
                    </p>
                  ) : null}

                  <div className="serialWizardLogCard">
                    <strong>Board messages</strong>
                    <div className="serialWizardLogList">
                      {serialLogs.length > 0 ? (
                        serialLogs.map((log, index) => (
                          <code className="serialWizardLogLine" key={`${index}-${log}`}>
                            {log}
                          </code>
                        ))
                      ) : (
                        <span className="serialWizardLogEmpty">No board messages yet.</span>
                      )}
                    </div>
                  </div>

                  <div className="connectDeviceActions">
                    <button className="button buttonGhost serialWizardSecondary" type="button" onClick={connectBoard} disabled={serialBusy}>
                      {serialBusy ? "Connecting..." : "Reconnect Board"}
                    </button>
                    <button className="button buttonOn serialWizardPrimary" type="button" onClick={saveWifiToBoard} disabled={serialBusy}>
                      {serialBusy ? "Provisioning..." : "Continue"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
