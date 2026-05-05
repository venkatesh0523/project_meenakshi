# C++ Device API

This service provides a simple C++ REST API for device command and sensor forwarding.

## Endpoints

- `GET /health`
- `POST /api/led/on`
- `POST /api/led/off`
- `POST /api/devices/:deviceId/commands/on`
- `POST /api/devices/:deviceId/commands/off`
- `POST /api/devices/:deviceId/heartbeat`

## MQTT behavior

- Broker host comes from `MQTT_HOST`
- Broker port comes from `MQTT_PORT`
- Device ID comes from `LED_DEVICE_ID`
- Commands publish to `farm1/<deviceId>/cmd`
- Value updates forward to the Next app using `NEXT_APP_HOST` and `NEXT_APP_PORT`

Default topic:

```text
farm1/led-01/cmd
```

## Run with Docker Compose

```bash
docker compose up --build cpp-api mqtt
```

Then call:

```bash
curl http://localhost:8080/health
curl -X POST http://localhost:8080/api/led/on
curl -X POST http://localhost:8080/api/led/off
curl -X POST http://localhost:8080/api/devices/arduino-01/heartbeat \
  -H 'Content-Type: application/json' \
  -d '{"deviceSecret":"secret","status":"online","variables":{"display_val":612}}'
```

## Tests

Build and run the C++ unit tests with:

```bash
cmake -S cpp-api -B cpp-api/build
cmake --build cpp-api/build
ctest --test-dir cpp-api/build --output-on-failure
```

The unit tests cover request parsing, health response, LED commands, heartbeat forwarding, publish failures, and unknown routes.
