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
		let selection = drawtools.tile_at_point(this.replay, event.offsetX, event.offsetY);
		if (selection && this.selection &&
				selection[0] === this.selection[0] && selection[1] === this.selection[1] && selection[2] === this.selection[2]) {
			selection = null;											// Clicking the selected tile deselects it.
		}
		this.selection = selection;										// [player, x, y], or null.
		this.draw();
	},

};



module.exports = init();
