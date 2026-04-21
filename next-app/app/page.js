import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import DashboardAutoRefresh from "./DashboardAutoRefresh";
import LedToggleButton from "./LedToggleButton";
import WifiSerialProvisioner from "./WifiSerialProvisioner";
import {
  addThingVariableForUser,
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

const builderSections = [
  { id: "things", label: "Things" },
  { id: "devices", label: "Devices" },
  { id: "dashboards", label: "Dashboards" },
  { id: "triggers", label: "Triggers" },
  { id: "templates", label: "Templates" }
];

function getBuilderSection(value) {
  return builderSections.some((section) => section.id === value) ? value : "devices";
}

function buildBuilderLink(sectionId, selectedDevice = "") {
  return buildRedirect("/", {
    builder: sectionId,
    selectedDevice
  });
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
  const deviceSecret = normalizeField(formData.get("deviceSecret"));
  const boardModel = normalizeField(formData.get("boardModel")) || "Arduino UNO R4 WiFi";
  const fqbn = normalizeField(formData.get("fqbn")) || "arduino:renesas_uno:unor4wifi";
  const serialNumber = normalizeField(formData.get("serialNumber"));
  const location = normalizeField(formData.get("location"));
  const selectedWifi = normalizeField(formData.get("selectedWifi"));
  const manualWifi = normalizeField(formData.get("manualWifi"));
  const wifiPassword = normalizeField(formData.get("wifiPassword"));
  const wifiSsid = manualWifi || selectedWifi;

  if (!deviceId || !deviceSecret || !wifiSsid || !wifiPassword) {
    redirect(
      buildRedirect("/", {
        authError: "Enter the Arduino device ID, device secret, Wi-Fi name, and Wi-Fi password.",
        selectedDevice: deviceId
      })
    );
  }

  const device = await provisionDeviceForUser({
    deviceId,
    deviceName,
    deviceType,
    deviceSecret,
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
      authMessage: `Arduino ${deviceId} saved with matching secret. The board will show online after its next heartbeat.`,
      selectedDevice: deviceId
    })
  );
}

async function toggleLedCommand(formData) {
  "use server";

  const user = await requireUser();
  const deviceId = normalizeField(formData.get("deviceId"));

  if (!deviceId) {
    redirect(buildRedirect("/", { authError: "Choose a valid LED command.", selectedDevice: deviceId }));
  }

  const device = await getDeviceForUser(deviceId, user.id);

  if (!device) {
    redirect(buildRedirect("/", { authError: "That Arduino device is not connected to your account." }));
  }

  const nextCommand = (device.led_state || "OFF") === "ON" ? "OFF" : "ON";

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

async function addThingVariable(formData) {
  "use server";

  const user = await requireUser();
  const deviceId = normalizeField(formData.get("deviceId"));
  const variableName = normalizeField(formData.get("variableName"));
  const variableType = normalizeField(formData.get("variableType")) || "boolean";
  const permission = normalizeField(formData.get("permission")) || "readwrite";

  if (!deviceId || !variableName) {
    redirect(
      buildRedirect("/", {
        builder: "things",
        authError: "Enter a variable name.",
        selectedDevice: deviceId
      })
    );
  }

  const result = await addThingVariableForUser({
    deviceId,
    userId: user.id,
    variableName,
    variableType,
    permission
  });

  if (!result.ok) {
    redirect(
      buildRedirect("/", {
        builder: "things",
        authError:
          result.reason === "duplicate-variable"
            ? `Variable ${variableName} already exists for this thing.`
            : "That thing is not connected to your account.",
        selectedDevice: deviceId
      })
    );
  }

  revalidatePath("/");
  redirect(
    buildRedirect("/", {
      builder: "things",
      authMessage: `Variable ${variableName} created.`,
      selectedDevice: deviceId
    })
  );
}

export default async function HomePage({ searchParams }) {
  const user = await getCurrentUser();
  const requestOrigin = getRequestOrigin();
  const authMessage = searchParams?.authMessage || "";
  const authError = searchParams?.authError || "";
  const authView = searchParams?.authView || "login";
  const builderSection = getBuilderSection(searchParams?.builder || "devices");
  const selectedDevice = searchParams?.selectedDevice || "";
  const devices = user ? await listDevices(user.id) : [];
  const visibleDevices = selectedDevice
    ? devices.filter((device) => device.device_id === selectedDevice)
    : devices;
  const deviceCount = devices.length;
  const onlineCount = devices.filter((device) => getDeviceConnectionState(device).isOnline).length;
  const thingItems = devices.map((device) => ({
    ...device,
    thingName: `${device.device_name} Thing`,
    variables: Array.isArray(device.thing_variables) ? device.thing_variables : []
  }));

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
              <div className="builderLayout">
                <aside className="builderSidebar">
                  <div className="builderSidebarHeader">
                    <p className="authKicker">IoT Builder</p>
                    <strong>{user.full_name}</strong>
                  </div>
                  <nav className="builderNav">
                    {builderSections.map((section) => (
                      <a
                        key={section.id}
                        className={`builderNavItem ${builderSection === section.id ? "builderNavItemActive" : ""}`}
                        href={buildBuilderLink(section.id, selectedDevice)}
                      >
                        {section.label}
                      </a>
                    ))}
                  </nav>
                  <form action={logoutUser} className="builderSidebarFooter">
                    <button className="button buttonGhost" type="submit">
                      Logout
                    </button>
                  </form>
                </aside>

                <div className="builderContent">
                  <div className="sectionHeader builderHeader">
                    <div>
                      <p className="authKicker">Arduino Cloud Style</p>
                      <strong>{builderSections.find((section) => section.id === builderSection)?.label}</strong>
                    </div>
                    <div className="builderHeaderStats">
                      <div className="builderStat">
                        <span>Devices</span>
                        <strong>{deviceCount}</strong>
                      </div>
                      <div className="builderStat">
                        <span>Online</span>
                        <strong>{onlineCount}</strong>
                      </div>
                    </div>
                  </div>

                  {builderSection === "things" ? (
                    <div className="builderSection stackCompact">
                      <div className="historyCard">
                        <strong>Things</strong>
                        <p className="sectionCopy">Each thing groups device variables, status, and future automations.</p>
                      </div>

                      {thingItems.length > 0 ? (
                        <div className="builderGrid">
                          {thingItems.map((thing) => {
                            const connection = getDeviceConnectionState(thing);

                            return (
                              <article className="builderCard" key={thing.device_id}>
                                <div className="builderCardTop">
                                  <div>
                                    <p className="authKicker">Thing</p>
                                    <strong>{thing.thingName}</strong>
                                  </div>
                                  <span className={`chip ${connection.isOnline ? "chipOnline" : "chipOffline"}`}>
                                    {connection.label}
                                  </span>
                                </div>
                                <p className="builderCardCopy">{thing.device_name} groups variables, live connection status, and future automations.</p>
                                {thing.variables.length > 0 ? (
                                  <div className="builderPillRow">
                                    {thing.variables.map((item) => (
                                      <span className="builderMiniPill" key={item.name}>
                                        {item.name} · {item.type}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="sectionCopy">No variables yet.</p>
                                )}
                                <form action={addThingVariable} className="thingVariableForm">
                                  <input type="hidden" name="deviceId" value={thing.device_id} />
                                  <input className="input" name="variableName" placeholder="ledState" required />
                                  <select className="input" name="variableType" defaultValue="boolean">
                                    <option value="boolean">Boolean</option>
                                    <option value="number">Number</option>
                                    <option value="string">String</option>
                                  </select>
                                  <select className="input" name="permission" defaultValue="readwrite">
                                    <option value="readwrite">Read &amp; Write</option>
                                    <option value="readonly">Read Only</option>
                                  </select>
                                  <button className="button buttonOn" type="submit">
                                    Add Variable
                                  </button>
                                </form>
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="historyCard">
                          <strong>No things yet</strong>
                          <p className="sectionCopy">Create a device in Devices to automatically create its first thing.</p>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {builderSection === "devices" ? (
                    <div className="builderSection stackCompact">
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
                                    <LedToggleButton isOn={(device.led_state || "OFF") === "ON"} />
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
                    </div>
                  ) : null}

                  {builderSection === "dashboards" ? (
                    <div className="builderSection stackCompact">
                      <div className="historyCard">
                        <strong>Dashboards</strong>
                        <p className="sectionCopy">Arrange live telemetry, LED state, and connection status into operator views.</p>
                      </div>
                      <div className="builderGrid">
                        <article className="builderCard">
                          <div className="builderCardTop">
                            <div>
                              <p className="authKicker">Dashboard</p>
                              <strong>Greenhouse Overview</strong>
                            </div>
                            <span className="chip chipOnline">Live</span>
                          </div>
                          <p className="builderCardCopy">Track online devices, current LED state, and network health from one screen.</p>
                        </article>
                        <article className="builderCard">
                          <div className="builderCardTop">
                            <div>
                              <p className="authKicker">Dashboard</p>
                              <strong>Device Control</strong>
                            </div>
                            <span className="chip">Draft</span>
                          </div>
                          <p className="builderCardCopy">A focused control layout for switching GPIO outputs and reviewing heartbeat timing.</p>
                        </article>
                      </div>
                    </div>
                  ) : null}

                  {builderSection === "triggers" ? (
                    <div className="builderSection stackCompact">
                      <div className="historyCard">
                        <strong>Triggers</strong>
                        <p className="sectionCopy">Create actions that react to connectivity, schedules, or variable changes.</p>
                      </div>
                      <div className="builderGrid">
                        <article className="builderCard">
                          <div className="builderCardTop">
                            <div>
                              <p className="authKicker">Trigger</p>
                              <strong>Offline Alert</strong>
                            </div>
                            <span className="chip chipOffline">Suggestion</span>
                          </div>
                          <p className="builderCardCopy">Notify when a device heartbeat is missing for more than one minute.</p>
                        </article>
                        <article className="builderCard">
                          <div className="builderCardTop">
                            <div>
                              <p className="authKicker">Trigger</p>
                              <strong>Night Schedule</strong>
                            </div>
                            <span className="chip">Suggestion</span>
                          </div>
                          <p className="builderCardCopy">Switch the LED off automatically outside active hours.</p>
                        </article>
                      </div>
                    </div>
                  ) : null}

                  {builderSection === "templates" ? (
                    <div className="builderSection stackCompact">
                      <div className="historyCard">
                        <strong>Templates</strong>
                        <p className="sectionCopy">Reusable setups for common Arduino devices, dashboards, and automation flows.</p>
                      </div>
                      <div className="builderGrid">
                        <article className="builderCard">
                          <div className="builderCardTop">
                            <div>
                              <p className="authKicker">Template</p>
                              <strong>UNO R4 WiFi LED</strong>
                            </div>
                            <span className="chip chipOnline">Ready</span>
                          </div>
                          <p className="builderCardCopy">One thing, one device, one LED widget, and a retained MQTT command topic.</p>
                        </article>
                        <article className="builderCard">
                          <div className="builderCardTop">
                            <div>
                              <p className="authKicker">Template</p>
                              <strong>Greenhouse Starter</strong>
                            </div>
                            <span className="chip">Draft</span>
                          </div>
                          <p className="builderCardCopy">Add sensors, dashboards, and trigger suggestions for a greenhouse deployment.</p>
                        </article>
                      </div>
                    </div>
                  ) : null}

                  {builderSection === "devices" || builderSection === "things" || builderSection === "dashboards" || builderSection === "triggers" || builderSection === "templates" ? null : null}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
