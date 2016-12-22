/**
 * Created by Benson.Liao on 2016/11/17.
 * @module AmfOutgoingMessage
 */
const crypto        = require('crypto');
const net           = require('net');
const util          = require('util');
const events        = require('events');
const amf3Utils     = require('./amf3Utils.js');
const log           = require('../log.js');
const amfUtils      = require('../amfUtils.js');

const CRLF          = "\r\n";
const SWITCH_TO_AMF3 = 0x11;
const FLASH_VERSION = "17,0,0,160";
const SWF = "Adobe Flash Player 17";

util.inherits(AmfOutgoingMessage, events.EventEmitter); // 繼承事件

/**
 * AMFPHP NectConnection
 * @constructor AmfOutgoingMessage
 */
function AmfOutgoingMessage() {

    events.EventEmitter.call(this);

    this.uptime = new Date().getTime();
    this.AMFVersion = 3; //0:AMF0, 3:AMF3
    this.Header_Count = 0;
    this.Message_Count = 1;
    this.responders = {}; // dispatch Event
    this.poolStat = {}; // getServicee function remote result pool
    this.response_count = 0;
    this.amf3Serializer = new amf3Utils.serializer();
    this.amf3Deserializer = new amf3Utils.deserializer();

    this.content_header = new Buffer(6);

    this._client = undefined;

    this.socket = undefined; // connect socket
    /**
     * socket connect options
     * @type {{port: number, host: string}}
     */
    this.socket_options = {port:1935,host:'localhost'};
    this._keepAlive = true;

    console.log('AmfOutgoingMessage');
    /**
     * request header key & value
     * @type {Array}
     */
    this.headers = [];


    this.setup();
}
AmfOutgoingMessage.prototype.setup = function () {
    this.objectEncoding = 3;

    this.headers["POST"] = "/amfphp/gateway.php";
    this.headers["x-flash-version"] = FLASH_VERSION;
    this.headers["Content-Type"] = "application/x-amf";
    this.headers["Content-Length"] = 0;
    this.headers["User-Agent"] = SWF; //"Shockwave Flash";
    this.headers["Host"] = "127.0.0.1"; //socket.remoteAddress
    this.headers["Cache-Control"] = "no-cache"; //socket.remoteAddress
    this.headers["Cookie"] = "PHPSESSID=" + crypto.createHash("md5").update(this.uptime).digest("hex");

    this.__initialize();

};
/**
 * init
 * @private
 */
AmfOutgoingMessage.prototype.__initialize = function () {
    var self = this;

    if (this.socket || typeof this.socket != "undefined") {
        this.socket.removeAllListeners();
        this.socket.destroy();
        this.socket = undefined;
    }

    var socket = this.socket = new net.Socket();
    this.socket.nbufs;
    socket.on("connect", function () {
        console.log('connect');
        socket.setKeepAlive(self._keepAlive);
    });
    socket.on("data", function (chunk) {
        if (typeof socket.nbufs == "undefined") {
            socket.nbufs = chunk;
        }else {
            socket.nbufs = Buffer.concat([socket.nbufs, chunk], socket.nbufs.length + chunk.length);
        }
        if (self._keepAlive) self.deserialize();
    });
    socket.on("end", function () {
        // console.log('socket[END]');
        // self.deserialize(socket.nbufs);
        // self.socket.nbufs = undefined;
        if (!self._keepAlive) self.deserialize();
    });
    socket.on("error", function (error) {
        console.log('socket error:', error);
        socket.destroy();
        self.emit("error", error);
    });
    socket.on("timeout", function () {
        console.log('socket is timeout');
        self.emit("timeout");
    });
    socket.on("close", function () {
        console.log('socket is close');
        self.emit("close");
    });

};
AmfOutgoingMessage.prototype.error = function (error) {
    console.log(error);
};
/**
 *
 * @param uri {string}
 */
AmfOutgoingMessage.prototype.connect = function (uri) {
    //URL argument
    this.__setsockopt(uri);
    console.log('** start connect AMFPHP **');
    this.socket.connect(this.socket_options);
};
/**
 * @typedef {Object} callArguments
 * @property {string} command
 * @property {function} responder
 * @property {String|Number|Object|*} ...arguments
 */
/**
 * Calls a command or method on AMFPHP
 * @param command {string} [name]
 * @param responder {object|{onResult:function, onFault:function} | null}
 * @param arguments {...*} [value]
 * @description ...args data
 */
AmfOutgoingMessage.prototype.call = function (command, responder /* args */) {
    var self = this;
    var rawHeaders;
    var request;
    // var responder;
    var args = Array.prototype.slice.call(arguments);
    command = args.shift(); // remove command name
    if ((typeof responder != "undefined" && typeof responder.onResult == "function" && typeof responder.onFault== "function") || arguments[1] == null) {
        args.shift(); // remove responder
    }else {
        responder = undefined;
        console.log('responder:%s , arguments:%s', responder, args);
    }

    /* set AMF Message Header */
    this.content_header.writeUInt16BE(this.Header_Count, 2);// header count
    this.content_header.writeUInt16BE(this.Message_Count, 4);// message count

    var message = this.encodeMessage.apply(this,args);
    var targetURI = this.encodeTargetURI(command);
    var reqKey = "/";
    var responseURI;
    var messageLength = new Buffer(4);
    messageLength.writeUInt32BE(message.length, 0);
    console.log("Responder type:",typeof responder != "undefined" , responder != null , responder);
    if (typeof responder != "undefined" && responder != null) {
        reqKey += (++this.response_count);
        this.responders[reqKey] = responder;
    }
    responseURI = this.amf3Serializer.encodeDynamic(reqKey); // amf3 string

    console.log('arguments[responseURI]:',responseURI);
    var len = this.content_header.length + targetURI.length + responseURI.length + messageLength.length + message.length;

    /* Sets a single header value */
    this.setHeader("Content-Length", len);

    rawHeaders = new Buffer(this.getHeaders());
    request = Buffer.concat([rawHeaders, this.content_header, targetURI, responseURI, messageLength, message], rawHeaders.length + len);

    if (this.socket && this.connected) {
        this.socket.write(request);
        console.log('--------%s--------',reqKey);
    } else {
        self.socket.connect(this.socket_options, function () {
            self.socket.write(request);
        });

        // console.error("The TCP connection is not established yet!");
    }

    // Done //
};
/**
 *
 * @param command
 * @param self
 */
AmfOutgoingMessage.prototype.getService = function (command, self) {
    console.log('call 1');
};
AmfOutgoingMessage.prototype.getPoolStat = function () {

};

AmfOutgoingMessage.prototype.encodeTargetURI = function(str) {
    var buf = new Buffer(2 + str.length);

    buf.writeUInt16BE(str.length, 0);

    buf.write(str, 2);

    return buf;
};

/**
 * Action Message Format
 * AMF version: 3
 * Header count: 0
 * Message count: 1
 * Message
 *   Target URI: Dealer.ping2 <- argument[0]
 *   Response URI: /1
 *   Length: 24
 *   Strict array:
 *     AMF0 type: Strict array (0x0a)
 *     Array Length: 2
 *     Number 1 <- argument[1]
 *     Switch to AMF3
 *   Object <- argument[2]
 *   @param arguments {*}
 *   @return merge{buffer}
 */
AmfOutgoingMessage.prototype.encodeMessage = function () {
    var i, merge, arg1Buf;
    var strictArray = [];
    var arrayLength = arguments.length;
    var switchToAMF3 = new Buffer([SWITCH_TO_AMF3]); // change encode to amf3
    var amf0encode;
    var AMF3Message = undefined;
    var body = undefined;
    if (this.AMFVersion == this.ObjectEncoding.AMF0) {
        for (i = 0; i < arguments.length; i++) {
            var arg = arguments[i];
            strictArray.push(arg);
        }
        merge = amfUtils.amf0encSArray(strictArray);
    }else {
        merge = amfUtils.amf0encSArray(strictArray); // Strict array header
        merge.writeInt8(arrayLength, 4); // set Array Length

        if (typeof arguments[0] == "number") {
            i = 1;
            amf0encode = amfUtils.amf0encNumber(arguments[0]);
            arg1Buf = Buffer.concat([amf0encode,switchToAMF3], amf0encode.length + switchToAMF3.length);

        } else if (typeof arguments[0] == "string") {
            i = 1;
            amf0encode = amfUtils.amf0encString(arguments[0]);
            arg1Buf = Buffer.concat([amf0encode,switchToAMF3], amf0encode.length + switchToAMF3.length);
        } else if (typeof arguments[0] == "object") {
            i = 0;
        } else {
            i = 0;
            arg1Buf = switchToAMF3;
        }
        // encode amf3 argument;

        var dictAry = [];
        for (i; i < arguments.length; i++) {
            dictAry.push(arguments[i]);
        }
        // | StrictArray | Number | dictArray |//
        if (dictAry.length > 1) {
            body = this.amf3Serializer.amf3Encode(dictAry, 0x11);

            merge = Buffer.concat([merge, body], merge.length + body.length);
        } else {
            body = this.amf3Serializer.amf3Encode(arguments[1]);

            merge = Buffer.concat([merge, arg1Buf, body], merge.length + arg1Buf.length + body.length);
        }




    }

    return merge;
};
AmfOutgoingMessage.prototype.__validateURLString = function (uri) {
    return uri.match(/^(rtmp|http)?:\/\/?([\w.]+):?([0-9]+)?([\/\w\._]+)/i);
};
/**
 *
 * @param uri {string}
 * @private
 */
AmfOutgoingMessage.prototype.__setsockopt = function (uri) {

    var val_args = this.__validateURLString(uri);

    this.setHeader("POST", val_args[4]);

    if (typeof val_args[2] != "undefined") {
        this.socket_options["host"] = val_args[2];
        this.setHeader("Host", val_args[2]);
    }

    if (typeof val_args[3] != "undefined") {
        this.socket_options["port"] = parseInt(val_args[3]);
    }else {
        this.socket_options["port"] = 80;
    }
};
// ------------------ //
//   response event   //
// ------------------ //
/**
 * @private
 */
AmfOutgoingMessage.prototype.deserialize = function () {
    var socket = this.socket;
    var offset = socket.nbufs.indexOf((CRLF+CRLF));
    var second;
    var contentLength;
    var content;
    console.log('header offset:',offset);
    if (offset == -1) return;

    var cResHeaders = this.readResHeaders(socket.nbufs.slice(0, offset)); // read the binary header
    offset += 4;

    // console.log('resHeaders:', cResHeaders);
    var status = cResHeaders["general"][2];
    contentLength = parseInt(cResHeaders["content-length"]);

    if (isNaN(contentLength) == true) {
        second = socket.nbufs.indexOf((CRLF+CRLF),offset);
        if (second != -1 )
            contentLength = second;
        else
            contentLength = socket.nbufs.length;
    }

    if ((contentLength + offset) > socket.nbufs.length) return;

    content = socket.nbufs .slice(offset, offset+contentLength);

    if (status == 200) {

        console.log('1.Content-Length:', contentLength);
        // buffer.slice(offset,offset+contentLength).toString()
        socket.nbufs = socket.nbufs .slice(offset+contentLength, socket.nbufs.length);
        console.log("2.buffer.length ", socket.nbufs.length);
        // log.logHex(content);
        // read the binary body
        if (content[0] == 0x00) {
            var AMFObject = this.readBody(content);
            this.executionAction(AMFObject);

        }else {
            //fault event
            this.readFaultData(content);
        }

    } else {
        console.error('status:', status);
    }
    content = undefined;
};

AmfOutgoingMessage.prototype.setHeader = function (name, value) {
    // name = name.toUpperCase();
    if (typeof name == "undefined" || !name || name === null) {
        console.error('The "name" variable is undefined');
    }
    if (typeof value == "undefined" || !value || value === null) {
        console.error('The "value" variable is undefined');
    }
    this.headers[name] = value;
};
/****/
AmfOutgoingMessage.prototype.getHeaders = function (options) {

    if (typeof options == 'object' && options.constructor == Object) {
        var keys = Object.keys(options);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            this.setHeader(key, options[key]);
        }
    }

    var resHeaders = [
        'POST ' + this.headers["POST"] + ' HTTP/1.1',
        'Host: ' + this.headers["Host"],
        'User-Agent: ' + this.headers["User-Agent"],
        'x-flash-version: ' + this.headers["x-flash-version"],
        'Content-Type: ' + this.headers["Content-Type"],
        'Content-Length: ' + this.headers["Content-Length"],
        'Cache-Control: ' + this.headers["Cache-Control"],
        'Cookie: ' + this.headers["Cookie"]
        // 'Connection: ' + "Upgrade"
    ];

    if (this._keepAlive) {
        resHeaders.push('Connection: ' + "Upgrade");
        resHeaders.push('Keep-Alive: ' + "timeout=30 ");
    }else {
        resHeaders.push('Connection: ' + "close");
    }


    return resHeaders.join(CRLF) + CRLF + CRLF;
};
AmfOutgoingMessage.prototype.readResHeaders = function (chunk) {

    /* Variables */
    var data = chunk.toString('utf8');
    var lines = data.split(CRLF);
    var headers = {};
    var i = lines.length;

    if (lines.length === 1) return false;

    // headers["source"] = data;
    // headers["lines"] = lines;
    //Check is HTTP/1.1 200 OK
    headers['general'] = lines[0].toString().match(/^(HTTP\/[0-9\.]+) ([0-9]+) ([\w '\\\/.]+)/i);

    if (lines == null) return false;

    while(--i > 0) {

        if (lines[i] === null || lines[i] === '') continue;

        var match = lines[i].toString().match(/^([a-z-A-Z-]+): (.+)/i);

        if (match === null) continue;

        headers[match[1].toLowerCase()] = match[2];
    }
    return headers;
};
AmfOutgoingMessage.prototype.readBody = function (buf) {
    var decodeFlags;
    // var decodeTime = new Date().getTime();
    var amf_version, headerCount, headersNameLen, headerName, MustUnderstand;
    var count,len, obj;
    var messageCount, targetURI, responseURI;
    var headers = [];
    var message = [];
    var AMFObject;
    var offset = 0;
    amf_version = buf.readUInt16BE(offset);
    offset+=2;
    headerCount = buf.readUInt16BE(offset);
    offset+=2;
    count = headerCount;
    while (count > 0) {
        headersNameLen = buf.readUInt16BE(offset);
        offset+=2;
        headerName = buf.slice(offset, offset+headersNameLen).toString();
        offset+=headersNameLen;
        MustUnderstand = buf.readUInt8(offset);
        offset++;
        len = buf.readUInt32BE(offset);
        offset+=4;
        obj = amfUtils.amf0decString(buf.slice(offset, offset + len));
        offset+=len;

        headers.push({
            name:headerName,
            mustUnderstand:(MustUnderstand == 1),
            len:len,
            value: obj["value"]
        });
        count--;
    }

    messageCount = buf.readUInt16BE(offset);
    offset+=2;
    count = messageCount;
    while (count > 0) {
        targetURI = this.decodeMessageOne(buf, offset);
        offset += targetURI.len;
        responseURI = this.decodeMessageOne(buf, offset);
        offset+=responseURI.len;
        len = buf.readUInt32BE(offset);
        offset+=4;
        decodeFlags = buf.readUInt8(offset);
        // Switch to AMF3
        if (decodeFlags == 0x11) {
            offset += 1;
            var load = buf.slice(offset, offset + len);
            obj = this.amf3Deserializer.amf3Decode(load);
        } else {
            obj = amfUtils.amf0DecodeOne(buf.slice(offset, offset + len))["value"];
        }

        message.push({
            target:targetURI["value"],
            response:responseURI["value"],
            len:len,
            decodeFlags:decodeFlags,
            value:obj
        });
        // console.log(message);
        count--;
    }

    AMFObject = {
        amf_version: amf_version,
        headerCount:headerCount,
        headers:headers,
        messageCount:messageCount,
        messages:message
    };

    return AMFObject;
};
AmfOutgoingMessage.prototype.readFaultData = function (buf) {
    var errorMessage = buf.toString();
    //noinspection JSUnresolvedFunction
    console.log('INVALID_AMF_MESSAGE');
    this.emit('fault', { "event":"INVALID_AMF_MESSAGE", "description":"Invalid AMF message", "error": errorMessage});

};
/**
 * @param {AMFObject} AMFObject
 */
AmfOutgoingMessage.prototype.executionAction = function (AMFObject) {
    var self = this;
    var message, target, messageCount;
    var responder,offset, key, remoteMessage;
    messageCount = AMFObject["messageCount"];
    while (messageCount-- > 0) {
        message = AMFObject["messages"][messageCount];
        target = message["target"];
        // amf3 message
        // console.log(message);
        offset = target.indexOf("/",1);
        key = target.slice(0, offset);
        remoteMessage = target.slice(offset+1,target.length);
        console.log("responder key:%s, remoteMessage:%s", key, remoteMessage);
        if (key != '/') {
            responder = this.responders[key];

            responder[remoteMessage](message["value"]);
            // release object
            responder = undefined;
            this.responders[key] = undefined;
            delete this.responders[key];

        }else if (typeof self._client != "undefined") {
            var func = self._client[remoteMessage];
            if (typeof func == 'function') func(message["value"]);
        } else {
            self.emit(remoteMessage, message["value"]);
        }

    }

};
AmfOutgoingMessage.prototype.decodeMessageOne = function (buf, offset) {
    var obj = {};
    obj.len = buf.readUInt16BE(offset) + 2;
    obj.value = buf.slice(offset + 2, offset + obj.len).toString();
    return obj;
};
/**
 * @private
 */
AmfOutgoingMessage.prototype.__defineSetter__("objectEncoding", function (value) {
    this.AMFVersion = value;
    this.content_header.writeUInt16BE(this.AMFVersion, 0); // amf version
});
AmfOutgoingMessage.prototype.__defineSetter__("setKeepAlive", function (bool) {
    if (typeof bool === 'boolean') {
        this._keepAlive = bool;

    }
});
AmfOutgoingMessage.prototype.__defineGetter__("connected", function () {
    if (typeof this.socket == "undefined" ) {
        return false;
    } else {
        console.log('writable:', this.socket.writable);
        // return !(this.socket._connecting === true);
        return this.socket.writable;
    }
});
/**
 * Indicates the object on which callback methods are invoked.
 * @param value {object}[*import need class object]
 */
AmfOutgoingMessage.prototype.__defineSetter__("client", function (value) {
    this._client = value;
    console.log('set Client');
});
/**
 * @type {{AMF0: number, AMF3: number}}
 */
AmfOutgoingMessage.prototype.ObjectEncoding = {
    AMF0: 0,
    AMF3: 3
};

/**
 * A object containing a AMFMessage
 * @typedef {object} AMFObject
 * @property {number} amf_version - The decode version
 * @property {number} headerCount -
 * @property {object} headers
 * @property {string} headers.name
 * @property {boolean} headers.mustUnderstand
 * @property {number} headers.len
 * @property {object|string|number} headers.value
 * @property {number} messageCount
 * @property {object} messages
 * @property {string} messages.target
 * @property {string|null} messages.response
 * @property {number} messages.len
 * @property {object|string|number} messages.value
 */
module.exports = exports = {
    NetServices:AmfOutgoingMessage
};
