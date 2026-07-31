"use strict";

const {ipcRenderer, webUtils} = require("electron");		// webUtils might not actually exist, depending on version. Don't use it directly.

const get_path_for_file = (webUtils && webUtils.getPathForFile) ? webUtils.getPathForFile : file => file.path;

// Uncaught exceptions should trigger an alert (once only)...

window.addEventListener("error", (event) => {
	alert("An uncaught exception happened in the renderer process. See the dev console for details. The app might now be in a bad state.");
}, {once: true});

// ------------------------------------------------------------------------------------------------

window.addEventListener("dragenter", (event) => {		// Necessary to prevent brief flashes of "not allowed" icon.
	event.preventDefault();
});

window.addEventListener("dragover", (event) => {		// Necessary to prevent always having the "not allowed" icon.
	event.preventDefault();
});

window.addEventListener("drop", (event) => {
	console.log(0);
	event.preventDefault();
	let files = [];
	if (event.dataTransfer && event.dataTransfer.files) {
		console.log(1);
		for (let file of event.dataTransfer.files) {
			console.log(2);
			if (get_path_for_file(file)) {
				console.log(3);
				hub.load_replay(get_path_for_file(file));
				break;
			}
		}
	}
});

// ------------------------------------------------------------------------------------------------

ipcRenderer.on("set", (event, msg) => {
	for (let [key, value] of Object.entries(msg)) {
		hub.set(key, value);
	}
});

ipcRenderer.on("toggle", (event, msg) => {
	hub.set(msg, !config[msg]);
});

document.getElementById("canvas").addEventListener("click", (event) => {
	hub.click(event);
});

// ------------------------------------------------------------------------------------------------

ipcRenderer.on("call", (event, msg) => {
	let fn;
	if (typeof msg === "string") {																		// msg is function name
		fn = hub[msg].bind(hub);
		fn();
	} else if (typeof msg === "object" && typeof msg.fn === "string" && Array.isArray(msg.args)) {		// msg is object with fn and args
		fn = hub[msg.fn].bind(hub, ...msg.args);
		fn();
	} else {
		console.log("Bad call, msg was...");
		console.log(msg);
	}
});

