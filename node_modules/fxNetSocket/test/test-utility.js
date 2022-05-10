/**
 * Created by Benson.Liao on 2016/8/18.
 */
const assert = require('assert');
const utitlies = require('../lib/FxUtility.js');
const url = "/fxlive/Hall/service.h1?gameType=5050";
describe('This function parses a URL('+url+')', function() {
    describe('Show the Path', function() {
        it('should return array[0] a string(/fxlive/Hall/service.h1)', function() {
            var args = utitlies.parseUrl(url);
            assert.equal(args[0],'/fxlive/Hall/service.h1');
        });

    });
    describe('Show the arg=value', function() {
        it('should return array[1] a string (?gameType=5050)', function() {
            var args = utitlies.parseUrl(url);
            assert.equal(args[1], '?gameType=5050');
        });

    });
});