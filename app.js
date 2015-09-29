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

var resultTypes = {
  track: '1',
  album: '3'
};

cli.parse({
  song: ['s', 'The song you want to download/play.'],
  album: ['a', 'The album you want to download/play.'],
  downloadonly: ['d', 'If you only want to download the song instead of playing it'],
  // offline: ['o', 'If you want to listen to already downloaded songs']
});

cli.main(function (args, options) {
  settings();

  if (options.song) {
    lookup(args.join(' '));
  }

  if (options.album) {
    lookupAlbum(args.join(' '));
  }
  // else if (options.offline) {
  //   offline();
  // }
});

function lookup (query) {
  cli.spinner('Looking up requested song');
  playmusic.init({email: settings().email, password: settings().password}, function (err) {
    if (err) {
      console.warn(err);
      return;
    }

    playmusic.search(query, 20, function (err, results) {
      if (err) cli.error(err);
      process.stdout.write('\n');
      results.entries.forEach(function (entry, index) {
        if ('track' in entry) {
          console.log(chalk.yellow('[') + index + chalk.yellow('] ') + chalk.white(entry.track.title) + ' - ' + chalk.grey(entry.track.artist));
        }
      });

      var input = readline.questionInt('What song do you want to play? #');
      cli.spinner('', true);

      download(results.entries[input].track).then(play);
    });
  });
}

function lookupAlbum (query) {
  cli.spinner('Looking up requested album');
  playmusic.init({email: settings().email, password: settings().password}, function (err) {
    if (err) {
      console.warn(err);
      return;
    }

    playmusic.search(query, 20, function (err, results) {;
      if (err) cli.error(err);

      process.stdout.write('\n');

      function onlyAlbums (entry) {
        return entry.type === resultTypes.album;
      }

      var albumResults = results.entries.filter(onlyAlbums);

      albumResults.forEach(function (entry, index) {
        console.log(chalk.yellow('[') + index + chalk.yellow('] ') + chalk.white(entry.album.name) + ' - ' + chalk.grey(entry.album.artist));
      });

      var input = readline.questionInt('What album do you want to play? #');
      cli.spinner('', true);

      downloadAlbum(albumResults[input].album).then(playAlbum);
    });
  });
}

function settings() {
  if (!fs.existsSync(getLocation('settings'))) {
    var settings = {
      'email': 'add_your_email_here',
      'password': 'add_your_password_here'
    };

    fs.writeFileSync(getLocation('settings'), JSON.stringify(settings));
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
    return ['-ao', audioEngine, '-playlist', getLocation('music') + filename];
  }

  return ['-ao', audioEngine, getLocation('music') + filename];
}

function playAlbum (playlistFile) {
  play(playlistFile, true);
}

function play(file, playlist) {
  playlist = !!playlist; // default to false

  var player = mplayer('mplayer', mplayerArgs(file, playlist));
  var isfiltered = false;

  console.log('Playing ' + file + '\n');

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
}

function download (track) {
  var deferred = Q.defer();
  var songname = track.title + ' - ' + track.artist + '.mp3';

  if (fs.existsSync(getLocation('music') + songname)) {
    console.log('Song already found in offline storage, playing that instead.');
    deferred.resolve(songname);

    return deferred.promise;
  }

  playmusic.getStreamUrl(track.nid, function (err, url) {
    if (err) {
      cli.error(err);
      deferred.reject(err);
      return;
    }

    http.get(url, function (res) {
      res.on('data', function (data) {
        if (!fs.existsSync(getLocation('music') + songname)) {
          fs.writeFileSync(getLocation('music') + songname, data);
        } else {
          fs.appendFileSync(getLocation('music') + songname, data);
        }
      });

      res.on('end', function () {
        deferred.resolve(songname);
      });
    });
  });

  return deferred.promise;
}

function downloadAlbum (album) {
  var deferred = Q.defer();

  playmusic.getAlbum(album.albumId, true, function (err, fullAlbumDetails) {
    if (err) {
      console.warn(err);
      deferred.reject(err);
    }

    cli.spinner('', true);

    var downloadPromises = fullAlbumDetails.tracks.map(function (track) {
      var songName = track.title + ' - ' + track.artist + '.mp3';
      m3uWriter.file(getLocation('music') + songName);
      return download(track);
    });

    Q.all(downloadPromises).then(function () {
      return writePlaylist(m3uWriter, album);
    }).then(deferred.resolve);
  });

  return deferred.promise;
}

function writePlaylist (writer, album) {
  var playlistPath = getLocation('music') + album.name + '.m3u';

  fs.writeFileSync(playlistPath, writer.toString());

  return album.name + '.m3u';
}

function getLocation(type) {
  switch (type) {
    case 'settings':
      return process.env['HOME'] + '/.gmplayerrc';
    break;
    case 'music':
      return process.env['HOME'] + '/Music/';
    break;
  }
}
