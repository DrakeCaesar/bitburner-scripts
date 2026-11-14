cmake_minimum_required(VERSION 3.18)
project(bitburner-ipvgo-engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Release (performance) and RelWithDebInfo (profiling) flags. The guard inside
# the module makes the double include harmless when this project is built from
# the repository root.
include("${CMAKE_CURRENT_SOURCE_DIR}/../cmake/BuildTypes.cmake")

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
  cpp/game/safety.cpp
  cpp/game/influence.cpp
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
# AVX2 and the per-configuration optimisation flags come from cmake/BuildTypes.cmake
# (/arch:AVX2 lets the compiler widen the 64-bit bit-plane loops; the loops are
# safe under it because this library is only used by the native tools).
set_property(TARGET ipvgo_game_core PROPERTY POSITION_INDEPENDENT_CODE ON)

message(STATUS "Building the native IPvGO engine")
find_package(Threads REQUIRED)

# The one engine binary: selftest / parity / aimove / gen / mcgs / exploit / serve /
# bench / optbench / tune / prof. The legacy heuristic MCTS engine that used to build
# alongside it as `ipvgo_engine` is gone: it had no exploiter, nothing served it, and a
# tree built with only that target looked built while having no engine at all.
add_executable(ipvgo_game cpp/game/game_cli.cpp cpp/search/mcgs.cpp cpp/search/exploiter.cpp cpp/search/bench_tui.cpp cpp/search/optbench.cpp cpp/search/profiler.cpp cpp/search/fast_alloc.cpp)
target_include_directories(ipvgo_game PRIVATE cpp/game cpp/search)
target_link_libraries(ipvgo_game PRIVATE ipvgo_game_core nlohmann_json::nlohmann_json Threads::Threads)
# The built-in `prof` subcommand (allocation counts + in-process stack sampling)
# exists only in the profiling configuration: it replaces operator new, which
# the performance build must not pay for.
if(WIN32)
  target_compile_definitions(ipvgo_game PRIVATE $<$<CONFIG:RelWithDebInfo>:IPVGO_PROFILER>)
  target_link_libraries(ipvgo_game PRIVATE $<$<CONFIG:RelWithDebInfo>:dbghelp> $<$<CONFIG:RelWithDebInfo>:psapi> $<$<CONFIG:RelWithDebInfo>:winmm>)
endif()
install(TARGETS ipvgo_game DESTINATION bin)
