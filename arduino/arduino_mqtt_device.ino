#include <WiFi.h>
#include <PubSubClient.h>
#include <HTTPClient.h>
#include <Preferences.h>

const char* DEFAULT_WIFI_SSID = "Telia-B798AC";
const char* DEFAULT_WIFI_PASSWORD = "pnK7x6nhh222h2wx";

// Oracle Cloud public IP. Keep this aligned with the deployed dashboard and broker.
const char* MQTT_HOST = "141.148.239.103";
const int MQTT_PORT = 1883;
const char* CLOUD_HOST = "141.148.239.103";
const int CLOUD_PORT = 3000;

const char* DEVICE_ID = "a119c318-d7c7-41af-972d-5587e8506a41";
const char* DEVICE_SECRET = "PVs5mxEQlVoYnB2GgfS--FtH";
const int LED_PIN = 13;
const unsigned long HEARTBEAT_INTERVAL_MS = 20000;

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
Preferences preferences;
unsigned long lastHeartbeatAt = 0;
unsigned long lastWifiRetryAt = 0;
String serialBuffer;
String activeWifiSsid;
String activeWifiPassword;

String commandTopic = String("farm1/") + DEVICE_ID + "/cmd";
String statusTopic = String("farm1/") + DEVICE_ID + "/status";

bool connectWifi();
void connectMqtt();

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
  preferences.begin("wifi", true);
  activeWifiSsid = preferences.getString("ssid", DEFAULT_WIFI_SSID);
  activeWifiPassword = preferences.getString("password", DEFAULT_WIFI_PASSWORD);
  preferences.end();
}

void saveWifiCredentials(const String& ssid, const String& password) {
  preferences.begin("wifi", false);
  preferences.putString("ssid", ssid);
  preferences.putString("password", password);
  preferences.end();

  activeWifiSsid = ssid;
  activeWifiPassword = password;
}

void scanWifiNetworks() {
  WiFi.mode(WIFI_STA);
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
    Serial.print(",\"secure\":");
    Serial.print(WiFi.encryptionType(index) == WIFI_AUTH_OPEN ? "false" : "true");
    Serial.print("}");
  }
  Serial.println("]}");

  WiFi.scanDelete();
}

void handleSerialCommand(const String& command) {
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
    WiFi.disconnect(true);
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

bool connectWifi() {
  if (activeWifiSsid.length() == 0) {
    Serial.println("No WiFi SSID saved");
    return false;
  }

  Serial.print("Connecting to WiFi SSID ");
  Serial.println(activeWifiSsid);
  WiFi.mode(WIFI_STA);
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
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

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
  digitalWrite(LED_PIN, LOW);

  Serial.begin(115200);
  delay(1000);
  Serial.println("Booting Arduino device");
  loadWifiCredentials();

  if (connectWifi()) {
    connectMqtt();
  }
}

void loop() {
  handleSerialInput();

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

  if (WiFi.status() == WL_CONNECTED && millis() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    sendHeartbeat("online");
  }
}
