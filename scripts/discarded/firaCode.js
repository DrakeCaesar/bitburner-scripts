/** @param {import("../..").NS } ns
 * Replace progress bars. */
export async function main(ns) {
    for (;;) {
        waitForElm(".MuiList-root.MuiList-padding.MuiList-dense").then(
            (elm) => {
                var targetList = document.querySelectorAll(
                    "ul > div > .MuiListItemButton-root p"
                )

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

                    var config = { characterData: true }
                    observer.observe(target, config)
                }
            }
        )
        await ns.sleep(1000)
    }
}

export function waitForElm(selector) {
    return new Promise((resolve) => {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector))
        }

        const observer = new MutationObserver((mutations) => {
            if (document.querySelector(selector)) {
                resolve(document.querySelector(selector))
                observer.disconnect()
            }
        })

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        })
    })
}
