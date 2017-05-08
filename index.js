const request = require('request')
const async = require('async')
const Nightmare = require('nightmare')
const util = require('util')
const Breeze = require('breeze')
const packageInfo = require('./package.json')

var nightmare = Nightmare({
  show: true
})

var flow = Breeze()

// TODO: Catch errors from nightmare, test by inducing failure

// Load the entire curated collections page
flow.then(function (next) {
  var scroll = function (currentHeight, desiredHeight) {
    if (currentHeight !== desiredHeight) {
      nightmare
        .scrollTo(desiredHeight, 0)
        .wait(1000)
        .evaluate(() => document.body.scrollHeight)
        .then(function (newHeight) {
          scroll(desiredHeight, newHeight)
        })
    } else {
      next()
    }
  }

  nightmare
    .useragent(util.format('Unsplash-Downloader/%s', packageInfo.version))
    .goto('https://unsplash.com/collections/curated')
    //.then(() => scroll(null, 0))
    .then(() => next())
})

// Grab links for all the collections
flow.then(function (next) {
  nightmare
    .evaluate(function () {
      var collections = []

      document.querySelectorAll('._3GJR0 ._3Hy4V._21rCr').forEach(function (collection) {
        collections.push(collection.href)
      })

      return collections
    })
    .then(result => next(null, result))
})

// TODO: Use SGrondin/bottleneck for all requests to ensure 1 per s?
// Grab the images from the collections
flow.then(function (next, collections) {
  collections.length = 2
  async.mapSeries(collections, function (collection, callback) {
    nightmare
      .goto(collection)
      .wait(1000) // Wait to ensure that the page loads
      .evaluate(function () {
        var images = []

        document.querySelectorAll('.y5w1y .cV68d').forEach(function (image) {
          images.push(image.href)
        })

        return images
      })
      .then(result => callback(null, result))
  }, function (error, result) {
    var images = []

    for (var list of result) {
      images = images.concat(list)
    }

    next(error, images)
  })
})

// TODO: Use SGrondin/bottleneck for all requests to ensure 1 per s?
// Get the metadata for each image, and download it
flow.then(function (next, images) {
  images.length = 2
  async.mapSeries(images, function (image, callback) {
    console.log('Image', image)
    nightmare
      .goto(image)
      .evaluate(() => __ASYNC_PROPS__[0].asyncPropsSelectedPhoto)
      .then(result => callback(null, result))
  }, function (error, result) {
    next(error, result)
  })
})

// Shut down nightmare
flow.then(function (next, output) {
  console.log('Ending', output)
  nightmare.end().then()
  next(null)
})

// Any errors with short-circuit the system and go here.
flow.catch(function (err) {
  console.log('An error has occurred!', err)
})
