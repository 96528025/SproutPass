// tile_path — 16x16 seamless dirt path: path tan with cream pebbles and dithered ruts.
// legend — t=path c=cream p=paper G=grass-dark
import { grid, type Legend } from "../lib";

const L: Legend = { t: "path", c: "cream", p: "paper", G: "grass-dark" };

export const frames = [
  grid(
    [
      "tttttttttttttttt",
      "ttcctttttttttctt",
      "ttcptttttttttttt",
      "tttttttttGtttttt",
      "ttttttttttttttct",
      "tttttctttttttttt",
      "ttttcpcttttttttt",
      "ttttttttttcctttt",
      "tttttttttttcpttt",
      "tttctttttttttttt",
      "ttcpttttttttcttt",
      "tttttttttttcpctt",
      "tttttttttGtttttt",
      "ttttttcctttttttt",
      "ttttttcpttttcctt",
      "ttttttttttttttpt",
    ],
    L, "tile_path",
  ),
];
