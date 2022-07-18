# Node.JS Server & ffmpeg Streaming
# 2020.02.11


### Server example

```js
var netConnection = require('fxNetSocket').netConnection;

var srv = new netConnection(8000, {runListen:true});

srv.on('Listening', function(app){});

srv.on('connection', function (client) {
    
    client.on('message', function (data) {
        console.log('received: %s', event.data);
    });
    
    client.on('disconnect', function (name) { });
    
    client.write('1. something');

});

srv.on('message', function (event) {
    console.log('client: %s', event.client.name);
    console.log('received: %s', event.data);

    event.client.write('2. something');
    
});

srv.on('disconnect', function (name) { });

srv.on('httpUpgrade', function (req, client, head) {

    console.log('## HTTP upgrade ##');
    
    client.close();
});

```

### FxLogger example

* logFileEnabled: save to file.
* consoleEnabled: locale log console to stdio.
* level: 顯示等級. ex:`'quiet', 'error', 'warning', 'info', 'debug', 'trace'`
* dateFormat: 時間格式. ex:`'[yyyy-MM-dd hh:mm:ss]'`
* fileName: 檔案名稱.
* filePath: 檔案位置.
* maximumFileSize: 檔案大小.
* id: remote log to identify resources.
* remoteEnabled: remote log console to socket.

```js

const NSLog = require('fxNetSocket').logger.getInstance();

NSLog.configure({logFileEnabled:true, consoleEnabled:true, level:'trace', dateFormat:'[yyyy-MM-dd hh:mm:ss]',fileName:fileName,filePath:__dirname+"/historyLog", maximumFileSize: 1024 * 1024 * 100,
id:process.argv[2], remoteEnabled: false});

NSLog.log('trace', 'hello world!');

```

### Daemon example
```js

const daemon = require('fxNetSocket').daemon;
var proc = new daemon('file.js', [args], {env:env});
// start child process 
proc.init();
// by send message 
proc.send(message[, sendHandle[,options]][,callback])
// by restart
// import call need 1.0 sec reboot
proc.restart();
// close the IPC channel call event
proc.stop();
// command lie kill proc 
proc.quiet();
```
### FxTCP example
```js

const tcp = new require('fxNetSocket').fxTCP();

const options = {
    'host': '0.0.0.0',
    'port': 80,
    'closeWaitTime':5000, // Setting close_wait timeout
    'backlog': 511
}

tcp.createServer(options);

tcp.on('onRead', function (nread, buffer, handle) {
    // Client to use the request Connections.
    // handle.mode
    // handle.wsProtocol
    // handle.namespace

});

```
### FxWebSocketClient example
```js

const wsClient = require('fxNetSocket').WSClient;
var option = {
  "binaryType":"arraybuffer"
};
var ws = new wsClient(socket, connectHandler);
function connectHandler() {
  // connection

  ws.on('data', function (data) {
    //console.log('Data Event is received ws-packet Stream.');
  });
  ws.on('message', function (msg) {
    //console.log('Message is decode ws-packet Stream on:', msg);
  });
}
function send(json) {
    ws.write(json);
}

```
