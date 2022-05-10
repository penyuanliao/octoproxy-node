/**
 * Created by Benson.Liao on 2016/8/19.
 * @module Fxnconf
 */
const fs     = require('fs');
const path   = require('path');
const events = require('events');
const util   = require('util');
const os     = require('os');
const NSLog  = require('./FxLogger').getInstance();


util.inherits(Fxnconf, events.EventEmitter);

/**
 * 讀取設定檔案
 * @param file
 * @param cb
 * @version 1.0.0
 * @constructor
 */
function Fxnconf(file, cb) {

    events.EventEmitter.call(this);
    
    this._isReady = false;

    if (typeof arguments[0] == 'string') {
        this.loadFiles(arguments[0], cb);
    }else if (typeof arguments[0] == 'undefined' && os.platform() == "linux" ) {

        var env = process.env.NODE_ENV;
        var fileName = 'info';
        var type     = '.json';
        if (typeof env == 'undefined') {
            env = "";
        }else {
            env = '-' + env;
        }
        this.loadFiles('../configuration/' + fileName + env + type);
    }

};
Fxnconf.prototype.loadFiles = function (file, cb) {
    var self = this;
    self._isReady = false;
    if (!self._verifyfile(file)) return;

    var conf;

    try {
        var data = fs.readFileSync(file, 'utf8');
        conf = JSON.parse(data.toString());
        self.conf = conf;
        if (cb) cb(conf);
        self._isReady = true;
        self.emit('ready', self.conf);
    }
    catch (e) {
        console.log('FxConf load file error:', e);
    }

}
Fxnconf.prototype._verifyfile = function (file) {
    if (typeof file == 'undefined') {
        console.log('The above file name is invalid.');
        return false;
    }

    return true;
}

Fxnconf.prototype.__defineGetter__("isReady", function () {
    return this._isReady;
})
exports.getConfig = function (path) {
    var nconf = new Fxnconf(path);

    return nconf.conf;
};
/**
 * 讀取檔案ip
 * @param name
 * @param subPath
 * @returns {String}
 */
exports.getConfiguration = function (name, subPath) {
    var obj = new iConfiguration(name, subPath);

    if (typeof obj.files == "undefined") {
        NSLog.log("error",new Error("Loading Configuation json not found."));
        return -1;
    }
    if (obj.files.constructor === Object) {
        if (typeof arguments[2] != "undefined"){
            arguments[2]("info","Loading Configuation file:%s choose name:'%s', ip:'%s'", name, obj.files["pipelines"].name, obj.files["pipelines"].ip);
        }else {
            NSLog.log("info","Loading Configuation file:%s choose name:'%s', ip:'%s'", name, obj.files["pipelines"].name, obj.files["pipelines"].ip);
        }

        return obj.files["pipelines"].ip;
    }

    return obj.files["pipelines"];
}
function iConfiguration(name, subPath) {
    var env //= process.env.NODE_ENV;
    var fileName = 'info';
    var type     = '.json';

    if (typeof arguments[0] == 'string') {
        fileName = name;
    }else if (typeof arguments[0] == 'undefined') {
        process.stdout.write('ERROR Palase get configuation file name.\n');
        process.exit(0);
    }

    if (typeof env == 'undefined') {
        env = "";
    }else {
        env = '-' + env;
    }
    if (typeof subPath == "undefined") subPath = "";


    if (os.platform() == "linux") {
        this.files = this.loadFiles(path.join('../configuration/', subPath) + path.basename(fileName, ".json") + env + type);
    } else {
        if (path.extname(fileName)) type = "";
        if (fileName.indexOf("/") == -1){
            fileName = path.join('../configuration/', subPath, fileName);
        }
        this.files = this.loadFiles(fileName + env + type);
    }
 
};
iConfiguration.prototype.loadFiles = function (path) {
    // process.stdout.write("loadFiles:" + path + "\n");
    var self = this;
    var conf;

    try {
        var data = fs.readFileSync(path, 'utf8');
        conf = eval("("+data+")");
        return conf;
    }
    catch (e) {
        console.log('Configuation load file error:', e);
    }
}