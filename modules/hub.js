"use strict";

const {ipcRenderer} = require("electron");
const fs = require("fs");

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
			this.replay = replay_kaggle.load(o);
			this.index = 0;
		} catch (err) {
			alert(err);
			return;
		}

		this.draw();
	},

	draw: function() {
		drawtools.draw(this.replay, this.index);
	},

	backward(n) {
		this.index = Math.max(0, this.index - n);
		this.draw();
	},

	forward(n) {
		this.index = Math.min(this.replay.length() - 1, this.index + n);
		this.draw();
	},

};



module.exports = init();
