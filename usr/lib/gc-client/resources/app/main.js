'use strict';

const { app, BrowserWindow, Tray, Menu, dialog, crashReporter, globalShortcut } = require('electron');
const path = require('path');
const url = require('url');
const os = require('os');
const decompress = require('decompress');
var ipc = require('electron').ipcMain;
const { spawn } = require('child_process');

var request = require('request');
var http = require('http');
var fs = require('fs');
var extract = require('extract-zip');
var log = require('electron-log');



// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
var mainWindow;
var osInfo = {};

// Keep a reference for dev mode
var dev = false;
if (process.defaultApp || /[\\/]electron[\\/]/.test(process.execPath)) {
  dev = true;
}


if (!dev) {

  crashReporter.start({
    productName: 'GCClient',
    companyName: 'GameCredits',
    submitURL: 'http://35.176.238.44/crashreport',
    uploadToServer: true
  });


  let Raven = require('raven');
  Raven.config('http://dec0af5da8c34828aa7c7ff8a84ba754@35.176.238.44/2', {
    release: app.getVersion()
  }).install();
}

// appPath
// console.log('appPath', app.getAppPath());
// /home/misha/gc/miner
// C:\Program Files\GameCredits\Client\0.4\resources\app
// ~/Library/Application Support/gc-client

// userData
// console.log('userData', app.getPath('userData'));
// ~/.config/gc-client
// C:\Users\peski\AppData\Roaming\gc-client
// /Users/imac/Library/Application Support/gc-client

const GC_HOME = os.platform() != 'linux' ? process.env['GC_HOME'] ? process.env['GC_HOME'] : path.join(__dirname, '../../../..') : 'not/used/for/now';
const CLIENT_ROOT = os.platform() != 'linux' ? GC_HOME + 'Client' : __dirname + '/client';
global.MINERS_PATH = app.getPath('userData') + '/miners';
const DOWNLOAD_PATH = app.getPath('userData');
// const DOWNLOAD_PATH = app.getPath('userData') + '/download';

// fs.mkdir(DOWNLOAD_PATH, function (err) {
//   if (err && err.code != 'EEXIST') log.error(err)
// });

const UPDATE_PACKAGE_FILE = DOWNLOAD_PATH + '/gc-client-update.zip';
const MINER_PACKAGE_FILE = DOWNLOAD_PATH + '/miner_temp.zip';
var UPDATE_DATA_DIR;
var major = false;
var latest_version;
var lv_arr;
var current_version = app.getVersion();
var cv_arr = current_version.split('.');

// console.log('env.GC_HOME', process.env.GC_HOME)
// console.log('GC_HOME', GC_HOME)

if (fs.existsSync(UPDATE_PACKAGE_FILE)) {
  fs.unlink(UPDATE_PACKAGE_FILE, (err) => {
    if (err) log.error(err);
  });
}

// update scheduler
var schedule = require('node-schedule');
var j = schedule.scheduleJob('42 * * * *', checkForUpdates); // minute is XX:42
// var j = schedule.scheduleJob('*/10 * * * *', checkForUpdates); // every 10 minutes

function getOsInfo() {
  let si = require('systeminformation');

  si.graphics((data) => {
    osInfo.gpu = data;
    sendOsInfo();
  });
  si.cpu((data) => {
    osInfo.cpu = data;
    sendOsInfo();
  });
  si.osInfo((data) => {
    osInfo.os = data;
    sendOsInfo();
    checkForUpdates();
  })
}

function sendOsInfo() {
  if (osInfo.cpu && osInfo.gpu && osInfo.os) {
    mainWindow.webContents.send('os_info_ready', osInfo);
  }
}

let tray = null;
var trayMenuOptions = [
  {
    label: 'Hide',
    click: () => {
      toogleMainWindow();
    }
  },
  {
    label: 'Check for updates',
    click: function () {
      checkForUpdates();
    }
  },
  {
    label: 'Quit',
    click: function () {
      app.quit();
    }
  }
];

function toogleMainWindow() {
  // console.log('mainWindow.isMinimized()', mainWindow.isMinimized());
  // console.log('mainWindow.isVisible()', mainWindow.isVisible());
  // console.log('mainWindow.isFocused()', mainWindow.isFocused());
  // console.log('---');
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  } else if (!mainWindow.isVisible()) {
    mainWindow.show();
  } else if (!mainWindow.isFocused() && os.platform() != 'win32') {
    mainWindow.focus();
  } else {
    mainWindow.hide();
  }
}

function createMainWindow() {

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 800,
    show: false,
    frame: (os.platform() === 'darwin') ? true : false,
    icon: __dirname + '/icons/GCClient.png'
  });
  mainWindow.setMinimumSize(1080, 600);

  let iconPath;
  if (os.platform() === 'win32') iconPath = __dirname + '/icons/logo-light.ico';
  else if (os.platform() === 'darwin') iconPath = __dirname + '/icons/mac-icon.png';
  else iconPath = __dirname + '/icons/GCClient.png';
  tray = new Tray(iconPath);

  tray.setContextMenu(Menu.buildFromTemplate(trayMenuOptions));
  tray.setToolTip('GC Client');

  tray.on('click', () => {
    mainWindow.show();
  })

  ipc.on('minimize', () => mainWindow.minimize());
  ipc.on('hide', () => mainWindow.hide());

  let indexPath;
  if (dev && process.argv.indexOf('--noDevServer') === -1) {
    indexPath = url.format({
      protocol: 'http:',
      host: 'localhost:8080',
      pathname: '/',
      slashes: true
    });
  } else {
    indexPath = url.format({
      protocol: 'file:',
      pathname: path.join(__dirname, 'dist', 'index.html'),
      slashes: true
    });
  }
  mainWindow.loadURL(indexPath);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    getOsInfo();
    if (dev) {
      mainWindow.webContents.openDevTools();
    }
  });

  // Emitted when the window is closed.
  // TODO: Stop active miner processes
  mainWindow.on('closed', () => mainWindow = null);

  mainWindow.on('minimize', () => setTrayVisibilityLabel(true));

  mainWindow.on('hide', () => setTrayVisibilityLabel(true));

  mainWindow.on('restore', () => setTrayVisibilityLabel(false));

  mainWindow.on('show', () => setTrayVisibilityLabel(false));

  mainWindow.on('blur', () => { if (os.platform() != 'win32') setTrayVisibilityLabel(true) })

  mainWindow.on('focus', () => { if (os.platform() != 'win32') setTrayVisibilityLabel(false) })

  makeSingleInstance();
}

app.on('ready', () => {
  createMainWindow();
  globalShortcut.register('CommandOrControl+K', () => {
    mainWindow.webContents.openDevTools();
  })
  globalShortcut.register('CommandOrControl+Shift+E', () => {
    mainWindow.webContents.send('dusko');
  })
  globalShortcut.register('CommandOrControl+H', () => {
    mainWindow.minimize();
  })
});

app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createMainWindow();
  }
});

// app.on('browser-window-blur', () => setTrayVisibilityLabel(true))

// app.on('browser-window-focus', () => setTrayVisibilityLabel(false))

function setTrayVisibilityLabel(show) {
  if (show) trayMenuOptions[0].label = 'Show';
  else trayMenuOptions[0].label = 'Hide';
  // console.log('Set label to:', show?'Show':'Hide');
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuOptions));
}

var miner_process;

app.on('before-quit', (event) => {
  // event.preventDefault();
  //Taskkill /PID 26356 /F
  // taskkill /f /s localhost /pid 18220
  if (miner_process) {
    if (os.platform() === 'win32') {
      // spawn('taskkill', ['/PID', miner_process.pid, '/F'], { detached: true });
      spawn('taskkill', ['/f', '/s', 'localhost', '/pid', miner_process.pid], { detached: true });
    } else {
      spawn('kill', ['-9', miner_process.pid], { detached: true });
    }
    // spawn('pkill', [minerName], { detached: true });
  }
  tray.destroy();
  // app.exit();
});

ipc.on('register_miner', (event, data) => {
  miner_process = data;
  console.log(miner_process ? miner_process.pid : 'miner killed');
});

var minerName;

ipc.on('miner_download', (event, miner_name) => {
  minerName = miner_name;
  startMinerDownload(miner_name);
});

function startMinerDownload(miner_name) {
  // if (fs.existsSync(global.MINERS_PATH + '/' + miner_name + '.exe') || fs.existsSync(global.MINERS_PATH + '/' + miner_name)) {
  // mainWindow.webContents.send('miner_download', 'OK');
  // return;
  // }

  // fs.readdir(global.MINERS_PATH, (err, files) => {
  //   if (!err) {
  //     for (const file of files) {
  //       console.log(file);
  //       fs.unlink(path.join(global.MINERS_PATH, file), err => {
  //         if (err) logToWebConsole('Delete file error', err);
  //       });
  //     }
  //   }
  // });

  deleteDir(global.MINERS_PATH);

  logToWebConsole(`miner download file:${miner_name}-${osInfo.os.platform.toLowerCase()}-${osInfo.os.arch}.zip`);

  var req = request({
    method: 'GET',
    uri: `https://d2i2wm2517wvw7.cloudfront.net/miners/${miner_name}-${osInfo.os.platform.toLowerCase()}-${osInfo.os.arch}.zip`
    // uri: `https://s3.ap-south-1.amazonaws.com/miner-bucket/miners/${miner_name}-${osInfo.os.platform.toLowerCase()}-${osInfo.os.arch}.zip`
  });

  let miner_temp = fs.createWriteStream(MINER_PACKAGE_FILE);
  req.pipe(miner_temp);

  var received_bytes = 0;
  var total_bytes = 0;
  req.on('response', (data) => {
    total_bytes = parseInt(data.headers['content-length']);
  });

  req.on('data', function (chunk) {
    received_bytes += chunk.length;
    mainWindow.webContents.send('miner_progress', parseInt((received_bytes * 100) / total_bytes));
  });

  req.on('end', () => {
    extract(MINER_PACKAGE_FILE, { dir: global.MINERS_PATH }, (err) => {
      if (err) {
        logError(err, 'Miner Extract Error');
      } else {
        mainWindow.webContents.send('miner_download', 'OK');
      }
      fs.unlink(MINER_PACKAGE_FILE, (err) => {
        if (err) logError(err, 'Delete file error');
      });
    });

  });
}

var deleteDir = function (dir) {
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach(function (file, index) {
      var curPath = path.join(dir, file)
      if (fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteDir(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(dir);
  }
}

function checkForUpdates() {

  if (!osInfo.os) return;

  if (fs.existsSync(UPDATE_PACKAGE_FILE)) {
    return;
  }

  var platform = osInfo.os.platform.toLowerCase();

  if (platform == 'windows') {
    spawn('setx', ['GC_SHORT_VERSION', `${cv_arr[0]}.${cv_arr[1]}`]);
  }

  request('https://s3.ap-south-1.amazonaws.com/miner-bucket/client/latest/Version.txt', (error, response, body) => {
    if (error) {
      logToWebConsole('Check version error:', error)
      return;
    }

    if (response.statusCode != 200) {
      logToWebConsole('Check version response status code error:', response.statusCode);
      return;
    }

    lv_arr = body.split('.').map(x => parseInt(x));
    latest_version = lv_arr.join('.');

    logToWebConsole(latest_version, current_version);

    if (platform != 'windows') return;

    if (compareVersions(latest_version, current_version)) {
      logToWebConsole('Update found -> ' + latest_version);

      doWindowsUpdate();
    }

  });
}

function doWindowsUpdate() {

  let update_url;
  // https://d2i2wm2517wvw7.cloudfront.net/client/0.4.10/windows/gc-client-0.4.10-x64.zip
  // https://d2i2wm2517wvw7.cloudfront.net/client/0.4.10/windows/gc-client-0.4.10-ia32.zip
  if (lv_arr[0] == cv_arr[0] && lv_arr[1] == cv_arr[1]) {
    update_url = `${latest_version}/windows/gc-client-${latest_version}-${osInfo.os.arch}-app.zip`;
  } else {
    update_url = `${latest_version}/windows/gc-client-${latest_version}-${osInfo.os.arch}.zip`;
    major = true;
  }

  var req = request({
    method: 'GET',
    uri: `https://d2i2wm2517wvw7.cloudfront.net/client/${update_url}`
  });

  req.pipe(fs.createWriteStream(UPDATE_PACKAGE_FILE));

  req.on('end', () => {
    process.noAsar = true;

    UPDATE_DATA_DIR = CLIENT_ROOT + '/' + lv_arr[0] + '.' + lv_arr[1];

    extract(UPDATE_PACKAGE_FILE, { dir: UPDATE_DATA_DIR }, (err) => {
      if (err) {
        logError(err, 'Extract update error');
        return;
      }

      process.noAsar = false;

      ipc.on('UPDATE_CH', (event, data) => {
        onUpdateResponse(data);
      });
      mainWindow.webContents.send('UPDATE_CH', latest_version);

    });
  });

}

function onUpdateResponse(restart) {
  console.log('onUpdateResponse', restart, major, UPDATE_DATA_DIR, lv_arr)
  if (restart) {
    if (major) {
      app.relaunch({ execPath: UPDATE_DATA_DIR + '/gc-client.exe' })
    } else {
      app.relaunch({ args: process.argv.slice(1).concat(['--relaunch']) })
    }
    app.quit()
  } else {
    if (major) {
      spawn('setx', ['GC_SHORT_VERSION', `"${lv_arr[0]}.${lv_arr[0]}"`]);
      // spawn('set', [`GC_SHORT_VERSION="${lv_arr[0]}.${lv_arr[0]}"`]);
    }
  }

}

function makeSingleInstance() {
  const isSecondInstance = app.makeSingleInstance((commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus();
    }
  })

  if (isSecondInstance) {
    app.quit()
  }
}

function compareVersions(a, b) {
  if (a === b) {
    return false;
  }

  var a_components = a.split(".");
  var b_components = b.split(".");

  var len = Math.min(a_components.length, b_components.length);

  // loop while the components are equal
  for (var i = 0; i < len; i++) {
    // A bigger than B
    if (parseInt(a_components[i]) > parseInt(b_components[i])) {
      return true;
    }

    // B bigger than A
    if (parseInt(a_components[i]) < parseInt(b_components[i])) {
      return false;
    }
  }

  // If one's a prefix of the other, the longer one is greater.
  if (a_components.length > b_components.length) {
    return true;
  }

  if (a_components.length < b_components.length) {
    return false;
  }

  // Otherwise they are the same.
  return false;
}

function logToWebConsole(...args) {
  let str = args.join(', ')
  console.log(str);
  if (mainWindow) mainWindow.webContents.send('main-js-logs', str);
}

function logError(err, title) {
  log.error(title, err);
  dialog.showErrorBox(title, err.message);
  if (mainWindow) mainWindow.webContents.send('main-js-logs', err);
}

// process.on('uncaughtException', err => {
//   console.log('Unhandled Error', err);
// });

// process.on('unhandledRejection', err => {
//   console.log('Unhandled Promise Rejection', err);
// });
