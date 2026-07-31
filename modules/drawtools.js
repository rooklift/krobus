"use strict";

// Draw should acquire all its info by calling methods on the replay object.

const TILE_SIZE = 36;
const PAD = 8;
const BOARD_GAP = 48;
const HEADER_HEIGHT = 24;
const FOOTER_LINE_HEIGHT = 16;
const FOOTER_LINES = 3;
const FOOTER_HEIGHT = 6 + FOOTER_LINES * FOOTER_LINE_HEIGHT;

const CROP_COLOURS = {
	WHEAT:      "#d4b84a",
	CARROT:     "#e8862d",
	TOMATO:     "#d9463e",
	STRAWBERRY: "#e5586e",
	MELON:      "#59c26a",
};

const BACKGROUND_COLOURS = {
	canvas:  "#2a2a2a",
	locked:  "#1e1e1e",
	soil:    "#5a4023",
	plant:   "#2f5d31",
	coop:    "#7b6144",
	pasture: "#5c6e46",
};

function draw(replay, index) {

	let canvas = document.getElementById("canvas");
	let ctx = canvas.getContext("2d");
	let statusbox = document.getElementById("statusbox");
	let pricesbox = document.getElementById("pricesbox");
	let shopsbox = document.getElementById("shopsbox");

	if (!replay) {
		ctx.fillStyle = BACKGROUND_COLOURS.canvas;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		statusbox.textContent = "No replay loaded. Use Open... (Ctrl+O) to load a Kaggle replay.";
		pricesbox.textContent = "";
		shopsbox.textContent = "";
		return;
	}

	let bs = replay.board_size();
	let players = replay.num_players();
	let board_px = bs * TILE_SIZE;

	let want_width = PAD * 2 + players * board_px + (players - 1) * BOARD_GAP;
	let want_height = PAD * 2 + HEADER_HEIGHT + board_px + FOOTER_HEIGHT;

	if (canvas.width !== want_width || canvas.height !== want_height) {
		canvas.width = want_width;
		canvas.height = want_height;
	}

	ctx.fillStyle = BACKGROUND_COLOURS.canvas;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	let day = replay.day(index);

	for (let pl = 0; pl < players; pl++) {
		let ox = PAD + pl * (board_px + BOARD_GAP);
		let oy = PAD + HEADER_HEIGHT;
		draw_header(ctx, replay, index, pl, ox, PAD);
		draw_board(ctx, replay.tiles(index, pl), bs, day, ox, oy);
		draw_units(ctx, replay.units(index, pl), ox, oy);
		draw_player_info(ctx, replay, index, pl, ox, oy + board_px + 6, board_px);
	}

	statusbox.textContent = `Step ${index + 1} / ${replay.length()} -- Day ${day}, Hour ${replay.hour(index)}`;

	let prices = replay.prices(index);
	pricesbox.textContent = Object.entries(prices).map(([item, price]) => `${item} $${price}`).join("   ");

	let shops = replay.shops(index);
	shopsbox.textContent = "Shops: " + (shops.length > 0 ? shops.join(", ") : "(none)");
}

function draw_header(ctx, replay, index, pl, x, y) {
	ctx.font = "bold 14px Consolas, monospace";
	ctx.textAlign = "left";
	ctx.textBaseline = "top";
	ctx.fillStyle = "#efefef";
	ctx.fillText(`${replay.team_name(pl)} -- $${Math.round(replay.money(index, pl))}`, x, y + 2);
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

function draw_player_info(ctx, replay, index, pl, x, y, max_width) {

	// Shed, seeds, and carried items. Carried items live in per-unit inventories
	// which we aggregate; they auto-drop to the shed at end of day anyway.

	let shed = replay.shed(index, pl);
	let shed_total = Object.values(shed).reduce((a, b) => a + b, 0);

	let carried = {};
	for (let inv of replay.inventories(index, pl)) {
		for (let [item, n] of Object.entries(inv)) {
			carried[item] = (carried[item] || 0) + n;
		}
	}

	let lines = [
		`Shed ${shed_total}/${replay.shed_capacity()}: ${itemlist(shed)}`,
		`Seeds: ${itemlist(replay.seeds(index, pl))}`,
		`Carrying: ${itemlist(carried)}`,
	];

	ctx.font = "12px Consolas, monospace";
	ctx.textAlign = "left";
	ctx.textBaseline = "top";
	ctx.fillStyle = "#cccccc";

	for (let n = 0; n < lines.length; n++) {
		ctx.fillText(fit_text(ctx, lines[n], max_width), x, y + n * FOOTER_LINE_HEIGHT);
	}
}

function itemlist(o) {
	let parts = Object.entries(o).filter(([item, n]) => n > 0).map(([item, n]) => `${item} ${n}`);
	return parts.length > 0 ? parts.join(", ") : "-";
}

function fit_text(ctx, text, max_width) {
	if (ctx.measureText(text).width <= max_width) {
		return text;
	}
	while (text.length > 1 && ctx.measureText(text + "…").width > max_width) {
		text = text.slice(0, -1);
	}
	return text + "…";
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



module.exports = {
	draw
};
