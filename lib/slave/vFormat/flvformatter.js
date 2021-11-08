/**
 * Created by Benson.Liao on 2016/8/29.
 */

const fs = require('fs');

const RTMP_PACKET_TYPE =
{
    SET_CHUNK_SIZE:   0x01,
    PING_MSG:         0x04,
    SRV_BANDWIDTH:    0x05,
    CLI_BANDWIDTH:    0x06,
    AUDIO_PACKET:     0x08,
    VIDEO_PACKET:     0x09,
    AMF3_CMD:         0x11,
    METADATA:         0x12, /* 22 */
    AMF0_CMD:         0x14
};


function flvformatter(file) {

    if (!file) file = (new Date().getTime()) + ".flv";

    this.fxFile = fs.createWriteStream(file,{ flags:'w' });
    this.fxFile.writeSize = 0;

    this._setFileHeader(this.fxFile);

};

flvformatter.prototype.init = function () {

};

flvformatter.prototype._setFileHeader = function (flv_fs) {
    var buf = new Buffer(13);
    buf.write("F");
    buf.write("L");
    buf.write("V");
    buf.writeUInt8(1, 3);
    buf.writeUInt8(0x09, 4);
    buf.writeUInt32BE(9, 5);
    buf.writeUInt32BE(0, 9);

    flv_fs.write(buf);
};
flvformatter.prototype._setVideoHeader = function (tag, size, times, streamid) {

    var buf = new Buffer(11);
    buf[0] = tag;                         //(1)
    this.writeUInt24BE(buf, size, 1);     //(3)
    buf.writeUInt32BE(times, 4);          //(4)
    this.writeUInt24BE(buf, streamid, 8); //(3)

    return buf;
};
flvformatter.prototype.writeNextFrame = function (tag, size, times, streamid, data) {

    var header = this._setVideoHeader(tag, size, times, streamid);

    var frPacket = Buffer.concat([header, data], header.byteLength + data.byteLength);

    this.fxFile.write(frPacket);

};


module.exports = exports = flvformatter;