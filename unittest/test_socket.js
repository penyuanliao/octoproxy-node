/**
 * Created by Benson.Liao on 2016/8/16.
 */
const assert = require('assert');
const fs    = require('fs');




var nbufs = fs.readFileSync('./slave/rtmpData.JSON');
var offset = 13;
var start_offset = 13;
var size, timestamp, streamid, codecType;
describe('FLV Render', function() {
    describe('UInt24BE', function () {

        var buf = new Buffer(13);

        it('write&read', function() {
            var buf = new Buffer(4);
            buf[3] = 1234 & 0xff;
            buf[2] = 1234 >> 8;
            buf[1] = 1234 >> 16;
            var mv = 0;
            var value = buf.readUInt8(++mv) << 16;     // (1)
            value += buf.readUInt8(++mv) << 8;     // (2)
            value += buf.readUInt8(++mv);          // (3)
            assert.equal(value, 1234);
        });
    });

    describe('Loaded flv file basicHeader', function() {
        it('1. 1st tagType', function() {
            assert.equal(0x09, nbufs[offset]);
        });
        it('2. 1st videoSize', function() {
            size = nbufs.readUInt8(++offset) << 16;     // (1)
            size += nbufs.readUInt8(++offset) << 8;     // (2)
            size += nbufs.readUInt8(++offset);          // (3)

            // console.log('----> ',nbufs[size + 13 + 11]);

            // assert.equal(16347, size);
            assert.equal(0x09, nbufs[size + 13 + 11]);
            console.log('\n size:%s', size);
        });
        it('3. 1st timestamp', function() {

            timestamp = nbufs.readUInt32BE(offset+1);
            offset+=4;
            console.log('\n timestamp:%s', timestamp);
            assert.equal(0, timestamp);
        });
        it('4. 1st streamID', function() {

            streamid = nbufs.readUInt8(++offset) << 16;     // (1)
            streamid += nbufs.readUInt8(++offset) << 8;     // (2)
            streamid += nbufs.readUInt8(++offset);          // (3)
            console.log('\n streamid:%s', streamid);
            assert.equal(1, streamid);
        });
        it('5. 1st codecType', function() {
            codecType = nbufs[++offset];
            console.log('\n 1st codecType:%s', codecType);
            assert.equal(0x14, codecType);
        });
        it('6. 2nd tagType', function() {

            offset = offset + size;

            assert.equal(0x09, nbufs[offset]);
            start_offset = offset;
        });
        it('7. 2nd videoSize', function() {
            size = nbufs.readUInt8(++offset) << 16;     // (1)
            size += nbufs.readUInt8(++offset) << 8;     // (2)
            size += nbufs.readUInt8(++offset);          // (3)
            assert.equal(nbufs[size + start_offset + 11], 0x09);
            console.log('\n size:%s', size);
        });
        it('8. 2nd timestamp', function() {

            timestamp = nbufs.readUInt32BE(offset+1);
            offset+=4;
            console.log('\n timestamp:%s', timestamp);
            assert.equal(0, timestamp);
        });
        it('9. 2nd streamID', function() {

            streamid = nbufs.readUInt8(++offset) << 16;     // (1)
            streamid += nbufs.readUInt8(++offset) << 8;     // (2)
            streamid += nbufs.readUInt8(++offset);          // (3)
            console.log('\n streamid:%s', streamid);
            assert.equal(1, streamid);
        });
        it('10. 2nd codecType', function() {
            codecType = nbufs[++offset];
            console.log('\n 1st codecType:%s', codecType);
            assert.equal(0x24, codecType);
        });
    });
});