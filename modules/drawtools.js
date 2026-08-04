"use strict";

const graph = require("./graph");

const TILE_SIZE = 40;
const PAD = 1;		// Board offset from the canvas edge. Tiles are inset 1px on every side, so this
					// makes the edge gap 2px -- the same as the internal lines between tiles.
const TEXT_PAD = 4;	// Farmbox text inset, no longer tied to the (now tiny) canvas pad.

// The dark and light colours. The canvas and everything on it (tiles, letters, rings,
// unit circles, yield counts) stays dark in both themes -- those colours are all
// calibrated against the dark canvas -- so really only the body and text change.
// The body and text entries are applied to document.body by set_dark().

const CROP_COLOURS_DARK = {
	WHEAT:      "#ddcc66",
	CARROT:     "#ee8833",
	TOMATO:     "#ee8833",
	STRAWBERRY: "#eebbbb",
	MELON:      "#55bb77",
};

const CROP_COLOURS_LIGHT = {
	WHEAT:      "#ddcc66",
	CARROT:     "#ee8833",
	TOMATO:     "#ee8833",
	STRAWBERRY: "#eebbbb",
	MELON:      "#55bb77",
};

const BG_COLOURS_DARK = {
	body:    "#1f1f1f",
	canvas:  "#1f1f1f",
	locked:  "#181818",
	soil:    "#5a4023",
	plant:   "#2f5d31",
	coop:    "#7b6144",
	pasture: "#5c6e46",
	text:    "#efefef",
	failure: "#ff8fb3",
	warning: "#ffe066",
};

const BG_COLOURS_LIGHT = {
	body:    "#e8e4dc",
	canvas:  "#1f1f1f",
	locked:  "#d2ccc2",
	soil:    "#5a4023",
	plant:   "#2f5d31",
	coop:    "#7b6144",
	pasture: "#5c6e46",
	text:    "#26221c",
	failure: "#c00050",
	warning: "#806400",
};

// What each town shop consumes is not declared in the replay, so this is copied from
// the game runner's SHOPS dict. Single-product shops consume double per tick.

const SHOPS = {
	BAKERY:         ["EGG", "WHEAT"],
	PIZZA_SHOP:     ["MILK", "TOMATO", "WHEAT"],
	BRUNCH_SPOT:    ["EGG", "WHEAT", "STRAWBERRY"],
	YARN_STORE:     ["WOOL"],
	ICE_CREAM_SHOP: ["STRAWBERRY", "MILK", "WHEAT"],
	PET_CAFE:       ["CARROT"],
	SMOOTHIE_SHOP:  ["STRAWBERRY", "MILK"],
	FARMERS_MARKET: ["WHEAT", "CARROT", "TOMATO", "STRAWBERRY"],
};

// The town center consumes every product except FERTILIZER, with a demand multiplier
// stepping up by day (also copied from the runner; highest threshold first).

const TOWN_CENTER_DEMAND_SCHEDULE = [[20, 4], [10, 2], [0, 1]];

// Animal parameters, in days-of-age; also copied from the runner. Base production
// accrues on schedule regardless of feeding -- feeding only prevents escape (2
// consecutive unfed days) and enables the care bonus. No decay or expiry.

const ANIMALS = {
	GOOSE: {product: "EGG",  first_yield_day: 4, interval: 1, max_held: 4},
	COW:   {product: "MILK", first_yield_day: 8, interval: 2, max_held: 6},
	SHEEP: {product: "WOOL", first_yield_day: 6, interval: 3, max_held: 6},
};

// Crop lifecycle parameters, in days-of-age; likewise copied from the runner. One-shot
// crops gain yield when watered between (max_yield_day + 1) // 2 and max_yield_day;
// ongoing crops produce every `interval` days from first_yield_day.

const CROPS = {
	WHEAT:      {first_yield_day: 2,  max_yield_day: 4,  interval: 0, max_yield: 6, ongoing: false},
	CARROT:     {first_yield_day: 2,  max_yield_day: 3,  interval: 0, max_yield: 4, ongoing: false},
	TOMATO:     {first_yield_day: 8,  max_yield_day: 8,  interval: 1, max_yield: 4, ongoing: true},
	STRAWBERRY: {first_yield_day: 10, max_yield_day: 10, interval: 2, max_yield: 4, ongoing: true},
	MELON:      {first_yield_day: 10, max_yield_day: 12, interval: 0, max_yield: 6, ongoing: false},
};

const MARKET_OPS = ["HIRE", "BUY_LAND", "BUY_SEED", "BUY_ANIMAL", "BUY_PRODUCT", "SELL"];

// ------------------------------------------------------------------------------------------------

function draw(replay, index, selection, hover, swap) {		// selection: see hub.click(). hover: {player, x, y} or null.

	let statusbox = document.getElementById("statusbox");
	let farmcols = document.getElementById("farmcols");

	if (!replay) {
		statusbox.textContent = "";
		farmcols.textContent = "";			// Also deletes the per-player columns.
		draw_tile_info(null, 0, 0, 0, 0);	// Clears.
		graph.draw(null, 0);				// Clears. (The graph superseded draw_market_info, kept below unused.)
		return;
	}

	let bs = replay.board_size();
	let players = replay.num_players();
	let board_px = bs * TILE_SIZE;
	let canvas_px = PAD * 2 + board_px;

	// One column per player, each holding its own canvas and info div...

	while (farmcols.children.length > players) {
		farmcols.removeChild(farmcols.lastChild);
	}
	while (farmcols.children.length < players) {
		let col = document.createElement("div");
		col.classList.add("farmcol");
		let cv = document.createElement("canvas");
		let d = document.createElement("div");
		d.classList.add("farmbox");
		col.appendChild(cv);
		col.appendChild(d);
		farmcols.appendChild(col);
	}

	let day = replay.day(index);
	let market_results = replay.next_market_results(index);

	for (let n = 0; n < players; n++) {

		let pl = swap ? players - 1 - n : n;	// Swap reverses which player is drawn in which column.

		let col = farmcols.children[n];
		let cv = col.children[0];
		cv.dataset.player = `${pl}`;			// Lets tile_at_point identify the clicked board, respecting any swap.
		let ctx = cv.getContext("2d");

		if (cv.width !== canvas_px || cv.height !== canvas_px) {
			cv.width = canvas_px;
			cv.height = canvas_px;
			col.style.width = `${canvas_px}px`;		// Pin the column too, else long farmbox lines widen it instead of wrapping.
		}

		ctx.fillStyle = (config.dark_mode ? BG_COLOURS_DARK : BG_COLOURS_LIGHT).canvas;
		ctx.fillRect(0, 0, cv.width, cv.height);

		draw_board(ctx, replay.tiles(index, pl), bs, day, PAD, PAD);
		draw_units(ctx, replay.units(index, pl), replay.unit_moves(index, pl),
			replay.inventories(index, pl), PAD, PAD);

		let hl = null;										// The highlighted tile for this player, if any. For a
		if (selection && selection.player === pl) {			// unit selection this follows the unit around the board.
			if (selection.type === "tile") {
				hl = [selection.x, selection.y];
			} else if (selection.type === "unit") {
				let units = replay.units(index, pl);
				if (Number.isInteger(selection.id) && selection.id >= 0 && selection.id < units.length) {
					hl = units[selection.id];
				}
			}
		}

		if (hl && hl[0] >= 0 && hl[0] < bs && hl[1] >= 0 && hl[1] < bs) {
			ctx.strokeStyle = "#ffffff";
			ctx.lineWidth = 2;
			ctx.strokeRect(PAD + hl[0] * TILE_SIZE, PAD + hl[1] * TILE_SIZE, TILE_SIZE, TILE_SIZE);		// The 2px stroke straddles the cell
		}																								// boundary, consuming the gridlines.

		draw_player_info(replay, index, pl, col.children[1], market_results[pl] || []);
	}

	if (selection && selection.type === "tile" && selection.player >= 0 && selection.player < players) {
		draw_tile_info(replay, index, selection.player, selection.x, selection.y);
	} else if (selection && selection.type === "unit" && selection.player >= 0 && selection.player < players) {
		draw_unit_info(replay, index, selection.player, selection.id);
	} else if (hover && hover.player >= 0 && hover.player < players) {
		draw_tile_info(replay, index, hover.player, hover.x, hover.y, "Mouseover:");
	} else {
		draw_tile_info(null, 0, 0, 0, 0);	// Clears.
	}

	statusbox.textContent = `Step ${index} / ${replay.length()}\nDay ${day}, Hour ${replay.hour(index)}`;

	graph.draw(replay, index);				// The graph superseded draw_market_info, kept below unused.
}

// ------------------------------------------------------------------------------------------------

function draw_board(ctx, tiles, bs, day, ox, oy) {
	for (let y = 0; y < bs; y++) {
		for (let x = 0; x < bs; x++) {
			draw_tile(ctx, tiles[y][x], day, ox + x * TILE_SIZE, oy + y * TILE_SIZE);
		}
	}
}

function draw_tile(ctx, tile, day, px, py) {

	let bg = (config.dark_mode ? BG_COLOURS_DARK : BG_COLOURS_LIGHT).soil;
	let letter = "";
	let letter_colour = "#efefef";
	let yield_units = 0;
	let blue_ring = false;			// Watered (plants) or fed (animals).
	let green_ring = false;			// Fertilized (plants) or cared for (animals).
	let fert_square = false;		// Animal-produced fertilizer waiting to be collected.

	if (tile === "LOCKED") {
		bg = (config.dark_mode ? BG_COLOURS_DARK : BG_COLOURS_LIGHT).locked;
	} else if (tile !== null) {
		if (tile.kind === "WEED") {
			letter = "x";
			letter_colour = "#7a8b4a";
		} else if (tile.kind === "PLANT") {
			bg = (config.dark_mode ? BG_COLOURS_DARK : BG_COLOURS_LIGHT).plant;
			letter = tile.crop[0].toLowerCase();
			letter_colour = (config.dark_mode ? CROP_COLOURS_DARK : CROP_COLOURS_LIGHT)[tile.crop] || "#efefef";
			yield_units = tile.yield_units;
			blue_ring = tile.watered_today;
			green_ring = tile.fertilized_until_day >= day;
		} else if (tile.animal) {
			bg = (config.dark_mode ? BG_COLOURS_DARK : BG_COLOURS_LIGHT)[tile.kind === "COOP" ? "coop" : "pasture"];
			letter = tile.animal[0];
			yield_units = tile.yield_units;
			blue_ring = tile.fed_today;
			green_ring = tile.cared_today;
			fert_square = tile.fertilizer_available;
		} else if (tile.kind === "COOP" || tile.kind === "PASTURE") {
			bg = (config.dark_mode ? BG_COLOURS_DARK : BG_COLOURS_LIGHT)[tile.kind === "COOP" ? "coop" : "pasture"];
			letter = tile.kind[0].toLowerCase();
			letter_colour = "#999999";
		}
	}

	ctx.fillStyle = bg;
	ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);

	if (blue_ring || green_ring) {

		// Blue always paints the top and right edges, green the left and bottom, each
		// drawn only when its state applies -- so a half-ring means one thing was done.

		let x0 = px + 2;
		let y0 = py + 2;
		let x1 = px + TILE_SIZE - 2;
		let y1 = py + TILE_SIZE - 2;

		ctx.lineWidth = 2;

		if (blue_ring) {
			ctx.strokeStyle = "#5ab4e0";
			ctx.beginPath();
			ctx.moveTo(x0, y0);
			ctx.lineTo(x1, y0);
			ctx.lineTo(x1, y1);
			ctx.stroke();
		}
		if (green_ring) {
			ctx.strokeStyle = "#55bb77";
			ctx.beginPath();
			ctx.moveTo(x0, y0);
			ctx.lineTo(x0, y1);
			ctx.lineTo(x1, y1);
			ctx.stroke();
		}
	}

	if (letter) {
		ctx.font = `bold ${Math.floor(TILE_SIZE * 0.5)}px Consolas, monospace`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillStyle = letter_colour;
		ctx.fillText(letter, px + TILE_SIZE / 2, py + TILE_SIZE / 2 + 1);
	}

	if (yield_units > 0) {
		ctx.font = "10px Consolas, monospace";
		ctx.textAlign = "right";
		ctx.textBaseline = "bottom";
		ctx.fillStyle = "#ffffff";
		ctx.fillText(`${yield_units}`, px + TILE_SIZE - 3, py + TILE_SIZE - 2);
	}

	if (fert_square) {
		ctx.fillStyle = "#55bb77";		// Bottom-left corner, inset 4px so it clears the 2px rings.
		ctx.fillRect(px + 4, py + TILE_SIZE - 10, 6, 6);
	}
}

function draw_units(ctx, units, moves, inventories, ox, oy) {

	// Units on the same tile are offset into a small cluster so all remain visible.
	// A unit about to move is drawn as a triangle pointing its way instead of a circle.
	// Centre comes last so the tile's letter stays uncovered when possible.

	const offsets = [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22], [0, 0]];

	let seen_at = {};

	for (let n = 0; n < units.length; n++) {
		let [x, y] = units[n];
		let key = `${x},${y}`;
		let stack = seen_at[key] || 0;
		seen_at[key] = stack + 1;
		let [dx, dy] = offsets[stack % offsets.length];
		let cx = ox + (x + 0.5 + dx) * TILE_SIZE;
		let cy = oy + (y + 0.5 + dy) * TILE_SIZE;
		let radius = TILE_SIZE * 0.14;
		let carrying = Object.values(inventories[n] || {}).some(count => count > 0);
		ctx.beginPath();
		if (moves[n]) {
			unit_triangle_path(ctx, cx, cy, moves[n][0], moves[n][1], radius);
		} else {
			ctx.arc(cx, cy, radius, 0, Math.PI * 2);
		}
		ctx.fillStyle = carrying ? "#9edcf5" : "#f0f0f0";
		ctx.fill();
		ctx.strokeStyle = "#222222";
		ctx.lineWidth = 1.5;
		ctx.stroke();
	}
}

function unit_triangle_path(ctx, cx, cy, dx, dy, r) {

	// An equilateral triangle pointing in (dx, dy), sized to have the same area as the
	// radius-r circle a stationary unit gets: pi * r^2 == (3 * sqrt(3) / 4) * R^2 for
	// circumradius R, giving R == r * 1.5551.

	let R = r * 1.5551;
	let px = -dy;		// Perpendicular.
	let py = dx;

	ctx.moveTo(cx + dx * R, cy + dy * R);
	ctx.lineTo(cx - dx * R * 0.5 + px * R * 0.866, cy - dy * R * 0.5 + py * R * 0.866);
	ctx.lineTo(cx - dx * R * 0.5 - px * R * 0.866, cy - dy * R * 0.5 - py * R * 0.866);
	ctx.closePath();
}

// ------------------------------------------------------------------------------------------------

function draw_player_info(replay, index, pl, div, market_results) {

	// Name and money, then shed, seeds, and carried items, as text in the player's
	// div below their canvas. Carried items live in per-unit inventories which we
	// aggregate; they auto-drop to the shed at end of day anyway.

	let shed = replay.shed(index, pl);
	let shed_total = Object.values(shed).reduce((a, b) => a + b, 0);
	let shed_capacity = replay.shed_capacity();

	let carried = {};
	for (let inv of replay.inventories(index, pl)) {
		for (let [item, n] of Object.entries(inv)) {
			carried[item] = (carried[item] || 0) + n;
		}
	}

	let crops = {};
	let animals = {};
	let weeds = 0;
	let empty_pens = 0;

	for (let row of replay.tiles(index, pl)) {
		for (let tile of row) {
			if (typeof tile !== "object" || tile === null) {
				continue;
			}
			if (tile.kind === "WEED") {
				weeds++;
			} else if (tile.kind === "PLANT") {
				crops[tile.crop] = (crops[tile.crop] || 0) + 1;
			} else if (tile.animal) {
				animals[tile.animal] = (animals[tile.animal] || 0) + 1;
			} else if (tile.kind === "COOP" || tile.kind === "PASTURE") {
				empty_pens++;
			}
		}
	}

	div.style.paddingLeft = `${TEXT_PAD}px`;
	div.style.paddingRight = `${TEXT_PAD}px`;
	div.textContent = `${replay.team_name(pl)} --> $${Math.round(replay.money(index, pl))}\n\nShed usage: `;
	let shed_usage = document.createElement("span");
	shed_usage.textContent = `${shed_total}/${shed_capacity}`;
	if (shed_total > shed_capacity) {
		shed_usage.classList.add("warning");
	}
	div.appendChild(shed_usage);

	let lines = [
		`, hired hands: ${replay.units(index, pl).length - 1}`,
		``,
		`Shed: ${itemlist(shed)}`,
		`Seed: ${itemlist(replay.seeds(index, pl))}`,
		`Held: ${itemlist(carried)}`,
		``,
		`Growing: ${itemlist(crops)}` + (weeds > 0 ? ` (${weeds}\u00a0weed${weeds === 1 ? "" : "s"})` : ""),
		`Animals: ${itemlist(animals)}` + (empty_pens > 0 ? ` (${empty_pens}\u00a0empty\u00a0pen${empty_pens === 1 ? "" : "s"})` : ""),
	];

	let orders = replay.next_market_orders(index, pl);
	let order_lines = market_orders_entries(orders, market_results);
	lines.push(``);

	div.appendChild(document.createTextNode(lines.join("\n") + (order_lines.length > 0 ? "\n" : "")));
	for (let entry of order_lines) {
		let line = document.createElement("div");
		if (entry.status === "failure") {
			line.classList.add("failure");
		} else if (entry.status === "partial") {
			line.classList.add("warning");
		}
		line.textContent = entry.text;
		div.appendChild(line);
	}
}

function draw_tile_info(replay, index, pl, x, y, title = "Selected:") {

	// Writes everything knowable about one tile (and anyone standing on it) into the
	// tilebox's title and body divs. draw() calls this with the current selection or
	// (when nothing is selected) the hovered tile, or with a null replay to clear the
	// pane. The hub also calls it directly on mousemove, skipping a full draw.

	let tiletitle = document.getElementById("tiletitle");
	let tilebody = document.getElementById("tilebody");

	if (!replay || !Number.isInteger(x) || !Number.isInteger(y) ||
			x < 0 || y < 0 || x >= replay.board_size() || y >= replay.board_size()) {
		tiletitle.textContent = "";
		tilebody.textContent = "";
		return;
	}

	let day = replay.day(index);
	let tile = replay.tiles(index, pl)[y][x];

	let lines = [`${replay.team_name(pl)} [${x}, ${y}]`, ``];

	if (tile === "LOCKED") {

		lines.push("Locked (quadrant not yet purchased).");

	} else if (tile === null) {

		lines.push("Empty soil.");

	} else if (tile.kind === "WEED") {

		lines.push("Weed.");

	} else if (tile.kind === "PLANT") {

		let age = day - tile.planted_day;
		lines.push(`${tile.crop} plant, ${age} day${age === 1 ? "" : "s"} old`);

		let cd = CROPS[tile.crop];
		if (cd && cd.ongoing) {
			let base = `Yields every ${cd.interval} day${cd.interval === 1 ? "" : "s"} from age ${cd.first_yield_day}`;
			lines.push(age < cd.first_yield_day ? `${base} (first in ${cd.first_yield_day - age})` : `${base}`);
		}

		if (cd) {
			let gate = (!cd.ongoing && age < cd.first_yield_day) ? `, harvest from age ${cd.first_yield_day}` : "";
			lines.push(`Yield: ${tile.yield_units} (max ${cd.max_yield}${gate})`);
		} else {
			lines.push(`Yield: ${tile.yield_units}`);
		}

		if (cd && !cd.ongoing) {
			let ws = Math.floor((cd.max_yield_day + 1) / 2);
			let status = (age < ws) ? `opens in ${ws - age}` : ((age <= cd.max_yield_day) ? "open now" : "closed");
			lines.push(`Watering window: age ${ws}-${cd.max_yield_day} (${status})`);
		}

		lines.push(`Watered today: ${tile.watered_today ? "yes" : "no"}`)
		lines.push(`Unwatered days: ${tile.consecutive_unwatered}`);

		if (tile.fertilized_until_day >= day) {
			let remaining = tile.fertilized_until_day - day + 1;		// Counting today.
			if (remaining === 1) {
				lines.push(`Fertilized: final day`);
			} else {
				lines.push(`Fertilized: ${remaining} days left`);
			}
		} else {
			lines.push(`Fertilized: no`);
		}

		if (tile.max_lifespan_step >= 0) {
			lines.push(index >= tile.max_lifespan_step ?
					`Decaying since step ${tile.max_lifespan_step} (1 yield per 2 steps)` :
					`Decays from step ${tile.max_lifespan_step}`);
		}

	} else if (tile.animal) {

		let age = day - tile.placed_day;
		lines.push(`${tile.animal} in ${tile.kind}, ${age} day${age === 1 ? "" : "s"} old`);

		let ad = ANIMALS[tile.animal];
		if (ad) {
			let base = `${ad.product} every ${ad.interval} day${ad.interval === 1 ? "" : "s"} from age ${ad.first_yield_day}`;
			lines.push(age < ad.first_yield_day ? `${base} (first in ${ad.first_yield_day - age})` : `${base}`);
		}

		lines.push(`${ad ? ad.product : "Produce"} ready: ${tile.yield_units}` + (ad ? ` (max ${ad.max_held})` : ""));
		lines.push(`Fed: ${tile.fed_today ? "yes" : "no"} (unfed days: ${tile.consecutive_unfed})`);
		lines.push(`Cared: ${tile.cared_today ? "yes" : "no"} (pending bonus: ${tile.pending_care_bonus})`);
		lines.push(`Fertilizer: ${tile.fertilizer_available ? "yes" : "no"}`);

	} else if (tile.kind === "COOP" || tile.kind === "PASTURE") {

		lines.push(`Empty ${tile.kind}`);
	}

	let units = replay.units(index, pl);
	let inventories = replay.inventories(index, pl);
	let actions = replay.next_unit_actions(index, pl);
	let pushed_gap = false;

	for (let n = 0; n < units.length; n++) {
		if (units[n][0] === x && units[n][1] === y) {
			if (!pushed_gap) {
				lines.push(``);
				pushed_gap = true;
			}
			let label = (n === 0) ? "F" : `H${n}`;
			let action = actions[n];
			let act = (Array.isArray(action) && action.length > 0) ? action.join("\u00a0") : "-";		// nbsp, as itemlist().
			let verb = ["NORTH", "SOUTH", "EAST", "WEST"].includes(act) ? "go" : "do";
			lines.push(`${label} has ${itemlist(inventories[n] || {})}; ${verb} ${act}`);
		}
	}

	tiletitle.textContent = title;
	tilebody.textContent = lines.join("\n");
}

function draw_unit_info(replay, index, pl, id) {

	// Info about a selected unit (0 = the main farmer, 1+ = hands), into the tilebox's
	// title and body divs. Hands only exist for a day, so the selected id may well not
	// be on the board at the step being viewed.

	let tiletitle = document.getElementById("tiletitle");
	let tilebody = document.getElementById("tilebody");

	if (!replay || !Number.isInteger(id) || id < 0) {
		tiletitle.textContent = "";
		tilebody.textContent = "";
		return;
	}

	let lines = [];

	let units = replay.units(index, pl);
	let label = (id === 0) ? "Farmer" : `Hand ${id}`;

	if (id < units.length) {
		lines.push(`${replay.team_name(pl)} -- ${label} [${units[id][0]}, ${units[id][1]}]`);
	} else {
		lines.push(`${replay.team_name(pl)} -- ${label} [absent]`);
	}

	lines.push(``);

	if (id < units.length) {
		lines.push(`Carrying: ${itemlist(replay.inventories(index, pl)[id] || {})}`);
		let action = replay.next_unit_actions(index, pl)[id];
		lines.push(`Next action: ${Array.isArray(action) && action.length > 0 ? action.join("\u00a0") : "-"}`);		// nbsp, as itemlist().
	}

	tiletitle.textContent = "Selected:";
	tilebody.textContent = lines.join("\n");
}

function draw_market_info(replay, index) {

	// UNUSED: superseded by the price graph in graph.js, but kept around in case the
	// stored-vs-equilibrium or daily demand info proves wanted again. Note the divs
	// it wrote to (#pricesbox etc) are commented out in renderer.html.

	// The market pane: current prices with stored amounts relative to equilibrium
	// (scarcest first), then the town's pooled daily demand. Clears if no replay.

	let markettitle = document.getElementById("markettitle");
	let pricesbox = document.getElementById("pricesbox");
	let shopstitle = document.getElementById("shopstitle");
	let shopsbox = document.getElementById("shopsbox");

	if (!replay) {
		markettitle.textContent = "";
		pricesbox.textContent = "";
		shopstitle.textContent = "";
		shopsbox.textContent = "";
		return;
	}

	let day = replay.day(index);

	markettitle.textContent = "Market:";

	let prices = replay.prices(index);
	let market_inv = replay.market_inventory(index);

	let entries = Object.entries(prices).map(([item, price]) => {
		let eq = replay.equilibrium(item);
		return {item, price, eq, ratio: (market_inv[item] - eq) / eq};
	});
	entries.sort((a, b) => a.ratio - b.ratio);		// Scarcest first, most glutted last.

	pricesbox.textContent = entries.map(e => {
		return e.item.padEnd(11) + `$${e.price}`.padStart(5) + market_inv_to_str(market_inv[e.item], e.eq).padStart(8) + " stored";
	}).join("\n");

	let shops = replay.shops(index);
	let ticks_per_day = Math.floor(replay.turns_per_day() / replay.shop_sell_interval());

	let demand = {};
	for (let name of shops) {
		let products = SHOPS[name] || [];
		let mult = (products.length === 1) ? 2 : 1;
		for (let item of products) {
			demand[item] = (demand[item] || 0) + mult * ticks_per_day;
		}
	}

	let center_ticks = Math.floor(replay.turns_per_day() / replay.town_center_sell_interval());
	let center_mult = TOWN_CENTER_DEMAND_SCHEDULE.find(([threshold, mult]) => day >= threshold)[1];
	for (let item of Object.keys(prices)) {
		if (item !== "FERTILIZER") {
			demand[item] = (demand[item] || 0) + center_mult * center_ticks;
		}
	}

	shopstitle.textContent = `Daily demand: (${shops.length} shop${shops.length !== 1 ? "s" : ""})`;

	let demand_entries = Object.entries(demand).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	shopsbox.textContent = demand_entries.length > 0 ?
			demand_entries.map(([item, n]) => item.padEnd(11) + `${n}`.padStart(5)).join("\n") :
			"(no shops open)";
}

// ------------------------------------------------------------------------------------------------

function tile_at_point(replay, target, cx, cy) {

	// Inverts the board layout: clicked element + pixel coords --> [player, x, y], or
	// null if the point isn't a tile. For use with event.target / offsetX / offsetY;
	// only clicks landing on a player's canvas (identified by its dataset) count.

	if (!replay || !target || !target.dataset || target.dataset.player === undefined) {
		return null;
	}

	let pl = parseInt(target.dataset.player, 10);

	if (!Number.isInteger(pl) || pl < 0 || pl >= replay.num_players()) {
		return null;
	}

	let bs = replay.board_size();
	let x = Math.floor((cx - PAD) / TILE_SIZE);
	let y = Math.floor((cy - PAD) / TILE_SIZE);

	if (x >= 0 && x < bs && y >= 0 && y < bs) {
		return [pl, x, y];
	}

	return null;
}

function set_dark(dark) {
	let o = dark ? BG_COLOURS_DARK : BG_COLOURS_LIGHT;
	document.body.style.backgroundColor = o.body;		// The stylesheet's colours are just the dark-mode
	document.body.style.color = o.text;					// defaults; this overrides them either way.
	document.body.style.setProperty("--failure", o.failure);
	document.body.style.setProperty("--warning", o.warning);
}

// ------------------------------------------------------------------------------------------------

function market_orders_entries(orders, results) {

	// Keep every submitted order separate and in queue order, matching the order in
	// which the engine processes it. Returns an empty array if there were no orders.

	let entries = [];

	for (let order_index = 0; order_index < orders.length; order_index++) {
		let o = orders[order_index];
		if (!Array.isArray(o) || o.length === 0) {
			continue;
		}
		let result = results[order_index] || {status: "failure"};
		let op = o[0];
		let text;
		if (op === "HIRE" || op === "BUY_LAND") {
			text = op;
		} else if (MARKET_OPS.includes(op) && o.length >= 2) {
			let n = parseInt(o[2], 10);
			text = `${op} ${o[1]} ${Number.isFinite(n) ? n : 1}`;
		} else {
			text = o.join(" ");				// Unrecognised op: show verbatim.
		}
		let money = result.money || 0;
		let money_text = money < 0 ? `-$${-money}` : `$${money}`;
		if (result.status === "partial") {
			text += ` (${result.fulfilled}, ${money_text})`;
		} else if (result.status === "success" && MARKET_OPS.includes(op)) {
			text += ` (${money_text})`;
		}
		entries.push({text, status: result.status});
	}

	return entries;
}

function itemlist(o) {
	let parts = Object.entries(o).filter(([item, n]) => n > 0).map(([item, n]) => `${item}\u00a0${n}`);
	return parts.length > 0 ? parts.join(", ") : "-";
}

function market_inv_to_str(n, equilibrium) {
	let s = (n - equilibrium).toString();
	if (s[0] !== "-") {
		s = "+" + s;
	}
	return s;
}

// ------------------------------------------------------------------------------------------------

module.exports = {
	draw,
	draw_tile_info,
	set_dark,
	tile_at_point
};
