import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import DashboardAutoRefresh from "./DashboardAutoRefresh";
import WifiSerialProvisioner from "./WifiSerialProvisioner";
import {
  deleteDeviceForUser,
  getDeviceForUser,
  listDevices,
  provisionDeviceForUser,
  saveDeviceWifiConfiguration,
  setDeviceLedState
} from "../lib/devices";
import {
  authenticateUser,
  createSession,
  createUser,
  deleteSession,
  getUserBySessionToken
} from "../lib/auth";

function normalizeField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildRedirect(pathname, params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      query.set(key, value);
    }
  });

  const queryString = query.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

async function getCurrentUser() {
  const sessionToken = cookies().get("session_token")?.value;
  return getUserBySessionToken(sessionToken);
}

function getSessionCookieOptions(expiresAt) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.ENABLE_SECURE_COOKIES === "true",
    expires: expiresAt,
    path: "/"
  };
}

function formatDeviceDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

function getDeviceConnectionState(device) {
  if (!device.last_seen_at) {
    return {
      label: "Offline",
      lastActivity: "-",
      isOnline: false
    };
  }

  const lastSeen = new Date(device.last_seen_at);
  const ageMs = Date.now() - lastSeen.getTime();
  const isOnline = ageMs <= 60 * 1000;

  return {
    label: isOnline ? "Online" : "Offline",
    lastActivity: formatDeviceDate(device.last_seen_at),
    isOnline
  };
}

function getRequestOrigin() {
  if (process.env.PUBLIC_APP_URL) {
    return process.env.PUBLIC_APP_URL.replace(/\/+$/, "");
  }

  const requestHeaders = headers();
  const forwardedProto = requestHeaders.get("x-forwarded-proto");
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = forwardedHost || requestHeaders.get("host") || "localhost:3000";
  const proto = forwardedProto || (host.includes("localhost") ? "http" : "https");

  return `${proto}://${host}`;
}

function buildDeviceHeartbeatUrl(origin, device) {
  return `${origin}/api/devices/${encodeURIComponent(device.device_id)}/heartbeat`;
}

function buildMqttCommandTopic(device) {
  return `farm1/${device.device_id}/cmd`;
}

function getCppApiUrl() {
  return (process.env.CPP_API_URL || "http://localhost:8080").replace(/\/+$/, "");
}

async function publishLedCommandWithCppApi({ deviceId, command }) {
  const commandPath = command === "ON" ? "on" : "off";
  const response = await fetch(
    `${getCppApiUrl()}/api/devices/${encodeURIComponent(deviceId)}/commands/${commandPath}`,
    {
      method: "POST",
      cache: "no-store"
    }
  );

  if (response.ok) {
    return { ok: true };
  }

  let message = "C++ API could not publish the LED command.";
  try {
    const body = await response.json();
    message = body?.message || message;
  } catch (error) {
    message = `${message} HTTP ${response.status}`;
  }

  return { ok: false, message };
}

async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect(buildRedirect("/", { authError: "Please login to connect your Arduino device." }));
  }

  return user;
}

async function registerUser(formData) {
  "use server";

  const fullName = normalizeField(formData.get("fullName"));
  const email = normalizeField(formData.get("email"));
  const password = normalizeField(formData.get("password"));

  if (!fullName || !email || password.length < 6) {
    redirect(
      buildRedirect("/", {
        authError: "Enter your name, email, and a password with at least 6 characters.",
        authView: "register"
      })
    );
  }

  try {
    const user = await createUser({
      fullName,
      email,
      password
    });
    const session = await createSession(user.id);

    cookies().set("session_token", session.sessionToken, getSessionCookieOptions(session.expiresAt));
  } catch (error) {
    redirect(
      buildRedirect("/", {
        authError: "Unable to register. That email may already be in use.",
        authView: "register"
      })
    );
  }

  redirect(
    buildRedirect("/", {
      authMessage: "Account created. Connect your Arduino and save Wi-Fi now."
    })
  );
}

async function loginUser(formData) {
  "use server";

  const email = normalizeField(formData.get("email"));
  const password = normalizeField(formData.get("password"));
  const user = await authenticateUser({ email, password });

  if (!user) {
    redirect(buildRedirect("/", { authError: "Invalid email or password." }));
  }

  const session = await createSession(user.id);

  cookies().set("session_token", session.sessionToken, getSessionCookieOptions(session.expiresAt));

  redirect(
    buildRedirect("/", {
      authMessage: "Logged in. Connect your Arduino device below."
    })
  );
}

async function logoutUser() {
  "use server";

  const sessionToken = cookies().get("session_token")?.value;

  await deleteSession(sessionToken);
  cookies().delete("session_token");

  redirect(buildRedirect("/", { authMessage: "Logged out." }));
}

async function saveAndConnectArduinoDevice(formData) {
  "use server";

  const user = await requireUser();
  const deviceId = normalizeField(formData.get("deviceId"));
  const deviceName = normalizeField(formData.get("deviceName")) || deviceId;
  const deviceType = normalizeField(formData.get("deviceType")) || "arduino";
  const boardModel = normalizeField(formData.get("boardModel")) || "Arduino UNO R4 WiFi";
  const fqbn = normalizeField(formData.get("fqbn")) || "arduino:renesas_uno:unor4wifi";
  const serialNumber = normalizeField(formData.get("serialNumber"));
  const location = normalizeField(formData.get("location"));
  const selectedWifi = normalizeField(formData.get("selectedWifi"));
  const manualWifi = normalizeField(formData.get("manualWifi"));
  const wifiPassword = normalizeField(formData.get("wifiPassword"));
  const wifiSsid = manualWifi || selectedWifi;

  if (!deviceId || !wifiSsid || !wifiPassword) {
    redirect(
      buildRedirect("/", {
        authError: "Enter the Arduino device ID, Wi-Fi name, and Wi-Fi password.",
        selectedDevice: deviceId
      })
    );
  }

  const device = await provisionDeviceForUser({
    deviceId,
    deviceName,
    deviceType,
    boardModel,
    fqbn,
    serialNumber,
    location,
    userId: user.id
  });

  if (!device) {
    redirect(
      buildRedirect("/", {
        authError: "That Arduino device is already connected to another account.",
        selectedDevice: deviceId
      })
    );
  }

  const updatedDevice = await saveDeviceWifiConfiguration({
    deviceId,
    userId: user.id,
    wifiSsid,
    wifiPassword
  });

  if (!updatedDevice) {
    redirect(
      buildRedirect("/", {
        authError: "We could not save Wi-Fi settings for that device.",
        selectedDevice: deviceId
      })
    );
  }

  revalidatePath("/");
  redirect(
    buildRedirect("/", {
      authMessage: `Arduino ${deviceId} saved. The board will show connected after it reconnects.`,
      selectedDevice: deviceId
    })
  );
}

async function toggleLedCommand(formData) {
  "use server";

  const user = await requireUser();
  const deviceId = normalizeField(formData.get("deviceId"));
  const nextCommand = normalizeField(formData.get("nextCommand")).toUpperCase();

  if (!deviceId || !["ON", "OFF"].includes(nextCommand)) {
    redirect(buildRedirect("/", { authError: "Choose a valid LED command.", selectedDevice: deviceId }));
  }

  const device = await getDeviceForUser(deviceId, user.id);

  if (!device) {
    redirect(buildRedirect("/", { authError: "That Arduino device is not connected to your account." }));
  }

  const published = await publishLedCommandWithCppApi({
    deviceId,
    command: nextCommand
  });

  if (!published.ok) {
    redirect(
      buildRedirect("/", {
        authError: published.message,
        selectedDevice: deviceId
      })
    );
  }

  const updatedDevice = await setDeviceLedState({
    deviceId,
    userId: user.id,
    command: nextCommand,
    source: "cpp-api"
  });

  if (!updatedDevice) {
    redirect(buildRedirect("/", { authError: "That Arduino device is not connected to your account." }));
  }

  revalidatePath("/");
  redirect(
    buildRedirect("/", {
      authMessage: `GPIO 13 LED command sent through C++ API: ${nextCommand}.`,
      selectedDevice: deviceId
    })
  );
}

async function deleteArduinoDevice(formData) {
  "use server";

  const user = await requireUser();
  const deviceId = normalizeField(formData.get("deviceId"));

  if (!deviceId) {
    redirect(buildRedirect("/", { authError: "Choose a device to delete." }));
  }

  const deletedDevice = await deleteDeviceForUser({
    deviceId,
    userId: user.id
  });

  if (!deletedDevice) {
    redirect(buildRedirect("/", { authError: "That Arduino device is not connected to your account." }));
  }

  revalidatePath("/");
  redirect(
    buildRedirect("/", {
      authMessage: `Arduino ${deviceId} deleted.`
    })
  );
}

export default async function HomePage({ searchParams }) {
  const user = await getCurrentUser();
  const requestOrigin = getRequestOrigin();
  const authMessage = searchParams?.authMessage || "";
  const authError = searchParams?.authError || "";
  const authView = searchParams?.authView || "login";
  const selectedDevice = searchParams?.selectedDevice || "";
  const devices = user ? await listDevices(user.id) : [];
  const visibleDevices = selectedDevice
    ? devices.filter((device) => device.device_id === selectedDevice)
    : devices;

  return (
    <main className="page">
      <div className="shell cloudShell">
        <section className="panel stack">
          {authMessage ? <p className="banner bannerSuccess">{authMessage}</p> : null}
          {authError ? <p className="banner bannerError">{authError}</p> : null}

          {!user ? (
            <div className="authCenter">
              <div className="authStage authStageSolo">
                <div className="authCard authCardFeatured">
                  {authView === "register" ? (
                    <>
                      <p className="authKicker">New User</p>
                      <h2>Create your account</h2>
                      <p className="authCopy">
                        Create an account to start managing your Arduino devices from one dashboard.
                      </p>
                      <form action={registerUser} className="authForm">
                        <input className="input" name="fullName" placeholder="Meenakshi" required />
                        <input className="input" name="email" placeholder="meenakshi@example.com" type="email" required />
                        <input className="input" name="password" placeholder="Choose a password" type="password" required />
                        <button className="button buttonOn" type="submit">
                          Register
                        </button>
                      </form>
                      <p className="authFooterLink">
                        Already have an account? <a href="/?authView=login">Login</a>
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="authKicker">Welcome Back</p>
                      <h2>Login</h2>
                      <p className="authCopy">
                        Sign in to connect your Arduino device.
                      </p>
                      <form action={loginUser} className="authForm">
                        <input className="input" name="email" placeholder="meenakshi@example.com" type="email" required />
                        <input className="input" name="password" placeholder="Your password" type="password" required />
                        <button className="button buttonOff" type="submit">
                          Login
                        </button>
                      </form>
                      <p className="authFooterLink">
                        New user? <a href="/?authView=register">Create an account</a>
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              <DashboardAutoRefresh />
              <div className="sectionHeader">
                <div>
                  <p className="authKicker">Arduino Setup</p>
                  <strong>Welcome, {user.full_name}</strong>
                </div>
                <div className="sectionActions">
                  <form action={logoutUser}>
                    <button className="button buttonGhost" type="submit">
                      Logout
                    </button>
                  </form>
                </div>
              </div>

              <div className="historyCard connectDeviceCard">
                <div>
                  <strong>Connect Arduino</strong>
                </div>

                <WifiSerialProvisioner
                  devices={devices.map((device) => ({
                    device_id: device.device_id,
                    device_name: device.device_name
                  }))}
                  selectedDevice={selectedDevice}
                  saveWifiAction={saveAndConnectArduinoDevice}
                />
              </div>

              {visibleDevices.length > 0 ? (
                <div className="deviceConfigList">
                  {visibleDevices.map((device) => {
                    const connection = getDeviceConnectionState(device);

                    return (
                      <article className="deviceConfigCard" key={device.device_id}>
                        <div className="deviceConfigTop">
                          <div>
                            <p className="authKicker">Device</p>
                            <strong>{device.board_model || "Arduino UNO R4 WiFi"}</strong>
                          </div>
                          <span className={`chip ${connection.isOnline ? "chipOnline" : "chipOffline"}`}>
                            {connection.label}
                          </span>
                        </div>

                        <div className="deviceConfigRow">
                          <span>Name</span>
                          <strong>{device.device_name}</strong>
                        </div>
                        <div className="deviceConfigRow">
                          <span>Network</span>
                          <strong>{device.wifi_ssid || "-"}</strong>
                        </div>
                        <div className="deviceConfigRow">
                          <span>Status</span>
                          <strong>{connection.label}</strong>
                        </div>
                        <div className="deviceConfigRow">
                          <span>Last Activity</span>
                          <strong>{connection.lastActivity}</strong>
                        </div>
                        <div className="deviceConfigRow">
                          <span>ID</span>
                          <code>{device.device_id}</code>
                        </div>
                        <div className="deviceConfigRow">
                          <span>Serial Number</span>
                          <code>{device.serial_number || "-"}</code>
                        </div>
                        <div className="deviceConfigRow">
                          <span>Device Secret</span>
                          <code>{device.device_secret || "-"}</code>
                        </div>
                        <div className="deviceConfigRow">
                          <span>Heartbeat URL</span>
                          <code>{buildDeviceHeartbeatUrl(requestOrigin, device)}</code>
                        </div>
                        <div className="deviceConfigRow">
                          <span>MQTT Command Topic</span>
                          <code>{buildMqttCommandTopic(device)}</code>
                        </div>
                        <div className="deviceConfigRow">
                          <span>GPIO 13 LED</span>
                          <strong>{device.led_state || "OFF"}</strong>
                        </div>
                        <div className="deviceActions">
                          <form action={toggleLedCommand}>
                            <input type="hidden" name="deviceId" value={device.device_id} />
                            <input
                              type="hidden"
                              name="nextCommand"
                              value={(device.led_state || "OFF") === "ON" ? "OFF" : "ON"}
                            />
                            <button
                              className={`button ${(device.led_state || "OFF") === "ON" ? "buttonOff" : "buttonOn"}`}
                              type="submit"
                            >
                              {(device.led_state || "OFF") === "ON" ? "Turn LED Off" : "Turn LED On"}
                            </button>
                          </form>
                          <form action={deleteArduinoDevice}>
                            <input type="hidden" name="deviceId" value={device.device_id} />
                            <button className="button buttonDanger" type="submit">
                              Delete Device
                            </button>
                          </form>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
