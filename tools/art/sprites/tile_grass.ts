// tile_grass — 16x16 seamless lawn tile: grass with grass-dark tufts and a few mint flecks.
// legend — g=grass G=grass-dark m=mint
import { grid, type Legend } from "../lib";

const L: Legend = { g: "grass", G: "grass-dark", m: "mint" };

export const frames = [
  grid(
    [
      "gggggggggggggggg",
      "ggggGgggggggmggg",
      "gggGGGgggggggggg",
      "ggggggggggGggggg",
      "gmgggggggGGGgggg",
      "ggggggggggggggGg",
      "gggggGgggggggGGG",
      "ggggGGGggggggggg",
      "gggggggggmggggGg",
      "gGggggggggggggGG",
      "GGGgggggGggggggg",
      "ggggggggGGGggggg",
      "gggggmggggggggGg",
      "gggggggggggggGGG",
      "ggGgggggGgggggGg",
      "gGGGgggGGGgggggg",
    ],
    L, "tile_grass",
  ),
];
