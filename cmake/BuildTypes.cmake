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

if(MSVC AND CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  # clang-cl, the LLVM toolset that ships with Visual Studio (VC\Tools\Llvm\x64\bin),
  # is the compiler for every configuration here. It produces the same search
  # decisions as cl.exe - identical node counts, selftest passes - in 16-18% less
  # time, so there is no reason to build this project with anything else. cl.exe stays
  # reachable as an opt-in cross-check (x64-Release-Msvc) purely to re-measure this:
  #
  #   optbench   MSVC (cl)   clang-cl   delta
  #   depth 3      415.3 ms    348.1 ms   -16.2%
  #   depth 4     7321.2 ms   6028.6 ms   -17.7%
  #
  # About two points of that is link-time optimisation (clang without -flto lands at
  # 358.6 ms, -13.7%); the rest is codegen. Nothing further is left in the flags:
  # -march=native, /GS-, -flto=thin and PGO were each built and measured flat, and
  # /O2 is already cc1 -O3 (clang-cl -### shows it).
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} /O2")        # Optimize for speed
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} /arch:AVX2") # Enable AVX2
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -flto=full") # /GL equivalent
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -DNDEBUG")
  # -flto here is the link-time half of the same option, and lld-link is the only
  # linker that consumes the bitcode (link.exe cannot). Both are needed.
  set(CMAKE_EXE_LINKER_FLAGS_RELEASE "${CMAKE_EXE_LINKER_FLAGS_RELEASE} -flto=full -fuse-ld=lld")

  # RelWithDebInfo: same optimisation class, but every frame and every line stays
  # visible to the profiler. /Ob0 turns inlining off, so samples point at the line
  # that did the work instead of the caller it was folded into; flip it to /Ob2 when
  # the timings need to reflect the performance build.
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "/O2 /arch:AVX2 /Zi /DNDEBUG /Oy-")
  option(IPVGO_PROFILE_INLINING "Keep inlining enabled in the RelWithDebInfo (profiling) build" OFF)
  if(IPVGO_PROFILE_INLINING)
    set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} /Ob2")
  else()
    set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} /Ob0")
  endif()
  set(CMAKE_EXE_LINKER_FLAGS_RELWITHDEBINFO "${CMAKE_EXE_LINKER_FLAGS_RELWITHDEBINFO} /DEBUG:FULL")

  # Profile-guided optimisation, in two passes over the same build tree:
  #   cmake -DIPVGO_PGO=GENERATE ... ; build ; run a training workload
  #   cmake -DIPVGO_PGO=OPTIMIZE ... ; build
  # The instrumented build writes .profraw files under ${CMAKE_BINARY_DIR}/prof
  # (LLVM_PROFILE_FILE overrides the name per process), llvm-profdata merges them
  # into ipvgo.profdata, and the second pass reads it. cmake/Build-Pgo.ps1 drives
  # all of that. It is neutral on this codebase - see the README - but the plumbing
  # stays because a structural change is the only thing that would move it.
  set(IPVGO_PGO "OFF" CACHE STRING "Profile-guided optimisation: OFF, GENERATE or OPTIMIZE")
  set_property(CACHE IPVGO_PGO PROPERTY STRINGS OFF GENERATE OPTIMIZE)
  if(NOT IPVGO_PGO STREQUAL "OFF")
    if(IPVGO_PGO STREQUAL "GENERATE")
      set(CMAKE_CXX_FLAGS_RELEASE
          "${CMAKE_CXX_FLAGS_RELEASE} -fprofile-generate=${CMAKE_BINARY_DIR}/prof")
    else()
      set(CMAKE_CXX_FLAGS_RELEASE
          "${CMAKE_CXX_FLAGS_RELEASE} -fprofile-use=${CMAKE_BINARY_DIR}/ipvgo.profdata -Wno-profile-instr-out-of-date -Wno-profile-instr-unprofiled")
    endif()
    message(STATUS "PGO: ${IPVGO_PGO}")
  endif()
elseif(MSVC)
  # cl.exe, kept only as an explicit cross-check target for the clang-cl numbers
  # above. It compiles this search 17% slower on the same flags, so nothing is served
  # from it and it is opt-in: the x64-Release-Msvc preset (or -DIPVGO_ALLOW_MSVC=ON)
  # sets the flag, and a plain cl.exe configure stops here rather than quietly
  # producing the slower binary.
  if(NOT IPVGO_ALLOW_MSVC)
    message(FATAL_ERROR
      "This project builds with clang-cl, not cl.exe.\n"
      "  - Configure through the presets (cmake --preset x64-Release) or "
      "cmake/Build-Native.ps1, which pass the compiler.\n"
      "  - clang-cl comes from the \"C++ Clang tools for Windows\" component of Visual "
      "Studio; check that VC\\Tools\\Llvm\\x64\\bin\\clang-cl.exe exists.\n"
      "  - For the MSVC cross-check build, use the x64-Release-Msvc preset or "
      "-DIPVGO_ALLOW_MSVC=ON.")
  endif()

  # Release: the flags the clang-cl numbers were measured against.
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} /O2")
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} /GL")
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} /arch:AVX2")
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} /DNDEBUG")
  set(CMAKE_EXE_LINKER_FLAGS_RELEASE "${CMAKE_EXE_LINKER_FLAGS_RELEASE} /LTCG")

  # Profiling build, same split as the clang-cl branch: debug info and frame pointers
  # kept, inlining off, no LTO.
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "/O2 /Zi /DNDEBUG")
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} /arch:AVX2")
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} /Zo")
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} /Oy-")
  option(IPVGO_PROFILE_INLINING "Keep inlining enabled in the RelWithDebInfo (profiling) build" OFF)
  if(IPVGO_PROFILE_INLINING)
    set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} /Ob2")
  else()
    set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} /Ob0")
  endif()
  set(CMAKE_EXE_LINKER_FLAGS_RELWITHDEBINFO "${CMAKE_EXE_LINKER_FLAGS_RELWITHDEBINFO} /DEBUG:FULL")

  # PGO stays clang-cl only: the instrumentation is -fprofile-generate/-fprofile-use
  # and cmake/Build-Pgo.ps1 merges with llvm-profdata. The variable is declared here
  # too so an MSVC configure gets this message instead of an empty-string comparison.
  set(IPVGO_PGO "OFF" CACHE STRING "Profile-guided optimisation: OFF, GENERATE or OPTIMIZE")
  set_property(CACHE IPVGO_PGO PROPERTY STRINGS OFF GENERATE OPTIMIZE)
  if(NOT IPVGO_PGO STREQUAL "OFF")
    message(FATAL_ERROR
      "IPVGO_PGO is wired for clang-cl only; build the PGO tree with the clang-cl "
      "presets (cmake/Build-Pgo.ps1 does that).")
  endif()
else()
  # Unix-style clang/gcc: max optimizations for speed.
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -O3")           # Optimize aggressively
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -march=native") # Use host ISA
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -flto")         # Link-time optimization
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -DNDEBUG")      # Disable asserts

  set(CMAKE_EXE_LINKER_FLAGS_RELEASE "${CMAKE_EXE_LINKER_FLAGS_RELEASE} -flto")

  # Profiling mirrors the RelWithDebInfo split above: line attribution and walkable
  # stacks.
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} -O2")
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} -march=native")
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} -g")
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} -fno-omit-frame-pointer")
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} -fno-inline")
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} -DNDEBUG")

  set(CMAKE_EXE_LINKER_FLAGS_RELWITHDEBINFO "${CMAKE_EXE_LINKER_FLAGS_RELWITHDEBINFO} -g")
endif()
