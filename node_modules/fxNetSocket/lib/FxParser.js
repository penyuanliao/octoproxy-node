/**
 * Created by Benson.Liao on 2015/11/17.
 * @module Parser
 */
const crypto = require("crypto");
const mapping = require("./FxViewMapping.js");
//const bufferUtil  = require('bufferutil');
//const log  = require('./log.js');
const status_code = {
    100 : 'Continue',
    101 : 'Switching Protocols',
    102 : 'Processing',                 // RFC 2518, obsoleted by RFC 4918
    200 : 'OK',
    201 : 'Created',
    202 : 'Accepted',
    203 : 'Non-Authoritative Information',
    204 : 'No Content',
    205 : 'Reset Content',
    206 : 'Partial Content',
    207 : 'Multi-Status',               // RFC 4918
    208 : 'Already Reported',
    226 : 'IM Used',
    300 : 'Multiple Choices',
    301 : 'Moved Permanently',
    302 : 'Found',
    303 : 'See Other',
    304 : 'Not Modified',
    305 : 'Use Proxy',
    307 : 'Temporary Redirect',
    308 : 'Permanent Redirect',         // RFC 7238
    400 : 'Bad Request',
    401 : 'Unauthorized',
    402 : 'Payment Required',
    403 : 'Forbidden',
    404 : 'Not Found',
    405 : 'Method Not Allowed',
    406 : 'Not Acceptable',
    407 : 'Proxy Authentication Required',
    408 : 'Request Timeout',
    409 : 'Conflict',
    410 : 'Gone',
    411 : 'Length Required',
    412 : 'Precondition Failed',
    413 : 'Payload Too Large',
    414 : 'URI Too Long',
    415 : 'Unsupported Media Type',
    416 : 'Range Not Satisfiable',
    417 : 'Expectation Failed',
    418 : 'I\'m a teapot',              // RFC 2324
    421 : 'Misdirected Request',
    422 : 'Unprocessable Entity',       // RFC 4918
    423 : 'Locked',                     // RFC 4918
    424 : 'Failed Dependency',          // RFC 4918
    425 : 'Unordered Collection',       // RFC 4918
    426 : 'Upgrade Required',           // RFC 2817
    428 : 'Precondition Required',      // RFC 6585
    429 : 'Too Many Requests',          // RFC 6585
    431 : 'Request Header Fields Too Large',// RFC 6585
    500 : 'Internal Server Error',
    501 : 'Not Implemented',
    502 : 'Bad Gateway',
    503 : 'Service Unavailable',
    504 : 'Gateway Timeout',
    505 : 'HTTP Version Not Supported',
    506 : 'Variant Also Negotiates',    // RFC 2295
    507 : 'Insufficient Storage',       // RFC 4918
    508 : 'Loop Detected',
    509 : 'Bandwidth Limit Exceeded',
    510 : 'Not Extended',               // RFC 2774
    511 : 'Network Authentication Required' // RFC 6585
};

const CRLF = "\r\n";


/**
 * HTTP header field分析
 * @exports Parser.parseHeader
 * @constructor
 */
function Headers(){
    this.name = 'Headers';

}
/* // - - - sample - - - //
 GET ws://127.0.0.1:8080/ HTTP/1.1 \r\n
 Host: 127.0.0.1:8080\r\n
 Connection: Upgrade\r\n
 Pragma: no-cache\r\n
 Cache-Control: no-cache\r\n
 Upgrade: websocket\r\n
 Origin: http://localhost:53044\r\n
 Sec-WebSocket-Version: 13\r\n
 User-Agent: Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/46.0.2490.86\r\n Safari/537.36\r\n
 Accept-Encoding: gzip, deflate, sdch
 Accept-Language: zh-TW,zh;q=0.8,en-US;q=0.6,en;q=0.4,zh-CN;q=0.2\r\n
 Sec-WebSocket-Key: n8mj9pZt/h5Nkyl6Tos2LA==\r\n
 Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n
 \r\n\r\n
 */

Headers.prototype.readHeaders = function (chunk) {

    /* Variables */
    var data = chunk.toString('utf8');
    var lines = data.split("\r\n");
    var headers = {};
    var i = lines.length;

    if (lines.length === 1) return false;

    headers["source"] = data;
    headers["lines"] = lines;
    //Check is GET HTTP 1.1
    var reqMethod = lines[0].toString().match(/^(GET|POST|DELETE|OPTIONS|PUT|PATCH|COPY|HEAD|LINK|UNLINK|PURGE|LOCK|UNLOCK|PROPFIND|VIEW)? (.+)[\/]? HTTP\/\d\.\d$/i); // WS protocol namespace endpoint no '/'
    // [?=\/] 結尾不包含
    reqMethod = (reqMethod == null) ? lines[0].toString().match(/^(GET|POST|DELETE|OPTIONS|PUT|PATCH|COPY|HEAD|LINK|UNLINK|PURGE|LOCK|UNLOCK|PROPFIND|VIEW)? (.+) HTTP\/\d\.\d$/i) + "/" : reqMethod;
    if (reqMethod == "null/") return false;
    headers['general'] = [reqMethod[0],reqMethod[2],reqMethod[1]];

    if (lines == null) return false;

    //for (var i = 0; i < lines.length; i++) {
    //    var _value = lines[i].split(": ");
    //    headers[_value[0]] = _value[1];
    //};

    while(--i > 0) {

        if (lines[i] === null || lines[i] === '') continue;

        var  match = lines[i].toString().match(/^([a-z-A-Z-]+): (.+)/i);

        if (match === null) continue;
        match[1] = match[1].toLowerCase();
        /*
        if (match[1] == "x-forwarded-for") {
            match[2] = match[2].match(/\d+\.\d+\.\d+\.\d+/g)[0];
        }
        */
        if (match[1] == "x-forwarded-for" && typeof headers[match[1]] != "undefined") {
            console.error(Error("Handle duplicate X-Forwarde-For headers. param1: " + match[2] + " param2:" + headers[match[1]]));
            headers[match[1]] = match[2].match(/\d+\.\d+\.\d+\.\d+/g).join(",") + "," + headers[match[1]].match(/\d+\.\d+\.\d+\.\d+/g).join(",");
        } else {
            headers[match[1]] = match[2];
        }
    };
    return headers;
};
Headers.prototype.onReadTCPParser = function (chuck) {
    var request_headers = this.readHeaders(chuck);

    var source = request_headers["source"];
    if (typeof source === 'undefined') source = chuck.toString();
    // FLASH SOCKET \0
    const unicodeNull = (typeof source === 'undefined') ? null : source.match(/\0/g); // check endpoint

    const swfPolicy = (source.match("<policy-file-request/>") != null); // Flash Policy

    var upgrade = request_headers['upgrade'];
    if (upgrade) upgrade = upgrade.toLowerCase();

    const iswebsocket = ( upgrade === 'websocket'); // Websocket Protocol
    if (!request_headers) request_headers = {};
    request_headers['unicodeNull'] = unicodeNull; // check endpoint
    request_headers['swfPolicy'] = swfPolicy; // Flash Policy
    request_headers['iswebsocket'] = iswebsocket; // Websocket Protocol
    return request_headers;
};
/**
 * Websocket connection, the client sends a handshake request, and server return a handshake response.
 * @param {Array} reqHeaders client request headers
 * @param {Array=} customize customize request fields
 * @param {Boolean=} zlibDeflatedEnabled data 壓縮Deflated
 * @returns {string}: server response
 */
Headers.prototype.writeHandshake = function (reqHeaders, customize, zlibDeflatedEnabled) {

    const sKey = crypto.createHash("sha1").update(reqHeaders["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");

    let protoValue = reqHeaders['sec-websocket-protocol'];

    if (typeof protoValue != "undefined") protoValue = protoValue.split(",")[0];

    let protocol = ( protoValue ? 'Sec-WebSocket-Protocol: ' + protoValue : "");

    let resHeaders = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Accept: ' + sKey,
        'Origin: ' + reqHeaders['origin'],
        'Now: ' + mapping.hostname(process.env.NODE_CDID)
    ];

    if (typeof arguments[1] != "undefined" && typeof arguments[1]["content-encoding"] != "undefined") {
        resHeaders.push('content-encoding: ' + arguments[1]["content-encoding"]);

    }
    const wsExtensions = this.secWsExtensionsParse(reqHeaders["sec-websocket-extensions"], zlibDeflatedEnabled);
    if (wsExtensions != false) {
        resHeaders.push(wsExtensions);
    }

    if (protocol) {
        resHeaders.push(protocol);
    }
    return resHeaders.join(CRLF) + CRLF + CRLF;
};

Headers.prototype.secWsExtensionsParse = function (flags, zlibDeflatedEnabled) {
    if (zlibDeflatedEnabled) {
        const safari = (flags.indexOf("x-webkit-deflate-frame") != -1);
        const chrome = (flags.indexOf("permessage-deflate") != -1);
        if (chrome) {
            return "Sec-WebSocket-Extensions: permessage-deflate; server_max_window_bits=15";
        } else if (safari) {
            // console.log('safari', flags);
            return false;
        }
    }
    return false;
};

Headers.prototype.setHTTPHeader = function (name, value) {
    if (typeof name !== 'string') {
      throw new TypeError(
          'Header name must be a valid HTTP Token ["' + name + '"]');  }
    if (value == undefined)
      throw  new Error('"value" required in setHeader("' + name + '", value)');

    var key = name.toLowerCase();

    return key + ": " + value + CRLF;
};
Headers.prototype.responseHeader = function (code, reason, obj, skip) {
    var headers = "";

    headers += this.setStatusCode(code);

    if (typeof reason === 'string') {
        headers += reason;
    }else{
        obj = reason;
    }

    if (obj) {
        var keys = Object.keys(obj);
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (k) headers += this.setHTTPHeader(k, obj[k]);
        }
    }

    return headers + CRLF + (skip ? "" : CRLF);
};

Headers.prototype.setStatusCode = function (code) {

    return "HTTP/1.1 " + code + " " + status_code[code] + CRLF;
};

// ---------------------------------------------------------------------

function Protocols()
{
    this.INT32_MAX_VALUE =  Math.pow(2,32);
    this.masking_key = Buffer.alloc(4);
    this.compressed = false;
}
//0b00001000
/**
 *
 * @param buffer
 * @param firstFrame
 * @deprecated since version 2.0
 * @return {{msg: string, start: number, byteLength: *}|boolean}
 */
Protocols.prototype.readFraming = function (buffer, firstFrame) {
    //console.warn("@readFraming deprecated since version 2.0");
    var part = buffer[0],
        header_part,
        hasMask,
        len,i;
    var protocol = { 'start': 2, 'msg': '', byteLength:buffer.byteLength };

    if (firstFrame) {
        const fin = (part & 0x80) == 0x80;
        const rsv1 = (part & 0x40) == 0x40;
        const rsv2 = (part & 0x20) == 0x20;
        const rsv3 = (part & 0x10) == 0x10;

        if (rsv2 != false || rsv3 != false) return false;

        if (rsv1 === true) this.compressed = true;

        // console.log(part, fin, rsv1, (rsv2 != false || rsv3 != false), "compressed", this.compressed);
        protocol.fin    = fin;
        protocol.rsv1   = rsv1;
        protocol.rsv2   = rsv2;
        protocol.rsv3   = rsv3;
        protocol.info   = firstFrame;
    } else {
        header_part = part >> 4; //前四位是opcode |0|0|0|1| = 8
        if(header_part % 8 ) {
            // rsv1, rsv2,rsv3 必須被清除
            return false;
        };
        protocol.fin = (header_part === 8);
        protocol.rsv1   = 0;
        protocol.rsv2   = 0;
        protocol.rsv3   = 0;
        protocol.info   = firstFrame;
    }

    protocol.opcode = part % 16; // opcode max 0xf
    if (protocol.opcode < 0x00 || protocol.opcode > 0x0F ) {
        console.log("Invalid opcode:", protocol.opcode);
        // Invalid opcode
        return false;
    }

    if (protocol.opcode >= 8 && !protocol.fin) {
        // Control frames must not be fragmented
        console.log('Control frames must not be fragmented');
        return false;
    }

    part = buffer[1]; // mask, payload len info
    hasMask = part >> 7;

    len = part % 128; //  if 0-125, that is the payload length

    protocol.start = hasMask ? 6 : 2;

    protocol.payload_length = len;
    protocol.total = protocol.start + len;

    if (buffer.length < (protocol.start + len))
    {
        return protocol;// Not enough data in the buffer
    }

    // Get the actual payload length // 1-7bit = 127
    if (len === 126)  {

        len = buffer.readUInt16BE(2); // a 16-bit unsigned integer
        protocol.start += 2; // If 126, the following 2 bytes interpreted as a 16-bit unsigned integer;
    } else if (len === 127) {
        // Warning: JS can only store up to 2^53 in its number format
        len = buffer.readUInt32BE(2) * this.INT32_MAX_VALUE + buffer.readUInt32BE(6);
        protocol.start += 8; // If 127, the following 8 bytes interpreted as a 64-bit unsigned integer;
    }
    protocol.payload_length = len;
    protocol.total = protocol.start + len;

    if (buffer.length < (protocol.start + len)) return protocol;

    // Extract the payload
    protocol.payload = buffer.slice(protocol.start, protocol.start+len);

    if (hasMask) {
        // if mask start is masking-key,but be init set start 6 so need -4
        // frame-masking-key : 4( %x00-FF )
        protocol.mask = buffer.slice(protocol.start - 4, protocol.start);
        // by c decode
        for (i = 0; i < protocol.payload.length; i++) {
            // j = i MOD 4 //
            // transformed-octet-i = original-octet-i XOR masking-key-octet-j //
            protocol.payload[i] ^= protocol.mask[i % 4];　// [RFC-6455 Page-32] XOR
        }
        //bufferUtil.unmask(protocol.payload, protocol.mask)
    }
    //set final buffer size
    buffer = buffer.slice(protocol.start + len);
    if (protocol.opcode == 2)
        protocol.msg = protocol.payload;
    else
        protocol.msg = protocol.payload;
    // Proceeds to frame processing
    protocol.byteLength = protocol.byteLength - buffer.byteLength;
    return protocol;
};
var _meta = undefined;
/**
 *
 * @param fin
 * @param opcode
 * @param masked
 * @param payload
 * @deprecated since version 2.0
 * @return {Buffer}
 */
Protocols.prototype.writeFraming = function (fin, opcode, masked, payload) {
    var len, meta, start, mask, i;
    console.error("deprecated since version 2.0");
    len = payload.length;
    // fix Buffer Reusable
    if (typeof _meta === 'undefined' || _meta.length < len) {
        // Creates the buffer for meta-data
        meta = Buffer.allocUnsafe(2 + (len < 126 ? 0 : (len < 65536 ? 2 : 8)) + (masked ? 4 : 0));
    }
    // meta = _meta;

    // Sets fin and opcode
    meta[0] = (fin ? 128 : 0) + opcode;

    // Sets the mask and length
    meta[1] = masked ? 128 : 0;
    start = 2;
    if (len < 126) {
        meta[1] += len;
    } else if (len < 65536) {
        meta[1] += 126;
        meta.writeUInt16BE(len, 2);
        start += 2
    } else {
        // Warning: JS doesn't support integers greater than 2^53
        meta[1] += 127;
        meta.writeUInt32BE(Math.floor(len / this.INT32_MAX_VALUE), 2);
        meta.writeUInt32BE(len % this.INT32_MAX_VALUE, 6);
        start += 8;
    }

    // Set the mask-key 4 bytes(client only)
    if (masked) {
        mask = this.masking_key;
        // mask = crypto.randomBytes(4);
        // bufferUtil.mask(payload, mask, payload, start, payload.length);
        for (i = 0; i < 4; i++) {
            meta[start + i] = mask[i] = Math.floor(Math.random() * 256);
        }
        for (i = 0; i < payload.length; i++) {
            payload[i] ^= mask[i % 4];
        }
        start += 4;
    }

    return meta;
};
Protocols.prototype.Utf8ArrayToStr = function (array) {
    var out, i, len, c;
    var char2, char3;

    out = "";
    len = array.length;
    i = 0;
    while(i < len) {
        c = array[i++];
        switch(c >> 4)
        {
            case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
            // 0xxxxxxx
            out += String.fromCharCode(c);
            break;
            case 12: case 13:
            // 110x xxxx   10xx xxxx
            char2 = array[i++];
            out += String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F));
            break;
            case 14:
                // 1110 xxxx  10xx xxxx  10xx xxxx
                char2 = array[i++];
                char3 = array[i++];
                out += String.fromCharCode(((c & 0x0F) << 12) |
                    ((char2 & 0x3F) << 6) |
                    ((char3 & 0x3F) << 0));
                break;
        }
    }

    return out;
}

module.exports = exports = {'headers':new Headers(), parseHeader: Headers, Encoder: Protocols,'protocols':new Protocols(), status_code}
