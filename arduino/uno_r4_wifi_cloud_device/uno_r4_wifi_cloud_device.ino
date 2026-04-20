#include <WiFiS3.h>
#include <PubSubClient.h>

const char* WIFI_SSID = "Telia-B798AC";
const char* WIFI_PASSWORD = "pnK7x6nhh222h2wx";

// Oracle Cloud public IP/domain. The Arduino connects to MQTT here.
const char* MQTT_HOST = "141.148.239.103";
const int MQTT_PORT = 1883;

// Next.js dashboard host. The Arduino still sends heartbeat here for Online/Offline.
const char* CLOUD_HOST = "141.148.239.103";
const int CLOUD_PORT = 3000;
const bool CLOUD_USE_SSL = false;

const char* DEVICE_ID = "a119c318-d7c7-41af-972d-5587e8506a41";
const char* DEVICE_SECRET = "PVs5mxEQlVoYnB2GgfS--FtH";

const int LED_PIN = 13;
const unsigned long HEARTBEAT_INTERVAL_MS = 20000;
const unsigned long MQTT_RETRY_INTERVAL_MS = 5000;

WiFiClient mqttWifiClient;
PubSubClient mqttClient(mqttWifiClient);

unsigned long lastHeartbeatAt = 0;
unsigned long lastMqttRetryAt = 0;
String currentLedState = "OFF";

String commandTopic = String("farm1/") + DEVICE_ID + "/cmd";
String statusTopic = String("farm1/") + DEVICE_ID + "/status";

String readHttpResponse(Client& client) {
  String response;
  const unsigned long startedAt = millis();

  while (millis() - startedAt < 5000) {
    while (client.available()) {
      response += static_cast<char>(client.read());
    }

    if (!client.connected()) {
      break;
    }
  }

  return response;
}

void publishStatus(const char* status) {
  if (!mqttClient.connected()) {
    return;
  }

  const bool published = mqttClient.publish(statusTopic.c_str(), status, true);
  Serial.print("Publishing status ");
  Serial.print(status);
  Serial.print(" -> ");
  Serial.println(published ? "ok" : "failed");
}

void applyLedCommand(const String& command) {
  if (command == currentLedState) {
    publishStatus(command.c_str());
    return;
  }

  if (command == "ON") {
    digitalWrite(LED_PIN, HIGH);
    currentLedState = "ON";
    Serial.println("GPIO 13 LED ON");
    publishStatus("ON");
  } else if (command == "OFF") {
    digitalWrite(LED_PIN, LOW);
    currentLedState = "OFF";
    Serial.println("GPIO 13 LED OFF");
    publishStatus("OFF");
  }
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  String message;

  for (unsigned int index = 0; index < length; index++) {
    message += static_cast<char>(payload[index]);
  }

  message.trim();
  Serial.print("MQTT message on ");
  Serial.print(topic);
  Serial.print(": ");
  Serial.println(message);

  applyLedCommand(message);
}

void sendHeartbeat(const char* status) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Skipping heartbeat: WiFi is disconnected");
    return;
  }

  WiFiClient plainClient;
  WiFiSSLClient sslClient;
  Client& client = CLOUD_USE_SSL ? static_cast<Client&>(sslClient) : static_cast<Client&>(plainClient);

  if (!client.connect(CLOUD_HOST, CLOUD_PORT)) {
    Serial.println("Heartbeat failed: could not connect to cloud");
    return;
  }

  const String path = String("/api/devices/") + DEVICE_ID + "/heartbeat";
  const String body =
      String("{\"deviceSecret\":\"") + DEVICE_SECRET + "\",\"status\":\"" + status + "\"}";

  client.print(String("POST ") + path + " HTTP/1.1\r\n");
  client.print(String("Host: ") + CLOUD_HOST + ":" + String(CLOUD_PORT) + "\r\n");
  client.print("Content-Type: application/json\r\n");
  client.print(String("Content-Length: ") + String(body.length()) + "\r\n");
  client.print("Connection: close\r\n\r\n");
  client.print(body);

  const String response = readHttpResponse(client);
  client.stop();

  Serial.println("Heartbeat response:");
  Serial.println(response);
  lastHeartbeatAt = millis();
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
  if (WiFi.status() != WL_CONNECTED || mqttClient.connected()) {
    return;
  }

  if (millis() - lastMqttRetryAt < MQTT_RETRY_INTERVAL_MS) {
    return;
  }
  lastMqttRetryAt = millis();

  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);

  Serial.print("Connecting to MQTT ");
  Serial.print(MQTT_HOST);
  Serial.print(":");
  Serial.println(MQTT_PORT);

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
  }
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  Serial.begin(115200);
  delay(1000);
  Serial.println("Booting UNO R4 WiFi MQTT cloud device");

  if (connectWifi()) {
    connectMqtt();
  }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  }

  if (WiFi.status() == WL_CONNECTED && !mqttClient.connected()) {
    connectMqtt();
  }

  if (mqttClient.connected()) {
    mqttClient.loop();
  }

  if (WiFi.status() == WL_CONNECTED && millis() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    sendHeartbeat("online");
  }
}
