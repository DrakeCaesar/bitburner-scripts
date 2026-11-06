<#
.SYNOPSIS
Builds the native targets with the MSVC environment loaded.

.DESCRIPTION
The native projects use Ninja, which invokes cl.exe directly. cl.exe needs the
INCLUDE/LIB/PATH variables that the Visual Studio developer environment sets up,
so a plain shell (including a freshly opened VS Code terminal) cannot compile.
This script finds the Visual Studio installation with vswhere, imports its
developer shell, and then runs CMake.

.PARAMETER BuildType
Release (performance), RelWithDebInfo (profiling, built into x64-Profile) or Debug.

.PARAMETER Target
Optional CMake target names. Omit to build everything.

.PARAMETER Configure
Run the configure step first. Needed for a new build folder or after editing a
CMakeLists.txt that adds targets or options.

.EXAMPLE
./cmake/Build-Native.ps1 -Configure
Builds every native target in Release.

.EXAMPLE
./cmake/Build-Native.ps1 -BuildType RelWithDebInfo -Target ipvgo_game
Builds the profiler-friendly engine build into out/build/x64-Profile.
#>
param(
  [ValidateSet('Release', 'RelWithDebInfo', 'Debug')]
  [string]$BuildType = 'Release',

  [string[]]$Target = @(),

  [switch]$Configure,

  # RelWithDebInfo only: keep inlining on so profile shares match Release.
  [switch]$ProfileInlining
)

$ErrorActionPreference = 'Stop'

# CMakeSettings.json names these folders; keep the script's mapping identical so
# the terminal and the IDE share one build tree.
$folder = switch ($BuildType) {
  'Release' { 'x64-Release' }
  'RelWithDebInfo' { 'x64-Profile' }
  'Debug' { 'x64-Debug' }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$buildRoot = Join-Path $repoRoot "out/build/$folder"

# A CMake build tree is bound to the generator that created it. The IDE (Visual
# Studio generator, multi-config) and this script (Ninja, single-config) share one
# folder, and reconfiguring a tree with the other generator aborts with
# "generator ... does not match the generator used previously". Rebuild in the same
# folder instead: drop the generated files and let CMake start over. Everything
# under the build root is generated output, so nothing is lost.
if ($Configure -and (Test-Path (Join-Path $buildRoot 'CMakeCache.txt'))) {
  $cache = Join-Path $buildRoot 'CMakeCache.txt'
  $cachedLine = Select-String -Path $cache -Pattern '^CMAKE_GENERATOR:INTERNAL=' | Select-Object -First 1
  $cachedGenerator = if ($cachedLine) { ($cachedLine.Line -split '=', 2)[1].Trim() } else { '' }
  if ($cachedGenerator -and $cachedGenerator -ne 'Ninja') {
    Write-Host "Build tree in out/build/$folder was configured with '$cachedGenerator'; resetting it for Ninja."
    Remove-Item -Recurse -Force $buildRoot
  }
}

# Locate Visual Studio instead of hardcoding a version, so a VS upgrade does not
# break the build.
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (-not (Test-Path $vswhere)) {
  throw "vswhere.exe not found at $vswhere; install Visual Studio with the C++ workload."
}

$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) {
  throw 'No Visual Studio installation with the C++ build tools was found.'
}

$devShell = Join-Path $vsPath 'Common7/Tools/Launch-VsDevShell.ps1'
if (-not (Test-Path $devShell)) {
  throw "Launch-VsDevShell.ps1 not found under $vsPath."
}

Import-Module (Join-Path $vsPath 'Common7/Tools/Microsoft.VisualStudio.DevShell.dll')
Enter-VsDevShell -VsInstallPath $vsPath -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null

if ($Configure) {
  $inlining = if ($ProfileInlining) { 'ON' } else { 'OFF' }
  & cmake -B $buildRoot -G Ninja "-DCMAKE_BUILD_TYPE=$BuildType" "-DIPVGO_PROFILE_INLINING=$inlining"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$buildArgs = @('--build', $buildRoot)
# Values arrive as one literal string when the script is invoked with -File
# (e.g. "-Target a,b"), so accept both a comma list and separate arguments.
$targets = @($Target | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($targets.Count -gt 0) {
  $buildArgs += '--target'
  $buildArgs += $targets
}

& cmake @buildArgs
exit $LASTEXITCODE
