/**
 * Created by Benson.Liao on 15/12/22.
 */
//var logger = require('./FxLogger.js');
const debug = require('debug')('utility');
debug.log = console.log.bind(console); //file log 需要下這行
const parser = require('./FxParser.js').headers;
const fxStatus = require('./FxEnum.js').fxStatus;
const querystring = require('querystring');

/**
 * 公用參數
 * @constructor
 */
function FxUtility() {

    /* Variables */
    this.js_auto_gc;
    this.js_auto_gc_enabled = false;

    /* Codes */
};
/**
 * action auto gc()
 */
FxUtility.prototype.autoReleaseGC = function () {
    this.js_auto_gc = setInterval(function() {
        gc && gc();

    },10000);
    this.js_auto_gc_enabled = true;
};
/**
 * action auto gc() stop
 * */
FxUtility.prototype.shutDownAutoGC = function () {

    clearInterval(this.js_auto_gc);
    this.js_auto_gc = null;
    this.js_auto_gc_enabled = false;
};
FxUtility.prototype.findOutSocketConnected = function (client, chunk, self) {
    let request_headers = parser.onReadTCPParser(chunk);
    const unicodeNull = request_headers.unicodeNull;
    const swfPolicy = request_headers.swfPolicy;
    const iswebsocket = request_headers.iswebsocket;
    const general = request_headers.general;
    client.hsSource = chunk;
    client.wsProtocol = request_headers["sec-websocket-protocol"];
    client.headers = {
        "Transfer-Encoding": request_headers["transfer-encoding"],
        "X-Forwarded-For": request_headers["x-forwarded-for"],
        /* Used for some Google services */
        "X-ProxyUser-Ip": request_headers["x-proxyuser-ip"],
        "urlArgs": (Array.isArray(general)) ? querystring.parse(general[1].split("?")[1]) : []
    };
    let forwarded = {};
    let empty = true;
    if (typeof request_headers["x-forwarded-for"] != "undefined" && request_headers["x-forwarded-for"] != "") {
        forwarded["X-Forwarded-For"] = request_headers["x-forwarded-for"];
        empty = false;
    }
    if (typeof request_headers["x-from-cdn"] != "undefined" && request_headers["x-from-cdn"] != "") {
        forwarded["X-From-Cdn"] = request_headers["x-from-cdn"];
        forwarded["Ali-CDN-Real-IP"] = request_headers["ali-cdn-real-ip"];
        empty = false;
    }
    if (typeof request_headers["bb"] != "undefined" && request_headers["bb"] != "") {
        forwarded["BB"] = request_headers["bb"];
        forwarded["BB-FORWARDED"] = request_headers["bb-forwarded"];
        empty = false;
    }
    if (empty == true) {
        forwarded = null;
    }

    client.headers.forwarded = forwarded;

    if (typeof general!= "undefined") client.headers["Method"] = general[2];
    //debug('LOG::Data received: %s length:%d', content, chunk.byteLength);
    if (((chunk.byteLength == 0 || client.mode == fxStatus.socket || unicodeNull == null)) && !swfPolicy && typeof request_headers.general == "undefined")  {
        client.mode = fxStatus.socket;
        const content = chunk.toString('utf8');
        const income = content.toString().match(/(\{.+?\})(?={|$)/g);
        const json  = (income != null) ? JSON.parse(income[0]) : null;
        if (json) {
            if (json.action == "setup") {
                client.configure = json;
                client.delimiter = json.delimiter;
                client.delimiterLen = (typeof client.delimiter == "string") ? Buffer.byteLength(client.delimiter) : 0;
                if (typeof json.mode != "undefined" && json.mode == "fl") {
                    client.mode = fxStatus.flashSocket;
                    self.emit('connection', client);
                    if (typeof self != "undefined" && self != null && self.glListener) {
                        self.emit('message', {client: client, data: json});
                    } else {
                        client.emit('message', json);
                    }
                    return fxStatus.flashSocket;
                }
            }
            client.namespace = json.namespace || "";
        } else {
            client.namespace = chunk.toString('utf8');
        }
        self.emit('connection', client);
        return fxStatus.socket;
    }
    if ((unicodeNull != null || swfPolicy) && client.mode != 'ws') {
        debug('[SOCKET_NET_CONNECTED]');
        client.mode = fxStatus.flashSocket;
        self.emit('connection', client);
        if (typeof self != "undefined" && self != null && self.glListener) {
            self.emit('message', {client: client, data: client.read(client.hsSource)});
        } else {
            client.emit('message', client.read(client.hsSource));
        }
        return fxStatus.flashSocket;
    }
    else if (iswebsocket) {
        debug('[WEBSOCKET_CONNECTED]');

        client.mode = 'ws';

        if (typeof general[0] != "undefined") client.namespace = general[1]; // GET stream namespace

        client.handshake(chunk);
        // -- WELCOME TO BENSON WEBSOCKET SOCKET SERVER -- //
        if (client.replicated != true && client.baseEvtShow === true) {
            client.write(JSON.stringify({"NetStatusEvent": "NetConnect.Success", "detail": "連線成功！", "accept":client.acceptKey}), false);
        }

        if (typeof self != undefined && self != null) self.emit('connection', client); //

        return fxStatus.websocket;
    }
    else if (client.mode === fxStatus.websocket)
    {
        debug('[WEBSOCKET_ROGER]');
        // check is a websocket framing

        var str = client.read(chunk);
        var opcode = client.protocol.opcode;

        debug("PROTOCOL::", opcode);
    }else
    {
        debug('[OTHER CONNECTED]');

        if (request_headers.general.length != 0 && iswebsocket == false)
        {
            client.mode = fxStatus.http;

            if (typeof self != undefined && self != null) self.emit("httpUpgrade", request_headers, client, request_headers.lines);

            return fxStatus.http;
        }
    }

};
FxUtility.prototype.parseUrl = function (url) {
    var args;
    args = url.match(/([\w\/][^?]+)|(\?|\&)(([^=]+)\=([^&]+))/g);
    return args;
}
FxUtility.prototype.trimAny = function (str) {
    return str.replace(/\s+/g, "");
}
FxUtility.prototype.error_exception = {
    "CON_VERIFIED":     {"code": 0x200, "message":"Client verify path was successful."},
    "UV_ERR_CON":       {"code": 0x300, "message":"onconnection Error on Exception accept."},
    "UV_ERR_RS":        {"code": 0x301, "message":"call readStart() function can't be invoked."},
    "UV_EOF":           {"code": 0x302, "message":"UV_EOF: unexpected end of file."},
    "UV_EADDRINUSE":    {"code": 0x303, "message":"UV_EADDRINUSE: address already in use."},
    "FL_POLICY":        {"code": 0x350, "message":"When the incoming message contains the string '<policy-file-request/>\/0'"},
    "CON_MOD_HTTP":     {"code": 0x351, "message":"Connect MODE has HTTP."},
    "CON_MOD_NOT_FOUND":{"code": 0x351, "message":"Connect MODE not found."},
    "CON_TIMEOUT":      {"code": 0x352, "message":"Connect time up - Wait 5 sec."},
    "CON_LB_TIMEOUT":   {"code": 0x353, "message":"Connect Times up in wait get Load Balance response 5 sec."},
    "PROC_NOT_FOUND":   {"code": 0x354, "message":"Cluster process resource not found."},
    "CON_DONT_CONNECT":   {"code": 0x355, "message":"Cluster process socket don't Connected."},
    "CON_LOCK_CONNECT":   {"code": 0x356, "message":"The service will not allow it to connect"},
    "CON_DENY_CONNECT": {"code": 0x357, "message":"Deny Access this service from network."},
    "HTTP_CROSS_POLICY": {"code": 0x358, "message":"Cross-Origin Resource Policy"}
}
FxUtility.prototype.repo_history = {
}
FxUtility.prototype.errorException = function (name) {
    return this.error_exception[name];
};


/***
 * aysnc foreach ARRAY.asyncEach(func(item, resume),func())
 * @param iterator
 * @param complete
 */
Array.prototype.asyncEach = function(iterator, complete) {
    var list    = this,
        n       = list.length,
        i       = -1,
        calls   = 0,
        looping = false;

    var iterate = function() {
        calls -= 1;
        i += 1;
        // if (i === n) return;
        if (typeof complete !== 'undefined' && complete !== null && n === i) { complete(); return;} else { //resume();
        }
        iterator(list[i], resume);

    };

    var loop = function() {
        if (looping) return;
        looping = true;
        while (calls > 0) iterate();
        looping = false;
    };

    var resume = function() {
        calls += 1;
        if (typeof setTimeout === 'undefined') loop();
        else setTimeout(iterate, 1);
    };
    resume();
};



module.exports = exports = new FxUtility();


