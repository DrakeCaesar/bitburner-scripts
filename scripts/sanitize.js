let data = [
    [1, 3],
    [8, 10],
    [2, 6],
    [10, 16],
]

data.sort(function (first, second) {
    return first[1] - second[1] ||first[0] - second[0]
})

let length = data.length - 1
for (let i = 0; i < length; i++) {
    if (data[i][1] >= data[i + 1][0]) {
        data[i][1] = data[i + 1][1]
        data.splice(i + 1, i + 1)
        length--
    }
}
