#include <WiFi.h>
#include <PubSubClient.h>
#include <HTTPClient.h>

const char* WIFI_SSID = "Telia-B798AC";
const char* WIFI_PASSWORD = "pnK7x6nhh222h2wx";

const char* MQTT_HOST = "172.18.116.147";
const int MQTT_PORT = 1883;
const char* CLOUD_HOST = "172.18.116.147";
const int CLOUD_PORT = 3000;

const char* DEVICE_ID = "arduino-led-02";
const char* DEVICE_SECRET = "1XSm-sWxFYaHX3vaJxWB-gRk";
const int LED_PIN = 13;
const unsigned long HEARTBEAT_INTERVAL_MS = 20000;

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
unsigned long lastHeartbeatAt = 0;

String commandTopic = String("farm1/") + DEVICE_ID + "/cmd";
String statusTopic = String("farm1/") + DEVICE_ID + "/status";

void sendHeartbeat(const char* status) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Skipping heartbeat: WiFi is disconnected");
    return;
  }

  HTTPClient http;
  const String url =
      String("http://") + CLOUD_HOST + ":" + String(CLOUD_PORT) + "/api/devices/" + DEVICE_ID +
      "/heartbeat";
  const String payload =
      String("{\"deviceSecret\":\"") + DEVICE_SECRET + "\",\"status\":\"" + status + "\"}";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  const int httpCode = http.POST(payload);

  Serial.print("Heartbeat POST ");
  Serial.print(url);
  Serial.print(" -> HTTP ");
  Serial.println(httpCode);

  if (httpCode > 0) {
    Serial.println(http.getString());
  }

  http.end();
  lastHeartbeatAt = millis();
}

void publishStatus(const char* status) {
  const bool published = mqttClient.publish(statusTopic.c_str(), status, true);
  Serial.print("Publishing status ");
  Serial.print(status);
  Serial.print(" to ");
  Serial.print(statusTopic);
  Serial.print(" -> ");
  Serial.println(published ? "ok" : "failed");
}

void onMessage(char* topic, byte* payload, unsigned int length) {
  String message;

  for (unsigned int index = 0; index < length; index++) {
    message += static_cast<char>(payload[index]);
  }

  Serial.print("Received on topic ");
  Serial.print(topic);
  Serial.print(": ");
  Serial.println(message);

  if (message == "ON") {
    digitalWrite(LED_PIN, HIGH);
    publishStatus("ON");
  } else if (message == "OFF") {
    digitalWrite(LED_PIN, LOW);
    publishStatus("OFF");
  }
}

void connectWifi() {
  Serial.print("Connecting to WiFi SSID ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi connected");
  Serial.print("Board IP: ");
  Serial.println(WiFi.localIP());
  Serial.print("MQTT target: ");
  Serial.print(MQTT_HOST);
  Serial.print(":");
  Serial.println(MQTT_PORT);
}

void connectMqtt() {
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(onMessage);

  while (!mqttClient.connected()) {
    Serial.print("Connecting to MQTT as ");
    Serial.println(DEVICE_ID);
    if (mqttClient.connect(DEVICE_ID, DEVICE_ID, DEVICE_SECRET)) {
      Serial.println("MQTT connected");
      mqttClient.subscribe(commandTopic.c_str());
      Serial.print("Subscribed to ");
      Serial.println(commandTopic);
      publishStatus("READY");
      sendHeartbeat("online");
    } else {
      Serial.print("MQTT connect failed, rc=");
      Serial.println(mqttClient.state());
      delay(1000);
    }
  }
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  Serial.begin(115200);
  delay(1000);
  Serial.println("Booting Arduino device");
  connectWifi();
  connectMqtt();
}

void loop() {
  if (!mqttClient.connected()) {
    connectMqtt();
  }

  mqttClient.loop();

  if (millis() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    sendHeartbeat("online");
  }
}
