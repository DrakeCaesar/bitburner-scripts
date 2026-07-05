/* Auto-generated — edit tests/kingOfTheHillCore.ts; run pnpm run test:koth:bundle */
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// tests/kingOfTheHillTune.avg.json
var kingOfTheHillTune_avg_default = {
  objective: "avg",
  avgGuesses: 19.7291666667,
  maxGuesses: 44,
  totalGuesses: 4735,
  fitness: 4735044,
  config: {
    clusterMargin: 1.05,
    clusterDetectAlt: 348,
    mainPeakModeAlt: 9063,
    refinePeakCountMain: 1,
    findHillQuickRounds: 4,
    coarseMinDivisor: 61,
    coarseHillFactor: 9,
    rescanDivisor1: 101,
    rescanDivisor2: 247,
    rescanDivisor3: 674,
    refineSpanHillDivisor: 6,
    refineCoarsePasses: 4,
    refineFinePasses: 2,
    refineRadiusShrink: 10,
    refineStepShrink: 5,
    sideHillSweepWidthDivisor: 3,
    centroidMinAlt: 8310,
    centroidAltFraction: 0.9,
    centroidRefineRadius: 11,
    centroidRefinePasses: 4,
    hillClimbInitialDivisor: 76,
    hillClimbShrink: 4,
    hillClimbFlatAltDelta: 0.056,
    zoomInitialDivisor: 44,
    zoomMaxPasses: 6,
    zoomStepDivisor: 4,
    parabolicFlatNegLog10: 6,
    mainPeakDetectAlt: 7868,
    mainPeakWindowWidths: 2,
    gaussEstimateMinAlt: 179,
    gaussHeightFraction: 1,
    enableGaussianEstimate: 1,
    ternaryMaxItersCap: 120,
    ternaryWidthStop: 4,
    ternarySpanDivisor: 2,
    enableTernarySearch: 1,
    expandMaxStepDivisor: 1,
    expandStepMultiplier: 4,
    enableExpandFromBest: 0,
    subdivNarrowStepFactor: 2,
    enableSubdivNarrow: 1,
    centroidLogWeight: 0.4,
    finalMainRadius: 8,
    finalSideMinRadius: 40,
    finalSideMaxRadius: 110,
    finalSideSpanDivisor: 61,
    finalTinySpan: 18
  }
};

// tests/kingOfTheHillTune.max.json
var kingOfTheHillTune_max_default = {
  objective: "max",
  avgGuesses: 32.7291666667,
  maxGuesses: 68,
  totalGuesses: 7855,
  fitness: 68007855,
  benchmark: {
    seed: 1265595496,
    difficulty: 60,
    poolSize: 24e4,
    count: 240,
    selection: "worst",
    assignments: [
      { index: 79795, password: "9711082680", mainPeak: 9711082680, guesses: 28, solved: true },
      { index: 205999, password: "9712774403", mainPeak: 9712774403, guesses: 28, solved: true },
      { index: 29800, password: "9709156474", mainPeak: 9709156474, guesses: 28, solved: true },
      { index: 120738, password: "9710771016", mainPeak: 9710771016, guesses: 54, solved: true },
      { index: 145408, password: "9710964675", mainPeak: 9710964675, guesses: 28, solved: true },
      { index: 7897, password: "9710668806", mainPeak: 9710668806, guesses: 54, solved: true },
      { index: 73824, password: "9709932286", mainPeak: 9709932286, guesses: 52, solved: true },
      { index: 101657, password: "9712372337", mainPeak: 9712372337, guesses: 52, solved: true },
      { index: 108976, password: "9713074716", mainPeak: 9713074716, guesses: 64, solved: true },
      { index: 183060, password: "9711364644", mainPeak: 9711364644, guesses: 52, solved: true },
      { index: 116625, password: "9573457873", mainPeak: 9573457873, guesses: 17, solved: true },
      { index: 121877, password: "9573817625", mainPeak: 9573817625, guesses: 17, solved: true },
      { index: 151849, password: "9830315523", mainPeak: 9830315523, guesses: 12, solved: true },
      { index: 46131, password: "9728768395", mainPeak: 9728768395, guesses: 27, solved: true },
      { index: 144061, password: "9708884038", mainPeak: 9708884038, guesses: 54, solved: true },
      { index: 87172, password: "9711131409", mainPeak: 9711131409, guesses: 28, solved: true },
      { index: 155542, password: "9712593629", mainPeak: 9712593629, guesses: 52, solved: true },
      { index: 174609, password: "9711128040", mainPeak: 9711128040, guesses: 54, solved: true },
      { index: 213962, password: "7532349387", mainPeak: 7532349387, guesses: 21, solved: true },
      { index: 221200, password: "9708893666", mainPeak: 9708893666, guesses: 28, solved: true },
      { index: 49571, password: "9711407186", mainPeak: 9711407186, guesses: 28, solved: true },
      { index: 91268, password: "7529820403", mainPeak: 7529820403, guesses: 39, solved: true },
      { index: 101058, password: "9712108539", mainPeak: 9712108539, guesses: 28, solved: true },
      { index: 205696, password: "9576283929", mainPeak: 9576283929, guesses: 17, solved: true },
      { index: 54214, password: "9838113506", mainPeak: 9838113506, guesses: 12, solved: true },
      { index: 82318, password: "9711547165", mainPeak: 9711547165, guesses: 16, solved: true },
      { index: 117718, password: "9589284940", mainPeak: 9589284940, guesses: 17, solved: true },
      { index: 192771, password: "9843339718", mainPeak: 9843339718, guesses: 17, solved: true },
      { index: 218631, password: "9709761636", mainPeak: 9709761636, guesses: 51, solved: true },
      { index: 24396, password: "9573642903", mainPeak: 9573642903, guesses: 17, solved: true },
      { index: 227457, password: "8687713080", mainPeak: 8687713080, guesses: 53, solved: true },
      { index: 142497, password: "9834321367", mainPeak: 9834321367, guesses: 12, solved: true },
      { index: 143116, password: "9822333179", mainPeak: 9822333179, guesses: 12, solved: true },
      { index: 155106, password: "9608006648", mainPeak: 9608006648, guesses: 17, solved: true },
      { index: 163775, password: "8176693298", mainPeak: 8176693298, guesses: 27, solved: true },
      { index: 165318, password: "7607836259", mainPeak: 7607836259, guesses: 25, solved: true },
      { index: 168581, password: "9565083609", mainPeak: 9565083609, guesses: 17, solved: true },
      { index: 171088, password: "9843775871", mainPeak: 9843775871, guesses: 17, solved: true },
      { index: 219283, password: "9711958359", mainPeak: 9711958359, guesses: 60, solved: true },
      { index: 10712, password: "8696740238", mainPeak: 8696740238, guesses: 21, solved: true },
      { index: 26535, password: "9713726564", mainPeak: 9713726564, guesses: 54, solved: true },
      { index: 45478, password: "8699885417", mainPeak: 8699885417, guesses: 53, solved: true },
      { index: 113333, password: "9715262535", mainPeak: 9715262535, guesses: 54, solved: true },
      { index: 181554, password: "7887582366", mainPeak: 7887582366, guesses: 27, solved: true },
      { index: 183570, password: "9828623036", mainPeak: 9828623036, guesses: 12, solved: true },
      { index: 216565, password: "9709926135", mainPeak: 9709926135, guesses: 28, solved: true },
      { index: 21143, password: "7528881060", mainPeak: 7528881060, guesses: 39, solved: true },
      { index: 21634, password: "8694564368", mainPeak: 8694564368, guesses: 51, solved: true },
      { index: 45569, password: "9708922468", mainPeak: 9708922468, guesses: 54, solved: true },
      { index: 51843, password: "9573563963", mainPeak: 9573563963, guesses: 17, solved: true },
      { index: 102718, password: "9709928447", mainPeak: 9709928447, guesses: 58, solved: true },
      { index: 127665, password: "8173339501", mainPeak: 8173339501, guesses: 27, solved: true },
      { index: 130717, password: "8188044227", mainPeak: 8188044227, guesses: 27, solved: true },
      { index: 131541, password: "9827046207", mainPeak: 9827046207, guesses: 12, solved: true },
      { index: 141841, password: "7530176236", mainPeak: 7530176236, guesses: 39, solved: true },
      { index: 148043, password: "8157402501", mainPeak: 8157402501, guesses: 28, solved: true },
      { index: 149562, password: "9843333240", mainPeak: 9843333240, guesses: 17, solved: true },
      { index: 166047, password: "9718398357", mainPeak: 9718398357, guesses: 52, solved: true },
      { index: 175083, password: "9718919936", mainPeak: 9718919936, guesses: 27, solved: true },
      { index: 190124, password: "9823847832", mainPeak: 9823847832, guesses: 12, solved: true },
      { index: 203591, password: "8707202594", mainPeak: 8707202594, guesses: 53, solved: true },
      { index: 8541, password: "9573271752", mainPeak: 9573271752, guesses: 17, solved: true },
      { index: 22498, password: "9580700405", mainPeak: 9580700405, guesses: 17, solved: true },
      { index: 61489, password: "9709659082", mainPeak: 9709659082, guesses: 60, solved: true },
      { index: 74495, password: "8381869192", mainPeak: 8381869192, guesses: 58, solved: true },
      { index: 79990, password: "8371591739", mainPeak: 8371591739, guesses: 49, solved: true },
      { index: 81662, password: "8697928243", mainPeak: 8697928243, guesses: 65, solved: true },
      { index: 87125, password: "9717723502", mainPeak: 9717723502, guesses: 60, solved: true },
      { index: 128568, password: "9828739226", mainPeak: 9828739226, guesses: 12, solved: true },
      { index: 134405, password: "9831615726", mainPeak: 9831615726, guesses: 12, solved: true },
      { index: 143448, password: "7830584093", mainPeak: 7830584093, guesses: 47, solved: true },
      { index: 150524, password: "9844300109", mainPeak: 9844300109, guesses: 17, solved: true },
      { index: 159145, password: "8688591579", mainPeak: 8688591579, guesses: 43, solved: true },
      { index: 164648, password: "9840944042", mainPeak: 9840944042, guesses: 12, solved: true },
      { index: 169606, password: "8702649885", mainPeak: 8702649885, guesses: 54, solved: true },
      { index: 180463, password: "8180072621", mainPeak: 8180072621, guesses: 27, solved: true },
      { index: 201506, password: "9721289730", mainPeak: 9721289730, guesses: 49, solved: true },
      { index: 207027, password: "9712477002", mainPeak: 9712477002, guesses: 28, solved: true },
      { index: 213343, password: "8715116775", mainPeak: 8715116775, guesses: 27, solved: true },
      { index: 10983, password: "9827239991", mainPeak: 9827239991, guesses: 12, solved: true },
      { index: 39015, password: "8692203003", mainPeak: 8692203003, guesses: 27, solved: true },
      { index: 39614, password: "9714303076", mainPeak: 9714303076, guesses: 52, solved: true },
      { index: 91024, password: "9715740277", mainPeak: 9715740277, guesses: 52, solved: true },
      { index: 94045, password: "9837482916", mainPeak: 9837482916, guesses: 12, solved: true },
      { index: 139320, password: "9307524509", mainPeak: 9307524509, guesses: 17, solved: true },
      { index: 145610, password: "9825472884", mainPeak: 9825472884, guesses: 12, solved: true },
      { index: 171236, password: "9828062840", mainPeak: 9828062840, guesses: 12, solved: true },
      { index: 202448, password: "8680686512", mainPeak: 8680686512, guesses: 56, solved: true },
      { index: 214992, password: "9710021122", mainPeak: 9710021122, guesses: 54, solved: true },
      { index: 227858, password: "9835809804", mainPeak: 9835809804, guesses: 12, solved: true },
      { index: 24347, password: "8169500738", mainPeak: 8169500738, guesses: 28, solved: true },
      { index: 39677, password: "8744050759", mainPeak: 8744050759, guesses: 61, solved: true },
      { index: 61824, password: "9828663642", mainPeak: 9828663642, guesses: 12, solved: true },
      { index: 91498, password: "7834191428", mainPeak: 7834191428, guesses: 47, solved: true },
      { index: 93345, password: "9829927140", mainPeak: 9829927140, guesses: 12, solved: true },
      { index: 159717, password: "9718669134", mainPeak: 9718669134, guesses: 52, solved: true },
      { index: 171589, password: "8360661887", mainPeak: 8360661887, guesses: 52, solved: true },
      { index: 180778, password: "9305503773", mainPeak: 9305503773, guesses: 17, solved: true },
      { index: 184332, password: "9572324721", mainPeak: 9572324721, guesses: 17, solved: true },
      { index: 212451, password: "8757635554", mainPeak: 8757635554, guesses: 54, solved: true },
      { index: 218704, password: "8175651697", mainPeak: 8175651697, guesses: 27, solved: true },
      { index: 223029, password: "9837868291", mainPeak: 9837868291, guesses: 12, solved: true },
      { index: 225092, password: "9561880179", mainPeak: 9561880179, guesses: 17, solved: true },
      { index: 238587, password: "9711470489", mainPeak: 9711470489, guesses: 54, solved: true },
      { index: 9520, password: "9835175601", mainPeak: 9835175601, guesses: 12, solved: true },
      { index: 40788, password: "8359661802", mainPeak: 8359661802, guesses: 50, solved: true },
      { index: 61641, password: "8186636002", mainPeak: 8186636002, guesses: 27, solved: true },
      { index: 66192, password: "8381221835", mainPeak: 8381221835, guesses: 57, solved: true },
      { index: 79956, password: "9715573003", mainPeak: 9715573003, guesses: 28, solved: true },
      { index: 84732, password: "8681098092", mainPeak: 8681098092, guesses: 50, solved: true },
      { index: 88790, password: "7822025369", mainPeak: 7822025369, guesses: 44, solved: true },
      { index: 91524, password: "9830285779", mainPeak: 9830285779, guesses: 12, solved: true },
      { index: 98458, password: "8685120159", mainPeak: 8685120159, guesses: 51, solved: true },
      { index: 117344, password: "7531641782", mainPeak: 7531641782, guesses: 39, solved: true },
      { index: 167910, password: "8703778406", mainPeak: 8703778406, guesses: 27, solved: true },
      { index: 187996, password: "9833580202", mainPeak: 9833580202, guesses: 12, solved: true },
      { index: 229518, password: "8170168916", mainPeak: 8170168916, guesses: 28, solved: true },
      { index: 1670, password: "9273390925", mainPeak: 9273390925, guesses: 8, solved: true },
      { index: 13723, password: "9820747041", mainPeak: 9820747041, guesses: 12, solved: true },
      { index: 15795, password: "8705724200", mainPeak: 8705724200, guesses: 27, solved: true },
      { index: 24225, password: "9575703446", mainPeak: 9575703446, guesses: 17, solved: true },
      { index: 31746, password: "8715054178", mainPeak: 8715054178, guesses: 27, solved: true },
      { index: 58411, password: "9821707715", mainPeak: 9821707715, guesses: 12, solved: true },
      { index: 90491, password: "8682100497", mainPeak: 8682100497, guesses: 56, solved: true },
      { index: 117636, password: "8693443620", mainPeak: 8693443620, guesses: 54, solved: true },
      { index: 136779, password: "9832695310", mainPeak: 9832695310, guesses: 12, solved: true },
      { index: 163913, password: "9729208015", mainPeak: 9729208015, guesses: 27, solved: true },
      { index: 165354, password: "9821603130", mainPeak: 9821603130, guesses: 12, solved: true },
      { index: 168307, password: "8681802292", mainPeak: 8681802292, guesses: 68, solved: true },
      { index: 183064, password: "8367215156", mainPeak: 8367215156, guesses: 49, solved: true },
      { index: 191320, password: "9833793354", mainPeak: 9833793354, guesses: 12, solved: true },
      { index: 222545, password: "9303320952", mainPeak: 9303320952, guesses: 17, solved: true },
      { index: 50332, password: "9829449243", mainPeak: 9829449243, guesses: 12, solved: true },
      { index: 86490, password: "8370117903", mainPeak: 8370117903, guesses: 49, solved: true },
      { index: 101833, password: "6501018773", mainPeak: 6501018773, guesses: 64, solved: true },
      { index: 103356, password: "8682220460", mainPeak: 8682220460, guesses: 53, solved: true },
      { index: 107675, password: "9723937686", mainPeak: 9723937686, guesses: 49, solved: true },
      { index: 120617, password: "9824201691", mainPeak: 9824201691, guesses: 12, solved: true },
      { index: 130715, password: "8688896161", mainPeak: 8688896161, guesses: 56, solved: true },
      { index: 133224, password: "9270578194", mainPeak: 9270578194, guesses: 8, solved: true },
      { index: 142837, password: "9834994967", mainPeak: 9834994967, guesses: 12, solved: true },
      { index: 145834, password: "9534859909", mainPeak: 9534859909, guesses: 24, solved: true },
      { index: 171113, password: "8694975072", mainPeak: 8694975072, guesses: 68, solved: true },
      { index: 30422, password: "9832706140", mainPeak: 9832706140, guesses: 12, solved: true },
      { index: 50489, password: "8693975308", mainPeak: 8693975308, guesses: 64, solved: true },
      { index: 77543, password: "9709984356", mainPeak: 9709984356, guesses: 28, solved: true },
      { index: 101299, password: "8941443219", mainPeak: 8941443219, guesses: 16, solved: true },
      { index: 109060, password: "8699884107", mainPeak: 8699884107, guesses: 51, solved: true },
      { index: 143404, password: "8721908127", mainPeak: 8721908127, guesses: 52, solved: true },
      { index: 154447, password: "8713699983", mainPeak: 8713699983, guesses: 54, solved: true },
      { index: 174260, password: "9265727106", mainPeak: 9265727106, guesses: 8, solved: true },
      { index: 194721, password: "9713649869", mainPeak: 9713649869, guesses: 52, solved: true },
      { index: 7033, password: "9832423037", mainPeak: 9832423037, guesses: 12, solved: true },
      { index: 26355, password: "8371880244", mainPeak: 8371880244, guesses: 49, solved: true },
      { index: 42987, password: "8364857635", mainPeak: 8364857635, guesses: 49, solved: true },
      { index: 54998, password: "8749839397", mainPeak: 8749839397, guesses: 54, solved: true },
      { index: 66105, password: "8995273761", mainPeak: 8995273761, guesses: 24, solved: true },
      { index: 69043, password: "8179154535", mainPeak: 8179154535, guesses: 27, solved: true },
      { index: 77825, password: "7532241708", mainPeak: 7532241708, guesses: 39, solved: true },
      { index: 79168, password: "9825428966", mainPeak: 9825428966, guesses: 12, solved: true },
      { index: 130221, password: "8972047726", mainPeak: 8972047726, guesses: 53, solved: true },
      { index: 143947, password: "9712406071", mainPeak: 9712406071, guesses: 52, solved: true },
      { index: 152504, password: "9836653839", mainPeak: 9836653839, guesses: 12, solved: true },
      { index: 156982, password: "8714114832", mainPeak: 8714114832, guesses: 56, solved: true },
      { index: 158399, password: "8728172122", mainPeak: 8728172122, guesses: 56, solved: true },
      { index: 162067, password: "9717914293", mainPeak: 9717914293, guesses: 52, solved: true },
      { index: 181869, password: "8692620036", mainPeak: 8692620036, guesses: 27, solved: true },
      { index: 185433, password: "9822368304", mainPeak: 9822368304, guesses: 12, solved: true },
      { index: 239288, password: "8715281278", mainPeak: 8715281278, guesses: 43, solved: true },
      { index: 13043, password: "9823600507", mainPeak: 9823600507, guesses: 12, solved: true },
      { index: 13587, password: "9713021375", mainPeak: 9713021375, guesses: 54, solved: true },
      { index: 42975, password: "8733530659", mainPeak: 8733530659, guesses: 21, solved: true },
      { index: 57558, password: "9723093689", mainPeak: 9723093689, guesses: 52, solved: true },
      { index: 70051, password: "8690137388", mainPeak: 8690137388, guesses: 54, solved: true },
      { index: 73068, password: "9174503245", mainPeak: 9174503245, guesses: 46, solved: true },
      { index: 94428, password: "9839616521", mainPeak: 9839616521, guesses: 12, solved: true },
      { index: 97631, password: "9452809619", mainPeak: 9452809619, guesses: 40, solved: true },
      { index: 101473, password: "8721603080", mainPeak: 8721603080, guesses: 21, solved: true },
      { index: 109028, password: "9716307227", mainPeak: 9716307227, guesses: 52, solved: true },
      { index: 146189, password: "8687185637", mainPeak: 8687185637, guesses: 56, solved: true },
      { index: 156319, password: "7853657154", mainPeak: 7853657154, guesses: 57, solved: true },
      { index: 166198, password: "9568318515", mainPeak: 9568318515, guesses: 17, solved: true },
      { index: 183306, password: "7823739743", mainPeak: 7823739743, guesses: 44, solved: true },
      { index: 184513, password: "8167492255", mainPeak: 8167492255, guesses: 28, solved: true },
      { index: 194517, password: "9472134097", mainPeak: 9472134097, guesses: 16, solved: true },
      { index: 217192, password: "9211684263", mainPeak: 9211684263, guesses: 29, solved: true },
      { index: 217674, password: "9838420273", mainPeak: 9838420273, guesses: 12, solved: true },
      { index: 231390, password: "8371412897", mainPeak: 8371412897, guesses: 49, solved: true },
      { index: 6580, password: "8914411666", mainPeak: 8914411666, guesses: 16, solved: true },
      { index: 21763, password: "9831415019", mainPeak: 9831415019, guesses: 12, solved: true },
      { index: 24334, password: "8163455272", mainPeak: 8163455272, guesses: 28, solved: true },
      { index: 25687, password: "8989415212", mainPeak: 8989415212, guesses: 24, solved: true },
      { index: 28248, password: "8723977841", mainPeak: 8723977841, guesses: 53, solved: true },
      { index: 48900, password: "9839601135", mainPeak: 9839601135, guesses: 12, solved: true },
      { index: 93189, password: "8991026379", mainPeak: 8991026379, guesses: 24, solved: true },
      { index: 97033, password: "8946302685", mainPeak: 8946302685, guesses: 16, solved: true },
      { index: 99817, password: "9263882566", mainPeak: 9263882566, guesses: 8, solved: true },
      { index: 101526, password: "8988306376", mainPeak: 8988306376, guesses: 25, solved: true },
      { index: 126373, password: "8677731375", mainPeak: 8677731375, guesses: 56, solved: true },
      { index: 165404, password: "8373188916", mainPeak: 8373188916, guesses: 52, solved: true },
      { index: 171270, password: "9326717201", mainPeak: 9326717201, guesses: 17, solved: true },
      { index: 183404, password: "8681395054", mainPeak: 8681395054, guesses: 56, solved: true },
      { index: 218881, password: "9261125126", mainPeak: 9261125126, guesses: 8, solved: true },
      { index: 1363, password: "7852486594", mainPeak: 7852486594, guesses: 55, solved: true },
      { index: 12093, password: "9533089632", mainPeak: 9533089632, guesses: 24, solved: true },
      { index: 16624, password: "8696920110", mainPeak: 8696920110, guesses: 21, solved: true },
      { index: 28656, password: "7884304296", mainPeak: 7884304296, guesses: 27, solved: true },
      { index: 36488, password: "8922323579", mainPeak: 8922323579, guesses: 16, solved: true },
      { index: 36501, password: "9826100236", mainPeak: 9826100236, guesses: 12, solved: true },
      { index: 36793, password: "8706844019", mainPeak: 8706844019, guesses: 59, solved: true },
      { index: 54151, password: "9576988305", mainPeak: 9576988305, guesses: 17, solved: true },
      { index: 64093, password: "9208878014", mainPeak: 9208878014, guesses: 29, solved: true },
      { index: 71365, password: "8706555735", mainPeak: 8706555735, guesses: 54, solved: true },
      { index: 74421, password: "8171115109", mainPeak: 8171115109, guesses: 28, solved: true },
      { index: 85675, password: "9842151321", mainPeak: 9842151321, guesses: 12, solved: true },
      { index: 90890, password: "9837131126", mainPeak: 9837131126, guesses: 12, solved: true },
      { index: 100513, password: "7525334523", mainPeak: 7525334523, guesses: 39, solved: true },
      { index: 113424, password: "8747888440", mainPeak: 8747888440, guesses: 54, solved: true },
      { index: 121765, password: "9171020783", mainPeak: 9171020783, guesses: 46, solved: true },
      { index: 139163, password: "9499994096", mainPeak: 9499994096, guesses: 16, solved: true },
      { index: 140002, password: "8381456872", mainPeak: 8381456872, guesses: 58, solved: true },
      { index: 143700, password: "9468052030", mainPeak: 9468052030, guesses: 16, solved: true },
      { index: 198744, password: "7611846169", mainPeak: 7611846169, guesses: 25, solved: true },
      { index: 221708, password: "8720313922", mainPeak: 8720313922, guesses: 52, solved: true },
      { index: 229909, password: "8377022033", mainPeak: 8377022033, guesses: 48, solved: true },
      { index: 233869, password: "8374944799", mainPeak: 8374944799, guesses: 52, solved: true },
      { index: 10392, password: "9263652510", mainPeak: 9263652510, guesses: 8, solved: true },
      { index: 39888, password: "7527276921", mainPeak: 7527276921, guesses: 39, solved: true },
      { index: 55857, password: "9500109026", mainPeak: 9500109026, guesses: 16, solved: true },
      { index: 87773, password: "9212349632", mainPeak: 9212349632, guesses: 29, solved: true },
      { index: 93822, password: "7039560821", mainPeak: 7039560821, guesses: 25, solved: true },
      { index: 101317, password: "7834603258", mainPeak: 7834603258, guesses: 47, solved: true },
      { index: 115228, password: "9267690272", mainPeak: 9267690272, guesses: 8, solved: true },
      { index: 119398, password: "9214234101", mainPeak: 9214234101, guesses: 29, solved: true },
      { index: 127663, password: "9506086975", mainPeak: 9506086975, guesses: 16, solved: true },
      { index: 131917, password: "8759882098", mainPeak: 8759882098, guesses: 54, solved: true },
      { index: 175612, password: "9726654072", mainPeak: 9726654072, guesses: 27, solved: true },
      { index: 176223, password: "9891722034", mainPeak: 9891722034, guesses: 17, solved: true },
      { index: 179663, password: "9470538646", mainPeak: 9470538646, guesses: 16, solved: true },
      { index: 184487, password: "7614168140", mainPeak: 7614168140, guesses: 25, solved: true }
    ]
  },
  config: {
    clusterMargin: 1.25,
    clusterDetectAlt: 350,
    mainPeakModeAlt: 9130,
    refinePeakCountMain: 1,
    findHillQuickRounds: 5,
    coarseMinDivisor: 48,
    coarseHillFactor: 9,
    rescanDivisor1: 99,
    rescanDivisor2: 218,
    rescanDivisor3: 31,
    refineSpanHillDivisor: 6,
    refineCoarsePasses: 7,
    refineFinePasses: 6,
    refineRadiusShrink: 8,
    refineStepShrink: 5,
    sideHillSweepWidthDivisor: 2,
    centroidMinAlt: 9469,
    centroidAltFraction: 0.81,
    centroidRefineRadius: 6,
    centroidRefinePasses: 6,
    hillClimbInitialDivisor: 61,
    hillClimbShrink: 4,
    hillClimbFlatAltDelta: 0.046,
    zoomInitialDivisor: 25,
    zoomMaxPasses: 11,
    zoomStepDivisor: 11,
    parabolicFlatNegLog10: 9,
    mainPeakDetectAlt: 7925,
    mainPeakWindowWidths: 2,
    gaussEstimateMinAlt: 263,
    gaussHeightFraction: 1,
    enableGaussianEstimate: 1,
    ternaryMaxItersCap: 80,
    ternaryWidthStop: 6,
    ternarySpanDivisor: 8,
    enableTernarySearch: 1,
    expandMaxStepDivisor: 2,
    expandStepMultiplier: 4,
    enableExpandFromBest: 1,
    subdivNarrowStepFactor: 2,
    enableSubdivNarrow: 1,
    centroidLogWeight: 0.2,
    finalMainRadius: 5,
    finalSideMinRadius: 45,
    finalSideMaxRadius: 78,
    finalSideSpanDivisor: 59,
    finalTinySpan: 24
  }
};

// src/dnet/solvers/kingOfTheHill/config.ts
var TUNED_MAX_CONFIG = kingOfTheHillTune_max_default.config;
var TUNED_AVG_CONFIG = kingOfTheHillTune_avg_default.config;
function getTunedBenchmark(objective = "max") {
  const raw = objective === "avg" ? kingOfTheHillTune_avg_default : kingOfTheHillTune_max_default;
  return raw.benchmark ?? null;
}
function finalizeImprovedConfig(raw) {
  const cfg = { ...raw };
  cfg.enableGaussianEstimate = cfg.enableGaussianEstimate ? 1 : 0;
  cfg.enableTernarySearch = cfg.enableTernarySearch ? 1 : 0;
  cfg.enableExpandFromBest = cfg.enableExpandFromBest ? 1 : 0;
  cfg.enableSubdivNarrow = cfg.enableSubdivNarrow ? 1 : 0;
  cfg.parabolicFlatEpsilon = 10 ** -cfg.parabolicFlatNegLog10;
  cfg.rescanDivisors = [cfg.rescanDivisor1, cfg.rescanDivisor2, cfg.rescanDivisor3].filter((d) => d > 0).sort((a, b) => a - b);
  return cfg;
}
function getTunedImprovedConfig(objective = "max") {
  return finalizeImprovedConfig(objective === "avg" ? TUNED_AVG_CONFIG : TUNED_MAX_CONFIG);
}
function computeImprovedFitness(objective, unsolved, totalGuesses, maxGuesses) {
  if (unsolved > 0) return Number.MAX_SAFE_INTEGER - unsolved * 1e9 + totalGuesses;
  if (objective === "max") return maxGuesses * 1e6 + totalGuesses;
  return totalGuesses * 1e3 + maxGuesses;
}

// src/dnet/solvers/kingOfTheHill/solverCore.ts
var KOTH_PEAK_HEIGHT = 1e4;
var KOTH_HILL_SPACING_WIDTHS = 3;
var KOTH_HILL_DIFFICULTY_DIVISOR = 8;
var KOTH_HILL_DIFFICULTY_CAP = 4;
var KOTH_GAUSS_WIDTH_LENGTH_OFFSET = 2;
var KOTH_GAUSS_WIDTH_PLUS = 1;
var SOLVER_MAX_PROBES = 5e3;
var TERNARY_MAX_LINEAR_SCAN = 64;
function parseKingOfTheHillAltitude(feedback, message) {
  if (typeof feedback === "number" && Number.isFinite(feedback)) return feedback;
  if (typeof feedback === "string") {
    const trimmed = feedback.trim();
    if (trimmed.length > 0) {
      const direct = Number(trimmed);
      if (Number.isFinite(direct)) return direct;
    }
  }
  if (typeof message === "string") {
    const fromMessage = message.match(/current altitude:\s*([-\d.]+)/i);
    if (fromMessage) {
      const alt = Number(fromMessage[1]);
      if (Number.isFinite(alt)) return alt;
    }
  }
  return null;
}
function kingOfTheHillHillCount(difficulty) {
  return Math.min(Math.floor(difficulty / KOTH_HILL_DIFFICULTY_DIVISOR), KOTH_HILL_DIFFICULTY_CAP) * 2 + 1;
}
function kingOfTheHillGaussianWidth(passwordLength) {
  return 10 ** Math.max(passwordLength - KOTH_GAUSS_WIDTH_LENGTH_OFFSET, 0) + KOTH_GAUSS_WIDTH_PLUS;
}
function ceilDiv(a, b) {
  return Math.floor((a + b - 1) / b);
}
function clusterHalfWidth(hillCount, passwordLength, clusterMargin) {
  const width = kingOfTheHillGaussianWidth(passwordLength);
  return Math.ceil((hillCount - 1) * width * KOTH_HILL_SPACING_WIDTHS * clusterMargin);
}
function clusterSearchWindow(fullMin, fullMax, center, hillCount, passwordLength, cfg) {
  const half = clusterHalfWidth(hillCount, passwordLength, cfg.clusterMargin);
  return { min: Math.max(fullMin, center - half), max: Math.min(fullMax, center + half) };
}
function improvedSearchWindow(fullMin, fullMax, session, hillCount, passwordLength, gaussWidth, cfg) {
  if (session.bestAlt >= cfg.mainPeakDetectAlt) {
    const half = gaussWidth * cfg.mainPeakWindowWidths;
    let winMin = Math.max(fullMin, session.bestVal - half);
    let winMax = Math.min(fullMax, session.bestVal + half);
    if (session.bestVal - fullMin <= half * 2) winMin = fullMin;
    if (fullMax - session.bestVal <= half * 2) winMax = fullMax;
    return { min: winMin, max: winMax };
  }
  if (session.bestAlt > cfg.clusterDetectAlt) {
    return clusterSearchWindow(fullMin, fullMax, session.bestVal, hillCount, passwordLength, cfg);
  }
  return { min: fullMin, max: fullMax };
}
function parabolicPeak(x0, y0, x1, y1, x2, y2, cfg) {
  const denom = y0 - 2 * y1 + y2;
  if (!Number.isFinite(denom) || Math.abs(denom) < cfg.parabolicFlatEpsilon) return x1;
  return x1 + (x1 - x0) * (y0 - y2) / (2 * denom);
}
function findLocalPeaks(sorted) {
  if (sorted.length === 0) return [];
  const peaks = [];
  for (let i = 1; i < sorted.length - 1; i++) {
    if (sorted[i].alt >= sorted[i - 1].alt && sorted[i].alt > sorted[i + 1].alt) {
      peaks.push({ x: sorted[i].x, alt: sorted[i].alt });
    }
  }
  let best = sorted[0];
  for (const row of sorted) {
    if (row.alt > best.alt) best = row;
  }
  peaks.push({ x: best.x, alt: best.alt });
  peaks.sort((a, b) => b.alt - a.alt);
  const seen = /* @__PURE__ */ new Set();
  return peaks.filter((p) => {
    if (seen.has(p.x)) return false;
    seen.add(p.x);
    return true;
  });
}
function refinePeak(session, mn, mx, center, initialRadius, passes, cfg) {
  let c = center;
  let r = Math.max(1, initialRadius);
  const onMainHill = session.bestAlt >= cfg.mainPeakDetectAlt;
  const maxPasses = onMainHill ? Math.min(passes, 2) : passes;
  for (let p = 0; p < maxPasses; p++) {
    const x0 = Math.max(mn, c - r);
    const x2 = Math.min(mx, c + r);
    const x1 = c;
    const y0 = session.probe(x0);
    if (session.solved) return c;
    const y1 = session.probe(x1);
    if (session.solved) return c;
    const y2 = session.probe(x2);
    if (session.solved) return c;
    const peak = parabolicPeak(x0, y0, x1, y1, x2, y2, cfg);
    c = Math.round(Math.max(mn, Math.min(mx, peak)));
    r = Math.max(1, ceilDiv(r, cfg.refineStepShrink));
  }
  return c;
}
function tryParabolicPinpointMain(session, mn, mx, gaussWidth, cfg) {
  if (session.bestAlt < cfg.mainPeakDetectAlt) return;
  const r = Math.max(1, Math.ceil(gaussWidth / 4));
  const c = session.bestVal;
  const x0 = Math.max(mn, c - r);
  const x2 = Math.min(mx, c + r);
  if (x0 >= x2) return;
  const y0 = session.probe(x0);
  if (session.solved) return;
  const y1 = session.samples.get(c) ?? session.probe(c);
  if (session.solved) return;
  const y2 = session.probe(x2);
  if (session.solved) return;
  const peak = parabolicPeak(x0, y0, c, y1, x2, y2, cfg);
  const px = Math.round(Math.max(mn, Math.min(mx, peak)));
  if (px !== c) session.probe(px);
}
function probeRangeAnchors(session, lo, hi) {
  session.probe(Math.round(lo));
  if (session.solved || session.exhausted) return;
  session.probe(Math.round(hi));
  if (session.solved || session.exhausted) return;
  const span = hi - lo;
  if (span < 4) return;
  for (const frac of [0.25, 0.5, 0.75]) {
    session.probe(Math.round(lo + span * frac));
    if (session.solved || session.exhausted) return;
  }
}
function weightedCentroid(session, minAlt) {
  let sumW = 0;
  let sumX = 0;
  for (const [x, alt] of session.samples) {
    if (alt < minAlt) continue;
    sumW += alt;
    sumX += x * alt;
  }
  if (sumW <= 0) return null;
  return Math.round(sumX / sumW);
}
function logWeightedCentroid(session, minAlt) {
  let sumW = 0;
  let sumX = 0;
  for (const [x, alt] of session.samples) {
    if (alt <= minAlt) continue;
    const w = Math.log1p(alt - minAlt);
    sumW += w;
    sumX += x * w;
  }
  if (sumW <= 0) return null;
  return Math.round(sumX / sumW);
}
function blendedCentroid(session, minAlt, cfg) {
  const linear = weightedCentroid(session, minAlt);
  const logc = logWeightedCentroid(session, minAlt);
  if (linear == null && logc == null) return null;
  const w = cfg.centroidLogWeight;
  if (logc == null || w <= 0) return linear;
  if (linear == null || w >= 1) return logc;
  return Math.round(linear * (1 - w) + logc * w);
}
function buildFinals(mn, mx, bestVal, bestAlt, cfg) {
  const span = mx - mn;
  const out = [];
  if (span <= cfg.finalTinySpan) {
    for (let d = 0; d <= span; d++) {
      if (d === 0) {
        if (bestVal >= mn && bestVal <= mx) out.push(bestVal);
        continue;
      }
      for (const sign of [-1, 1]) {
        const c = bestVal + sign * d;
        if (c >= mn && c <= mx) out.push(c);
      }
    }
    return out;
  }
  const nearMainPeak = bestAlt >= cfg.mainPeakDetectAlt;
  const maxRadius = nearMainPeak ? cfg.finalMainRadius : Math.min(cfg.finalSideMaxRadius, Math.max(cfg.finalSideMinRadius, ceilDiv(span, cfg.finalSideSpanDivisor)));
  for (let d = 0; d <= maxRadius; d++) {
    if (d === 0) {
      if (bestVal >= mn && bestVal <= mx) out.push(bestVal);
      continue;
    }
    for (const sign of [-1, 1]) {
      const c = bestVal + sign * d;
      if (c >= mn && c <= mx) out.push(c);
    }
  }
  return out;
}
function tryFinalCandidates(session, mn, mx, cfg) {
  for (const c of buildFinals(mn, mx, session.bestVal, session.bestAlt, cfg)) {
    session.probe(c);
    if (session.solved) return;
  }
}
function tryGaussianPeakEstimate(session, mn, mx, gaussWidth, cfg) {
  if (!cfg.enableGaussianEstimate) return;
  if (session.bestAlt < cfg.gaussEstimateMinAlt) return;
  const height = KOTH_PEAK_HEIGHT * cfg.gaussHeightFraction;
  const ratio = Math.min(session.bestAlt / height, 0.999999);
  if (ratio <= 1e-12) return;
  const offset = gaussWidth * Math.sqrt(-Math.log(ratio));
  const o = Math.max(1, Math.round(offset));
  for (const candidate of [session.bestVal - o, session.bestVal + o]) {
    if (candidate >= mn && candidate <= mx) {
      session.probe(candidate);
      if (session.solved) return;
    }
  }
}
function sweep(session, start, end, step, stopAlt, cfg) {
  if (step <= 0) step = 1;
  let peakX = session.bestVal;
  let peakAlt = session.bestAlt;
  for (let x = start; x <= end; x += step) {
    session.probe(x);
    if (session.solved || session.exhausted) return;
    if (stopAlt != null && session.bestAlt >= stopAlt) return;
    if (cfg != null && peakAlt >= cfg.mainPeakDetectAlt) {
      const xi = Math.round(x);
      if (xi > peakX) {
        const alt = session.samples.get(xi);
        if (alt != null && alt < peakAlt * 0.7 && alt < cfg.clusterDetectAlt) return;
      }
    }
    if (session.bestAlt > peakAlt) {
      peakX = session.bestVal;
      peakAlt = session.bestAlt;
    }
  }
  if (end >= start && end <= session.max && !session.samples.has(end)) {
    session.probe(end);
    if (session.solved || session.exhausted) return;
    if (stopAlt != null && session.bestAlt >= stopAlt) return;
  }
}
function tryTernaryPeakSearch(session, lo, hi, maxIters, widthStop) {
  if (lo >= hi || session.solved || session.exhausted) return;
  const initialWidth = hi - lo;
  const safeWidthStop = Math.max(1, widthStop);
  const minIters = Math.ceil(Math.log(initialWidth / safeWidthStop) / Math.log(1.5));
  const itersBudget = Math.min(64, Math.max(maxIters, minIters));
  let iters = 0;
  while (hi - lo > safeWidthStop && iters < itersBudget && !session.solved && !session.exhausted) {
    const m1 = lo + Math.floor((hi - lo) / 3);
    const m2 = hi - Math.floor((hi - lo) / 3);
    const a1 = session.probe(m1);
    if (session.solved || session.exhausted) return;
    const a2 = session.probe(m2);
    if (session.solved || session.exhausted) return;
    if (a1 < a2) lo = m1;
    else hi = m2;
    iters++;
  }
  const width = hi - lo;
  if (width <= TERNARY_MAX_LINEAR_SCAN) {
    for (let x = lo; x <= hi && !session.solved && !session.exhausted; x++) {
      session.probe(x);
    }
    return;
  }
  sweep(session, lo, hi, Math.max(1, ceilDiv(width, safeWidthStop)), null);
}
function tryExpandFromBest(session, mn, mx, gaussWidth, stopAlt, cfg) {
  if (!cfg.enableExpandFromBest) return;
  let step = 1;
  const maxStep = Math.max(1, ceilDiv(gaussWidth, cfg.expandMaxStepDivisor));
  const mult = Math.max(2, cfg.expandStepMultiplier);
  while (step <= maxStep && !session.solved && !session.exhausted) {
    let improved = false;
    for (const sign of [-1, 1]) {
      const x = session.bestVal + sign * step;
      if (x < mn || x > mx) continue;
      const before = session.bestAlt;
      session.probe(x);
      if (session.solved) return;
      if (session.bestAlt > before) improved = true;
      if (session.bestAlt >= stopAlt) return;
    }
    if (!improved && step > 1) break;
    step = Math.max(1, step * mult);
  }
}
function refinePeakCount(session, hillCount, cfg) {
  if (session.bestAlt >= cfg.mainPeakModeAlt) return cfg.refinePeakCountMain;
  return hillCount;
}
function findHillBySubdivision(session, lo, hi, quickRounds, fullMin, fullMax, hillCount, passwordLength, gaussWidth, cfg) {
  let step = hi - lo;
  for (let round = 0; round < quickRounds && !session.solved && !session.exhausted; round++) {
    const nextStep = Math.max(1, ceilDiv(step, 2));
    if (nextStep >= step) break;
    step = nextStep;
    for (let x = lo + step; x < hi; x += step) {
      session.probe(Math.round(x));
      if (session.solved) return;
    }
    if (session.bestAlt >= cfg.mainPeakModeAlt) return;
    if (!cfg.enableSubdivNarrow) continue;
    if (session.bestAlt >= cfg.clusterDetectAlt) {
      const win = clusterSearchWindow(fullMin, fullMax, session.bestVal, hillCount, passwordLength, cfg);
      lo = Math.max(lo, win.min);
      hi = Math.min(hi, win.max);
    } else if (session.bestAlt > 0) {
      const half = Math.max(step * cfg.subdivNarrowStepFactor, gaussWidth);
      lo = Math.max(lo, session.bestVal - half);
      hi = Math.min(hi, session.bestVal + half);
    }
  }
}
function findHillLinearFallback(session, lo, hi, hillCount, cfg) {
  const span = hi - lo;
  const step = Math.max(1, ceilDiv(span, Math.max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)));
  if (session.bestAlt >= cfg.clusterDetectAlt) {
    sweepOutwardFromBest(session, lo, hi, hillCount, cfg.mainPeakModeAlt, cfg);
  } else {
    sweep(session, lo, hi, step, cfg.mainPeakModeAlt, cfg);
  }
}
function sweepOutwardFromBest(session, lo, hi, hillCount, stopAlt, cfg) {
  const span = hi - lo;
  const step = Math.max(1, ceilDiv(span, Math.max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)));
  const center = session.bestVal;
  if (!session.samples.has(center)) session.probe(center);
  if (session.solved || session.exhausted) return;
  if (session.bestAlt >= stopAlt) return;
  for (let dist = step; dist <= span; dist += step) {
    let probed = 0;
    let flatEdges = 0;
    const beforeBest = session.bestAlt;
    for (const sign of [-1, 1]) {
      const x = center + sign * dist;
      if (x < lo || x > hi) continue;
      probed++;
      session.probe(x);
      if (session.solved || session.exhausted) return;
      if (session.bestAlt >= stopAlt) return;
      const alt = session.samples.get(Math.round(x));
      if (alt != null && alt < cfg.clusterDetectAlt) flatEdges++;
    }
    if (probed === 0) break;
    if (flatEdges >= probed && beforeBest >= cfg.clusterDetectAlt) return;
  }
}
function tryHillClimbFinals(session, searchMin, searchMax, gaussWidth, fullMin, fullMax, cfg) {
  let step = Math.max(1, ceilDiv(gaussWidth, cfg.hillClimbInitialDivisor));
  let x = session.bestVal;
  while (step >= 1 && !session.solved && !session.exhausted) {
    const left = Math.max(searchMin, x - step);
    const right = Math.min(searchMax, x + step);
    const yL = session.probe(left);
    if (session.solved) return;
    const yC = left === right ? yL : session.probe(x);
    if (session.solved) return;
    const yR = session.probe(right);
    if (session.solved) return;
    if (yL > yC) x = left;
    else if (yR > yC) x = right;
    const flat = Math.abs(yL - yC) <= cfg.hillClimbFlatAltDelta && Math.abs(yR - yC) <= cfg.hillClimbFlatAltDelta;
    if (flat || yC >= yL && yC >= yR) {
      const nextStep = Math.max(1, ceilDiv(step, cfg.hillClimbShrink));
      if (nextStep >= step) break;
      step = nextStep;
    }
  }
  tryFinalCandidates(session, fullMin, fullMax, cfg);
}
function tryZoomFinals(session, searchMin, searchMax, fullMin, fullMax, cfg) {
  let step = Math.max(1, ceilDiv(searchMax - searchMin, cfg.zoomInitialDivisor));
  for (let pass = 0; pass < cfg.zoomMaxPasses && !session.solved && !session.exhausted; pass++) {
    const lo = Math.max(searchMin, session.bestVal - step);
    const hi = Math.min(searchMax, session.bestVal + step);
    sweep(session, lo, hi, Math.max(1, ceilDiv(step, cfg.zoomStepDivisor)), null);
    if (session.solved) return;
    tryFinalCandidates(session, fullMin, fullMax, cfg);
    if (session.solved) return;
    const nextStep = Math.max(1, ceilDiv(step, cfg.zoomStepDivisor));
    if (nextStep >= step) break;
    step = nextStep;
  }
}
function refinePeakCandidates(session, searchMin, searchMax, peaks, refineRadius, count, cfg) {
  for (let i = 0; i < Math.min(count, peaks.length); i++) {
    const peak = peaks[i];
    const refined = refinePeak(session, searchMin, searchMax, peak.x, refineRadius, cfg.refineCoarsePasses, cfg);
    if (session.solved) return true;
    refinePeak(
      session,
      searchMin,
      searchMax,
      refined,
      Math.max(1, ceilDiv(refineRadius, cfg.refineRadiusShrink)),
      cfg.refineFinePasses,
      cfg
    );
    if (session.solved) return true;
  }
  return session.solved;
}
function sortedSamples(session) {
  return [...session.samples.entries()].map(([x, alt]) => ({ x, alt })).sort((a, b) => a.x - b.x);
}
function runSolverImprovedCore(session, ctx, cfgIn, options = {}) {
  const cfg = finalizeImprovedConfig(cfgIn);
  const returnSamples = options.returnSamples === true;
  const { min, max, hillCount, passwordLength, gaussWidth } = ctx;
  probeRangeAnchors(session, min, max);
  if (session.solved) {
    return { guesses: session.guesses, solved: true, bestVal: session.bestVal, bestAlt: session.bestAlt };
  }
  findHillBySubdivision(session, min, max, cfg.findHillQuickRounds, min, max, hillCount, passwordLength, gaussWidth, cfg);
  if (!session.solved && session.bestAlt >= cfg.clusterDetectAlt) {
    tryGaussianPeakEstimate(session, min, max, gaussWidth, cfg);
  }
  if (!session.solved && session.bestAlt < cfg.mainPeakDetectAlt) {
    let fallbackLo = min;
    let fallbackHi = max;
    if (session.bestAlt >= cfg.clusterDetectAlt) {
      const win = clusterSearchWindow(min, max, session.bestVal, hillCount, passwordLength, cfg);
      fallbackLo = win.min;
      fallbackHi = win.max;
    }
    findHillLinearFallback(session, fallbackLo, fallbackHi, hillCount, cfg);
  }
  if (session.solved) {
    return { guesses: session.guesses, solved: true, bestVal: session.bestVal, bestAlt: session.bestAlt };
  }
  let search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg);
  let searchSpan = search.max - search.min;
  let coarseStep = Math.max(1, ceilDiv(searchSpan, Math.max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)));
  for (const divisor of cfg.rescanDivisors) {
    if (session.bestAlt >= cfg.centroidMinAlt) break;
    if (session.bestAlt >= cfg.mainPeakModeAlt) break;
    search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg);
    searchSpan = search.max - search.min;
    sweep(session, search.min, search.max, Math.max(1, ceilDiv(searchSpan, divisor)), cfg.mainPeakModeAlt, cfg);
    if (session.solved) return finish();
  }
  search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg);
  searchSpan = search.max - search.min;
  coarseStep = Math.max(1, ceilDiv(searchSpan, Math.max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)));
  {
    const peaks = findLocalPeaks(sortedSamples(session));
    const refineRadius = Math.max(coarseStep, ceilDiv(searchSpan, hillCount * cfg.refineSpanHillDivisor));
    refinePeakCandidates(session, search.min, search.max, peaks, refineRadius, refinePeakCount(session, hillCount, cfg), cfg);
    if (session.solved) return finish();
  }
  if (session.bestAlt < cfg.mainPeakDetectAlt) {
    search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg);
    tryExpandFromBest(session, search.min, search.max, gaussWidth, cfg.mainPeakDetectAlt, cfg);
    if (session.solved) return finish();
    sweep(session, search.min, search.max, Math.max(1, ceilDiv(gaussWidth, cfg.sideHillSweepWidthDivisor)), cfg.mainPeakDetectAlt);
    if (session.solved) return finish();
    const peaks = findLocalPeaks(sortedSamples(session));
    const refineRadius = Math.max(1, gaussWidth);
    refinePeakCandidates(session, search.min, search.max, peaks, refineRadius, refinePeakCount(session, hillCount, cfg), cfg);
    if (session.solved) return finish();
  }
  if (session.bestAlt >= cfg.centroidMinAlt) {
    search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg);
    const centroidMin = session.bestAlt * cfg.centroidAltFraction;
    const centroid = blendedCentroid(session, centroidMin, cfg);
    if (centroid != null) {
      session.probe(centroid);
      if (!session.solved) {
        refinePeak(session, search.min, search.max, centroid, cfg.centroidRefineRadius, cfg.centroidRefinePasses, cfg);
      }
    }
  }
  if (!session.solved) tryFinalCandidates(session, min, max, cfg);
  if (!session.solved && session.bestAlt >= cfg.mainPeakDetectAlt) {
    const climbWindow = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg);
    tryParabolicPinpointMain(session, climbWindow.min, climbWindow.max, gaussWidth, cfg);
    if (!session.solved) tryFinalCandidates(session, min, max, cfg);
    if (cfg.enableTernarySearch) {
      const ternaryIters = Math.min(
        cfg.ternaryMaxItersCap,
        ceilDiv(climbWindow.max - climbWindow.min, Math.max(1, cfg.ternarySpanDivisor))
      );
      tryTernaryPeakSearch(session, climbWindow.min, climbWindow.max, ternaryIters, cfg.ternaryWidthStop);
    }
    if (!session.solved) tryFinalCandidates(session, min, max, cfg);
    if (!session.solved) tryGaussianPeakEstimate(session, climbWindow.min, climbWindow.max, gaussWidth, cfg);
    if (!session.solved) tryFinalCandidates(session, min, max, cfg);
    if (!session.solved) tryHillClimbFinals(session, climbWindow.min, climbWindow.max, gaussWidth, min, max, cfg);
    if (!session.solved && session.bestAlt < cfg.mainPeakModeAlt) {
      tryZoomFinals(session, climbWindow.min, climbWindow.max, min, max, cfg);
    }
    if (!session.solved) tryFinalCandidates(session, min, max, cfg);
  }
  return finish();
  function finish() {
    const result = {
      guesses: session.guesses,
      solved: session.solved,
      bestVal: session.bestVal,
      bestAlt: session.bestAlt
    };
    if (returnSamples) result.samples = session.samples;
    return result;
  }
}
function createAuthProbeSession(min, max, auth) {
  const samples = /* @__PURE__ */ new Map();
  const session = {
    min,
    max,
    guesses: 0,
    solved: false,
    exhausted: false,
    bestVal: min,
    bestAlt: -1,
    samples,
    probe(x) {
      if (session.exhausted || session.solved) return 0;
      const xi = Math.round(x);
      if (xi < min || xi > max) return 0;
      if (samples.has(xi)) return samples.get(xi);
      if (session.guesses >= SOLVER_MAX_PROBES) {
        session.exhausted = true;
        return 0;
      }
      session.guesses++;
      const result = auth(String(xi));
      if (result.success) {
        session.solved = true;
        return Infinity;
      }
      const alt = parseKingOfTheHillAltitude(result.feedback, result.message) ?? -1;
      samples.set(xi, alt);
      if (alt > session.bestAlt) {
        session.bestAlt = alt;
        session.bestVal = xi;
      }
      return alt;
    }
  };
  return session;
}
function runSolverImproved(assignment, options) {
  const cfg = finalizeImprovedConfig(options.improvedConfig ?? TUNED_MAX_CONFIG);
  const min = 10 ** (assignment.passwordLength - 1);
  const max = 10 ** assignment.passwordLength - 1;
  const ctx = {
    min,
    max,
    hillCount: kingOfTheHillHillCount(assignment.difficulty),
    passwordLength: assignment.passwordLength,
    gaussWidth: kingOfTheHillGaussianWidth(assignment.passwordLength)
  };
  const session = createAuthProbeSession(min, max, options.auth);
  return runSolverImprovedCore(session, ctx, cfg, { returnSamples: options.returnSamples === true });
}

// tests/kingOfTheHillCore.ts
var getDefaultImprovedConfig = () => getTunedImprovedConfig("max");
var NUMBERS = "0123456789";
var MAX_PASSWORD_LENGTH = 50;
var DEFAULT_DIFFICULTY = 60;
var DEFAULT_COUNT = 10;
var DEFAULT_SEED = 1265595496;
var KING_MAIN_PEAK_ALTITUDE = 7500;
var KOTH_NEAR_ZONE_FRACTION = 0.03;
var KOTH_LOCATION_JITTER_SCALE = 0.2;
var KOTH_LOCATION_JITTER_BASE = 0.9;
var KOTH_HEIGHT_OFFSET_BASE = 2600;
var KOTH_HEIGHT_JITTER_SCALE = 0.1;
var KOTH_HEIGHT_JITTER_BASE = 0.95;
var ASSIGNMENT_PASSWORD_LENGTH_DIVISOR = 6;
var ASSIGNMENT_PASSWORD_LENGTH_CAP = 10;
var ASSIGNMENT_SEED_STRIDE = 9973;
var ASSIGNMENT_MAX_SAFE_PASSWORD_DIGITS = 15;
var PROFILE_DEFAULT_POINT_COUNT = 800;
var WHRNG = class {
  constructor(totalPlaytime) {
    __publicField(this, "s1");
    __publicField(this, "s2");
    __publicField(this, "s3");
    const v = totalPlaytime / 1e3 % 3e4;
    this.s1 = v;
    this.s2 = v;
    this.s3 = v;
  }
  step() {
    this.s1 = 171 * this.s1 % 30269;
    this.s2 = 172 * this.s2 % 30307;
    this.s3 = 170 * this.s3 % 30323;
  }
  random() {
    this.step();
    return (this.s1 / 30269 + this.s2 / 30307 + this.s3 / 30323) % 1;
  }
};
function getAltitudeGivenHillSpecs(x, location, height, width) {
  return height * Math.exp((x - location) ** 2 / width ** 2 * -1);
}
function getKingOfTheHillAltitude(server, attemptedPassword) {
  const password = Number(server.password);
  const x = Number(attemptedPassword);
  const rng = new WHRNG(password);
  const hillCount = Math.min(Math.floor(server.difficulty / KOTH_HILL_DIFFICULTY_DIVISOR), KOTH_HILL_DIFFICULTY_CAP) * 2 + 1;
  const passwordHillIndex = Math.floor(rng.random() * (hillCount - 2)) + 1;
  const width = 10 ** Math.max(server.password.length - KOTH_GAUSS_WIDTH_LENGTH_OFFSET, 0) + KOTH_GAUSS_WIDTH_PLUS;
  if (Math.abs((x - password) / password) < KOTH_NEAR_ZONE_FRACTION) {
    return getAltitudeGivenHillSpecs(x, password, KOTH_PEAK_HEIGHT, width);
  }
  let altitude = 0;
  for (let i = 0; i < hillCount; i++) {
    const locationOffset = (i - passwordHillIndex) * width * KOTH_HILL_SPACING_WIDTHS * (rng.random() * KOTH_LOCATION_JITTER_SCALE + KOTH_LOCATION_JITTER_BASE);
    const heightOffset = Math.abs((i - passwordHillIndex) * KOTH_HEIGHT_OFFSET_BASE) * (rng.random() * KOTH_HEIGHT_JITTER_SCALE + KOTH_HEIGHT_JITTER_BASE);
    altitude += getAltitudeGivenHillSpecs(x, password + locationOffset, KOTH_PEAK_HEIGHT - heightOffset, width);
  }
  return altitude;
}
function authKingOfTheHill(server, attemptedPassword) {
  if (server.password === attemptedPassword) {
    return { success: true };
  }
  const altitude = getKingOfTheHillAltitude(server, attemptedPassword);
  const message = `current altitude: ${altitude.toFixed(5)} m; highest peak: ${KOTH_PEAK_HEIGHT.toLocaleString()} m`;
  return { success: false, feedback: `${altitude}`, message };
}
function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function getPasswordSeeded(length, rng, allowLetters = false) {
  const characters = NUMBERS + (allowLetters ? "" : "");
  let password = "";
  const cappedLength = clampNumber(length, 1, MAX_PASSWORD_LENGTH);
  for (let i = 0; i < cappedLength; i++) {
    password += characters[Math.floor(rng() * characters.length)];
  }
  if (!allowLetters && Number(password) > Number.MAX_SAFE_INTEGER) {
    password = password.slice(0, ASSIGNMENT_MAX_SAFE_PASSWORD_DIGITS);
  }
  if (!allowLetters) {
    return Number(password).toString();
  }
  return password;
}
function buildAssignment(difficulty, rng) {
  const passwordLength = Math.min(1 + difficulty / ASSIGNMENT_PASSWORD_LENGTH_DIVISOR, ASSIGNMENT_PASSWORD_LENGTH_CAP);
  const password = getPasswordSeeded(passwordLength, rng, false);
  return {
    difficulty,
    password,
    passwordLength: password.length,
    modelId: "globalMaxima",
    staticPasswordHint: "Ascend the highest mountain!"
  };
}
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = state + 1831565813 >>> 0;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function assignmentNumericRange(assignment) {
  const min = 10 ** (assignment.passwordLength - 1);
  const max = 10 ** assignment.passwordLength - 1;
  return { min, max };
}
function toServer(assignment) {
  return { password: assignment.password, difficulty: assignment.difficulty };
}
function sampleAltitudeProfile(assignment, options = {}) {
  const pointCount = options.pointCount ?? PROFILE_DEFAULT_POINT_COUNT;
  const password = Number(assignment.password);
  const { min, max } = assignmentNumericRange(assignment);
  const server = toServer(assignment);
  const start = min;
  const end = max;
  const step = Math.max(1, Math.ceil((end - start) / pointCount));
  const points = [];
  for (let x = start; x <= end; x += step) {
    points.push({
      x,
      altitude: getKingOfTheHillAltitude(server, String(x)),
      nearZone: Math.abs((x - password) / password) < KOTH_NEAR_ZONE_FRACTION
    });
  }
  const last = points[points.length - 1];
  if (!last || last.x !== end) {
    points.push({
      x: end,
      altitude: getKingOfTheHillAltitude(server, String(end)),
      nearZone: Math.abs((end - password) / password) < KOTH_NEAR_ZONE_FRACTION
    });
  }
  return { points, password, min, max, start, end };
}
function generateAssignmentByPoolIndex(seed, poolIndex, difficulty) {
  const i = poolIndex - 1;
  const rng = mulberry32(seed + i * ASSIGNMENT_SEED_STRIDE >>> 0);
  return buildAssignment(difficulty, rng);
}
function generateAssignments(seed, count, difficulty) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const rng = mulberry32(seed + i * ASSIGNMENT_SEED_STRIDE >>> 0);
    rows.push({ index: i + 1, assignment: buildAssignment(difficulty, rng) });
  }
  return rows;
}
function runSolver(assignment, options = {}) {
  return runSolverImproved2(assignment, options);
}
function kingOfTheHillClusterHalfWidth(hillCount, passwordLength, clusterMargin = getDefaultImprovedConfig().clusterMargin) {
  const width = kingOfTheHillGaussianWidth(passwordLength);
  return Math.ceil((hillCount - 1) * width * KOTH_HILL_SPACING_WIDTHS * clusterMargin);
}
function runSolverImproved2(assignment, options = {}) {
  const server = toServer(assignment);
  const improvedConfig = options.improvedConfig ?? getTunedImprovedConfig(options.objective ?? "max");
  const raw = runSolverImproved(assignment, {
    improvedConfig,
    auth: (guess) => authKingOfTheHill(server, guess),
    returnSamples: options.returnSamples === true
  });
  const result = {
    guesses: raw.guesses,
    solved: raw.solved,
    bestVal: raw.bestVal,
    bestAlt: raw.bestAlt >= 0 ? raw.bestAlt : null
  };
  if (options.returnSamples && raw.samples) {
    result.probes = [...raw.samples.entries()].map(([x, alt]) => ({ x, alt }));
  }
  return result;
}
function improvedConfigFitness({
  objective = "avg",
  unsolved,
  totalGuesses = 0,
  maxGuesses = 0
}) {
  return computeImprovedFitness(objective, unsolved, totalGuesses, maxGuesses);
}
function evaluateImprovedConfig(assignments, configOverrides = {}, objective = "avg") {
  const base = objective === "avg" ? TUNED_AVG_CONFIG : TUNED_MAX_CONFIG;
  const cfg = finalizeImprovedConfig({ ...base, ...configOverrides });
  let totalGuesses = 0;
  let solved = 0;
  let maxGuesses = 0;
  let minGuesses = Infinity;
  const failed = [];
  for (let i = 0; i < assignments.length; i++) {
    const result = runSolverImproved2(assignments[i], { improvedConfig: cfg, objective });
    if (result.solved) {
      solved++;
      totalGuesses += result.guesses;
      maxGuesses = Math.max(maxGuesses, result.guesses);
      minGuesses = Math.min(minGuesses, result.guesses);
    } else {
      failed.push(i + 1);
    }
  }
  const count = assignments.length;
  const unsolved = count - solved;
  return {
    config: cfg,
    solved,
    total: count,
    unsolved,
    failed,
    totalGuesses: unsolved > 0 ? null : totalGuesses,
    avgGuesses: unsolved > 0 ? null : totalGuesses / count,
    maxGuesses: unsolved > 0 ? null : maxGuesses,
    minGuesses: unsolved > 0 ? null : minGuesses,
    fitness: improvedConfigFitness({ objective, unsolved, totalGuesses, maxGuesses })
  };
}
function verifyTunedConfigBenchmark(objective = "max") {
  const benchmark = getTunedBenchmark(objective);
  const cfg = getTunedImprovedConfig(objective);
  const result = {
    ok: false,
    objective,
    benchmark,
    checked: 0,
    mismatches: [],
    jsMaxGuesses: null,
    jsAvgGuesses: null,
    jsonMaxGuesses: null,
    jsonAvgGuesses: null
  };
  if (benchmark == null) return result;
  let totalGuesses = 0;
  let maxGuesses = 0;
  let solved = 0;
  for (const row of benchmark.assignments) {
    result.checked++;
    const assignment = generateAssignmentByPoolIndex(benchmark.seed, row.index, benchmark.difficulty);
    const password = assignment.password;
    const mainPeak = Number(password);
    if (password !== row.password) {
      result.mismatches.push({ index: row.index, field: "password", expected: row.password, actual: password });
    }
    if (mainPeak !== row.mainPeak) {
      result.mismatches.push({ index: row.index, field: "mainPeak", expected: row.mainPeak, actual: mainPeak });
    }
    const run = runSolverImproved2(assignment, { improvedConfig: cfg, objective });
    if (run.guesses !== row.guesses) {
      result.mismatches.push({ index: row.index, field: "guesses", expected: row.guesses, actual: run.guesses });
    }
    if (run.solved !== row.solved) {
      result.mismatches.push({ index: row.index, field: "solved", expected: row.solved, actual: run.solved });
    }
    if (run.solved) {
      solved++;
      totalGuesses += run.guesses;
      maxGuesses = Math.max(maxGuesses, run.guesses);
    }
  }
  result.jsMaxGuesses = solved === benchmark.assignments.length ? maxGuesses : null;
  result.jsAvgGuesses = solved === benchmark.assignments.length ? totalGuesses / solved : null;
  result.jsonMaxGuesses = benchmark.assignments.reduce(
    (m, row) => row.solved ? Math.max(m, row.guesses) : m,
    0
  );
  const solvedRows = benchmark.assignments.filter((row) => row.solved);
  result.jsonAvgGuesses = solvedRows.length > 0 ? solvedRows.reduce((sum, row) => sum + row.guesses, 0) / solvedRows.length : null;
  result.ok = result.mismatches.length === 0;
  return result;
}
export {
  ASSIGNMENT_MAX_SAFE_PASSWORD_DIGITS,
  ASSIGNMENT_PASSWORD_LENGTH_CAP,
  ASSIGNMENT_PASSWORD_LENGTH_DIVISOR,
  ASSIGNMENT_SEED_STRIDE,
  DEFAULT_COUNT,
  DEFAULT_DIFFICULTY,
  DEFAULT_SEED,
  KING_MAIN_PEAK_ALTITUDE,
  KOTH_HEIGHT_JITTER_BASE,
  KOTH_HEIGHT_JITTER_SCALE,
  KOTH_HEIGHT_OFFSET_BASE,
  KOTH_HILL_SPACING_WIDTHS,
  KOTH_LOCATION_JITTER_BASE,
  KOTH_LOCATION_JITTER_SCALE,
  KOTH_NEAR_ZONE_FRACTION,
  KOTH_PEAK_HEIGHT,
  MAX_PASSWORD_LENGTH,
  NUMBERS,
  PROFILE_DEFAULT_POINT_COUNT,
  TUNED_AVG_CONFIG,
  TUNED_MAX_CONFIG,
  assignmentNumericRange,
  authKingOfTheHill,
  buildAssignment,
  computeImprovedFitness,
  evaluateImprovedConfig,
  finalizeImprovedConfig,
  generateAssignmentByPoolIndex,
  generateAssignments,
  getDefaultImprovedConfig,
  getKingOfTheHillAltitude,
  getPasswordSeeded,
  getTunedBenchmark,
  getTunedImprovedConfig,
  improvedConfigFitness,
  kingOfTheHillClusterHalfWidth,
  kingOfTheHillGaussianWidth,
  kingOfTheHillHillCount,
  mulberry32,
  runSolver,
  runSolverImproved2 as runSolverImproved,
  sampleAltitudeProfile,
  toServer,
  verifyTunedConfigBenchmark
};
