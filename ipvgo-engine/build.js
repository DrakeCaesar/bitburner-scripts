import { execSync } from "child_process"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cppDir = path.join(__dirname, "cpp")
const isDebug = process.argv.includes("--debug")

const sources = ["board.cpp", "mcts.cpp", "engine.cpp", "json_api.cpp", "api.cpp"].map((f) =>
  path.join(cppDir, f).replace(/\\/g, "/")
)

for (const file of sources) {
  if (!fs.existsSync(file)) {
    console.error(`Missing source: ${file}`)
    process.exit(1)
  }
}

const outJs = path.join(cppDir, "ipvgo.wasm.js").replace(/\\/g, "/")
const outWasm = path.join(cppDir, "ipvgo.wasm.wasm").replace(/\\/g, "/")

const common = [
  "-std=c++17",
  `-I${path.join(cppDir).replace(/\\/g, "/")}`,
  "-s WASM=1",
  "-s ALLOW_MEMORY_GROWTH=1",
  "-s EXPORTED_RUNTIME_METHODS=['ccall','cwrap']",
  "-s EXPORT_ES6=1",
  "-s EXPORT_NAME=createIpvgoModule",
  "-s ENVIRONMENT=web,worker",
  "--bind",
  "--no-entry",
]

const vcpkgRoot = process.env.VCPKG_ROOT
if (vcpkgRoot) {
  common.push(`-I"${vcpkgRoot}/installed/wasm32-emscripten/include"`)
}

const flags = isDebug
  ? [...common, "-O0", "-g", "-s ASSERTIONS=2"]
  : [
      ...common,
      "-O3",
      "-flto",
      "-fno-exceptions",
      "-fno-rtti",
      "-s ASSERTIONS=0",
      "-s DISABLE_EXCEPTION_CATCHING=1",
    ]

const cmd = `emcc ${sources.join(" ")} -o "${outJs}" ${flags.join(" ")}`
console.log(`Building IPvGO WASM (${isDebug ? "debug" : "release"})...`)
execSync(cmd, { stdio: "inherit", cwd: __dirname })

if (fs.existsSync(outWasm)) {
  console.log(`WASM: ${(fs.statSync(outWasm).size / 1024).toFixed(1)} KB`)
}
