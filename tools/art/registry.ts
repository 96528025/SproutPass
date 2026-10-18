// Every sprite the build knows about. Frame order inside a strip is fixed by the A-team contract.
import type { Img } from "./lib";
import * as parent_a from "./sprites/parent_a";
import * as tile_grass from "./sprites/tile_grass";
import * as tile_path from "./sprites/tile_path";

export interface Sheet { name: string; frame: 16 | 32; frames: Img[] }
export interface Icon { name: string; img: Img }

const sheet = (name: string, frame: 16 | 32, m: { frames: Img[] }): Sheet => ({ name, frame, frames: m.frames });

export const SHEETS: Sheet[] = [
  sheet("parent_a", 32, parent_a),
  sheet("tile_grass", 16, tile_grass),
  sheet("tile_path", 16, tile_path),
];

export const ICONS: Icon[] = [];
