"use client";

import { useState } from "react";
import WifiSerialProvisioner from "./WifiSerialProvisioner";

export default function DeviceSetupModal({
  knownWifiNetworks,
  saveWifiAction
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState("root");

  function closeModal() {
    setIsOpen(false);
    setStep("root");
  }

  function goBack() {
    if (step === "serial-form") {
      setStep("arduino-methods");
      return;
    }

    if (step === "arduino-methods") {
      setStep("root");
    }
  }

  return (
    <>
      <button className="deviceAddButton" type="button" onClick={() => setIsOpen(true)}>
        + Add Device
      </button>

      {isOpen ? (
        <div className="deviceSetupOverlay" onClick={closeModal}>
          <div className="deviceSetupModal" onClick={(event) => event.stopPropagation()}>
            <div className="deviceSetupHeader">
              {step !== "root" ? (
                <button className="deviceSetupBack" type="button" aria-label="Go back" onClick={goBack}>
                  ←
                </button>
              ) : (
                <span className="deviceSetupBackSpacer" aria-hidden="true" />
              )}
              <h3>Setup Device</h3>
              <button className="deviceSetupClose" type="button" aria-label="Close setup modal" onClick={closeModal}>
                ×
              </button>
            </div>

            <div className="deviceSetupBody">
              {step === "root" ? (
                <>
                  <div className="deviceSetupSection">
                    <p className="deviceSetupEyebrow">Automatic Setup</p>
                    <p className="deviceSetupCopy">
                      Choose one setup option to connect your board to the cloud.
                    </p>
                  </div>

                  <button
                    type="button"
                    className="deviceSetupOption"
                    onClick={() => setStep("arduino-methods")}
                  >
                    <div className="deviceSetupOptionIcon" aria-hidden="true">
                      ∞
                    </div>
                    <div className="deviceSetupOptionText">
                      <strong>Arduino boards</strong>
                      <span>Connect supported Arduino boards to the Cloud instantly.</span>
                    </div>
                  </button>
                </>
              ) : null}

              {step === "arduino-methods" ? (
                <>
                  <div className="deviceSetupSection">
                    <strong className="deviceSetupTitle">Choose how to connect your board</strong>
                    <p className="deviceSetupCopy">
                      Connect via USB or Bluetooth, depending on your board.
                    </p>
                  </div>

                  <button
                    type="button"
                    className="deviceSetupOption"
                    onClick={() => setStep("serial-form")}
                  >
                    <div className="deviceSetupOptionIcon deviceSetupOptionIconUsb" aria-hidden="true">
                      🔌
                    </div>
                    <div className="deviceSetupOptionText">
                      <strong>Via Serial (USB)</strong>
                      <span>Connect your board via USB for a smooth setup and programming experience.</span>
                    </div>
                  </button>

                  <button type="button" className="deviceSetupOption">
                    <div className="deviceSetupOptionIcon deviceSetupOptionIconBluetooth" aria-hidden="true">
                      ᛒ
                    </div>
                    <div className="deviceSetupOptionText">
                      <strong>Via Bluetooth</strong>
                      <span>Simply power up a compatible board and it will show up automatically for wireless setup.</span>
                    </div>
                  </button>
                </>
              ) : null}

              {step === "serial-form" ? (
                <div className="deviceSetupFormPanel">
                  <WifiSerialProvisioner
                    knownWifiNetworks={knownWifiNetworks}
                    saveWifiAction={saveWifiAction}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
