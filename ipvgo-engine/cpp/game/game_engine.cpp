#include "game_engine.hpp"

namespace ipvgo::game {

std::optional<Opponent> parseOpponent(const std::string& name) {
  if (name == "No AI" || name == "None" || name == "none") return Opponent::None;
  if (name == "Netburners") return Opponent::Netburners;
  if (name == "Slum Snakes" || name == "SlumSnakes") return Opponent::SlumSnakes;
  if (name == "The Black Hand" || name == "TheBlackHand") return Opponent::TheBlackHand;
  if (name == "Tetrads") return Opponent::Tetrads;
  if (name == "Daedalus") return Opponent::Daedalus;
  if (name == "Illuminati") return Opponent::Illuminati;
  if (name == "????????????" || name == "w0r1d_d43m0n" || name == "WorldDaemon") return Opponent::WorldDaemon;
  return std::nullopt;
}

std::string opponentName(Opponent ai) {
  switch (ai) {
    case Opponent::None: return "No AI";
    case Opponent::Netburners: return "Netburners";
    case Opponent::SlumSnakes: return "Slum Snakes";
    case Opponent::TheBlackHand: return "The Black Hand";
    case Opponent::Tetrads: return "Tetrads";
    case Opponent::Daedalus: return "Daedalus";
    case Opponent::Illuminati: return "Illuminati";
    case Opponent::WorldDaemon: return "????????????";
  }
  return "No AI";
}

Color parseColor(const std::string& s) { return s == "O" ? Color::White : Color::Black; }

}  // namespace ipvgo::game
