const db = require("./db");
const { randomBytes } = require("node:crypto");
let devicesSchemaReadyPromise;

function generateDeviceSecret() {
  return randomBytes(18).toString("base64url");
}

async function ensureDevicesSchema() {
  if (!devicesSchemaReadyPromise) {
    devicesSchemaReadyPromise = db.query(`
      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS wifi_ssid VARCHAR(150);

      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS wifi_password TEXT;

      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS wifi_configured_at TIMESTAMPTZ;

      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS board_model VARCHAR(150);

      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS fqbn VARCHAR(200);

      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS serial_number VARCHAR(150);

      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS led_state VARCHAR(10) NOT NULL DEFAULT 'OFF';

      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS thing_variables JSONB NOT NULL DEFAULT '[]'::jsonb;

      CREATE TABLE IF NOT EXISTS things (
        id SERIAL PRIMARY KEY,
        device_id VARCHAR(100) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
        owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        thing_name VARCHAR(150) NOT NULL,
        device_sketch VARCHAR(200) NOT NULL DEFAULT 'uno_r4_wifi_cloud_device',
        variables JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (device_id)
      );

      ALTER TABLE things
      ADD COLUMN IF NOT EXISTS device_sketch VARCHAR(200) NOT NULL DEFAULT 'uno_r4_wifi_cloud_device';

      ALTER TABLE things
      ADD COLUMN IF NOT EXISTS variables JSONB NOT NULL DEFAULT '[]'::jsonb;

      ALTER TABLE things
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);
  }

  await devicesSchemaReadyPromise;
}

async function ensureThingForDevice({ deviceId, userId, thingName }) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      INSERT INTO things (
        device_id,
        owner_user_id,
        thing_name
      )
      VALUES ($1, $2, $3)
      ON CONFLICT (device_id) DO UPDATE
      SET
        owner_user_id = EXCLUDED.owner_user_id,
        thing_name = COALESCE(NULLIF(things.thing_name, ''), EXCLUDED.thing_name)
      RETURNING id
    `,
    [deviceId, userId, thingName]
  );

  return result.rows[0] || null;
}

async function listDevices(userId) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      SELECT
        devices.device_id,
        devices.device_name,
        devices.device_type,
        devices.board_model,
        devices.fqbn,
        devices.serial_number,
        devices.location,
        devices.wifi_ssid,
        devices.wifi_configured_at,
        devices.device_secret,
        devices.last_seen_at,
        devices.last_status,
        devices.led_state,
        COALESCE(things.variables, devices.thing_variables, '[]'::jsonb) AS thing_variables,
        things.thing_name,
        things.device_sketch,
        things.created_at AS thing_created_at,
        things.updated_at AS thing_updated_at,
        devices.created_at
      FROM devices
      LEFT JOIN things
        ON things.device_id = devices.device_id
       AND things.owner_user_id = devices.owner_user_id
      WHERE devices.owner_user_id = $1
      ORDER BY devices.created_at ASC
    `,
    [userId]
  );

  return result.rows;
}

async function listKnownWifiNetworks(userId) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      SELECT DISTINCT wifi_ssid
      FROM devices
      WHERE owner_user_id = $1
        AND wifi_ssid IS NOT NULL
        AND wifi_ssid <> ''
      ORDER BY wifi_ssid ASC
    `,
    [userId]
  );

  return result.rows.map((row) => row.wifi_ssid);
}

async function listRecentCommands(userId, limit = 20) {
  const result = await db.query(
    `
      SELECT c.id, c.device_id, c.command, c.source, c.created_at
      FROM led_commands c
      JOIN devices d ON d.device_id = c.device_id
      WHERE d.owner_user_id = $1
      ORDER BY c.created_at DESC
      LIMIT $2
    `,
    [userId, limit]
  );

  return result.rows;
}

async function createDevice({
  deviceId,
  deviceName,
  deviceType,
  location,
  ownerUserId
}) {
  const deviceSecret = generateDeviceSecret();

  return db.query(
    `
      INSERT INTO devices (
        device_id,
        device_name,
        device_type,
        location,
        device_secret,
        owner_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [deviceId, deviceName, deviceType, location || null, deviceSecret, ownerUserId]
  );
}

async function provisionDeviceForUser({
  deviceId,
  deviceName,
  deviceType,
  deviceSecret,
  boardModel,
  fqbn,
  serialNumber,
  location,
  userId
}) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      INSERT INTO devices (
        device_id,
        device_name,
        device_type,
        board_model,
        fqbn,
        serial_number,
        location,
        device_secret,
        owner_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (device_id) DO UPDATE
      SET
        owner_user_id = EXCLUDED.owner_user_id,
        device_name = COALESCE(NULLIF(EXCLUDED.device_name, ''), devices.device_name),
        device_type = COALESCE(NULLIF(EXCLUDED.device_type, ''), devices.device_type),
        board_model = COALESCE(NULLIF(EXCLUDED.board_model, ''), devices.board_model),
        fqbn = COALESCE(NULLIF(EXCLUDED.fqbn, ''), devices.fqbn),
        serial_number = COALESCE(NULLIF(EXCLUDED.serial_number, ''), devices.serial_number),
        location = COALESCE(NULLIF(EXCLUDED.location, ''), devices.location),
        device_secret = COALESCE(NULLIF(EXCLUDED.device_secret, ''), devices.device_secret)
      WHERE devices.owner_user_id IS NULL
        OR devices.owner_user_id = EXCLUDED.owner_user_id
      RETURNING device_id, device_secret
    `,
    [
      deviceId,
      deviceName || deviceId,
      deviceType || "arduino",
      boardModel || "Arduino UNO R4 WiFi",
      fqbn || "arduino:renesas_uno:unor4wifi",
      serialNumber || null,
      location || null,
      deviceSecret || generateDeviceSecret(),
      userId
    ]
  );

  const device = result.rows[0] || null;

  if (device) {
    await ensureThingForDevice({
      deviceId,
      userId,
      thingName: `${deviceName || deviceId} Thing`
    });
  }

  return device;
}

async function connectDeviceToUser({ deviceId, userId }) {
  const result = await db.query(
    `
      UPDATE devices
      SET
        owner_user_id = $2,
        device_secret = COALESCE(device_secret, $3)
      WHERE device_id = $1
        AND (owner_user_id IS NULL OR owner_user_id = $2)
      RETURNING device_id, device_secret
    `,
    [deviceId, userId, generateDeviceSecret()]
  );

  return result.rows[0] || null;
}

async function getDeviceForUser(deviceId, userId) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      SELECT
        devices.device_id,
        devices.device_name,
        devices.wifi_ssid,
        devices.last_seen_at,
        devices.last_status,
        devices.led_state,
        COALESCE(things.variables, devices.thing_variables, '[]'::jsonb) AS thing_variables,
        things.thing_name,
        things.device_sketch,
        things.created_at AS thing_created_at,
        things.updated_at AS thing_updated_at
      FROM devices
      LEFT JOIN things
        ON things.device_id = devices.device_id
       AND things.owner_user_id = devices.owner_user_id
      WHERE devices.device_id = $1
        AND devices.owner_user_id = $2
    `,
    [deviceId, userId]
  );

  return result.rows[0] || null;
}

async function saveDeviceWifiConfiguration({
  deviceId,
  userId,
  wifiSsid,
  wifiPassword
}) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      UPDATE devices
      SET
        wifi_ssid = $3,
        wifi_password = $4,
        wifi_configured_at = NOW()
      WHERE device_id = $1
        AND owner_user_id = $2
      RETURNING device_id, wifi_ssid, wifi_configured_at, last_seen_at, last_status
    `,
    [deviceId, userId, wifiSsid, wifiPassword]
  );

  return result.rows[0] || null;
}

async function saveCommand({ deviceId, command, source = "next-app" }) {
  return db.query(
    `
      INSERT INTO led_commands (device_id, command, source)
      VALUES ($1, $2, $3)
    `,
    [deviceId, command, source]
  );
}

async function setDeviceLedState({ deviceId, userId, command, source = "next-app" }) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      UPDATE devices
      SET led_state = $3
      WHERE device_id = $1
        AND owner_user_id = $2
      RETURNING device_id, led_state
    `,
    [deviceId, userId, command]
  );

  if (!result.rows[0]) {
    return null;
  }

  await saveCommand({
    deviceId,
    command,
    source
  });

  return result.rows[0];
}

async function addThingVariableForUser({
  deviceId,
  userId,
  variableName,
  variableType,
  permission
}) {
  await ensureDevicesSchema();
  const normalizedName = variableName.trim();
  const normalizedType = variableType.trim().toLowerCase();
  const normalizedPermission = permission.trim().toLowerCase();

  const currentResult = await db.query(
    `
      SELECT COALESCE(things.variables, devices.thing_variables, '[]'::jsonb) AS thing_variables
      FROM devices
      LEFT JOIN things
        ON things.device_id = devices.device_id
       AND things.owner_user_id = devices.owner_user_id
      WHERE devices.device_id = $1
        AND devices.owner_user_id = $2
    `,
    [deviceId, userId]
  );

  const currentDevice = currentResult.rows[0];
  if (!currentDevice) {
    return { ok: false, reason: "missing-device" };
  }

  const variables = Array.isArray(currentDevice.thing_variables) ? currentDevice.thing_variables : [];
  const exists = variables.some(
    (item) => typeof item?.name === "string" && item.name.toLowerCase() === normalizedName.toLowerCase()
  );

  if (exists) {
    return { ok: false, reason: "duplicate-variable" };
  }

  const nextVariables = [
    ...variables,
    {
      name: normalizedName,
      type: normalizedType,
      permission: normalizedPermission
    }
  ];

  const updateResult = await db.query(
    `
      UPDATE things
      SET
        variables = $3::jsonb,
        updated_at = NOW()
      WHERE device_id = $1
        AND owner_user_id = $2
      RETURNING device_id, variables
    `,
    [deviceId, userId, JSON.stringify(nextVariables)]
  );

  if (!updateResult.rows[0]) {
    return { ok: false, reason: "missing-device" };
  }

  await db.query(
    `
      UPDATE devices
      SET thing_variables = $3::jsonb
      WHERE device_id = $1
        AND owner_user_id = $2
    `,
    [deviceId, userId, JSON.stringify(nextVariables)]
  );

  return { ok: true, device: updateResult.rows[0] };
}

async function renameThingForUser({ deviceId, userId, thingName }) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      UPDATE things
      SET
        thing_name = $3,
        updated_at = NOW()
      WHERE device_id = $1
        AND owner_user_id = $2
      RETURNING device_id, thing_name
    `,
    [deviceId, userId, thingName]
  );

  return result.rows[0] || null;
}

async function duplicateThingForUser({ deviceId, userId }) {
  await ensureDevicesSchema();
  const sourceResult = await db.query(
    `
      SELECT
        devices.device_name,
        devices.device_type,
        devices.board_model,
        devices.fqbn,
        devices.serial_number,
        devices.location,
        devices.wifi_ssid,
        devices.wifi_password,
        devices.wifi_configured_at,
        devices.led_state,
        COALESCE(things.variables, devices.thing_variables, '[]'::jsonb) AS variables,
        COALESCE(things.thing_name, devices.device_name || ' Thing') AS thing_name,
        COALESCE(things.device_sketch, 'uno_r4_wifi_cloud_device') AS device_sketch
      FROM devices
      LEFT JOIN things
        ON things.device_id = devices.device_id
       AND things.owner_user_id = devices.owner_user_id
      WHERE devices.device_id = $1
        AND devices.owner_user_id = $2
    `,
    [deviceId, userId]
  );

  const source = sourceResult.rows[0];
  if (!source) {
    return null;
  }

  const duplicateDeviceId = `${deviceId}-copy-${Date.now()}`;
  const duplicateVariables = JSON.stringify(source.variables || []);
  const duplicateSecret = generateDeviceSecret();

  await db.query(
    `
      INSERT INTO devices (
        device_id,
        device_name,
        device_type,
        board_model,
        fqbn,
        serial_number,
        location,
        wifi_ssid,
        wifi_password,
        wifi_configured_at,
        device_secret,
        led_state,
        thing_variables,
        owner_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
    `,
    [
      duplicateDeviceId,
      `${source.device_name} Copy`,
      source.device_type,
      source.board_model,
      source.fqbn,
      source.serial_number,
      source.location,
      source.wifi_ssid,
      source.wifi_password,
      source.wifi_configured_at,
      duplicateSecret,
      source.led_state,
      duplicateVariables,
      userId
    ]
  );

  await db.query(
    `
      INSERT INTO things (
        device_id,
        owner_user_id,
        thing_name,
        device_sketch,
        variables
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [duplicateDeviceId, userId, `${source.thing_name} Copy`, source.device_sketch, duplicateVariables]
  );

  return {
    device_id: duplicateDeviceId,
    thing_name: `${source.thing_name} Copy`
  };
}

async function deleteThingForUser({ deviceId, userId }) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      DELETE FROM things
      WHERE device_id = $1
        AND owner_user_id = $2
      RETURNING device_id
    `,
    [deviceId, userId]
  );

  return result.rows[0] || null;
}

async function deleteDeviceForUser({ deviceId, userId }) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      DELETE FROM devices
      WHERE device_id = $1
        AND owner_user_id = $2
      RETURNING device_id
    `,
    [deviceId, userId]
  );

  return result.rows[0] || null;
}

async function getDeviceCommandForHeartbeat({ deviceId, deviceSecret }) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      UPDATE devices
      SET
        last_seen_at = NOW(),
        last_status = 'online'
      WHERE device_id = $1
        AND device_secret = $2
      RETURNING device_id, led_state, last_seen_at, last_status
    `,
    [deviceId, deviceSecret]
  );

  return result.rows[0] || null;
}

async function updateDeviceHeartbeat({ deviceId, deviceSecret, status = "online" }) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      UPDATE devices
      SET
        last_seen_at = NOW(),
        last_status = $3
      WHERE device_id = $1
        AND device_secret = $2
      RETURNING device_id, last_seen_at, last_status
    `,
    [deviceId, deviceSecret, status]
  );

  if (result.rows[0]) {
    return {
      ...result.rows[0],
      secret_repaired: false
    };
  }

  const repairedResult = await db.query(
    `
      UPDATE devices
      SET
        device_secret = $2,
        last_seen_at = NOW(),
        last_status = $3
      WHERE device_id = $1
      RETURNING device_id, last_seen_at, last_status
    `,
    [deviceId, deviceSecret, status]
  );

  if (!repairedResult.rows[0]) {
    return null;
  }

  return {
    ...repairedResult.rows[0],
    secret_repaired: true
  };
}

module.exports = {
  addThingVariableForUser,
  connectDeviceToUser,
  createDevice,
  deleteDeviceForUser,
  deleteThingForUser,
  duplicateThingForUser,
  ensureThingForDevice,
  generateDeviceSecret,
  getDeviceCommandForHeartbeat,
  getDeviceForUser,
  listKnownWifiNetworks,
  listDevices,
  listRecentCommands,
  provisionDeviceForUser,
  renameThingForUser,
  saveCommand,
  saveDeviceWifiConfiguration,
  setDeviceLedState,
  updateDeviceHeartbeat
};
