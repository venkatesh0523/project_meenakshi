# Project Architecture

This project is a small Arduino cloud dashboard. A logged-in user can register an Arduino UNO R4 WiFi, see whether it is online, and send an ON/OFF command for the GPIO 13 LED.

The current working device-control path uses C++ API plus MQTT for LED commands, and Next.js heartbeat for status:

```text
Dashboard -> Next.js server action -> cpp-api -> MQTT broker -> Arduino UNO R4 WiFi
Arduino UNO R4 WiFi -> Next.js heartbeat API -> PostgreSQL
```

The dashboard does not directly connect to the Arduino. It sends a command to `cpp-api`, `cpp-api` publishes an MQTT message, and the Arduino receives that MQTT command.

## Runtime Services

The services are defined in [docker-compose.yml](../docker-compose.yml).

| Service | Container | Port | Purpose |
| --- | --- | --- | --- |
| `next-app` | `farm-next-app` | `3000` | Web dashboard, login, device registry, heartbeat API |
| `db` | `farm-db` | `5432` | PostgreSQL database for users, sessions, devices, and command history |
| `cpp-api` | `farm-cpp-api` | `8080` | HTTP-to-MQTT LED command API |
| `mqtt` | `farm-mqtt` | `1883`, `9001` | Mosquitto broker for Arduino LED commands |

For the current UNO R4 WiFi cloud dashboard, the important public service is:

```text
next-app on port 3000
mqtt on port 1883
```

PostgreSQL and the C++ API do not need to be public. Next.js reaches `cpp-api` inside Docker through `http://cpp-api:8080`.

## Main Components

### Next.js Dashboard

Files:

- [next-app/app/page.js](../next-app/app/page.js)
- [next-app/app/WifiSerialProvisioner.js](../next-app/app/WifiSerialProvisioner.js)
- [next-app/app/DashboardAutoRefresh.js](../next-app/app/DashboardAutoRefresh.js)
- [next-app/app/globals.css](../next-app/app/globals.css)

Responsibilities:

- Register/login users.
- Save Arduino device information.
- Generate or keep a per-device secret.
- Show device status as `Online` or `Offline`.
- Send GPIO 13 LED commands through `cpp-api`.
- Delete devices from the logged-in user's account.
- Show the heartbeat URL and MQTT command topic.

### Device API

Files:

- [next-app/app/api/devices/[deviceId]/command/route.js](../next-app/app/api/devices/[deviceId]/command/route.js)
- [next-app/app/api/devices/[deviceId]/heartbeat/route.js](../next-app/app/api/devices/[deviceId]/heartbeat/route.js)

The current Arduino sketch uses this endpoint only for heartbeat/status:

```text
POST /api/devices/<deviceId>/heartbeat
```

This endpoint does two jobs:

1. Authenticates the Arduino using `device_id` and `device_secret`.
2. Updates `last_seen_at` so the dashboard can show `Online`.

Example response:

```json
{
  "deviceId": "YOUR_DEVICE_ID",
  "message": "Heartbeat accepted",
  "lastSeenAt": "2026-04-19T18:35:07.328Z",
  "status": "online"
}
```

### Database Layer

Files:

- [next-app/lib/db.js](../next-app/lib/db.js)
- [next-app/lib/devices.js](../next-app/lib/devices.js)
- [db/init/01-schema.sql](../db/init/01-schema.sql)

Important functions in [next-app/lib/devices.js](../next-app/lib/devices.js):

| Function | Purpose |
| --- | --- |
| `listDevices` | Loads devices for the logged-in user |
| `provisionDeviceForUser` | Creates or updates a device for a user |
| `saveDeviceWifiConfiguration` | Saves SSID/password metadata in the database |
| `setDeviceLedState` | Stores desired LED state after `cpp-api` publishes `ON` or `OFF` |
| `updateDeviceHeartbeat` | Authenticates Arduino and refreshes `last_seen_at` |
| `deleteDeviceForUser` | Deletes a device owned by the logged-in user |

## Database Schema

The core tables are:

```text
users
user_sessions
pending_user_registrations
devices
led_commands
```

The most important table for Arduino connection is `devices`.

Important `devices` columns:

| Column | Meaning |
| --- | --- |
| `device_id` | Public identifier for the Arduino |
| `device_secret` | Secret token used by the Arduino to authenticate |
| `owner_user_id` | User who owns the device |
| `device_name` | Friendly name shown in dashboard |
| `board_model` | Example: `Arduino UNO R4 WiFi` |
| `fqbn` | Example: `arduino:renesas_uno:unor4wifi` |
| `serial_number` | Board serial number |
| `wifi_ssid` | Saved Wi-Fi network name |
| `wifi_password` | Saved Wi-Fi password |
| `last_seen_at` | Last time the Arduino successfully called the API |
| `last_status` | Last stored status, usually `online` |
| `led_state` | Desired GPIO 13 LED state, `ON` or `OFF` |

The `led_commands` table keeps a simple command history.

## Arduino Sketches

Files:

- [arduino/uno_r4_wifi_cloud_device/uno_r4_wifi_cloud_device.ino](../arduino/uno_r4_wifi_cloud_device/uno_r4_wifi_cloud_device.ino)
- [arduino/uno_r4_wifi_cloud_device.ino](../arduino/uno_r4_wifi_cloud_device.ino)
- [arduino/arduino_mqtt_device.ino](../arduino/arduino_mqtt_device.ino)

Use this sketch for the current Oracle Cloud dashboard:

```text
arduino/uno_r4_wifi_cloud_device/uno_r4_wifi_cloud_device.ino
```

The folder version exists because Arduino CLI expects this structure:

```text
sketch_folder/sketch_folder.ino
```

The current sketch does this:

1. Connects to Wi-Fi using `WIFI_SSID` and `WIFI_PASSWORD`.
2. Connects to MQTT at `MQTT_HOST:MQTT_PORT`.
3. Subscribes to `farm1/<deviceId>/cmd`.
4. Turns GPIO 13 LED on or off when MQTT payload is `ON` or `OFF`.
5. Sends heartbeat to `CLOUD_HOST:CLOUD_PORT` so the dashboard can show online/offline status.

Important sketch constants:

```cpp
const char* WIFI_SSID = "Telia-B798AC";
const char* WIFI_PASSWORD = "...";

const char* MQTT_HOST = "YOUR_ORACLE_PUBLIC_IP";
const int MQTT_PORT = 1883;

const char* CLOUD_HOST = "YOUR_ORACLE_PUBLIC_IP";
const int CLOUD_PORT = 3000;
const bool CLOUD_USE_SSL = false;

const char* DEVICE_ID = "YOUR_DEVICE_ID";
const char* DEVICE_SECRET = "YOUR_DEVICE_SECRET";
```

If Oracle Cloud uses plain HTTP on port `3000`:

```cpp
const char* CLOUD_HOST = "YOUR_ORACLE_PUBLIC_IP";
const int CLOUD_PORT = 3000;
const bool CLOUD_USE_SSL = false;
```

If Oracle Cloud uses HTTPS with a domain:

```cpp
const char* CLOUD_HOST = "your-domain.example";
const int CLOUD_PORT = 443;
const bool CLOUD_USE_SSL = true;
```

The older [arduino/arduino_mqtt_device.ino](../arduino/arduino_mqtt_device.ino) file is an ESP32-style MQTT sketch. The UNO R4 sketch above is the current dashboard control path.

## Identity And Connection Model

The app identifies a physical Arduino using:

```text
DEVICE_ID + DEVICE_SECRET
```

The dashboard stores those values in PostgreSQL. The Arduino sketch must contain the same values.

When the Arduino sends heartbeat:

```text
POST /api/devices/<deviceId>/heartbeat
```

the server runs a database update matching both values:

```sql
WHERE device_id = $1
  AND device_secret = $2
```

If both match, the app treats the Arduino as authenticated.

## Online And Offline Status

The dashboard does not keep a permanent socket open to the board.

Instead:

1. Arduino posts heartbeat to the Next.js API.
2. The endpoint updates `devices.last_seen_at = NOW()`.
3. The dashboard checks how old `last_seen_at` is.
4. If `last_seen_at` is less than about 60 seconds old, the dashboard shows `Online`.
5. If no request arrives for more than about 60 seconds, the dashboard shows `Offline`.

This logic is in [next-app/app/page.js](../next-app/app/page.js), in `getDeviceConnectionState`.

## LED ON/OFF Flow

When the user clicks the LED button:

```text
Dashboard button
-> page.js server action toggleLedCommand
-> cpp-api POST /api/devices/<deviceId>/commands/on|off
-> cpp-api publishes MQTT topic farm1/<deviceId>/cmd
-> Arduino receives MQTT payload ON/OFF
-> Arduino digitalWrite(13, HIGH/LOW)
-> devices.js setDeviceLedState records the desired state
```

The Arduino code that changes the pin is in:

```text
applyLedCommand()
```

The current LED pin is:

```cpp
const int LED_PIN = 13;
```

## Delete Device Flow

When the user clicks `Delete Device`:

```text
Dashboard button
-> page.js server action deleteArduinoDevice
-> devices.js deleteDeviceForUser
-> DELETE FROM devices WHERE device_id = ... AND owner_user_id = ...
```

The delete action removes the device only from the account that owns it.

Because `led_commands.device_id` has `ON DELETE CASCADE`, command history for that device is also deleted.

## Oracle Cloud Deployment

For Oracle Cloud, the Arduino must reach the public dashboard URL.

Set this environment variable on the Oracle VM before starting Docker:

```bash
export PUBLIC_APP_URL="http://YOUR_ORACLE_PUBLIC_IP:3000"
docker compose up -d --build
```

If using a domain with HTTPS:

```bash
export PUBLIC_APP_URL="https://your-domain.example"
docker compose up -d --build
```

Open inbound TCP ports:

| Port | Required | Purpose |
| --- | --- | --- |
| `22` | Yes | SSH into Oracle VM |
| `3000` | Yes for current direct setup | Next.js dashboard and Arduino API |
| `1883` | Yes for current MQTT setup | Arduino receives LED commands from Mosquitto |
| `80` | Optional | HTTP reverse proxy/domain |
| `443` | Optional | HTTPS reverse proxy/domain |

Do not expose these publicly unless there is a specific reason:

```text
5432 PostgreSQL
9001 MQTT WebSocket
8080 C++ API
```

The Arduino sketch must point to Oracle, not a home-network address:

```cpp
const char* MQTT_HOST = "YOUR_ORACLE_PUBLIC_IP";
const char* CLOUD_HOST = "YOUR_ORACLE_PUBLIC_IP";
```

If it still points to something like `192.168.1.112`, the Arduino will work locally but will not use Oracle Cloud.

## Local Development Networking

Local dashboard:

```text
http://localhost:3000
```

When the Arduino is on home Wi-Fi and the app is running inside WSL/Docker, the board cannot call `localhost` on the computer. It must call a LAN IP that forwards to the local app.

The PowerShell scripts in [scripts](../scripts) help with this:

| Script | Purpose |
| --- | --- |
| `open-arduino-network-ports.ps1` | Creates Windows firewall/portproxy rules |
| `start-arduino-heartbeat-proxy.ps1` | Starts a local HTTP proxy from LAN IP to `127.0.0.1:3000` |
| `start-arduino-port-forward.ps1` | Port forwarding helper |

For Oracle deployment, these Windows scripts are not needed by the Arduino because the board calls the Oracle public IP directly.

## C++ And MQTT Path

The LED command architecture is:

```text
Dashboard or C++ API
-> cpp-api on port 8080
-> Mosquitto MQTT broker
-> Arduino MQTT subscriber
-> GPIO 13 LED
```

Files:

- [cpp-api/src/main.cpp](../cpp-api/src/main.cpp)
- [mosquitto/mosquitto.conf](../mosquitto/mosquitto.conf)
- [arduino/arduino_mqtt_device.ino](../arduino/arduino_mqtt_device.ino)

C++ API examples:

```bash
curl -X POST http://localhost:8080/api/led/on
curl -X POST http://localhost:8080/api/devices/arduino-led-01/commands/off
```

The current dashboard ON/OFF button uses this MQTT path.

## Troubleshooting

If the dashboard shows `Offline`:

1. Confirm the Arduino sketch has the same `DEVICE_ID` and `DEVICE_SECRET` shown in the dashboard.
2. Confirm `CLOUD_HOST` points to the machine running the app.
3. Open the heartbeat URL in a browser is not enough because heartbeat requires POST; check Serial Monitor instead.
4. Check Oracle Cloud ingress rules for port `3000`.
5. Check VM firewall rules for port `3000`.
6. Check Docker is running with `docker ps`.
7. Open Arduino Serial Monitor at `115200`.

Useful Serial Monitor messages:

```text
WiFi connected
MQTT connected
MQTT connect failed
Heartbeat failed: could not connect to cloud
GPIO 13 LED ON
GPIO 13 LED OFF
```

Useful server commands:

```bash
docker ps
docker compose logs --tail=100 next-app
docker exec farm-db psql -U postgres -d farmdb -c "SELECT device_id, led_state, last_status, last_seen_at, NOW() - last_seen_at AS age FROM devices;"
```

Useful API tests:

```bash
curl -X POST http://localhost:8080/api/devices/<deviceId>/commands/on
curl -X POST http://YOUR_ORACLE_PUBLIC_IP:3000/api/devices/<deviceId>/heartbeat \
  -H "Content-Type: application/json" \
  -d '{"deviceSecret":"<deviceSecret>","status":"online"}'
```

Run the `localhost:8080` command on the Oracle VM, because `cpp-api` should stay private. If the heartbeat curl does not return JSON, the Arduino cannot update dashboard status.
