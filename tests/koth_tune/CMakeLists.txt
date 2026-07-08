cmake_minimum_required(VERSION 3.16)
project(koth_bench LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

if(MSVC)
  add_compile_options($<$<CONFIG:Release>:/O2>)
else()
  add_compile_options($<$<CONFIG:Release>:-O3>)
endif()

add_executable(koth_bench
  src/koth_game.cpp
  src/koth_solver.cpp
  src/koth_bench_main.cpp
)

find_package(Threads REQUIRED)
target_link_libraries(koth_bench PRIVATE Threads::Threads)

if(MSVC)
  target_compile_options(koth_bench PRIVATE /W4 /EHsc)
  target_compile_definitions(koth_bench PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
else()
  target_compile_options(koth_bench PRIVATE -Wall -Wextra -Wpedantic)
endif()
