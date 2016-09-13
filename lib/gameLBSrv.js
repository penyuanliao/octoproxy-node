/**
 * Created by Benson.Liao on 2016/8/12.
 */
const fxNetSocket   = require('fxNetSocket');
const NSLog         = fxNetSocket.logger.getInstance();
const wsClient      = fxNetSocket.wsClient;
const daemon        = fxNetSocket.daemon;
const net           = require('net');
const events        = require('events');
const util          = require('util');

util.inherits(gameLBSrv, events.EventEmitter); // 繼承事件

function gameLBSrv(options) {

    events.EventEmitter.call(this);

    this.gamSLB = options;
    this.cLBSock = undefined;
    this.callfunc = [];

    this.glb_fork_d = new daemon(options.file,{silent:false}); //心跳系統
    
}

gameLBSrv.prototype.init_daemon = function () {
    NSLog.log('info','Fx Game LB Fork init process.');
    var self = this;
    this.glb_fork_d.init();

    this.glb_fork_d.emitter.on('onGetPath', function (msg) {
        NSLog.log('info','onGetPath:', msg);
        callback(msg);
    });
    this.glb_fork_d.emitter.on('onBusy', function (msg) {
        NSLog.log('info','onBusy:', msg);
        callback(msg);
    });

    function callback(d){
        var func = self.callfunc[d.tokencode];
        if (typeof func != 'undefined' && func != null) {
            func(d.action, d);
            self.callfunc[d.tokencode] = null;
            func = null;
        }
    }

};
gameLBSrv.prototype.getLoadBalancePath = function (gameType, cb) {

    if (this.glb_fork_d == 'undefined') {
        NSLog.log('error','Fx Game LB Fork is undefined.');
        return;
    }
    var tokencode = new Date().getTime();
    this.callfunc[tokencode] = cb;

    var o = {};
    o.action    = this.LBActionEvent.GET_PATH;
    o.tokencode = tokencode;
    o.gameType  = gameType;

    this.glb_fork_d.send(o);

    return tokencode;
};
gameLBSrv.prototype.getGoDead = function (handle, source) {

    NSLog.log('error','Fx Game LB invalid socket in getGoDead().');

    this.glb_fork_d.send({'evt':'c_init',data:source}, handle,{keepOpen:false});
    setTimeout(function () {
        handle.close();
    }, 5000);
};

gameLBSrv.prototype.init = function () {
    var self = this;
    var cLBSock = self.cLBSock = new net.Socket();
    cLBSock.on('connect', function () {

        NSLog.log('info', "FX Game LB Server Socket has Connection.");

        self.cLBSock.write("/fxLB\0");
    });
    cLBSock.on('close', function () {
        setTimeout(function () {

            self.cLBSock.removeAllListeners();
            self.cLBSock = null;

            NSLog.log('warning', 'FX Casino LB Socket connect in close() after 5 secs continuous retries.');

            self.init();

        }, 5000);
    });
    cLBSock.on('error', function (err) {
        NSLog.log('err', 'FX Casino LB Socket error:', err.code);
    });
    cLBSock.on('data', function (chunk) {

        var data = chunk.toString('utf8').replace("\0","");
        var d = JSON.parse(data);
        NSLog.log('info','gameLBSrv response:', data);
        if (d.action == 'ready') {
            NSLog.log('info', "FX Game LB Server Socket has Ready.");

        }else if (d.action == 'onGetPath' || d.action == 'onBusy') {
            if (d.action == 'onBusy')
                NSLog.log('info', "the server is currently busy. please try again later (%s).", d.mTime);
            else
                NSLog.log('info', "FX Game LB Server response action:%s.", d.action , data);

            var func = self.callfunc[d.tokencode];
            if (typeof func != 'undefined' && func != null) {
                func(d.action, d);
                self.callfunc[d.tokencode] = null;
                func = null;
            }
        }


    });
    cLBSock.connect(this.gamSLB.port, this.gamSLB.host);

};

/** call and waiting callback **/
gameLBSrv.prototype.__old = function (gameType, cb) {
    /*
    var tokencode = new Date().getTime();

    setTimeout(function () {
        var o = {};
        o.action = 'onBusy';
        o.tokencode = tokencode;
        o.path = "/Hall/service.h1";
        o.mTime = 1000;
        cb(o.action,o);
    },1);
    return tokencode;
     */
    if (!this.cLBSock) {
        NSLog.log("error","Connection LoadBalance(%s) closed by update server may be down");
        return -1;
    }

    if (this.cLBSock.writable == true) {
        var tokencode = new Date().getTime();
        NSLog.log('info', 'getPath gameType:',gameType);
        this.cLBSock.write(JSON.stringify({action:'getPath', tokencode:tokencode, gameType:gameType}) + "\0");
        this.callfunc[tokencode] = cb;
        return tokencode;
    }else {
        NSLog.log('error','cLBSock.writable=false');
    }

    return -1;
};

/** 移除回傳事件 **/
gameLBSrv.prototype.removeCallbackFunc = function (tokencode) {

    if (tokencode == -1 || typeof tokencode != 'undefined') return;

    this.callfunc[tokencode] = null;
};
gameLBSrv.prototype.responseBusyHandle = function (handle, source, infos, cb) {

    var socket = new net.Socket({
        handle:handle,
        allowHalfOpen:false
    });
    socket.readable = socket.writable = true;


    var ws = new wsClient(socket, function () {
        NSLog.log('trace','handshake successful. MODE:' + ws.mode.toLocaleUpperCase());

        ws.write(infos);

        ws.destroy();

        if (!cb) return;

        setTimeout(function () {
            NSLog.log('trace','CallBack handle close()');
            cb();
        }, 10);

    });
    ws.on('data', function (data) {
        //console.log('Data Event is received ws-packet Stream.');
        NSLog.log('trace','ws data: ', data);
    });
    ws.on('message', function (msg) {
        //console.log('Message is decode ws-packet Stream on:', msg);
        NSLog.log('trace','ws message:', msg);
    });
    socket.emit("connect");
    socket.emit('data',new Buffer(source));

    socket.resume();
};
/** send fork **/
gameLBSrv.prototype._refuseRemoteWithSocket = function () {
    
};
gameLBSrv.prototype._refuseRemoteWithWebsocket = function () {

};


gameLBSrv.prototype.LBActionEvent = {
    GET_PATH:"getPath",
    ON_GET_PATH:"onGetPath",
    ON_BUSY:"onBusy"
};

module.exports = gameLBSrv;