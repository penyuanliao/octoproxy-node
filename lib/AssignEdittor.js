/**
 * Created by Benson on 2016/12/21.
 */
const fs    = require('fs');
const lib   = require('fxNetSocket');

exports.editAssign = function (oAssign, obj, client) {
    var self = this;
    var path = self.AssignPath;

    try {
        if (typeof obj == "undefined" || typeof obj != "object") {
            throw new Error("object is not NULL.");
        }
        if (typeof obj["assign"] == "undefined" || typeof obj["assign"] != "string") {
            throw new Error("Cannot read property 'assign' of undefined");
        }
        if (typeof obj["file"] == "undefined" || typeof obj["file"] != "string" || typeof parseInt(obj["file"]) != "number") {
            throw new Error("Cannot read property 'file' of undefined");
        }
        if (typeof obj["mxoss"] == "undefined" || typeof parseInt(obj["mxoss"]) != "number") {
            obj["mxoss"] = 1024;

        }
        if (typeof parseInt(obj["mxoss"]) != "number") {
            obj["mxoss"] = 1024;
        }
        if (typeof obj.options == "undefined") {
            obj.options = {};
        }

        var data = fs.readFileSync(path);
        var conf = eval("("+data+")");

        for (var i = 0; i < conf["cluster"].length; i++) {

            if (conf["cluster"][i]["assign"] == oAssign) {
                conf["cluster"][i]["assign"] = obj["assign"];
                conf["cluster"][i]["mxoss"] = parseInt(obj["mxoss"]);
                conf["cluster"][i]["file"] = obj["file"];
                if (Array.isArray(obj.options.args) == true && obj.options.args.length > 0) {
                    conf["cluster"][i]["args"] = obj.options.args;
                } else if (typeof Array.isArray(conf["cluster"][i]["args"]) == "undefined") {
                    conf["cluster"][i]["args"] = [];
                }

                if (typeof obj.options.lookout == "boolean") {
                    conf["cluster"][i]["lookout"] = obj["options"]["lookout"];
                } else if (typeof conf["cluster"][i]["lookout"] != "boolean") {
                    conf["cluster"][i]["lookout"] = true;
                }

                if (typeof obj.options.ats == "boolean") {
                    conf["cluster"][i]["ats"] = obj["options"]["ats"];
                } else if (typeof conf["cluster"][i]["ats"] != "boolean") {
                    conf["cluster"][i]["ats"] = false;
                }

                console.log('writeFileSync+++++++++', conf["cluster"][i]);
                break;
            }
        }
        fs.writeFileSync(path, JSON.stringify(conf, null, "\t"));

        if (typeof client != "undefined")
            this._writeException(client,this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onEditAssign");
    }
    catch (e) {
        console.log('Configuration load file error:', e);
        if (typeof client != "undefined")
            this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT, "onEditAssign");
    }
};

exports.deleteAssign = function (name, client) {
    var self = this;
    var path = self.AssignPath;

    try {
        if (typeof name == "undefined" || typeof name != "string") {
            throw new Error("Cannot read 'name' of undefined.");
        }
        var data = fs.readFileSync(path);
        var conf = eval("("+data+")");

        for (var i = 0; i < conf.cluster.length; i++) {
            var obj = conf["cluster"][i];
            if (obj.assign == name) {
                if (Array.isArray(conf["cluster"])) {
                    conf["cluster"].splice(i, 1);
                } else {
                    delete conf["cluster"][i];
                }
                break;
            }
        }

        var json = JSON.stringify(conf);
        json = json.replace(/,null/g,"");//hand
        json = json.replace(/null,/g,"");//foot
        var saveData = JSON.parse(json);
        saveData = JSON.stringify(saveData, null, "\t");

        fs.writeFileSync(path, saveData);
        if (typeof client != "undefined")
            this._writeException(client,this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onDeleteAssign");
    }
    catch (e) {
        console.log('Configuation load file error:', e);
        if (typeof client != "undefined")
            this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT, "onDeleteAssign");
    }
};

exports.updateAssign = function (obj, client) {
    var self = this;
    var path = self.AssignPath;

    try {
        if (typeof obj == "undefined" || typeof obj != "object") {
            throw new Error("object is not NULL.");
        }
        if (typeof obj["assign"] == "undefined" || typeof obj["assign"] != "string") {
            throw new Error("Cannot read property 'assign' of undefined");
        }
        if (typeof obj["file"] == "undefined" || typeof obj["file"] != "string" || typeof parseInt(obj["file"]) != "number") {
            throw new Error("Cannot read property 'file' of undefined");
        }
        var data = fs.readFileSync(path);
        var conf = eval("("+data+")");
        conf["cluster"].push(obj);
        fs.writeFileSync(path, JSON.stringify(conf, null, "\t"));
        if (typeof client != "undefined")
            this._writeException(client,this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onAddAssign");
    }
    catch (e) {
        console.log('Configuation load file error:', e);
        if (typeof client != "undefined")
            this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT, "onAddAssign");
    }
};

exports.getAssign = function (client) {
    var self = this;
    var assign = lib.getConfig(self.AssignPath);

    if (typeof client != "undefined") {
        client.write(JSON.stringify({
            "event": "getAssign",
            "data" : assign
        }));
    }else {
        this.emit('local', JSON.stringify({
            "event": "getAssign",
            "data" : assign
        }));
        return assign;
    }

};
exports.saveAssign = function (conf) {
    const path = this.AssignPath;
    fs.writeFileSync(path, JSON.stringify(conf, null, "\t"));
};
exports.sortAssign = function (conf) {
    conf.cluster.sort(function (data, next) {
        // console.log("d->", data.assign , "N->", next.assign);
        if (data.assign > next.assign) {
        }
        if (data.assign.indexOf(next.assign.substr(0, next.assign.length - 1)) != -1 && data.assign.length > next.assign.length) {
            return 1;
        }

        return (data.assign > next.assign) ? 1 : -1;
    });
    return conf;
};
exports.setIPFilterAdd = function (obj, client) {
    var self = this;
    var path = self.IPFilterPath;

    try {
        if (typeof obj == "undefined" || typeof obj != "object") {
            throw new Error("object is not NULL.");
        }
        if (typeof obj["address"] == "undefined" || typeof obj["address"] != "string") {
            throw new Error("Cannot read property 'address' of undefined");
        }
        if (typeof obj["state"] == "undefined" || typeof obj["state"] != "boolean") {
            throw new Error("Cannot read property 'state' of undefined");
        }
        var data = fs.readFileSync(path);
        var conf = eval("("+data+")");

        if (typeof conf["deny"] == "undefined") conf["deny"] = {};
        if (typeof conf["deny"][obj["address"]] == "undefined") conf["deny"][obj["address"]] = {
            enabled:obj["state"],
            startTime:new Date().getTime(),
            endTime:obj["endTime"],
            count:obj["count"],
            log:obj["log"]
        };

        console.log('writeFileSync+++++++++', obj);
        fs.writeFileSync(path, JSON.stringify(conf, null, "\t"));

        if (typeof client != "undefined")
            this._writeException(client,this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onSetIPFilterAdd");
    }
    catch (e) {
        console.log('Configuration load file error:', e);
        if (typeof client != "undefined")
            this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT, "onSetIPFilterAdd");
    }
};
exports.setIPFilterDel = function (obj, client) {
    var self = this;
    var path = self.IPFilterPath;

    try {
        if (typeof obj == "undefined" || typeof obj != "object") {
            throw new Error("object is not NULL.");
        }
        if (typeof obj["address"] == "undefined" || typeof obj["address"] != "string") {
            throw new Error("Cannot read property 'address' of undefined");
        }
        if (typeof obj["state"] == "undefined" || typeof obj["state"] != "boolean") {
            throw new Error("Cannot read property 'state' of undefined");
        }
        var data = fs.readFileSync(path);
        var conf = eval("("+data+")");

        if (typeof conf["deny"] == "undefined") conf["deny"] = {};
        if (typeof conf["deny"][obj["address"]] != "undefined") {
            delete conf["deny"][obj["address"]];
        }

        console.log('writeFileSync+++++++++', obj);
        var json = JSON.stringify(conf);
        json = json.replace(/,null/g,"");//hand
        json = json.replace(/null,/g,"");//foot
        var saveData = JSON.parse(json);
        saveData = JSON.stringify(saveData, null, "\t");
        fs.writeFileSync(path, saveData);
        if (typeof client != "undefined")
            this._writeException(client,this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onSetIPFilterDel");
    }
    catch (e) {
        console.log('Configuration load file error:', e);
        if (typeof client != "undefined")
            this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT, "onSetIPFilterDel");
    }
};
exports.getIPFilter = function () {
    var ipFilter = lib.getConfig(this.IPFilterPath);

    return ipFilter;
};
