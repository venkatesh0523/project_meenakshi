#include <WiFiS3.h>

const char* WIFI_SSID = "Telia-B798AC";
const char* WIFI_PASSWORD = "pnK7x6nhh222h2wx";

const char* CLOUD_HOST = "192.168.1.112";
const int CLOUD_PORT = 3000;

const char* DEVICE_ID = "a119c318-d7c7-41af-972d-5587e8506a43";
const char* DEVICE_SECRET = "KBjocdSPoT5ET5rmC43P-hiw";

const int LED_PIN = 13;

unsigned long lastCommandPollAt = 0;
String currentLedState = "OFF";

String readHttpResponse(WiFiClient& client) {
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

void applyLedCommand(const String& command) {
  if (command == currentLedState) {
    return;
  }

  if (command == "ON") {
    digitalWrite(LED_PIN, HIGH);
    currentLedState = "ON";
    Serial.println("GPIO 13 LED ON");
  } else if (command == "OFF") {
    digitalWrite(LED_PIN, LOW);
    currentLedState = "OFF";
    Serial.println("GPIO 13 LED OFF");
  }
}

void pollLedCommand() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  WiFiClient client;

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

  if (response.indexOf("\"command\":\"ON\"") >= 0) {
    applyLedCommand("ON");
  } else if (response.indexOf("\"command\":\"OFF\"") >= 0) {
    applyLedCommand("OFF");
  } else {
    Serial.println("Command poll did not return ON or OFF");
    Serial.println(response);
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

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  Serial.begin(115200);
  delay(1000);
  Serial.println("Booting UNO R4 WiFi cloud device");

  if (connectWifi()) {
    pollLedCommand();
  }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  }

  if (WiFi.status() == WL_CONNECTED && millis() - lastCommandPollAt >= 3000) {
    lastCommandPollAt = millis();
    pollLedCommand();
  }
}
