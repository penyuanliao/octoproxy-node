/**
 * Created by Benson.Liao on 2016/10/14.
 */
const assert = require('assert');
const Daemon = require('../lib/FxDaemon.js');
describe('test Daemon running.', function () {
    var proc = new Daemon("./test/test.js");
    proc.init();
    var restart = false;
    before(function () {

        console.log("before");



    });
    describe('#Runing daemon', function () {

        it('should init value with 2048', function () {
            assert.equal(proc.mxoss, 2048)
        });
        it('_killed default true', function () {
            assert.equal(proc._killed, false);
        });

    });

    describe('#Send daemon', function () {
        it('child.send() is called with argument: null', function (done) {
            proc.send("helloworld", function (err) {

                if (err) done(err);

                done();
            });
        });

        it('child.send() is called with received it', function (done) {

            proc.emitter.on('test', function (data) {

                if (data.data == "helloworld") {
                    done();
                }else
                {
                    done(data);
                }
            });

            // proc.send("helloworld");
        });
    });


    describe('#Restart daemon', function () {


        this.timeout(1100);
        it('Daemon to restart with starting', function () {
            proc.restart();

            assert.equal(proc._killed, true);
        });
        it('Daemon to restart than 1000ms for setup completed.', function (done) {

            setTimeout(function () {
                if (proc._killed == false) done();
            }, 1000);

        });

    });

    describe('#Stoped daemon', function () {
        it('Daemon to stop', function () {
            proc.stopHeartbeat();
            proc.stop();

            assert.equal(proc._killed, true);
        });
    });
});

