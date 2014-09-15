var metadata = require('./photos/metadata.json');
var fs = require('fs');
var images = [];

for (var i in metadata) {
	console.log(metadata[i]);
	if (images.indexOf(metadata[i].filename) > -1) {
		console.log('Duplicate!');
		console.log(metadata[i]);
	}
	images.push(metadata[i].filename);
	if (!fs.existsSync('./photos/' + metadata[i].filename)) {
		console.log('Missing!');
		console.log(metadata[i]);
	}
}