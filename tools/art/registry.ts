// Every sprite the build knows about. Frame order inside a strip is fixed by the A-team contract.
import type { Img } from "./lib";
import * as parent_a from "./sprites/parent_a";
import * as parent_b from "./sprites/parent_b";
import * as parent_c from "./sprites/parent_c";
import * as pet_a from "./sprites/pet_a";
import * as pet_b from "./sprites/pet_b";
import * as pet_c from "./sprites/pet_c";
import * as tile_grass from "./sprites/tile_grass";
import * as tile_path from "./sprites/tile_path";

import * as alert_bubble from "./sprites/alert_bubble";
import * as radar_dot from "./sprites/radar_dot";
import * as fx_flower from "./sprites/fx_flower";
import * as fx_petal from "./sprites/fx_petal";
import * as fx_sparkle from "./sprites/fx_sparkle";
import * as ui_heart_full from "./sprites/ui_heart_full";
import * as ui_heart_empty from "./sprites/ui_heart_empty";
import * as ui_coin from "./sprites/ui_coin";
import * as ui_cursor from "./sprites/ui_cursor";
import * as prop_bench from "./sprites/prop_bench";
import * as prop_tree from "./sprites/prop_tree";
import * as tile_flowerbed from "./sprites/tile_flowerbed";

export interface Sheet { name: string; frame: 16 | 32; frames: Img[] }
export interface Icon { name: string; img: Img }

const sheet = (name: string, frame: 16 | 32, m: { frames: Img[] }): Sheet => ({ name, frame, frames: m.frames });

export const SHEETS: Sheet[] = [
  sheet("parent_a", 32, parent_a),
  sheet("parent_b", 32, parent_b),
  sheet("parent_c", 32, parent_c),
  sheet("pet_a", 16, pet_a),
  sheet("pet_b", 16, pet_b),
  sheet("pet_c", 16, pet_c),
  sheet("tile_grass", 16, tile_grass),
  sheet("tile_path", 16, tile_path),
  sheet("alert_bubble", 16, alert_bubble),
  sheet("radar_dot", 16, radar_dot),
  sheet("fx_flower", 16, fx_flower),
  sheet("fx_petal", 16, fx_petal),
  sheet("fx_sparkle", 16, fx_sparkle),
  sheet("ui_heart_full", 16, ui_heart_full),
  sheet("ui_heart_empty", 16, ui_heart_empty),
  sheet("ui_coin", 16, ui_coin),
  sheet("ui_cursor", 16, ui_cursor),
  sheet("prop_bench", 16, prop_bench),
  sheet("prop_tree", 32, prop_tree),
  sheet("tile_flowerbed", 16, tile_flowerbed),
];

export const ICONS: Icon[] = [];
