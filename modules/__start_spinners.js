"use strict";

const layout = require("./layout");

let redraw_frame = null;

function update_layout() {
	if (!layout.update() || redraw_frame !== null) {
		return;
	}

	redraw_frame = window.requestAnimationFrame(() => {
		redraw_frame = null;
		hub.draw();
	});
}

// Window resize covers ordinary resizing and most page-zoom changes. The short poll
// also catches a DPR change when the window moves between differently scaled displays.

window.addEventListener("resize", update_layout);
if (window.visualViewport) {
	window.visualViewport.addEventListener("resize", update_layout);
}

(function layout_spinner() {
	update_layout();
	setTimeout(layout_spinner, 127);

})();
