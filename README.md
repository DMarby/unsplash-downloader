# unsplash-downloader

Tool for downloading all curated photos from unsplash.com, written in NodeJS.

## Usage

### CLI
```shell
$ npm install -g unsplash-downloader
$ unsplash-downloader --help
```

### Programmatically
```node
const UnsplashDownloader = require('unsplash-downloader')

UnsplashDownloader.on('error', (error) => {
  console.error(error)
})

UnsplashDownloader.on('progress', (progress) => {
  console.log(progress)
})

UnsplashDownloader.on('done', () => {
  console.log('Done')
})

UnsplashDownloader.download()
```

## License
See [LICENSE.md](LICENSE.md)
