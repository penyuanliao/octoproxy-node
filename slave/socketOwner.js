/**
 * Created by Benson.Liao on 2016/5/30.
 */

const ws = require('fxNetSocket').wsClient;
const events = require('events');

util.inherits(socketOwner, events.EventEmitter); // 繼承事件

function socketOwner(sockHandle, buffer, app) {

    events.EventEmitter.call(this);

    var self = this;

    console.log('create one socket owner.');
    var socket = new net.Socket({
        handle:sockHandle
    });
    socket.readable = socket.writable = true;
    socket.server = this.app.server;

    var ws = new client(socket,function () {
        console.log('handshake successful.');

        ws.on('data', function (data) {
            console.log('Data Event is received ws-packet Stream.');
        });
        ws.on('message', function (msg) {
            console.log('Message is decode ws-packet Stream on:', msg);
            self.controller(msg);
        });

    });

    socket.emit("connect");
    socket.emit('data',buffer);
    socket.resume();

    this.ws = ws;
    this.app = app;

};

socketOwner.prototype.controller = function (tell) {

    var app = this.app;
    var ws = this.ws;
    var command = tell.split(" ");

    switch (command[0]) {
        case "/reboot":
            ws.write('reboot main server.');
            app.reboot();
            break;
        case "/restart":
            app.restart(command[1]);

    }
};


module.exports = exports = socketOwner;