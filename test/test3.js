const zlib = require("zlib");
const json = {"hello": "word"};
const buf = Buffer.from(JSON.stringify(json));
const stream        = require("stream");
const Transform     = stream.Transform;

const deflate = zlib.createDeflateRaw({windowBits: zlib.Z_DEFAULT_WINDOWBITS});
deflate.on("data", function (data) {
    console.log(data);
});

zlib.deflateRaw(buf, function (err, buf) {
    // console.log(buf);
});

const transform = new Transform();
transform._transform = function (data, enc, next) {
    this.push(data);
    next();
};
transform.on("readable", function (data) {
    console.log('readable', data);
});
transform.on("data", function (data) {
    console.log('data', data);
});
deflate.pipe(transform);

deflate.write(buf);
deflate.flush();