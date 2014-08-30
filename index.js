var commander = require('commander');
var https = require('https'), http = require('http');
var request = require('request');
var fs = require('fs');
var exec = require('child_process').exec;
var noConfig = false;
try {
  var config = require('./config');
  if (!config.api_key || !config.concurrent_downloads || !config.folder_path || config.git_push === undefined) {
    noConfig = true;
  }
} catch (e) {
  noConfig = true;
}
var pjson = require('./package.json');
var api_key;

try {
  var photos = require('./photos.json');
} catch (e) {
  var photos = [];
}

var toDownload = [];

var linkOffset = 0;
var pages = 0;
var currentPost = 0;

if (noConfig) {
  commander
    .version(pjson.version)
    .option('-k, --api_key <key>', 'Tumblr API Key to be used')
    .option('-c, --concurrent_downloads <amount>', 'Amount of concurrent downloads allowed', 5)
    .option('-f, --folder_path <path>', 'Folder path of where to download the photos', 'photos')
    .option('-g, --git_push', 'Automatically commit & push to git repo in photos folder path')
    .parse(process.argv);
 }

var api_key = !config.api_key ? commander.api_key : config.api_key;
var concurrent_downloads = !config.concurrent_downloads ? commander.concurrent_downloads : config.concurrent_downloads;
var folder_path = !config.folder_path ? commander.folder_path : config.folder_path;
var git_push = config.git_push === undefined ? commander.git_push : config.git_push;
if (!api_key || !concurrent_downloads || !folder_path) {
  commander.help();
}
fs.mkdir(folder_path, function(e) {});

function getPostCount (callback) {
  request('http://api.tumblr.com/v2/blog/unsplash.com/posts?api_key=' + api_key, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var data = JSON.parse(body);
      callback(data.response.total_posts);
    }
  });
}

function downloadImage (uri, callback) {
  request.head(uri, function (err, res, body) {
    var filename = res.request.path.split('/').slice(-1)[0];
    var file = fs.createWriteStream(folder_path + '/' + filename);
    if (res.request.uri.protocol == 'https:') {
      https.get(res.request.uri.href, function (response) {
        response.pipe(file);
        file.on('finish', function () {
          file.close(function () {
            callback(uri, filename);
          });
        });
      });
    } else {
      http.get(res.request.uri.href, function (response) {
        response.pipe(file);
        file.on('finish', function () {
          file.close(function () {
            callback(uri, filename);
          });
        });
      });
    }
  });
};

function getImageLinks (offset, callback) {
  request('http://api.tumblr.com/v2/blog/unsplash.com/posts?api_key=' + api_key + '&offset=' + offset, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var data = JSON.parse(body);
      for(post in data.response.posts) {
        var url = data.response.posts[post].link_url;
        if (photos.indexOf(url) > -1 || url == undefined) {
          if (url == undefined) {
            console.log('Could not find image url for ' + data.response.posts[post].post_url);
          }
          continue;
        }
        toDownload.push(url);
      } 
      callback(offset);  
    }
  });
}

function exec_output(error, stdout, stderr) { 
  console.log(stdout); 
}

var exitCount = 0;

function downloadNextImage () { 
  if (toDownload.length == 0) {
    console.log('Exiting, nothing to download!');
    process.exit(0);
    return;
  }
  var idToFetch = currentPost++;

  if (currentPost > toDownload.length) {
      exitCount++;
      if (exitCount >= concurrent_downloads) {
        fs.writeFile('photos.json', JSON.stringify(photos), 'utf8', function (err) {});
        if (git_push) {
          console.log('Pushing to git!');
          exec('cd ' + folder_path + ' && git add -A && git commit -am \'Add more images - ' + new Date().toLocaleDateString() + '\' && git push origin master', exec_output);
        }
        if (config.post_command) {
          console.log('Executing post_command');
          exec(config.post_command);
        }
      }
      return;
  }

  console.log('Downloading image ' + (idToFetch + 1) + ' of ' + toDownload.length + ' (' + toDownload[idToFetch] + ')');

  downloadImage(toDownload[idToFetch], function(imageurl, filename) {
    photos.push(imageurl);
    downloadNextImage();
  });
}

function imageLinksCallback (the_callback) {
  linkOffset += 20;
  if (linkOffset > pages) {
    for (var i = 0; i <  concurrent_downloads; i++) {
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