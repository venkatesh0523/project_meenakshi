#include "api_logic.h"

#include <sstream>

namespace farm {

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

std::string handleHttpRequest(
    const std::string& request,
    const std::string& defaultDeviceId,
    const LedCommandPublisher& publishLedCommand) {
  const std::string method = extractRequestMethod(request);
  const std::string target = extractRequestTarget(request);

  // Health is intentionally self-contained so it still works if MQTT is down.
  if (method == "GET" && target == "/health") {
    return buildJsonResponse(200, "OK", R"({"status":"ok","service":"cpp-api"})");
  }

  // Legacy shortcut routes publish to the configured default device.
  if (method == "POST" && (target == "/api/led/on" || target == "/api/led/off")) {
    const std::string command = target == "/api/led/on" ? "ON" : "OFF";
    std::string errorMessage;
    const bool published = publishLedCommand(defaultDeviceId, command, errorMessage);

    if (!published) {
      return buildJsonResponse(
          500,
          "Internal Server Error",
          std::string("{\"message\":\"") + jsonEscape(errorMessage) + "\"}");
    }

    const std::string topic = "farm1/" + defaultDeviceId + "/cmd";
    const std::string body =
        std::string("{\"message\":\"LED command sent\",\"deviceId\":\"") +
        jsonEscape(defaultDeviceId) + "\",\"command\":\"" + command +
        "\",\"topic\":\"" + jsonEscape(topic) + "\"}";
    return buildJsonResponse(200, "OK", body);
  }

  const std::vector<std::string> pathParts = splitPath(target);

  // Device-specific routes publish to the device ID carried in the URL.
  if (method == "POST" && pathParts.size() == 5 && pathParts[0] == "api" &&
      pathParts[1] == "devices" && pathParts[3] == "commands" &&
      (pathParts[4] == "on" || pathParts[4] == "off")) {
    const std::string deviceId = pathParts[2];
    const std::string command = pathParts[4] == "on" ? "ON" : "OFF";
    std::string errorMessage;
    const bool published = publishLedCommand(deviceId, command, errorMessage);

    if (!published) {
      return buildJsonResponse(
          500,
          "Internal Server Error",
          std::string("{\"message\":\"") + jsonEscape(errorMessage) + "\"}");
    }

    const std::string topic = "farm1/" + deviceId + "/cmd";
    const std::string body =
        std::string("{\"message\":\"Device command sent\",\"deviceId\":\"") +
        jsonEscape(deviceId) + "\",\"command\":\"" + command + "\",\"topic\":\"" +
        jsonEscape(topic) + "\"}";
    return buildJsonResponse(200, "OK", body);
  }

  return buildJsonResponse(404, "Not Found", R"({"message":"Route not found"})");
}

}  // namespace farm
