#pragma once

namespace ipvgo::nn {

// Action index convention: 0..N*N-1 are board points (x = a / N, y = a % N);
// action N*N is "pass".
inline int passAction(int N) { return N * N; }
inline int actionCount(int N) { return N * N + 1; }

}  // namespace ipvgo::nn
