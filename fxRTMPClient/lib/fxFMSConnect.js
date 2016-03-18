/**
 * Created by Benson.Liao on 16/3/15.
 */
var net = require('net'),
    events = require('events'),
    util = require('util');

function fxFMSConnect() {
    this.socket = undefined;
    this.state = "Stop";
};


fxFMSConnect.prototype = {

    init: function () {

    },

    connect: function (host, port, cb) {

        this.state = "Connecting"

        const RTMPPORT_DEFAULT = 1935;
        if (!port) {
            port = RTMPPORT_DEFAULT;
        }

        var sock = this.socket = new net.Socket();
        sock.connect(host || port, cb);
    },

    release: function () {

    }

};
const isNull = function (value) {

    if (value == null || typeof value == 'undefined')
        return true;
    else
        return false;
}

const ReadUInt24BE = function (buf, offset) {
    if (isNull(offset)) {
        offset = 0;
    }

    return (buf[0 + offset] << 16) + (buf[1 + offset] << 8) + buf[2 + offset];
};

const WriteUInt24BE = function (buf, value, offest) {
    if (isNull(offset)) {
        offset = 0;
    };

    buf[offest]     = (value >> 16) & 0xFF;
    buf[offest + 1] = (value >> 8) & 0xFF;
    buf[offest + 2] = value & 0xFF;
};


module.exports = exports = fxFMSConnect;

var fms = new fxFMSConnect();
fms.init();