#pragma once

#include <functional>
#include <string>
#include <vector>

namespace farm {

// Runtime code injects this callback so request handling can be unit-tested
// without a live MQTT broker.
using LedCommandPublisher = std::function<bool(
    const std::string& deviceId,
    const std::string& command,
    std::string& errorMessage)>;

// Builds the complete HTTP response string expected by the socket server.
std::string buildJsonResponse(
    int statusCode,
    const std::string& statusText,
    const std::string& body);

// Extracts the HTTP method token from a raw request line.
std::string extractRequestMethod(const std::string& request);

// Extracts the path target from a raw request line.
std::string extractRequestTarget(const std::string& request);

// Escapes only the characters this API may place into JSON string values.
std::string jsonEscape(const std::string& value);

// Splits URL paths into non-empty segments, ignoring repeated slashes.
std::vector<std::string> splitPath(const std::string& path);

// Routes one raw HTTP request and returns the full HTTP response.
std::string handleHttpRequest(
    const std::string& request,
    const std::string& defaultDeviceId,
    const LedCommandPublisher& publishLedCommand);

}  // namespace farm
