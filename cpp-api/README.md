# C++ LED API

This service provides a simple C++ REST API for LED control over MQTT.

## Endpoints

- `GET /health`
- `POST /api/led/on`
- `POST /api/led/off`

## MQTT behavior

- Broker host comes from `MQTT_HOST`
- Broker port comes from `MQTT_PORT`
- Device ID comes from `LED_DEVICE_ID`
- Commands publish to `farm1/<deviceId>/cmd`

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
```
