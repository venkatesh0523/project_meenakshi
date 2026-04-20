cmake_minimum_required(VERSION 3.16)
project(farm_cpp_api LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(farm_cpp_api_logic src/api_logic.cpp)
target_include_directories(farm_cpp_api_logic PUBLIC src)

find_path(MOSQUITTO_INCLUDE_DIR mosquitto.h)
find_library(MOSQUITTO_LIBRARY mosquitto)

if(MOSQUITTO_INCLUDE_DIR AND MOSQUITTO_LIBRARY)
  add_executable(farm_cpp_api src/main.cpp)
  target_include_directories(farm_cpp_api PRIVATE ${MOSQUITTO_INCLUDE_DIR})
  target_link_libraries(farm_cpp_api PRIVATE farm_cpp_api_logic ${MOSQUITTO_LIBRARY})
else()
  message(WARNING "Mosquitto development files not found; skipping farm_cpp_api executable")
endif()

enable_testing()

add_executable(farm_cpp_api_tests tests/api_logic_tests.cpp)
target_link_libraries(farm_cpp_api_tests PRIVATE farm_cpp_api_logic)

add_test(NAME farm_cpp_api_tests COMMAND farm_cpp_api_tests)
