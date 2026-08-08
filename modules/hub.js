"use strict";

const {ipcRenderer} = require("electron");
const fs = require("fs");
const path = require("path");

const config_io = require("./config_io");
const drawtools = require("./drawtools");
const graph = require("./graph");
const replay_kaggle = require("./replay_kaggle");

function init() {
	let hub_prototype = {};
	Object.assign(hub_prototype, hub_main_props);
	Object.assign(hub_prototype, require("./hub_settings"));
	let ret = Object.create(hub_prototype);
	ret.reset();
	return ret;
}

let hub_main_props = {

	reset: function() {
		this.replay = null;
		this.index = 0;
		this.selection = null;
		this.hover = null;
		this.swap = false;
		this.legend_item = null;		// The graph legend entry under the mouse, mirrored into graph.set_highlight().
		this.graph_dragging = false;	// Mouse button is down after starting on the graph; moves seek.
		this.suppress_click = false;	// The next click event is the tail end of a graph seek; ignore it.
		graph.set_highlight(null);
	},

	clear_selection() {
		this.selection = null;
		this.draw();
	},

	quit: function() {
		config_io.save();					// As long as we use the sync save, this will complete before we
		ipcRenderer.send("terminate");		// send "terminate". Not sure about results if that wasn't so.
	},

	load_replay: function(filepath) {

		// If we ever send CLI args to the render, these could happen....

		if (filepath === __dirname || filepath === "." || fs.existsSync(filepath) === false) {
			return;
		}

		let o;

		try {
			let buf = fs.readFileSync(filepath);
			o = JSON.parse(buf);
		} catch(err) {
			alert(err);
			return;
		}

		if (typeof o !== "object" || o === null) {
			alert("This does not appear to be a replay.");
			return;
		}

		try {
			let replay = replay_kaggle.load(o);
			this.reset();
			this.replay = replay;
		} catch (err) {
			alert(err);
			return;
		}

		ipcRenderer.send("set_title", path.basename(filepath));
		this.draw();
	},

	draw: function() {
		drawtools.draw(this.replay, this.index, this.selection, this.hover, this.swap);
	},

	backward(n) {
		if (!this.replay) {
			return;
		}
		this.index = Math.max(0, this.index - n);
		this.draw();
	},

	forward(n) {
		if (!this.replay) {
			return;
		}
		this.index = Math.min(this.replay.length() - 1, this.index + n);
		this.draw();
	},

	find_first_divergence() {
		if (!this.replay) {
			return;
		}
		let i = this.replay.first_divergence();
		if (i === null) {
			alert("No divergence found: all players issue the same actions.");
			return;
		}
		this.seek(i);
	},

	seek(i) {
		if (!this.replay || !Number.isInteger(i)) {
			return;
		}
		i = Math.max(0, Math.min(this.replay.length() - 1, i));
		if (i === this.index) {
			return;
		}
		this.index = i;
		this.draw();
	},

	click(event) {

		if (this.suppress_click) {			// This click is just the mouseup end of a graph seek.
			this.suppress_click = false;
			return;
		}

		// Selection is null, or {type: "tile", player, x, y}, or {type: "unit", player, id}
		// where id 0 is the main farmer and 1+ are the hands. Repeated clicks on a tile
		// cycle: the tile --> each unit present (by id) --> the tile again...

		let hit = drawtools.tile_at_point(this.replay, event.target, event.offsetX, event.offsetY);

		if (!hit) {
			this.clear_selection();
			return;
		}

		let [pl, x, y] = hit;

		let present = [];												// Ids of units standing on the clicked tile.
		let units = this.replay.units(this.index, pl);
		for (let n = 0; n < units.length; n++) {
			if (units[n][0] === x && units[n][1] === y) {
				present.push(n);
			}
		}

		let next = {type: "tile", player: pl, x: x, y: y};
		let sel = this.selection;

		if (sel && sel.player === pl) {
			if (sel.type === "tile" && sel.x === x && sel.y === y) {
				if (present.length > 0) {
					next = {type: "unit", player: pl, id: present[0]};
				}
			} else if (sel.type === "unit" && present.includes(sel.id)) {
				let n = present.indexOf(sel.id);
				if (n + 1 < present.length) {
					next = {type: "unit", player: pl, id: present[n + 1]};
				}														// Else wrap back round to the tile itself.
			}
		}

		this.selection = next;
		this.draw();
	},

	mousedown(event) {

		// Pressing the button on the graph starts a seek-drag; mousemove continues it
		// (wherever the mouse goes) and mouseup ends it, also suppressing the click
		// event that follows, which would otherwise clear the selection.

		if (this.replay && graph.contains(event.target)) {
			this.graph_dragging = true;
			this.seek(graph.index_at_clientX(this.replay, event.clientX));
		}
	},

	mouseup(event) {
		if (this.graph_dragging) {
			this.graph_dragging = false;
			this.suppress_click = true;
		}
	},

	mousemove(event) {

		// Tracks the tile under the mouse. While nothing is selected, the tile info
		// pane follows the hover; a selection always takes precedence. Only the pane
		// is updated here -- never a full draw -- so this stays cheap. Not so during
		// a graph seek-drag, which does full draws, like any other navigation.

		if (this.graph_dragging) {
			this.seek(graph.index_at_clientX(this.replay, event.clientX));
			return;
		}

		// Hovering a graph legend entry highlights its line; like the tile hover, only
		// the graph is redrawn, and only when the hovered entry actually changes.

		let legend_item = (event.target && event.target.dataset && event.target.dataset.item) || null;

		if (legend_item !== this.legend_item) {
			this.legend_item = legend_item;
			graph.set_highlight(legend_item);
			if (this.replay) {
				graph.draw(this.replay, this.index);
			}
		}

		let hit = drawtools.tile_at_point(this.replay, event.target, event.offsetX, event.offsetY);
		let hover = hit ? {player: hit[0], x: hit[1], y: hit[2]} : null;

		if (hover === null && this.hover === null) {
			return;
		}
		if (hover && this.hover && hover.player === this.hover.player && hover.x === this.hover.x && hover.y === this.hover.y) {
			return;
		}

		this.hover = hover;

		if (!this.selection) {
			if (hover) {
				drawtools.draw_tile_info(this.replay, this.index, hover.player, hover.x, hover.y, "Mouseover:");
			} else {
				drawtools.draw_tile_info(null, 0, 0, 0, 0);		// Clears.
			}
		}
	},

	clear_hover() {
		this.hover = null;
		if (this.legend_item) {
			this.legend_item = null;
			graph.set_highlight(null);
			if (this.replay) {
				graph.draw(this.replay, this.index);
			}
		}
		if (!this.selection) {
			drawtools.draw_tile_info(null, 0, 0, 0, 0);			// Clears.
		}
	},

	swap_players() {
		this.swap = !this.swap;
		this.draw();
	},

};



module.exports = init();
