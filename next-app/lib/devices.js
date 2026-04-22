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
        device_id VARCHAR(100) REFERENCES devices(device_id) ON DELETE CASCADE,
        owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        thing_name VARCHAR(150) NOT NULL,
        device_sketch VARCHAR(200) NOT NULL DEFAULT 'uno_r4_wifi_cloud_device',
        variables JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (device_id)
      );

      CREATE TABLE IF NOT EXISTS thing_variables (
        id SERIAL PRIMARY KEY,
        thing_id INTEGER NOT NULL REFERENCES things(id) ON DELETE CASCADE,
        variable_name VARCHAR(150) NOT NULL,
        variable_type VARCHAR(40) NOT NULL DEFAULT 'boolean',
        permission VARCHAR(40) NOT NULL DEFAULT 'read_write',
        declaration VARCHAR(150) NOT NULL DEFAULT '',
        update_policy VARCHAR(40) NOT NULL DEFAULT 'on_change',
        sync_enabled BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (thing_id, variable_name)
      );

      CREATE TABLE IF NOT EXISTS dashboards (
        id SERIAL PRIMARY KEY,
        owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        dashboard_name VARCHAR(150) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS dashboard_tiles (
        id SERIAL PRIMARY KEY,
        dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
        tile_name VARCHAR(150) NOT NULL,
        tile_type VARCHAR(40) NOT NULL,
        linked_thing_id INTEGER REFERENCES things(id) ON DELETE SET NULL,
        linked_variable_id INTEGER REFERENCES thing_variables(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE things
      ADD COLUMN IF NOT EXISTS device_sketch VARCHAR(200) NOT NULL DEFAULT 'uno_r4_wifi_cloud_device';

      ALTER TABLE things
      ADD COLUMN IF NOT EXISTS variables JSONB NOT NULL DEFAULT '[]'::jsonb;

      ALTER TABLE things
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

      ALTER TABLE things
      ALTER COLUMN device_id DROP NOT NULL;

      ALTER TABLE thing_variables
      ADD COLUMN IF NOT EXISTS declaration VARCHAR(150) NOT NULL DEFAULT '';

      ALTER TABLE thing_variables
      ADD COLUMN IF NOT EXISTS update_policy VARCHAR(40) NOT NULL DEFAULT 'on_change';

      ALTER TABLE thing_variables
      ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN NOT NULL DEFAULT false;

      ALTER TABLE thing_variables
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

      ALTER TABLE dashboards
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

      ALTER TABLE dashboard_tiles
      ADD COLUMN IF NOT EXISTS linked_thing_id INTEGER REFERENCES things(id) ON DELETE SET NULL;

      ALTER TABLE dashboard_tiles
      ADD COLUMN IF NOT EXISTS linked_variable_id INTEGER REFERENCES thing_variables(id) ON DELETE SET NULL;

      ALTER TABLE dashboard_tiles
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

      INSERT INTO thing_variables (
        thing_id,
        variable_name,
        variable_type,
        permission,
        declaration,
        update_policy,
        sync_enabled
      )
      SELECT
        things.id,
        COALESCE(NULLIF(variable_item->>'name', ''), 'variable_' || variable_position),
        COALESCE(NULLIF(variable_item->>'type', ''), 'boolean'),
        COALESCE(NULLIF(variable_item->>'permission', ''), 'read_write'),
        COALESCE(NULLIF(variable_item->>'declaration', ''), COALESCE(NULLIF(variable_item->>'name', ''), 'variable_' || variable_position)),
        COALESCE(NULLIF(variable_item->>'updatePolicy', ''), 'on_change'),
        COALESCE((variable_item->>'syncEnabled')::boolean, false)
      FROM things
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(things.variables, '[]'::jsonb)) WITH ORDINALITY AS variable_rows(variable_item, variable_position)
      ON CONFLICT (thing_id, variable_name) DO NOTHING;
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

async function createThingForUser({ userId, thingName, deviceSketch, deviceId = "" }) {
  await ensureDevicesSchema();
  const normalizedThingName = thingName.trim();
  const normalizedDeviceSketch = (deviceSketch || "uno_r4_wifi_cloud_device").trim();
  const normalizedDeviceId = deviceId.trim();

  if (normalizedDeviceId) {
    const deviceResult = await db.query(
      `
        SELECT device_id
        FROM devices
        WHERE device_id = $1
          AND owner_user_id = $2
      `,
      [normalizedDeviceId, userId]
    );

    if (!deviceResult.rows[0]) {
      return { ok: false, reason: "missing-device" };
    }
  }

  try {
    const result = await db.query(
      `
        INSERT INTO things (
          device_id,
          owner_user_id,
          thing_name,
          device_sketch
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id, device_id, thing_name
      `,
      [normalizedDeviceId || null, userId, normalizedThingName, normalizedDeviceSketch]
    );

    return { ok: true, thing: result.rows[0] || null };
  } catch (error) {
    if (error?.code === "23505") {
      return { ok: false, reason: "duplicate-device-link" };
    }

    throw error;
  }
}

async function listThings(userId) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      SELECT
        things.id AS thing_id,
        things.device_id,
        things.thing_name,
        things.device_sketch,
        things.created_at,
        things.updated_at,
        devices.device_name,
        devices.last_seen_at,
        devices.last_status,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', thing_variables.id,
              'name', thing_variables.variable_name,
              'type', thing_variables.variable_type,
              'permission', thing_variables.permission,
              'declaration', thing_variables.declaration,
              'updatePolicy', thing_variables.update_policy,
              'syncEnabled', thing_variables.sync_enabled,
              'createdAt', thing_variables.created_at,
              'updatedAt', thing_variables.updated_at
            )
            ORDER BY thing_variables.created_at ASC
          ) FILTER (WHERE thing_variables.id IS NOT NULL),
          '[]'::jsonb
        ) AS variables
      FROM things
      LEFT JOIN devices
        ON devices.device_id = things.device_id
       AND devices.owner_user_id = things.owner_user_id
      LEFT JOIN thing_variables
        ON thing_variables.thing_id = things.id
      WHERE things.owner_user_id = $1
      GROUP BY
        things.id,
        things.device_id,
        things.thing_name,
        things.device_sketch,
        things.created_at,
        things.updated_at,
        devices.device_name,
        devices.last_seen_at,
        devices.last_status
      ORDER BY things.created_at ASC
    `,
    [userId]
  );

  return result.rows;
}

async function getThingForUser(thingId, userId) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      SELECT
        things.id AS thing_id,
        things.device_id,
        things.thing_name,
        things.device_sketch,
        things.created_at,
        things.updated_at,
        devices.device_name,
        devices.last_seen_at,
        devices.last_status,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', thing_variables.id,
              'name', thing_variables.variable_name,
              'type', thing_variables.variable_type,
              'permission', thing_variables.permission,
              'declaration', thing_variables.declaration,
              'updatePolicy', thing_variables.update_policy,
              'syncEnabled', thing_variables.sync_enabled,
              'createdAt', thing_variables.created_at,
              'updatedAt', thing_variables.updated_at
            )
            ORDER BY thing_variables.created_at ASC
          ) FILTER (WHERE thing_variables.id IS NOT NULL),
          '[]'::jsonb
        ) AS variables
      FROM things
      LEFT JOIN devices
        ON devices.device_id = things.device_id
       AND devices.owner_user_id = things.owner_user_id
      LEFT JOIN thing_variables
        ON thing_variables.thing_id = things.id
      WHERE things.id = $1
        AND things.owner_user_id = $2
      GROUP BY
        things.id,
        things.device_id,
        things.thing_name,
        things.device_sketch,
        things.created_at,
        things.updated_at,
        devices.device_name,
        devices.last_seen_at,
        devices.last_status
    `,
    [thingId, userId]
  );

  return result.rows[0] || null;
}

async function listDashboards(userId) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      SELECT
        dashboards.id,
        dashboards.dashboard_name,
        dashboards.created_at,
        dashboards.updated_at,
        COUNT(dashboard_tiles.id) AS tile_count
      FROM dashboards
      LEFT JOIN dashboard_tiles
        ON dashboard_tiles.dashboard_id = dashboards.id
      WHERE dashboards.owner_user_id = $1
      GROUP BY dashboards.id, dashboards.dashboard_name, dashboards.created_at, dashboards.updated_at
      ORDER BY dashboards.created_at ASC
    `,
    [userId]
  );

  return result.rows;
}

async function getDashboardForUser(dashboardId, userId) {
  await ensureDevicesSchema();
  const dashboardResult = await db.query(
    `
      SELECT id, dashboard_name, created_at, updated_at
      FROM dashboards
      WHERE id = $1
        AND owner_user_id = $2
    `,
    [dashboardId, userId]
  );

  const dashboard = dashboardResult.rows[0];
  if (!dashboard) {
    return null;
  }

  const tilesResult = await db.query(
    `
      SELECT
        dashboard_tiles.id,
        dashboard_tiles.tile_name,
        dashboard_tiles.tile_type,
        dashboard_tiles.linked_thing_id,
        dashboard_tiles.linked_variable_id,
        dashboard_tiles.created_at,
        dashboard_tiles.updated_at,
        things.thing_name,
        thing_variables.variable_name
      FROM dashboard_tiles
      LEFT JOIN things
        ON things.id = dashboard_tiles.linked_thing_id
      LEFT JOIN thing_variables
        ON thing_variables.id = dashboard_tiles.linked_variable_id
      WHERE dashboard_tiles.dashboard_id = $1
      ORDER BY dashboard_tiles.created_at ASC
    `,
    [dashboardId]
  );

  return {
    ...dashboard,
    tiles: tilesResult.rows
  };
}

async function createDashboardForUser({ userId, dashboardName }) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      INSERT INTO dashboards (
        owner_user_id,
        dashboard_name
      )
      VALUES ($1, $2)
      RETURNING id, dashboard_name
    `,
    [userId, dashboardName.trim()]
  );

  return result.rows[0] || null;
}

async function addDashboardTileForUser({
  dashboardId,
  userId,
  tileName,
  tileType,
  linkedThingId,
  linkedVariableId
}) {
  await ensureDevicesSchema();
  const dashboardResult = await db.query(
    `
      SELECT id
      FROM dashboards
      WHERE id = $1
        AND owner_user_id = $2
    `,
    [dashboardId, userId]
  );

  if (!dashboardResult.rows[0]) {
    return { ok: false, reason: "missing-dashboard" };
  }

  if (!linkedThingId || !linkedVariableId) {
    return { ok: false, reason: "missing-variable" };
  }

  const linkResult = await db.query(
    `
      SELECT thing_variables.id
      FROM thing_variables
      JOIN things
        ON things.id = thing_variables.thing_id
      WHERE thing_variables.id = $1
        AND things.id = $2
        AND things.owner_user_id = $3
    `,
    [linkedVariableId, linkedThingId, userId]
  );

  if (!linkResult.rows[0]) {
    return { ok: false, reason: "missing-variable" };
  }

  const result = await db.query(
    `
      INSERT INTO dashboard_tiles (
        dashboard_id,
        tile_name,
        tile_type,
        linked_thing_id,
        linked_variable_id
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `,
    [dashboardId, tileName.trim(), tileType.trim().toLowerCase(), linkedThingId, linkedVariableId]
  );

  await db.query(
    `
      UPDATE dashboards
      SET updated_at = NOW()
      WHERE id = $1
        AND owner_user_id = $2
    `,
    [dashboardId, userId]
  );

  return { ok: true, tile: result.rows[0] || null };
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
  thingId,
  userId,
  variableName,
  variableType,
  permission
}) {
  await ensureDevicesSchema();
  const normalizedName = variableName.trim();
  const normalizedType = variableType.trim().toLowerCase();
  const normalizedPermission = permission.trim().toLowerCase();

  const thingResult = await db.query(
    `
      SELECT things.id AS thing_id
      FROM things
      WHERE things.id = $1
        AND things.owner_user_id = $2
    `,
    [thingId, userId]
  );

  const currentThing = thingResult.rows[0];
  if (!currentThing) {
    return { ok: false, reason: "missing-device" };
  }

  try {
    const insertResult = await db.query(
      `
        INSERT INTO thing_variables (
          thing_id,
          variable_name,
          variable_type,
          permission,
          declaration
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [currentThing.thing_id, normalizedName, normalizedType, normalizedPermission, normalizedName]
    );

    await db.query(
      `
        UPDATE things
        SET updated_at = NOW()
        WHERE id = $1
      `,
      [currentThing.thing_id]
    );

    return { ok: true, variable: insertResult.rows[0] || null };
  } catch (error) {
    if (error?.code === "23505") {
      return { ok: false, reason: "duplicate-variable" };
    }

    throw error;
  }
}

async function updateThingVariableForUser({
  variableId,
  thingId,
  userId,
  variableName,
  variableType,
  permission
}) {
  await ensureDevicesSchema();
  try {
    const result = await db.query(
      `
        UPDATE thing_variables
        SET
          variable_name = $4,
          declaration = $4,
          variable_type = $5,
          permission = $6,
          updated_at = NOW()
        FROM things
        WHERE thing_variables.id = $1
          AND thing_variables.thing_id = $2
          AND things.id = thing_variables.thing_id
          AND things.owner_user_id = $3
        RETURNING thing_variables.id
      `,
      [variableId, thingId, userId, variableName.trim(), variableType.trim().toLowerCase(), permission.trim().toLowerCase()]
    );

    if (!result.rows[0]) {
      return { ok: false, reason: "missing-variable" };
    }

    await db.query(
      `
        UPDATE things
        SET updated_at = NOW()
        WHERE id = $1
          AND owner_user_id = $2
      `,
      [thingId, userId]
    );

    return { ok: true };
  } catch (error) {
    if (error?.code === "23505") {
      return { ok: false, reason: "duplicate-variable" };
    }

    throw error;
  }
}

async function deleteThingVariableForUser({ variableId, thingId, userId }) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      DELETE FROM thing_variables
      USING things
      WHERE thing_variables.id = $1
        AND thing_variables.thing_id = $2
        AND things.id = thing_variables.thing_id
        AND things.owner_user_id = $3
      RETURNING thing_variables.id
    `,
    [variableId, thingId, userId]
  );

  if (!result.rows[0]) {
    return null;
  }

  await db.query(
    `
      UPDATE things
      SET updated_at = NOW()
      WHERE id = $1
        AND owner_user_id = $2
    `,
    [thingId, userId]
  );

  return result.rows[0];
}

async function renameThingForUser({ deviceId, userId, thingName }) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      UPDATE things
      SET
        thing_name = $3,
        updated_at = NOW()
      WHERE id = $1
        AND owner_user_id = $2
      RETURNING id, device_id, thing_name
    `,
    [deviceId, userId, thingName]
  );

  return result.rows[0] || null;
}

async function duplicateThingForUser({ thingId, userId }) {
  await ensureDevicesSchema();
  const sourceResult = await db.query(
    `
      SELECT
        things.id,
        things.device_id,
        things.thing_name,
        things.device_sketch
      FROM things
      WHERE things.id = $1
        AND things.owner_user_id = $2
    `,
    [thingId, userId]
  );

  const source = sourceResult.rows[0];
  if (!source) {
    return null;
  }

  const duplicatedThingResult = await db.query(
    `
      INSERT INTO things (
        device_id,
        owner_user_id,
        thing_name,
        device_sketch
      )
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `,
    [null, userId, `${source.thing_name} Copy`, source.device_sketch]
  );

  const duplicatedThing = duplicatedThingResult.rows[0];

  if (duplicatedThing) {
    await db.query(
      `
        INSERT INTO thing_variables (
          thing_id,
          variable_name,
          variable_type,
          permission,
          declaration,
          update_policy,
          sync_enabled
        )
        SELECT
          $2,
          thing_variables.variable_name,
          thing_variables.variable_type,
          thing_variables.permission,
          thing_variables.declaration,
          thing_variables.update_policy,
          thing_variables.sync_enabled
        FROM things
        JOIN thing_variables
          ON thing_variables.thing_id = things.id
        WHERE things.id = $1
          AND things.owner_user_id = $3
      `,
      [thingId, duplicatedThing.id, userId]
    );
  }

  return {
    thing_id: duplicatedThing?.id || null,
    thing_name: `${source.thing_name} Copy`
  };
}

async function deleteThingForUser({ thingId, userId }) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      DELETE FROM things
      WHERE id = $1
        AND owner_user_id = $2
      RETURNING id
    `,
    [thingId, userId]
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
  addDashboardTileForUser,
  connectDeviceToUser,
  createDashboardForUser,
  createThingForUser,
  createDevice,
  deleteThingVariableForUser,
  deleteDeviceForUser,
  deleteThingForUser,
  duplicateThingForUser,
  ensureThingForDevice,
  generateDeviceSecret,
  getDeviceCommandForHeartbeat,
  getDashboardForUser,
  getDeviceForUser,
  getThingForUser,
  listDashboards,
  listKnownWifiNetworks,
  listDevices,
  listThings,
  listRecentCommands,
  provisionDeviceForUser,
  renameThingForUser,
  saveCommand,
  saveDeviceWifiConfiguration,
  setDeviceLedState,
  updateThingVariableForUser,
  updateDeviceHeartbeat
};
