#include "json_api.hpp"

#include "engine.hpp"

#include <nlohmann/json.hpp>

namespace ipvgo {

using json = nlohmann::json;

namespace {

Board parseBoard(const json& j) {
  Board board;
  for (const auto& col : j) {
    board.push_back(col.get<std::string>());
  }
  return board;
}

std::vector<Board> parseHistory(const json& j) {
  std::vector<Board> history;
  for (const auto& state : j) {
    history.push_back(parseBoard(state));
  }
  return history;
}

ValidMask parseValidMask(const json& j) {
  ValidMask mask;
  for (const auto& col : j) {
    std::vector<bool> row;
    for (const auto& cell : col) {
      row.push_back(cell.get<bool>());
    }
    mask.push_back(std::move(row));
  }
  return mask;
}

Color parseColor(const std::string& s) { return s == "O" ? Color::White : Color::Black; }

json moveToJson(const Move& move) {
  if (move.type == MoveType::Pass) {
    return json{{"type", "pass"}};
  }
  return json{{"type", "move"}, {"x", move.x}, {"y", move.y}};
}

} // namespace

std::string processMoveRequestJson(const std::string& requestJson) {
  const json req = json::parse(requestJson);

  const Board board = parseBoard(req.at("board"));
  const std::vector<Board> history = req.contains("history") ? parseHistory(req.at("history")) : std::vector<Board>{};
  const double komi = req.value("komi", 5.5);
  const int iterations = req.value("iterations", 4000);
  const int threads = req.value("threads", 0);
  const Color playAs = parseColor(req.value("playAs", "X"));

  const ValidMask* maskPtr = nullptr;
  ValidMask maskStorage;
  if (req.contains("validMoves") && !req.at("validMoves").is_null()) {
    maskStorage = parseValidMask(req.at("validMoves"));
    maskPtr = &maskStorage;
  }

  const MoveResult result = findBestMove(board, history, komi, playAs, iterations, maskPtr, threads);

  json out;
  out["move"] = moveToJson(result.move);
  out["iterations"] = result.iterations;
  out["elapsedMs"] = result.elapsedMs;
  return out.dump();
}

} // namespace ipvgo
