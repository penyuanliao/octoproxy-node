/**
 * Created by penyuan on 2016/3/21.
 */
const crypto = require('crypto');


const RTMP_VERSTION = 0x03;
const SHA_256_BITS = 32;
var chunk = new Buffer(1536);
function FxHandshake() {
    
}

FxHandshake.prototype = {
    readChunkS0:function (data) {
        return new chunkS0(data);
    },

    readChunkS1:function (data) {
        return new chunkS1(data);
    }



}

function chunkS0(chunk) {
    this.version = chunk.readUInt8(0);
}
chunkS0.prototype.isValid = function () {
    return this.version == RTMP_VERSTION;
};

// =============================== //
//        Read S1 Handshake        //
// =============================== //

function chunkS1() {

}
chunkS1.detectClientMessageFormat = function (buf) {
    var sdl = this.getServerGenuineConstDigestOffset(buf.slice(772, 776));
};
//server digest offset
chunkS1.getServerGenuineConstDigestOffset = function(buf) {
    var offset = buf[0] + buf[1] + buf[2] + buf[3];
    offset = (offset % 728) + 776;
    return offset;
};


function createHmac(data, key) {
    //對稱式
    var hmac_sha256 = crypto.createHmac('sha256', key);
    hmac_sha256.update(data);
    return hmac_sha256.digest();
}


module.exports = new FxHandshake();