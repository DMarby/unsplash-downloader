#!/usr/bin/env node

const commander = require('commander')
const packageJson = require('../package.json')

commander
  .version(packageJson.version)
  .option('-c, --concurrent_downloads <amount>', 'Amount of concurrent downloads allowed', 5)
  .option('-f, --download_path <path>', 'Where to download the photos, defaults to ./photos', 'photos')
  .option('-a, --all', 'Download all images on the front page rather than just the featured ones')
  .option('-C, --check_for_deleted', 'Check if an image has been deleted/re-added, and update the metadata.')
  .parse(process.argv)

commander.help()
