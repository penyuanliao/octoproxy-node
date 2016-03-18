exports.AMF = require('./amf');
exports.RTMPClient = require('./client');
exports.RTMPPacket = require('./packet');
exports.RTMPMessage = require('./message');
exports.AMFLOG = require('./log');
exports.amfUtils = require('./amfutils.js');

exports.RTMP = {
    AMF: exports.AMF,
    RTMPClient: exports.RTMPClient,
    RTMPMessage:exports.RTMPMessage,
    AMFLOG:exports.AMFLOG,
    amfUtils:exports.amfUtils
};
