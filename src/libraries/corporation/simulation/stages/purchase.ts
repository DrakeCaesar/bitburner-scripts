import type { DivisionSnapshot, SimContext, WarehouseSnapshot } from "../types.js"
import { recomputeWarehouseSizeUsed } from "../snapshot.js"

/** PURCHASE: buy materials from market (non–Smart Supply). */
export function simulatePurchaseStage(division: DivisionSnapshot, warehouse: WarehouseSnapshot, ctx: SimContext): void {
  const { secondsPerMarketCycle: spc, marketCycles: mc } = ctx

  for (const mat of Object.values(warehouse.materials)) {
    if (!mat) continue
    const reqQty = division.requiredMaterials[mat.name]
    if (warehouse.smartSupplyEnabled && reqQty != null) {
      continue
    }

    let buyAmt = mat.buyAmount * spc * mc
    const maxAmt = Math.floor((warehouse.size - warehouse.sizeUsed) / mat.size)
    buyAmt = Math.min(buyAmt, maxAmt)

    if (buyAmt > 0) {
      mat.quality = Math.max(0.1, (mat.quality * mat.stored + buyAmt) / (mat.stored + buyAmt))
      mat.averagePrice = (mat.stored * mat.averagePrice + buyAmt * mat.marketPrice) / (mat.stored + buyAmt)
      mat.stored += buyAmt
    }
  }

  recomputeWarehouseSizeUsed(warehouse)
}
