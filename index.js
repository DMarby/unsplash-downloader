var commander = require('commander');
var cheerio = require('cheerio');
var path = require('path');
var https = require('https'), http = require('http');
var request = require('request');
var fs = require('fs');
var exec = require('child_process').exec;
var noConfig = false;
try {
  var config = require('./config');
  if (!config.concurrent_downloads || !config.folder_path || config.git_push === undefined) {
    noConfig = true;
  }
} catch (e) {
  noConfig = true;
}
var pjson = require('./package.json');

try {
  var photos = require('./photos.json');
} catch (e) {
  var photos = [];
}

var highestId = photos.length;

var metadata = [];

var toDownload = [];

var pages = 0;
var page = 1;
var currentPost = 0;

if (noConfig) {
  commander
    .version(pjson.version)
    .option('-c, --concurrent_downloads <amount>', 'Amount of concurrent downloads allowed', 5)
    .option('-f, --folder_path <path>', 'Folder path of where to download the photos', 'photos')
    .option('-g, --git_push', 'Automatically commit & push to git repo in photos folder path')
    .parse(process.argv);
 }

var concurrent_downloads = !config.concurrent_downloads ? commander.concurrent_downloads : config.concurrent_downloads;
var folder_path = !config.folder_path ? commander.folder_path : config.folder_path;
var git_push = config.git_push === undefined ? commander.git_push : config.git_push;
if (!concurrent_downloads || !folder_path) {
  commander.help();
}

fs.mkdir(folder_path, function(e) {});

var getPageCount = function (callback) {
  var highestPage = 0;
  request('https://unsplash.com', function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var $ = cheerio.load(body);
      $('.pagination a').each(function (index, element) {
        var linkText = $(this).text();
        if (!isNaN(parseInt(linkText)) && (parseInt(linkText) > highestPage)) {
          highestPage = parseInt(linkText);
        }
      });
      callback(highestPage);
    }
  });
}

var downloadImage = function (the_metadata, imageId, callback) {
  request.head(the_metadata.image_url, function (err, res, body) {
    /*var original_filename = res.request.path.split('/').slice(-1)[0].split('?')[0];
    var filename = the_metadata.unsplash_id + path.extname(original_filename);*/
    var filename = imageId + '_' + the_metadata.unsplash_id + '.jpeg';
    the_metadata.filename = filename;
    the_metadata.id = imageId;
    var file = fs.createWriteStream(folder_path + '/' + filename);
    if (res.request.uri.protocol == 'https:') {
      https.get(res.request.uri.href, function (response) {
        response.pipe(file);
        file.on('finish', function () {
          file.close(function () {
            callback(the_metadata);
          });
        });
      });
    } else {
      http.get(res.request.uri.href, function (response) {
        response.pipe(file);
        file.on('finish', function () {
          file.close(function () {
            callback(the_metadata);
          });
        });
      });
    }
  });
}

var removeSpaces = function (str) {
  return str.replace(/^\s\s*/, '').replace(/\s\s*$/, '');
}

var getImageInfo = function (page, callback) {
  request('https://unsplash.com/?page=' + page, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var $ = cheerio.load(body);
      $('.photo-container').each(function (index, element) {
        var url = $(this).find('.photo a').attr('href');
        var post_url = 'https://unsplash.com' + url.replace('/download', '');
        var alternative_url = undefined;
        var imageMetadata = {
          'post_url': post_url,
          'image_url': 'https://unsplash.com' + url,
          'unsplash_id': url.replace('/photos/', '').replace('/download', '')
        }
        $(this).find('.epsilon a').each(function (index, element) {
          var linkText = $(this).text();
          var linkURL = $(this).attr('href');
          if (linkText === 'Download') {
            imageMetadata.image_url = imageMetadata.image_url ? imageMetadata.image_url : linkURL;
          } else {
            imageMetadata.author_url = 'https://unsplash.com' + linkURL;
            imageMetadata.author = linkText;
          }
        });
        if (imageMetadata.author == null) {
          var the_author = $(this).find('.epsilon p').text().split('/')[1];
          imageMetadata.author = the_author ? removeSpaces(the_author.replace('By', '')) : 'Unknown';
        }
        if (imageMetadata.image_url === undefined || photos.indexOf(imageMetadata.image_url) > -1) {
          if (imageMetadata.image_url === undefined) {
            console.log('Could not find image url for ' + post_url);
          }
        } else {
          toDownload.push(imageMetadata);
        }
      })
      callback(page);
    } else {
      console.log('Failed getting image info');
    }
  });
}

var exec_output = function (error, stdout, stderr) { 
  console.log(stdout); 
}

var exitCount = 0;

var downloadNextImage = function () { 
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
        fs.writeFile(folder_path + '/metadata.json', JSON.stringify(metadata), 'utf8', function (err) {});
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

  console.log('Downloading image ' + (idToFetch + 1) + ' of ' + toDownload.length + ' (' + toDownload[idToFetch].post_url + ')');

  downloadImage(toDownload[idToFetch], highestId++, function(the_metadata) {
    photos.push(the_metadata.image_url);
    metadata.push(the_metadata);
    downloadNextImage();
  });
}

var imageLinksCallback = function (the_callback) {
  page++;
  if (page > pages) {
    toDownload.reverse();
    for (var i = 0; i <  concurrent_downloads; i++) {
      downloadNextImage();
    }
    return;
  }
  getImageInfo(page, imageLinksCallback);
}

getPageCount(function (pageCount) {
  pages = pageCount;
  getImageInfo(1, imageLinksCallback);
})