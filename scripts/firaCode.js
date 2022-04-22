/** @param {import("..").NS } ns
 * Replace progress bars. */
export async function main(ns) {
    /*
    
    \uee04\uee02
    
    */
    //
    //ns.tprint("\uee00\uee01\uee02\uee03\uee04\uee05")

    // Select the target node.

    for (;;) {
        var targetList = document.querySelectorAll(
            "ul > div > .MuiListItemButton-root p"
        )

        if (targetList.length == 0) {
            await ns.sleep(1000)
            continue
        }

        for (let target of targetList) {
            target.innerHTML = target.innerHTML
                .replaceAll("[|", "")
                .replaceAll("[-", "")
                .replaceAll("|]", "")
                .replaceAll("-]", "")
                .replaceAll("-", "")
                .replaceAll("|", "")
            var observer = new MutationObserver(function (mutations) {
                mutations.forEach(function () {
                    target.innerHTML = target.innerHTML
                        .replaceAll("[|", "")
                        .replaceAll("[-", "")
                        .replaceAll("|]", "")
                        .replaceAll("-]", "")
                        .replaceAll("-", "")
                        .replaceAll("|", "")
                })
            })

            var config = { characterData: true, subtree: true }
            observer.observe(target, config)
        }

        await ns.sleep(1000000)
    }
}
