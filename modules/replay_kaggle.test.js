"use strict";

const assert = require("node:assert/strict");
const replay_kaggle = require("./replay_kaggle");

const ITEMS = ["WHEAT", "CARROT", "TOMATO", "STRAWBERRY", "MELON", "EGG", "MILK", "WOOL", "FERTILIZER"];

function observation(money, shed = {}) {
	let inventory = Object.fromEntries(ITEMS.map(item => [item, 10000]));
	let prices = {WHEAT: 25, CARROT: 35, TOMATO: 60, STRAWBERRY: 120, MELON: 250,
		EGG: 50, MILK: 160, WOOL: 200, FERTILIZER: 100};
	return {
		day: 0,
		hour: 0,
		market: {inventory, prices},
		farms: [{
			money,
			farmer: [4, 4],
			hands: [],
			hires_today: 0,
			unlocked_quadrants: ["NW"],
			tiles: Array.from({length: 10}, () => Array(10).fill(null)),
		}],
		private: {shed, seeds: {}, inventories: [{}]},
		town: {unlocked_shops: []},
	};
}

let source = {
	configuration: {boardSize: 10, shedCapacity: 100},
	steps: [
		[{observation: observation(0, {WHEAT: 1}), action: {}}],
		[{observation: observation(25), action: {market: [["SELL", "WHEAT", 1]]}}],
	],
};

let replay = replay_kaggle.load(source);
let cached = replay.next_market_results(0);
assert.deepEqual(cached, [[{requested: 1, fulfilled: 1, money: 25, status: "success"}]]);
assert.strictEqual(replay.next_market_results(0), cached, "turn results are reused after load");

source.steps[1][0].action.market[0][2] = 2;
assert.strictEqual(replay.next_market_results(0), cached, "later replay mutations do not rerun the market");
assert.deepEqual(replay.next_market_results(1), [[]]);

console.log("replay kaggle tests passed");
