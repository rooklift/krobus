"use strict";

// Draw should acquire all its info by calling methods on the replay object.

const TILE_SIZE = 36;
const PAD = 8;

const CROP_COLOURS = {
	WHEAT:      "#d4b84a",
	CARROT:     "#e8862d",
	TOMATO:     "#d9463e",
	STRAWBERRY: "#e5586e",
	MELON:      "#59c26a",
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

// Also copied from the runner, for tile info display.

const ANIMAL_PRODUCTS = {
	GOOSE: "EGG",
	COW:   "MILK",
	SHEEP: "WOOL",
};

const BACKGROUND_COLOURS = {
	canvas:  "#2a2a2a",
	locked:  "#1e1e1e",
	soil:    "#5a4023",
	plant:   "#2f5d31",
	coop:    "#7b6144",
	pasture: "#5c6e46",
};

function draw(replay, index, selection) {		// selection: [player, x, y] or null.

	let statusbox = document.getElementById("statusbox");
	let markettitle = document.getElementById("markettitle");
	let pricesbox = document.getElementById("pricesbox");
	let shopstitle = document.getElementById("shopstitle");
	let shopsbox = document.getElementById("shopsbox");
	let farmcols = document.getElementById("farmcols");

	if (!replay) {
		statusbox.textContent = "";
		markettitle.textContent = "";
		pricesbox.textContent = "";
		shopstitle.textContent = "";
		shopsbox.textContent = "";
		farmcols.textContent = "";			// Also deletes the per-player columns.
		document.getElementById("tilebox").textContent = "";
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
		cv.dataset.player = `${farmcols.children.length}`;		// Lets tile_at_point identify the clicked board.
		let d = document.createElement("div");
		d.classList.add("farmbox");
		col.appendChild(cv);
		col.appendChild(d);
		farmcols.appendChild(col);
	}

	let day = replay.day(index);

	for (let pl = 0; pl < players; pl++) {

		let col = farmcols.children[pl];
		let cv = col.children[0];
		let ctx = cv.getContext("2d");

		if (cv.width !== canvas_px || cv.height !== canvas_px) {
			cv.width = canvas_px;
			cv.height = canvas_px;
			col.style.width = `${canvas_px}px`;		// Pin the column too, else long farmbox lines widen it instead of wrapping.
		}

		ctx.fillStyle = BACKGROUND_COLOURS.canvas;
		ctx.fillRect(0, 0, cv.width, cv.height);

		draw_board(ctx, replay.tiles(index, pl), bs, day, PAD, PAD);
		draw_units(ctx, replay.units(index, pl), PAD, PAD);

		if (Array.isArray(selection) && selection[0] === pl &&
				selection[1] >= 0 && selection[1] < bs && selection[2] >= 0 && selection[2] < bs) {
			ctx.strokeStyle = "#ffffff";
			ctx.lineWidth = 2;
			ctx.strokeRect(PAD + selection[1] * TILE_SIZE + 1, PAD + selection[2] * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
		}

		draw_player_info(replay, index, pl, col.children[1]);
	}

	if (Array.isArray(selection) && selection[0] >= 0 && selection[0] < players) {
		draw_tile_info(replay, index, selection[0], selection[1], selection[2]);
	} else {
		document.getElementById("tilebox").textContent = "";
	}

	markettitle.textContent = "Market";
	statusbox.textContent = `Step ${index} / ${replay.length()}\nDay ${day}, Hour ${replay.hour(index)}`;

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

	shopstitle.textContent = `Daily demand (${shops.length} shop${shops.length !== 1 ? "s" : ""})`;

	let demand_entries = Object.entries(demand).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	shopsbox.textContent = demand_entries.length > 0 ?
			demand_entries.map(([item, n]) => item.padEnd(11) + `${n}`.padStart(3)).join("\n") :
			"(no shops open)";
}

function draw_board(ctx, tiles, bs, day, ox, oy) {
	for (let y = 0; y < bs; y++) {
		for (let x = 0; x < bs; x++) {
			draw_tile(ctx, tiles[y][x], day, ox + x * TILE_SIZE, oy + y * TILE_SIZE);
		}
	}
}

function draw_tile(ctx, tile, day, px, py) {

	let bg = BACKGROUND_COLOURS.soil;
	let letter = "";
	let letter_colour = "#efefef";
	let yield_units = 0;
	let watered = false;
	let fertilized = false;

	if (tile === "LOCKED") {
		bg = BACKGROUND_COLOURS.locked;
	} else if (tile !== null) {
		if (tile.kind === "WEED") {
			letter = "x";
			letter_colour = "#7a8b4a";
		} else if (tile.kind === "PLANT") {
			bg = BACKGROUND_COLOURS.plant;
			letter = tile.crop[0].toLowerCase();
			letter_colour = CROP_COLOURS[tile.crop] || "#efefef";
			yield_units = tile.yield_units;
			watered = tile.watered_today;
			fertilized = tile.fertilized_until_day >= day;
		} else if (tile.animal) {
			bg = (tile.kind === "COOP") ? BACKGROUND_COLOURS.coop : BACKGROUND_COLOURS.pasture;
			letter = tile.animal[0];
			yield_units = tile.yield_units;
		} else if (tile.kind === "COOP" || tile.kind === "PASTURE") {
			bg = (tile.kind === "COOP") ? BACKGROUND_COLOURS.coop : BACKGROUND_COLOURS.pasture;
			letter = tile.kind[0].toLowerCase();
			letter_colour = "#999999";
		}
	}

	ctx.fillStyle = bg;
	ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);

	if (watered) {
		ctx.strokeStyle = "#5ab4e0";
		ctx.lineWidth = 2;
		ctx.strokeRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
	}

	if (fertilized) {
		ctx.fillStyle = "#c86bd8";
		ctx.fillRect(px + 3, py + 3, 5, 5);
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
}

function draw_player_info(replay, index, pl, div) {

	// Name and money, then shed, seeds, and carried items, as text in the player's
	// div below their canvas. Carried items live in per-unit inventories which we
	// aggregate; they auto-drop to the shed at end of day anyway.

	let shed = replay.shed(index, pl);
	let shed_total = Object.values(shed).reduce((a, b) => a + b, 0);

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

	let lines = [
		`${replay.team_name(pl)} -- $${Math.round(replay.money(index, pl))}`,
		``,
		`Shed ${shed_total}/${replay.shed_capacity()}: ${itemlist(shed)}`,
		`Seeds: ${itemlist(replay.seeds(index, pl))}`,
		`Carrying: ${itemlist(carried)}`,
		`Growing: ${itemlist(crops)}` + (weeds > 0 ? ` (${weeds} weed${weeds === 1 ? "" : "s"})` : ""),
		`Animals: ${itemlist(animals)}` + (empty_pens > 0 ? ` (${empty_pens} empty pen${empty_pens === 1 ? "" : "s"})` : ""),
	];

	lines.push(``);
	lines.push(...market_orders_strings(replay.market_orders(index, pl)));

	div.style.paddingLeft = `${PAD}px`;
	div.style.paddingRight = `${PAD}px`;
	div.textContent = lines.join("\n");
}

const MARKET_OP_ORDER = ["HIRE", "BUY_LAND", "BUY_SEED", "BUY_ANIMAL", "BUY_PRODUCT", "SELL"];

function market_orders_strings(orders) {

	// Purely for display: merges duplicate orders (HIRE x4; summed SELL counts) and
	// sorts them into a fixed rational order, though the engine ran them as given.
	// Returns an array of display lines, empty if there were no orders.

	let merged = new Map();

	for (let o of orders) {
		if (!Array.isArray(o) || o.length === 0) {
			continue;
		}
		let op = o[0];
		let key;
		let entry;
		if (op === "HIRE" || op === "BUY_LAND") {
			key = op;
			entry = merged.get(key) || {op: op, item: "", n: 0, tally: true};
			entry.n += 1;
		} else if (MARKET_OP_ORDER.includes(op) && o.length >= 2) {
			key = `${op} ${o[1]}`;
			entry = merged.get(key) || {op: op, item: `${o[1]}`, n: 0};
			let n = parseInt(o[2], 10);
			entry.n += Number.isFinite(n) ? n : 1;
		} else {
			key = o.join(" ");				// Unrecognised op: show verbatim, tallied if repeated.
			entry = merged.get(key) || {op: key, item: "", n: 0, tally: true};
			entry.n += 1;
		}
		merged.set(key, entry);
	}

	let entries = [...merged.values()];

	entries.sort((a, b) => {
		let ai = MARKET_OP_ORDER.indexOf(a.op);
		let bi = MARKET_OP_ORDER.indexOf(b.op);
		if (ai === -1) ai = MARKET_OP_ORDER.length;
		if (bi === -1) bi = MARKET_OP_ORDER.length;
		return (ai - bi) || a.item.localeCompare(b.item);
	});

	return entries.map(e => {
		if (e.tally) {
			return e.n > 1 ? `${e.op} x${e.n}` : e.op;
		}
		return `${e.op} ${e.item} ${e.n}`;
	});
}

function itemlist(o) {
	let parts = Object.entries(o).filter(([item, n]) => n > 0).map(([item, n]) => `${item} ${n}`);
	return parts.length > 0 ? parts.join(", ") : "-";
}

function draw_units(ctx, units, ox, oy) {

	// Units on the same tile are offset into a small cluster so all remain visible.

	const offsets = [[0, 0], [-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]];

	let seen_at = {};

	for (let n = 0; n < units.length; n++) {
		let [x, y] = units[n];
		let key = `${x},${y}`;
		let stack = seen_at[key] || 0;
		seen_at[key] = stack + 1;
		let [dx, dy] = offsets[stack % offsets.length];
		let cx = ox + (x + 0.5 + dx) * TILE_SIZE;
		let cy = oy + (y + 0.5 + dy) * TILE_SIZE;
		let radius = (n === 0) ? TILE_SIZE * 0.2 : TILE_SIZE * 0.14;
		ctx.beginPath();
		ctx.arc(cx, cy, radius, 0, Math.PI * 2);
		ctx.fillStyle = (n === 0) ? "#ffe066" : "#f0f0f0";
		ctx.fill();
		ctx.strokeStyle = "#222222";
		ctx.lineWidth = 1.5;
		ctx.stroke();
	}
}

function market_inv_to_str(n, equilibrium) {
	let s = (n - equilibrium).toString();
	if (s[0] !== "-") {
		s = "+" + s;
	}
	return s;
}

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

function draw_tile_info(replay, index, pl, x, y) {

	// Writes everything knowable about one tile (and anyone standing on it) into the
	// tilebox. draw() calls this with the current selection.

	let tilebox = document.getElementById("tilebox");

	if (!replay) {
		tilebox.textContent = "";
		return;
	}

	let bs = replay.board_size();

	if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= bs || y >= bs) {
		tilebox.textContent = "";
		return;
	}

	let day = replay.day(index);
	let tile = replay.tiles(index, pl)[y][x];

	let lines = [`${replay.team_name(pl)} -- tile [${x}, ${y}]`, ``];

	if (tile === "LOCKED") {

		lines.push("Locked (quadrant not yet purchased).");

	} else if (tile === null) {

		lines.push("Empty soil.");

	} else if (tile.kind === "WEED") {

		lines.push("Weed.");

	} else if (tile.kind === "PLANT") {

		lines.push(`${tile.crop} plant, planted day ${tile.planted_day} (${day - tile.planted_day} days old).`);
		lines.push(`Yield ready: ${tile.yield_units}`);
		lines.push(`Watered today: ${tile.watered_today ? "yes" : "no"} (unwatered days: ${tile.consecutive_unwatered})`);

		if (tile.fertilized_until_day >= day) {
			lines.push(`Fertilized through day ${tile.fertilized_until_day}.`);
		}

		if (tile.max_lifespan_step >= 0) {
			lines.push(index >= tile.max_lifespan_step ?
					`Decaying since step ${tile.max_lifespan_step} (1 yield per 2 steps).` :
					`Decays from step ${tile.max_lifespan_step}.`);
		}

	} else if (tile.animal) {

		lines.push(`${tile.animal} in ${tile.kind}, placed day ${tile.placed_day} (${day - tile.placed_day} days old).`);
		lines.push(`${ANIMAL_PRODUCTS[tile.animal] || "Produce"} ready: ${tile.yield_units}`);
		lines.push(`Fed: ${tile.fed_today ? "yes" : "no"} (unfed days: ${tile.consecutive_unfed})`);
		lines.push(`Cared: ${tile.cared_today ? "yes" : "no"} (pending bonus: ${tile.pending_care_bonus})`);
		lines.push(`Fertilizer: ${tile.fertilizer_available ? "yes" : "no"}`);

	} else if (tile.kind === "COOP" || tile.kind === "PASTURE") {

		lines.push(`Empty ${tile.kind}.`);
	}

	let units = replay.units(index, pl);
	let inventories = replay.inventories(index, pl);
	let pushed_gap = false;

	for (let n = 0; n < units.length; n++) {
		if (units[n][0] === x && units[n][1] === y) {
			if (!pushed_gap) {
				lines.push(``);
				pushed_gap = true;
			}
			let label = (n === 0) ? "Farmer" : `Hand ${n}`;
			lines.push(`${label} carrying: ${itemlist(inventories[n] || {})}`);
		}
	}

	tilebox.textContent = lines.join("\n");
}



module.exports = {
	draw,
	draw_tile_info,
	tile_at_point
};
