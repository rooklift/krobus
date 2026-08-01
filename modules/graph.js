"use strict";

// The market price history graph, drawn into #graphcanvas, with a legend (item names
// and their prices at the current step) in #graphlegend. The expensive part -- the
// price lines for the whole replay -- is rendered just once per replay, to an
// offscreen canvas; draw() blits that, adds the vertical current-step line, and
// refreshes the legend. The y-scale is linear or logarithmic, per config.log_graph
// (arriving via set_log). Like the boards, the graph canvas stays dark in both themes,
// so the lines never change; only the legend text (which sits on the body
// background) has theme-dependent colours.

const GRAPH_HEIGHT = 240;
const CANVAS_BACKGROUND = "#1f1f1f";	// As BACKGROUND_COLOURS.canvas in drawtools.

// Note that drawtools's CROP_COLOURS can't be reused here: it gives CARROT and
// TOMATO the same orange, which is fine for tile letters but useless for lines.

const LINE_COLOURS = {					// On the always-dark canvas.
	WHEAT:      "#ddcc66",
	CARROT:     "#ee8833",
	TOMATO:     "#dd4444",
	STRAWBERRY: "#ee99bb",
	MELON:      "#55bb77",
	EGG:        "#efefef",
	MILK:       "#77aadd",
	WOOL:       "#aa77dd",
	FERTILIZER: "#997755",
};

const LEGEND_COLOURS_DARK = Object.assign({}, LINE_COLOURS);

// The legend layout: fertilizer (mechanically special) sits alone at top left with
// the animal products below it, while the crops fill the right column. Each group is
// sorted by its starting price, descending -- which is the same every game.

const LEGEND_LEFT  = ["FERTILIZER", null, "WOOL", "MILK", "EGG"];
const LEGEND_RIGHT = ["MELON", "STRAWBERRY", "TOMATO", "CARROT", "WHEAT"];

const LEGEND_COLOURS_LIGHT = {			// LINE_COLOURS, darkened to read on the light body.
	WHEAT:      "#997700",
	CARROT:     "#bb5511",
	TOMATO:     "#bb2222",
	STRAWBERRY: "#cc4477",
	MELON:      "#227744",
	EGG:        "#555555",
	MILK:       "#2266aa",
	WOOL:       "#7733bb",
	FERTILIZER: "#775533",
};

let LEGEND_COLOURS = Object.assign({}, LEGEND_COLOURS_DARK);

let log_scale = false;		// Set by set_log(); a mismatch with cache.log_scale forces a rebuild.

let highlight_item = null;	// Set by set_highlight() when the mouse is on a legend entry. Unlike the
							// above, never triggers a rebuild: draw() applies it on top of the blit.

let cache = {
	replay: null,		// The replay the offscreen canvas was built from.
	canvas: null,		// Offscreen canvas holding background and price lines.
	points: null,		// Map item --> array of [x, y], so one line can be restroked without a rebuild.
	log_scale: false,	// Whether the canvas was built with the log y-scale.
	x0: 0, x1: 0,		// Plot pixel bounds within the canvas, for index <--> x conversion.
	y0: 0, y1: 0,
};

// ------------------------------------------------------------------------------------------------

function draw(replay, index) {

	let cv = document.getElementById("graphcanvas");
	let markettitle = document.getElementById("markettitle");
	let legend = document.getElementById("graphlegend");

	if (!replay) {
		cache.replay = null;
		cache.canvas = null;
		cache.points = null;
		cv.width = 0;					// Collapses the canvas entirely.
		cv.height = 0;
		markettitle.textContent = "";
		legend.textContent = "";
		return;
	}

	if (cache.replay !== replay || cache.log_scale !== log_scale) {
		build(replay, cv.parentElement.clientWidth || 448);
	}

	if (cv.width !== cache.canvas.width || cv.height !== cache.canvas.height) {
		cv.width = cache.canvas.width;
		cv.height = cache.canvas.height;
	}

	let ctx = cv.getContext("2d");
	ctx.drawImage(cache.canvas, 0, 0);

	if (highlight_item && cache.points[highlight_item]) {

		// One translucent background-coloured rect fades every baked-in line at once;
		// the highlighted line is then restroked, bright and bold, on top.

		ctx.fillStyle = "rgba(31, 31, 31, 0.75)";				// CANVAS_BACKGROUND with alpha.
		ctx.fillRect(0, 0, cv.width, cv.height);
		stroke_line(ctx, cache.points[highlight_item], LINE_COLOURS[highlight_item] || "#999999", 2);
	}

	let x = Math.floor(index_to_x(replay, index)) + 0.5;		// The 0.5 keeps the 1px line crisp.
	ctx.strokeStyle = "#efefef";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(x, cache.y0);
	ctx.lineTo(x, cache.y1);
	ctx.stroke();

	markettitle.textContent = "Market:";
	draw_legend(replay, index, legend);
}

function build(replay, width) {

	// Renders every step's prices as polylines onto a new offscreen canvas, stored in
	// the cache along with everything needed to interpret pixel coords later. Called
	// lazily by draw(), once per replay.

	let len = replay.length();
	let items = Object.keys(replay.prices(0));

	let series = {};
	let ymax = 0;
	let ymin = Infinity;		// Smallest positive price, for the log scale's bottom.

	for (let item of items) {
		series[item] = new Array(len);
	}
	for (let i = 0; i < len; i++) {
		let prices = replay.prices(i);
		for (let item of items) {
			let v = (typeof prices[item] === "number") ? prices[item] : 0;
			series[item][i] = v;
			if (v > ymax) ymax = v;
			if (v > 0 && v < ymin) ymin = v;
		}
	}
	if (ymax <= 0) {
		ymax = 1;
	}
	if (!Number.isFinite(ymin)) {
		ymin = 1;
	}

	let canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = GRAPH_HEIGHT;
	let ctx = canvas.getContext("2d");

	ctx.fillStyle = CANVAS_BACKGROUND;
	ctx.fillRect(0, 0, width, GRAPH_HEIGHT);

	cache.replay = replay;
	cache.canvas = canvas;
	cache.log_scale = log_scale;
	cache.x0 = 2;
	cache.x1 = width - 3;
	cache.y0 = 2;
	cache.y1 = GRAPH_HEIGHT - 3;

	// The y mapping: linear from 0 to the highest price seen, or logarithmic from the
	// lowest (positive) price to the highest. Non-positive prices, which the log
	// can't place, clamp to the bottom.

	let t0 = Math.log(ymin);
	let t_denom = (ymax > ymin) ? Math.log(ymax) - t0 : 1;

	let y_of = (v) => {
		let frac = log_scale ? (Math.log(Math.max(v, ymin)) - t0) / t_denom : v / ymax;
		return cache.y1 - frac * (cache.y1 - cache.y0);
	};

	let denom = Math.max(1, len - 1);

	cache.points = {};

	for (let item of items) {
		let points = new Array(len);
		for (let i = 0; i < len; i++) {
			points[i] = [cache.x0 + (i / denom) * (cache.x1 - cache.x0), y_of(series[item][i])];
		}
		cache.points[item] = points;
		stroke_line(ctx, points, LINE_COLOURS[item] || "#999999", 1);
	}
}

function stroke_line(ctx, points, colour, width) {
	ctx.strokeStyle = colour;
	ctx.lineWidth = width;
	ctx.beginPath();
	for (let i = 0; i < points.length; i++) {
		if (i === 0) {
			ctx.moveTo(points[i][0], points[i][1]);
		} else {
			ctx.lineTo(points[i][0], points[i][1]);
		}
	}
	ctx.stroke();
}

function draw_legend(replay, index, legend) {

	// Renders the two hardcoded columns, each entry coloured as its line and showing
	// the price at the current step. Rebuilt from scratch every draw -- it's only 9
	// spans.

	legend.textContent = "";

	let prices = replay.prices(index);
	let rows = Math.max(LEGEND_LEFT.length, LEGEND_RIGHT.length);

	for (let row = 0; row < rows; row++) {
		append_legend_cell(legend, LEGEND_LEFT[row], prices);
		legend.appendChild(document.createTextNode("   "));
		append_legend_cell(legend, LEGEND_RIGHT[row], prices);
		legend.appendChild(document.createTextNode("\n"));
	}
}

function append_legend_cell(legend, item, prices) {

	if (!item) {										// Missing or null entry: pad the cell so the other column aligns.
		legend.appendChild(document.createTextNode(" ".repeat(11 + 6)));
		return;
	}

	let span = document.createElement("span");
	span.dataset.item = item;							// Lets hub.mousemove spot legend hovers.
	span.style.color = LEGEND_COLOURS[item] || "#999999";
	span.textContent = item.padEnd(11) + price_str(prices[item] ?? 0).padStart(6);
	legend.appendChild(span);
}

// ------------------------------------------------------------------------------------------------

function index_to_x(replay, index) {
	let denom = Math.max(1, replay.length() - 1);
	return cache.x0 + (index / denom) * (cache.x1 - cache.x0);
}

function index_at_clientX(replay, clientX) {

	// For graph seeking: a window clientX --> nearest step index, clamped. Valid
	// whenever the graph has been drawn; note clientX may come from far off the
	// canvas, since drags continue wherever the mouse goes.

	let cv = document.getElementById("graphcanvas");
	let rect = cv.getBoundingClientRect();
	let frac = (clientX - rect.left - cache.x0) / Math.max(1, cache.x1 - cache.x0);
	let i = Math.round(frac * (replay.length() - 1));
	return Math.max(0, Math.min(replay.length() - 1, i));
}

function contains(target) {			// Is the event target the graph?
	return Boolean(target) && target.id === "graphcanvas";
}

function price_str(v) {
	return "$" + (Number.isInteger(v) ? `${v}` : v.toFixed(1));
}

function set_dark(dark) {
	Object.assign(LEGEND_COLOURS, dark ? LEGEND_COLOURS_DARK : LEGEND_COLOURS_LIGHT);
}

function set_log(value) {
	log_scale = value ? true : false;		// The next draw() sees the mismatch with cache.log_scale and rebuilds.
}

function set_highlight(item) {
	highlight_item = item || null;			// Applied by draw() on top of the blit; no rebuild involved.
}

// ------------------------------------------------------------------------------------------------

module.exports = {
	draw,
	set_dark,
	set_log,
	set_highlight,
	contains,
	index_at_clientX
};
