"use strict";

function load(o) {					// Where o is an object already decoded from JSON.
	let ret = {r: o};
	Object.assign(ret, kaggle_replay_props);
	return ret;
}

const kaggle_replay_props = {

	// Add whatever methods are necessary to interrogate the replay.

}



module.exports = {
	load
};
