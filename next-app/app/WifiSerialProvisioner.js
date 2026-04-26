"use client";

import { useMemo, useState } from "react";

export default function WifiSerialProvisioner({
  knownWifiNetworks = [],
  saveWifiAction
}) {
  const [step, setStep] = useState("detect");
  const [deviceName, setDeviceName] = useState("Twyla");
  const [selectedWifi, setSelectedWifi] = useState("");
  const [manualWifi, setManualWifi] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const networkOptions = useMemo(() => [...new Set((knownWifiNetworks || []).filter(Boolean))], [knownWifiNetworks]);
  const activeWifi = manualWifi || selectedWifi;

  function startSetup() {
    setStep("network");
    setFormError("");
  }

  function handleWifiChoice(network) {
    setSelectedWifi(network);
    setManualWifi(network);
    setFormError("");
  }

  function handleSubmit(event) {
    if (!activeWifi.trim() || !wifiPassword.trim()) {
      event.preventDefault();
      setFormError("Enter a Wi-Fi name and password before continuing.");
      return;
    }

    setIsSubmitting(true);
    setFormError("");
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
            <h4>Prepare your board</h4>
            <p>
              This setup now uses a reliable flow with no browser USB permission. We will save the device,
              update the Arduino sketch file automatically, and then you can upload that sketch from the
              Arduino IDE.
            </p>
          </div>

          <div className="serialWizardSummary">
            <span>Provisioning mode</span>
            <strong>Sketch update flow</strong>
            <p>No serial permission is required on this page.</p>
          </div>

          <div className="serialWizardActions serialWizardActionsStart">
            <button className="button buttonOn serialWizardPrimary" type="button" onClick={startSetup}>
              Continue
            </button>
          </div>

          <div className="serialWizardTable">
            <div className="serialWizardTableHead">
              <span>Board</span>
              <span>Connection</span>
            </div>
            <div className="serialWizardTableRow">
              <strong>Arduino UNO R4 WiFi</strong>
              <span>Manual upload after save</span>
            </div>
          </div>
        </section>
      ) : null}

      {step === "network" ? (
        <section className="serialWizardCard serialWizardCardWide">
          <div className="serialWizardDeviceHeader">
            <div>
              <strong>Arduino UNO R4 WiFi - {deviceName}</strong>
              <span className="serialWizardConnectedBadge">Ready to save</span>
            </div>
            <button className="button buttonGhost serialWizardCompactButton" type="button" onClick={() => setStep("detect")}>
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
                <form action={saveWifiAction} className="serialWizardNetworkCard" onSubmit={handleSubmit}>
                  <input name="deviceType" type="hidden" value="arduino" />
                  <input name="boardModel" type="hidden" value="Arduino UNO R4 WiFi" />
                  <input name="fqbn" type="hidden" value="arduino:renesas_uno:unor4wifi" />
                  <input name="location" type="hidden" value="Greenhouse Bay A" />
                  <input name="serialNumber" type="hidden" value="USB:manual-upload" />
                  <input name="deviceName" type="hidden" value={deviceName} />
                  <input name="selectedWifi" type="hidden" value={selectedWifi} />

                  <div className="serialWizardNetworkHeader">
                    <div>
                      <strong>Select a network</strong>
                      <p>Choose a known Wi-Fi network or type the SSID manually.</p>
                    </div>
                  </div>

                  <div className="serialWizardNetworkList">
                    {networkOptions.map((network) => (
                      <button
                        key={network}
                        type="button"
                        className={`serialWizardNetworkRow ${activeWifi === network ? "serialWizardNetworkRowActive" : ""}`}
                        onClick={() => handleWifiChoice(network)}
                      >
                        <span className="serialWizardWifiIcon" aria-hidden="true">◔</span>
                        <strong>{network}</strong>
                      </button>
                    ))}
                  </div>

                  {networkOptions.length === 0 ? (
                    <p className="banner bannerError">
                      No saved Wi-Fi names found yet. Enter the Wi-Fi name manually below.
                    </p>
                  ) : null}

                  <label className="fieldGroup">
                    <span className="fieldLabel">Wi-Fi name</span>
                    <input
                      className="input"
                      name="manualWifi"
                      placeholder="Wi-Fi SSID"
                      value={manualWifi}
                      onChange={(event) => {
                        setManualWifi(event.target.value);
                        setSelectedWifi(event.target.value);
                        setFormError("");
                      }}
                      required
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
                      onChange={(event) => {
                        setWifiPassword(event.target.value);
                        setFormError("");
                      }}
                      required
                    />
                  </label>

                  <div className="serialWizardSummary">
                    <span>Sketch update</span>
                    <strong>{activeWifi ? `Selected network: ${activeWifi}` : "Choose a network to continue"}</strong>
                    <p>
                      Saving here will generate the device ID and secret, update
                      <code> arduino/arduino_mqtt_device.ino </code>
                      automatically, and then you can upload it from the Arduino IDE.
                    </p>
                  </div>

                  {formError ? <p className="banner bannerError">{formError}</p> : null}

                  <div className="serialWizardLogCard">
                    <strong>Next step after save</strong>
                    <div className="serialWizardLogList">
                      <span className="serialWizardLogEmpty">1. Save the device here.</span>
                      <span className="serialWizardLogEmpty">2. Open the updated sketch in Arduino IDE.</span>
                      <span className="serialWizardLogEmpty">3. Upload it to the UNO R4 WiFi.</span>
                      <span className="serialWizardLogEmpty">4. Refresh the Devices page and wait for the board to come online.</span>
                    </div>
                  </div>

                  <div className="connectDeviceActions">
                    <button className="button buttonGhost serialWizardSecondary" type="button" onClick={() => setStep("detect")} disabled={isSubmitting}>
                      Back
                    </button>
                    <button className="button buttonOn serialWizardPrimary" type="submit" disabled={isSubmitting}>
                      {isSubmitting ? "Saving..." : "Save Device and Update Sketch"}
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
