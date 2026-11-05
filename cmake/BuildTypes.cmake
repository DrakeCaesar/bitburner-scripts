# Build types for the native components. Mirrors the Bloxx repository layout.
#
# Two configurations matter:
#
#   Release          performance - what benchmarks and throughput numbers use
#   RelWithDebInfo   profiling   - what the Visual Studio CPU profiler uses
#
# Included by the root CMakeLists.txt and by every component, so a standalone
# configure (`cmake -S ipvgo-engine -B ipvgo-engine/build`) gets the same flags
# from either entry point.
if(DEFINED IPVGO_BUILD_TYPES_INCLUDED)
  return()
endif()
set(IPVGO_BUILD_TYPES_INCLUDED ON)

# Single configuration focus: Release, unless asked otherwise. Multi-config
# generators (Visual Studio) ignore this and keep their own configuration list.
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

if(MSVC)
  # Release: fastest executable. Whole program optimization is deliberately on,
  # which means this build is the wrong one to profile - use RelWithDebInfo.
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} /O2")        # Optimize for speed
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} /GL")        # Whole program optimization (needs /LTCG)
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} /arch:AVX2") # Enable AVX2
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} /DNDEBUG")   # Disable asserts

  set(CMAKE_EXE_LINKER_FLAGS_RELEASE "${CMAKE_EXE_LINKER_FLAGS_RELEASE} /LTCG") # Link-time codegen

  # RelWithDebInfo: same optimisation class, but every frame and every line stays
  # visible to the profiler. /Ob0 turns inlining off, so samples point at the line
  # that did the work instead of the caller it was folded into; flip it to /Ob2
  # when the timings need to reflect the performance build.
  #
  # The variable is reset to the MSVC default first: RelWithDebInfo already ships
  # /Ob1, and appending /Ob0 on top of it only earns a "D9025: overriding" warning.
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "/O2 /Zi /DNDEBUG")
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} /arch:AVX2") # Enable AVX2
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} /Zo")        # Better source-line info
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} /Oy-")       # Keep frame pointers
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} /Ob0")       # Inlining OFF for profiling (flip to /Ob2)

  set(CMAKE_EXE_LINKER_FLAGS_RELWITHDEBINFO "${CMAKE_EXE_LINKER_FLAGS_RELWITHDEBINFO} /DEBUG:FULL") # Full PDB
else()
  # Unix-style clang/gcc: max optimizations for speed.
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -O3")           # Optimize aggressively
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -march=native") # Use host ISA
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -flto")         # Link-time optimization
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -DNDEBUG")      # Disable asserts

  set(CMAKE_EXE_LINKER_FLAGS_RELEASE "${CMAKE_EXE_LINKER_FLAGS_RELEASE} -flto")

  # Profiling mirrors the MSVC split: line attribution and walkable stacks.
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} -O2")
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} -march=native")
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} -g")
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} -fno-omit-frame-pointer")
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} -fno-inline")
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} -DNDEBUG")

  set(CMAKE_EXE_LINKER_FLAGS_RELWITHDEBINFO "${CMAKE_EXE_LINKER_FLAGS_RELWITHDEBINFO} -g")
endif()
