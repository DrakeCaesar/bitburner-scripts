cmake_minimum_required(VERSION 3.18)

# Single entry point for every native component in this repository.
#
#   cmake --preset release           # configure everything
#   cmake --build --preset release   # build everything
#
# Each component keeps its own CMakeLists.txt and still configures standalone
# (`cmake -S ipvgo-engine -B ipvgo-engine/build`), which is what the helper
# scripts fall back to.
project(bitburner-scripts LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# One output folder for every executable: cmake-build/bin/<Config>/.
# Skipped for the Emscripten build, which controls its own output paths.
if(NOT EMSCRIPTEN)
  set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
endif()

if(NOT DEFINED CMAKE_TOOLCHAIN_FILE AND DEFINED ENV{VCPKG_ROOT})
  set(CMAKE_TOOLCHAIN_FILE "$ENV{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake"
    CACHE STRING "Vcpkg toolchain file")
endif()

# Faithful IPvGO game/opponent engine, MCGS, policy exploiter and CLI.
add_subdirectory(ipvgo-engine)

# King of the Hill solver tuning harness.
add_subdirectory(tests/koth_tune)
