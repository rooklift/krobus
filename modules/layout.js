"use strict";

const {webFrame} = require("electron");
const config_io = require("./config_io");

// The original fixed layout is the baseline and the minimum. Browser zoom is kept
// separate: it magnifies this responsive layout instead of being cancelled by it.

const BASE_CONTENT_WIDTH = config_io.defaults.width;
const BASE_CONTENT_HEIGHT = config_io.defaults.height;

let ui_scale = 1;
let zoom_factor = 1;
let pixel_ratio = 1;

function positive_number(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function calculate_scale(width, height, zoom) {
	width = positive_number(width, BASE_CONTENT_WIDTH);
	height = positive_number(height, BASE_CONTENT_HEIGHT);
	zoom = positive_number(zoom, 1);

	// innerWidth/innerHeight are in page-zoomed CSS pixels. Multiplying by the
	// Electron zoom factor recovers the unzoomed, device-independent content size.
	return Math.max(1, Math.min(
		(width * zoom) / BASE_CONTENT_WIDTH,
		(height * zoom) / BASE_CONTENT_HEIGHT
	));
}

function update() {
	let next_zoom = positive_number(webFrame.getZoomFactor(), 1);
	let next_ratio = positive_number(window.devicePixelRatio, 1);
	let next_scale = calculate_scale(window.innerWidth, window.innerHeight, next_zoom);
	let changed = Math.abs(next_scale - ui_scale) > 0.000001 ||
			Math.abs(next_zoom - zoom_factor) > 0.000001 ||
			Math.abs(next_ratio - pixel_ratio) > 0.000001;

	ui_scale = next_scale;
	zoom_factor = next_zoom;
	pixel_ratio = next_ratio;

	document.documentElement.style.setProperty("--ui-font-size", `${16 * ui_scale}px`);
	document.documentElement.style.setProperty("--ui-min-width", `${BASE_CONTENT_WIDTH * ui_scale}px`);
	document.documentElement.style.setProperty("--ui-min-height", `${BASE_CONTENT_HEIGHT * ui_scale}px`);
	return changed;
}

function scale() {
	return ui_scale;
}

function device_pixel_ratio() {
	return pixel_ratio;
}

// Apply the current CSS size and a matching high-resolution backing store to a
// square canvas whose drawing coordinates remain in baseline pixels. Returns the
// context with that baseline-to-backing-store transform installed.

function prepare_scaled_canvas(canvas, baseline_size) {
	let css_size = baseline_size * ui_scale;
	let backing_size = Math.max(1, Math.round(css_size * pixel_ratio));

	canvas.style.width = `${css_size}px`;
	canvas.style.height = `${css_size}px`;
	if (canvas.width !== backing_size || canvas.height !== backing_size) {
		canvas.width = backing_size;
		canvas.height = backing_size;
	}

	let ctx = canvas.getContext("2d");
	let backing_scale = backing_size / baseline_size;
	ctx.setTransform(backing_scale, 0, 0, backing_scale, 0, 0);
	return ctx;
}

update();

module.exports = {
	BASE_CONTENT_WIDTH,
	BASE_CONTENT_HEIGHT,
	calculate_scale,
	update,
	scale,
	device_pixel_ratio,
	prepare_scaled_canvas,
};
