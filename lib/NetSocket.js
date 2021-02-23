/**
 * Created by Benson on 2017/4/17.
 *
 *
 */
const os     = require("os");
const net    = require("net");
const tls    = require("tls");
const http   = require("http");
const https  = require("https");
const util   = require("util");
const path   = require('path');
const exec   = require('child_process').exec;
let NSLog;
try {
    NSLog = require("fxNetSocket").logger.getInstance();
} catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') {
        throw e;
    }
    NSLog = require("../fxNetSocket").logger.getInstance();
    // NSLog = console;
}
const EventEmitter = require("events");
const RetryWaitTime = 1000;

util.inherits(NetServer, EventEmitter);
/**
 *
 * @param {Object} [options]
 * @param {Boolean} [options.ipc] UNIX Domain Socket IPC 機制
 * @param {String} [options.sockPath] IPC連線檔案路徑
 * @param {String} [options.name] IPC連線檔案名稱
 * @param {String} [options.delimiter] 結尾服後
 * @param {Number} [options.port] IP埠號
 * @param {String} [options.host] IP位址
 * @param {Boolean} [options.listen] 監聽模式
 * @param {Boolean} [options.web] 啟動Http模式
 * @param {Boolean} [options.coSocketsEnabled]
 * @param {Boolean} options.tlsEnabled 開啟傳輸層安全性協定
 * @param {Object} [options.tlsCerts] tls憑證
 * @param {String} options.tlsCerts.certFile 憑證
 * @param {String} options.tlsCerts.keyFile 私鑰
 * @version 2.0.0
 * @description 2.x 提供tls加密
 * @constructor
 */
function NetServer(options) {
    EventEmitter.call(this);
    this.coSocketsEnabled = true;
    if (typeof options == "undefined") {
        options = {web:false, tlsEnabled: false};
        if (typeof options.coSocketsEnabled != "undefined") {
            this.coSocketsEnabled = options.coSocketsEnabled;
        }
    }

    this.clients = [];
    this.options = JSON.parse(JSON.stringify(options));
    if (typeof options != "undefined") {
        this.ipc = options.ipc;
        if (typeof options.name != "undefined") {
            this.sockPath = path.join(os.tmpDir(), options.name + "." + "node.ipc");
            exec('rm -rf ' + this.sockPath);
        }
        if (typeof this.options.tlsEnabled == "undefined") this.options.tlsEnabled = false;
        if (typeof this.options.tlsCerts == "undefined") {
            this.options.tlsEnabled = false;
        } else {
            this.options.tlsCerts.key = fs.readFileSync(this.options.tlsCerts.keyFile);
            this.options.tlsCerts.cert = fs.readFileSync(this.options.tlsCerts.certFile);
        }
    }
    Object.defineProperty(this, "delimiterRegexp", {
        value: new RegExp("(\{.+?\})(?={|$)", "g"),
        writable:false,
        configurable:false
    });
    Object.defineProperty(this, "handle", {
        get:function () {
            if (typeof this.server != "undefined") return this.server;
        },
        enumerable:false,
        configurable:false
    });

    this.init();
}
NetServer.prototype.setCollectSockets = function (enabled) {
    if (typeof enabled == "boolean") {
        this.coSocketsEnabled = enabled;
    }
};
NetServer.prototype.init = function () {

    const self = this;
    const port = this.options.port;
    const host = (typeof this.options.host == "undefined") ? "0.0.0.0": this.options.host;
    const web  = (typeof this.options.web == "undefined") ? false: this.options.web;
    let webServer;
    if (web) {
        NSLog.log("debug", "Create HTTP server.");
        if (this.options.tlsEnabled) {
            webServer = https.createServer(this.options.tlsCerts, function (req, res) {
                self.emit("httpConnection", req, res);
            });
        }
        else {
            webServer = http.createServer(function (req, res) {
                self.emit("httpConnection", req, res);
            });
        }
    }
    const onConnectionListener = function (socket) {
        socket.chunkBuffer = null;
        socket.chunkBufSize = 0;
        socket.delimiter = "";
        if (!web) self.emit("connection", socket);
        const onRuleData = function (data) {
            socket.removeListener("data", onRuleData);
            if ((data.indexOf('HTTP/') != -1)) {
                const isws = (data.toString().indexOf("Upgrade: websocket") != -1);
                if (typeof webServer == "undefined" || isws) {
                    socket.destroy();
                    return;
                }
                socket.server = null; //bug:TypeError: ParserIncomingMessage is not a constructor
                webServer.emit("connection", socket);
                socket.emit("data", data);
                return;
            } else {
                if (web) self.emit("connection", socket);
            }

            let json;
            let tmp = String(data).replace(/\0+/g, "");
            const mode = (data.indexOf('\u0000') != -1) ? "flashSocket" : "socket";

            try {
                let arr = tmp.toString().match(self.delimiterRegexp);

                if (arr.length > 1) {

                } else {
                    json = JSON.parse(tmp);
                }

                if (typeof tmp == "string" && json.action == "setup") {
                    json.mode = mode;
                    socket.configure = json;
                    socket.name =  socket["remoteAddress"] + "\:" + socket["remotePort"];
                    self.initDelimiterRegexp(socket);
                    if (mode == "socket")
                        socket.on("data", onSocketData);
                    else
                        socket.on('data', onData);

                    if (self.coSocketsEnabled) {
                        self.clients[socket.name] = socket;
                    }

                    if (json.protobuf != true) socket.write(JSON.stringify({action:"onSetup", event:true, protobuf: false}) + socket.delimiter);
                    socket.emit("setup", json);
                } else {
                    socket.write(JSON.stringify({action:"onSetup", event:false, protobuf: false}) + socket.delimiter);
                    throw new Error('NOT_SETUP');
                }
            } catch (e) {
                NSLog.log("error", "onRuleData: ", e);
                socket.destroy();
            }


        };

        const onData = function(data) {
            self.onFlashSocketData(data, socket);
        };
        const onSocketData = function (data) {

            self.onSocketData(data, socket);
        };

        socket.once("data", onRuleData);

        socket.on('end' , function(err){
            NSLog.log("trace", 'end close....' + err);
            socket.end();
        });

        socket.on('error' , function(error) {
            NSLog.log("debug", 'socket error:', error.code);
            socket.destroy();
        });
        socket.on('close' , function(error) {
            if (self.coSocketsEnabled) {
                self.clients[socket.name] = undefined;
                delete self.clients[socket.name];
            }
            socket.isRelease = true;
            socket.chunkBuffer = undefined;
            socket.chunkBufferSize = 0;
        })

    }
    const server = (this.options.tlsEnabled ? tls.createServer(this.tlsCerts, onConnectionListener) : net.createServer(onConnectionListener));
    if (typeof this.options["listen"] == "undefined" ) this.options["listen"] = true;
    const listening = function listening(err) {
        if (err) throw err;
        NSLog.log("quiet", 'server bound port:', port);
        self.emit("completed");
    };
    const retying = function retying() {
        server.removeListener("listening", listening);
        server.listen(arg1, listening);
    }
    let arg1 = {port:port, host:host};
    if (this.options["listen"]) {
        if (arg1.host === "127.0.0.1") delete arg1.host;
        if (this.options.ipc == true) {
            arg1 = this.options.sockPath;
        }
        server.listen(arg1 , listening);
    } else {
        NSLog.log("quiet", 'server not listen');
        setTimeout(function () {
            self.emit("completed")
        }, 1000);
    }

    server.on('error', function (err) {
        NSLog.log("error", "net.createServer :", err.message);
        server.close()
    });
    server.on("close", function () {
        setTimeout(retying, RetryWaitTime);
    });

    this.server = server;
    this.webServer = webServer;
};
NetServer.prototype.initDelimiterRegexp = function (socket) {
    if (typeof socket.configure != "undefined" && socket.configure.proto == "protoBuf") {
        socket.delimiter = socket.configure.delimiter;
        socket.delimiterLength = Buffer.byteLength(socket.delimiter);

    } else if (typeof socket.configure != "undefined" && typeof socket.configure.delimiter == "string" && socket.configure.delimiter != ""
        && typeof socket.configure.typedef != 'undefined' && socket.configure.typedef != "json") {
        Object.defineProperty(socket, "delimiterRegexp", {
            value: new RegExp("(.+?)(?={|" + socket.configure.delimiter + ")", "g"),
            writable:false,
            configurable:false
        });
        socket.delimiter = socket.configure.delimiter;
        socket.delimiterLength = Buffer.byteLength(socket.delimiter);
    } else if (typeof socket.configure != "undefined" && typeof socket.configure.delimiter == "string") {
        Object.defineProperty(socket, "delimiterRegexp", {
            value: new RegExp("(\{.+?\})(?={|" + socket.configure.delimiter + ")", "g"),
            writable:false,
            configurable:false
        });
        socket.delimiter = socket.configure.delimiter;
        socket.delimiterLength = Buffer.byteLength(socket.delimiter);
    } else {
        socket.delimiter = "";
        socket.delimiterLength = 0;
    }
    if (typeof socket.configure.typedef != "undefined") {
        socket.configure.str = (socket.configure.typedef == "string");
        // socket.configure.buf = (socket.configure.typedef == "buffer");
        socket.configure.buf = (socket.configure.typedef == "buffer") || (socket.configure.typedef == "protobuf");
        socket.configure.protobuf = (socket.configure.typedef == "protobuf");
    }
};
NetServer.prototype.onProtoBufData = function (data, socket) {
    let offset = 0;
    let packetSize = 0;
    let raw;
    let rawLen;
    if (typeof this.contentLength != "undefined" && this.contentLength != null) {
        const i = socket.chunkBuffer.indexOf(socket.delimiter);
        if (i != -1) {
            rawLen = Number(socket.chunkBuffer.slice(0, i).toString());
            offset += socket.delimiterLength;
            offset += i;

            if (isNaN(rawLen)) {
                socket.chunkBuffer = socket.chunkBuffer.slice(offset, socket.chunkBuffer.length);
                socket.chunkBufSize -= offset;
                return false;
            }
            this.contentLength = rawLen;
            packetSize = offset + socket.delimiterLength + rawLen;
        } else {
            return false;
        }
    } else {
        rawLen = this.contentLength;
        packetSize = offset + socket.delimiterLength + rawLen;
    }
    if (socket.chunkBuffer.length >= packetSize) {

        raw = socket.chunkBuffer.slice(i + socket.delimiterLength, rawLen + i);
        offset += raw.length;
        offset += socket.delimiterLength;
        socket.chunkBuffer = socket.chunkBuffer.slice(offset, socket.chunkBuffer.length);
        socket.chunkBufSize -= offset;
        this.contentLength = null;
        return raw;
    } else if (offset > 0){
        socket.chunkBuffer = socket.chunkBuffer.slice(offset, socket.chunkBuffer.length);
        socket.chunkBufSize -= offset;
        return false;
    } else {
        return false;
    }
};
NetServer.prototype.onSocketData = function (data, socket) {
    this.updateBuffer(socket, data);
    if (socket.configure.proto === "protoBuf") {
        while (socket.chunkBuffer.length > 0) {
            data = this.onProtoBufData(data, socket);
            if (data === false) return;
            socket.emit("message", data);
        }
        return;
    }
    // buffer data
    if (typeof socket.configure != "undefined" && socket.configure.buf === true) {
        let index = socket.chunkBuffer.indexOf(socket.delimiter);
        let count = 0;

        while (index != -1) {

            try {
                const bLen = index + socket.delimiterLength;
                const packet = socket.chunkBuffer.slice(0, index);
                socket.chunkBuffer = socket.chunkBuffer.slice(bLen, socket.chunkBuffer.length);
                socket.chunkBufSize -= bLen;
                socket.emit("message", packet);
            } catch (e) {
                NSLog.log("error","buf.NetServer.onData error:%s", e);
            }

            index = socket.chunkBuffer.indexOf(socket.delimiter);
            if (count++ > 1000) return;
        }
        return;
    }

    let regexp = (typeof socket.delimiterRegexp != "undefined") ? socket.delimiterRegexp : this.delimiterRegexp;

    let arr = socket.chunkBuffer.toString().match(regexp);
    if (typeof arr == "undefined" || !arr) arr = [];

    for (let i = 0 ; i < arr.length; i++) {
        try {
            let one = arr[i];
            let len = Buffer.byteLength(arr[i]) + socket.delimiterLength;
            let json;
            socket.chunkBuffer = socket.chunkBuffer.slice(len, socket.chunkBuffer.length);
            socket.chunkBufSize -= len;
            if (typeof this.configure != "undefined" && this.configure.str === true) {
                json = one;
            } else {
                json = JSON.parse(one);
            }

            socket.emit("message", json);

        } catch (e) {
            NSLog.log("error","onSocketData.error", e);
        }
    }
};
NetServer.prototype.onFlashSocketData = function (data, socket) {
    const self = this;
    self.updateBuffer(socket, data);

    let pos = socket.chunkBuffer.indexOf('\u0000');
    let count = 0;
    while (pos != -1) {

        if (pos != 0) {
            data = socket.chunkBuffer.slice(0,pos);
            socket.chunkBufSize -= data.byteLength;
            socket.chunkBuffer = socket.chunkBuffer.slice(data.byteLength, socket.chunkBuffer.length);

            let tmps = String(data).replace(/\0+/g, "");
            if (tmps.length > 0){
                let jsonObj;
                if (typeof self.configure != "undefined" && self.configure.buf === true) {
                    jsonObj = Buffer.from(tmps);
                } else if (typeof self.configure != "undefined" && self.configure.str === true) {
                    jsonObj = tmps;
                } else {
                    jsonObj = JSON.parse(tmps);
                }
                socket.emit("message", jsonObj);
            }
        } else {
            socket.chunkBuffer = socket.chunkBuffer.slice(1, socket.chunkBuffer.length);
            socket.chunkBufSize -= 1;
        }

        pos = socket.chunkBuffer.indexOf('\u0000');
        if (count++ > 1000) return;
    }

    if (pos = 0 && socket.chunkBufSize == 1 || socket.chunkBuffer.length == 0) {
        socket.chunkBufSize = 0;
        socket.chunkBuffer = null;
    }
};
NetServer.prototype.updateBuffer = function (socket, data) {
    // NSLog.log("debug", '#2 length - ', data.length, data);
    if (!socket.chunkBuffer || socket.chunkBuffer == null || typeof socket.chunkBuffer == 'undefined'){
        //NSLog.log("debug", '#1 ',socket.chunkBuffer, ((socket.chunkBuffer != null) ? socket.chunkBuffer.length : 0) );
        socket.chunkBuffer = Buffer.from(data);
    } else
    {
        if (socket.chunkBuffer.length == 0) {
            socket.chunkBuffer = Buffer.from(data);
        } else
        {
            const total = socket.chunkBuffer.length + data.length;
            socket.chunkBuffer = Buffer.concat([socket.chunkBuffer,data], total);
        }
    }

    socket.chunkBufSize += data.length;
};
NetServer.prototype.send = function (socket, message) {
    if (!(socket.writable && !socket.destroyed)) return false;
    if (typeof message == "undefined") return false;
    const payload = this.dataFragment(socket, message);
    socket.write(payload);
    return true;
};
NetServer.prototype.dataFragment = function (socket, message) {
    let payload;
    if (typeof message == "undefined") return null;
    if (socket.mode == "flashSocket") {
        payload = JSON.stringify(message) + "\u0000";
    } else if (typeof socket.configure != "undefined" && socket.configure.proto == "protoBuf") {
        let cLen = message.length + socket.delimiterLength;
        let size = Buffer.from(cLen + socket.delimiter);
        let rawLen = size.length + cLen;
        payload = Buffer.concat([size, message, Buffer.from(socket.delimiter)], rawLen);
    } else if (typeof socket.configure != "undefined" && socket.configure.buf) {
        if (Buffer.isBuffer(message) == false) message = Buffer.from(message);
        payload = Buffer.concat([ message, Buffer.from(socket.delimiter)]);
    } else if ((typeof socket.configure != "undefined" && socket.configure.str) || typeof message == "string") {
        payload = message + socket.delimiter;
    } else {
        payload = JSON.stringify(message) + socket.delimiter;
    }
    return payload;
};
NetServer.prototype.bundling = function (handle) {
    if (typeof this.server != "undefined" && this.options.listen == false) {
        this.server.listen(handle);
        return true;
    }
    return false;
}

/**
 *
 * @param {Object} [options]
 * @param {String} [options.typedef] transfer type (buffer, string, json)
 * @param {String} [options.mode]
 * @param {String} [options.host]
 * @param {String} [options.ip]
 * @param {String} [options.delimiter]
 * @constructor
 */
function NetSocket(options) {
    EventEmitter.call(this);
    this.isSetup   = false;
    this.isClosed  = false;
    this.destroyed = true;
    this.options = options || {};
    if (typeof options != "undefined" && typeof options.mode == "string") {
        this.mode = options.mode;
    } else {
        this.mode = "socket";
    }
    if (typeof this.options.ip != "undefined" && typeof this.options.host == "undefined") {
        this.options.host = this.options.ip;
    }
    if (typeof this.options.typedef == "undefined") {
        this.options.typedef = "json";
    }
    let delimiter = "";
    let delRegExp;
    if (typeof options != "undefined" && typeof options.delimiter == "string" && options.delimiter != "" && options.typedef != "json") {
        delimiter = options.delimiter;
        delRegExp = new RegExp("(.+?)(?=" + delimiter + ")", "g");
    }
    else if (typeof options != "undefined" && typeof options.delimiter == "string" && options.typedef == "json") {
        delimiter = options.delimiter;
        delRegExp = new RegExp("(\{.+?\})(?={|" + delimiter + ")", "g");
    } else {
        delimiter = "";
        delRegExp = new RegExp("(\{.+?\})(?={|$)", "g");
    }
    Object.defineProperty(this, "delimiterRegexp", {
        value: delRegExp,
        writable:false,
        configurable:false
    });
    Object.defineProperty(this, "delimiter", {
        value: delimiter,
        writable:false,
        configurable:false
    });
    Object.defineProperty(this, "delimiterLength", {
        value: Buffer.byteLength(delimiter),
        writable:false,
        configurable:false
    });

}
util.inherits(NetSocket, EventEmitter);

NetSocket.prototype.connect = function () {
    if (this.mode == "socket") {
        this.socket = this.init(this.options);
    } else if (this.mode == "ipc") {
        this.socket = this.init(this.options);
    } else {
        this.socket = this.init2FMS(this.options);
    }
    const self = this;
    Object.defineProperty(this, "isConnect", {
        get:function () {return (self.socket.writable && !self.socket.destroyed && !self.destroyed && !self.socket.connecting); },
        enumerable:false,
        configurable:false
    });
};

NetSocket.prototype.init = function (options) {

    const self = this;
    var sock;
    if (options.ipc) {
        sock = net.connect(options.sockPath);
    } else {
        sock = new net.Socket();
    }
    sock.on("connect", function () {
        self.destroyed = false;
        self.emit("connect");
    });
    sock.on("data", function (data) {
        self.updateBuffer(sock, data);
        // buffer data
        if (typeof self.configure != "undefined" && self.configure.buf === true) {
            let index = sock.chunkBuffer.indexOf(self.delimiter);
            while (index != -1) {
                try {
                    const bLen = index + self.delimiterLength;
                    const packet = sock.chunkBuffer.slice(0, index);
                    sock.chunkBuffer = sock.chunkBuffer.slice(bLen, sock.chunkBuffer.length);
                    sock.chunkBufSize -= bLen;
                    self.emit("message", packet);
                } catch (e) {
                    NSLog.log("error","buf.netSocket.onData error:%s", e, self.delimiterRegexp);
                }

                index = sock.chunkBuffer.indexOf(self.delimiter);
            }
            return;
        }
        const arr = sock.chunkBuffer.toString().match(self.delimiterRegexp);
        if (typeof arr == "undefined" || arr == null) return;
        for (let i = 0 ; i < arr.length; i++) {
            try {
                const len = Buffer.byteLength(arr[i]) + self.delimiterLength;
                let json;
                if (typeof self.configure != "undefined" && self.configure.str === true) {
                    json = arr[i];
                } else {
                    json = JSON.parse(arr[i]);
                }
                sock.chunkBuffer = sock.chunkBuffer.slice(len, sock.chunkBuffer.length);
                sock.chunkBufSize -= len;
                arr[i] = undefined;
                self.emit("message", json);
            } catch (e) {
                NSLog.log("error","netSocket.onData host:%s:%s error:%s", self.options.host, self.options.port, e, self.delimiterRegexp, arr);
            }


        }
        arr.length = 0;
    });
    sock.on("error", function (err) {
        self.emit("failure", err);
        if (err) sock.destroy();
    });
    sock.on("close", function () {
        self.destroyed = true;
        setTimeout(function () {
            sock.chunkBuffer = undefined;
            sock.chunkBufSize = 0;
            self.isSetup = false;
            if(self.isClosed != true) sock.connect(options.port, options.host);
        }, 5000);
        self.emit("close");
    });
    sock.connect(options.port, options.host);

    return sock;
};

NetSocket.prototype.init2FMS = function (options) {
    const self = this;
    var sock = new net.Socket();
    sock.on("connect", function () {
        self.destroyed = false;
        self.emit("connect");
    });
    sock.on("data", function (data) {
        self.updateBuffer(sock, data);

        let pos = sock.chunkBuffer.indexOf('\u0000');

        while (pos != -1) {

            if (pos != 0) {
                data = sock.chunkBuffer.slice(0,pos);
                sock.chunkBufSize -= data.byteLength;
                sock.chunkBuffer = sock.chunkBuffer.slice(data.byteLength, sock.chunkBuffer.length);

                let tmps = String(data).replace(/\0+/g, "");
                if (tmps.length > 0){
                    let jsonObj;
                    if (typeof self.configure != "undefined" && self.configure.buf === true) {
                        jsonObj = Buffer.from(tmps);
                    } else if (typeof self.configure != "undefined" && self.configure.str === true) {
                        jsonObj = tmps;
                    } else {
                        jsonObj = JSON.parse(tmps);
                    }

                    self.emit("message", jsonObj);
                }
            } else {
                sock.chunkBuffer = sock.chunkBuffer.slice(1, sock.chunkBuffer.length);
                sock.chunkBufSize -= 1;
            }

            pos = sock.chunkBuffer.indexOf('\u0000');
        }

        if (pos = 0 && sock.chunkBufSize == 1 || sock.chunkBuffer.length == 0) {
            sock.chunkBufSize = 0;
            sock.chunkBuffer = null;
        }
    });
    sock.on("error", function (err) {
        if (err) sock.destroy();
    });
    sock.on("close", function () {
        self.destroyed = true;
        setTimeout(function () {
            sock.chunkBuffer = undefined;
            sock.chunkBufSize = 0;
            sock.connect(options.port, options.host);
        },5000)

    });
    sock.connect(options.port, options.host);

    return sock;
};
NetSocket.prototype.updateBuffer = function (socket, data) {
    // NSLog.log("debug", '#2 length - ', data.length, data);
    if (!socket.chunkBuffer || socket.chunkBuffer == null || typeof socket.chunkBuffer == 'undefined'){
        //NSLog.log("debug", '#1 ',socket.chunkBuffer, ((socket.chunkBuffer != null) ? socket.chunkBuffer.length : 0) );
        socket.chunkBuffer = Buffer.from(data);
    }else
    {
        if (socket.chunkBuffer.length == 0) {
            socket.chunkBuffer = Buffer.from(data);
        }else
        {
            const total = socket.chunkBuffer.length + data.length;
            socket.chunkBuffer = Buffer.concat([socket.chunkBuffer,data], total);
        }
    }

    socket.chunkBufSize += data.length;
};
NetSocket.prototype.send = function (message) {
    if (typeof message == "undefined") return;
    if (this.isSetup == false) {
        message = (typeof message == "string") ? JSON.parse(message) : message;
        if (this.mode == "socket" && (typeof message != "object" || message.action != "setup")) {
            return;
        }
    }
    if (typeof message === "string") {
        this.socket.write(message + this.delimiter);
        return;
    }
    if (typeof this.configure != "undefined" && Buffer.isBuffer(message) && this.configure.proto == "protoBuf") {
        const cLen = message.length + this.socket.delimiterLength;
        const size = Buffer.from(cLen + this.delimiter);
        const rawLen = size.length + cLen;
        this.socket.write(Buffer.concat([size, message, Buffer.from(this.delimiter)], rawLen));
        return;
    }

    let json = (typeof message == "object") ? JSON.stringify(message) : message;
    if (this.mode != "socket") {
        this.socket.write(json + "\0");
    } else if (message.action == "setup") {
        if (this.options.typedef == "protobuf") {
            message.buf = true;
            message.protobuf = true;
        }
        if (this.options.typedef == "buffer") message.buf = true;
        if (this.options.typedef == "string") message.str = true;
        if (typeof this.options.delimiter != "undefined" && typeof message.delimiter == "undefined") message.delimiter = this.options.delimiter;
        json = JSON.stringify(message);
        this.socket.write(json);
        this.configure = message;
        this.isSetup = true;
    } else if (typeof this.configure != "undefined" && this.configure.buf) {
        if (Buffer.isBuffer(message) === false) {
            this.socket.write(json + this.delimiter);
            return;
        }
        this.socket.write(Buffer.concat([ message, Buffer.from(this.delimiter)]))
    } else if (typeof this.configure != "undefined" && this.configure.str) {
        this.socket.write(message + this.delimiter);
    }  else {
        this.socket.write(json + this.delimiter);
    }
};
NetSocket.prototype.close = function () {
    if (this.destroyed == false) {
        this.socket.destroy();
    }
    this.isClosed = true;
};
NetSocket.prototype.end = function () {
    if (this.socket && !this.socket.connecting) {
        this.socket.end();
    }
};
module.exports = exports = { NetServer: NetServer, NetSocket: NetSocket };
