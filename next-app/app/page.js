import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes, randomUUID } from "crypto";
import DashboardAutoRefresh from "./DashboardAutoRefresh";
import DashboardSwitchTileButton from "./DashboardSwitchTileButton";
import DashboardWidgetModal from "./DashboardWidgetModal";
import DeviceSetupModal from "./DeviceSetupModal";
import LedToggleButton from "./LedToggleButton";
import {
  addThingVariableForUser,
  addDashboardTileForUser,
  createDashboardForUser,
  createThingForUser,
  deleteDashboardTileForUser,
  deleteDeviceForUser,
  deleteThingForUser,
  deleteThingVariableForUser,
  duplicateThingForUser,
  getDashboardForUser,
  getDeviceForUser,
  getThingForUser,
  listDashboards,
  listDevices,
  listKnownWifiNetworks,
  listThings,
  moveDashboardTileForUser,
  provisionDeviceForUser,
  renameThingForUser,
  saveDeviceWifiConfiguration,
  setDashboardTileVariableValueForUser,
  setDeviceLedState
  ,
  setThingVariableValueForUser,
  updateThingVariableForUser
} from "../lib/devices";
import { updateProvisionedArduinoSketch } from "../lib/arduino-sketch";
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

function generateProvisionedDeviceId() {
  return `arduino-${randomUUID()}`;
}

function generateProvisionedDeviceSecret() {
  return randomBytes(18).toString("base64url");
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

function formatVariableValue(value) {
  return value ? "true" : "false";
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

function buildDeviceSketchSnippet(origin, device) {
  let host = "localhost";
  let cloudPort = 3000;
  let useSsl = false;

  try {
    const url = new URL(origin);
    host = url.hostname;
    cloudPort = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    useSsl = url.protocol === "https:";
  } catch (error) {
    // Fall back to defaults when PUBLIC_APP_URL is malformed.
  }

  return `const char* DEFAULT_WIFI_SSID = "${device.wifi_ssid || ""}";
const char* DEFAULT_WIFI_PASSWORD = "${device.wifi_password || ""}";

const char* MQTT_HOST = "${host}";
const int MQTT_PORT = 1883;
const char* CLOUD_HOST = "${host}";
const int CLOUD_PORT = ${cloudPort};
const bool CLOUD_USE_SSL = ${useSsl ? "true" : "false"};

const char* DEVICE_ID = "${device.device_id}";
const char* DEVICE_SECRET = "${device.device_secret || ""}";`;
}

function buildThingVariableIdentifier(name, fallbackIndex = 1) {
  const normalized = String(name || "")
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized) {
    return `switch_${fallbackIndex}`;
  }

  return /^[a-zA-Z_]/.test(normalized) ? normalized : `switch_${fallbackIndex}_${normalized}`;
}

function buildThingSketchFiles(thing, origin) {
  const variables = (Array.isArray(thing.variables) ? thing.variables : []).map((variable, index) => ({
    ...variable,
    codeName: buildThingVariableIdentifier(variable.name, index + 1)
  }));
  const primaryVariable = variables[0]?.codeName || "switch_1";

  let host = "localhost";
  try {
    host = new URL(origin).hostname;
  } catch (error) {
    // Use localhost fallback.
  }

  const ino = `#include "thingProperties.h"

const int LED_PIN = 13;

void setup() {
  Serial.begin(115200);
  delay(1500);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  initProperties();
  ArduinoCloud.begin(ArduinoIoTPreferredConnection);

  setDebugMessageLevel(2);
  ArduinoCloud.printDebugInfo();
}

void loop() {
  ArduinoCloud.update();
}

void on${primaryVariable.charAt(0).toUpperCase()}${primaryVariable.slice(1)}Change() {
  digitalWrite(LED_PIN, ${primaryVariable} ? HIGH : LOW);
}`;

  const propertiesLines = variables.length
    ? variables
        .map(
          (variable) =>
            `bool ${variable.codeName};

void on${variable.codeName.charAt(0).toUpperCase()}${variable.codeName.slice(1)}Change();`
        )
        .join("\n\n")
    : `bool ${primaryVariable};

void on${primaryVariable.charAt(0).toUpperCase()}${primaryVariable.slice(1)}Change();`;

  const propertyRegistrations = (variables.length ? variables : [{ codeName: primaryVariable }])
    .map(
      (variable) =>
        `  ArduinoCloud.addProperty(${variable.codeName}, READWRITE, ON_CHANGE, on${variable.codeName.charAt(0).toUpperCase()}${variable.codeName.slice(1)}Change);`
    )
    .join("\n");

  const thingProperties = `#include <ArduinoIoTCloud.h>
#include <Arduino_ConnectionHandler.h>

const char DEVICE_LOGIN_NAME[]  = "${thing.device_id || ""}";
const char DEVICE_KEY[]         = "${thing.device_id || ""}";
const char DEVICE_SECRET[]      = "${thing.device_id ? "set-in-dashboard" : ""}";

const char SSID[]               = "${thing.device_name || ""}";
const char PASS[]               = "YOUR_WIFI_PASSWORD";

${propertiesLines}

WiFiConnectionHandler ArduinoIoTPreferredConnection(SSID, PASS);

void initProperties() {
${propertyRegistrations}
}
`;

  const readme = `Thing: ${thing.thing_name}
Device: ${thing.device_name || "Not linked yet"}
Cloud host: ${host}

How to use:
1. Copy the generated sketch into the Arduino IDE.
2. Replace Wi-Fi password in thingProperties.h.
3. Use the device credentials shown on the Devices page.
4. Upload to your Arduino UNO R4 WiFi.
`;

  return [
    { id: "ino", label: `${thing.thing_name || "thing"}.ino`, content: ino },
    { id: "properties", label: "thingProperties.h", content: thingProperties },
    { id: "readme", label: "README.txt", content: readme }
  ];
}

const builderSections = [
  { id: "things", label: "Things" },
  { id: "devices", label: "Devices" },
  { id: "dashboards", label: "Dashboards" },
  { id: "triggers", label: "Triggers" },
  { id: "templates", label: "Templates" }
];

const builderSidebarGroups = [
  {
    label: "Home",
    items: [{ id: "home", label: "Home", sectionId: "devices" }]
  },
  {
    label: "IoT Builder",
    items: builderSections.map((section) => ({
      id: section.id,
      label: section.label,
      sectionId: section.id
    }))
  }
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

function buildThingPageLink(thingId = "", tab = "variables", sketchFile = "") {
  return buildRedirect("/", {
    builder: "things",
    thingId,
    tab,
    sketchFile
  });
}

function buildDashboardPageLink(dashboardId = "", mode = "") {
  return buildRedirect("/", {
    builder: "dashboards",
    dashboardId,
    mode
  });
}

function formatDashboardTileTypeLabel(value) {
  return value
    .split("_")
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
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
  const providedDeviceId = normalizeField(formData.get("deviceId"));
  const deviceId = providedDeviceId || generateProvisionedDeviceId();
  const deviceName = normalizeField(formData.get("deviceName")) || "Arduino UNO R4 WiFi";
  const deviceType = normalizeField(formData.get("deviceType")) || "arduino";
  const providedDeviceSecret = normalizeField(formData.get("deviceSecret"));
  const deviceSecret = providedDeviceSecret || generateProvisionedDeviceSecret();
  const boardModel = normalizeField(formData.get("boardModel")) || "Arduino UNO R4 WiFi";
  const fqbn = normalizeField(formData.get("fqbn")) || "arduino:renesas_uno:unor4wifi";
  const serialNumber = normalizeField(formData.get("serialNumber"));
  const location = normalizeField(formData.get("location"));
  const selectedWifi = normalizeField(formData.get("selectedWifi"));
  const manualWifi = normalizeField(formData.get("manualWifi"));
  const wifiPassword = normalizeField(formData.get("wifiPassword"));
  const wifiSsid = manualWifi || selectedWifi;

  if (!wifiSsid || !wifiPassword) {
    redirect(
      buildRedirect("/", {
        authError: "Choose a Wi-Fi network and enter the Wi-Fi password.",
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

  try {
    await updateProvisionedArduinoSketch({
      appOrigin: getRequestOrigin(),
      wifiSsid,
      wifiPassword,
      deviceId,
      deviceSecret
    });
  } catch (error) {
    console.error("Failed to update Arduino sketch after provisioning", error);
  }

  revalidatePath("/");
  redirect(
    buildRedirect("/", {
      authMessage: `Arduino ${deviceId} saved and the sketch file was updated. Upload arduino_mqtt_device.ino to the board, then refresh this page to see it online.`,
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
  const thingId = normalizeField(formData.get("thingId"));
  const variableName = normalizeField(formData.get("variableName"));
  const variableType = "boolean";
  const permission = "read_write";

  if (!thingId || !variableName) {
    redirect(
      buildRedirect("/", {
        builder: "things",
        authError: "Enter a variable name."
      })
    );
  }

  const result = await addThingVariableForUser({
    thingId: Number(thingId),
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
            : "That thing is not connected to your account."
      })
    );
  }

  revalidatePath("/");
  redirect(buildRedirect("/", { builder: "things", thingId, authMessage: `Variable ${variableName} created.` }));
}

async function createThing(formData) {
  "use server";

  const user = await requireUser();
  const thingName = normalizeField(formData.get("thingName"));
  const deviceSketch = "uno_r4_wifi_cloud_device";
  const deviceId = normalizeField(formData.get("deviceId"));

  if (!thingName) {
    redirect(buildRedirect("/", { builder: "things", authError: "Enter a thing name." }));
  }

  const result = await createThingForUser({
    userId: user.id,
    thingName,
    deviceSketch,
    deviceId
  });

  if (!result.ok) {
    const message =
      result.reason === "duplicate-device-link"
        ? "That device is already linked to another thing."
        : "Choose a valid device or create the thing without linking a device yet.";

    redirect(buildRedirect("/", { builder: "things", authError: message }));
  }

  revalidatePath("/");
  redirect(buildRedirect("/", { builder: "things", thingId: result.thing?.id, authMessage: `Thing ${thingName} created.` }));
}

async function updateThingVariable(formData) {
  "use server";

  const user = await requireUser();
  const thingId = normalizeField(formData.get("thingId"));
  const variableId = normalizeField(formData.get("variableId"));
  const variableName = normalizeField(formData.get("variableName"));
  const variableType = "boolean";
  const permission = "read_write";

  if (!thingId || !variableId || !variableName) {
    redirect(buildRedirect("/", { builder: "things", thingId, authError: "Choose a valid variable." }));
  }

  const result = await updateThingVariableForUser({
    variableId: Number(variableId),
    thingId: Number(thingId),
    userId: user.id,
    variableName,
    variableType,
    permission
  });

  if (!result.ok) {
    const message =
      result.reason === "duplicate-variable"
        ? `Variable ${variableName} already exists for this thing.`
        : "Unable to update the variable.";

    redirect(buildRedirect("/", { builder: "things", thingId, authError: message }));
  }

  revalidatePath("/");
  redirect(buildRedirect("/", { builder: "things", thingId, authMessage: `Variable ${variableName} updated.` }));
}

async function toggleThingVariable(formData) {
  "use server";

  const user = await requireUser();
  const thingId = normalizeField(formData.get("thingId"));
  const variableId = normalizeField(formData.get("variableId"));
  const nextValue = normalizeField(formData.get("nextValue"));

  if (!thingId || !variableId || (nextValue !== "true" && nextValue !== "false")) {
    redirect(buildRedirect("/", { builder: "things", thingId, authError: "Unable to update the switch." }));
  }

  const thing = await getThingForUser(Number(thingId), user.id);
  if (!thing) {
    redirect(buildRedirect("/", { builder: "things", thingId, authError: "Thing not found." }));
  }

  if (thing.device_id) {
    const nextCommand = nextValue === "true" ? "ON" : "OFF";
    const published = await publishLedCommandWithCppApi({
      deviceId: thing.device_id,
      command: nextCommand
    });

    if (!published.ok) {
      redirect(buildRedirect("/", { builder: "things", thingId, authError: published.message }));
    }
  }

  const updated = await setThingVariableValueForUser({
    thingId: Number(thingId),
    variableId: Number(variableId),
    userId: user.id,
    value: nextValue === "true"
  });

  if (!updated) {
    redirect(buildRedirect("/", { builder: "things", thingId, authError: "Switch not found." }));
  }

  revalidatePath("/");
  redirect(buildRedirect("/", { builder: "things", thingId, authMessage: "Switch updated." }));
}

async function deleteThingVariable(formData) {
  "use server";

  const user = await requireUser();
  const thingId = normalizeField(formData.get("thingId"));
  const variableId = normalizeField(formData.get("variableId"));

  if (!thingId || !variableId) {
    redirect(buildRedirect("/", { builder: "things", thingId, authError: "Variable not found." }));
  }

  const deleted = await deleteThingVariableForUser({
    variableId: Number(variableId),
    thingId: Number(thingId),
    userId: user.id
  });

  if (!deleted) {
    redirect(buildRedirect("/", { builder: "things", thingId, authError: "Unable to delete the variable." }));
  }

  revalidatePath("/");
  redirect(buildRedirect("/", { builder: "things", thingId, authMessage: "Variable deleted." }));
}

async function renameThing(formData) {
  "use server";

  const user = await requireUser();
  const thingId = normalizeField(formData.get("thingId"));
  const thingName = normalizeField(formData.get("thingName"));

  if (!thingId || !thingName) {
    redirect(buildRedirect("/", { builder: "things", authError: "Enter a thing name." }));
  }

  const renamed = await renameThingForUser({
    deviceId: Number(thingId),
    userId: user.id,
    thingName
  });

  if (!renamed) {
    redirect(buildRedirect("/", { builder: "things", authError: "Thing not found." }));
  }

  revalidatePath("/");
  redirect(buildRedirect("/", { builder: "things", authMessage: `Thing renamed to ${thingName}.` }));
}

async function duplicateThing(formData) {
  "use server";

  const user = await requireUser();
  const thingId = normalizeField(formData.get("thingId"));

  if (!thingId) {
    redirect(buildRedirect("/", { builder: "things", authError: "Thing not found." }));
  }

  const duplicate = await duplicateThingForUser({
    thingId: Number(thingId),
    userId: user.id
  });

  if (!duplicate) {
    redirect(buildRedirect("/", { builder: "things", authError: "Unable to duplicate thing." }));
  }

  revalidatePath("/");
  redirect(
    buildRedirect("/", {
      builder: "things",
      authMessage: `Thing duplicated as ${duplicate.thing_name}.`
    })
  );
}

async function deleteThing(formData) {
  "use server";

  const user = await requireUser();
  const thingId = normalizeField(formData.get("thingId"));

  if (!thingId) {
    redirect(buildRedirect("/", { builder: "things", authError: "Thing not found." }));
  }

  const deleted = await deleteThingForUser({
    thingId: Number(thingId),
    userId: user.id
  });

  if (!deleted) {
    redirect(buildRedirect("/", { builder: "things", authError: "Unable to delete thing." }));
  }

  revalidatePath("/");
  redirect(buildRedirect("/", { builder: "things", authMessage: `Thing deleted.` }));
}

async function createDashboard(formData) {
  "use server";

  const user = await requireUser();
  const dashboardName = normalizeField(formData.get("dashboardName"));

  if (!dashboardName) {
    redirect(buildRedirect("/", { builder: "dashboards", authError: "Enter a dashboard name." }));
  }

  const dashboard = await createDashboardForUser({
    userId: user.id,
    dashboardName
  });

  revalidatePath("/");
  redirect(
    buildRedirect("/", {
      builder: "dashboards",
      dashboardId: dashboard?.id,
      authMessage: `Dashboard ${dashboardName} created.`
    })
  );
}

async function addDashboardTile(formData) {
  "use server";

  const user = await requireUser();
  const dashboardId = normalizeField(formData.get("dashboardId"));
  const tileName = normalizeField(formData.get("tileName"));
  const tileType = normalizeField(formData.get("tileType")) || "value";
  const linkedThingId = normalizeField(formData.get("linkedThingId"));
  const linkedVariableId = normalizeField(formData.get("linkedVariableId"));

  if (!dashboardId || !tileName || !linkedThingId || !linkedVariableId) {
    redirect(
      buildRedirect("/", {
        builder: "dashboards",
        dashboardId,
        authError: "Choose a dashboard tile name and link it to a variable."
      })
    );
  }

  const result = await addDashboardTileForUser({
    dashboardId: Number(dashboardId),
    userId: user.id,
    tileName,
    tileType,
    linkedThingId: Number(linkedThingId),
    linkedVariableId: Number(linkedVariableId)
  });

  if (!result.ok) {
    const message =
      result.reason === "missing-dashboard"
        ? "Dashboard not found."
        : "Choose a valid thing variable to link.";

    redirect(buildRedirect("/", { builder: "dashboards", dashboardId, authError: message }));
  }

  revalidatePath("/");
  redirect(buildRedirect("/", { builder: "dashboards", dashboardId, authMessage: `Tile ${tileName} added.` }));
}

async function moveDashboardTile(formData) {
  "use server";

  const user = await requireUser();
  const dashboardId = normalizeField(formData.get("dashboardId"));
  const tileId = normalizeField(formData.get("tileId"));
  const direction = normalizeField(formData.get("direction"));

  if (!dashboardId || !tileId || !["left", "right"].includes(direction)) {
    redirect(buildRedirect("/", { builder: "dashboards", dashboardId, mode: "edit", authError: "Unable to move widget." }));
  }

  await moveDashboardTileForUser({
    dashboardId: Number(dashboardId),
    tileId: Number(tileId),
    userId: user.id,
    direction
  });

  revalidatePath("/");
  redirect(buildRedirect("/", { builder: "dashboards", dashboardId, mode: "edit", authMessage: "Widget moved." }));
}

async function deleteDashboardTile(formData) {
  "use server";

  const user = await requireUser();
  const dashboardId = normalizeField(formData.get("dashboardId"));
  const tileId = normalizeField(formData.get("tileId"));

  if (!dashboardId || !tileId) {
    redirect(buildRedirect("/", { builder: "dashboards", dashboardId, mode: "edit", authError: "Unable to delete widget." }));
  }

  const deleted = await deleteDashboardTileForUser({
    dashboardId: Number(dashboardId),
    tileId: Number(tileId),
    userId: user.id
  });

  if (!deleted) {
    redirect(buildRedirect("/", { builder: "dashboards", dashboardId, mode: "edit", authError: "Widget not found." }));
  }

  revalidatePath("/");
  redirect(buildRedirect("/", { builder: "dashboards", dashboardId, mode: "edit", authMessage: "Widget deleted." }));
}

async function toggleDashboardTileVariable(formData) {
  "use server";

  const user = await requireUser();
  const dashboardId = normalizeField(formData.get("dashboardId"));
  const tileId = normalizeField(formData.get("tileId"));
  const nextValue = normalizeField(formData.get("nextValue"));

  if (!dashboardId || !tileId || (nextValue !== "true" && nextValue !== "false")) {
    redirect(
      buildRedirect("/", {
        builder: "dashboards",
        dashboardId,
        mode: "view",
        authError: "Unable to update the dashboard switch."
      })
    );
  }

  const dashboard = await getDashboardForUser(Number(dashboardId), user.id);
  const tile = dashboard?.tiles?.find((item) => String(item.id) === tileId) || null;

  if (!dashboard || !tile) {
    redirect(
      buildRedirect("/", {
        builder: "dashboards",
        dashboardId,
        mode: "view",
        authError: "Linked switch not found."
      })
    );
  }

  if (tile.device_id) {
    const nextCommand = nextValue === "true" ? "ON" : "OFF";
    const published = await publishLedCommandWithCppApi({
      deviceId: tile.device_id,
      command: nextCommand
    });

    if (!published.ok) {
      redirect(
        buildRedirect("/", {
          builder: "dashboards",
          dashboardId,
          mode: "view",
          authError: published.message
        })
      );
    }
  }

  const updated = await setDashboardTileVariableValueForUser({
    dashboardId: Number(dashboardId),
    tileId: Number(tileId),
    userId: user.id,
    value: nextValue === "true"
  });

  if (!updated) {
    redirect(
      buildRedirect("/", {
        builder: "dashboards",
        dashboardId,
        mode: "view",
        authError: "Linked switch not found."
      })
    );
  }

  revalidatePath("/");
  redirect(
    buildRedirect("/", {
      builder: "dashboards",
      dashboardId,
      mode: "view",
      authMessage: "Dashboard switch updated."
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
  const selectedThingId = searchParams?.thingId || "";
  const selectedThingTab = searchParams?.tab === "sketch" ? "sketch" : "variables";
  const selectedSketchFile = searchParams?.sketchFile || "ino";
  const selectedDashboardId = searchParams?.dashboardId || "";
  const dashboardMode = searchParams?.mode === "edit" ? "edit" : "view";
  const devices = user ? await listDevices(user.id) : [];
  const things = user ? await listThings(user.id) : [];
  const dashboards = user ? await listDashboards(user.id) : [];
  const knownWifiNetworks = user ? await listKnownWifiNetworks(user.id) : [];
  const selectedThing =
    user && selectedThingId ? await getThingForUser(Number(selectedThingId), user.id) : null;
  const selectedDashboard =
    user && selectedDashboardId ? await getDashboardForUser(Number(selectedDashboardId), user.id) : null;
  const visibleDevices = selectedDevice
    ? devices.filter((device) => device.device_id === selectedDevice)
    : devices;
  const deviceCount = devices.length;
  const onlineCount = devices.filter((device) => getDeviceConnectionState(device).isOnline).length;
  const thingItems = things.map((thing) => ({
    ...thing,
    variables: Array.isArray(thing.variables) ? thing.variables : []
  }));
  const showThingLanding = builderSection === "things" && !selectedThing && thingItems.length === 0;
  const variableOptions = thingItems.flatMap((thing) =>
    thing.variables.map((variable) => ({
      thingId: thing.thing_id,
      thingName: thing.thing_name,
      variableId: variable.id,
      variableName: variable.name
    }))
  );
  const thingSketchFiles = selectedThing ? buildThingSketchFiles(selectedThing, requestOrigin) : [];
  const activeThingSketchFile =
    thingSketchFiles.find((file) => file.id === selectedSketchFile) || thingSketchFiles[0] || null;

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
                  <div className="builderSidebarProfile">
                    <div className="builderSidebarAvatar">
                      {user.full_name?.slice(0, 1)?.toUpperCase() || "U"}
                    </div>
                    <div className="builderSidebarProfileText">
                      <strong>{user.full_name}</strong>
                      <span>{user.email}</span>
                    </div>
                  </div>
                  <div className="builderSidebarSections">
                    {builderSidebarGroups.map((group) => (
                      <div className="builderSidebarGroup" key={group.label}>
                        <div className="builderSidebarGroupHeader">
                          <span>{group.label}</span>
                          {group.label === "IoT Builder" ? <span className="builderSidebarChevron">▾</span> : null}
                        </div>
                        <nav className="builderNav">
                          {group.items.map((item) =>
                            item.disabled ? (
                              <span className="builderNavItem builderNavItemDisabled" key={item.id}>
                                {item.label}
                              </span>
                            ) : (
                              <a
                                key={item.id}
                                className={`builderNavItem ${builderSection === item.sectionId ? "builderNavItemActive" : ""}`}
                                href={buildBuilderLink(item.sectionId, selectedDevice)}
                              >
                                <span>{item.label}</span>
                                {item.sectionId === "things" ? <span className="builderNavItemPlus">+</span> : null}
                              </a>
                            )
                          )}
                        </nav>
                      </div>
                    ))}
                  </div>
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
                      {selectedThing ? (
                        <div className="thingDetailPage">
                          <div className="thingCloudHeader">
                            <div className="thingCloudBreadcrumbs">
                              <a href={buildThingPageLink()}>Things</a>
                              <span>›</span>
                              <strong>{selectedThing.thing_name}</strong>
                            </div>

                            <div className="thingCloudTabs">
                              <a
                                className={`thingCloudTab ${selectedThingTab === "variables" ? "thingCloudTabActive" : ""}`}
                                href={buildThingPageLink(selectedThing.thing_id, "variables")}
                              >
                                Data
                              </a>
                              <a
                                className={`thingCloudTab ${selectedThingTab === "sketch" ? "thingCloudTabActive" : ""}`}
                                href={buildThingPageLink(selectedThing.thing_id, "sketch")}
                              >
                                Sketch
                              </a>
                            </div>
                          </div>

                          {selectedThingTab === "variables" ? (
                            <section className="thingCloudPanel">
                              <div className="thingCloudPanelHead">
                                <div>
                                  <strong>Variables</strong>
                                  <p className="sectionCopy">
                                    Define the switch data your Thing exchanges with the device and shows on dashboards.
                                  </p>
                                </div>

                                <details className="thingCloudCreateVariable">
                                  <summary className="button buttonOn">+ Variable</summary>
                                  <div className="thingCloudCreatePanel">
                                    <form action={addThingVariable} className="thingCloudVariableForm">
                                      <input type="hidden" name="thingId" value={selectedThing.thing_id} />
                                      <input className="input" name="variableName" placeholder="switch_1" required />
                                      <button className="button buttonOn" type="submit">
                                        Add Switch
                                      </button>
                                    </form>
                                  </div>
                                </details>
                              </div>

                              {selectedThing.variables?.length ? (
                                <div className="thingCloudTable">
                                  <div className="thingCloudTableHead">
                                    <span>Name</span>
                                    <span>Last Value</span>
                                    <span>Last Update</span>
                                    <span>Actions</span>
                                  </div>

                                  {selectedThing.variables.map((variable) => (
                                    <div className="thingCloudTableRow" key={variable.id}>
                                      <strong>{variable.name}</strong>
                                      <span>{formatVariableValue(Boolean(variable.currentValue))}</span>
                                      <span>{formatDeviceDate(variable.currentValueUpdatedAt || variable.updatedAt || selectedThing.updated_at)}</span>
                                      <div className="thingCloudRowActions">
                                        <form action={toggleThingVariable}>
                                          <input type="hidden" name="thingId" value={selectedThing.thing_id} />
                                          <input type="hidden" name="variableId" value={variable.id} />
                                          <input type="hidden" name="nextValue" value={variable.currentValue ? "false" : "true"} />
                                          <button className="button buttonGhost" type="submit">
                                            {variable.currentValue ? "Turn Off" : "Turn On"}
                                          </button>
                                        </form>
                                        <form action={updateThingVariable} className="thingCloudInlineForm">
                                          <input type="hidden" name="thingId" value={selectedThing.thing_id} />
                                          <input type="hidden" name="variableId" value={variable.id} />
                                          <input className="input" name="variableName" defaultValue={variable.name} required />
                                          <button className="button buttonGhost" type="submit">
                                            Save
                                          </button>
                                        </form>
                                        <form action={deleteThingVariable}>
                                          <input type="hidden" name="thingId" value={selectedThing.thing_id} />
                                          <input type="hidden" name="variableId" value={variable.id} />
                                          <button className="button buttonDanger" type="submit">
                                            Delete
                                          </button>
                                        </form>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="historyCard">
                                  <strong>No switch variables yet</strong>
                                  <p className="sectionCopy">Use `+ Variable` to add your first switch.</p>
                                </div>
                              )}
                            </section>
                          ) : (
                            <section className="thingCloudPanel">
                              <div className="thingCloudPanelHead">
                                <div>
                                  <strong>Sketch</strong>
                                  <p className="sectionCopy">
                                    Generated switch-only sketch files for <code>{selectedThing.device_sketch || "uno_r4_wifi_cloud_device"}</code>.
                                  </p>
                                </div>
                              </div>

                              <div className="thingSketchFiles">
                                <div className="thingSketchTabs">
                                  {thingSketchFiles.map((file) => (
                                    <a
                                      key={file.id}
                                      className={`thingSketchTab ${activeThingSketchFile?.id === file.id ? "thingSketchTabActive" : ""}`}
                                      href={buildThingPageLink(selectedThing.thing_id, "sketch", file.id)}
                                    >
                                      {file.label}
                                    </a>
                                  ))}
                                </div>

                                {activeThingSketchFile ? (
                                  <pre className="thingSketchCode">
                                    <code>{activeThingSketchFile.content}</code>
                                  </pre>
                                ) : (
                                  <div className="historyCard">
                                    <strong>No sketch files yet</strong>
                                    <p className="sectionCopy">Add a switch variable to generate sketch code.</p>
                                  </div>
                                )}
                              </div>
                            </section>
                          )}
                        </div>
                      ) : (
                        <>
                          {showThingLanding ? (
                            <section className="thingLanding">
                              <div className="thingLandingHero">
                                <p className="thingLandingEyebrow">Things</p>
                                <h2>Create a clean Thing for a Switch</h2>
                                <p className="thingLandingCopy">
                                  Start with one simple switch-linked Thing. Later we can add more variable types and
                                  advanced controls.
                                </p>
                              </div>

                              <div className="thingLandingSteps">
                                <article className="thingLandingStep">
                                  <div className="thingLandingIllustration thingLandingIllustrationWindow">
                                    <span className="thingLandingWindowBar" />
                                    <span className="thingLandingChip" />
                                    <span className="thingLandingDashed" />
                                  </div>
                                  <strong>Create a Thing</strong>
                                  <p>
                                    Create one Thing and link it to your Arduino device with a clean name.
                                  </p>
                                </article>

                                <article className="thingLandingStep">
                                  <div className="thingLandingIllustration thingLandingIllustrationNetwork">
                                    <span className="thingLandingNode thingLandingNodeLarge" />
                                    <span className="thingLandingNode thingLandingNodeSmall" />
                                    <span className="thingLandingNode thingLandingNodeWifi" />
                                  </div>
                                  <strong>Associate Device</strong>
                                  <p>
                                    Choose the Arduino device that should control this switch.
                                  </p>
                                </article>

                                <article className="thingLandingStep">
                                  <div className="thingLandingIllustration thingLandingIllustrationCode">
                                    <span className="thingLandingNode thingLandingNodeLarge" />
                                    <span className="thingLandingNode thingLandingNodeCode" />
                                  </div>
                                  <strong>Add a Switch</strong>
                                  <p>
                                    Add one switch variable now. We can add more thing types later.
                                  </p>
                                </article>
                              </div>

                              <details className="thingCreateDisclosure">
                                <summary className="thingLandingCta">+ Create Thing</summary>
                                <div className="thingCreatePanel">
                                  <form action={createThing} className="createThingForm createThingFormLanding">
                                    <input className="input" name="thingName" placeholder="My Switch Thing" required />
                                    <select className="input" name="deviceId" defaultValue="">
                                      <option value="">No device linked yet</option>
                                      {devices.map((device) => (
                                        <option key={device.device_id} value={device.device_id}>
                                          {device.device_name} ({device.device_id})
                                        </option>
                                      ))}
                                    </select>
                                    <button className="button buttonOn" type="submit">
                                      Create Thing
                                    </button>
                                  </form>
                                </div>
                              </details>
                            </section>
                          ) : (
                            <>
                              <div className="historyCard">
                                <strong>Create Switch Thing</strong>
                                <p className="sectionCopy">
                                  Keep it simple: create a Thing and add only switch variables for now.
                                </p>
                                <form action={createThing} className="createThingForm">
                                  <input className="input" name="thingName" placeholder="My Switch Thing" required />
                                  <select className="input" name="deviceId" defaultValue="">
                                    <option value="">No device linked yet</option>
                                    {devices.map((device) => (
                                      <option key={device.device_id} value={device.device_id}>
                                        {device.device_name} ({device.device_id})
                                      </option>
                                    ))}
                                  </select>
                                  <button className="button buttonOn" type="submit">
                                    Create Thing
                                  </button>
                                </form>
                              </div>

                              <div className="thingsList">
                                {thingItems.map((thing) => (
                                  <article className="thingRow" key={thing.thing_id}>
                                    <div className="thingRowHeader">
                                      <div className="thingRowGrid">
                                        <div className="thingRowCell">
                                          <span>Thing Name</span>
                                          <strong>
                                            <a className="thingRowLink" href={buildThingPageLink(thing.thing_id)}>
                                              {thing.thing_name}
                                            </a>
                                          </strong>
                                        </div>
                                        <div className="thingRowCell">
                                          <span>Device</span>
                                          <strong>{thing.device_name || "Not linked yet"}</strong>
                                        </div>
                                        <div className="thingRowCell">
                                          <span>Last Modified</span>
                                          <strong>{formatDeviceDate(thing.updated_at)}</strong>
                                        </div>
                                        <div className="thingRowCell">
                                          <span>Creation Date</span>
                                          <strong>{formatDeviceDate(thing.created_at)}</strong>
                                        </div>
                                      </div>

                                      <details className="thingMenu">
                                        <summary className="thingMenuButton">...</summary>
                                        <div className="thingMenuPanel">
                                          <form action={renameThing} className="thingActionForm">
                                            <input type="hidden" name="thingId" value={thing.thing_id} />
                                            <input className="input" name="thingName" defaultValue={thing.thing_name} required />
                                            <button className="button buttonGhost" type="submit">
                                              Rename
                                            </button>
                                          </form>
                                          <form action={duplicateThing}>
                                            <input type="hidden" name="thingId" value={thing.thing_id} />
                                            <button className="button buttonGhost" type="submit">
                                              Duplicate
                                            </button>
                                          </form>
                                          <form action={deleteThing}>
                                            <input type="hidden" name="thingId" value={thing.thing_id} />
                                            <button className="button buttonDanger" type="submit">
                                              Delete
                                            </button>
                                          </form>
                                        </div>
                                      </details>
                                    </div>

                                    <div className="thingVariableSection">
                                      <div className="thingVariableSectionHeader">
                                        <strong>Variables</strong>
                                        <span>{thing.variables.length} saved</span>
                                      </div>

                                      <div className="thingRowActions">
                                        <a className="button buttonGhost" href={buildThingPageLink(thing.thing_id)}>
                                          Edit Variables
                                        </a>
                                      </div>

                                      <div className="builderPillRow">
                                        {thing.variables.length > 0 ? (
                                          thing.variables.map((variable) => (
                                            <span className="builderMiniPill" key={variable.id || variable.name}>
                                              {variable.name} · Switch
                                            </span>
                                          ))
                                        ) : (
                                          <span className="builderMiniPill">No switch added yet</span>
                                        )}
                                      </div>

                                      <form action={addThingVariable} className="thingVariableForm">
                                        <input type="hidden" name="thingId" value={thing.thing_id} />
                                        <input className="input" name="variableName" placeholder="switch_1" required />
                                        <button className="button buttonOn" type="submit">
                                          Add Switch
                                        </button>
                                      </form>
                                    </div>
                                  </article>
                                ))}
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  ) : null}

                  {builderSection === "devices" ? (
                    <div className="builderSection stackCompact">
                      <section className="deviceLanding">
                        <div className="deviceLandingHero">
                          <p className="thingLandingEyebrow">Devices</p>
                          <h2>Add a new Device</h2>
                          <p className="deviceLandingCopy">
                            Click the button below to open the setup popup and add your Arduino board.
                          </p>
                        </div>

                        <div className="deviceLandingAction">
                          <DeviceSetupModal
                            devices={devices.map((device) => ({
                              device_id: device.device_id,
                              device_name: device.device_name
                            }))}
                            knownWifiNetworks={knownWifiNetworks}
                            selectedDevice={selectedDevice}
                            saveWifiAction={saveAndConnectArduinoDevice}
                          />
                        </div>
                      </section>

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
                                <div className="deviceSketchBlock">
                                  <div className="deviceSketchHeader">
                                    <strong>Generated Sketch Config</strong>
                                    <span>Copy this into `arduino_mqtt_device.ino` for this device only.</span>
                                  </div>
                                  <pre className="deviceSketchCode">
                                    <code>{buildDeviceSketchSnippet(requestOrigin, device)}</code>
                                  </pre>
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
                      {selectedDashboard ? (
                        <div className="dashboardDetailPage">
                          <div className="dashboardCanvasHeader">
                            <div className="dashboardBreadcrumbs">
                              <a href={buildDashboardPageLink()}>Dashboards</a>
                              <span>/</span>
                              <strong>{selectedDashboard.dashboard_name}</strong>
                            </div>
                            <div className="sectionActions">
                              {dashboardMode === "edit" ? (
                                <a className="dashboardDoneButton" href={buildDashboardPageLink(selectedDashboard.id, "view")}>
                                  Done
                                </a>
                              ) : (
                                <a className="dashboardEditButton" href={buildDashboardPageLink(selectedDashboard.id, "edit")}>
                                  Edit
                                </a>
                              )}
                            </div>
                          </div>

                          {dashboardMode === "edit" ? (
                            <div className="dashboardCanvasToolbar">
                              <DashboardWidgetModal
                                action={addDashboardTile}
                                dashboardId={selectedDashboard.id}
                                variableOptions={variableOptions}
                              />
                              <div className="dashboardCanvasModes">
                                <span className="dashboardCanvasMode dashboardCanvasModeActive">Board</span>
                                <span className="dashboardCanvasMode">Phone</span>
                              </div>
                            </div>
                          ) : null}

                          <div className={`dashboardCanvasBoard ${dashboardMode === "view" ? "dashboardCanvasBoardView" : ""}`}>
                            {selectedDashboard.tiles?.length ? (
                              selectedDashboard.tiles.map((tile) => (
                                <article className={`dashboardCanvasTile dashboardCanvasTile${tile.tile_type}`} key={tile.id}>
                                  <div className="dashboardCanvasTileHead">
                                    <strong>{formatDashboardTileTypeLabel(tile.tile_type)}</strong>
                                    {dashboardMode === "edit" ? (
                                      <div className="dashboardTileEditActions">
                                        <form action={moveDashboardTile}>
                                          <input type="hidden" name="dashboardId" value={selectedDashboard.id} />
                                          <input type="hidden" name="tileId" value={tile.id} />
                                          <input type="hidden" name="direction" value="left" />
                                          <button className="dashboardTileIconButton" type="submit" aria-label="Move left">
                                            ←
                                          </button>
                                        </form>
                                        <form action={moveDashboardTile}>
                                          <input type="hidden" name="dashboardId" value={selectedDashboard.id} />
                                          <input type="hidden" name="tileId" value={tile.id} />
                                          <input type="hidden" name="direction" value="right" />
                                          <button className="dashboardTileIconButton" type="submit" aria-label="Move right">
                                            →
                                          </button>
                                        </form>
                                        <form action={deleteDashboardTile}>
                                          <input type="hidden" name="dashboardId" value={selectedDashboard.id} />
                                          <input type="hidden" name="tileId" value={tile.id} />
                                          <button className="dashboardTileDeleteButton" type="submit">
                                            Delete
                                          </button>
                                        </form>
                                      </div>
                                    ) : (
                                      <span className="dashboardCanvasExample">Example</span>
                                    )}
                                  </div>

                                  <div className="dashboardCanvasTileBody">
                                    {tile.tile_type === "switch" ? (
                                      dashboardMode === "view" ? (
                                        <div className="dashboardSwitchForm">
                                          <DashboardSwitchTileButton
                                            isOn={Boolean(tile.current_value)}
                                            dashboardId={selectedDashboard.id}
                                            tileId={tile.id}
                                          />
                                        </div>
                                      ) : (
                                        <div className={`dashboardSwitchPreview ${tile.current_value ? "dashboardSwitchPreviewOn" : ""}`}>
                                          <span>{tile.current_value ? "ON" : "OFF"}</span>
                                          <span className="dashboardSwitchKnob" />
                                        </div>
                                      )
                                    ) : null}

                                    {tile.tile_type === "status" ? (
                                      <div className="dashboardStatusPreview">{tile.current_value ? "ON" : "OFF"}</div>
                                    ) : null}

                                    {tile.tile_type === "button" ? (
                                      <div className="dashboardButtonPreview">
                                        <span />
                                      </div>
                                    ) : null}

                                    {tile.tile_type === "value_display" ? (
                                      <div className="dashboardValuePreview">
                                        <strong>{formatVariableValue(Boolean(tile.current_value))}</strong>
                                        <span>{tile.variable_name || "Value"}</span>
                                      </div>
                                    ) : null}

                                    {tile.tile_type === "led" ? (
                                      <div className="dashboardLedPreview">
                                        <span className={`dashboardLedBulb ${tile.current_value ? "dashboardLedBulbOn" : ""}`} />
                                        <strong>{tile.current_value ? "LED ON" : "LED OFF"}</strong>
                                      </div>
                                    ) : null}

                                    {tile.tile_type === "sidebar" ? (
                                      <div className="dashboardSidebarPreview">
                                        <strong>{tile.tile_name}</strong>
                                        <span>{tile.variable_name || "Linked variable"}</span>
                                      </div>
                                    ) : null}

                                    {!["switch", "status", "button", "value_display", "led", "sidebar"].includes(tile.tile_type) ? (
                                      <div className="dashboardGenericPreview">
                                        <strong>{tile.tile_name}</strong>
                                      </div>
                                    ) : null}
                                  </div>

                                  {dashboardMode === "edit" ? (
                                    <div className="dashboardCanvasTileMeta">
                                      <span>{tile.thing_name || "No thing linked"}</span>
                                      <strong>{tile.variable_name || "-"}</strong>
                                    </div>
                                  ) : (
                                    <div className="dashboardCanvasTileMeta dashboardCanvasTileMetaView">
                                      <span>{tile.variable_name || "Linked switch"}</span>
                                      <strong>{formatDeviceDate(tile.current_value_updated_at || tile.updated_at)}</strong>
                                    </div>
                                  )}
                                </article>
                              ))
                            ) : (
                              <div className="historyCard dashboardEmptyBoard">
                                <strong>No tiles yet</strong>
                                <p className="sectionCopy">Click Add and choose a widget to place it on the dashboard.</p>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="historyCard">
                            <strong>Create Dashboard</strong>
                            <p className="sectionCopy">Create a dashboard, open it, then add tiles linked to Thing variables.</p>
                            <form action={createDashboard} className="createDashboardForm createDashboardFormCompact">
                              <input className="input" name="dashboardName" placeholder="Greenhouse Dashboard" required />
                              <button className="button buttonOn" type="submit">
                                Create Dashboard
                              </button>
                            </form>
                          </div>

                          {dashboards.length ? (
                            <div className="dashboardList">
                              {dashboards.map((dashboard) => (
                                <a className="dashboardListItem" href={buildDashboardPageLink(dashboard.id)} key={dashboard.id}>
                                  <div>
                                    <p className="authKicker">Dashboard</p>
                                    <strong>{dashboard.dashboard_name}</strong>
                                  </div>
                                  <span className="builderMiniPill">{dashboard.tile_count} tiles</span>
                                </a>
                              ))}
                            </div>
                          ) : (
                            <div className="historyCard">
                              <strong>No dashboards yet</strong>
                              <p className="sectionCopy">Create your first dashboard to add switch, value, and LED tiles.</p>
                            </div>
                          )}
                        </>
                      )}
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
