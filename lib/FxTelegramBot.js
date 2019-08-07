const https = require("https");
const http  = require("http");
const tls   = require('tls');
const util  = require("util");
const path  = require("path");
const EventEmitter = require("events");
const CRLF = '\r\n';


util.inherits(FxTelegramBot, EventEmitter);

function FxTelegramBot(bot, token) {
    EventEmitter.call(this);
    this.bot       = bot;
    this.token     = token;
    this.host      = "api.telegram.org";
    this.uri       = "/" + bot + ":" + token + "/sendMessage";
    this.proxyMode = false;
    this.msgID     = 0;
    this.update_id = -1;
    this.pending   = false;
    this.option    = {
        host: this.host,
        path: this.uri,
        method: "POST",
        headers:{
            "Content-Type": "application/json"
        }
    };
    var props = {
        lastUpdateID: {
            get: function () {return this.update_id;}, configurable: false, enumerable: false
        }
    };
    Object.defineProperties(this, props);

}
FxTelegramBot.prototype.setBot = function (bot, token) {
    this.bot = bot;
    this.token = token;
    this.uri = "/" + bot + ":" + token + "/sendMessage";
};
FxTelegramBot.prototype.setProxy = function (host, port) {

    this.proxyOptions = {
        host: host,
        port: port | 3128,
        method: "CONNECT",
        path: util.format("%s:443", this.host),
    }
    this.proxyMode = true;
};
FxTelegramBot.prototype.proxyAgent = function (cb) {
    // HTTP proxy to connect
    var connReq = http.request(this.proxyOptions).on("connect", function (res, socket, head) {
        console.log('proxy mode Connect');
        if (cb) cb(res, socket, head);
    }).end();
}
FxTelegramBot.prototype.sendMessage = function (chat_id, text) {
    var self = this;
    var content = JSON.stringify({
        chat_id: chat_id,
        text: text,
        parse_mode: "html"
    });

    if (this.proxyMode) {

        this.proxyAgent(function (res, socket, head) {
            var cts = tls.connect({
                host: self.host,
                socket: socket
            }, function () {
                var resHeaders = [
                    "POST https://" + self.host + "/" + self.bot + ":" + self.token + "/sendMessage HTTP/1.1",
                    "Host: " + self.host,
                    "Content-type: application/json",
                    "Connection: keep-alive",
                    "Content-Length: " + Buffer.byteLength(content)
                ]
                var header = resHeaders.join(CRLF) + CRLF + CRLF;
                header += content;
                cts.write(header);
            });
            var buf;
            cts.on("data", function (chunk) {
                if (typeof buf == "undefined") buf = Buffer.from(chunk);
                else buf = Buffer.concat([buf, chunk]);
                var offset = buf.indexOf((CRLF + CRLF));
                var respose_data;
                if (offset != -1) {
                    respose_data = buf.slice(offset, buf.length);
                }
                var json;
                try {
                    json = JSON.parse(respose_data.toString());
                    buf = undefined;
                    console.log("sendMessage:", json);
                } catch (e) {
                    console.log(e);
                }
            });
        })

        return;
    };
    // NO PROXY MODE //
    var req = https.request(this.option, function (response) {

        if (response.statusCode != 200) {
            console.log('https.request error status:', response.statusCode);
            return;
        }

        var buf;

        response.on("data", function (chunk) {

            if (typeof buf == "undefined") buf = Buffer.from(chunk);
            else buf = Buffer.concat([buf, chunk]);

        });
        response.on("end", function () {
            var data = buf.toString();
            var json = JSON.parse(data);
            self.handle(json);

        })
    });
    req.end(content);
};
FxTelegramBot.prototype.getUpdates = function (offset) {
    if (this.pending) return;
    var self = this;
    var option = Object.assign({}, this.option);
    if (this.proxyMode) {

        this.proxyAgent(function (es, socket, head) {
            var content = (offset == -1) ? "" : JSON.stringify({offset: offset+1})
            var cts = tls.connect({
                host: self.host,
                socket: socket
            }, function () {
                var resHeaders = [
                    "POST https://" + self.host + "/" + self.bot + ":" + self.token + "/getUpdates HTTP/1.1",
                    "Host: " + self.host,
                    "Connection: close"
                ]
                var header = resHeaders.join(CRLF) + CRLF + CRLF;
                header += content;
                cts.write(header);
            });
            var buf;
            cts.on("data", function (chunk) {
                if (typeof buf == "undefined") buf = Buffer.from(chunk);
                else buf = Buffer.concat([buf, chunk]);
                var offset = buf.indexOf((CRLF + CRLF));
                var respose_data;
                if (offset != -1) {
                    respose_data = buf.slice(offset, buf.length);
                }
                var json;
                try {
                    json = JSON.parse(respose_data.toString());
                    self.pending = false;
                    self.cmdHandle(json);
                    buf = undefined;
                } catch (e) {
                    self.pending = false;
                    console.log(e);
                }
            });
        });
        this.pending = true;
        return;
    } else {
        option.path = "/" + this.bot + ":" + this.token + "/getUpdates";
    }
    var req = https.request(option, function (response) {

        var buf;

        response.on("data", function (chunk) {

            if (typeof buf == "undefined") buf = Buffer.from(chunk);
            else buf = Buffer.concat([buf, chunk]);

        });
        response.on("end", function () {
            var data = buf.toString();
            var json = JSON.parse(data);
            self.pending = false;
            self.cmdHandle(json);

        })
    });
    this.pending = true;
    if (offset == -1) {
        req.end();
    } else {
        req.end(JSON.stringify({offset: offset+1}));
    }
};
/*
{ ok: true,
  result:
   { message_id: 25,
     from:
      { id: 668966589,
        is_bot: true,
        first_name: 'rd3_fx_ann',
        username: 'fxAnnBot' },
     chat:
      { id: -395433649,
        title: 'FX防護群組',
        type: 'group',
        all_members_are_administrators: true },
     date: 1548143181,
     text: 'node test' } }
 */
/**
 *
 * @param {object} [json]
 * @param {boolean} [json.ok]
 * @param {object} [json.result]
 * @param {number} [json.result.message_id]
 * @param {object} [json.result.from]
 * @param {number} [json.result.from.id]
 * @param {boolean} [json.result.from.is_bot]
 * @param {string} [json.result.from.first_name]
 * @param {string} [json.result.from.username]
 * @param {object} [json.result.chat]
 * @param {number} [json.result.chat.id]
 * @param {string} [json.result.chat.title]
 * @param {string} [json.result.chat.type]
 * @param {boolean} [json.result.chat.all_members_are_administrators]
 * @param {string} [json.result.date]
 * @param {string} [json.result.text]
 *
 */
FxTelegramBot.prototype.handle = function (json) {
    console.log("handle:",json);
    if (!json.ok) return;

    var result = json.result;


};
/**
 * 分析留言
 * @param json
 */
FxTelegramBot.prototype.cmdHandle = function (json) {
    if (!json.ok) return;
    var item;
    var text;
    var uid;
    for (var i = 0; i < json.result.length; i++) {
        item = new CmdMessage(json.result[i].message);
        uid = item.from.id;
        text = item.text;

        if (this.update_id < json.result[i].update_id) {
            console.log("cmdHandle:", this.update_id, uid, text);
            this.update_id = json.result[i].update_id;
            this.emit("message", item);
        }

    }
};
function CmdMessage(src) {
    this.message_id = src.message_id;
    this.from     = new CmdFrom(src.from);
    this.chat     = new CmdChat(src.chat);
    this.date     = src.date;
    this.text     = src.text;
    this.entities = src.entities;//entities[Array](offset, length, type)
};
function CmdChat(src) {
    this.id       = src.id;
    this.title    = src.title;
    this.type     = src.type;
    this.all_members_are_administrators = src.all_members_are_administrators;
};
CmdChat.TYPE_PRIVATE = 'private';

function CmdFrom(src) {
    this.id = src.id;
    this.is_bot = src.is_bot;
    this.first_name = src.first_name;
    this.language_code = src.language_code;
};
function Entities(src) {
    console.log(src);
};
FxTelegramBot.dateFormat = function (date) {
    return "%H:%M:%S".replace(/%[YmdHMSa]/g, function (substring) {
        switch (substring) {
            case '%Y': return date['getFullYear'] (); // no leading zeros required
            case '%m': substring = 1 + date['getMonth'] (); break;
            case '%d': substring = date['getDate'] (); break;
            case '%H': substring = date['getHours'] (); break;
            case '%M': substring = date['getMinutes'] (); break;
            case '%S': substring = date['getSeconds'] (); break;
            case '%a': substring = (date.getHours() <= 12) ? "AM" : "PM"; break;
            default: return substring.slice (1); // unknown code, remove %
        }
        // add leading zero if required
        return ('0' + substring).slice (-2);
    })
};

/* ************************************************************************
                    SINGLETON CLASS DEFINITION
 ************************************************************************ */

FxTelegramBot.instance = null;

/**
 * Singleton getInstance definition
 * @return singleton class
 */
FxTelegramBot.getInstance = function () {
    if(this.instance === null) {
        this.instance = new FxTelegramBot();
    }
    return this.instance;
};

module.exports = exports = FxTelegramBot;