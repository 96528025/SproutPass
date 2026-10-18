// alert_bubble — 16x16 speech bubble with a red "!". legend — .=clear k=ink W=white r=red
import { grid, type Legend } from "../lib";
const L: Legend = { k: "ink", W: "white", r: "red" };
export const frames = [
  grid(
    [
      "................",
      "...kkkkkkkkkk...",
      "..kWWWWWWWWWWk..",
      ".kWWWWWrrWWWWWk.",
      ".kWWWWWrrWWWWWk.",
      ".kWWWWWrrWWWWWk.",
      ".kWWWWWrrWWWWWk.",
      ".kWWWWWWWWWWWWk.",
      ".kWWWWWrrWWWWWk.",
      ".kWWWWWrrWWWWWk.",
      "..kWWWWWWWWWWk..",
      "...kkkWWkkkkk...",
      "......kWk.......",
      ".......k........",
      "................",
      "................",
    ],
    L, "alert_bubble",
  ),
];
