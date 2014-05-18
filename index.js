var commander = require('commander');
var https = require('https'), http = require('http');
var request = require("request");
var fs = require("fs");
var pjson = require('./package.json');

try {
	var photos = require('./photos.json');
} catch (e) {
	var photos = [];
}

var toDownload = [];

var folderPath = 'photos';
commander
  .version(pjson.version)
  .option('-k, --api_key [key]', 'Tumblr API Key to be used')
  .parse(process.argv);

fs.mkdir(folderPath, function(e) {});

function getPostCount (callback) {
	request('http://api.tumblr.com/v2/blog/unsplash.com/posts?api_key=' + commander.api_key, function (error, response, body) {
		if (!error && response.statusCode == 200) {
			var data = JSON.parse(body);
			callback(data.response.total_posts);
	  }
	});
}

function downloadImage (uri, callback) {
  request.head(uri, function(err, res, body) {
  	var filename = res.request.path.split("/").slice(-1)[0];
		var file = fs.createWriteStream(folderPath + '/' + filename);
		if (res.request.uri.protocol == "https:") {
			https.get(res.request.uri.href, function(response) {
				response.pipe(file);
				file.on('finish', function() {
					file.close(function () {
			  		callback(uri, filename);
					});
				});
			});
		} else {
			http.get(res.request.uri.href, function(response) {
				response.pipe(file);
				file.on('finish', function() {
					file.close(function () {
			  		callback(uri, filename);
					});
				});
			});
		}
  });
};

function getImageLinks (offset, callback) {
	request('http://api.tumblr.com/v2/blog/unsplash.com/posts?api_key=' + commander.api_key + '&offset=' + offset, function (error, response, body) {
		if (!error && response.statusCode == 200) {
			var data = JSON.parse(body);
			for(post in data.response.posts) {
				var url = data.response.posts[post].link_url;
				if(photos.indexOf(url) > -1 || url == undefined) {
					if (url == undefined) {
						console.log("Could not find image url for " + data.response.posts[post].post_url);
					}
					continue;
				}
				toDownload.push(url);
			}	
			callback(offset);  
		}
	});
}

var linkOffset = 0;
var pages = 0;
var currentPost = 0;

// Change this to download more images concurrently.
var concurrentDownloads = 5;

function downloadNextImage(){ 
    var idToFetch = currentPost++;
 
    if (currentPost > toDownload.length) {
				fs.writeFile("photos.json", JSON.stringify(photos), "utf8", function (err) {});
        return;
    }

    console.log('Downloading image ' + (idToFetch + 1) + ' of ' + toDownload.length);

 		downloadImage(toDownload[idToFetch], function(imageurl, filename) {
			photos.push(imageurl);
 			downloadNextImage();
 		});
}

function imageLinksCallback(the_callback) {
	linkOffset += 20;
	if (linkOffset > pages) {
		for (var i = 0; i <  concurrentDownloads; i++) {
			downloadNextImage();
		}
		return;
	}
	getImageLinks(linkOffset, imageLinksCallback);

}

getPostCount(function (postCount) {
	pages = Math.floor(postCount / 20) * 20;
	getImageLinks(linkOffset, imageLinksCallback);
});