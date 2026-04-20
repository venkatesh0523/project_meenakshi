#include "../src/api_logic.h"

#include <cassert>
#include <string>
#include <vector>

namespace {

struct PublishedCommand {
  std::string deviceId;
  std::string command;
};

std::string request(const std::string& method, const std::string& target) {
  return method + " " + target + " HTTP/1.1\r\nHost: localhost\r\n\r\n";
}

bool contains(const std::string& value, const std::string& expected) {
  return value.find(expected) != std::string::npos;
}

void assertStatus(const std::string& response, const std::string& status) {
  assert(contains(response, "HTTP/1.1 " + status));
}

void testHealthRouteDoesNotPublish() {
  bool publisherCalled = false;
  const std::string response = farm::handleHttpRequest(
      request("GET", "/health"),
      "default-device",
      [&](const std::string&, const std::string&, std::string&) {
        publisherCalled = true;
        return true;
      });

  assertStatus(response, "200 OK");
  assert(contains(response, R"({"status":"ok","service":"cpp-api"})"));
  assert(!publisherCalled);
}

void testDefaultLedOnPublishesDefaultDevice() {
  std::vector<PublishedCommand> published;
  const std::string response = farm::handleHttpRequest(
      request("POST", "/api/led/on"),
      "default-device",
      [&](const std::string& deviceId, const std::string& command, std::string&) {
        published.push_back({deviceId, command});
        return true;
      });

  assertStatus(response, "200 OK");
  assert(published.size() == 1);
  assert(published[0].deviceId == "default-device");
  assert(published[0].command == "ON");
  assert(contains(response, R"("topic":"farm1/default-device/cmd")"));
}

void testDefaultLedOffPublishesDefaultDevice() {
  std::vector<PublishedCommand> published;
  const std::string response = farm::handleHttpRequest(
      request("POST", "/api/led/off"),
      "default-device",
      [&](const std::string& deviceId, const std::string& command, std::string&) {
        published.push_back({deviceId, command});
        return true;
      });

  assertStatus(response, "200 OK");
  assert(published.size() == 1);
  assert(published[0].deviceId == "default-device");
  assert(published[0].command == "OFF");
}

void testSpecificDeviceCommandPublishesRequestedDevice() {
  std::vector<PublishedCommand> published;
  const std::string response = farm::handleHttpRequest(
      request("POST", "/api/devices/arduino-uno/commands/off"),
      "default-device",
      [&](const std::string& deviceId, const std::string& command, std::string&) {
        published.push_back({deviceId, command});
        return true;
      });

  assertStatus(response, "200 OK");
  assert(published.size() == 1);
  assert(published[0].deviceId == "arduino-uno");
  assert(published[0].command == "OFF");
  assert(contains(response, R"("message":"Device command sent")"));
  assert(contains(response, R"("topic":"farm1/arduino-uno/cmd")"));
}

void testUnknownRouteReturnsNotFound() {
  bool publisherCalled = false;
  const std::string response = farm::handleHttpRequest(
      request("GET", "/api/led/on"),
      "default-device",
      [&](const std::string&, const std::string&, std::string&) {
        publisherCalled = true;
        return true;
      });

  assertStatus(response, "404 Not Found");
  assert(contains(response, R"({"message":"Route not found"})"));
  assert(!publisherCalled);
}

void testPublishFailureReturnsEscapedServerError() {
  const std::string response = farm::handleHttpRequest(
      request("POST", "/api/led/on"),
      "default-device",
      [&](const std::string&, const std::string&, std::string& errorMessage) {
        errorMessage = R"(broker "down")";
        return false;
      });

  assertStatus(response, "500 Internal Server Error");
  assert(contains(response, R"({"message":"broker \"down\""})"));
}

void testHelpers() {
  const std::vector<std::string> parts = farm::splitPath("//api/devices/abc/commands/on/");
  assert(parts.size() == 5);
  assert(parts[0] == "api");
  assert(parts[2] == "abc");
  assert(parts[4] == "on");

  assert(farm::extractRequestMethod(request("POST", "/health")) == "POST");
  assert(farm::extractRequestTarget(request("POST", "/health")) == "/health");
  assert(farm::jsonEscape(R"(a\b"c)") == R"(a\\b\"c)");
}

}  // namespace

int main() {
  testHealthRouteDoesNotPublish();
  testDefaultLedOnPublishesDefaultDevice();
  testDefaultLedOffPublishesDefaultDevice();
  testSpecificDeviceCommandPublishesRequestedDevice();
  testUnknownRouteReturnsNotFound();
  testPublishFailureReturnsEscapedServerError();
  testHelpers();
  return 0;
}
