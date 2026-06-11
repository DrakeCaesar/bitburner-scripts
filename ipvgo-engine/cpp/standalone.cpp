#include "json_api.hpp"

#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

static std::string readFile(const std::string& path) {
  std::ifstream file(path);
  std::stringstream buffer;
  buffer << file.rdbuf();
  return buffer.str();
}

static void writeFile(const std::string& path, const std::string& content) {
  std::ofstream file(path);
  file << content;
}

int main(int argc, char* argv[]) {
  try {
    std::string input;
    std::string outputPath;

    if (argc < 2) {
      std::cerr << "Usage: ipvgo_engine <input.json> [output.json]\n";
      return 1;
    }

    input = readFile(argv[1]);
    if (input.empty() && argc == 2) {
      input = argv[1];
    }
    if (argc >= 3) {
      outputPath = argv[2];
    }

    const std::string result = ipvgo::processMoveRequestJson(input);

    if (!outputPath.empty()) {
      writeFile(outputPath, result);
    } else {
      std::cout << result;
    }
    return 0;
  } catch (const std::exception& ex) {
    std::cerr << "Error: " << ex.what() << "\n";
    return 2;
  }
}
