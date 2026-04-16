#include <arpa/inet.h>
#include <mosquitto.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cerrno>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string_view>
#include <sstream>
#include <string>
#include <vector>

namespace {

volatile std::sig_atomic_t keepRunning = 1;

std::string getEnvOrDefault(const char* key, const char* fallback) {
  const char* value = std::getenv(key);
  if (value == nullptr || std::strlen(value) == 0) {
    return fallback;
  }

  return value;
}

int getEnvIntOrDefault(const char* key, int fallback) {
  const char* value = std::getenv(key);
  if (value == nullptr || std::strlen(value) == 0) {
    return fallback;
  }

  try {
    return std::stoi(value);
  } catch (...) {
    return fallback;
  }
}

void handleSignal(int) {
  keepRunning = 0;
}

bool publishLedCommand(
    struct mosquitto* client,
    const std::string& host,
    int port,
    const std::string& deviceId,
    const std::string& command,
    std::string& errorMessage) {
  if (mosquitto_connect(client, host.c_str(), port, 60) != MOSQ_ERR_SUCCESS) {
    errorMessage = "Failed to connect to MQTT broker";
    return false;
  }

  const std::string topic = "farm1/" + deviceId + "/cmd";
  const int publishResult = mosquitto_publish(
      client,
      nullptr,
      topic.c_str(),
      static_cast<int>(command.size()),
      command.c_str(),
      1,
      false);

  if (publishResult != MOSQ_ERR_SUCCESS) {
    errorMessage = "Failed to publish MQTT message";
    mosquitto_disconnect(client);
    return false;
  }

  mosquitto_loop(client, 100, 1);
  mosquitto_disconnect(client);
  return true;
}

std::vector<std::string> splitPath(const std::string& path) {
  std::vector<std::string> parts;
  std::size_t start = 0;

  while (start < path.size()) {
    while (start < path.size() && path[start] == '/') {
      start += 1;
    }

    if (start >= path.size()) {
      break;
    }

    const std::size_t end = path.find('/', start);
    if (end == std::string::npos) {
      parts.push_back(path.substr(start));
      break;
    }

    parts.push_back(path.substr(start, end - start));
    start = end + 1;
  }

  return parts;
}

std::string jsonEscape(const std::string& value) {
  std::string escaped;
  escaped.reserve(value.size());

  for (char character : value) {
    if (character == '\\' || character == '"') {
      escaped.push_back('\\');
    }

    escaped.push_back(character);
  }

  return escaped;
}

std::string buildJsonResponse(
    int statusCode,
    const std::string& statusText,
    const std::string& body) {
  std::ostringstream response;
  response << "HTTP/1.1 " << statusCode << ' ' << statusText << "\r\n";
  response << "Content-Type: application/json\r\n";
  response << "Content-Length: " << body.size() << "\r\n";
  response << "Connection: close\r\n\r\n";
  response << body;
  return response.str();
}

void sendAll(int clientSocket, const std::string& response) {
  std::size_t totalSent = 0;
  while (totalSent < response.size()) {
    const ssize_t sent =
        send(clientSocket, response.data() + totalSent, response.size() - totalSent, 0);
    if (sent <= 0) {
      return;
    }
    totalSent += static_cast<std::size_t>(sent);
  }
}

std::string extractRequestTarget(const std::string& request) {
  const std::size_t methodEnd = request.find(' ');
  if (methodEnd == std::string::npos) {
    return "";
  }

  const std::size_t targetEnd = request.find(' ', methodEnd + 1);
  if (targetEnd == std::string::npos) {
    return "";
  }

  return request.substr(methodEnd + 1, targetEnd - methodEnd - 1);
}

std::string extractRequestMethod(const std::string& request) {
  const std::size_t methodEnd = request.find(' ');
  if (methodEnd == std::string::npos) {
    return "";
  }

  return request.substr(0, methodEnd);
}

}  // namespace

int main() {
  const std::string host = getEnvOrDefault("MQTT_HOST", "mqtt");
  const int mqttPort = getEnvIntOrDefault("MQTT_PORT", 1883);
  const int httpPort = getEnvIntOrDefault("PORT", 8080);
  const std::string defaultDeviceId = getEnvOrDefault("LED_DEVICE_ID", "arduino-led-01");

  std::signal(SIGINT, handleSignal);
  std::signal(SIGTERM, handleSignal);

  mosquitto_lib_init();
  mosquitto* mqttClient = mosquitto_new("farm_cpp_api", true, nullptr);

  if (mqttClient == nullptr) {
    std::cerr << "Failed to initialize MQTT client" << std::endl;
    mosquitto_lib_cleanup();
    return 1;
  }

  const int serverSocket = socket(AF_INET, SOCK_STREAM, 0);
  if (serverSocket < 0) {
    std::cerr << "Failed to create server socket" << std::endl;
    mosquitto_destroy(mqttClient);
    mosquitto_lib_cleanup();
    return 1;
  }

  int opt = 1;
  setsockopt(serverSocket, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

  sockaddr_in serverAddress {};
  serverAddress.sin_family = AF_INET;
  serverAddress.sin_addr.s_addr = INADDR_ANY;
  serverAddress.sin_port = htons(static_cast<uint16_t>(httpPort));

  if (bind(serverSocket, reinterpret_cast<sockaddr*>(&serverAddress), sizeof(serverAddress)) <
      0) {
    std::cerr << "Failed to bind HTTP server on port " << httpPort << std::endl;
    close(serverSocket);
    mosquitto_destroy(mqttClient);
    mosquitto_lib_cleanup();
    return 1;
  }

  if (listen(serverSocket, 10) < 0) {
    std::cerr << "Failed to listen on HTTP server" << std::endl;
    close(serverSocket);
    mosquitto_destroy(mqttClient);
    mosquitto_lib_cleanup();
    return 1;
  }

  std::cout << "C++ LED API listening on port " << httpPort << std::endl;
  std::cout << "Publishing LED commands to farm1/<deviceId>/cmd via " << host << ':'
            << mqttPort << std::endl;
  std::cout << "Default device is " << defaultDeviceId << std::endl;

  while (keepRunning) {
    sockaddr_in clientAddress {};
    socklen_t clientLength = sizeof(clientAddress);
    const int clientSocket =
        accept(serverSocket, reinterpret_cast<sockaddr*>(&clientAddress), &clientLength);

    if (clientSocket < 0) {
      if (errno == EINTR) {
        continue;
      }
      std::cerr << "Accept failed" << std::endl;
      break;
    }

    char buffer[4096];
    const ssize_t bytesRead = recv(clientSocket, buffer, sizeof(buffer) - 1, 0);
    if (bytesRead <= 0) {
      close(clientSocket);
      continue;
    }

    buffer[bytesRead] = '\0';
    const std::string request(buffer);
    const std::string method = extractRequestMethod(request);
    const std::string target = extractRequestTarget(request);

    if (method == "GET" && target == "/health") {
      sendAll(clientSocket, buildJsonResponse(200, "OK", R"({"status":"ok","service":"cpp-api"})"));
      close(clientSocket);
      continue;
    }

    if (method == "POST" && (target == "/api/led/on" || target == "/api/led/off")) {
      const std::string command = target == "/api/led/on" ? "ON" : "OFF";
      std::string errorMessage;
      const bool published =
          publishLedCommand(mqttClient, host, mqttPort, defaultDeviceId, command, errorMessage);

      if (!published) {
        sendAll(
            clientSocket,
            buildJsonResponse(
                500,
                "Internal Server Error",
                std::string("{\"message\":\"") + errorMessage + "\"}"));
        close(clientSocket);
        continue;
      }

      const std::string topic = "farm1/" + defaultDeviceId + "/cmd";
      const std::string body =
          std::string("{\"message\":\"LED command sent\",\"deviceId\":\"") +
          jsonEscape(defaultDeviceId) + "\",\"command\":\"" + command +
          "\",\"topic\":\"" + jsonEscape(topic) + "\"}";
      sendAll(clientSocket, buildJsonResponse(200, "OK", body));
      close(clientSocket);
      continue;
    }

    const std::vector<std::string> pathParts = splitPath(target);
    if (method == "POST" && pathParts.size() == 5 && pathParts[0] == "api" &&
        pathParts[1] == "devices" && pathParts[3] == "commands" &&
        (pathParts[4] == "on" || pathParts[4] == "off")) {
      const std::string deviceId = pathParts[2];
      const std::string command = pathParts[4] == "on" ? "ON" : "OFF";
      std::string errorMessage;
      const bool published =
          publishLedCommand(mqttClient, host, mqttPort, deviceId, command, errorMessage);

      if (!published) {
        sendAll(
            clientSocket,
            buildJsonResponse(
                500,
                "Internal Server Error",
                std::string("{\"message\":\"") + errorMessage + "\"}"));
        close(clientSocket);
        continue;
      }

      const std::string topic = "farm1/" + deviceId + "/cmd";
      const std::string body =
          std::string("{\"message\":\"Device command sent\",\"deviceId\":\"") +
          jsonEscape(deviceId) + "\",\"command\":\"" + command + "\",\"topic\":\"" +
          jsonEscape(topic) + "\"}";
      sendAll(clientSocket, buildJsonResponse(200, "OK", body));
      close(clientSocket);
      continue;
    }

    sendAll(
        clientSocket,
        buildJsonResponse(404, "Not Found", R"({"message":"Route not found"})"));
    close(clientSocket);
  }

  close(serverSocket);
  mosquitto_destroy(mqttClient);
  mosquitto_lib_cleanup();
  return 0;
}
