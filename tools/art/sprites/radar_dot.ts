// radar_dot — 16x16 mint blip with a white glint and a dithered halo. legend — .=clear k=ink m=mint W=white
import { grid, type Legend } from "../lib";
const L: Legend = { k: "ink", m: "mint", W: "white" };
export const frames = [
  grid(
    [
      "................",
      "................",
      "........m.......",
      "......kkkk......",
      ".....kmmmmk.....",
      "....kmWWmmmk....",
      "...mkmWmmmmkm...",
      "....kmmmmmmk....",
      "....kmmmmmmk....",
      ".....kmmmmk.....",
      "......kkkk......",
      "........m.......",
      "................",
      "................",
      "................",
      "................",
    ],
    L, "radar_dot",
  ),
];
