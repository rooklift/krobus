"use strict";

const {ipcRenderer} = require("electron");
const fs = require("fs");
const path = require("path");

const config_io = require("./config_io");
const drawtools = require("./drawtools");
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
		drawtools.draw(this.replay, this.index, this.selection);
	},

	backward(n) {
		this.index = Math.max(0, this.index - n);
		this.draw();
	},

	forward(n) {
		this.index = Math.min(this.replay.length() - 1, this.index + n);
		this.draw();
	},

	click(event) {

		// Selection is null, or {type: "tile", player, x, y}, or {type: "unit", player, id}
		// where id 0 is the main farmer and 1+ are the hands. Repeated clicks on a tile
		// cycle: the tile --> each unit present (by id) --> the tile again...

		let hit = drawtools.tile_at_point(this.replay, event.target, event.offsetX, event.offsetY);

		if (!hit) {
			this.selection = null;
			this.draw();
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

};



module.exports = init();
