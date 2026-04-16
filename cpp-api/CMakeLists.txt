cmake_minimum_required(VERSION 3.16)
project(farm_cpp_api LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(farm_cpp_api src/main.cpp)
target_link_libraries(farm_cpp_api PRIVATE mosquitto)
