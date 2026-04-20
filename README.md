# Arduino Device Cloud MVP

This project now contains four runtime services:

- `next-app`: Next.js dashboard and device registry
- `cpp-api`: C++ HTTP API for device command publishing
- `db`: PostgreSQL for devices and command history
- `mqtt`: Eclipse Mosquitto broker

## Start

```bash
docker compose up --build
```

## Git Push Deployment

This project includes a GitHub Actions workflow that can deploy to your Oracle Cloud VM whenever you push to `main` or `master`.

Required GitHub repository secrets:

- `OCI_SSH_KEY`: private key contents from your `.key` file

For email OTP signup in the Next.js app, configure these environment variables for `next-app`:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- optional `EMAIL_FROM` if you want something other than `venkatesh.neerupudi@gmail.com`

For Oracle Cloud, set the public dashboard URL before starting Docker. The Arduino uses this URL for heartbeat/status:

```bash
export PUBLIC_APP_URL="http://YOUR_ORACLE_PUBLIC_IP:3000"
docker compose up -d --build
```

If you use a domain with HTTPS, use that instead:

```bash
export PUBLIC_APP_URL="https://your-domain.example"
docker compose up -d --build
```

Also open ports `3000` and `1883` in the Oracle Cloud security list/network security group and on the VM firewall. If the Arduino sketch still contains a home network IP such as `192.168.1.112`, update `CLOUD_HOST`, `MQTT_HOST`, and the ports to match the Oracle address and upload the sketch again.

Deployment flow:

1. Push code to GitHub.
2. GitHub Actions uploads the project to the Oracle VM over SSH.
3. The VM refreshes the app files and runs `docker compose up -d --build`.

## Services

- Next.js app: `http://localhost:3000`
- C++ LED API: `http://localhost:8080`
- PostgreSQL: `localhost:5432`
- MQTT broker: `localhost:1883`
- MQTT over WebSockets: `localhost:9001`

For a full architecture explanation, see [docs/architecture.md](docs/architecture.md).

## What each service does

- `next-app` lets users register, log in, provision Arduino devices with per-device secrets, view their MQTT topics, and send commands.
- `cpp-api` publishes `ON` and `OFF` messages to device-specific MQTT topics.
- `db` stores rows in the `devices` and `led_commands` tables.
- `mqtt` delivers commands to your ESP32 or any MQTT subscriber.

## Next.js app

Open:

```bash
http://localhost:3000
```

The dashboard lets you:

- register a user account
- log in and keep a session
- connect an existing Arduino device to your account
- register a new Arduino device
- copy the provisioned `DEVICE_ID` and `DEVICE_SECRET` into the Arduino sketch
- see per-device connection status (`Online` / `Offline`) from heartbeat updates
- copy the heartbeat URL and MQTT command topic
- turn GPIO 13 LED on or off through the C++ API and MQTT
- delete a device from your account
- view recent command history from PostgreSQL

## C++ API

```bash
curl http://localhost:8080/health
```

Turn the default device on:

```bash
curl -X POST http://localhost:8080/api/led/on
```

Turn a specific device on:

```bash
curl -X POST http://localhost:8080/api/devices/arduino-led-01/commands/on
```

Turn a specific device off:

```bash
curl -X POST http://localhost:8080/api/devices/arduino-led-01/commands/off
```

## MQTT topics

The C++ API publishes commands to:

```text
farm1/<deviceId>/cmd
```

Your Arduino device should subscribe to:

```text
farm1/<deviceId>/cmd
```

And it can publish status to:

```text
farm1/<deviceId>/status
```

Command payloads:

- `ON`
- `OFF`

## Database

Schema file:

- [01-schema.sql](db/init/01-schema.sql)

Tables used:

- `users`
- `user_sessions`
- `devices`
- `led_commands`

## Arduino sketch

Current UNO R4 WiFi sketch:

- [uno_r4_wifi_cloud_device.ino](arduino/uno_r4_wifi_cloud_device/uno_r4_wifi_cloud_device.ino)

Update these values before uploading:

- `WIFI_SSID`
- `WIFI_PASSWORD`
- `MQTT_HOST`
- `CLOUD_HOST`
- `DEVICE_ID`
- `DEVICE_SECRET`

The `DEVICE_ID` and `DEVICE_SECRET` in the sketch must match the values shown for that device in the Next.js app after you connect or register it.

## Provisioning Flow

This project now follows an Arduino-Cloud-like provisioning pattern:

1. Create a user account and log in.
2. Connect an existing device or register a new one in the dashboard.
3. Copy the generated `DEVICE_ID` and `DEVICE_SECRET` from the device card.
4. Paste those values into [uno_r4_wifi_cloud_device.ino](arduino/uno_r4_wifi_cloud_device/uno_r4_wifi_cloud_device.ino).
5. Upload the sketch to your board.
6. The board connects to MQTT using `DEVICE_ID` as the username and `DEVICE_SECRET` as the password.
7. The board sends heartbeat pings to `/api/devices/<deviceId>/heartbeat`, and the UI shows online/offline status from `last_seen_at`.

For local development, Mosquitto is still configured in open mode, so the broker does not yet reject invalid device secrets. The app-side provisioning flow is now in place and ready for broker-side enforcement as the next step.

## Files

- Next.js app: [page.js](next-app/app/page.js)
- Next.js styles: [globals.css](next-app/app/globals.css)
- Next.js database helper: [db.js](next-app/lib/db.js)
- Arduino sketch: [uno_r4_wifi_cloud_device.ino](arduino/uno_r4_wifi_cloud_device/uno_r4_wifi_cloud_device.ino)
- C++ API source: [main.cpp](cpp-api/src/main.cpp)
- C++ service build: [CMakeLists.txt](cpp-api/CMakeLists.txt)
- C++ service container: [Dockerfile](cpp-api/Dockerfile)
- Database schema: [01-schema.sql](db/init/01-schema.sql)
- Mosquitto config: [mosquitto.conf](mosquitto/mosquitto.conf)
- Compose setup: [docker-compose.yml](docker-compose.yml)
