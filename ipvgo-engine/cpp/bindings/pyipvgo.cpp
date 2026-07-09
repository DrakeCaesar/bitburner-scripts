// pybind11 bindings exposing the faithful IPvGO engine (rules + faction AIs +
// feature encoding + environment step) to Python, so that MCTS, self-play and
// training can be written in PyTorch while the correctness-critical simulation
// stays in the validated C++ core.

#include <pybind11/numpy.h>
#include <pybind11/pybind11.h>
#include <pybind11/stl.h>

#include <cstdint>
#include <cstring>
#include <optional>
#include <random>
#include <string>
#include <vector>

#include "agent_env.hpp"
#include "cheats.hpp"
#include "environment.hpp"
#include "features.hpp"
#include "game_engine.hpp"
#include "go_game.hpp"
#include "opponents.hpp"
#include "puct_mcts.hpp"
#include "mcgs.hpp"
#include "rng.hpp"
#include "setup.hpp"

namespace py = pybind11;
using namespace ipvgo::game;
namespace nn = ipvgo::nn;

namespace {

GameState pyNewBoardState(int boardSize, Opponent ai, bool applyObstacles, double seedMs, uint64_t mathSeed) {
  MathRandom mr(mathSeed);
  return newBoardState(boardSize, ai, applyObstacles, seedMs, mr);
}

// Build a GameState directly from a board (list of column strings) plus history,
// used by the inference service to reconstruct the in-game position.
GameState pyStateFromBoard(const std::vector<std::string>& board, Opponent ai, const std::string& previousPlayer,
                           int passCount, const std::vector<std::string>& previousBoards,
                           std::optional<double> komiOverride) {
  GameState state;
  state.board = board;
  state.size = static_cast<int>(board.size());
  state.previousPlayer = parseColor(previousPlayer);
  state.gameOver = false;
  state.previousBoards = previousBoards;
  state.ai = ai;
  state.passCount = passCount;
  if (komiOverride.has_value()) {
    state.komiOverride = *komiOverride;
    state.hasKomiOverride = true;
  }
  return state;
}

py::array_t<float> pyEncodeState(const GameState& state, Color player) {
  const int N = state.size;
  const std::vector<float> planes = nn::encodeState(state, player);
  py::array_t<float> arr({static_cast<py::ssize_t>(nn::kNumPlanes), static_cast<py::ssize_t>(N),
                          static_cast<py::ssize_t>(N)});
  std::memcpy(arr.mutable_data(), planes.data(), planes.size() * sizeof(float));
  return arr;
}

py::array_t<int8_t> pyLegalActionMask(const GameState& state, Color player) {
  const std::vector<char> mask = nn::legalActionMask(state, player);
  py::array_t<int8_t> arr(static_cast<py::ssize_t>(mask.size()));
  std::memcpy(arr.mutable_data(), mask.data(), mask.size() * sizeof(int8_t));
  return arr;
}

py::tuple pyStepEnvironment(const GameState& state, int action, uint64_t seed) {
  std::mt19937_64 rng(seed);
  const nn::StepOutcome out = nn::stepEnvironment(state, action, rng);
  return py::make_tuple(out.next, out.terminal, out.blackValue);
}

Play pyGetMove(const GameState& state, Color player, Opponent ai, double whiteSeed, uint64_t mathSeed) {
  MathRandom mr(mathSeed);
  return getMove(state, player, ai, whiteSeed, mr);
}

// Run White's scripted (faction) reply on a White-to-move state and return
// (next_state, terminal, black_value). Useful after a Black cheat, where the
// normal step_environment (which applies a Black move first) does not apply.
py::tuple pyWhiteReply(const GameState& state, uint64_t seed) {
  std::mt19937_64 rng(seed);
  GameState next = state;
  nn::StepOutcome out;
  if (next.gameOver) {
    out.next = next;
    out.terminal = true;
    out.blackValue = nn::blackTerminalValue(next);
    return py::make_tuple(out.next, out.terminal, out.blackValue);
  }
  const double whiteSeed = static_cast<double>(rng() % 30000000u);
  MathRandom mr(rng());
  const Play wp = getMove(next, Color::White, next.ai, whiteSeed, mr);
  if (wp.type == PlayType::Move) {
    if (!makeMove(next, wp.x, wp.y, Color::White)) passTurn(next, Color::White);
  } else {
    passTurn(next, Color::White);
  }
  const bool terminal = next.gameOver;
  const float value = terminal ? nn::blackTerminalValue(next) : 0.0f;
  return py::make_tuple(next, terminal, value);
}

std::optional<Opponent> pyParseOpponent(const std::string& name) { return parseOpponent(name); }

py::tuple pyApplyCheat(const GameState& state, Color player, CheatType type,
                       const std::vector<std::pair<int, int>>& points, double successRng, double ejectRng,
                       double crimeSuccessMult, double sourceFileBonus) {
  GameState next = state;
  CheatParams params;
  params.crimeSuccessMult = crimeSuccessMult;
  params.sourceFileBonus = sourceFileBonus;
  const CheatResult result = applyCheat(next, player, type, points, successRng, ejectRng, params);
  return py::make_tuple(next, result, next.gameOver);
}

double pyCheatSuccessChance(int cheatCount, double crimeSuccessMult, double sourceFileBonus) {
  CheatParams params;
  params.crimeSuccessMult = crimeSuccessMult;
  params.sourceFileBonus = sourceFileBonus;
  return cheatSuccessChance(cheatCount, params);
}

py::tuple pyBeginPlayTwoMoves(const GameState& state, Color player, int x, int y, double successRng, double ejectRng,
                              double crimeSuccessMult, double sourceFileBonus) {
  GameState next = state;
  CheatParams params;
  params.crimeSuccessMult = crimeSuccessMult;
  params.sourceFileBonus = sourceFileBonus;
  const CheatResult result = beginPlayTwoMoves(next, player, x, y, successRng, ejectRng, params);
  return py::make_tuple(next, result, next.gameOver);
}

py::tuple pyRunPuctMcts(const GameState& gs, bool extraMove, bool cheatsEnabled, double crimeSuccessMult,
                         double sourceFileBonus, int simulations, float cPuct, float dirichletAlpha,
                         float dirichletEpsilon, bool addRootNoise, int leafBatchSize, uint64_t seed,
                         py::function evalFn) {
  nn::EnvState root;
  root.gs = gs;
  root.extraMove = extraMove;

  nn::CheatSettings settings;
  settings.enabled = cheatsEnabled;
  settings.crimeSuccessMult = crimeSuccessMult;
  settings.sourceFileBonus = sourceFileBonus;

  nn::PuctMctsConfig cfg;
  cfg.simulations = simulations;
  cfg.cPuct = cPuct;
  cfg.dirichletAlpha = dirichletAlpha;
  cfg.dirichletEpsilon = dirichletEpsilon;
  cfg.addRootNoise = addRootNoise;
  cfg.leafBatchSize = leafBatchSize;

  auto callback = [&](const float* planes, int batch, int n, int actionCount, float* policyOut, float* valueOut) {
    py::array_t<float> arr({batch, nn::kInputPlanes, n, n});
    std::memcpy(arr.mutable_data(), planes, static_cast<size_t>(batch) * nn::kInputPlanes * n * n * sizeof(float));
    py::object out = evalFn(arr);
    py::tuple tup = out.cast<py::tuple>();
    py::array_t<float, py::array::c_style | py::array::forcecast> policy = tup[0].cast<py::array_t<float>>();
    py::array_t<float, py::array::c_style | py::array::forcecast> value = tup[1].cast<py::array_t<float>>();
    std::memcpy(policyOut, policy.data(), static_cast<size_t>(batch) * actionCount * sizeof(float));
    const auto vbuf = value.request();
    const float* vptr = static_cast<const float*>(vbuf.ptr);
    for (int i = 0; i < batch; ++i) valueOut[i] = vptr[i];
  };

  const nn::PuctMctsResult result = nn::runPuctMcts(root, settings, cfg, seed, callback);

  py::array_t<float> visitPolicy(static_cast<py::ssize_t>(result.visitPolicy.size()));
  std::memcpy(visitPolicy.mutable_data(), result.visitPolicy.data(), result.visitPolicy.size() * sizeof(float));
  return py::make_tuple(visitPolicy, result.bestAction, result.rootValue);
}

py::tuple pyRunMcgs(const GameState& gs, int playouts, double exploration, bool useAiTweaks,
                    bool suppressTransposition, uint64_t seed) {
  nn::McgsConfig cfg;
  cfg.playouts = playouts;
  cfg.exploration = exploration;
  cfg.useAiTweaks = useAiTweaks;
  cfg.suppressTransposition = suppressTransposition;

  const nn::McgsResult result = nn::runMcgs(gs, cfg, seed);

  py::array_t<float> visitPolicy(static_cast<py::ssize_t>(result.visitPolicy.size()));
  std::memcpy(visitPolicy.mutable_data(), result.visitPolicy.data(), result.visitPolicy.size() * sizeof(float));
  return py::make_tuple(visitPolicy, result.bestAction, result.rootValue);
}

}  // namespace

PYBIND11_MODULE(pyipvgo, m) {
  m.doc() = "Faithful Bitburner IPvGO engine (rules, faction AIs, features, environment).";

  py::enum_<Color>(m, "Color")
      .value("Empty", Color::Empty)
      .value("Black", Color::Black)
      .value("White", Color::White)
      .value("Offline", Color::Offline);

  py::enum_<Opponent>(m, "Opponent")
      .value("None_", Opponent::None)
      .value("Netburners", Opponent::Netburners)
      .value("SlumSnakes", Opponent::SlumSnakes)
      .value("TheBlackHand", Opponent::TheBlackHand)
      .value("Tetrads", Opponent::Tetrads)
      .value("Daedalus", Opponent::Daedalus)
      .value("Illuminati", Opponent::Illuminati)
      .value("WorldDaemon", Opponent::WorldDaemon);

  py::enum_<PlayType>(m, "PlayType")
      .value("Move", PlayType::Move)
      .value("Pass", PlayType::Pass)
      .value("GameOver", PlayType::GameOver);

  py::enum_<Validity>(m, "Validity")
      .value("PointBroken", Validity::PointBroken)
      .value("PointNotEmpty", Validity::PointNotEmpty)
      .value("BoardRepeated", Validity::BoardRepeated)
      .value("NoSuicide", Validity::NoSuicide)
      .value("NotYourTurn", Validity::NotYourTurn)
      .value("GameOver", Validity::GameOver)
      .value("Invalid", Validity::Invalid)
      .value("Valid", Validity::Valid);

  py::enum_<CheatType>(m, "CheatType")
      .value("RemoveRouter", CheatType::RemoveRouter)
      .value("PlayTwoMoves", CheatType::PlayTwoMoves)
      .value("RepairOfflineNode", CheatType::RepairOfflineNode)
      .value("DestroyNode", CheatType::DestroyNode);

  py::enum_<CheatResult>(m, "CheatResult")
      .value("Success", CheatResult::Success)
      .value("TurnSkipped", CheatResult::TurnSkipped)
      .value("Ejected", CheatResult::Ejected)
      .value("InvalidTarget", CheatResult::InvalidTarget);

  py::class_<Play>(m, "Play")
      .def_readonly("type", &Play::type)
      .def_readonly("x", &Play::x)
      .def_readonly("y", &Play::y)
      .def("__repr__", [](const Play& p) {
        return "<Play type=" + std::to_string(static_cast<int>(p.type)) + " x=" + std::to_string(p.x) +
               " y=" + std::to_string(p.y) + ">";
      });

  py::class_<Score>(m, "Score")
      .def_readonly("white_pieces", &Score::whitePieces)
      .def_readonly("white_territory", &Score::whiteTerritory)
      .def_readonly("komi", &Score::komi)
      .def_readonly("white_sum", &Score::whiteSum)
      .def_readonly("black_pieces", &Score::blackPieces)
      .def_readonly("black_territory", &Score::blackTerritory)
      .def_readonly("black_sum", &Score::blackSum);

  py::class_<GameState>(m, "GameState")
      .def_readonly("size", &GameState::size)
      .def_readonly("game_over", &GameState::gameOver)
      .def_readonly("pass_count", &GameState::passCount)
      .def_readonly("cheat_count", &GameState::cheatCount)
      .def_readonly("ai", &GameState::ai)
      .def_property_readonly("board", [](const GameState& s) { return s.board; })
      .def_property_readonly("previous_boards", [](const GameState& s) { return s.previousBoards; })
      .def_property_readonly("previous_player", [](const GameState& s) { return s.previousPlayer; })
      .def("clone", [](const GameState& s) { return s; })
      .def("whose_turn", [](const GameState& s) { return whoseTurn(s); });

  m.attr("NUM_PLANES") = nn::kNumPlanes;
  m.attr("NUM_INPUT_PLANES") = nn::kInputPlanes;
  m.def("extended_action_count", &nn::extendedActionCount);
  m.def("action_count", &nn::actionCount);
  m.def("pass_action", &nn::passAction);

  m.def("new_board_state", &pyNewBoardState, py::arg("board_size"), py::arg("ai"), py::arg("apply_obstacles") = true,
        py::arg("seed_ms") = 0.0, py::arg("math_seed") = 0);
  m.def("state_from_board", &pyStateFromBoard, py::arg("board"), py::arg("ai"), py::arg("previous_player") = "O",
        py::arg("pass_count") = 0, py::arg("previous_boards") = std::vector<std::string>{},
        py::arg("komi_override") = std::nullopt);

  m.def("encode_state", &pyEncodeState, py::arg("state"), py::arg("player") = Color::Black);
  m.def("legal_action_mask", &pyLegalActionMask, py::arg("state"), py::arg("player") = Color::Black);
  m.def("step_environment", &pyStepEnvironment, py::arg("state"), py::arg("action"), py::arg("seed"));
  m.def("get_move", &pyGetMove, py::arg("state"), py::arg("player"), py::arg("ai"), py::arg("white_seed"),
        py::arg("math_seed"));
  m.def("white_reply", &pyWhiteReply, py::arg("state"), py::arg("seed"));

  m.def("get_score", &getScore, py::arg("state"));
  m.def("black_wins", &blackWins, py::arg("score"));
  m.def("black_terminal_value", &nn::blackTerminalValue, py::arg("state"));
  m.def("get_all_valid_moves", &getAllValidMoves, py::arg("state"), py::arg("player"));
  m.def("get_komi", &getKomi, py::arg("state"));

  m.def("cheat_success_chance", &pyCheatSuccessChance, py::arg("cheat_count"), py::arg("crime_success_mult") = 1.0,
        py::arg("source_file_bonus") = 0.0);
  m.def("apply_cheat", &pyApplyCheat, py::arg("state"), py::arg("player"), py::arg("type"), py::arg("points"),
        py::arg("success_rng"), py::arg("eject_rng"), py::arg("crime_success_mult") = 1.0,
        py::arg("source_file_bonus") = 0.0);
  m.def("begin_play_two_moves", &pyBeginPlayTwoMoves, py::arg("state"), py::arg("player"), py::arg("x"), py::arg("y"),
        py::arg("success_rng"), py::arg("eject_rng"), py::arg("crime_success_mult") = 1.0,
        py::arg("source_file_bonus") = 0.0);

  m.def("run_puct_mcts", &pyRunPuctMcts, py::arg("state"), py::arg("extra_move") = false,
        py::arg("cheats_enabled") = true, py::arg("crime_success_mult") = 1.0, py::arg("source_file_bonus") = 0.0,
        py::arg("simulations") = 128, py::arg("c_puct") = 1.5f, py::arg("dirichlet_alpha") = 0.3f,
        py::arg("dirichlet_epsilon") = 0.25f, py::arg("add_root_noise") = true, py::arg("leaf_batch_size") = 32,
        py::arg("seed") = 0, py::arg("eval_fn"));

  m.def("run_mcgs", &pyRunMcgs, py::arg("state"), py::arg("playouts") = 10000, py::arg("exploration") = 0.3,
        py::arg("use_ai_tweaks") = true, py::arg("suppress_transposition") = true, py::arg("seed") = 0);

  m.def("parse_opponent", &pyParseOpponent, py::arg("name"));
  m.def("opponent_name", &opponentName, py::arg("ai"));
  m.def("parse_color", &parseColor, py::arg("s"));
}
