#! /usr/bin/env node
var cli = require('cli');
var fs = require('fs');
var http = require('https');
var readline = require('readline-sync');
var chalk = require('chalk');
var playmusic = new (require('playmusic'))();
var mplayer = require('child_process').spawn;
var os = require('os');

cli.parse({
  song: ['s', 'The song you want to download/play.'],
  downloadonly: ['d', 'If you only want to download the song instead of playing it'],
  // offline: ['o', 'If you want to listen to already downloaded songs']
});

cli.main(function (args, options) {
  settings();
  if (options.song) {
    lookup(args.join(' '));
  }
  // else if (options.offline) {
  //   offline();
  // }
});


function lookup(query) {
  cli.spinner('Looking up requested song');
  playmusic.init({email: settings().email, password: settings().password}, function (err) {
    if (err) console.warn(err);
    else {
     playmusic.search(query, 20, function (err, results) {
      if (err) cli.error(err);
      process.stdout.write('\n');
      for (i = 0; i < results.entries.length; i++) {
        if (results.entries[i].track) {
          console.log(chalk.yellow('[') + i + chalk.yellow('] ') + chalk.white(results.entries[i].track.title) + ' - ' + chalk.grey(results.entries[i].track.artist));
        }
      }

      var input = readline.questionInt('What song do you want to play? #');
      cli.spinner('', true);

      download(results.entries[input].track);
     });
    }
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

function mplayerArgs (filename) {
  var audioEngines = {
    linux: 'alsa',
    darwin: 'coreaudio'
  }

  var audioEngine = audioEngines[os.platform()];

  return ['-ao', audioEngine, getLocation('music') + filename];
}

function play(file) {
  var player = mplayer('mplayer', mplayerArgs(file));
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

function download(track) {
  var songname = track.title + ' - ' + track.artist + '.mp3';

  if (!fs.existsSync(getLocation('music') + songname)) {
    playmusic.getStreamUrl(track.nid, function (err, url) {
      if (err) cli.error(err);
      else {
        http.get(url, function (res) {
          res.on('data', function (data) {
            if (!fs.existsSync(getLocation('music') + songname)) {
              fs.writeFileSync(getLocation('music') + songname, data);
            }
            else {
              fs.appendFileSync(getLocation('music') + songname, data);
            }
          });

          res.on('end', function () {
            play(songname);
          });
        });
      }
    });
  }
  else {
    console.log('Song already found in offline storage, playing that instead.');
    play(songname);
  }
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
