#include "opponents.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <optional>
#include <unordered_set>

#include "analysis.hpp"
#include "patterns.hpp"

namespace ipvgo::game {

namespace {

struct AiMove {
  bool valid = false;
  int x = -1;
  int y = -1;
  int oldLibertyCount = 0;
  int newLibertyCount = 0;
  bool createsLife = false;
};

struct GrowthCandidate {
  int x, y;
  int oldLibertyCount;
  int newLibertyCount;
};

int floorIndex(double rng, size_t size) { return static_cast<int>(std::floor(rng * static_cast<double>(size))); }

// ---- Liberty growth / defend ----------------------------------------------

std::vector<GrowthCandidate> getLibertyGrowthMoves(const SimpleBoard& board, Color player,
                                                   const std::unordered_set<int>& availableSet) {
  const ChainSet cs = computeChains(board);
  const int N = cs.N;
  const char me = colorChar(player);

  std::vector<GrowthCandidate> result;
  bool anyFriendly = false;
  for (int c = 0; c < cs.count; ++c) {
    if (cs.chainColor[c] != me) continue;
    anyFriendly = true;
    for (const int lib : cs.liberties[c]) {
      if (!availableSet.count(lib)) continue;
      const int lx = lib / N;
      const int ly = lib % N;
      const int newLib = static_cast<int>(findEffectiveLibertiesOfNewMove(board, lx, ly, player).size());
      const int oldLib = findMinLibertyCountOfAdjacentChains(board, lx, ly, player);
      if (newLib > 1 && newLib >= oldLib) result.push_back({lx, ly, oldLib, newLib});
    }
  }
  if (!anyFriendly) return {};
  return result;
}

AiMove getGrowthMove(const std::vector<GrowthCandidate>& growthMoves, double rng) {
  if (growthMoves.empty()) return {};
  int maxDelta = growthMoves[0].newLibertyCount - growthMoves[0].oldLibertyCount;
  for (const auto& m : growthMoves) maxDelta = std::max(maxDelta, m.newLibertyCount - m.oldLibertyCount);

  std::vector<GrowthCandidate> candidates;
  for (const auto& m : growthMoves)
    if (m.newLibertyCount - m.oldLibertyCount == maxDelta) candidates.push_back(m);

  const int idx = floorIndex(rng, candidates.size());
  if (idx < 0 || idx >= static_cast<int>(candidates.size())) return {};
  AiMove mv;
  mv.valid = true;
  mv.x = candidates[idx].x;
  mv.y = candidates[idx].y;
  mv.oldLibertyCount = candidates[idx].oldLibertyCount;
  mv.newLibertyCount = candidates[idx].newLibertyCount;
  return mv;
}

AiMove getDefendMove(const SimpleBoard& board, Color player, const std::unordered_set<int>& availableSet,
                     MathRandom& mathRng) {
  const std::vector<GrowthCandidate> growthMoves = getLibertyGrowthMoves(board, player, availableSet);
  std::vector<GrowthCandidate> increases;
  for (const auto& m : growthMoves)
    if (m.oldLibertyCount <= 1 && m.newLibertyCount > m.oldLibertyCount) increases.push_back(m);

  if (increases.empty()) return {};
  int maxDelta = increases[0].newLibertyCount - increases[0].oldLibertyCount;
  for (const auto& m : increases) maxDelta = std::max(maxDelta, m.newLibertyCount - m.oldLibertyCount);
  if (maxDelta < 1) return {};

  std::vector<GrowthCandidate> candidates;
  for (const auto& m : increases)
    if (m.newLibertyCount - m.oldLibertyCount == maxDelta) candidates.push_back(m);

  const int idx = floorIndex(mathRng.random(), candidates.size());
  AiMove mv;
  mv.valid = true;
  mv.x = candidates[idx].x;
  mv.y = candidates[idx].y;
  mv.oldLibertyCount = candidates[idx].oldLibertyCount;
  mv.newLibertyCount = candidates[idx].newLibertyCount;
  return mv;
}

// ---- Surround / capture ----------------------------------------------------

AiMove getSurroundMove(const SimpleBoard& board, Color player, const std::unordered_set<int>& availableSet, bool smart) {
  const Color opposing = oppositeColor(player);
  const ChainSet cs = computeChains(board);
  const int N = cs.N;
  const char oppChar = colorChar(opposing);

  bool anyEnemy = false;
  for (int c = 0; c < cs.count; ++c)
    if (cs.chainColor[c] == oppChar) anyEnemy = true;
  if (!anyEnemy || availableSet.empty()) return {};

  // enemyChains[*].liberties flattened (with duplicates), filtered to available.
  std::vector<int> enemyLiberties;
  for (int c = 0; c < cs.count; ++c) {
    if (cs.chainColor[c] != oppChar) continue;
    for (const int lib : cs.liberties[c])
      if (availableSet.count(lib)) enemyLiberties.push_back(lib);
  }

  std::vector<AiMove> captureMoves;
  std::vector<AiMove> atariMoves;
  std::vector<AiMove> surroundMoves;

  for (const int move : enemyLiberties) {
    const int mx = move / N;
    const int my = move % N;
    const int newLibertyCount = static_cast<int>(findEffectiveLibertiesOfNewMove(board, mx, my, player).size());

    const WeakestChain weakest = findEnemyNeighborChainWithFewestLiberties(board, mx, my, opposing);
    const int weakestLength = weakest.found ? weakest.length : 99;
    const int enemyChainLibertyCount = weakest.found ? static_cast<int>(weakest.liberties.size()) : 99;

    std::unordered_set<int> libertyGroups;
    if (weakest.found)
      for (const int lib : weakest.liberties) libertyGroups.insert(cs.id[lib]);

    if (newLibertyCount <= 2 && enemyChainLibertyCount > 2) continue;

    AiMove mv;
    mv.valid = true;
    mv.x = mx;
    mv.y = my;
    mv.oldLibertyCount = enemyChainLibertyCount;
    mv.newLibertyCount = enemyChainLibertyCount - 1;

    if (enemyChainLibertyCount <= 1) {
      captureMoves.push_back(mv);
    } else if (enemyChainLibertyCount == 2 &&
               (newLibertyCount >= 2 || (static_cast<int>(libertyGroups.size()) == 1 && weakestLength > 3) || !smart)) {
      atariMoves.push_back(mv);
    } else if (newLibertyCount >= 2) {
      surroundMoves.push_back(mv);
    }
  }

  if (!captureMoves.empty()) return captureMoves[0];
  if (!atariMoves.empty()) return atariMoves[0];
  if (!surroundMoves.empty()) return surroundMoves[0];
  return {};
}

// ---- Eyes ------------------------------------------------------------------

// Count "living groups" (chains with >=2 eyes) and "eye count" (chains with any
// eye) for `player` on the given board.
void eyeCounts(const SimpleBoard& board, Color player, int& livingGroups, int& eyeCount) {
  const EyeMap em = getAllEyesByChainId(board, player);
  livingGroups = 0;
  eyeCount = 0;
  for (const auto& [chainIdx, emptyChains] : em.eyes) {
    (void)chainIdx;
    if (!emptyChains.empty()) eyeCount++;
    if (emptyChains.size() >= 2) livingGroups++;
  }
}

std::vector<AiMove> getEyeCreationMoves(const SimpleBoard& board, Color player,
                                        const std::unordered_set<int>& availableSet, int maxLiberties) {
  const EyeMap allEyes = getAllEyesByChainId(board, player);
  const ChainSet& cs = allEyes.cs;
  const int N = cs.N;
  const char me = colorChar(player);

  std::unordered_set<int> livingGroupChains;
  int currentLivingGroups = 0;
  int currentEyeCount = 0;
  for (const auto& [chainIdx, emptyChains] : allEyes.eyes) {
    if (!emptyChains.empty()) currentEyeCount++;
    if (emptyChains.size() >= 2) {
      currentLivingGroups++;
      livingGroupChains.insert(chainIdx);
    }
  }

  // friendly liberties of chains (length>1, liberties<=maxLiberties, not already living)
  std::vector<int> friendlyLiberties;  // flat idxs (with duplicates), preserving order
  for (int c = 0; c < cs.count; ++c) {
    if (cs.chainColor[c] != me) continue;
    if (cs.members[c].size() <= 1) continue;
    if (static_cast<int>(cs.liberties[c].size()) > maxLiberties) continue;
    if (livingGroupChains.count(c)) continue;
    for (const int lib : cs.liberties[c]) {
      if (!availableSet.count(lib)) continue;
      const int px = lib / N;
      const int py = lib % N;
      // >=2 neighbors that are friendly-or-wall, and at least one empty neighbor.
      int friendlyOrWall = 0;
      bool anyEmpty = false;
      for (const auto& [dx, dy] : {std::pair<int, int>{0, 1}, {1, 0}, {0, -1}, {-1, 0}}) {
        const int nx = px + dx;
        const int ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) {
          friendlyOrWall++;  // off-board counts as wall (!p)
          continue;
        }
        const char nc = board[nx][ny];
        if (nc == '#') friendlyOrWall++;  // offline counts as wall (!p)
        else if (nc == me) friendlyOrWall++;
        if (nc == '.') anyEmpty = true;
      }
      if (friendlyOrWall >= 2 && anyEmpty) friendlyLiberties.push_back(lib);
    }
  }

  std::vector<AiMove> moves;
  for (const int lib : friendlyLiberties) {
    const int px = lib / N;
    const int py = lib % N;
    const SimpleBoard eval = evaluateMoveResult(board, px, py, player);
    int newLiving = 0;
    int newEyeCount = 0;
    eyeCounts(eval, player, newLiving, newEyeCount);
    if (newLiving > currentLivingGroups || (newEyeCount > currentEyeCount && newLiving == currentLivingGroups)) {
      AiMove mv;
      mv.valid = true;
      mv.x = px;
      mv.y = py;
      mv.createsLife = newLiving > currentLivingGroups;
      moves.push_back(mv);
    }
  }

  std::stable_sort(moves.begin(), moves.end(),
                   [](const AiMove& a, const AiMove& b) { return (b.createsLife ? 1 : 0) - (a.createsLife ? 1 : 0) < 0; });
  return moves;
}

AiMove getEyeCreationMove(const SimpleBoard& board, Color player, const std::unordered_set<int>& availableSet) {
  const std::vector<AiMove> moves = getEyeCreationMoves(board, player, availableSet, 99);
  return moves.empty() ? AiMove{} : moves[0];
}

AiMove getEyeBlockingMove(const SimpleBoard& board, Color player, const std::unordered_set<int>& availableSet) {
  const Color opposing = oppositeColor(player);
  const std::vector<AiMove> opponentEyeMoves = getEyeCreationMoves(board, opposing, availableSet, 5);
  std::vector<AiMove> twoEye;
  std::vector<AiMove> oneEye;
  for (const auto& m : opponentEyeMoves) {
    if (m.createsLife) twoEye.push_back(m);
    else oneEye.push_back(m);
  }
  if (twoEye.size() == 1) return twoEye[0];
  if (twoEye.empty() && oneEye.size() == 1) return oneEye[0];
  return {};
}

// ---- Corner ----------------------------------------------------------------

bool isCornerAvailableForMove(const SimpleBoard& board, int x1, int y1, int x2, int y2) {
  const int N = static_cast<int>(board.size());
  int found = 0;
  int pieces = 0;
  for (int x = 0; x < N; ++x) {
    for (int y = 0; y < N; ++y) {
      if (board[x][y] == '#') continue;
      if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
        found++;
        if (board[x][y] != '.') pieces++;
      }
    }
  }
  return found >= 7 ? pieces == 0 : false;
}

AiMove getCornerMove(const SimpleBoard& board) {
  const int N = static_cast<int>(board.size());
  const int boardEdge = N - 1;
  const int cornerMax = boardEdge - 2;
  auto make = [&](int x, int y) {
    AiMove mv;
    if (board[x][y] != '#') {
      mv.valid = true;
      mv.x = x;
      mv.y = y;
    }
    return mv;
  };
  if (isCornerAvailableForMove(board, cornerMax, cornerMax, boardEdge, boardEdge)) return make(cornerMax, cornerMax);
  if (isCornerAvailableForMove(board, 0, cornerMax, 2, boardEdge)) return make(2, cornerMax);
  if (isCornerAvailableForMove(board, 0, 0, 2, 2)) return make(2, 2);
  if (isCornerAvailableForMove(board, cornerMax, 0, boardEdge, 2)) return make(cornerMax, 2);
  return {};
}

// ---- Expansion / jump ------------------------------------------------------

AiMove pickFromPoints(const std::vector<Pt>& points, double rng) {
  if (points.empty()) return {};
  const int idx = floorIndex(rng, points.size());
  if (idx < 0 || idx >= static_cast<int>(points.size())) return {};
  AiMove mv;
  mv.valid = true;
  mv.x = points[idx].first;
  mv.y = points[idx].second;
  return mv;
}

AiMove getJumpMove(const SimpleBoard& board, Color player, const std::vector<Pt>& expansionMoves, double rng) {
  const int N = static_cast<int>(board.size());
  const char me = colorChar(player);
  std::vector<Pt> options;
  for (const auto& [x, y] : expansionMoves) {
    const bool nearFriend =
        (y + 2 < N && board[x][y + 2] == me) || (x + 2 < N && board[x + 2][y] == me) ||
        (y - 2 >= 0 && board[x][y - 2] == me) || (x - 2 >= 0 && board[x - 2][y] == me);
    if (nearFriend) options.emplace_back(x, y);
  }
  return pickFromPoints(options, rng);
}

// ---- Pattern ---------------------------------------------------------------

AiMove getPatternMove(const SimpleBoard& board, Color player, const std::unordered_set<int>& availableSet, bool smart,
                      double rng) {
  const int N = static_cast<int>(board.size());
  std::vector<Pt> moves;
  for (int x = 0; x < N; ++x) {
    for (int y = 0; y < N; ++y) {
      if (!matchesAnyPattern(board, x, y, player)) continue;
      if (!availableSet.count(flatIndex(N, x, y))) continue;
      if (smart && findEffectiveLibertiesOfNewMove(board, x, y, player).size() <= 1) continue;
      moves.emplace_back(x, y);
    }
  }
  return pickFromPoints(moves, rng);
}

// ---- Move option provider (with caching) -----------------------------------

class MoveGen {
 public:
  MoveGen(const GameState& state, Color player, double rng, bool smart, MathRandom& mathRng)
      : state_(state), board_(state.board), player_(player), rng_(rng), smart_(smart), mathRng_(mathRng) {
    availableSpaces_ = findDisputedTerritory(state, player, smart);
    for (const auto& [x, y] : availableSpaces_) availableSet_.insert(flatIndex(state.size, x, y));
    contestedPoints_ = getDisputedTerritoryMoves(board_, availableSpaces_);
    expansionMoves_ = getExpansionMoveArray(board_, availableSpaces_);
    endGameAvailable_ = contestedPoints_.empty() && state.passCount > 0;
  }

  AiMove surround() { return cached(kSurround, [&] { return getSurroundMove(board_, player_, availableSet_, smart_); }); }

  AiMove capture() {
    const AiMove s = surround();
    return (s.valid && s.newLibertyCount == 0) ? s : AiMove{};
  }

  AiMove defend() { return cached(kDefend, [&] { return getDefendMove(board_, player_, availableSet_, mathRng_); }); }

  AiMove defendCapture() {
    const AiMove d = defend();
    return (d.valid && d.oldLibertyCount == 1 && d.newLibertyCount > 1) ? d : AiMove{};
  }

  AiMove eyeMove() {
    return cached(kEyeMove, [&] {
      return endGameAvailable_ ? AiMove{} : getEyeCreationMove(board_, player_, availableSet_);
    });
  }

  AiMove eyeBlock() {
    return cached(kEyeBlock, [&] {
      return endGameAvailable_ ? AiMove{} : getEyeBlockingMove(board_, player_, availableSet_);
    });
  }

  AiMove pattern() {
    return cached(kPattern, [&] {
      return endGameAvailable_ ? AiMove{} : getPatternMove(board_, player_, availableSet_, smart_, rng_);
    });
  }

  AiMove growth() {
    return cached(kGrowth, [&] {
      if (endGameAvailable_) return AiMove{};
      return getGrowthMove(getLibertyGrowthMoves(board_, player_, availableSet_), rng_);
    });
  }

  AiMove expansion() { return cached(kExpansion, [&] { return pickFromPoints(expansionMoves_, rng_); }); }

  AiMove jump() { return cached(kJump, [&] { return getJumpMove(board_, player_, expansionMoves_, rng_); }); }

  AiMove corner() { return cached(kCorner, [&] { return getCornerMove(board_); }); }

  AiMove random() {
    return cached(kRandom, [&] {
      if (contestedPoints_.empty()) return AiMove{};
      return pickFromPoints(availableSpaces_, rng_);
    });
  }

 private:
  enum Kind { kSurround, kDefend, kEyeMove, kEyeBlock, kPattern, kGrowth, kExpansion, kJump, kCorner, kRandom, kCount };

  template <typename F>
  AiMove cached(Kind k, F&& compute) {
    if (!computed_[k]) {
      cache_[k] = compute();
      computed_[k] = true;
    }
    return cache_[k];
  }

  const GameState& state_;
  const SimpleBoard& board_;
  Color player_;
  double rng_;
  bool smart_;
  MathRandom& mathRng_;

  std::vector<Pt> availableSpaces_;
  std::unordered_set<int> availableSet_;
  std::vector<Pt> contestedPoints_;
  std::vector<Pt> expansionMoves_;
  bool endGameAvailable_ = false;

  std::array<AiMove, kCount> cache_{};
  std::array<bool, kCount> computed_{};

  public:
  const std::vector<Pt>& availableSpaces() const { return availableSpaces_; }
};

std::vector<Pt> enumerateFactionMovesImpl(const GameState& state, Color player, Opponent opponent,
                                          MathRandom& mathRng) {
  WHRNG rng(0.0);
  const bool smart = isSmart(opponent, rng.random());
  MoveGen gen(state, player, 0.0, smart, mathRng);

  std::unordered_set<int> seen;
  std::vector<Pt> out;
  const int N = state.size;

  auto addValid = [&](int x, int y) {
    if (evaluateIfMoveIsValid(state, x, y, player) != Validity::Valid) return;
    const int idx = flatIndex(N, x, y);
    if (seen.count(idx)) return;
    seen.insert(idx);
    out.emplace_back(x, y);
  };

  auto addAi = [&](const AiMove& m) {
    if (m.valid) addValid(m.x, m.y);
  };

  addAi(gen.surround());
  addAi(gen.defend());
  addAi(gen.eyeMove());
  addAi(gen.eyeBlock());
  addAi(gen.pattern());
  addAi(gen.growth());
  addAi(gen.expansion());
  addAi(gen.jump());
  addAi(gen.corner());

  for (const auto& [x, y] : gen.availableSpaces()) addValid(x, y);

  return out;
}

// ---- Faction priority tables ----------------------------------------------

std::optional<Pt> asPt(const AiMove& m) {
  if (!m.valid) return std::nullopt;
  return Pt{m.x, m.y};
}

std::optional<Pt> illuminatiMove(MoveGen& moves, double rng) {
  if (auto m = moves.capture(); m.valid) return asPt(m);
  if (auto m = moves.defendCapture(); m.valid) return asPt(m);
  if (auto m = moves.eyeMove(); m.valid) return asPt(m);

  const AiMove surround = moves.surround();
  if (surround.valid && surround.newLibertyCount <= 1) return Pt{surround.x, surround.y};

  if (auto m = moves.eyeBlock(); m.valid) return asPt(m);
  if (auto m = moves.corner(); m.valid) return asPt(m);

  const int hasMoves = (moves.eyeMove().valid ? 1 : 0) + (moves.eyeBlock().valid ? 1 : 0) +
                       (moves.growth().valid ? 1 : 0) + (moves.defend().valid ? 1 : 0) + (surround.valid ? 1 : 0);
  const bool usePattern = rng > 0.25 || hasMoves == 0;
  if (auto m = moves.pattern(); m.valid && usePattern) return asPt(m);

  if (rng > 0.4) {
    if (auto m = moves.jump(); m.valid) return asPt(m);
  }
  if (rng < 0.6 && surround.valid && surround.newLibertyCount <= 2) return Pt{surround.x, surround.y};
  return std::nullopt;
}

std::optional<Pt> netburnersMove(MoveGen& moves, double rng) {
  if (rng < 0.2) return illuminatiMove(moves, rng);
  if (rng < 0.4) {
    if (auto m = moves.expansion(); m.valid) return asPt(m);
  } else if (rng < 0.6) {
    if (auto m = moves.growth(); m.valid) return asPt(m);
  } else if (rng < 0.75) {
    return asPt(moves.random());
  }
  return std::nullopt;
}

std::optional<Pt> slumSnakesMove(MoveGen& moves, double rng) {
  if (auto m = moves.defendCapture(); m.valid) return asPt(m);
  if (rng < 0.2) return illuminatiMove(moves, rng);
  if (rng < 0.6) {
    if (auto m = moves.growth(); m.valid) return asPt(m);
  } else if (rng < 0.65) {
    return asPt(moves.random());
  }
  return std::nullopt;
}

std::optional<Pt> blackHandMove(MoveGen& moves, double rng) {
  if (auto m = moves.capture(); m.valid) return asPt(m);
  const AiMove surround = moves.surround();
  if (surround.valid && surround.newLibertyCount <= 1) return Pt{surround.x, surround.y};
  if (auto m = moves.defendCapture(); m.valid) return asPt(m);
  if (surround.valid && surround.newLibertyCount <= 2) return Pt{surround.x, surround.y};
  if (rng < 0.3) return illuminatiMove(moves, rng);
  if (rng < 0.75 && surround.valid) return Pt{surround.x, surround.y};
  if (rng < 0.8) return asPt(moves.random());
  return std::nullopt;
}

std::optional<Pt> tetradMove(MoveGen& moves, double rng) {
  if (auto m = moves.capture(); m.valid) return asPt(m);
  if (auto m = moves.defendCapture(); m.valid) return asPt(m);
  if (auto m = moves.pattern(); m.valid) return asPt(m);
  const AiMove surround = moves.surround();
  if (surround.valid && surround.newLibertyCount <= 1) return Pt{surround.x, surround.y};
  if (rng < 0.4) return illuminatiMove(moves, rng);
  return std::nullopt;
}

std::optional<Pt> daedalusMove(MoveGen& moves, double rng) {
  if (rng < 0.9) return illuminatiMove(moves, rng);
  return std::nullopt;
}

std::optional<Pt> factionMove(MoveGen& moves, Opponent faction, double rng) {
  switch (faction) {
    case Opponent::Netburners: return netburnersMove(moves, rng);
    case Opponent::SlumSnakes: return slumSnakesMove(moves, rng);
    case Opponent::TheBlackHand: return blackHandMove(moves, rng);
    case Opponent::Tetrads: return tetradMove(moves, rng);
    case Opponent::Daedalus: return daedalusMove(moves, rng);
    default: return illuminatiMove(moves, rng);
  }
}

}  // namespace

std::vector<Pt> factionConsideredSpaces(const GameState& state, Color player, Opponent opponent,
                                        double seedMs) {
  WHRNG rng(seedMs);
  const bool smart = isSmart(opponent, rng.random());
  return findDisputedTerritory(state, player, smart);
}

std::vector<std::pair<int, int>> blackExploitMoves(const GameState& state, Opponent opponent,
                                                   double seedMs) {
  const int N = state.size;
  std::unordered_set<int> points;

  auto add = [&](int x, int y) {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    points.insert(flatIndex(N, x, y));
  };

  for (const auto& [x, y] : factionConsideredSpaces(state, Color::White, opponent, seedMs)) add(x, y);
  for (const auto& [x, y] : findDisputedTerritory(state, Color::Black, true)) add(x, y);

  // Neighbors of white stones — AI defends/captures here.
  for (int x = 0; x < N; ++x) {
    for (int y = 0; y < N; ++y) {
      if (state.board[x][y] != 'O') continue;
      for (const int nIdx : onBoardNeighbors(N, x, y)) {
        const int nx = nIdx / N;
        const int ny = nIdx % N;
        if (state.board[nx][ny] == '.') add(nx, ny);
      }
    }
  }

  std::vector<std::pair<int, int>> out;
  for (const auto& [x, y] : getAllValidMoves(state, Color::Black)) {
    const int idx = flatIndex(N, x, y);
    if (points.count(idx)) {
      out.emplace_back(x, y);
      continue;
    }
    const SimpleBoard after = evaluateMoveResult(state.board, x, y, Color::Black);
    const ChainSet cs = computeChains(after);
    bool capture = false;
    for (int c = 0; c < cs.count; ++c) {
      if (cs.chainColor[c] == 'O' && cs.liberties[c].empty()) capture = true;
    }
  if (capture) out.emplace_back(x, y);
  }

  if (out.size() < 2) return getAllValidMoves(state, Color::Black);
  return out;
}

std::vector<Pt> enumerateFactionMoves(const GameState& state, Color player, Opponent opponent,
                                      MathRandom& mathRng) {
  return enumerateFactionMovesImpl(state, player, opponent, mathRng);
}

bool isSmart(Opponent faction, double rng) {
  if (faction == Opponent::Netburners) return false;
  if (faction == Opponent::SlumSnakes) return rng < 0.3;
  if (faction == Opponent::TheBlackHand) return rng < 0.8;
  return true;
}

Play getMove(const GameState& state, Color player, Opponent opponent, double seedMs, MathRandom& mathRng) {
  WHRNG rng(seedMs);
  const bool smart = isSmart(opponent, rng.random());  // draw 1
  const double moveRng = rng.random();                 // draw 2
  MoveGen moves(state, player, moveRng, smart, mathRng);
  const double factionRng = rng.random();              // draw 3

  const std::optional<Pt> priority = factionMove(moves, opponent, factionRng);
  if (priority) return Play{PlayType::Move, priority->first, priority->second};

  // Fallback: pick a random valid move from the reasonable options.
  std::vector<Pt> options;
  auto consider = [&](const AiMove& m) {
    if (m.valid && evaluateIfMoveIsValid(state, m.x, m.y, player) == Validity::Valid) options.emplace_back(m.x, m.y);
  };
  consider(moves.growth());
  consider(moves.surround());
  consider(moves.defend());
  consider(moves.expansion());
  consider(moves.pattern());
  consider(moves.eyeMove());
  consider(moves.eyeBlock());

  const double fallbackRng = rng.random();  // draw 4
  if (!options.empty()) {
    const int idx = floorIndex(fallbackRng, options.size());
    if (idx >= 0 && idx < static_cast<int>(options.size())) {
      return Play{PlayType::Move, options[idx].first, options[idx].second};
    }
  }
  return Play{PlayType::Pass, -1, -1};
}

}  // namespace ipvgo::game
