/** @param {import("..").NS } ns */
/*
    ((aa))(a()())))(()

    remove the minimum number of invalid parentheses in order to validate the string. If there are multiple minimal ways to validate the string, provide all of the possible results. The answer should be provided as an array of strings. If it is impossible to validate the string the result should be an array with only an empty string.

    IMPORTANT: The string may contain letters, not just parentheses. Examples:
    "()())()" -> [()()(), (())()]
    "(a)())()" -> [(a)()(), (a())()]
    ")(" -> [""]
    */
let data = "())"
let answer = sanitize(data)
console.log("data:   " + data)
console.log("answer: " + answer)

/** @param {import("..").NS } ns */
function isSanitized(string) {
    let depth = 0
    let test = "0 "
    let big = ""
    let valid = true
    for (let k = 0; k < string.length; k++) {
        if (string[k] == "(") {
            ++depth
        } else if (string[k] == ")") {
            --depth
        }
        if (depth < 0) valid = false
        test += " " + String(depth).padStart(2).padEnd(3)
        big += "  " + string[k] + " "
    }
    console.log(big)
    console.log(big)

    console.log(big)
    console.log(test)
    console.log(depth == 0 && valid)
    console.log("")

    return depth == 0 && valid
}

/** @param {import("..").NS } ns */
function sanitize(string) {
    if (isSanitized(string)) {
        return string
    }
    let answer = []
    let list = [[]]
    list[0].push(string)
    for (let i = 0; i < string.lenght || answer.length == 0; i++) {
        list.push([])
        for (let word of list[i]) {
            for (let j = 0; j < word.lenght; j++) {
                if (word[j] == ")" || word[j] == "(") {
                    let temp = word.slice(0, j) + word.slice(j + 1)
                    if (isSanitized(temp)) {
                        answer.push(temp)
                    }
                    list[i + 1].push(temp)
                }
            }
        }
    }
    return answer
}
