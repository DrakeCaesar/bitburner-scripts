#pragma once

#include "types.hpp"

namespace ipvgo {

MoveResult findBestMoveMcts(
    const Board& board,
    const std::vector<Board>& history,
    double komi,
    Color playAs,
    int iterations,
    const ValidMask* validMask = nullptr);

} // namespace ipvgo
