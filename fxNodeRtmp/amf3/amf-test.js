/**
 * Created by Benson.Liao on 2016/11/13.
 */
const assert = require('assert');
const amf3Utils = require('./amf3Utils.js');
describe('amf3Utils.js', function() {

    var serializer = new amf3Utils.serializer();
    var deserializer = new amf3Utils.deserializer();

    describe('serializer', function() {

        it('@type {null} can stringify null', function() {
            var buf = Buffer.from('01', 'hex');
            assert.equal(serializer.amf3Encode(null, 0x01).toString(), buf.toString());

        });

        it('@type {boolean} can stringify false', function() {
            var buf = Buffer.from('02', 'hex');
            assert.equal(serializer.amf3Encode(false, 0x02), buf.toString());

        });

        it('@type {boolean} can stringify true', function() {
            var buf = Buffer.from('03', 'hex');
            assert.equal(serializer.amf3Encode(true, 0x03), buf.toString());

        });

        it('@type {integer}: can stringify integer 6', function() {
            assert.equal(serializer.amf3Encode(6, 0x04).toString('hex'), '0406');
        });

        it('@type {double} can stringify double 15.24', function() {
            assert.equal(serializer.amf3Encode(15.24, 0x05).toString('hex'), "05402e7ae147ae147b");
        });

        it('@type {double} can stringify variable-length unsigned integer 2^28 - 1', function() {
            assert.equal(serializer.amf3Encode(Math.pow(2,28)-1, 0x04).toString('hex'), "04bfffffff");
        });

        it('@type {double} can stringify variable-length unsigned integer 2^29 - 1', function() {
            assert.equal(serializer.amf3Encode(Math.pow(2,29)-1, 0x04).toString('hex'), "04ffffffff");
        });

        it('@type {string} can stringify string "hi"', function() {
            assert.equal(serializer.amf3Encode("hi", 0x06).toString('hex'), "06056869");
        });

        it('@type {string} can stringify string UTF-8 "①②④"', function() {
            assert.equal(serializer.amf3Encode("①②④", 0x06).toString('hex'), "0613e291a0e291a1e291a3");
        });

        it('@type {array} can stringify array [1,2,3,4,5]', function() {
            assert.equal(serializer.amf3Encode([1,2,3,4,5], 0x09).toString('hex'), "090b0104010402040304040405");
        });

        it('@type {object} can stringify dynamic object { him: 3 }', function() {
            assert.equal(serializer.amf3Encode({him:3}, 0x0a).toString('hex'), "0a0b010768696d040301");
        });

        it('@type {object} can stringify composite types in object', function() {
            var composite_obj = { enabled: true, list:[1,2,3,4], he:"her", "group" : {"val":true,he:"he"}};

            var buf = "0a0b010f656e61626c656403096c697374090901040104020403040405686506076865720b67726f75700a010776616c030406040101";

            assert.equal(serializer.amf3Encode(composite_obj, 0x0A).toString('hex'), buf);

        });

        it('@type {object} can stringify dynamic object { list: ["1","2","3"] }', function() {
            assert.equal(serializer.amf3Encode({ list: ["1","2","3"] },0x0A).toString('hex'), "0a0b01096c69737409070106033106033206033301");

        });

        it('@type {buffer} can stringify Uint8Array(ByteArray)', function() {
            assert.equal(serializer.amf3Encode(Buffer.from('010203','hex'),0x0C).toString('hex'), "0c07010203");

        });
    });

    describe('deserializer', function() {

        it('@type {undefined} can parse undefined', function() {
            var buf = Buffer.from('00', 'hex');
            assert.equal(deserializer.amf3Decode(buf), undefined);

        });

        it('@type {null} can parse null', function() {
            var buf = Buffer.from('01', 'hex');
            assert.equal(deserializer.amf3Decode(buf), null);

        });

        it('@type {null} can parse false', function() {
            var buf = Buffer.from('02', 'hex');
            assert.equal(deserializer.amf3Decode(buf), false);

        });

        it('@type {null} can parse true', function() {
            var buf = Buffer.from('03', 'hex');
            assert.equal(deserializer.amf3Decode(buf), true);

        });

        it('@type {double} can parse double 15.24', function() {
            var buf = Buffer.from('05402e7ae147ae147b', 'hex');
            assert.equal(deserializer.amf3Decode(buf), 15.24);

        });

        it('@type {date} can parse Date "1468781787186"', function() {
            var buf = Buffer.from('080142755fa377832000', 'hex');
            var d   = deserializer.amf3Decode(buf);

            assert.equal(typeof d, 'object');
            assert.equal(d.constructor, Date);
            assert.equal(d.getTime(), 1468781787186);

        });

        it('@type {number} can parse integer 6', function() {
            var buf = Buffer.from("0406", "hex");
            assert.equal(deserializer.amf3Decode(buf), 6);

        });

        it('@type {double} can parse variable-length unsigned integer 2^28 - 1', function() {
            var buf = Buffer.from("04bfffffff", "hex");
            assert.equal(deserializer.amf3Decode(buf), Math.pow(2,28)-1);

        });

        it('@type {double} can parse variable-length unsigned integer 2^29 - 1', function() {
            var buf = Buffer.from("04ffffffff", "hex");
            assert.equal(deserializer.amf3Decode(buf), Math.pow(2,29)-1);

        });

        it('@type {string} can parse string "hi"', function() {
            var buf = Buffer.from("06056869", "hex");
            assert.equal(deserializer.amf3Decode(buf), "hi");
        });

        it('@type {string} can parse string UTF-8 "①②④"', function() {
            var buf = Buffer.from("0613e291a0e291a1e291a3", "hex");
            assert.equal(deserializer.amf3Decode(buf), "①②④");
        });

        it('@type {array} can parse array [1,2,3,4,5]', function() {
            var buf = Buffer.from("090b0104010402040304040405", "hex");
            assert.equal(JSON.stringify(deserializer.amf3Decode(buf)), JSON.stringify([1,2,3,4,5]));
        });

        it('@type {object} can parse dynamic object { him: 3 }', function() {
            var buf = Buffer.from("0a0b010768696d040301", "hex");
            assert.equal(JSON.stringify(deserializer.amf3Decode(buf)), JSON.stringify({ him: 3 }));

        });

        it('@type {object[reference]} can parse reference strings { test: "test" }', function() {

            var data = {"test":'test'};
            var data_amf3 = "0a0b010974657374060001";
            var buf = Buffer.from(data_amf3, "hex");
            assert.equal(JSON.stringify(deserializer.amf3Decode(buf)), JSON.stringify(data));

        });

        it('@type {object} can parse composite types in object', function() {
            var composite_obj = { enabled: true, list:[1,2,3,4], he:"her", "group" : {"val":true,he:"he"}};

            var buf = Buffer.from("0a0b010f656e61626c656403096c697374090901040104020403040405686506076865720b67726f75700a010776616c030406040101", "hex");

            assert.equal(JSON.stringify(deserializer.amf3Decode(buf)), JSON.stringify(composite_obj));

        });

        it('@type {object} can parse dynamic object { list: ["1","2","3"] }', function() {
            var buf = Buffer.from("0a0b01096c69737409070106033106033206033301", "hex");
            assert.equal(JSON.stringify(deserializer.amf3Decode(buf)), JSON.stringify({ list: ["1","2","3"] }));

        });

        it('@type {buffer} can parse Uint8Array(ByteArray)', function() {
            var buf = Buffer.from("0c07010203", "hex");
            assert.equal(deserializer.amf3Decode(buf).toString(), Buffer.from('010203','hex').toString());

        });
    });

});