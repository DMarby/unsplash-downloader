const request = require('request')
const async = require('async')
const Nightmare = require('nightmare')
const util = require('util')
const Breeze = require('breeze')
const Bottleneck = require('bottleneck')
const packageInfo = require('./package.json')
const {EventEmitter} = require('events')
const fs = require('fs')
const path = require('path')
const mkdirp = require('mkdirp')
const userAgent = util.format('Unsplash-Downloader/%s', packageInfo.version)

module.exports = class UnsplashDownloader extends EventEmitter {
  constructor (downloadPath, checkForDeleted) {
    super()

    this.downloadPath = downloadPath
    this.checkForDeleted = checkForDeleted
    this.metadataPath = path.resolve(downloadPath, 'metadata.json')

    this.nightmare = Nightmare({
      show: process.env.NODE_ENV === 'development',
      pollInterval: 50
    })

    this.nightmare.useragent(userAgent) // Set the nightmare user agent

    this.flow = Breeze()

    // Limit requests to Unsplash to a maximum concurrency of 1
    this.limiter = new Bottleneck(1)
  }

  _setup (callback) {
    const self = this

    fs.access(self.downloadPath, (error) => {
      if (error && error.code !== 'ENOENT') {
        return callback(error)
      }

      mkdirp(self.downloadPath, (error) => {
        if (error) {
          return callback(error)
        }

        fs.access(self.metadataPath, (error) => {
          if (error) {
            if (error.code === 'ENOENT') {
              self.metadata = []
              return callback()
            }

            return callback(error)
          }

          try {
            self.metadata = require(self.metadataPath)
          } catch (ignore) {
            self.metadata = []
          }

          callback()
        })
      })
    })
  }

  _saveImageMetadata (image, callback) {
    this.metadata.push(image)
    this._saveMetadata(callback)
  }

  _saveMetadata (callback) {
    fs.writeFile(this.metadataPath, JSON.stringify(this.metadata, null, 4), 'utf8', callback)
  }

  download () {
    const self = this

    self.flow.then((next) => {
      self._setup(next)
    })

    // Load the entire curated collections page
    self.flow.then((next) => {
      self.emit('progress', { message: 'Gathering curated collections' })

      self.limiter.submit((callback) => {
        var scroll = (currentHeight, desiredHeight) => {
          if (currentHeight !== desiredHeight) {
            self.nightmare
              .scrollTo(desiredHeight, 0)
              .wait(1000)
              .evaluate(() => document.body.scrollHeight)
              .then((newHeight) => {
                scroll(desiredHeight, newHeight)
              })
              .catch((error) => callback(error))
          } else {
            callback()
          }
        }

        self.nightmare
          .goto('https://unsplash.com/collections/curated')
          .then(() => scroll(null, 0))
          .catch((error) => callback(error))
      }, next)
    })

    // Grab links for all the collections
    this.flow.then((next) => {
      self.emit('progress', { message: 'Gathering collection links' })

      self.nightmare
        .evaluate(() => {
          var collections = []

          document.querySelectorAll('._3GJR0 ._3Hy4V._21rCr').forEach((collection) => {
            collections.push(collection.href)
          })

          return collections
        })
        .then(result => next(null, result))
        .catch((error) => next(error))
    })

    // Grab the images from the collections
    this.flow.then((next, collections) => {
      async.mapSeries(collections, (collection, callback) => {
        self.emit('progress', {
          message: 'Gathering image links from collections',
          current: collections.indexOf(collection) + 1,
          total: collections.length
        })

        self.limiter.submit((callback) => {
          self.nightmare
            .goto(collection)
            .wait('.bQJ8Z ._23lr1')
            .evaluate(() => {
              var images = []

              document.querySelectorAll('.bQJ8Z ._23lr1').forEach((image) => {
                images.push(image.href)
              })

              return images
            })
            .then(result => callback(null, result))
            .catch((error) => callback(error))
        }, callback)
      }, (error, result) => {
        if (error) {
          return next(error)
        }

        var images = []

        for (var list of result) {
          images = images.concat(list)
        }

        next(null, images)
      })
    })

    // Get the metadata for each image
    this.flow.then((next, images) => {
      async.mapSeries(images, (image, callback) => {
        self.emit('progress', {
          message: 'Gathering image metadata',
          current: images.indexOf(image) + 1,
          total: images.length
        })

        self.limiter.submit((callback) => {
          self.nightmare
            .goto(image)
            .wait(1000)
            .evaluate(() => {
              function getDimensionElement () {
                var elements = document.querySelectorAll('._2buGq._3Y6hz.LmUCs._1WCyJ')

                for (var i = 0; i < elements.length; ++i) {
                  if (elements[i].textContent === 'Dimensions') {
                    return elements[i].nextSibling
                  }
                }
              }

              var dimensions = getDimensionElement().textContent.split('×')

              return {
                id: window.location.href.split('/').pop(),
                url: window.location.href,
                width: dimensions[0].trim(),
                height: dimensions[1].trim(),
                downloadUrl: document.querySelector('._1QwHQ._1l4Hh._21rCr._1zIyn._27ROS._1Tfeo._2bCz0').href,
                author: {
                  name: document.querySelector('._3XzpS._3myVE._1_w0v._2tPAp._21rCr').textContent,
                  url: document.querySelector('._3XzpS._3myVE._1_w0v._2tPAp._21rCr').href
                }
              }
            })
            .then(result => {
              result.url = image
              callback(null, result)
            })
            .catch((error) => callback(error))
        }, callback)
      }, (error, result) => {
        next(error, result)
      })
    })

    // Update metadata for existing images, download new images, delete removed images
    this.flow.then((next, images) => {
      var newImages = []

      for (var image of images) {
        var exists = self.metadata.filter((imageMetadata) => {
          return imageMetadata.id === image.id
        }).length

        if (!exists) {
          var metadata = {
            id: image.id,
            filename: util.format('%s.jpeg', image.id),
            width: image.width,
            height: image.height,
            url: image.url,
            author: image.author.name,
            author_url: image.author.url
          }

          newImages.push({
            metadata: metadata,
            downloadUrl: image.downloadUrl,
            downloadPath: path.resolve(self.downloadPath, metadata.filename)
          })
        }
      }

      var newMetadata = []

      async.eachSeries(self.metadata, (imageMetadata, next) => {
        var matchingImages = images.filter((image) => {
          return image.id === imageMetadata.id
        })

        if (!matchingImages.length) {
          if (self.checkForDeleted) {
            self.emit('progress', { message: util.format('Deleting removed image: %s', imageMetadata.filename) })

            fs.unlink(path.resolve(self.downloadPath, imageMetadata.filename), (error) => {
              if (error) {
                return next(error)
              }

              next()
            })

            return
          }

          newMetadata.push(imageMetadata)
          return next()
        }

        var matchingImage = matchingImages[0]

        imageMetadata.url = matchingImage.url
        imageMetadata.author = matchingImage.author.name
        imageMetadata.author_url = matchingImage.author.url

        newMetadata.push(imageMetadata)
        next()
      }, (error) => {
        if (error) {
          return next(error)
        }

        self.metadata = newMetadata
        self._saveMetadata((error) => {
          if (error) {
            return next(error)
          }

          next(null, newImages)
        })
      })
    })

    // Download each image
    this.flow.then((next, images) => {
      async.eachSeries(images, (image, callback) => {
        self.emit('progress', {
          message: 'Downloading images',
          current: images.indexOf(image) + 1,
          total: images.length
        })

        self.limiter.submit((callback) => {
          var file = fs.createWriteStream(image.downloadPath)

          file.on('finish', () => {
            file.close(() => {
              self._saveImageMetadata(image.metadata, (error) => {
                if (error) {
                  return callback(error)
                }

                callback(null)
              })
            })
          })

          request.get({
            url: image.downloadUrl,
            headers: {
              'User-Agent': userAgent
            }
          }, (error) => {
            if (error) {
              callback(error)
            }
          }).pipe(file)
        }, callback)
      }, (error) => {
        next(error)
      })
    })

    // Shut down nightmare
    this.flow.then((next) => {
      self.nightmare.end().then()
      self.emit('done', self.imageMetadata)
      next(null)
    })

    // Any errors will short-circuit the system and go here.
    this.flow.catch((error) => {
      self.emit('error', error)
    })
  }
}
