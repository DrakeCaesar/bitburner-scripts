#pragma once

#include "types.hpp"

namespace ipvgo {

Move findTacticalMove(const Board& board, const ValidMask& validMask, Color color = Color::Black);

MoveResult findBestMove(
    const Board& board,
    const std::vector<Board>& history,
    double komi,
    Color playAs,
    int iterations,
    const ValidMask* validMask = nullptr);

} // namespace ipvgo
