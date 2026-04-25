import { readFile, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..", "..");

function escapeCString(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function replaceConst(source, name, value) {
  const pattern = new RegExp(`const char\\* ${name} = ".*?";`);
  return source.replace(pattern, `const char* ${name} = "${escapeCString(value)}";`);
}

function replaceIntConst(source, name, value) {
  const pattern = new RegExp(`const int ${name} = \\d+;`);
  return source.replace(pattern, `const int ${name} = ${value};`);
}

function replaceBoolConst(source, name, value) {
  const pattern = new RegExp(`const bool ${name} = (true|false);`);
  return source.replace(pattern, `const bool ${name} = ${value ? "true" : "false"};`);
}

function resolveLanIp() {
  const interfaces = os.networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }

  return null;
}

function resolveArduinoCloudTarget(appOrigin) {
  const envHost = process.env.ARDUINO_CLOUD_HOST?.trim();
  const envPort = process.env.ARDUINO_CLOUD_PORT?.trim();
  const envUseSsl = process.env.ARDUINO_CLOUD_USE_SSL?.trim();

  if (envHost) {
    return {
      host: envHost,
      port: envPort ? Number(envPort) : 3000,
      useSsl: envUseSsl === "true"
    };
  }

  const fallback = {
    host: "localhost",
    port: 3000,
    useSsl: false
  };

  if (!appOrigin) {
    return fallback;
  }

  let url;
  try {
    url = new URL(appOrigin);
  } catch (error) {
    return fallback;
  }

  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const resolvedHost = isLocalHost ? resolveLanIp() || url.hostname : url.hostname;
  const resolvedPort = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;

  return {
    host: resolvedHost,
    port: resolvedPort,
    useSsl: url.protocol === "https:"
  };
}

export async function updateProvisionedArduinoSketch({
  appOrigin,
  wifiSsid,
  wifiPassword,
  deviceId,
  deviceSecret
}) {
  const cloudTarget = resolveArduinoCloudTarget(appOrigin);
  const sketchPaths = [
    path.join(repoRoot, "arduino", "arduino_mqtt_device.ino"),
    path.join(repoRoot, "arduino", "uno_r4_wifi_cloud_device.ino"),
    path.join(repoRoot, "arduino", "uno_r4_wifi_cloud_device", "uno_r4_wifi_cloud_device.ino")
  ];

  await Promise.all(
    sketchPaths.map(async (sketchPath) => {
      const current = await readFile(sketchPath, "utf8");
      let next = current;

      next = replaceConst(next, "WIFI_SSID", wifiSsid);
      next = replaceConst(next, "WIFI_PASSWORD", wifiPassword);
      next = replaceConst(next, "DEFAULT_WIFI_SSID", wifiSsid);
      next = replaceConst(next, "DEFAULT_WIFI_PASSWORD", wifiPassword);
      next = replaceConst(next, "CLOUD_HOST", cloudTarget.host);
      next = replaceIntConst(next, "CLOUD_PORT", cloudTarget.port);
      next = replaceBoolConst(next, "CLOUD_USE_SSL", cloudTarget.useSsl);
      next = replaceConst(next, "DEVICE_ID", deviceId);
      next = replaceConst(next, "DEVICE_SECRET", deviceSecret);

      if (next !== current) {
        await writeFile(sketchPath, next, "utf8");
      }
    })
  );
}
