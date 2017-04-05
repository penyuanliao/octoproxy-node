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

        var data = fs.readFileSync(path);
        var conf = eval("("+data+")");

        for (var i = 0; i < conf["cluster"].length; i++) {

            if (conf["cluster"][i]["assign"] == oAssign) {
                conf["cluster"][i]["assign"] = obj["assign"];
                conf["cluster"][i]["mxoss"] = parseInt(obj["mxoss"]);
                conf["cluster"][i]["file"] = obj["file"];
                break;
            }
        }
        console.log('writeFileSync+++++++++', obj);
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
                delete conf["cluster"][i];
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
    }

};