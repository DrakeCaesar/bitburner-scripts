cmake_minimum_required(VERSION 3.18)
project(bitburner-ipvgo-engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(NOT DEFINED CMAKE_TOOLCHAIN_FILE AND DEFINED ENV{VCPKG_ROOT})
  set(CMAKE_TOOLCHAIN_FILE "$ENV{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake"
    CACHE STRING "Vcpkg toolchain file")
endif()

find_package(nlohmann_json CONFIG QUIET)
if(NOT nlohmann_json_FOUND)
  include(FetchContent)
  FetchContent_Declare(
    nlohmann_json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
    GIT_SHALLOW TRUE)
  FetchContent_MakeAvailable(nlohmann_json)
endif()

# ---------------------------------------------------------------------------
# Faithful IPvGO rules + opponent AIs (no external ML dependency).
# ---------------------------------------------------------------------------
set(GAME_SOURCES
  cpp/game/go_game.cpp
  cpp/game/obstacles.cpp
  cpp/game/analysis.cpp
  cpp/game/patterns.cpp
  cpp/game/setup.cpp
  cpp/game/opponents.cpp
  cpp/game/fast_queries.cpp
  cpp/game/cheats.cpp
  cpp/game/game_engine.cpp
)

add_library(ipvgo_game_core STATIC ${GAME_SOURCES})
# third_party/ holds ankerl::unordered_dense (MIT), a single header, vendored so
# the build stays offline.
target_include_directories(ipvgo_game_core PUBLIC cpp/game third_party)
set_property(TARGET ipvgo_game_core PROPERTY POSITION_INDEPENDENT_CODE ON)
# /arch:AVX2 is safe here: this library is only used by the native tools, and it
# lets the compiler widen the 64-bit bit-plane loops.
if(MSVC)
  target_compile_options(ipvgo_game_core PRIVATE $<$<CONFIG:Release>:/O2 /arch:AVX2>)
else()
  target_compile_options(ipvgo_game_core PRIVATE $<$<CONFIG:Release>:-O3 -march=native>)
endif()

# ---------------------------------------------------------------------------
# Legacy heuristic MCTS engine (native passthrough target).
#
# The WebAssembly build of this engine used to live here too; it is abandoned, so
# only the native binary remains (the server uses it as the "native" fallback).
# ---------------------------------------------------------------------------
set(ENGINE_SOURCES
  cpp/board.cpp
  cpp/mcts.cpp
  cpp/engine.cpp
  cpp/json_api.cpp
)

message(STATUS "Building native IPvGO engines")
find_package(Threads REQUIRED)

add_executable(ipvgo_engine cpp/standalone.cpp ${ENGINE_SOURCES})
target_include_directories(ipvgo_engine PRIVATE cpp)
target_link_libraries(ipvgo_engine PRIVATE nlohmann_json::nlohmann_json Threads::Threads)
if(MSVC)
  target_compile_options(ipvgo_engine PRIVATE $<$<CONFIG:Release>:/O2>)
else()
  target_compile_options(ipvgo_engine PRIVATE $<$<CONFIG:Release>:-O3>)
endif()
install(TARGETS ipvgo_engine DESTINATION bin)

# Faithful-engine CLI: selftest / parity / aimove / gen / mcgs / exploit / serve / bench.
add_executable(ipvgo_game cpp/game/game_cli.cpp cpp/nn/mcgs.cpp cpp/nn/exploiter.cpp cpp/nn/bench_tui.cpp cpp/nn/optbench.cpp)
target_include_directories(ipvgo_game PRIVATE cpp/game cpp/nn)
target_link_libraries(ipvgo_game PRIVATE ipvgo_game_core nlohmann_json::nlohmann_json Threads::Threads)
if(MSVC)
  target_compile_options(ipvgo_game PRIVATE $<$<CONFIG:Release>:/arch:AVX2>)
else()
  target_compile_options(ipvgo_game PRIVATE $<$<CONFIG:Release>:-march=native>)
endif()
install(TARGETS ipvgo_game DESTINATION bin)

# In-process profiler (off by default). The Visual Studio / ETW CPU profiler
# needs an elevated session; this tool samples the thread stacks and tracks
# allocations from inside the process, so it runs unprivileged.
option(IPVGO_BUILD_PROFILER "Build the ipvgo_prof sampling/allocation profiler" OFF)
if(IPVGO_BUILD_PROFILER)
  add_executable(ipvgo_prof tools/prof/prof.cpp cpp/nn/exploiter.cpp ${GAME_SOURCES})
  target_include_directories(ipvgo_prof PRIVATE cpp/game cpp/nn third_party)
  # Optimised like the real engine, with symbols for StackWalk64/dbghelp.
  target_compile_options(ipvgo_prof PRIVATE /Zi /O2 /Ob2 /arch:AVX2 /DNDEBUG)
  target_link_options(ipvgo_prof PRIVATE /DEBUG)
  target_link_libraries(ipvgo_prof PRIVATE Threads::Threads dbghelp psapi winmm)
endif()
