"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <button className="button buttonOn serialWizardPrimary" type="submit" disabled={pending}>
      {pending ? "Saving..." : "Continue"}
    </button>
  );
}

const fallbackNetworks = [
  "NextGenTel_7E32",
  "Telia-B798AC",
  "Telia-2G-A1D053",
  "Telenor8137pai_EXT"
];

export default function WifiSerialProvisioner({
  knownWifiNetworks = [],
  saveWifiAction
}) {
  const [step, setStep] = useState("detect");
  const [deviceName, setDeviceName] = useState("Twyla");
  const [selectedWifi, setSelectedWifi] = useState("");
  const [manualWifi, setManualWifi] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");

  const networkOptions = useMemo(() => {
    const merged = [...knownWifiNetworks, ...fallbackNetworks];
    return [...new Set(merged.filter(Boolean))];
  }, [knownWifiNetworks]);

  const activeWifi = selectedWifi || manualWifi;

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
              Connect your board via USB and select it from the list below. If you have multiple boards connected,
              choose the one to configure.
            </p>
          </div>

          <div className="serialWizardTable">
            <div className="serialWizardTableHead">
              <span>Type</span>
              <span>USB Port</span>
            </div>
            <button type="button" className="serialWizardTableRow" onClick={() => setStep("confirm")}>
              <strong>Arduino UNO R4 WiFi</strong>
              <span>COM5</span>
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
              <p>
                An Arduino UNO R4 WiFi has been found and is ready to be configured. Make sure your device LED is
                solid before continuing.
              </p>
            </div>

            <div className="serialWizardActions">
              <button className="button buttonGhost serialWizardSecondary" type="button" onClick={() => setStep("detect")}>
                Change Device
              </button>
              <button className="button buttonOn serialWizardPrimary" type="button" onClick={() => setStep("network")}>
                Continue
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
                <form action={saveWifiAction} className="serialWizardNetworkCard">
                  <input name="deviceType" type="hidden" value="arduino" />
                  <input name="boardModel" type="hidden" value="Arduino UNO R4 WiFi" />
                  <input name="fqbn" type="hidden" value="arduino:renesas_uno:unor4wifi" />
                  <input name="location" type="hidden" value="Greenhouse Bay A" />
                  <input name="serialNumber" type="hidden" value="COM5" />
                  <input name="deviceName" type="hidden" value={deviceName} />
                  <input name="selectedWifi" type="hidden" value={selectedWifi} />

                  <div className="serialWizardNetworkHeader">
                    <div>
                      <strong>Select a network</strong>
                      <p>Choose a network from the list provided by your Arduino device.</p>
                    </div>
                    <button className="button buttonGhost serialWizardCompactButton" type="button">
                      Scan Again
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
                          setManualWifi("");
                        }}
                      >
                        <span className="serialWizardWifiIcon" aria-hidden="true">◔</span>
                        <strong>{network}</strong>
                      </button>
                    ))}
                  </div>

                  <label className="fieldGroup">
                    <span className="fieldLabel">Or enter Wi-Fi name manually</span>
                    <input
                      className="input"
                      name="manualWifi"
                      placeholder="Wi-Fi SSID"
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
                    <p>
                      Device ID and Device Secret will be generated automatically and saved with the network details.
                    </p>
                  </div>

                  <div className="connectDeviceActions">
                    <SaveButton />
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
