#include <WiFiS3.h>
#include <PubSubClient.h>

const char* WIFI_SSID = "Telia-B798AC";
const char* WIFI_PASSWORD = "pnK7x6nhh222h2wx";

const char* MQTT_HOST = "192.168.1.112";
const int MQTT_PORT = 1883;
const char* CLOUD_HOST = "192.168.1.112";
const int CLOUD_PORT = 3000;

const char* DEVICE_ID = "a119c318-d7c7-41af-972d-5587e8506a43";
const char* DEVICE_SECRET = "Dz9rn31gDj8nA5mZ6vsGEfI5";

const int LED_PIN = LED_BUILTIN;
const unsigned long HEARTBEAT_INTERVAL_MS = 20000;

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
unsigned long lastHeartbeatAt = 0;
unsigned long lastMqttRetryAt = 0;

String commandTopic = String("farm1/") + DEVICE_ID + "/cmd";
String statusTopic = String("farm1/") + DEVICE_ID + "/status";

void sendHttpRequest(const String& body) {
  WiFiClient client;

  if (!client.connect(CLOUD_HOST, CLOUD_PORT)) {
    Serial.println("Heartbeat failed: could not connect to cloud");
    return;
  }

  const String path = String("/api/devices/") + DEVICE_ID + "/heartbeat";

  client.print(String("POST ") + path + " HTTP/1.1\r\n");
  client.print(String("Host: ") + CLOUD_HOST + ":" + String(CLOUD_PORT) + "\r\n");
  client.print("Content-Type: application/json\r\n");
  client.print(String("Content-Length: ") + String(body.length()) + "\r\n");
  client.print("Connection: close\r\n\r\n");
  client.print(body);

  const unsigned long startedAt = millis();
  while (client.connected() && millis() - startedAt < 5000) {
    while (client.available()) {
      Serial.write(client.read());
    }
  }

  client.stop();
}

void sendHeartbeat(const char* status) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Skipping heartbeat: WiFi is disconnected");
    return;
  }

  const String payload =
      String("{\"deviceSecret\":\"") + DEVICE_SECRET + "\",\"status\":\"" + status + "\"}";

  Serial.println("Sending heartbeat");
  sendHttpRequest(payload);
  lastHeartbeatAt = millis();
}

void publishStatus(const char* status) {
  const bool published = mqttClient.publish(statusTopic.c_str(), status, true);
  Serial.print("Publishing status ");
  Serial.print(status);
  Serial.print(" -> ");
  Serial.println(published ? "ok" : "failed");
}

void onMessage(char* topic, byte* payload, unsigned int length) {
  String message;

  for (unsigned int index = 0; index < length; index++) {
    message += static_cast<char>(payload[index]);
  }

  Serial.print("Received: ");
  Serial.println(message);

  if (message == "ON") {
    digitalWrite(LED_PIN, HIGH);
    publishStatus("ON");
  } else if (message == "OFF") {
    digitalWrite(LED_PIN, LOW);
    publishStatus("OFF");
  }
}

bool connectWifi() {
  Serial.print("Connecting to WiFi ");
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  const unsigned long startedAt = millis();

  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < 30000) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi connection failed");
    return false;
  }

  Serial.println("WiFi connected");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
  return true;
}

void connectMqtt() {
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(onMessage);

  if (mqttClient.connected() || WiFi.status() != WL_CONNECTED) {
    return;
  }

  Serial.print("Connecting to MQTT as ");
  Serial.println(DEVICE_ID);

  if (mqttClient.connect(DEVICE_ID, DEVICE_ID, DEVICE_SECRET)) {
    Serial.println("MQTT connected");
    mqttClient.subscribe(commandTopic.c_str());
    publishStatus("READY");
  } else {
    Serial.print("MQTT connect failed, rc=");
    Serial.println(mqttClient.state());
  }
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  Serial.begin(115200);
  delay(1000);
  Serial.println("Booting UNO R4 WiFi cloud device");

  if (connectWifi()) {
    sendHeartbeat("online");
    connectMqtt();
  }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  }

  if (
      WiFi.status() == WL_CONNECTED &&
      !mqttClient.connected() &&
      millis() - lastMqttRetryAt >= 10000) {
    lastMqttRetryAt = millis();
    connectMqtt();
  }

  if (mqttClient.connected()) {
    mqttClient.loop();
  }

  if (WiFi.status() == WL_CONNECTED && millis() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    sendHeartbeat("online");
  }
}
