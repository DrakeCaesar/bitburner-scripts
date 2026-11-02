# Measure the safety integration: settle (moyo weight) x vital level.
#   .\safety-sweep.ps1 -Faction Netburners -Size 7 -Games 40 -Seeds 1,2,3
param(
  [string]$Faction = "Netburners",
  [int]$Size = 7,
  [int]$Games = 40,
  [string]$Seeds = "1,2,3",
  [string]$Configs = "old,settle0.5,settle0.5+vital,settle0.25+vital,settle0"
)
$ErrorActionPreference = "Stop"
$exe = Join-Path $PSScriptRoot "..\..\cmake-build\bin\Release\ipvgo_game.exe"
$seedList = @($Seeds.Split(",") | ForEach-Object { [int]$_.Trim() })

$map = @{
  "old"              = @{ settle = "1";    vital = "0" }
  "settle0.5"        = @{ settle = "0.5";  vital = "0" }
  "settle0.5+vital"  = @{ settle = "0.5";  vital = "1" }
  "settle0.25+vital" = @{ settle = "0.25"; vital = "1" }
  "settle0"          = @{ settle = "0";    vital = "1" }
}

$env:IPVGO_NODE_LIMIT = "4000"
foreach ($name in $Configs.Split(",")) {
  $c = $map[$name]
  $env:IPVGO_SETTLE = $c.settle
  $env:IPVGO_VITAL = $c.vital
  $w = 0; $t = 0; $ms = 0.0
  foreach ($seed in $seedList) {
    $line = (& $exe exploitplay $Faction $Size $Games 2 $seed 2>&1 |
      Select-String "^exploitplay: .*wins=").Line
    if (-not $line) { throw "no result for $name seed $seed" }
    $w += [int]([regex]::Match($line, "wins=(\d+)/").Groups[1].Value)
    $t += [int]([regex]::Match($line, "wins=\d+/(\d+)").Groups[1].Value)
    $ms += [double]([regex]::Match($line, "avgBlackThinkMs=([\d.]+)").Groups[1].Value)
  }
  $p = $w / [double][math]::Max($t, 1)
  $se = 100.0 * [math]::Sqrt($p * (1 - $p) / [math]::Max($t, 1))
  "{0,-18} {1}x{1} wins={2,3}/{3,-3} ({4,5:N1}% +/-{5:N1})  ms/move={6:N0}" -f `
    $name, $Size, $w, $t, (100 * $p), $se, ($ms / [math]::Max($seedList.Count, 1))
}
$env:IPVGO_SETTLE = $null
$env:IPVGO_VITAL = $null
$env:IPVGO_NODE_LIMIT = $null
