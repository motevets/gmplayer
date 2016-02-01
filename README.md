## gmplayer

![gmplayer in urxvt](http://i.imgur.com/n8Vquoq.png)

God, it's almost becoming my main thing. Making CLI based web streaming music players. I started with [gplayer](http://github.com/96aa48/gplayer.git) for Grooveshark, proceeded with [yplayer](http://github.com/96aa48/yplayer.git) for Youtube and now with gmplayer for Google Play Music. Just use it as before, but now with `gmp` and `gmplayer`. Use `-s` and then your search query. Make sure you Google Play Music All Access, since uploaded files aren't supported (yet!).

## Install :
```
npm install gmplayer -g
```

## Usage :
```
Usage:
  gmp [OPTIONS] [ARGS]

Options:
  -s, --song             The song you want to download/play.
  -a, --album            The album you want to download/play.
  -d, --downloadonly     If you only want to download the song instead of
                         playing it
  -h, --help             Display help and usage details

```

## LICENSE
Check out the `LICENSE` file for more information.
