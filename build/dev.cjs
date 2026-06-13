const path = require("node:path")
const { applyViteburnerHmrPatch } = require("./viteburner-hmr-patch.cjs")

applyViteburnerHmrPatch()

require(path.join(path.dirname(require.resolve("viteburner")), "entry.js"))
