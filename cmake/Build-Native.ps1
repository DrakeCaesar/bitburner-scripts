<#
.SYNOPSIS
Builds the native targets with the clang-cl environment loaded.

.DESCRIPTION
The native projects build with clang-cl (the LLVM toolset that ships with Visual
Studio) using Ninja, which invokes the compiler directly. It needs the
INCLUDE/LIB/PATH variables that the Visual Studio developer environment sets up, so
a plain shell (including a freshly opened VS Code terminal) cannot compile. This
script finds the Visual Studio installation with vswhere, imports its developer
shell, and then runs CMake. cl.exe is not supported: it compiles this search 17%
slower on the same flags.

The build directory, build type and generator all come from CMakePresets.json,
which the editor reads as well: the script only picks the preset matching the
options below. Anything that describes how to configure belongs in that file, not
here.

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

.EXAMPLE
./cmake/Build-Native.ps1 -BuildType RelWithDebInfo -Configure -ProfileInlining
Same tree, with inlining kept on so profile shares match Release.
#>
param(
  [ValidateSet('Release', 'RelWithDebInfo', 'Debug')]
  [string]$BuildType = 'Release',

  [string[]]$Target = @(),

  [switch]$Configure,

  # RelWithDebInfo only: keep inlining on so profile shares match Release.
  [switch]$ProfileInlining,

  # Profile-guided optimisation pass: Generate (instrument), Optimize (use the
  # collected profile) or Off. Both passes live in out/build/x64-Pgo and are driven
  # by cmake/Build-Pgo.ps1, which also runs the training workload between them.
  [ValidateSet('Off', 'Generate', 'Optimize')]
  [string]$Pgo = 'Off'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot

# CMakePresets.json is the single declaration of generator, build type and build
# directory. This script selects a preset and reads the folder back out of it, so the
# terminal, the editor and CMakeSettings.json cannot drift apart: a tree is bound to
# the generator that created it, and two generators on one folder abort a configure
# with "does not match the generator used previously".
# PGO lives in its own tree: the flags change between the two passes, so mixing it
# into x64-Release would rebuild that tree every time.
$presetName = if ($Pgo -ne 'Off') {
  if ($Pgo -eq 'Generate') { 'x64-Pgo-Generate' } else { 'x64-Pgo-Optimize' }
} else {
  switch ($BuildType) {
    'Release' { 'x64-Release' }
    'RelWithDebInfo' { 'x64-Profile' }
    'Debug' { 'x64-Debug' }
  }
}

$presets = Get-Content (Join-Path $repoRoot 'CMakePresets.json') -Raw | ConvertFrom-Json
$preset = $presets.configurePresets | Where-Object { $_.name -eq $presetName }
if (-not $preset) { throw "configure preset '$presetName' is missing from CMakePresets.json" }
$buildRoot = $preset.binaryDir.Replace('${sourceDir}', $repoRoot)
$folder = Split-Path -Leaf $buildRoot

# Presets inherit the generator and the compiler from a hidden base, and a value that
# comes from a parent is not on the child object after ConvertFrom-Json, so the chain
# is walked explicitly. Reading it straight off $preset silently returns nothing, which
# turns both checks below into no-ops.
function Get-PresetValue {
  param([string]$Name)
  $current = $preset
  while ($current) {
    if ($Name -eq 'generator' -and $current.PSObject.Properties.Name -contains 'generator') { return $current.generator }
    if ($Name -eq 'compiler' -and $current.cacheVariables -and
        ($current.cacheVariables.PSObject.Properties.Name -contains 'CMAKE_CXX_COMPILER')) {
      return $current.cacheVariables.CMAKE_CXX_COMPILER
    }
    $parent = @($current.inherits)[0]
    $current = if ($parent) { $presets.configurePresets | Where-Object { $_.name -eq $parent } } else { $null }
  }
  return $null
}

$wantGenerator = Get-PresetValue -Name 'generator'
$wantCompiler = Get-PresetValue -Name 'compiler'
if (-not $wantGenerator) { throw "preset '$presetName' declares no generator, not even through inherits" }

# The preset fixes the generator and the compiler, so a tree created by an older
# configuration (or by a tool that ignored the preset) can never be reconfigured in
# place: CMake aborts when either changes. Everything under the build root is
# generated output, so nothing is lost by starting over.
if ($Configure -and (Test-Path (Join-Path $buildRoot 'CMakeCache.txt'))) {
  $cache = Join-Path $buildRoot 'CMakeCache.txt'
  $cachedLine = Select-String -Path $cache -Pattern '^CMAKE_GENERATOR:INTERNAL=' | Select-Object -First 1
  $cachedGenerator = if ($cachedLine) { ($cachedLine.Line -split '=', 2)[1].Trim() } else { '' }
  if ($cachedGenerator -and $cachedGenerator -notlike "$wantGenerator*") {
    Write-Host "Build tree in out/build/$folder was configured with '$cachedGenerator'; resetting it for $wantGenerator."
    Remove-Item -Recurse -Force $buildRoot
  }
}

# Same for the compiler: the presets all declare clang-cl, and a tree built by cl.exe
# (every tree older than the switch to clang) has to be rebuilt from scratch.
if ($wantCompiler -and (Test-Path (Join-Path $buildRoot 'CMakeCache.txt'))) {
  $cachedLine = Select-String -Path (Join-Path $buildRoot 'CMakeCache.txt') -Pattern '^CMAKE_CXX_COMPILER:[A-Z]+=' | Select-Object -First 1
  $cachedCompiler = if ($cachedLine) { Split-Path -Leaf ($cachedLine.Line -split '=', 2)[1].Trim() } else { '' }
  if ($cachedCompiler -and $cachedCompiler -notlike "$wantCompiler*") {
    Write-Host "Build tree in out/build/$folder was configured with '$cachedCompiler'; resetting it for $wantCompiler."
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

# Every preset configures with clang-cl, so a missing LLVM toolset has to fail here
# with instructions rather than inside CMake's compiler test.
if (-not (Get-Command clang-cl -ErrorAction SilentlyContinue)) {
  throw ('clang-cl not found on PATH after loading the Visual Studio environment. ' +
    'Install the "C++ Clang tools for Windows" component (it puts clang-cl in ' +
    "$vsPath\VC\Tools\Llvm\x64\bin) and run this again.")
}

# The configure step only runs when asked: `cmake --preset` re-runs the generator every
# time, and repeating it on every build costs a couple of seconds. A PGO pass always
# reconfigures, because the two passes differ only in these flags and CMake has to see
# the change for Ninja to rebuild against the collected profile.
if ($Configure -or $Pgo -ne 'Off' -or -not (Test-Path (Join-Path $buildRoot 'CMakeCache.txt'))) {
  $configureArgs = @('--preset', $presetName)
  # RelWithDebInfo only, and the same tree: inlining is a cache variable, not a
  # separate configuration.
  if ($ProfileInlining) { $configureArgs += '-DIPVGO_PROFILE_INLINING=ON' }
  Push-Location $repoRoot
  try {
    & cmake @configureArgs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } finally {
    Pop-Location
  }
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
