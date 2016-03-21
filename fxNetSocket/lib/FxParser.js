/**
 * Created by Benson.Liao on 2015/11/17.
 */
var crypto = require("crypto");

const status_code = exports.statusCode = {
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
    var reqMethod = lines[0].toString().match(/^GET (.+)[\/]? HTTP\/\d\.\d$/i); // WS protocol namespace endpoint no '/'
    // [?=\/] 結尾不包含
    reqMethod = (reqMethod == null) ? lines[0].toString().match(/^GET (.+) HTTP\/\d\.\d$/i) + "/" : reqMethod;
    headers['general'] = reqMethod;

    if (lines == null) return false;

    //for (var i = 0; i < lines.length; i++) {
    //    var _value = lines[i].split(": ");
    //    headers[_value[0]] = _value[1];
    //};

    while(--i > 0) {

        if (lines[i] === null | lines[i] === '') continue;

        var  match = lines[i].toString().match(/^([a-z-A-Z-]+): (.+)/i);

        if (match === null) continue;

        headers[match[1].toLowerCase()] = match[2];
    };
    return headers;
};
Headers.prototype.onReadTCPParser = function (chuck) {
    var request_headers = this.readHeaders(chuck);

    var source = request_headers["source"];
    if (typeof source === 'undefined') source = "";
    // FLASH SOCKET \0
    var unicodeNull = (typeof source === 'undefined') ? null : source.match(/\0/g); // check endpoint

    var swfPolicy = source.match("<policy-file-request/>") == null; // Flash Policy

    var iswebsocket = (request_headers['upgrade'] === 'websocket'); // Websocket Protocol

    request_headers['unicodeNull'] = unicodeNull; // check endpoint
    request_headers['swfPolicy'] = swfPolicy; // Flash Policy
    request_headers['iswebsocket'] = iswebsocket; // Websocket Protocol

    return request_headers;
};
/**
 * Websocket connection, the client sends a handshake request, and server return a handshake response.
 * @param reqHeaders: client request
 * @returns {string}: server response
 */
Headers.prototype.writeHandshake = function (reqHeaders) {


    var sKey = crypto.createHash("sha1").update(reqHeaders["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    var resHeaders = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Accept: ' + sKey,
        'Sec-WebSocket-Origin: ' + reqHeaders['Origin'],
        'Sec-WebSocket-Location: ' + reqHeaders['Origin']
    ];
    return resHeaders.join(CRLF) + CRLF + CRLF;
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
Headers.prototype.responseHeader = function (code, reason, obj) {
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

    return headers + CRLF + CRLF;
};

Headers.prototype.setStatusCode = function (code) {

    return "HTTP/1.1 " + code + " " + status_code[code] + CRLF;
};

// ---------------------------------------------------------------------

function Protocols()
{
    this.INT32_MAX_VALUE =  Math.pow(2,32);
    this.masking_key = new Buffer(4);
}

Protocols.prototype.readFraming = function (buffer) {
    var part = buffer[0],
        header_part,
        hasMask,
        len,i;
    var protocol = { 'start': 2, 'msg': '' };
    header_part = part >> 4; //前四位是opcode |0|0|0|1| = 8
    if(header_part % 8 ) {
        // rsv1, rsv2,rsv3 必須被清除
        return false;
    };

    protocol.fin = (header_part === 8);
    protocol.rsv1   = 0;
    protocol.rsv2   = 0;
    protocol.rsv3   = 0;

    protocol.opcode = part % 16; // opcode max 0xf

    if (protocol.opcode !== 0 && protocol.opcode !== 1 &&
        protocol.opcode !== 2 && protocol.opcode !== 8 &&
        protocol.opcode !== 9 && protocol.opcode !== 10 ) {
        // Invalid opcode
        return false;
    }

    if (protocol.opcode >= 8 && !protocol.fin) {
        // Control frames must not be fragmented
        return false;
    }

    part = buffer[1]; // mask, payload len info
    hasMask = part >> 7;

    len = part % 128; //  if 0-125, that is the payload length

    protocol.start = hasMask ? 6 : 2;


    if (buffer.length < protocol.start + len)
    {
        return;// Not enough data in the buffer
    }

    // Get the actual payload length // 1-7bit = 127
    if (len === 126)  {

        len = buffer.readUInt16BE(2); // a 16-bit unsigned integer
        protocol.start += 2; // If 126, the following 2 bytes interpreted as a 16-bit unsigned integer;
    }else if (len === 127) {
        // Warning: JS can only store up to 2^53 in its number format
        len = buffer.readUInt32BE(2) * this.INT32_MAX_VALUE + buffer.readUInt32BE(6);
        protocol.start += 8; // If 127, the following 8 bytes interpreted as a 64-bit unsigned integer;
    }

    if (buffer.length < protocol.start + len) return;

    // Extract the payload
    protocol.payload = buffer.slice(protocol.start, protocol.start+len);

    if (hasMask) {
        // if mask start is masking-key,but be init set start 6 so need -4
        // frame-masking-key : 4( %x00-FF )
        protocol.mask = buffer.slice(protocol.start - 4, protocol.start);
        for (i = 0; i < protocol.payload.length; i++) {
            // j = i MOD 4 //
            // transformed-octet-i = original-octet-i XOR masking-key-octet-j //
            protocol.payload[i] ^= protocol.mask[i % 4];　// [RFC-6455 Page-32] XOR
        }
    }
    //set final buffer size
    buffer = buffer.slice(protocol.start + len);
    protocol.msg = protocol.payload.toString();
    // Proceeds to frame processing
    return protocol;
};
var _meta = undefined;
Protocols.prototype.writeFraming = function (fin, opcode, masked, payload) {
    var len, meta, start, mask, i;

    len = payload.length;
    // fix Buffer Reusable
    if (typeof _meta === 'undefined' || _meta.length < len) {
        // Creates the buffer for meta-data
        _meta = new Buffer(2 + (len < 126 ? 0 : (len < 65536 ? 2 : 8)) + (masked ? 4 : 0));
    }
    meta = _meta;

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



module.exports = exports = {'headers':new Headers(),'protocols':new Protocols()}