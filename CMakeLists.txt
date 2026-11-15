cmake_minimum_required(VERSION 3.18)

# Single entry point for every native component in this repository.
#
#   ./cmake/Build-Native.ps1 -Configure             # configure and build everything
#   ./cmake/Build-Native.ps1 -Target ipvgo_game     # one target, no reconfigure
#
# The Visual Studio generator and CMake Tools drive the same folder, so a
# generator change has to reconfigure in place; Build-Native.ps1 does that.
#
# Each component keeps its own CMakeLists.txt and still configures standalone
# (`cmake -S ipvgo-engine -B ipvgo-engine/build`), which is what the helper
# scripts fall back to.
project(bitburner-scripts LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Release (performance) and RelWithDebInfo (profiling) flags for every component.
include("${CMAKE_CURRENT_SOURCE_DIR}/cmake/BuildTypes.cmake")

# One output folder for every executable: out/build/<config>/bin/.
# The per-configuration variables keep that layout flat for multi-config
# generators too. Without them the Visual Studio generator appends its own folder
# (bin/Release), and every consumer of the binaries - server.js, launch.json, the
# koth harnesses - would have to know which generator configured the tree last.
# Skipped for the Emscripten build, which controls its own output paths.
if(NOT EMSCRIPTEN)
  set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
  foreach(config IN ITEMS DEBUG RELEASE RELWITHDEBINFO MINSIZEREL)
    set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_${config} "${CMAKE_BINARY_DIR}/bin")
  endforeach()
endif()

if(NOT DEFINED CMAKE_TOOLCHAIN_FILE AND DEFINED ENV{VCPKG_ROOT})
  set(CMAKE_TOOLCHAIN_FILE "$ENV{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake"
    CACHE STRING "Vcpkg toolchain file")
endif()

# Faithful IPvGO game/opponent engine, MCGS, policy exploiter and CLI.
add_subdirectory(ipvgo-engine)

# King of the Hill solver tuning harness.
add_subdirectory(tests/koth_tune)
