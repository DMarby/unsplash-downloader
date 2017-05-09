#!/usr/bin/env node

const colors = require('colors')
const util = require('util')
const commander = require('commander')
const packageJson = require('../package.json')
const UnsplashDownloader = require('../index.js')

commander
  .version(packageJson.version)
  .option('-f, --download-path <path>', 'Where to download the photos, defaults to ./photos', './photos')
  .option('-c, --check-for-deleted', 'Remove images that has been deleted from unsplash')
  .parse(process.argv)

console.log(colors.green('Starting downloader...'))

const downloader = new UnsplashDownloader(commander.downloadPath, commander.checkForDeleted)

downloader.on('error', (error) => {
  console.error(colors.red('An error occured, exiting.'))
  console.error(error)
  process.exit(1)
})

downloader.on('progress', (progress) => {
  if (progress.current && progress.total) {
    console.log(util.format('%s... (%s/%s)', progress.message, colors.yellow(progress.current), colors.yellow(progress.total)))
  } else {
    console.log(util.format('%s...', progress.message))
  }
})

downloader.on('done', () => {
  console.log(colors.green('Done'))
})

downloader.download()
