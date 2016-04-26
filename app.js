#! /usr/bin/env node
var cli = require('cli');
var fs = require('fs');
var http = require('https');
var readline = require('readline-sync');
var chalk = require('chalk');
var playmusic = new (require('playmusic'))();
var mplayer = require('child_process').spawn;
var os = require('os');
var m3uWriter = require('m3u').extendedWriter();
var Q = require('q');
var mkdirp = require('mkdirp');
var path = require('path');
var meta = require('ffmetadata');

var resultTypes = {
  track: '1',
  album: '3'
};

var filters = {
  onlyAlbums: function (entry) {
    return entry.type === resultTypes.album || entry.contentType == resultTypes.album;
  },

  onlyTracks: function (entry) {
    return entry.type === resultTypes.track || entry.contentType == resultTypes.track;
  }
};

cli.parse({
  song: ['s', 'The song you want to download/play.', 'string'],
  album: ['a', 'The album you want to download/play.', 'string'],
  library: ['l', 'List all items from your library (In combination with either -s or -a)'],
  downloadonly: ['d', 'If you only want to download the song instead of playing it (In combination with either -s or -a)'],
});

cli.main(function (args, options) {
  settings();
  cli.options = options;

  if (options.song) {
    lookup(options.song)
      .then(download)
      .then(play);
  }

  else if (options.album) {
    lookupAlbum(options.album)
      .then(downloadAlbum)
      .then(playAlbum)
  }

  else {
    cli.getUsage();
  }
});

function search (query, resultsFilter) {
  var deferred = Q.defer();

  playmusic.init({email: settings().email, password: settings().password}, function (err) {
    if (err) {
      cli.spinner('', true);
      cli.error(err);
      deferred.reject(err);
      return;
    }

    if (cli.options.library) {
      playmusic.getAllTracks(function (err, all) {
       var results = all.data.items.filter(function (track) {
          var match = track.title.match(query) + track.album.match(query) + track.artist.match(query);
          return match.length > 0;
        });

       if (results.length == 0) {
         cli.spinner('', true);
         cli.error('No songs/albums were found with your query in your library, please try again!');
       }

       return deferred.resolve(results.filter(resultsFilter));
      });
    }
    else {
      playmusic.search(query, 20, function (err, results) {
        if (err) {
          cli.spinner('', true);
          cli.error(err);
          return deferred.reject(err);
        }

        if (!results.entries) {
          cli.spinner('', true);
          cli.error('No songs/albums were found with your query, please try again!');
          return deferred.reject(err);
        }
        return deferred.resolve(results.entries.filter(resultsFilter));
      });
    }

  });

  return deferred.promise;
}

function lookup (query) {
  var deferred = Q.defer();

  cli.spinner('Looking up requested song');

  search(query, filters.onlyTracks).then(function (results) {
    process.stdout.write('\n');

    if (results[0].type) {
      results.forEach(function (entry, index) {
        console.log(chalk.yellow('[') + index + chalk.yellow('] ') + chalk.white(entry.track.title) + ' - ' + chalk.grey(entry.track.artist));
      });
    }
    else {
      results.forEach(function (entry, index) {
        console.log(chalk.yellow('[') + index + chalk.yellow('] ') + chalk.white(entry.title) + ' - ' + chalk.grey(entry.artist));
      });
    }

    var input = readline.questionInt('What song do you want to play? #');
    cli.spinner('', true);

    deferred.resolve(results[input].track);
  });

  return deferred.promise;
}

function lookupAlbum (query) {
  var deferred = Q.defer();

  cli.spinner('Looking up requested album');

  search(query, filters.onlyAlbums).then(function (results) {
    process.stdout.write('\n');

    results.forEach(function (entry, index) {
      console.log(chalk.yellow('[') + index + chalk.yellow('] ') + chalk.white(entry.album.name) + ' - ' + chalk.grey(entry.album.artist));
    });

    var input = readline.questionInt('What album do you want to play? #');
    cli.spinner('', true);

    deferred.resolve(results[input].album);
  });

  return deferred.promise;
}

function settings() {
  if (!fs.existsSync(getLocation('settings'))) {
    var settings = {
      'email': 'add_your_email_here',
      'password': 'add_your_password_here',
      'musicdirectory': process.env["HOME"] + '/Music/gmplayer',
      'tracknaming': '{title} - {artist}',
      'albumnaming': '{album}',
      'playlistnaming': '{name} - {albumArtist}'
    };

    fs.writeFileSync(getLocation('settings'), JSON.stringify(settings, null, 2));
    cli.fatal('Go to ~/.gmplayerrc and add your email and password');
  }
  else {
    var settings = JSON.parse(fs.readFileSync(getLocation('settings')));
    if (settings.email == 'add_your_email_here') cli.fatal('Go to ~/.gmplayerrc and add your email and password');
    else return settings;
  }
}

function mplayerArgs (filename, isPlaylist) {
  var audioEngines = {
    linux: 'alsa',
    darwin: 'coreaudio'
  }

  var audioEngine = audioEngines[os.platform()];

  if (isPlaylist) {
    return ['-ao', audioEngine, '-playlist', filename];
  }

  return ['-ao', audioEngine, filename];
}

function playAlbum (playlistFile) {
  play(playlistFile, true);
}

function play(file, playlist) {
  playlist = !!playlist; // default to false

  var player = mplayer('mplayer', mplayerArgs(file, playlist));
  var isfiltered = false;
  console.log('Playing ' + path.basename(file) + '\n');

  player.stdout.on('data', function (data) {
    if (data.toString().substr(0,2) == 'A:' && !isfiltered) {
      player.stdout.pipe(process.stdout);
      isfiltered = true;
    }
  });

  // FIXME: In order for the input piping to mplayer to work I need to require this.
  require('readline').createInterface({input : process.stdin, output : process.stdout});
  process.stdin.pipe(player.stdin);

  player.on('error', function (data) {
    cli.fatal('There was an error playing your song, maybe you need to install mplayer?');
  });

  player.on('exit', function () {
    process.exit();
  });
}

function download (track) {
  var deferred = Q.defer();
  var songPath = getTrackPath(track);
  var songDirectory = getTrackDirectory(track);

  if (fs.existsSync(songPath)) {
    console.log('Song already found in offline storage, playing that instead.');
    deferred.resolve(songPath);

    return deferred.promise;
  }

  playmusic.getStreamUrl(track.nid, function (err, url) {
    if (err) {
      cli.error(err);
      deferred.reject(err);
      return;
    }

    mkdirp(songDirectory, function (err) {
      if (err) cli.error(err);

      http.get(url, function (res) {
        var size = parseInt(res.headers['content-length']);
        if (cli.options.song) console.log('Downloading ' + customNaming(settings().tracknaming, track));

        res.on('data', function (data) {
          if (!fs.existsSync(songPath)) {
            fs.writeFileSync(songPath, data);
          } else {
            fs.appendFileSync(songPath, data);
          }
          var fileSize = fs.statSync(songPath).size;
          if (cli.options.song) cli.progress(fileSize / size);
        });

        res.on('end', function () {
          metadata(songPath, track, function () {
            if (cli.options.song && cli.options.downloadonly) process.exit();
            if (cli.options.album) cli.progress(++cli.album.size/ cli.album.total);
            deferred.resolve(songPath);
          });

        });
      });
    })
  });

  return deferred.promise;
}

function downloadAlbum (album) {
  var deferred = Q.defer();
  var lastDownload = Q('dummy');

  playmusic.getAlbum(album.albumId, true, function (err, fullAlbumDetails) {
    if (err) {
      console.warn(err);
      deferred.reject(err);
    }

    console.log('Downloading ' + fullAlbumDetails.artist + ' - ' + fullAlbumDetails.name);
    cli.album = {
      'total': fullAlbumDetails.tracks.length,
      'size': 0
    };

    cli.progress(0 / cli.album.total);

    fullAlbumDetails.tracks.forEach(function (track) {
      track.albumArtist = fullAlbumDetails.albumArtist;
      m3uWriter.file(getTrackFilename(track));
      console.log('adding download promise to chain');
      lastDownload = lastDownload.then(function(value) {
        return download(track);
      });
    });

    lastDownload.then(function () {
      cli.spinner('', true);
      if (cli.options.downloadonly) {
        writePlaylist(m3uWriter, album);
        process.exit();
      }
      return writePlaylist(m3uWriter, album);
    }).then(deferred.resolve);
  });

  return deferred.promise;
}

function writePlaylist (writer, album) {
  /* FIXME
    This is a temp fix for a custonNaming function issue,
    the getAlbumDirectory is also called during the downloading of tracks
    but the within this context the supplied object is different (album instead of track)
  */
  album.album = album.name;
  var playlistPath = path.join(
    getAlbumDirectory(album),
    customNaming(settings().playlistnaming, album) + '.m3u'
  );

  fs.writeFileSync(playlistPath, writer.toString());

  return playlistPath;
}

function getLocation(type) {
  switch (type) {
    case 'settings':
      return process.env['HOME'] + '/.gmplayerrc';
      break;
    case 'music':
      return settings().musicdirectory;
      break;
  }
}

function getTrackFilename (track) {
  return customNaming(settings().tracknaming, track) + '.mp3';
}

function getAlbumDirectory (album) {
  return path.join(
    getLocation('music'),
    customNaming(settings().albumnaming, album)
  );
}

function getTrackDirectory (track) {
  return path.join(
    getLocation('music'),
    customNaming(settings().albumnaming, track)
  );
}

function getTrackPath (track) {
  return path.join(
    getTrackDirectory(track),
    getTrackFilename(track)
  );
}

function sanitize (filename) {
  if (typeof filename !== 'string') { return; }

  return filename.replace(/\/|\\/g, '|');
}

function customNaming (string, info) {
  string = string.slice(); // duplicate string to avoid mutation issues

  for (var meta in info) {
    if (info.hasOwnProperty(meta)) {
      string = string.replace(new RegExp('{' + meta + '}', 'g'), sanitize(info[meta]));
    }
  }
  return string;
}

function metadata(path, data, cb) {
  var data = {
    artist: data.artist,
    album: data.album,
    track: data.trackNumber,
    title: data.title
  };

  meta.write(path, data, function (err) {
    if (err) console.warn(err);
    cb();
  });
}
