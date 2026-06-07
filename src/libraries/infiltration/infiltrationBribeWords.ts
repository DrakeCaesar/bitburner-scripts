/** Compliments that confirm successfully with space in "Say something nice about the guard". */
export const POSITIVE_BRIBE_WORDS: readonly string[] = [
  "affectionate",
  "agreeable",
  "bright",
  "charming",
  "creative",
  "determined",
  "energetic",
  "friendly",
  "funny",
  "generous",
  "polite",
  "likable",
  "diplomatic",
  "helpful",
  "giving",
  "kind",
  "hardworking",
  "patient",
  "dynamic",
  "loyal",
  "straightforward",
]

/** Insults / negatives; scroll past these with up/down before confirming. */
export const NEGATIVE_BRIBE_WORDS: readonly string[] = [
  "aggressive",
  "aloof",
  "arrogant",
  "big-headed",
  "boastful",
  "boring",
  "bossy",
  "careless",
  "clingy",
  "couch potato",
  "cruel",
  "cynical",
  "grumpy",
  "hot air",
  "know it all",
  "obnoxious",
  "pain in the neck",
  "picky",
  "tactless",
  "thoughtless",
  "cringe",
]

const positiveSet = new Set(POSITIVE_BRIBE_WORDS.map((word) => word.toLowerCase()))
const negativeSet = new Set(NEGATIVE_BRIBE_WORDS.map((word) => word.toLowerCase()))

export function normalizeBribeWord(word: string): string {
  return word.trim().toLowerCase()
}

export function isPositiveBribeWord(word: string): boolean {
  return positiveSet.has(normalizeBribeWord(word))
}

export function isNegativeBribeWord(word: string): boolean {
  return negativeSet.has(normalizeBribeWord(word))
}

export function isSaySomethingNiceTask(taskTitle: string): boolean {
  return taskTitle.trim().toLowerCase().includes("say something nice")
}
