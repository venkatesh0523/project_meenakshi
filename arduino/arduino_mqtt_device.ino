#include <WiFiS3.h>
#include <PubSubClient.h>

const char* DEFAULT_WIFI_SSID = "Telia-B798AC";
const char* DEFAULT_WIFI_PASSWORD = "pnK7x6nhh222h2wx";

// Oracle Cloud public IP. Keep this aligned with the deployed dashboard and broker.
const char* MQTT_HOST = "141.148.239.103";
const int MQTT_PORT = 1883;
const char* CLOUD_HOST = "141.148.239.103";
const int CLOUD_PORT = 3000;
const bool CLOUD_USE_SSL = false;

const char* DEVICE_ID = "arduino-e4d35a2d-790a-44d8-92fa-19152bcfabc1";
const char* DEVICE_SECRET = "im1rAljuqaF_O77xMfHOiz4E";
const int LED_PIN = 13;
const int SECONDARY_PIN = 12;
const unsigned long HEARTBEAT_INTERVAL_MS = 20000;
const unsigned long MQTT_RETRY_INTERVAL_MS = 5000;
const unsigned long COMMAND_POLL_INTERVAL_MS = 1000;

WiFiClient mqttWifiClient;
PubSubClient mqttClient(mqttWifiClient);
unsigned long lastHeartbeatAt = 0;
unsigned long lastWifiRetryAt = 0;
unsigned long lastReadyAnnouncementAt = 0;
unsigned long lastMqttRetryAt = 0;
unsigned long lastCommandPollAt = 0;
String serialBuffer;
String activeWifiSsid;
String activeWifiPassword;
String currentLedState = "OFF";
String currentSecondaryState = "OFF";

String commandTopic = String("farm1/") + DEVICE_ID + "/cmd";
String statusTopic = String("farm1/") + DEVICE_ID + "/status";
void announceBoardReady() {
  lastReadyAnnouncementAt = millis();
  Serial.println("boardReady");
  Serial.print("{\"type\":\"boardReady\",\"deviceId\":\"");
  Serial.print(escapeJson(DEVICE_ID));
  Serial.print("\",\"board\":\"Arduino UNO R4 WiFi\",\"ssid\":\"");
  Serial.print(escapeJson(activeWifiSsid));
  Serial.println("\"}");
}

bool connectWifi();
void connectMqtt();
void applyLedCommand(const String& command, bool publishAck = true);
void applySecondaryCommand(const String& command);

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

String escapeJson(const String& value) {
  String escaped;

  for (unsigned int index = 0; index < value.length(); index++) {
    const char character = value[index];

    if (character == '\\' || character == '"') {
      escaped += '\\';
    }

    escaped += character;
  }

  return escaped;
}

String readJsonString(const String& payload, const String& key) {
  const String marker = "\"" + key + "\"";
  int markerIndex = payload.indexOf(marker);

  if (markerIndex < 0) {
    return "";
  }

  int colonIndex = payload.indexOf(':', markerIndex + marker.length());
  if (colonIndex < 0) {
    return "";
  }

  int valueStart = colonIndex + 1;
  while (valueStart < static_cast<int>(payload.length()) && isspace(payload[valueStart])) {
    valueStart++;
  }

  if (valueStart >= static_cast<int>(payload.length()) || payload[valueStart] != '"') {
    return "";
  }

  valueStart++;
  String value;
  bool escaping = false;

  for (int index = valueStart; index < static_cast<int>(payload.length()); index++) {
    const char character = payload[index];

    if (escaping) {
      value += character;
      escaping = false;
      continue;
    }

    if (character == '\\') {
      escaping = true;
      continue;
    }

    if (character == '"') {
      break;
    }

    value += character;
  }

  return value;
}

void loadWifiCredentials() {
  activeWifiSsid = DEFAULT_WIFI_SSID;
  activeWifiPassword = DEFAULT_WIFI_PASSWORD;
}

void saveWifiCredentials(const String& ssid, const String& password) {
  activeWifiSsid = ssid;
  activeWifiPassword = password;
}

void scanWifiNetworks() {
  const int networkCount = WiFi.scanNetworks();

  Serial.print("{\"type\":\"wifiNetworks\",\"networks\":[");
  for (int index = 0; index < networkCount; index++) {
    if (index > 0) {
      Serial.print(",");
    }

    Serial.print("{\"ssid\":\"");
    Serial.print(escapeJson(WiFi.SSID(index)));
    Serial.print("\",\"rssi\":");
    Serial.print(WiFi.RSSI(index));
    Serial.print("}");
  }
  Serial.println("]}");
}

void handleSerialCommand(const String& command) {
  if (command.indexOf("\"type\":\"hello\"") >= 0) {
    announceBoardReady();
    return;
  }

  if (command.indexOf("\"type\":\"scanWifi\"") >= 0) {
    scanWifiNetworks();
    return;
  }

  if (command.indexOf("\"type\":\"saveWifi\"") >= 0) {
    const String ssid = readJsonString(command, "ssid");
    const String password = readJsonString(command, "password");

    if (ssid.length() == 0) {
      Serial.println("{\"type\":\"wifiError\",\"message\":\"SSID is required\"}");
      return;
    }

    saveWifiCredentials(ssid, password);
    Serial.print("{\"type\":\"wifiSaved\",\"message\":\"Saved Wi-Fi ");
    Serial.print(escapeJson(ssid));
    Serial.println(". Reconnecting now.\"}");

    mqttClient.disconnect();
    WiFi.disconnect();
    delay(500);

    if (connectWifi()) {
      connectMqtt();
    }
  }
}

void handleSerialInput() {
  while (Serial.available() > 0) {
    const char character = static_cast<char>(Serial.read());

    if (character == '\n') {
      serialBuffer.trim();
      if (serialBuffer.length() > 0) {
        handleSerialCommand(serialBuffer);
      }
      serialBuffer = "";
    } else {
      serialBuffer += character;
    }
  }
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

void publishStatus(const char* status) {
  const bool published = mqttClient.publish(statusTopic.c_str(), status, true);
  Serial.print("Publishing status ");
  Serial.print(status);
  Serial.print(" to ");
  Serial.print(statusTopic);
  Serial.print(" -> ");
  Serial.println(published ? "ok" : "failed");
}

void applyLedCommand(const String& command, bool publishAck) {
  if (command == currentLedState) {
    if (publishAck) {
      publishStatus(command.c_str());
    }
    return;
  }

  if (command == "ON") {
    digitalWrite(LED_PIN, HIGH);
    currentLedState = "ON";
    if (publishAck) {
      publishStatus("ON");
    }
  } else if (command == "OFF") {
    digitalWrite(LED_PIN, LOW);
    currentLedState = "OFF";
    if (publishAck) {
      publishStatus("OFF");
    }
  }
}

void applySecondaryCommand(const String& command) {
  if (command == currentSecondaryState) {
    return;
  }

  if (command == "ON") {
    digitalWrite(SECONDARY_PIN, HIGH);
    currentSecondaryState = "ON";
    return;
  }

  if (command == "OFF") {
    digitalWrite(SECONDARY_PIN, LOW);
    currentSecondaryState = "OFF";
  }
}

void onMessage(char* topic, byte* payload, unsigned int length) {
  String message;

  for (unsigned int index = 0; index < length; index++) {
    message += static_cast<char>(payload[index]);
  }

  message.trim();

  Serial.print("Received on topic ");
  Serial.print(topic);
  Serial.print(": ");
  Serial.println(message);
  applyLedCommand(message);
}

void syncLedCommandFromCloud() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  if (millis() - lastCommandPollAt < COMMAND_POLL_INTERVAL_MS) {
    return;
  }
  lastCommandPollAt = millis();

  WiFiClient plainClient;
  WiFiSSLClient sslClient;
  Client& client = CLOUD_USE_SSL ? static_cast<Client&>(sslClient) : static_cast<Client&>(plainClient);

  if (!client.connect(CLOUD_HOST, CLOUD_PORT)) {
    Serial.println("Command poll failed: could not connect to cloud");
    return;
  }

  const String path =
      String("/api/devices/") + DEVICE_ID + "/command?deviceSecret=" + DEVICE_SECRET;

  client.print(String("GET ") + path + " HTTP/1.1\r\n");
  client.print(String("Host: ") + CLOUD_HOST + ":" + String(CLOUD_PORT) + "\r\n");
  client.print("Connection: close\r\n\r\n");

  const String response = readHttpResponse(client);
  client.stop();

  const String pin13Command = readJsonString(response, "pin13Command");
  if (pin13Command == "ON" || pin13Command == "OFF") {
    applyLedCommand(pin13Command, false);
  } else {
    const String command = readJsonString(response, "command");
    if (command == "ON" || command == "OFF") {
      applyLedCommand(command, false);
    }
  }

  const String pin12Command = readJsonString(response, "pin12Command");
  if (pin12Command == "ON" || pin12Command == "OFF") {
    applySecondaryCommand(pin12Command);
  }
}

bool connectWifi() {
  if (activeWifiSsid.length() == 0) {
    Serial.println("No WiFi SSID saved");
    return false;
  }

  Serial.print("Connecting to WiFi SSID ");
  Serial.println(activeWifiSsid);
  WiFi.begin(activeWifiSsid.c_str(), activeWifiPassword.c_str());

  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < 20000) {
    handleSerialInput();
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println();
    Serial.println("WiFi connection timed out. Use USB scan/save to provision WiFi.");
    return false;
  }

  Serial.println();
  Serial.println("WiFi connected");
  Serial.print("Board IP: ");
  Serial.println(WiFi.localIP());
  Serial.print("MQTT target: ");
  Serial.print(MQTT_HOST);
  Serial.print(":");
  Serial.println(MQTT_PORT);
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
  mqttClient.setCallback(onMessage);

  while (!mqttClient.connected()) {
    handleSerialInput();
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
  pinMode(SECONDARY_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  digitalWrite(SECONDARY_PIN, LOW);

  Serial.begin(115200);
  const unsigned long serialWaitStartedAt = millis();
  while (!Serial && millis() - serialWaitStartedAt < 8000) {
    delay(10);
  }
  delay(500);
  Serial.println("Booting Arduino device");
  loadWifiCredentials();
  lastReadyAnnouncementAt = 0;
  announceBoardReady();

  if (connectWifi()) {
    connectMqtt();
  }
}

void loop() {
  handleSerialInput();

  if (millis() - lastReadyAnnouncementAt >= 2000) {
    announceBoardReady();
  }

  if (WiFi.status() != WL_CONNECTED && millis() - lastWifiRetryAt >= 10000) {
    lastWifiRetryAt = millis();
    connectWifi();
  }

  if (WiFi.status() == WL_CONNECTED && !mqttClient.connected()) {
    connectMqtt();
  }

  if (mqttClient.connected()) {
    mqttClient.loop();
  }

  syncLedCommandFromCloud();

  if (WiFi.status() == WL_CONNECTED && millis() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    sendHeartbeat("online");
  }
}
