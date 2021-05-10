/**
 * Created by Benson.Liao on 18/06/05.
 */
const util = require("util");
const stream = require("stream");
const Readable = stream.Readable;
const Transform = stream.Transform;
const log = require("./log.js");
util.inherits(SegmentPool, Transform);

function SegmentPool() {
    EventEmitter.call(this);
}
SegmentPool.prototype._transform = function (buf, enc, next) {



    this.push(buf);
    next();
};

module.exports = exports = SegmentPool;

/*

SegmentPool.on("data", function (data) {
    console.log('transform:%s', data.toString());
});

SegmentPool.write("Hello");

 */