#pragma once

// argv[0] is the subcommand name; the rest are the optional
// [faction] [boardSize] [games] [nodeLimit]. Returns non-zero when the build
// has no profiler (anything but the Windows profiling configuration).
int runProfiler(int argc, char** argv);
