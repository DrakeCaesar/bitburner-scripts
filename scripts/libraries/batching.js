let hack_time = 5000
let grow_time = 3.2 * hack_time
let weak_time = 4 * hack_time
let t0 = 250

let period, depth
const kW_max = Math.floor(1 + (weak_time - 4 * t0) / (8 * t0))
//const kW_max = Math . min ( Math . floor (1 + ( weak_time - 4 * t0) / (8 * t0 )), max_depth );
schedule: for (let kW = kW_max; kW >= 1; --kW) {
    const t_min_W = (weak_time + 4 * t0) / kW
    const t_max_W = (weak_time - 4 * t0) / (kW - 1)
    const kG_min = Math.ceil(Math.max((kW - 1) * 0.8, 1))
    const kG_max = Math.floor(1 + kW * 0.8)
    for (let kG = kG_max; kG >= kG_min; --kG) {
        const t_min_G = (grow_time + 3 * t0) / kG
        const t_max_G = (grow_time - 3 * t0) / (kG - 1)
        const kH_min = Math.ceil(
            Math.max((kW - 1) * 0.25, (kG - 1) * 0.3125, 1)
        )
        const kH_max = Math.floor(Math.min(1 + kW * 0.25, 1 + kG * 0.3125))
        for (let kH = kH_max; kH >= kH_min; --kH) {
            const t_min_H = (hack_time + 5 * t0) / kH
            //const t_min_H = (hack_time_max + 5 * t0) / kH
            const t_max_H = (hack_time - 1 * t0) / (kH - 1)
            //const t_max_H = (hack_time_min - 1 * t0) / (kH - 1)
            const t_min = Math.max(t_min_H, t_min_G, t_min_W)
            const t_max = Math.min(t_max_H, t_max_G, t_max_W)
            if (t_min <= t_max) {
                period = t_min
                depth = kW
                break schedule
            }
        }
    }
}

const hack_delay = depth * period - 4 * t0 - hack_time
const weak_delay_1 = depth * period - 3 * t0 - weak_time
const grow_delay = depth * period - 2 * t0 - grow_time
const weak_delay_2 = depth * period - 1 * t0 - weak_time

console.log("th: " + tFormat(hack_time))
console.log("tg: " + tFormat(grow_time))
console.log("tw: " + tFormat(weak_time))
console.log("t0: " + tFormat(t0))
console.log("")

console.log("T:  " + tFormat(period))
console.log("k:  " + String(depth).padStart(6))
console.log("dh: " + tFormat(hack_delay))
console.log("dw1:" + tFormat(weak_delay_1))
console.log("dg: " + tFormat(grow_delay))
console.log("dw2:" + tFormat(weak_delay_2))
console.log("")

function tFormat(duration) {
    return (duration / 1000).toFixed(3).padStart(10) + " s"
}



