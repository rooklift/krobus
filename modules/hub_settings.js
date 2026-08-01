"use strict";

const {ipcRenderer} = require("electron");
const drawtools = require("./drawtools");
const graph = require("./graph");

const multichecks = {};

const togglechecks = {
	dark_mode:			["Options", "Dark mode"],
	log_graph:			["Options", "Log scale graph"],
};

for (let menupath of Object.values(multichecks)) {
	ipcRenderer.send("verify_menupath", menupath);
}

for (let menupath of Object.values(togglechecks)) {
	ipcRenderer.send("verify_menupath", menupath);
}

drawtools.set_dark(config.dark_mode);		// Apply the saved settings at startup; config is loaded by this point.
graph.set_dark(config.dark_mode);
graph.set_log(config.log_graph);

module.exports = {

	set: function(key, value) {

		config[key] = value;

		switch (key) {

			// Followup actions go here.

			case "dark_mode":

				drawtools.set_dark(value);
				graph.set_dark(value);
				this.draw();
				break;

			case "log_graph":

				graph.set_log(value);
				this.draw();
				break;
		}

		if (multichecks.hasOwnProperty(key)) {
			ipcRenderer.send("set_checks", multichecks[key].concat([value]));
		}

		if (togglechecks.hasOwnProperty(key)) {
			ipcRenderer.send(value ? "set_check_true" : "set_check_false", togglechecks[key]);
		}

	},

};
