/**
 * @file
 * 處理ws, socket, flash socket連線
 * Created by Benson.Liao on 2015/11/20.
 * @module FxConnection
 */
"use strict";
const debug = require('debug')('Connect');
debug.log = console.log.bind(console); //file log 需要下這行
const tls = require('tls'), // SSL certificate
    fs = require('fs');
const net = require('net');
const util = require('util');
const events = require('events');
const utility = require('./FxUtility.js');
const Versions = require('./FxEnum.js').Versions;
const fxSocket = require('./FxSocket.js');

const fxStatus = require('./FxEnum.js').fxStatus;
const crypto = require('crypto');
//var clients = []; // 紀錄使用者
// var connections = 0; //記錄使用者數目

util.inherits(FxConnection, events.EventEmitter); // 繼承事件

// todo enum event dispach

/**
 * initialize net.socket
 * @param {Number} port
 * @param {Object} option
 * @constructor
 **/
function FxConnection(port, option) {

    /* Variables */
    events.EventEmitter.call(this);

    const self = this;
    /** @property {number} connections 統計人數 */
    this.connections = 0;
    this.clusters = []; // all child process group
    /* packet Splicing on subpackage */
    this.doSplitPackage = false;
    this._sockDefaults = {"binaryType":"string"};
    /* default ping user event disabled */
    this._userPingEnabled = false;
    this._fourWayHandshake = false;
    /** @property {Boolean} nPingPong 內建 ping pong 機制 */
    this.nPingPong = false;
    this.zlibDeflatedEnabled = false;
    if (typeof option === 'undefined') {
        option = {
            'runListen':true,
            'glListener' : true,
            'splitsReceiveLimitCount':20,
            'binary': false,
            'nativePingPong': false,
            'zlibDeflatedEnabled': false,
            'baseVersion': "v1"
        };
    };
    if (typeof option.splitsReceiveLimitCount != "number") option.splitsReceiveLimitCount = 100;
    if (typeof option.nativePingPong == "boolean") this.nPingPong = option.nativePingPong;
    if (typeof option.zlibDeflatedEnabled == "boolean") this.zlibDeflatedEnabled = option.zlibDeflatedEnabled;
    /**
     * @name FxConnection#baseVersion
     * @type String
     * @default v1
     */
    if (typeof option.baseVersion == "string") {
        if (option.baseVersion == Versions.v2) {
            this.baseVersion = Versions.v2;
        } else {
            this.baseVersion = Versions.v1;
            this.zlibDeflatedEnabled = false;
        }
        console.log('version:', this.baseVersion);
    }


    this.clients = [];

    this.glListener = (typeof option.glListener != "undefined" ? option.glListener : true); // 集中監聽事件 message, disconnect

    /* Codes */
    var app = this.app = net.createServer({allowHalfOpen:option.allowHalfOpen, pauseOnConnect:option.pauseOnConnect});

    var cb = function () {
        debug('Listening on ' + app.address().port);

        self.emit("Listening", app);

    };

    app.on("error", function (err) {
        self.emit("error", err);
    });
    app.on("close", function (err) {
        self.emit("close", err);
    })

    if (option.runListen)
        this.server = this.app.listen(port, "0.0.0.0", cb);

    this.app.on('connection', function(socket) {
        if (typeof option.baseEvtShow != "undefined") socket.baseEvtShow = option.baseEvtShow;
        const client = new fxSocket(socket, {
            delegate: self,
            baseVersion: self.baseVersion,
            zlibDeflatedEnabled: self.zlibDeflatedEnabled
        });
        if (typeof option.binary == "boolean") client.forcedBinary = option.binary;
        if (typeof self._fourWayHandshake == "boolean") client.finTCP = self._fourWayHandshake;

        self.setSockOptions(client);

        if (self.userPingEnabled) client.pingEnable = true;

        self.connections++;
        // First one, do check connected.
        socket.once('data', function (data) {
            const mode = utility.findOutSocketConnected(client, data, self);
            debug("[Connection] Client through Server for mode " + mode);
            if (mode == fxStatus.socket) {

            }
            if (mode != fxStatus.http)
            {
                client.isConnect = true;
                addUpdateData(mode);
                // debug("[INFO] Add client mode:",client.mode);
                self.clients[client.name] = client; //TODO 二維分組namespace物件
            } else if (client.headers["Transfer-Encoding"] == 'chunked' && client.headers["Method"] == "POST") {
                self.httpChunked(socket, client.namespace);
            } else {
                //var http = data.toString('utf8');
                //client.close();
            };
            client.emit("connect");
            if (self.nPingPong && mode == fxStatus.websocket) client.write(undefined, 9);
        });
        socket.on('close', function () {
            debug('socket.unpipe');
            if (client.revicer) {
                socket.unpipe(client.revicer.reader);
                client.revicer.release();
            }
            if (client.sender) {
                client.sender.unpipe(socket);
                client.sender.release();
            }
            chunkBuffer = undefined;
        });
        /**
         * 確定連線後連線資料事件並傳出data事件
         * @param mode 型態(fxStatus)
         * @param client 來源socket
         */
        function addUpdateData(mode) {
            if (mode !== fxStatus.websocket || client.baseVersion == "v1") {
                socket.on('data', function (data) {
                    getData(data, mode);
                });
            } else {
                debug('socket.pipe');
                socket.pipe(client.revicer.reader);
                client.sender.pipe(socket);
            }
        };
        let count = 0;
        let chunkBuffer = Buffer.from([]);
        let first = false;
        function getData(chunk, mode) {
            if (typeof chunkBuffer == "undefined" || chunkBuffer.length <= 0) {
                chunkBuffer = Buffer.from(chunk);
            } else {
                chunkBuffer = Buffer.concat([chunkBuffer, chunk], chunkBuffer.length + chunk.length);
            }
            var data;
            var currSize = chunkBuffer.length;
            if (mode === fxStatus.websocket) {
                count = 0;
                while (chunkBuffer.length > 0 && count < option.splitsReceiveLimitCount) {
                    count++;
                    var obj = client.read(chunkBuffer, !first);
                    first = true;
                    if (obj.total > chunkBuffer.length) {
                        return;
                    }
                    if (typeof obj == "undefined") obj = {opcode:8};
                    data = obj.msg;
                    if(obj.opcode == 8)
                    {
                        client.close(client.createCloseStatusCode({code: 1000, reason: ''}));
                        return; // Event Data Close
                    }
                    chunkBuffer = chunkBuffer.slice(client.protocol.total, chunkBuffer.length);
                    if (currSize == chunkBuffer.length) {
                        chunkBuffer = chunkBuffer.slice(chunkBuffer.length, chunkBuffer.length);
                    } else {
                        currSize = chunkBuffer.length;
                    }
                    if (obj.fin === false) {
                        continue;
                    }

                    if (client.encryption == "aes-256-cbc") {
                        data = client.decryption(data);
                    }

                    if (client.pingEnable && self.recordPing(client, data) == true) {

                        continue;
                    }
                    if (self.glListener)
                    {
                        if (typeof data != "undefined") self.emit("message", {'client':client,'data':data});
                    }
                    else
                    {
                        if (typeof data != "undefined") client.emit("message", data);
                    }
                }
                if (count === option.splitsReceiveLimitCount) {
                    client.emit("error", util.format("Splits the received ByteBufs on limit max count %s.", option.splitsReceiveLimitCount));
                    client.close();
                    chunkBuffer = undefined;
                }
                return;

            }
            else if (mode === fxStatus.flashSocket) {
                var offset = chunkBuffer.indexOf("\0");
                while (offset != -1) {
                    data = chunkBuffer.slice(0, offset);
                    chunkBuffer = chunkBuffer.slice(offset+1, chunkBuffer.length);
                    offset = chunkBuffer.indexOf("\0");
                    if (client.pingEnable == true && self.recordPing(client, data) == true) continue;

                    if (typeof data != "undefined" && data.length !== 0) {
                        if (self.glListener) {
                            self.emit("message", {'client':client,'data':data.toString()})
                        } else {
                            client.emit('message', data.toString());
                        }
                    }
                    data = undefined;
                }
                return;

            }
            else if (mode === fxStatus.socket) {
                data = chunkBuffer.toString('utf8');
                // packet Splicing on subpackage
                if (self.doSplitPackage) {
                    var len = doSubpackage(data, client);
                    chunkBuffer = chunkBuffer.slice(len, chunkBuffer.length);
                    return;
                } else {
                    chunkBuffer = undefined;
                }
            }
            else {
                chunkBuffer = undefined; //http
            }
            if (client.pingEnable && self.recordPing(client, data) == true) {
                chunkBuffer = chunkBuffer.slice(data.length, data.length);
                return;
            }
            if (self.glListener)
            {
                if (typeof data != "undefined") self.emit("message", {'client':client,'data':data});
            }
            else
            {
                if (typeof data != "undefined") client.emit("message", data);
            }


        }
        function doSubpackage(data, client) {
            var subpackage;
            if (typeof client.delimiter == "string") {
                if (typeof client.regexp == "undefined") client.regexp = new RegExp("(\{.+?\})(?={|" + client.delimiter + ")", "g");
                subpackage = data.match(client.regexp);
            } else {
                subpackage = data.match(/(\{.+?\})(?={|$)/g);
            }
            var len = 0;
            var json;
            for (var i = 0; i < subpackage.length; i++) {
                var packet = subpackage[i];
                try {
                    json = JSON.stringify(packet);
                    len += Buffer.byteLength(packet);
                } catch (e) {

                }
                if (self.glListener)
                    self.emit("message", {'client':client,'data':packet});
                else
                    client.emit("message", packet);
            }
            return len;
        }


        socket.on('close',  sockDidClosed);
        socket.on('end',    sockDidEnded);
        socket.on('error',  sockDidErrored);
        client.on("error", function (err) {});
    });

    function sockDidClosed() {

        const socket = this;
        socket.isConnect = false;
        self.connections--;
        const client = self.clients[socket.name];
        delete self.clients[socket.name];

        if (self.glListener)
            self.emit('disconnect', socket.name);
        else
        {
            if (typeof client != "undefined") client.emit('disconnect', socket.name);
        }
        debug('LOG::SOCKET WILL CLOSED : COUNT(%d)', self.connections);
    };

    function sockDidEnded() {
        debug('LOG::SOCKET ENDED');
        const socket = this;
        socket.end();
    };

    function sockDidErrored(e) {
        debug('LOG::SOCKET ERROR:',e);
        const client = self.clients[this.name];
        if (self.glListener) {
            self.emit('error', e);
        } else {
            if (typeof client != "undefined") client.emit('error', e);
        }

    };

};
FxConnection.prototype.clientDestroy = function (client) {

    client.write(JSON.stringify({"NetStatusEvent":"Connect.Closed"}));
    client.close();
    // this.emit('disconnect');
};
FxConnection.prototype.eventDispatch = function (client,evt) {

    if (typeof client !== 'undefined' && client !== null) return;

    // Connect.Success 1
    // Connect.Rejected 2
    // Connect.AppReboot 3
    // Connect.AppShutdown 4
    // Connect.Closed 5
    // Connect.Failed 6

    if (typeof evt === 'number') {
        var e = "";
        if (evt == 1) {
            e = "Success";
        }else if (evt == 2) {
            e = "Rejected";
        }else if (evt == 3) {
            e = "AppReboot";
        }else if (evt == 4) {
            e = "AppShutdown";
        }else if (evt == 5) {
            e = "Closed";
        }else if (evt == 6) {
            e = "Failed";
        }
        client.write(JSON.stringify({"NetStatusEvent":e}));


    }else
    {
        client.write(JSON.stringify(evt));
    }

};
/***
 * only accepts secure connections
 * @param {Object} option : {"key":"public key", "cert": "public cert"}
 *
 */
FxConnection.prototype.FxTLSConnection = function (option){
    //https server only deff need a certificate file.
    var loadKey = fs.readFileSync('keys/skey.pem');
    var loadcert = fs.readFileSync('keys/scert.pem');
    var options = {
        key : loadKey,
        cert: loadcert
    };

    tls.createServer(options, function (socket) {
        debug('TLS Client connection established.');

        // Set listeners
        socket.on('readable', function () {
            debug('TRACE :: Readable');

        });

        var client = new fxSocket(socket, {});
        socket.on('data', function (data) {
            debug('::TRACE DATA ON STL CLIENT');
            sockDidData(client, data, self);
        });

    }).listen(8081);

};

/**
 * 取得使用者物件
 * @param namespace
 * @returns {Array}
 */
FxConnection.prototype.getClients = function (namespace) {
    if (typeof namespace === 'undefined' || namespace == null ) return this.clients;

    // output array
    // TODO 不確定這樣寫法要不要留
    var keys = Object.keys(this.clients);
    var groups = [];
    for (var i = 0 ; i < keys.length; i++) {
        var socket = this.clients[keys[i]];
        if (socket.isConnect == true) {
            if (socket.namespace === namespace)
                groups.push(socket);
        }
    }
    return groups;

};
/**
 * 計算使用者數量
 * @param namespace
 * @returns {*}
 */
FxConnection.prototype.getConnections = function (namespace) {
    if (this.clients === null) return 0;
    // if (typeof namespace === 'undefined' || namespace == null ) return Object.keys(clients).length;
    // var keys = Object.keys(clients);

    // return this.getClients(namespace).length;

    return this.connections;

};
FxConnection.prototype.setMD5 = function (text) {
    return crypto.createHash('md5').update(text).digest('hex');
};

FxConnection.prototype.httpChunked = function (socket, namespace) {
    var self = this;
    socket.on('data', function (chunk) {
        self.emit('data', chunk, namespace);
    })
};
FxConnection.prototype.setSockOptions = function (client) {
    client.binaryType = this._sockDefaults["binaryType"];

    if (this._sockDefaults["ContentEncode"] != "" && typeof this._sockDefaults["ContentEncode"] != "undefined") {
        client.setEncryption = this._sockDefaults["ContentEncode"];
    }

}
FxConnection.prototype.recordPing = function (client, data) {

    if (typeof data == "undefined" || data == null) return false;
    
    if (data.indexOf('"ping":') != -1) {
        var json = JSON.parse(data);
        if (typeof json.ping != "number" && typeof json.rtt != "number") return false;
        var ping = client.probeResult(json);

        if (this.glListener)
        {
            if (typeof data != "undefined") this.emit("ping", {client:client, ping:ping});
        }
        else
        {
            if (typeof data != "undefined") client.emit("ping", ping);
        }

        return true;
    }
    return false;
}
/**
 * {Boolean} bool
 */
FxConnection.prototype.__defineSetter__("userPingEnabled", function (bool) {
    if (typeof bool == "boolean") {
        this._userPingEnabled = bool;
    }
});
FxConnection.prototype.__defineGetter__("userPingEnabled", function () {
    return this._userPingEnabled;
});


FxConnection.prototype.__defineSetter__("setBinaryType", function (mode) {
    if (mode == "string") {
        this._sockDefaults["binaryType"] = "string";
    } else if (mode.toLowerCase() == "arraybuffer")  {
        this._sockDefaults["binaryType"] = "arraybuffer";
    }
});
FxConnection.prototype.__defineSetter__("setContentEncode", function (mode) {
    if (mode == "br") {
        this._sockDefaults["ContentEncode"] = "br";
        this._sockDefaults["lock"] = true;
    } if (mode == "aes") {
        this._sockDefaults["ContentEncode"] = "aes";
        this._sockDefaults["lock"] = true;
    } else {
        this._sockDefaults["ContentEncode"] = "";
        this._sockDefaults["lock"] = false;
    }
});

module.exports = exports = FxConnection;

// unit test //

//var s = new FxConnection(8080);
//s.FxTLSConnection(null);
//s.on('connection', function (client) {
//    debug('clients:',client.name);
//    debug(s.clientsCount());
//});
//s.on('message', function (evt) {
//    debug("TRACE",evt.client.name, evt.data);
//});
//s.on('disconnect', function (socket) {
//    debug('disconnect_fxconnect_client.')
//});

