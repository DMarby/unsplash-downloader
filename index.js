var async = require('async')
var commander = require('commander')
var cheerio = require('cheerio')
var request = require('request')
var fs = require('fs')
var exec = require('child_process').exec
var pretty = require('prettysize')
var archiver = require('archiver')
var pjson = require('./package.json')
var path = require('path')

var noConfig = false

var changedMetadata = false

try {
  var config = require('./config')
  
  if (!config.concurrent_downloads || !config.folder_path || !config.git_push || !config.all) {
    noConfig = true
  }
} catch (error) {
  var config = {}
  noConfig = true
}

var headers = {
  'User-Agent': 'Unsplash-Downloader'
}

if (noConfig) {
  commander
    .version(pjson.version)
    .option('-c, --concurrent_downloads <amount>', 'Amount of concurrent downloads allowed', 5)
    .option('-f, --folder_path <path>', 'Folder path of where to download the photos', 'photos')
    .option('-g, --git_push', 'Automatically commit & push to git repo in photos folder path')
    .option('-a, --all', 'Download all images on the front page rather than just the featured ones')
    .option('-C, --check_for_deleted', 'Check if an image has been deleted/re-added, and update the metadata.')
    .parse(process.argv)
}

var concurrent_downloads = !config.concurrent_downloads ? commander.concurrent_downloads : config.concurrent_downloads
var folder_path = !config.folder_path ? commander.folder_path : config.folder_path
var git_push = !config.git_push ? commander.git_push : config.git_push
var all = !config.all ? commander.all : config.all
var check_for_deleted = !config.check_for_deleted ? commander.check_for_deleted : config.check_for_deleted

if (!concurrent_downloads || !folder_path) {
  commander.help()
}

var highestId = 0

try {
  var metadata = require(folder_path + '/metadata.json')

  metadata.forEach(function (image) {
    if (image.id >= highestId) {
      highestId = image.id
    }
  })
} catch (error) {
  var metadata = []
}

var getPageCountAndDownload = function () {
  getPageCount(function (pageCount) {
    async.times(pageCount, function (page, next) {
      getImageInfo(page += 1, function (error, imageInfo) {
        if (error) {
          return next(error)
        }

        next(null, imageInfo)
      })
    }, function (error, imageInfo) {
      if (error) {
        return console.error('Error getting page count', error)
      }

      var imagesToDownload = []
      
      imageInfo.forEach(function (imageInfoList) {
        imagesToDownload = imagesToDownload.concat(imageInfoList)
      })
      
      prepareToDownloadImages(imagesToDownload)
    })
  })
}

var root_url = all ? 'https://unsplash.com/new' : 'https://unsplash.com'

var getPageCount = function (callback) {
  var highestPage = 0

  request(root_url, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var $ = cheerio.load(body)
      $('.pagination a').each(function (index, element) {
        var linkText = $(this).text()
        
        if (!isNaN(parseInt(linkText)) && (parseInt(linkText) > highestPage)) {
          highestPage = parseInt(linkText)
        }
      })

      callback(highestPage)
    }
  })
}

var imageAlreadyExists = function (imageMetadata) {
  var images = metadata.filter(function (image) {
    return image.image_url === imageMetadata.image_url
  })

  if (images.length) {
    return images[0]
  }

  return false
}

var getImageInfo = function (page, callback) {
  var imageInfo = []
  
  request(root_url + '?page=' + page, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var $ = cheerio.load(body)
      
      $('.photo-container').each(function (index, element) {
        var url = $(this).find('.photo a').attr('href')
        var post_url = 'https://unsplash.com' + url.replace('/download', '')
        var imageMetadata = {
          post_url: post_url,
          image_url: 'https://unsplash.com' + url,
          unsplash_id: url.replace('/photos/', '').replace('/download', ''),
          page: page
        }

        if (!imageMetadata.author) {
          var the_author = $(this).find('.photo-description__author h2 a')
          imageMetadata.author = the_author && the_author.text() ? removeSpaces(the_author.text()) : 'Unknown'

          if (the_author) {
            imageMetadata.author_url = 'https://unsplash.com' + the_author.attr('href')
          }
        }

        if (!imageMetadata.image_url) {
          console.log('Could not find image url for ' + post_url)
        } else {
          var exists = imageAlreadyExists(imageMetadata)

          if (exists) {
            var currentMetadata = metadata[metadata.indexOf(exists)]

            if (currentMetadata.post_url !== imageMetadata.post_url || currentMetadata.author !== imageMetadata.author || currentMetadata.author_url !== imageMetadata.author_url) {
              changedMetadata = true

              metadata[metadata.indexOf(exists)].post_url = imageMetadata.post_url
              metadata[metadata.indexOf(exists)].author = imageMetadata.author
              metadata[metadata.indexOf(exists)].author_url = imageMetadata.author_url
            }
          } else {
            imageInfo.push(imageMetadata)
          }
        }
      })

      callback(null, imageInfo)
    } else {
      callback(error ? error : response.statusCode)
    }
  })
}

var removeSpaces = function (str) {
  return str.replace(/^\s\s*/, '').replace(/\s\s*$/, '')
}

var prepareToDownloadImages = function (imagesToDownload) {
    if (!imagesToDownload.length) {
      console.log('Nothing to download!')
 
      if (check_for_deleted) {
        checkForDeletedImages()
      } else {
        if (changedMetadata) {
          postDownloadTasks()
        }
      }

      return
    }

    imagesToDownload.reverse()

    var imagesToDownloadWithId = []

    for (var i in imagesToDownload) {
      var image = imagesToDownload[i]
      image.id = ++highestId
      imagesToDownloadWithId.push(image)
    }

    downloadImages(imagesToDownloadWithId)
}

var downloadImages = function (imagesToDownload) {
  var currentPost = 0
  async.eachLimit(imagesToDownload, concurrent_downloads, function (imageToDownload, next) {
    console.log('Downloading image ' + (++currentPost) + ' of ' + imagesToDownload.length + ' (' + imageToDownload.post_url + ') on page ' + imageToDownload.page)

    downloadImage(imageToDownload, function (the_metadata) {
      if (!the_metadata) {
        console.log('Problem downloading ' + imageToDownload.post_url)
      } else {
        delete the_metadata.page
        metadata.push(the_metadata)
      }

      next()
    })
  }, function (error) {
    console.log('Done!')

    metadata.sort(function (a,b) { 
      return a.id - b.id
    })

    if (check_for_deleted) {
      checkForDeletedImages(true)
    } else {
      postDownloadTasks()
    }
  })
}

var checkForDeletedImages = function (didDownloadImages) {
  console.log('Checking for deleted images!')

  var deletedImages = []

  async.eachLimit(metadata, concurrent_downloads, function (image, next) {
    if (image.deleted) {
      return next()
    }

    request.head({ url: image.image_url, headers: headers }, function (err, res, body) {
      if (res && res.statusCode === 404) {
        console.log('%s has been deleted!', image.image_url)
        deletedImages.push(image)

        var filename = path.resolve(folder_path, image.filename)

        fs.unlink(filename, function (error) {
          if (error) { 
            console.log('Error deleting %s!', filename)
          }

          next()
        })
      } else {
        next()
      }
    })
  }, function (error) {
    deletedImages.forEach(function (image) {
      metadata[metadata.indexOf(image)] = { id: image.id, deleted: true }
    })

    if (deletedImages.length || changedMetadata || didDownloadImages) {
      postDownloadTasks()
    }
  })
}

var postDownloadTasks = function () {
  fs.writeFile(path.resolve(folder_path, 'metadata.json'), JSON.stringify(metadata, null, 4), 'utf8', function (error) {
    if (error) {
      console.log('Error writing metadata!')
      return console.log(error)
    }

    if (config.create_zip) {
      console.log('Creating zip')
      
      fs.unlink(config.create_zip, function (error) {
        var archive = archiver('zip')
        var output = fs.createWriteStream(config.create_zip)

        output.on('close', function () {
          console.log('Done creating zip, total size: %s', pretty(archive.pointer()))
          
          doGitPush()
          
          if (!git_push) {
            runPostCommand()
          }
        })

        archive.on('error', function (error) {
          console.log('Error creating zip: ')
          throw error
        })

        archive.pipe(output)

        archive.bulk([
          { expand: true, cwd: folder_path, src: ['*.jpeg', 'metadata.json'] }
        ])

        archive.finalize()
      })
    } else {
      doGitPush()

      if (!git_push) {
        runPostCommand()
      }
    }
  })
}

var downloadImage = function (the_metadata, callback) {
  var filename = String('0000' + the_metadata.id).slice(-4) + '_' + the_metadata.unsplash_id + '.jpeg'
  the_metadata.filename = filename
  var file = fs.createWriteStream(path.resolve(folder_path, filename))
 
  var deleted = false

  file.on('finish', function () {
    file.close(function () {
      if (deleted) {
        fs.unlink(path.resolve(folder_path, filename), function (error) {
          callback()
        })
      } else {
        callback(the_metadata)
      }
    })
  })

  request.get({ url: the_metadata.image_url, headers: headers })
    .on('response', function (response) {
      if (response.statusCode === 404) {
        deleted = true
      }
    })
    .pipe(file)
}

var doGitPush = function () {
  if (git_push) {
    console.log('Pushing to git!')
    exec('cd ' + folder_path + ' && git add -A . && git commit -am \'Update images - ' + new Date().toLocaleDateString() + '\' && git push origin master', function (error, stdout, stderr) {
      console.log(stdout)
      runPostCommand()
    })
  }
}

var runPostCommand = function () {    
  if (config.post_command) {
    console.log('Executing post_command')
    exec(config.post_command, function (error, stdout, stderr) {
      console.log(stdout)
    })
  }
}

fs.mkdir(folder_path, function (error) {
  getPageCountAndDownload()
})