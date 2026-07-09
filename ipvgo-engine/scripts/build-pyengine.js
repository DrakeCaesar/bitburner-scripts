/**
 * Build the pyipvgo pybind11 extension module.
 *
 * Uses the active Python's installed pybind11 CMake config (so the build always
 * matches the interpreter that will import the module), configures CMake with
 * IPVGO_BUILD_PYTHON=ON, and builds the `pyipvgo` target. The compiled module is
 * emitted into ipvgo-engine/python/ by CMakeLists.txt.
 */

import { execFileSync } from "child_process"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const python = process.env.PYTHON ?? "python"

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(" ")}`)
  execFileSync(cmd, args, { stdio: "inherit", cwd: root, ...opts })
}

function capture(cmd, args) {
  return execFileSync(cmd, args, { cwd: root, encoding: "utf8" }).trim()
}

let pybindDir
try {
  pybindDir = capture(python, ["-m", "pybind11", "--cmakedir"])
} catch (err) {
  console.error("Could not locate pybind11. Install it first: pip install pybind11")
  console.error(err.message)
  process.exit(1)
}
console.log(`pybind11 cmake dir: ${pybindDir}`)

const buildDir = "build"
run("cmake", [
  "-B",
  buildDir,
  "-DCMAKE_BUILD_TYPE=Release",
  "-DIPVGO_BUILD_PYTHON=ON",
  `-Dpybind11_DIR=${pybindDir}`,
  `-DPYTHON_EXECUTABLE=${capture(python, ["-c", "import sys;print(sys.executable)"])}`,
])
run("cmake", ["--build", buildDir, "--config", "Release", "--target", "pyipvgo"])

console.log("Built pyipvgo module into python/.")
