cmake_minimum_required(VERSION 3.10)
project(bitburner-ipvgo-engine)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

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

set(ENGINE_SOURCES
  cpp/board.cpp
  cpp/mcts.cpp
  cpp/engine.cpp
  cpp/json_api.cpp
)

if(EMSCRIPTEN)
  message(STATUS "Building IPvGO engine for WebAssembly")
  add_executable(ipvgo_wasm cpp/api.cpp ${ENGINE_SOURCES})
  target_include_directories(ipvgo_wasm PRIVATE cpp)
  target_link_libraries(ipvgo_wasm PRIVATE nlohmann_json::nlohmann_json)
  set(EMSCRIPTEN_LINK_FLAGS
    "-s WASM=1 \
     -s ALLOW_MEMORY_GROWTH=1 \
     -s EXPORTED_RUNTIME_METHODS=['ccall','cwrap'] \
     -s EXPORT_ES6=1 \
     -s EXPORT_NAME=createIpvgoModule \
     -s USE_ES6_IMPORT_META=0 \
     -s ENVIRONMENT=web,worker \
     -O3 \
     --bind")
  set_target_properties(ipvgo_wasm PROPERTIES
    LINK_FLAGS "${EMSCRIPTEN_LINK_FLAGS}"
    OUTPUT_NAME "ipvgo.wasm"
    SUFFIX ".js")
else()
  message(STATUS "Building native IPvGO engine executable")
  add_executable(ipvgo_engine cpp/standalone.cpp ${ENGINE_SOURCES})
  target_include_directories(ipvgo_engine PRIVATE cpp)
  target_link_libraries(ipvgo_engine PRIVATE nlohmann_json::nlohmann_json)
  find_package(Threads REQUIRED)
  target_link_libraries(ipvgo_engine PRIVATE Threads::Threads)
  if(MSVC)
    target_compile_options(ipvgo_engine PRIVATE $<$<CONFIG:Release>:/O2>)
  else()
    target_compile_options(ipvgo_engine PRIVATE $<$<CONFIG:Release>:-O3>)
  endif()
  install(TARGETS ipvgo_engine DESTINATION bin)
endif()
