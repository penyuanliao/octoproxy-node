const net          = require("net");
const util         = require("util");
const crypto       = require("crypto");
const http         = require("http");
const https        = require("https");
const nURL         = require("url").URL;
const querystring  = require("querystring");
const EventEmitter = require("events");
const parser       = require('./FxParser.js');
const Encoder      = parser.Encoder;

util.inherits(FxWebSocket, EventEmitter);

/**
 * websocket客端
 * @param url
 * @param subProtocols
 * @param options
 * @version 2.0.0
 * @constructor
 */
function FxWebSocket(url, subProtocols, options) {
    EventEmitter.call(this);

    this.options  = options;

    this.subProto = subProtocols;

    this.packet   = Buffer.from([]);

    this.encoder  = new Encoder();

    this.wsKey    = this.randomKey();

    Object.defineProperties(this, {
        "isConnect" : {
            get:function () {
                if (typeof this.socket == "undefined") return false;
                return (this.socket.writable && !this.socket.destroyed);
            },
            configurable: false,
            enumerable: false
        }
    });

    this.setup(url);
}
FxWebSocket.prototype.setup = function (url) {
    const self = this;
    this.url_args = new nURL(url);

    const tlsMethod = (this.url_args.protocol == "wss:");

    const httpOptions = {
        // agent: false,
        hostname: this.url_args.hostname,
        port: this.url_args.port,
        path: this.url_args.pathname + this.url_args.search,
        method: "GET",
        headers: this.setHTTPHeader(0)
    };

    var req;

    if (!tlsMethod) {
        req = http.request(httpOptions);
    } else {
        req = https.request(httpOptions);
    }
    req.on('upgrade', function (res, socket, head) {
        self.emit("open");
        self.socket = socket;
        self.res = res;
        self.firstHead = head;
        socket.on("data", incoming);
        self.validateHandshake();
        socket.on("close", function () {
            self.emit("close");
        });
        incoming(head);
    });
    req.on('error', function (err) {
        self.emit("error", err);
    });
    req.on('response', function (response) {
        response.on("data", function (chunk) {
            console.log(chunk.toString());
        })
    });

    var segments = Buffer.from([]);
    const incoming = function incoming(chunk) {
        if (segments.length == 0) {
            segments = Buffer.from(chunk, chunk.length);
        } else {
            segments = Buffer.concat([segments, chunk], segments.length + chunk.length);
        }
        while (segments.length > 0) {
            let protocol = self._read(segments);
            if (protocol.total > segments.length) return;
            if (typeof protocol == "undefined") protocol = {opcode:8, msg: ""};
            if (protocol == false) {
                console.error('consecutive packet loss.');
                segments = Buffer.alloc(0);
                return;
            }
            segments = segments.slice(protocol.total, segments.length);
            self.packet = Buffer.concat([self.packet, protocol.msg], self.packet.length + protocol.msg.length);

            if (protocol.fin === true) {
                if (protocol.opcode === 0 || protocol.opcode === 1) {
                    self.emit("message",  self.packet.toString());
                } else if (protocol.opcode === 2) {
                    self.emit("message",  self.packet);
                } else if (protocol.opcode === 8) {
                    self.emit("close");
                    self.socket.destroy();
                    self.release();
                } else if (protocol.opcode === 9) {
                    self._pong();
                } else if (protocol.opcode === 10) {
                    self._ping();
                }
                self.packet = Buffer.from([]);
            } else {
                continue;
            }
        }

    };
    req.end();
};
FxWebSocket.prototype.setHTTPHeader = function (len) {
    let header = {
        "Upgrade": "websocket",
        "Connection": "Upgrade",
        "Sec-WebSocket-Version": 13,
        "Sec-WebSocket-Key": this.wsKey,
        "Host": this.url_args.hostname,
        "Content-Length": len,
        "Origin": this.url_args.origin
    };

    if (typeof this.options != "undefined") {
        if (typeof this.options.Origin != "undefined") header.Origin = this.options.Origin;
        if (typeof this.options.Host != "undefined") header.Host = this.options.Host;
    }
    if (typeof this.subProto != "undefined") {
        if (Array.isArray(this.subProto)) header["Sec-WebSocket-Protocol"] = this.subProto.toString();
        else header["Sec-WebSocket-Protocol"] = this.subProto;
    }
    return header;
};
FxWebSocket.prototype.randomKey = function () {
    // const keys = Buffer.alloc(16);
    // for (var i = 0; i < 16; i++) {
    //     keys[i] = Math.round(Math.random()*0xFF);
    // }
    // return keys.toString('base64');
    return crypto.randomBytes(16).toString("base64");
};
FxWebSocket.prototype.validateHandshake = function () {
    const headers = this.res.headers;
    if (typeof headers.upgrade !== "undefined" && headers.upgrade.toLocaleLowerCase() !== "websocket") {
        return false;
    }
    if (typeof headers.connection !== "undefined" && headers.connection.toLocaleLowerCase() !== "upgrade") {
        return false;
    }

    const sha1Key = crypto.createHash("sha1").update(this.wsKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");

    if (typeof headers["sec-websocket-accept"] === "undefined" || headers["sec-websocket-accept"] === null) {
        return false;
    }

    return (sha1Key !== headers["sec-websocket-accept"]);
};
FxWebSocket.prototype._read = function (data) {
    if (typeof this.encoder == "undefined") this.encoder = new Encoder();
    return this.encoder.readFraming(data);
};
FxWebSocket.prototype.write = function (data, mask) {
    if (typeof this.encoder == "undefined") this.encoder = new Encoder();

    if (Array.isArray(data) == false && typeof data === "object") {
        data = JSON.stringify(data);
    }
    const masked = (!mask) ? true : mask;
    const isBuf = Buffer.isBuffer(data);
    var bfSize;
    var payload;
    if (isBuf) {
        bfSize = data.byteLength;
    } else {
        bfSize = Buffer.byteLength(data);
    }
    payload = Buffer.from(data, bfSize);

    const segments = this.encoder.writeFraming(true, 1, masked, payload);
    const packet = Buffer.concat([segments, payload], segments.length + payload.length);
    if (this.isConnect) this.socket.write(packet);
};
FxWebSocket.prototype.send = function (data, options) {
    if (typeof data == "undefined") return;
    if (typeof options != "undefined") {
        const mask = options.mask;
        this.write.apply(this, [data, mask]);
    } else {
        this.write.apply(this, [data]);
    }

};
FxWebSocket.prototype._pong = function () {
    var packet = this.encoder.writeFraming(true, 10, true, Buffer.from([]));
    if (this.isConnect) this.socket.write(packet);
};
FxWebSocket.prototype._ping = function () {
    var packet = this.encoder.writeFraming(true, 9, true, Buffer.from([]));
    if (this.isConnect) this.socket.write(packet);
};
FxWebSocket.prototype.release = function () {

};

FxWebSocket.createConnection = function (url, subProtocol, options) {
    const ws = new FxWebSocket(url, subProtocol, options);
    return ws;
};

module.exports = exports = FxWebSocket;
/*
var server = net.createServer();

server.on("listening", function () {
});
server.on("connection", function (socket) {
    socket.on("data", function (chunk) {
        console.log(chunk.toString());
    })
});
server.listen(8002);*/

// var ws = new FxWebSocket("ws://127.0.0.1:8002/fxlive/fxLB?gameType=5902");
// ws.on("open", function () {
//     console.log('open');
//     setInterval(function () {
//         ws.send({d:"777"})
//     },1000)
// });
// ws.on("message", function (data) {
//     console.log(data);
// });
// ws.on("close", function () {
//     console.log('close');
// });