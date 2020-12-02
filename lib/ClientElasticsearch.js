const http           = require("http");
const util          = require("util");
const EventEmitter  = require("events");

/**
 * @typedef ElasticOptions
 * @type {Object}
 * @property {Number} port
 * @property {String} host
 * @property {String} index
 * @property {Number} batchTime 批次更新時間
 */

/**
 *
 * @param {ElasticOptions} opt
 * @constructor
 */
function ClientElasticsearch(opt) {
    EventEmitter.call(this);
    this.index = opt.index;
    this.options = {
        host: "103.241.237.131",
        port: 9200,
        path:"",
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        }
    };
    this.clock = undefined;
    this.batchTime = opt.batchTime || 1000;
    this.sendQueue = [];
    this.runStart();
}
util.inherits(ClientElasticsearch, EventEmitter);
/**
 *
 * @param {Object} [settings] index settings
 * @param {String} settings.index 資料表名稱
 * @param {String} settings.shards default:1
 * @param {String} settings.replicas default:1
 * @param {Function} [callback] 回應
 * @param {Boolean} callback.res 結果回傳
 */
ClientElasticsearch.prototype.createIndex = function (settings, callback) {
    if (typeof settings != "object") return false;
    let index = settings.index || "";
    let rep = index.replace(/\w/g, "");
    if (rep != "") return false;
    if (index[0] == "_" || index[0] == "-" || index[0] == "+") return false;
    let options = this.createOptions();
    options.path = util.format("/%s?pretty", index);
    options.method = "PUT";

    const shards = settings.shards || 1;
    const replicas = settings.replicas || 1;
    let message = {
        settings: {
            index: {
                number_of_shards: shards,
                number_of_replicas: replicas
            }
        }
    };
    const content = JSON.stringify(message);
    ClientElasticsearch.URLRequest(options, content, function (res) {
        console.log(res);
        if (res.error) {
            if (callback) callback(false);
        } else {
            if (callback) callback((res.acknowledged == true));
        }
    });

    return true;
};
ClientElasticsearch.prototype.deleteIndex = function (index, callback) {
    let options = this.createOptions();
    options.path = util.format("/%s?pretty", index);
    options.method = "DELETE";
    ClientElasticsearch.URLRequest(options, function (res) {
        console.log(res);
        if (res.error) {
            if (callback) callback(false);
        } else {
            if (callback) callback((res.acknowledged == true));
        }
    });
    return true;
};
/**
 *
 * @param index
 * @param {function} callback
 * @param {boolean} callback.exists
 * @return {boolean}
 */
ClientElasticsearch.prototype.existsIndex = function (index, callback) {
    let options = this.createOptions();
    options.path = util.format("/%s?pretty", index);
    options.method = "HEAD";
    const req = http.request(options, function (response) {
        if (callback) {
            callback(response.statusCode == 200);
        }
    });
    req.end();
    return true;
};
/**
 * 送出紀錄
 * @param {Object} message 訊息
 * @param {String=} author 記錄者
 * @public
 * @return {Boolean}
 */
ClientElasticsearch.prototype.send = function (message, author) {
    if (typeof message != "object") {
        console.log(Error(util.format("Variable 'json' type '%s' wa not provided.", (typeof message))));
        return false;
    }
    message["@timestamp"] = new Date().toISOString();
    if (author) {
        message.user = {
            id: author
        }
    }
    const content = JSON.stringify(message);
    let options = this.createOptions("POST", util.format("/%s/_doc?routing=kimchy", this.index));

    ClientElasticsearch.URLRequest(options, content, function (result) {
        console.log(result);
    });
};
/**
 * 批次送出紀錄
 * @param {Object} message 訊息
 * @param {String=} author 記錄者
 * @public
 * @return {Boolean}
 */
ClientElasticsearch.prototype.bulk = function (message, author) {
    if (typeof message != "object") {
        console.log(Error(util.format("Variable 'json' type '%s' wa not provided.", (typeof message))));
        return false;
    }
    message["@timestamp"] = new Date().toISOString();
    if (author) {
        message.user = {
            id: author
        }
    }
    let create = {
        create: {
            _index: this.index
        }
    };
    this.sendQueue.push(JSON.stringify(create));
    this.sendQueue.push(JSON.stringify(message));
    return true;
};
/**
 * 啟動檢查批次發送
 * @public
 */
ClientElasticsearch.prototype.runStart = function () {
    if (typeof this.clock != "undefined") return;
    this.clock = setInterval(this.execBatch.bind(this), this.batchTime);
};
/**
 * 停止檢查批次發送
 * @public
 */
ClientElasticsearch.prototype.runStop = function () {
    setInterval(this.clock);
    this.clock = undefined;
};
/**
 * 執行批次訊息
 */
ClientElasticsearch.prototype.execBatch = function () {

    if (this.sendQueue.length == 0) return;

    const content = this.sendQueue.join("\n") + "\n";
    this.sendQueue = [];
    let options = this.createOptions();
    options.path = "/_bulk?pretty";
    options.method = "POST";
    ClientElasticsearch.URLRequest(options, content, function (res) {
        //console.log(JSON.stringify(res, null, '\t'));
    });
};
/**
 *
 * @param {("GET", "POST", "PUT", "HEAD", "DELETE")} method 模式
 * @param {String} path 路徑
 * @return {Object}
 */
ClientElasticsearch.prototype.createOptions = function (method, path) {
    let opt = JSON.parse(JSON.stringify(this.options));
    if (method) opt.method = method;
    if (path) opt.path = path;
    return opt;
};
/**
 * 實作接口
 * @param {ElasticOptions} options
 * @param {Function} callback
 */
ClientElasticsearch.createElastic = function (options, callback) {
    const index = options.index;

};
/**
 *
 * @param {Object} options
 * @param {String} options.host
 * @param {Number} options.port
 * @param {String} options.path
 * @param {String} options.method
 * @param {module:http.OutgoingHttpHeaders} options.headers
 * @param {String|function} arg1
 * @param {function=} arg2
 * @constructor
 */
ClientElasticsearch.URLRequest = function (options, arg1, arg2) {
    let content = undefined;
    let cb = undefined;
    if (typeof arg1 == "function") {
        cb = arg1;
    } else {
        content = arg1;
        cb = arg2;
    }
    const req = http.request(options, function (response) {
        var buf;
        response.on("data", function (chunk) {
            if (typeof buf == "undefined") {
                buf = Buffer.from(chunk);
            } else {
                buf = Buffer.concat([buf, chunk]);
            }
        });
        response.on("end", function () {
            try {
                const json = JSON.parse(buf.toString());
                if (cb) cb(json);
            } catch (e) {
                console.log("error", "#1Rd3NetworkKit.URLRequest:", e);
                console.log("error", "-------------------------------------------");
                console.log("error", "#2Rd3NetworkKit.URLRequest:", buf.toString());
                console.log("error", "-------------------------------------------");
                if (cb) cb({
                    event: false,
                    error: buf.toString()
                })
            }

        });

    });
    req.on("error", function (error) {
        console.log("error","Rd3NetworkKit.URLRequest /%s/", options.path, error);
        if (cb) cb(false);
    });
    if (typeof content == "undefined") {
        req.end();
    } else {
        req.end(content);
    }
};
module.exports = exports = ClientElasticsearch;