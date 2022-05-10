/**
 * Created by penyuan on 2016/4/14.
 * @module FxTCP
 */
const debug = require('debug')('fxNetSocket:TCP');
debug.log = console.log.bind(console); //file log 需要下這行
const tcp_wrap      = process.binding("tcp_wrap");
const TCP           = tcp_wrap.TCP; // TCP連線
const WriteWrap     = process.binding('stream_wrap').WriteWrap;
const uv = process.binding('uv');
const fxNetSocket = require('../index');
const parser = fxNetSocket.parser;
const pheaders = parser.headers;
const client = fxNetSocket.wsClient;
const utilities = fxNetSocket.utilities;
const util = require('util');
const events = require('events');
util.inherits(FxTCP, events.EventEmitter);

const tcpEvent = {
    onRead:"onRead"
}

function noop() {};

/**
 * FxTCP 橋接原生tcp事件
 * @constructor
 * @version 1.0.0
 */
function FxTCP() {

    /* Variables */

    this.server = null;
    this.isConnect = false;
    this.opt = undefined;

    this.__onConnection = undefined;

    events.EventEmitter.call(this);
}

FxTCP.prototype.createServer = function (opt) {
    var err, tcp_handle;
    const self = this;

    if (!opt) {
        opt = {'host':'0.0.0.0', 'port': 8080, 'closeWaitTime': 5000, 'backlog':511};
    };

    this.opt = opt;
    try {
        tcp_handle = new TCP(tcp_wrap.constants.SERVER);
        err = tcp_handle.bind(opt.host, opt.port);

        if (err) {
            throw new Error(err);
        };

        err = tcp_handle.listen(opt.backlog);

        if (err) {
            throw new Error(err);
        };

        var onconnect = function (err ,handle) {

            if (err) throw new Error("client not connect.");
            handle.setNoDelay(true);
            self.isConnect = true;
            debug("isConnect");
            handle.onread = onRead;
            handle.readStart(); //讀header封包
            handle.closeWaiting = setTimeout(function () {
                debug('CLOSE_WAIT - Wait 5 sec timeout.');
                handle.close();
            },opt.closeWaitTime);
        };

        if (this.__onConnection) {
            tcp_handle.onconnection = this.__onConnection; // customize connection event.
        }else {
            tcp_handle.onconnection = onconnect;
        }

        function onRead(nread, buffer) {
            var handle = this;

            var url_args = undefined;


            if (nread < 0) {

                if (nread == uv.UV_ECONNRESET) {
                    debug('debug','connection reset by peer.');
                }
                // Error, end of file. -4095
                if (nread === uv.UV_EOF) {
                    debug('debug','error UV_EOF: unexpected end of file.');
                    handle.close();
                    self.handleRelease(handle);
                }

                if (nread === 0) {
                    debug('debug','not any data, keep waiting.');
                };

                return;
            }
            // nread > 0 read success
            clearTimeout(handle.closeWaiting); //socket error CLOSE_WAIT(passive close)
            //chrome issue: https://bugs.chromium.org/p/chromium/issues/detail?id=392534

            if (buffer.length == 8 && buffer[0] == 0x88) {
                // var b = parser.protocols.readFraming(buffer);
                // console.log('chrome opcode:8');
                handle.close();
                self.handleRelease(handle);
                return;
            }

            var headers = pheaders.onReadTCPParser(buffer);
            var source = headers.source;
            var general = headers.general;
            var isBrowser = (typeof general != 'undefined');
            var mode = "";
            var namespace = undefined;


            if (general) {
                mode = general[0].match('HTTP/') != null ? "http" : mode;
                mode = headers.iswebsocket  ? "ws" : mode;
                namespace = general[1];
            }else
            {
                mode = "socket";
                namespace = buffer.toString('utf8');
                namespace = namespace.replace("\0","");
                debug('TCP.Socket - namespace - ', namespace);
                source = namespace;
            }
            namespace = namespace.replace(/\/\w+\//i,'/');
            var args = utilities.parseUrl(namespace); //url arguments
            if (args) {
                namespace = args[0];
                var ns_len = args.length;
                url_args = {};
                for (var i = 1; i < ns_len; i++) {
                    var str = args[i].toString().replace(/(\?|\&)+/g,"");
                    var keyValue = str.split("=");
                    url_args[keyValue[0].toLowerCase()] = keyValue[1];
                }
                // NSLog.log("trace","url arguments:", url_args,namespace);
                args = null;
                ns_len = null;
            }
            this.wsProtocol = headers["sec-websocket-protocol"];
            this.urlArguments = url_args;

            if ((buffer.byteLength == 0 || mode == "socket" || !headers) && !headers.swfPolicy) mode = "socket";
            if (headers.unicodeNull != null && headers.swfPolicy && mode != 'ws') mode = "flashsocket";

            this.mode = mode;
            this.namespace = namespace;

            self.emit(tcpEvent.onRead, nread, buffer, this);

        }

        self.server = tcp_handle;
    }
    catch (e) {
        debug('create server error:', e);
        tcp_handle.close();
    };
};
FxTCP.prototype.tcp_write = function (handle, data) {
    var req = new WriteWrap();
    req.handle = handle;
    req.oncomplete = function (status, handle, req, err) {
        debug('oncomplete',status, err);
    };
    req.async = false;
    var err = handle.writeUtf8String(req, data);
    debug('tcp_write error:', err);
};

FxTCP.prototype.handleRelease = function (handle) {
    handle.readStop();
    handle.onread = noop;
    handle = null;
};
FxTCP.prototype.waithandleClose = function (handle, msecs) {

    var self = this;
    setTimeout(function () {
        handle.close();
        self.handleRelease(handle);
        console.log('wait handle close()');
    },msecs)
}

FxTCP.prototype.resume = function (handle) {
    handle.readStart();
};
FxTCP.prototype.pause = function (handle) {
    handle.readStop();
};
FxTCP.prototype.reboot = function () {
    this.server.close();
    this.server.onconnection = null;
    this.server = null;

    this.createServer(this.opt);
};
FxTCP.prototype.connect = function (handle) {
    debug('Administrator accpet.');
    var socket = new net.Socket({
        handle:handle
    });
    socket.readable = socket.writable = true;
    socket.server = this.server;

    var ws = new client(socket,function () {
        debug('handshake successful.');

        ws.on('data', function (data) {
            debug('Data Event is received ws-packet Stream.');
        });
        ws.on('message', function (msg) {
            debug('Message is decode ws-packet Stream on:', msg);

        });

    });

    socket.emit("connect");
    socket.emit('data',buffer);
    socket.resume();

    return client;
};

FxTCP.prototype.__defineSetter__("onConnection", function (func) {
    if (func.constructor instanceof Function) {
        this.__onConnection = func;
    }
});

module.exports = exports = FxTCP;

/** Unit test **/
// var tcp = new FxTCP();
// tcp.createServer();
// tcp.on(tcpEvent.onRead, function (nread, buffer, handle) {
//     console.log('handle protocol', handle.wsProtocol);
// });
