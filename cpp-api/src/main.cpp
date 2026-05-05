#include <arpa/inet.h>
#include <mosquitto.h>
#include <netdb.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include "api_logic.h"

#include <cerrno>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <sstream>
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
      true);

  if (publishResult != MOSQ_ERR_SUCCESS) {
    errorMessage = "Failed to publish MQTT message";
    mosquitto_disconnect(client);
    return false;
  }

  mosquitto_loop(client, 100, 1);
  mosquitto_disconnect(client);
  return true;
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

std::string readAllFromSocket(int socketFd) {
  std::string response;
  char buffer[4096];

  while (true) {
    const ssize_t bytesRead = recv(socketFd, buffer, sizeof(buffer), 0);
    if (bytesRead <= 0) {
      break;
    }

    response.append(buffer, static_cast<std::size_t>(bytesRead));
  }

  return response;
}

farm::ForwardedHttpResponse forwardHeartbeatToApp(
    const std::string& host,
    int port,
    const std::string& deviceId,
    const std::string& requestBody) {
  addrinfo hints {};
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;

  addrinfo* addressList = nullptr;
  const std::string portText = std::to_string(port);
  if (getaddrinfo(host.c_str(), portText.c_str(), &hints, &addressList) != 0) {
    return {false, 0, "", "", "Failed to resolve Next app host"};
  }

  int upstreamSocket = -1;
  for (addrinfo* current = addressList; current != nullptr; current = current->ai_next) {
    upstreamSocket = socket(current->ai_family, current->ai_socktype, current->ai_protocol);
    if (upstreamSocket < 0) {
      continue;
    }

    if (connect(upstreamSocket, current->ai_addr, current->ai_addrlen) == 0) {
      break;
    }

    close(upstreamSocket);
    upstreamSocket = -1;
  }

  freeaddrinfo(addressList);

  if (upstreamSocket < 0) {
    return {false, 0, "", "", "Failed to connect to Next app"};
  }

  const std::string path = "/api/devices/" + deviceId + "/heartbeat";
  std::ostringstream requestStream;
  requestStream << "POST " << path << " HTTP/1.1\r\n";
  requestStream << "Host: " << host << ':' << port << "\r\n";
  requestStream << "Content-Type: application/json\r\n";
  requestStream << "Content-Length: " << requestBody.size() << "\r\n";
  requestStream << "Connection: close\r\n\r\n";
  requestStream << requestBody;
  const std::string outboundRequest = requestStream.str();

  sendAll(upstreamSocket, outboundRequest);
  const std::string upstreamResponse = readAllFromSocket(upstreamSocket);
  close(upstreamSocket);

  const std::size_t lineEnd = upstreamResponse.find("\r\n");
  if (lineEnd == std::string::npos) {
    return {false, 0, "", "", "Next app returned an invalid HTTP response"};
  }

  const std::string statusLine = upstreamResponse.substr(0, lineEnd);
  std::istringstream statusStream(statusLine);
  std::string httpVersion;
  int statusCode = 0;
  std::string statusText;
  statusStream >> httpVersion >> statusCode;
  std::getline(statusStream, statusText);
  if (!statusText.empty() && statusText[0] == ' ') {
    statusText.erase(0, 1);
  }

  const std::size_t bodyStart = upstreamResponse.find("\r\n\r\n");
  const std::string responseBody =
      bodyStart == std::string::npos ? "" : upstreamResponse.substr(bodyStart + 4);

  return {true, statusCode, statusText.empty() ? "OK" : statusText, responseBody, ""};
}

}  // namespace

int main() {
  const std::string host = getEnvOrDefault("MQTT_HOST", "mqtt");
  const int mqttPort = getEnvIntOrDefault("MQTT_PORT", 1883);
  const int httpPort = getEnvIntOrDefault("PORT", 8080);
  const std::string defaultDeviceId = getEnvOrDefault("LED_DEVICE_ID", "arduino-led-01");
  const std::string appHost = getEnvOrDefault("NEXT_APP_HOST", "next-app");
  const int appPort = getEnvIntOrDefault("NEXT_APP_PORT", 3000);

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
  std::cout << "Forwarding device value updates to " << appHost << ':' << appPort << std::endl;
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
    const std::string response = farm::handleHttpRequest(
        request,
        defaultDeviceId,
        [&](const std::string& deviceId, const std::string& command, std::string& errorMessage) {
          return publishLedCommand(mqttClient, host, mqttPort, deviceId, command, errorMessage);
        },
        [&](const std::string& deviceId, const std::string& requestBody) {
          return forwardHeartbeatToApp(appHost, appPort, deviceId, requestBody);
        });

    sendAll(clientSocket, response);
    close(clientSocket);
  }

  close(serverSocket);
  mosquitto_destroy(mqttClient);
  mosquitto_lib_cleanup();
  return 0;
}
