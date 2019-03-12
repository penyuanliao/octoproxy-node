/**
 * Created by Benson.Liao on 16/1/5.
 */
var config = {};
config.appConfig = appParames();
config.env = process.env.NODE_ENV;

process.env.pkg_compiler = config.pkg_compiler = (typeof process.versions.pkg != "undefined" && typeof process.pkg != "undefined");
if (config.pkg_compiler) process.pkg.compiler = true;

/**
 * host: ip4 - '0.0.0.0', ip6 - '::'
 * FX
 * Backlog: pending connections
 * **/

config.numCPUs = require('os').cpus().length;
/** 開發環境設定 **/
if (config.env == 'development') {
    config.bFMSHost = require('fxNetSocket').getConfiguration("OctoProxy-Dev");
    config.bExceptions = [
        {"Host":"127.0.0.1", "rules":["/BacPlayerVip"]}
    ];
    config.bFMSPort = 1935;
    config.srvOptions = {
        'host': '0.0.0.0',
        'port': config.appConfig.port,
        'closeWaitTime':5000,
        'backlog': 511
    };
    //建立第二台一樣服務只需複製一樣設定即可
    //合併服務用逗號區隔ex:'Hall, Hall2'
    //會清除空白符號
    config.forkOptions = require('fxNetSocket').getConfig('../configuration/Assign-gm.json');
    config.gamSLB = {
        enabled:true,
        // file: './unittest/GLBS.js',
        file: '../../SVN/NodeJS/LoadBalancer/NodeLB.js',
        assign:'/fxLB',
        /* 處理視訊lb */
        videoEnabled:false,
        vPrefix: 'edge_'
    };
} else {
    
    /** 伺服器環境設定 **/
    config.bFMSHost = require('fxNetSocket').getConfiguration("OctoProxy");
    config.bExceptions = [
        {"Host":"127.0.0.1", "rules":["/BacPlayerVip"]}
    ];
    config.bFMSPort = 1935;
    config.srvOptions = {
        'host': '0.0.0.0',
        'port': config.appConfig.port,
        'closeWaitTime':5000,
        'backlog': 511
    };
    config.forkOptions = require('fxNetSocket').getConfig('../configuration/Assign.json');

    config.gamSLB = {
        enabled:true,
        file: '../../SVN/NodeJS/LoadBalancer/NodeLB.js',
        assign:'/fxLB',
        /* 處理視訊lb */
        videoEnabled:false,
        vPrefix: 'edge_'
    };
}
//todo define the balance
config.balance = 'leastconn';//roundrobin

/**
 * Application parameters
 * @param -p port
 * @param -f loadfile or remote link
 * **/
function appParames(){
    var args = {};
    process.argv.forEach(function(element, index, arr) {
        // Processing
        if (element === "-p") {
            var port = parseInt(process.argv[index + 1]);
            args["port"] = !isNaN(port) ? port : ((config.env == 'development') ? 8000:80);
        }else if (element === "-f") {
            var fileName = process.argv[index + 1];
            if (!fileName && typeof fileName != "undefined" && fileName !=0) {
                fileName = "";
                throw "fileName no definition.";
            }
            args["fileName"] = fileName.split(" ");
        }else if (element === "-v" ) {
            var rtmpHost = process.argv[index + 1];
            if (!rtmpHost && typeof rtmpHost != "undefined" && rtmpHost !=0) {
                throw "RTMP Host no definition.";
            }else {
                config.rtmpHostname = rtmpHost;
            }
        }else if (element === "-fo") {
            var assign = process.argv[index + 1];
            if (!assign && typeof assign != "undefined" && assign !=0) {
                config.forkOptions = require('fxNetSocket').getConfig(assign);
            }
        } else if (element === "-m") {
            args["mgmtPort"] = parseInt(process.argv[index + 1]);
        } else if (element === "--gc") {
            config.gc = true;
        }

            });

    return args;
}



/* ************************************************************************
 SINGLETON CLASS DEFINITION
 ************************************************************************ */
function configure() {
    this.config = config;
}
configure.instance = null;

/**
 * Singleton getInstance definition
 * @return singleton class
 */
configure.getInstance = function () {
    if(this.instance === null) {
        this.instance = new configure();
    }
    return this.instance.config;
};

/**
 *
 * @type {config}
 */
module.exports = exports = configure.getInstance();
/**
 * @namespace config
 * @property srvOptions
 * @property forkOptions
 * @property appConfig
 * @property numCPUs
 * @property bFMSHost
 * @property bExceptions
 * @property bFMSPort
 * @property gamSLB
 * @property env
 * @property balance
 **/
/**
 * @namespace srvOptions
 * @property host
 * @property port
 * @property closeWaitTime
 * @property backlog
 **/
/**
 * @namespace gamSLB
 * @property enabled
 * @property file
 * @property assign
 **/
