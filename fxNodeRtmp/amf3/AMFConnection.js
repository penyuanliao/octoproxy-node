/**
 * Created by Benson.Liao on 2016/11/17.
 * @module NetAMF
 */
const mCrypto        = require('crypto');
const net           = require('net');
const util          = require('util');
const events        = require('events');
const amf3Utils     = require('./amf3Utils.js');
const log           = require('../log.js');
const amfUtils      = require('../amfUtils.js');
const responder     = require('./responder.js');
const objectType     = require('./ObjectType.js');

const CRLF          = "\r\n";
const SWITCH_TO_AMF3 = 0x11;
const FLASH_VERSION = "17,0,0,160";
const SWF = "Adobe Flash Player 17";
const ApacheMaxKeepAliveRequests = 100;

util.inherits(NetAMF, events.EventEmitter); // 繼承事件
util.inherits(NetServices, events.EventEmitter); // 繼承事件
/**
 * AMFPHP NectConnection
 * @constructor NetAMF
 */
function NetAMF() {

    events.EventEmitter.call(this);

    this.uptime = new Date().getTime().toString();
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
    this.socket_options = {port:1935, host:'localhost', allowHalfOpen:true};
    this._keepAlive = true;
    this.__established_socket = -1; // connect to bind socket. //todo need implement
    this.__running = false; // queue running
    this.__asyncQueueEnable = false; // keep a live queue
    this.callQueue = [];
    this.asyncCount = 0; // keepAlive request max

    console.log('NetAMF');
    /**
     * request header key & value
     * @type {Array}
     */
    this.headers = [];


    this.setup();
}
NetAMF.prototype.setup = function () {
    this.objectEncoding = 3;

    this.headers["POST"] = "/amfphp/gateway.php";
    this.headers["x-flash-version"] = FLASH_VERSION;
    this.headers["Content-Type"] = "application/x-amf";
    this.headers["Content-Length"] = 0;
    this.headers["User-Agent"] = SWF; //"Shockwave Flash";
    this.headers["Host"] = "127.0.0.1"; //socket.remoteAddress
    this.headers["Cache-Control"] = "no-cache"; //socket.remoteAddress
    this.headers["Cookie"] = "PHPSESSID=" + mCrypto.createHash("md5").update(this.uptime).digest("hex");

    this.__initialize();

};
/**
 * init
 * @private
 */
NetAMF.prototype.__initialize = function () {
    var self = this;

    if (this.socket || typeof this.socket != "undefined") {
        this.socket.removeAllListeners();
        this.socket.destroy();
        this.socket = undefined;
    }
    var runMax;
    var socket = this.socket = new net.Socket();
    this.socket.setMaxListeners(0);
    // this.socket.setTimeout(3*1000);
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
        if (self._keepAlive) {
            runMax = 20;
            while (socket.nbufs.length > 0 || runMax-- > 0) {
                if (self.deserialize() == false) return;
            }
        }
    });
    socket.on("end", function () {
        console.log('socket[END]');
        if (!self._keepAlive) {
            self.deserialize();
        }
    });
    socket.on("error", function (error) {
        console.log('socket error:', error);
        socket.destroy();
        self.emit("error", error);
    });
    socket.on("timeout", function () {
        console.log('socket is timeout');
        socket.destroy();
        self.emit("timeout");
    });
    socket.on("close", function () {
        console.log('socket is close');
        self.emit("close");
        if (!self._keepAlive) {
            self.__startQueue();
        }else {
            if (self.__asyncQueueEnable) self.__keepSendQueue();
        }
    });

};
NetAMF.prototype.error = function (error) {
    console.log(error);
};
/**
 *
 * @param uri {string}
 */
NetAMF.prototype.connect = function (uri) {
    //URL argument
    this.__setsockopt(uri);
    this.asyncCount = 0;
    console.log('** start connect AMFPHP **');
    this.socket.connect(this.socket_options);
    var self = this;
};
/**
 * @typedef {Object} callArguments
 * @property {string} command
 * @property {function} responder
 * @property {String|Number|Object|*} ...arguments
 */
/**
 * Calls a command or method on AMFPHP
 * @param command {String} [name]
 * @param responder {object|{onResult:function, onStatus:function} | null}
 * @param arguments {...*} [value]
 * @return string {String}
 * @description ...args data
 */
NetAMF.prototype.call = function (command, responder /* args */) {
    var self = this;
    var rawHeaders;
    var request;
    // var responder;
    var args = Array.prototype.slice.call(arguments);
    command = args.shift(); // remove command name
    if ((typeof responder != "undefined" && responder != null && typeof responder.onResult == "function" && typeof responder.onStatus== "function") || arguments[1] == null) {
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
    console.log("Responder type:",typeof responder != "undefined" , responder != null);
    if (typeof responder != "undefined" && responder != null) {
        reqKey += (++this.response_count);
        this.responders[reqKey] = {selector:responder, command:command};
    }
    responseURI = this.amf3Serializer.encodeDynamic(reqKey); // amf3 string

    console.log('arguments[responseURI]:',responseURI);
    var len = this.content_header.length + targetURI.length + responseURI.length + messageLength.length + message.length;

    /* Sets a single header value */
    this.setHeader("Content-Length", len);

    rawHeaders = new Buffer(this.getHeaders());
    request = Buffer.concat([rawHeaders, this.content_header, targetURI, responseURI, messageLength, message], rawHeaders.length + len);

    if (this.socket && this.connected && this._keepAlive) {

        if (self.__asyncQueueEnable)
            this.__asyncQueue(request);
        else
            this.socket.write(request);

        console.log('--------%s--------',reqKey);
    } else if (this._keepAlive == false) {

        this.__addQueue(request);

        if (this.__running) return reqKey;

        this.__startQueue();

    } else {
        self.socket.connect(this.socket_options, function () {

            self.socket.write(request);
        });

        // console.error("The TCP connection is not established yet!");
    }

    // Done //
    return reqKey;
};

NetAMF.prototype.encodeTargetURI = function(str) {
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
NetAMF.prototype.encodeMessage = function () {
    var i, merge, arg1Buf;
    var strictArray = [];
    var arrayLength = arguments.length;
    var switchToAMF3 = new Buffer([SWITCH_TO_AMF3]); // change encode to amf3
    var amf0encode;
    var tmp = undefined;
    var body = undefined;
    if (this.AMFVersion == this.ObjectEncoding.AMF0) {
        for (i = 0; i < arguments.length; i++) {
            var arg = arguments[i];
            strictArray.push(arg);
        }
        merge = amfUtils.amf0encSArray(strictArray);
    }else {
        merge = amfUtils.amf0encSArray(strictArray); // Strict array header
        merge.writeUInt32BE(arrayLength, 1); // set Array Length

        if (arguments.length == 0) return merge; //

        var flag;
        var switch2amf3 = false;
        var value;
        var dictionary = Array.prototype.slice.call(arguments);
        var totalsize = 0;
        var lists = [];
        while (dictionary.length > 0)
        {
            value = dictionary[0];
            flag = (typeof value == "number") || (typeof value == "string");
            // isNumber or isString
            if (flag && switch2amf3) {

                tmp = amfUtils.amf0EncodeOne(value);

                if (typeof amf0encode == "undefined") {
                    amf0encode = tmp;
                }else {
                    amf0encode = Buffer.concat([amf0encode, tmp], amf0encode.length + tmp.length);
                }
                dictionary.shift();
            }else {
                switch2amf3 = true;
                // console.log('dictionary:', dictionary.length);
                body = this.amf3Serializer.amf3Encode(dictionary, 0x11);
                dictionary.length = 0;
            }
        }
        lists.push(merge);
        totalsize += merge.length;

        if (typeof amf0encode != "undefined") {
            lists.push(amf0encode);
            totalsize += amf0encode.length;
        }
        if (typeof body != "undefined") {
            lists.push(body);
            totalsize += body.length;
        }

        merge = Buffer.concat(lists, totalsize);

        /*
        i = 0;
        var flag = (typeof arguments[i] == "number") || (typeof arguments[i] == "string");
        if (flag) {

            while (flag) {

                if (typeof amf0encode == "undefined") {
                    amf0encode = amfUtils.amf0EncodeOne(arguments[i]);
                }else {
                    tmp = amfUtils.amf0EncodeOne(arguments[i]);
                    amf0encode = Buffer.concat([amf0encode, tmp], amf0encode.length + tmp.length);
                }
                i++;
                flag = (typeof arguments[i] == "number") || (typeof arguments[i] == "string");

                console.log("flag >>",flag);
            }

            // arg1Buf = Buffer.concat([amf0encode, switchToAMF3], amf0encode.length + switchToAMF3.length);
            arg1Buf = amf0encode;

        } else {
            i = 0;
        }
        // encode amf3 argument;

        var dictAry = [];
        for (i; i < arguments.length; i++) {
            dictAry.push(arguments[i]);
        }
        // | StrictArray | Number | dictArray |//
        if (dictAry.length > 0 && typeof arg1Buf == 'undefined') {
            body = this.amf3Serializer.amf3Encode(dictAry, 0x11);
            merge = Buffer.concat([merge, body], merge.length + body.length);
        }
        else if (dictAry.length > 0) {
            if (dictAry.length == 1)
                body = this.amf3Serializer.amf3Encode(dictAry[0], 0x11);
            else
                body = this.amf3Serializer.amf3Encode(dictAry, 0x11);
            merge = Buffer.concat([merge, arg1Buf, body], merge.length + arg1Buf.length + body.length);
        }
        else {
            body = this.amf3Serializer.amf3Encode(arguments[0], 0x11);
            merge = Buffer.concat([merge, arg1Buf, body], merge.length + arg1Buf.length + body.length);
        }

        */


    }

    return merge;
};
NetAMF.prototype.__validateURLString = function (uri) {
    return uri.match(/^(rtmp|http)?:\/\/?([\w.]+):?([0-9]+)?([\/\w\._]+)/i);
};
/**
 *
 * @param uri {string}
 * @private
 */
NetAMF.prototype.__setsockopt = function (uri) {

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
 * @return boolean
 */
NetAMF.prototype.deserialize = function () {
    var socket = this.socket;
    var offset = socket.nbufs.indexOf((CRLF+CRLF));
    var second;
    var contentLength;
    var content;
    // console.log('deserialize Header offset:',offset);
    if (offset == -1) return false;

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

    if ((contentLength + offset) > socket.nbufs.length) return false;

    content = socket.nbufs .slice(offset, offset+contentLength);

    if (status == 200) {

        // console.log('1.deserialize Content-Length:', contentLength);
        socket.nbufs = socket.nbufs .slice(offset+contentLength, socket.nbufs.length);
        // console.log("2.deserialize buffer.length ", socket.nbufs.length);
        // read the binary body
        if (content[0] == 0x00) {
            var AMFObject = this.readBody(content);
            this.executionAction(AMFObject, cResHeaders);

        }else {
            //fault event
            this.readFaultData(content);
        }

    } else {
        console.error('status:', status);
    }
    content = undefined;

    return true;
};

NetAMF.prototype.setHeader = function (name, value) {
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
NetAMF.prototype.getHeaders = function (options) {

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
        resHeaders.push('Connection: ' + "Keep-Alive");
        if (ApacheMaxKeepAliveRequests == 0)
            resHeaders.push('Keep-Alive: ' + "timeout=30 ");
        else
            resHeaders.push('Keep-Alive: ' + "timeout=30 max=" + ApacheMaxKeepAliveRequests);
    }else {
        resHeaders.push('Connection: ' + "close");
    }


    return resHeaders.join(CRLF) + CRLF + CRLF;
};
NetAMF.prototype.readResHeaders = function (chunk) {

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
NetAMF.prototype.readBody = function (buf) {
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
NetAMF.prototype.readFaultData = function (buf) {
    var errorMessage = buf.toString();
    //noinspection JSUnresolvedFunction
    console.log('INVALID_AMF_MESSAGE');
    this.emit('fault', { "event":"INVALID_AMF_MESSAGE", "description":"Invalid AMF message", "error": errorMessage});

};
/**
 * @param {AMFObject} AMFObject
 * @param {Array} headers
 */
NetAMF.prototype.executionAction = function (AMFObject, headers) {
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
        console.log("responder key:%s, remoteMessage:%s MsgType:%s", key, remoteMessage);
        if (key != '/' && (typeof self.client != "undefined")) {
            responder = this.responders[key]["selector"];
            responder[remoteMessage](message["value"], key, this.responders[key]["command"]);

            // release object //
            this.responders[key]["selector"] = undefined;
            this.responders[key]["command"]  = undefined;
            responder = undefined;
            this.responders[key] = undefined;
            delete this.responders[key];
        }
        else if (key != '/' ) {
            responder = this.responders[key]["selector"];

            if (message["value"].constructor.name == 'ErrorMessage') {
                message["value"].headers = headers;
            }

            responder[remoteMessage](message["value"]);
            // release object //
            responder["selector"] = undefined;
            responder["command"]  = undefined;
            responder = undefined;
            this.responders[key] = undefined;
            delete this.responders[key];

        }
        else if (typeof self.client != "undefined") {
            var func = self.client[remoteMessage];
            if (typeof func == 'function') func(message["value"]);
        } else {
            self.emit(remoteMessage, message["value"]);
        }

    }

};
NetAMF.prototype.decodeMessageOne = function (buf, offset) {
    var obj = {};
    obj.len = buf.readUInt16BE(offset) + 2;
    obj.value = buf.slice(offset + 2, offset + obj.len).toString();
    return obj;
};
/**
 *
 * @param req
 * @private
 */
NetAMF.prototype.__addQueue = function (req) {

    if (typeof this.callQueue == "undefined") this.callQueue = [];

    this.callQueue.push(req);
    console.log('this.callQueue.push', this.callQueue.length);
};
/**
 *
 * @private
 */
NetAMF.prototype.__startQueue = function () {

    var self = this;

    if (self.callQueue.length > 0) {
        this.__running = true;
    } else {
        this.__running = false;
        return;
    }

    if (this.connected)
    {
        self.socket.write(this.callQueue.shift());
    } else {
        self.socket.connect(this.socket_options, function () {
            self.socket.write(self.callQueue.shift());
        });
    }

};
/**
 * keepAlive queue 但有問題apache是半雙工所以一直送會無法回傳
 * @param req
 * @private
 */
NetAMF.prototype.__asyncQueue = function (req) {
    var self = this;
    var is_connect = this.connected;
    
    if (is_connect && (self.asyncCount <= ApacheMaxKeepAliveRequests || ApacheMaxKeepAliveRequests == -1)) {

        if (self.callQueue.length > 0) {

            while (self.callQueue.length > 0 && self.asyncCount <= ApacheMaxKeepAliveRequests) {
                console.log('0.',self.callQueue.length, self.asyncCount);
                self.asyncCount++;
                self.socket.write(self.callQueue.shift());
            }

        }else {
            self.asyncCount++;
            self.socket.write(req);
            console.log('1.');
        }

    } else if (is_connect == false) {

        console.log('2.');
        // wait response and close
        self.__addQueue(req);

        this.__keepSendQueue();

    } else if (is_connect && self.asyncCount > ApacheMaxKeepAliveRequests){
        console.log('3.');
        self.__addQueue(req);
    } else {
        console.log('4.',is_connect,self.asyncCount);
    }
};
/**
 *
 * @private
 */
NetAMF.prototype.__keepSendQueue = function () {
    var self = this;
    this.asyncCount = 0;

    this.socket.connect(this.socket_options, function () {
        if (self.callQueue.length > 0) {
            self.__asyncQueue()
        }

    });

};
/**
 * @private
 */
NetAMF.prototype.__defineSetter__("objectEncoding", function (value) {
    this.AMFVersion = value;
    this.content_header.writeUInt16BE(this.AMFVersion, 0); // amf version
});
NetAMF.prototype.__defineSetter__("setKeepAlive", function (bool) {
    if (typeof bool === 'boolean') {
        this._keepAlive = bool;

    }
});
NetAMF.prototype.__defineGetter__("connected", function () {
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
NetAMF.prototype.__defineSetter__("client", function (value) {
    this._client = value;
    console.log('set Client');
});
NetAMF.prototype.__defineGetter__("client", function () {
    if (this._client != null && this._client != 0 && typeof this._client != "undefined") {
        return this._client;
    }else {
        return undefined;
    }
});
/**
 * @type {{AMF0: number, AMF3: number}}
 */
NetAMF.prototype.ObjectEncoding = {
    AMF0: 0,
    AMF3: 3
};

/**
 *
 * @param uri
 * @constructor NetServices
 */
function NetServices(uri) {
    events.EventEmitter.call(this);
    /**
     * amfPHP connect object
     * @type {NetAMF}
     */
    this.AMFSocket = undefined;

    this.selectors = new responder(this.onResult, this.onFault, this);

    this.__initialize(uri);

    this.delegate = undefined;
    this._command = undefined;

    this._tmpHand  = undefined;
    this._tmpHands = [];
}
NetServices.prototype.__initialize = function (uri) {
    this.AMFSocket = new NetAMF();
    this.AMFSocket.client = this;
    this.AMFSocket.connect(uri);
};
/***
 * call api
 * @param command {String}
 * @param self {Object} need Class Object
 */
NetServices.prototype.getService = function (command, self) {

    this._command = command;
    this.delegate = self;
    // var cmd_args = command.split(".");
    // var responder = cmd_args[(cmd_args.length-1)];
    // var selector = cmd_args[(cmd_args.length-1)] + "_onResult";
};
NetServices.prototype.setAMFService = function (/** ...args **/) {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(this.selectors);
    args.unshift(this._command);
    var resKey = this.AMFSocket.call.apply(this.AMFSocket,args);
    this._tmpHands[resKey] = this._tmpHand;
};
NetServices.prototype.__defineSetter__("tmpHand", function (name) {
    this._tmpHand = name;
});
NetServices.prototype.onResult = function (result, resKey, command) {
    // console.log(result, command);
    var context = this;

    var funName = this._tmpHands[resKey];
    var hasTmpHand = (funName != "" && typeof funName != "undefined" && funName != null && funName != 0);
    if (!hasTmpHand) {
        funName = command.slice(command.lastIndexOf(".")+1, command.length);

    }
    // console.log("funName " , funName);

    if (typeof this.delegate == 'object') {
        this.delegate[funName + "_Result"].bind(this.delegate, result, command)
        this.delegate[funName + "_Result"](result, command);

    }else {

        context.emit(funName + "_Result", result, command);
    }


};
NetServices.prototype.onFault = function (fault, resKey, command) {
    // console.log("onFault ",fault, command);
};
/**
 * A connect created by amfphp socket
 * @module createGatewayConnection
 * @param uri {String}
 * @returns {NetServices}
 */
function createGatewayConnection(uri) {
    var sock = new NetServices(uri);
    return sock;
}

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
    NetAMF:NetAMF,
    NetServices:NetServices,
    createGatewayConnection: createGatewayConnection
};

/*

var gateway2 = AMFConnection.createGatewayConnection('http://localhost:80/amfphp/gateway.php');
gateway2.objectEncoding = gateway2.ObjectEncoding.AMF0;
gateway2.call('Dealer.ping2',r,[{'hi':1},{'hi':1}], 1.04);
*/