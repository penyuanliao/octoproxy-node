var component = (function ()
{
    var ProcessInfo = undefined;
    var AssignConfig = [{
        "name": "octoproxy.js",
        "online":false,
        "pid":0,
        "memoryUsage":0,
        "count":0
    },{
        "name": "Hall,HallPic",
        "online":true,
        "pid":0,
        "memoryUsage":0,
        "count":10
    },{
        "name": "slotFX",
        "online":true,
        "pid":0,
        "memoryUsage":0,
        "count":9999
    }];

    function str2ab(str) {
        var buf = new ArrayBuffer(str.length); // 2 bytes for each char
        var bufView = new Uint8Array(buf);
        for (var i = 0, strLen = str.length; i < strLen; i++) {
            bufView[i] = str.charCodeAt(i);
        }
        return buf;
    }

    var connect = function (url ,protocol, connectcb) {
        var self = this;
        var wsURL, ws;
        this.version = "v1";
        this._listeners = {};

        if (url) { wsURL = url}
        if (url.indexOf(":80/") != -1 || url.indexOf(":8000/") != -1 || url.indexOf(":443/") != -1 || url.indexOf(":1935/") != -1) protocol = "admin";
        if (protocol[0].indexOf("aes") != -1) this.setupAes();
        if (wsURL.indexOf("443") != -1) {
            let host = url.substring(url.indexOf("ws://") + 5, url.indexOf(":443/")) || "";
            if (isNaN(Number(host.split(".")[0]))) {
                wsURL = wsURL.replace("ws", "wss");
            }
        }
        console.log(`port 443: ${wsURL.indexOf("443")}`, wsURL);
        this.ws = ws = new WebSocket(wsURL,protocol);
        ws.binaryType = "arraybuffer";
        ws.startTime = new Date();
        ws.bUrl = url;
        ws.onopen = onOpenHandle;
        ws.onclose = onCloseHandle;
        ws.onmessage = onFirstMessageHandle;
        function onCloseHandle(evt) {
            console.log('+ ws admin on disconnect +');
            $("#srvConnect").attr('class', 'btn btn-danger');
            $("#srvConnect").prop( "disabled", false );
        }
        function onOpenHandle(evt){
            console.log('+ ws admin on connected +');

        }
        function onFirstMessageHandle(evt) {
            var json = JSON.parse(evt.data);

            if (typeof json.NetStatusEvent != "undefined" || json.event == "ready") {
                console.log('json.accept', json.accept);

                if (typeof json.accept != "undefined") self.acceptKey = CryptoJS.enc.Utf8.parse(json.accept);
                connectcb();
                ws.onmessage = onMessageHandle;
                return;
            }
        }
        function onMessageHandle(evt) {

            var d;

            if (self.aes) {
                d = self.decrypt(evt.data);
            } else
            {
                d = evt.data;
            }

            try {
                var json = JSON.parse(d);
            } catch (e) {
                console.log(d.toString());
            }
            if (typeof json.NetStatusEvent != "undefined" || json.event === "ready") {
                self.acceptKey = json.accept;
                connectcb();
                return;
            }

            if (json.event == "liveLog") {
                self["complete"](json["event"],json);
            }else {
                self["complete"](json["event"],json["data"],json["action"]);
            }
        }

    };
    connect.prototype = {
        constructor: connect,
        addListener: function(type, listener){
            if (typeof this._listeners[type] == "undefined"){
                this._listeners[type] = [];
            }

            this._listeners[type].push(listener);
        },
        setupAes: function () {
            this.aes = true;
            this.acceptKey = undefined;
            this.ivKey = "b5a4c433c3cedd0c";
            this.iv = CryptoJS.enc.Utf8.parse(this.ivKey);   //十六位十六進制數作為密鑰偏移量;
        },
        decrypt: function (word) {

            var sp = word.split("$");
            word = sp[1];
            var iv = CryptoJS.enc.Utf8.parse(sp[0]);
            var key = this.acceptKey;
            var encryptedHexStr = CryptoJS.enc.Hex.parse(word);
            var srcs = CryptoJS.enc.Base64.stringify(encryptedHexStr);
            var decrypt = CryptoJS.AES.decrypt(srcs, key, { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
            var decryptedStr = decrypt.toString(CryptoJS.enc.Utf8);
            return decryptedStr.toString();
        },
        encrypt: function (word, iv) {
            if (typeof iv == "undefined") iv = this.iv;
            const key = this.acceptKey;
            const srcs = CryptoJS.enc.Utf8.parse(word);
            const encrypted = CryptoJS.AES.encrypt(srcs, key, { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
            return encrypted.ciphertext.toString().toUpperCase();
        },
        dispatchEvent: function(event, data){
            if (typeof event == "string"){
                event = { type: event };
            }
            if (!event.target){
                event.target = this;
            }

            if (!event.type){  //falsy
                throw new Error("Event object missing 'type' property.");
            }

            if (this._listeners[event.type] instanceof Array){
                var listeners = this._listeners[event.type];
                for (var i=0, len=listeners.length; i < len; i++){
                    listeners[i].call(this, event);
                }
            }
        },
        removeListener: function(type, listener){
            if (this._listeners[type] instanceof Array){
                var listeners = this._listeners[type];
                for (var i=0, len=listeners.length; i < len; i++){
                    if (listeners[i] === listener){
                        listeners.splice(i, 1);
                        break;
                    }
                }
            }
        },

        getAssign:function () {
            this.send(JSON.stringify({"event": "getAssign"}))
        },
        getClusterInfos:function () {
            this.send(JSON.stringify({"event": "getClusterInfos"}))
        },
        complete:function (event, data, action) {

            if (event == "getClusterInfos") {
                ProcessInfo = data;
            }else {
                AssignConfig = data;
            }
            this.dispatchEvent({type:"complete", event:event, data:data, action:action});
        },
        startCPUUsage: function (pid) {
            // console.log('startCPUUsage');
            this.send(str2ab(JSON.stringify({"event": "getCPUUsage","data":[pid]})))
        },
        stopCPUUsage: function (pid) {
            this.send(JSON.stringify({"event": "rmCPUUsage","data":[pid]}))
        },
        getSysInfo: function () {
            this.send(JSON.stringify({"event": "getSysInfo"}));
        },
        getAssignConfig: function () {
            return AssignConfig;
        },
        getProcInfo: function () {
            return ProcessInfo;
        },
        addCluster: function (file, assign, memory, option) {
            if (typeof memory == "undefined" || memory == null || memory == "") memory = 1024;
            if (typeof option != "undefined") {
                option.file = file;
                if (typeof option.args == "string") option.args = option.args.split(",");
                this.send(JSON.stringify({"event": "addCluster","data":[file, assign, memory, option]}));
            } else {
                this.send(JSON.stringify({"event": "addCluster","data":[file, assign, memory]}));
            }

        },
        editCluster: function (old_assign, new_assign) {
            this.send(JSON.stringify({"event": "editCluster","data":[old_assign, new_assign]}));
        },
        killCluster: function (assign) {
            //刪除
            this.send(JSON.stringify({"event": "killCluster","data":[assign]}));
        },
        killClusterToPID: function (pid) {
            //刪除
            this.send(JSON.stringify({"event": "killClusterToPID","data":[pid]}));
        },
        restartCluster: function (assign, pid) {
            this.send(JSON.stringify({"event": "restartCluster","data":[assign, pid]}));
        },
        restartMultiCluster: function (group) {
            this.send(JSON.stringify({"event": "restartMultiCluster","data":[group]}));
        },
        restartSys: function (assign) {
            this.send(JSON.stringify({"event": "octoRestart"}));
        },
        reloadMgmt: function (pid) {
            this.send(JSON.stringify({"event": "reloadMgmt","data":[pid]}));
        },
        kickout: function (pid, trash, params) {
            if (Array.isArray(params) == false) params = [params];
            this.send(JSON.stringify({"event": "kickoutToPID", "data": [pid, trash, params]}))
        },
        ipcMessage: function (pid, params) {
            if (Array.isArray(params) == false) params = [params];
            this.send(JSON.stringify({"event": "ipcMessage", "data": [pid, params]}))
        },
        getSchedule: function () {
            this.send(JSON.stringify({"event": "getSchedule"}));
        },
        addSchedule: function (params) {
            if (Array.isArray(params) == false) params = [params];
            this.send(JSON.stringify({"event": "addSchedule", "data": [params]}));
        },
        cancelSchedule: function (params) {
            if (Array.isArray(params) == false) params = [params];
            this.send(JSON.stringify({"event": "cancelSchedule", "data": [params]}));
        },
        addAssign:function (file, assign, memory, args, lookout, ats) {
            var opt = {};
            opt.lookout = lookout;
            opt.ats = ats;
            if (typeof args != "undefined" && (Array.isArray(args) || typeof args == "string")) {
                if (typeof args == "string") args = args.split(",");
                opt.args = args;
                this.send({"event": "addAssign","data":[file, assign, memory, opt]});
            } else {
                this.send({"event": "addAssign","data":[file, assign, memory, opt]});
            }
        },
        editAssign:function (oAssign,file, nAssign, memory, args, lookout, ats) {
            console.log('editAssign', arguments);
            var opt = {};
            opt.lookout = lookout;
            opt.ats = ats;
            if (typeof args != "undefined" && (Array.isArray(args) || typeof args == "string")) {
                if (typeof args == "string") args = args.split(",");
                opt.args = args;
                console.log('args', args);
                this.send({"event": "editAssign","data":[oAssign, file, nAssign, memory, opt]});
            } else {
                this.send({"event": "editAssign","data":[oAssign, file, nAssign, memory, opt]});

            }
        },
        deleteAssign:function (assign) {
            this.send({"event": "deleteAssign","data":[assign]});
        },
        // logger sys
        getLoggerList: function () {
            this.send(JSON.stringify({"event": "getLoggerList"}));
        },
        liveLog: function (namespace) {
            this.send(JSON.stringify({"event": "liveLog","data":[namespace]}));
        },
        leaveLog: function (namespace) {
            this.send(JSON.stringify({"event": "leaveLog","data":[namespace]}));
        },
        setUpdateTimes: function (times) {
            this.send(JSON.stringify({"event": "setUpdateTimes","data":[times]}));
        },
        refuseUser: function (assign, bool) {
            this.send({"event": "refuseUser","data":[assign, bool]})
        },
        refuseUser2PID: function (pid, bool) {
            this.send({"event": "refuseUser2PID","data":[pid, bool]})
        },
        lockConnection: function (bool) {
            this.send({"event": "setLockConnection","data":[bool]})
        },
        getLBGamePath: function () {
            this.send({"event": "getLBGamePath"});
        },
        setLBGamePath: function (o) {
            this.send({"event":"setLBGamePath","data": [o]});
        },
        getAMFConfig: function () {
            this.send({"event": "getAMFConfig"});
        },
        setAMFConfig: function (o) {
            this.send({"event":"setAMFConfig","data": [o]});
        },
        viewQuery: function (query_arr) {
            this.send({"event":"viewQuery","data": query_arr});
        },
        getLatteTable: function () {
            this.send({"event":"getLatteTable"});
        },
        restartLatte: function (o) {
            this.send({"event":"restartLatte", "data": o});
        },
        getLBGamePathOnRole: function () {
            this.send({"event": "getLBGamePathOnRole"});
        },
        setLBGamePathOnRole: function (o, i) {
            this.send({"event":"setLBGamePathOnRole","data": [o, i]});
        },
        getSysLog: function () {
            this.send({"event":"getSysLog", data:[]});
            this.send({"event":"getPods", data:[]});
        },
        hotReload: function (pid, params) {
            this.send({"event":"hotReload", data:[pid, params]});
        },
        setLogLevel: function (pid, level) {
            this.send({"event":"setLogLevel", data:[pid, level]});
        },
        setRecordEnabled: function (enabled) {
            this.send({"event":"setRecordEnabled", data:[enabled]});
        },
        getVideoConf: function (name) {
            this.send({"event":"getStreamConf", data:[name]});
        },
        getIPFilter: function () {
            this.send({"event":"getIPFilter"});
        },
        setIPFilter: function (ip, stat) {
            this.send({"event":"setIPFilter", data:[ip, stat]});
        },
        joinPod: function (key) {
            this.send({"event":"joinPod", data:[key]});
        },
        send:function (obj) {
            if (typeof obj != "string") obj = JSON.stringify(obj);

            if (this.aes) {
                obj = this.ivKey + "$" + this.encrypt(obj);
            }

            this.ws.send(obj);
        }


    };

    var logger = function (url, namesapce) {
        var wsURL;
        if (url) { wsURL = url}

        var ws = new WebSocket(wsURL);
        ws.startTime = new Date();
        ws.bUrl = url;
        ws.onopen = onOpenHandle;
        ws.onclose = onCloseHandle;
        ws.onmessage = onMessageHandle;

        function onCloseHandle(evt) {
            console.log('+ websocket on disconnect +');
            $('#content').append('<p>[' + ws.startTime.getHours()+ ':' + ws.startTime.getMinutes() + '] WebSocket on Disconnect.(' + ws.bUrl + ')</p>');
        }
        function onOpenHandle(evt){
            console.log('+ websocket on connected +');

            ws.send(JSON.stringify({"event": "liveLog", "data":[namesapce]}));

            $('#content').append('<p>[' + ws.startTime.getHours()+ ':' + ws.startTime.getMinutes() + '] WebSocket on Connected.(' + ws.bUrl + ')</p>');
        }
        function onMessageHandle(evt) {
            var json = JSON.parse(evt.data);
            if (typeof json["log"] == 'undefined') return;
            $('#content').append('' + json["log"] + '');
        }
    };

    var imenus = function imenus() {

        this.chatData = [];
        this.interactive_plot = this.chat();
    };
    imenus.prototype = {
        init: function () {

            $(".list-friends").empty();

            for (var i = 0; i < AssignConfig.length; i++) {
                var obj    = AssignConfig[i];
                var name  = obj["name"];
                var online = obj["online"] ? "on" : "off";
                var count  = obj["count"];
                $(".list-friends").append(getMenuItem(name, online, count));
            }
        },
        chat: function () {
            /*
             * Flot Interactive Chart
             * -----------------------
             */
            // We use an inline data source in the example, usually data would
            // be fetched from a server
            var self = this;
            var data = this.chatData, totalPoints = 100;
            function getRandomData() {

                if (data.length > 0)
                    data = data.slice(1);

                // Do a random walk
                while (data.length < totalPoints) {

                    var prev = data.length > 0 ? data[data.length - 1] : 50,
                        y = 0; //prev + Math.random() * 10 - 5;

                    if (y < 0) {
                        y = 0;
                    } else if (y > 100) {
                        y = 100;
                    }

                    data.push(y);
                }

                // Zip the generated y values with the x values
                var res = [];
                for (var i = 0; i < data.length; ++i) {
                    res.push([i, data[i]]);
                }

                return res;
            }
            this.chatData = getRandomData();
            var interactive_plot = $.plot("#interactive", [getRandomData()], {
                grid: {
                    borderColor: "#f3f3f3",
                    borderWidth: 1,
                    tickColor: "#f3f3f3"
                },
                series: {
                    shadowSize: 0, // Drawing is faster without shadows
                    color: "#3c8dbc"
                },
                lines: {
                    fill: true, //Converts the line chart to area chart
                    color: "#3c8dbc"
                },
                yaxis: {
                    min: 0,
                    max: 100,
                    show: true
                },
                xaxis: {
                    show: true
                }
            });

            var updateInterval = 500; //Fetch data ever x milliseconds
            var realtime = "on"; //If == to on then fetch data every x seconds. else stop fetching
            function update() {

                interactive_plot.setData([self.chatData]);

                // Since the axes don't change, we don't need to call plot.setupGrid()
                interactive_plot.draw();
                if (realtime === "on")
                    setTimeout(update, updateInterval);
            }

            //INITIALIZE REALTIME DATA FETCHING
            if (realtime === "on") {
                update();
            }
            //REALTIME TOGGLE
            $("#realtime .btn").click(function () {
                if ($(this).data("toggle") === "on") {
                    realtime = "on";
                }
                else {
                    realtime = "off";
                }
                update();
            });
            /*
             * END INTERACTIVE CHART
             */
            return interactive_plot;
        },
        setChatData: function (value) {
            var self = this;
            for (var i = self.chatData.length -1 ; i >=0; i--) {
                self.chatData[i][0] = i;
                if (i == 0) {
                    self.chatData[i][1] = value;
                }
                else{
                    self.chatData[i][1] = self.chatData[i-1][1];
                }
            }
        },
        setYaxis:function (max,min) {
            var opts = this.interactive_plot.getOptions();
            opts.yaxes[0].max = max;
            opts.yaxes[0].min = min;
            this.interactive_plot.setupGrid();
            this.interactive_plot.draw();

        }

    };
    function getMenuItem(name, online, count) {
        var item = "";
        item += '<li>';
        item += '<div class="info">';
        item += ('<div class="sname">' + name + '</div>');
        item += ('<div class="status ' + online + '"> online</div>');
        item += '</div>';
        item += ('<p class="conns">' + count + '</p>');
        item += '</li>';
        return item;
    };
    var AssignMenus = function () {
        var a = new imenus();
        a.init();
        return a;
    };

    // --------------------------------------


    var tools = function tools() {

    };
    tools.prototype.init = function (ramMax) {
        var self = this;
        if (!ramMax) ramMax = 1;

        this.ramMax = ramMax;

        $('.ram-chat').easyPieChart({
            animate: 1000,
            barColor: function (percent) {
                return (percent < 50 ? '#5cb85c' : percent < 85 ? '#fcc633' : '#cb3935');
            },
            onStep: function(value) {
                this.$el.find($("span")).text(parseInt(value*self.ramMax/100));
            }
        });
        $('.cpu-chat').easyPieChart({
            animate: 1000,
            barColor: function (percent) {
                return (percent < 50 ? '#5cb85c' : percent < 85 ? '#fcc633' : '#cb3935');
            },
            onStep: function (percent) {
                this.$el.find($("span")).text(~~percent);
            }
        });
        $('.hd-chat').easyPieChart({
            animate: 2000,
            barColor: function (percent) {
                return (percent < 50 ? '#5cb85c' : percent < 85 ? '#fcc633' : '#cb3935');
            },
            onStep: function (percent) {
                this.$el.find($("span")).text(~~percent);
            }
        });
    };

    tools.prototype.memoryUpdate = function (value) {

        $('.ram-chat').data('easyPieChart').update(100*value/this.ramMax);

    };
    tools.prototype.hddUpdate = function (value) {
        $('.hd-chat').data('easyPieChart').update(value);
    };
    tools.prototype.cpuUpdate = function (value) {
        $('.cpu-chat').data('easyPieChart').update(value);
    };

    var lbTable = function lbTable(clsName, tableName) {
        // console.log(clsName);
        this.clsName = clsName;
        this.data = [];
        this.tableName = tableName;
    };
    lbTable.prototype.clean = function () {
        $(this.clsName).empty();
    };
    lbTable.prototype.update = function (arr) {
        this._data = this.data;
        this.data = arr;
        this.refresh(arguments[1]);
    };
    lbTable.prototype.refresh = function () {

        // console.log('refresh', this.data.length, this.clsName, arguments[0] );
        console.log("refresh -- >", arguments[0]);
        $(this.clsName).empty();
        if (this.data.constructor != Array) {
            var keys, arr, j;
            if (arguments[0] == "addItem3") {
                keys = Object.keys(this.data);
                arr = [];
                for (j = 0; j < keys.length; j++) {
                    arr.push([keys[j],this.data[keys[j]]]);
                    this.addItem3([keys[j],this.data[keys[j]]],j);
                }
                this.data = arr;
            } else if (arguments[0] == "addItem3_2") {
                keys = Object.keys(this.data);
                arr = [];
                for (j = 0; j < keys.length; j++) {
                    arr.push([keys[j],this.data[keys[j]]]);
                    this.addItem3_2([keys[j],this.data[keys[j]]],j);
                }
                this.data = arr;
            } else if (arguments[0] == "addItem4") {
                keys = Object.keys(this.data);
                arr = [];
                for (j = 0; j < keys.length; j++) {
                    arr.push([keys[j],this.data[keys[j]]]);
                    this.addItem4([keys[j],this.data[keys[j]]],j);
                }
                this.data = arr;
            } else if (arguments[0] == "addSetting") {
                keys = Object.keys(this.data);
                this.dataKeys = keys;
                for (j = 0; j < keys.length; j++) {
                    var conf = this.data[keys[j]];
                    this.addItemBroker({
                        vPath:keys[j],
                        host:conf.host,
                        port:conf.port
                    }, j)
                }
            } else if (arguments[0] == "blocking") {
                keys = Object.keys(this.data);
                console.log(this.data);
                for (j = 0; j < keys.length; j++) {
                    var conf = this.data[keys[j]];
                    conf.address = keys[j];
                    this.addBlocking(conf, j)
                }
            }
            return;
        }

        for (var i = 0; i < this.data.length; i++) {
            var list = this.data[i];
            if (arguments[0] == "addItem2") {
                this.addItem2(list,i);
            }
            else if (arguments[0] == "addItemBroker") {
                this.addItemBroker(list, i)
            }
            else if (arguments[0] == "blocking") {
                this.addBlocking(list, i)
            } else {
                this.addItem(list,i);
            }

        }
    };
    lbTable.prototype.addItem = function (opt, id) {

        var td_success = '<td class="t-status><span class="label label-success">ON</span></td>';
        var td_unknown = '<td class="t-status"><span class="label label-danger">OFF</span></td>';
        var complete   = (opt["complete"] == true ? "on" : "off");
        var html = "";
        if (typeof opt["complete"] == "undefined") {
            html = '<tr id="tr' + id + '"><td id="'+ opt['pid'] +'" >'+ id +'</td>';
        } else {
            html = '<tr id="tr' + id + '"><td id="'+ opt['pid'] +'" ><div class="circle-' + complete + '"></div><div style="padding-left: 2px; float:left; margin-top: -2px;">'+ id +'</div></td>';
        }
        for (var i = 0; i < this.tableName.length; i++) {
            var item = "";

            if (typeof opt[this.tableName[i]] == 'boolean') {
                item = td_unknown;
            }else if (typeof opt[this.tableName[i]] == 'object' && this.tableName[i] == "memoryUsage") {
                var value = ( opt[this.tableName[i]]["rss"] / 1024 / 1024 ).toFixed(1);
                var style = "";
                if (value > 1000) {
                    value = (value/1024).toFixed(2) + " GB";
                    style = 'style="color:#EE7600;font-weight: bold;"'
                } else {
                    value += " MB";
                }
                item = '<td contenteditable="false" ' + style + '>' + value + '</td>';
            }else if ( (this.tableName[i] == 'edit'
                || this.tableName[i] == 'dead'
                    /*|| this.tableName[i] == 'reset'
                || this.tableName[i] == 'refuse'*/) && opt[this.tableName[0]] == "Main") {
                item = '<td><a class="btn btn-default btn-xs btn-edit" disabled><span class="glyphicon glyphicon-minus"></span></a></td>';

            } else if ( (this.tableName[i] == 'edit'
                || this.tableName[i] == 'dead'
                    /*|| this.tableName[i] == 'reset'*/
                     || this.tableName[i] == 'refuse') && opt[this.tableName[0]] == "loadBalance") {
                item = '<td><a class="btn btn-default btn-xs btn-edit" disabled><span class="glyphicon glyphicon-minus"></span></a></td>';

            } else if ( this.tableName[i] == 'edit' ) {
                    item = '<td><a class="btn btn-default btn-xs btn-edit"><span class="glyphicon glyphicon-edit color-royalblue">1</span></a></td>';

            }else if (this.tableName[i] == 'reset') {

                item = '<td><a class="btn btn-default btn-xs btn-reset"><span class="glyphicon glyphicon-repeat"></span></a></td>';

            } else if (this.tableName[i] == 'sign-out') {

                if (opt[this.tableName[0]] != "Main" && opt[this.tableName[0]] != "loadBalance") {
                    item = '<td><a class="btn btn-default btn-xs btn-kickout"><span class="glyphicon glyphicon-log-out"></span></a></td>';
                } else {
                    item = '<td><a class="btn btn-default btn-xs btn-edit" disabled><span class="glyphicon glyphicon-minus"></span></a></td>';
                }

            } else if (this.tableName[i] == 'dead') {

                item = '<td><a class="btn btn-default btn-xs btn-dead"><span class="glyphicon glyphicon-ban-circle color-firebrick"></span></a></td>';

            }else if (this.tableName[i] == 'refuse') {

                if (opt['lock'] == true) {
                    item = '<td><div class="switch"><input id="cmn-toggle-'+id+'" class="cmn-toggle cmn-toggle-round-flat lock-checkbox" type="checkbox" checked><label for="cmn-toggle-'+id+'"></label></div></td>';
                } else {
                    item = '<td><div class="switch"><input id="cmn-toggle-'+id+'" class="cmn-toggle cmn-toggle-round-flat lock-checkbox" type="checkbox"><label for="cmn-toggle-'+id+'"></label></div></td>';
                }

            }else if (this.tableName[i] == 'cpu') {
                var _cpu = Number(opt["cpuUsage"]);
                var icon;
                var color;
                if (typeof this._data != "undefined" && typeof this._data[id] != "undefined") {
                    if (((Number(this._data[id]["cpuUsage"]) + 3) > _cpu) && ((Number(this._data[id]["cpuUsage"]) - 3) < _cpu)) {
                        icon = "fa-sort";
                        color = "";
                    }
                    else if ((Number(this._data[id]["cpuUsage"]) < _cpu)) {
                        icon = "fa-chevron-up";
                        color = "color: #ff616e;";

                    } else {
                        icon = "fa-chevron-down";
                        color = "color: #25B150;";
                    }
                }
                item = '<td contenteditable="false"><div style="display:inline-flex; width: 50px;"><div class="fa ' + icon + '" style="' + color + 'height: 20px; width: 20px; margin-top: 6px; margin-right: 4px; font: arial;" aria-hidden="true"></div><strong style="margin-top: 6px;">' + _cpu.toFixed(2) + '%</strong></div></td>';

            }else if (this.tableName[i] == 'mxoss') {
                var _mxoss = opt[this.tableName[i]] || 2048;
                item = '<td contenteditable="false">' + _mxoss + '</span></td>';

            }else if (!isNaN(parseInt(opt[this.tableName[i]])) && this.tableName[i] != "assign") {

                var _value = opt[this.tableName[i]] || 0;
                item = '<td contenteditable="false"><span class="badge" style="background-color: #67b168">' + _value + '</span></td>';
            }//<div id="interactive2" style="position:relative;z-index: 1;height: 10px; width:100%; float: left; background-color: #00a7d0"></div>
            else if (this.tableName[i] == 'xxxx') {
                item = '<td contenteditable="false"><div style="position: relative;width: 400px;"><div id="test2" style="position:absolute;z-index: 1;"></div><div style="position:absolute; z-index: 20;word-break: break-all;">' + opt[this.tableName[i]] + '</div></div></td>';
            } else if (this.tableName[i] == 'file' && typeof this._data[id] != "undefined" && typeof this._data[id]["uptime"] != "undefined") {
                var d = new Date();
                d.setTime(this._data[id]["uptime"]);
                /**/
                var time = Math.floor((new Date().getTime() - this._data[id]["uptime"]) / 1000);
                var day  = "";
                var hour = "";
                var min  = "";
                var sec  = "";
                var f = "";
                if (time >= 86400) {
                    day = Math.floor(time / 86400);
                    time = time - day * 86400;
                    f = day + " day.";
                }
                else if (time >= 3600) {
                    hour = Math.floor(time / 3600);
                    time = time - hour * 3600;
                    f = hour + " hour.";
                }
                else if (time >= 60) {
                    min = Math.floor(time / 60);
                    time = time - min * 60;
                    f = min + " min.";
                }
                sec = time;

                if (f == "") f = sec + " sec";
                //  1DA1F2
                item = '<td contenteditable="false" data="'+ opt[this.tableName[i]] +'">' + opt[this.tableName[i]] + ' <br><small style="color: #525252;"><span class="glyphicon glyphicon-time"></span> ' + f + '</small></td>';
            } else {
                console.log(opt[this.tableName[i]], this.tableName[i]);
                item = '<td contenteditable="false"><a style="word-wrap:break-word;">' + opt[this.tableName[i]].split(",").join(",") + '</a></td>';
            }
            html += item;
        }
        html += '</tr>';

        $(this.clsName).append(html);
        // $(this.clsName).append('<tr class="tr-btn"><td><a class="btn btn-default addbtn">add</a></td><td></td><td colspan="3"></td></tr>');
    };
    lbTable.prototype.addItem2 = function (opt, id) {

        var td_success = '<td class="t-status><span class="label label-success">ON</span></td>';
        var td_unknown = '<td class="t-status"><span class="label label-danger">OFF</span></td>';

        var html = '<tr id="tr' + id + '"><td>'+ id +'</td>';
        for (var i = 0; i < this.tableName.length; i++) {
            var item = "";
            if (typeof opt[this.tableName[i]] == 'boolean') {
                item = td_unknown;
            }else if (typeof opt[this.tableName[i]] == 'object' && this.tableName[i] == "memoryUsage") {
                var value = ( opt[this.tableName[i]]["rss"] / 1024 / 1024 ).toFixed(2);
                item = '<td contenteditable="false">' + value + ' MB</td>';
            }else {
                item = '<td contenteditable="false">' + opt[this.tableName[i]] + '</td>';
            }
            html += item;
        }
        html += '</tr>';

        $(this.clsName).append(html);
    };
    lbTable.prototype.addItem4 = function (opt, id) {
        var html = '<tr id="tr' + id + '"><td>'+ id +'</td>';
        for (var i = 0; i < this.tableName.length; i++) {
            var item = "";
            item = '<td>' + opt[i].toString() + '</td>';
            html += item;
        }
        html += '</tr>';

        $(this.clsName).append(html);
    };
    lbTable.prototype.addItem3 = function (opt, id) {
        var html = '<tr id="tr' + id + '"><td>'+ id +'</td>';
        for (var i = 0; i < this.tableName.length; i++) {
            var item = "";
            if (i == 0) {
                item = '<td><a class="gamelb_path" data-type="text" data-placement="right" data-title="Enter name" data-pk="'+id+'">' + opt[i].toString() + '</a></td>';
            }else {
                item = '<td><a href="#" class="gamelb_rule" style="word-break: break-all;" data-type="textarea" data-placement="right" data-title="Enter assign" data-pk="'+id+'">' + opt[i].toString() + '</a></td>';
            }
            html += item;
        }
        html += '</tr>';

        $(this.clsName).append(html);
    };
    lbTable.prototype.addItem3_2 = function (opt, id) {
        var html = '<tr id="tr' + id + '"><td>'+ id +'</td>';
        for (var i = 0; i < this.tableName.length; i++) {
            var item = "";
            if (i == 0) {
                item = '<td><a class="gamelb_path" data-type="text" data-placement="right" data-title="Enter name" data-pk="'+id+'">' + opt[i].toString() + '</a></td>';
            }else {
                item = '<td><a href="#" class="gamelb_rule" data-type="' + ((opt[i].toString()).length > 30 ? 'textarea' : 'text') + '" data-placement="right" data-title="Enter assign" data-pk="'+id+'">' + (Array.isArray(opt[i]) ? opt[i].join(',\r'):opt[i].toString()) + '</a></td>';
            }
            html += item;
        }
        html += '</tr>';

        $(this.clsName).append(html);
    };
    lbTable.prototype.insertTable = function () {

        var keys = Object.keys(this.data);
        var id = keys.length;
        this.data[id.toString()] = [];
        var html = '<tr id="tr' + id + '"><td>'+ id +'</td>';
        for (var i = 0; i < this.tableName.length; i++) {
            var item = "";
            if (i == 0) {
                item = '<td><a class="gamelb_path" data-type="text" data-placement="right" data-title="Enter path" emptytext="Empty" data-pk="'+id+'"></a></td>';
            }else {
                item = '<td><a href="#" class="gamelb_rule" data-type="text" data-placement="right" data-title="Enter rule" emptytext="Empty" data-pk="'+id+'"></a></td>';
            }
            html += item;
        }
        html += '</tr>';

        $(this.clsName).append(html);
    };
    lbTable.prototype.addItemBroker = function (opt, id) {
        var html = '<tr id="tr' + id + '"><td>'+ id +'</td>';
        for (var i = 0; i < this.tableName.length; i++) {
            var item = "";
            var name = this.tableName[i];
            if (name == "vPath") {
                item = '<td><a class="media_path" data-type="text" data-placement="right" data-title="Enter name" emptytext="Empty" data-pk="'+id+'">' + opt["vPath"].toString() + '</a></td>';
            } else if (name == "balance") {
                item = '<td><a href="#" class="media_balance" data-type="text" data-placement="right" data-title="Enter Balance" emptytext="Empty" data-pk="'+id+'">' + opt["balance"].toString() + '</a></td>';
            } else if (name == "host") {
                item = '<td><a href="#" class="media_host" data-type="text" data-placement="right" data-title="Enter host" emptytext="Empty" data-pk="'+id+'">' + (typeof opt["host"] != "undefined" ? opt["host"] : "") + '</a></td>';
            } else if (name == "port") {
                item = '<td><a href="#" class="media_port" data-type="text" data-placement="right" data-title="Enter port" emptytext="Empty" data-pk="'+id+'">' + (typeof opt["port"] != "undefined" ? opt["port"] : "") + '</a></td>';
            } else if (name == "server") {
                item = '<td>' + opt["vPath"] + '</td>';
            }
            html += item;
        }
        html += '</tr>';

        $(this.clsName).append(html);
    };
    lbTable.prototype.insertItemBroker = function () {
        var assign = this.assign;
        // this.data[assign].push({});
        var id = this.data.length;
        var html = '<tr id="tr' + id + '"><td>'+ id +'</td>';
        for (var i = 0; i < this.tableName.length; i++) {
            var item = "";
            if (i == 0) {
                item = '<td><a class="media_path" data-type="text" data-placement="right" data-title="Enter name" emptytext="Empty" data-pk="'+id+'"></a></td>';
            } else if (i == 1) {
                item = '<td><a href="#" class="media_balance" data-type="text" data-placement="right" data-title="Enter Balance" emptytext="Empty" data-pk="'+id+'"></a></td>';
            } else if (i == 2) {
                item = '<td><a href="#" class="media_host" data-type="text" data-placement="right" data-title="Enter host" emptytext="Empty" data-pk="'+id+'"></a></td>';
            } else {
                item = '<td><a href="#" class="media_port" data-type="text" data-placement="right" data-title="Enter port" emptytext="Empty" data-pk="'+id+'"></a></td>';
            }
            html += item;
        }
        html += '</tr>';

        $(this.clsName).append(html);
    };
    lbTable.prototype.addBlocking = function (opt, id) {
        var html = '<tr id="tr' + id + '"><td>'+ id +'</td>';
        var isArr = Array.isArray(opt);
        var isStr = typeof opt == "string";
        for (var i = 0; i < this.tableName.length; i++) {
            var item = "";
            if (isArr) {
                item = '<td><a class="blocking_address" data-type="text" data-placement="right" data-title="Enter name" data-pk="'+id+'">' + opt[i].toString() + '</a></td>';
            } else if (isStr && this.tableName[i] == "ip") {
                item = '<td><a class="blocking_address" data-type="text" data-placement="right" data-title="Enter name" data-pk="'+id+'">' + opt.toString() + '</a></td>';
            } else if (this.tableName[i] == "dead") {
                item = '<td><a class="btn btn-default btn-xs btn-edit" onclick="delIPDenyClicked('+id+')"><span class="glyphicon glyphicon-trash"></span></a></td>';
            }
            else if (i == 0) {
                item = '<td><a class="blocking_address" data-type="text" data-placement="right" data-title="Enter name" data-pk="'+id+'">' + opt["address"].toString() + '</a></td>';
            }else {
                item = '<td><a href="#" class="blocking_state" data-type="text" data-placement="right" data-title="Enter assign" data-pk="'+id+'">' + opt["enabled"].toString() + '</a></td>';
            }
            html += item;
        }
        html += '</tr>';

        $(this.clsName).append(html);
    };
    lbTable.prototype.addItemBlocking = function () {
        var keys = Object.keys(this.data);
        var id = keys.length;
        var html = '<tr id="tr' + id + '"><td>'+ id +'</td>';
        for (var i = 0; i < this.tableName.length; i++) {
            var item = "";
            if (i == 0) {
                item = '<td><a class="blocking_address" data-type="text" data-placement="right" data-title="Enter path" emptytext="Empty" data-pk="'+id+'"></a></td>';
            }else {
                item = '<td><a class="blocking_state" data-type="text" data-placement="right" data-title="Enter rule" emptytext="Empty" data-pk="'+id+'">true</a></td>';
            }
            html += item;
        }
        html += '</tr>';

        $(this.clsName).append(html);
    };
    var chartJS = function chartJS(canvasID) {
        var mychartjs = document.getElementById(canvasID).getContext('2d');
        this.ChartOptions = {
            //Boolean - If we should show the scale at all
            showScale: true,
            //Boolean - Whether grid lines are shown across the chart
            scaleShowGridLines: false,
            //String - Colour of the grid lines
            scaleGridLineColor: "rgba(0,0,0,.05)",
            //Number - Width of the grid lines
            scaleGridLineWidth: 1,
            //Boolean - Whether to show horizontal lines (except X axis)
            scaleShowHorizontalLines: true,
            //Boolean - Whether to show vertical lines (except Y axis)
            scaleShowVerticalLines: true,
            //Boolean - Whether the line is curved between points
            bezierCurve: true,
            //Number - Tension of the bezier curve between points
            bezierCurveTension: 0.3,
            //Boolean - Whether to show a dot for each point
            pointDot: true,
            //Number - Radius of each point dot in pixels
            pointDotRadius: 4,
            //Number - Pixel width of point dot stroke
            pointDotStrokeWidth: 1,
            //Number - amount extra to add to the radius to cater for hit detection outside the drawn point
            pointHitDetectionRadius: 20,
            //Boolean - Whether to show a stroke for datasets
            datasetStroke: true,
            //Number - Pixel width of dataset stroke
            datasetStrokeWidth: 2,
            //Boolean - Whether to fill the dataset with a color
            datasetFill: true,
            //String - A legend template
            legendTemplate: "<ul class=\"<%=name.toLowerCase()%>-legend\"><% for (var i=0; i<datasets.length; i++){%><li><span style=\"background-color:<%=datasets[i].lineColor%>\"></span><%if(datasets[i].label){%><%=datasets[i].label%><%}%></li><%}%></ul>",
            //Boolean - whether to maintain the starting aspect ratio or not when responsive, if set to false, will take up entire container
            maintainAspectRatio: true,
            //Boolean - whether to make the chart responsive to window resizing
            responsive: true
        };
        var myLineChart = new Chart(mychartjs);


        this.ChartOptions.datasetFill = false;

        this.lineChart = myLineChart;

    };
    chartJS.prototype.setData = function () {
        var buyerData = {
            labels : ["January","February","March","April","May","June"],
            datasets : [
                {
                    label: "client",
                    fillColor: "rgba(210, 214, 222, 1)",
                    strokeColor: "rgba(210, 214, 222, 1)",
                    pointColor: "rgba(210, 214, 222, 1)",
                    pointStrokeColor: "#c1c7d1",
                    pointHighlightFill: "#fff",
                    pointHighlightStroke: "rgba(220,220,220,1)",
                    data: [300, 600, 80, 81, 56, 55, 40]
                },{
                    label: "client",
                    fillColor: "rgba(60,141,188,0.9)",
                    strokeColor: "rgba(60,141,188,0.8)",
                    pointColor: "#3b8bba",
                    pointStrokeColor: "rgba(60,141,188,1)",
                    pointHighlightFill: "#fff",
                    pointHighlightStroke: "rgba(60,141,188,1)",
                    data: [22, 33, 44, 55, 666, 22, 33]
                }
            ]
        }
        this.lineChart.Line(buyerData, this.ChartOptions);
    };

    var alert = function (div) {
        this.div = div;
    };
    alert.prototype.showAlert = function (title) {
        var contxt;

        console.log("success:",title == "success", $("#success-alert").length);

        if (title == "success") {
            contxt = $("#success-alert");
            if (!contxt.length) {
                this.addSuccess();
                contxt = $("#success-alert");
            }
        }else if(title == "warning") {
            contxt = $("#warning-alert");
            if (!contxt.length) {
                this.addWarning();
                contxt = $("#warning-alert");
            }
        }else {
            contxt = $("#error-alert");
            if (!contxt.length) {
                this.addError();
                contxt = $("#error-alert");
            }
        }

        contxt.fadeTo(2000, 500).slideUp(500, function(){
            contxt.slideUp(500);
        });
    };
    alert.prototype.addSuccess = function () {
        var html = '<div class="alert success alert-success fade" data-alert="alert" id="success-alert">' +
            '<a href="#" class="close" data-dismiss="alert">&times;</a>' +
            '<strong>Success!</strong> ' + "新增成功。" +
            '</div>';
        this.div.append(html);
    };
    alert.prototype.addWarning = function () {
        var html = '<div class="alert warning alert-warning fade" data-alert="alert" id="warning-alert">' +
            '<a href="#" class="close" data-dismiss="alert">&times;</a>' +
            '<strong>Warning!</strong> ' + "媽呀確定輸入正確？" +
            '</div>';
        this.div.append(html);
    };
    alert.prototype.addError = function () {
        var html = '<div class="alert error alert-danger fade" data-alert="alert" id="error-alert">' +
            '<a href="#" class="close" data-dismiss="alert">&times;</a>' +
            '<strong>Error!</strong> ' + "嘗試修改送出失敗。" +
            '</div>';
        this.div.append(html);
    };

    // ------------------------ custom Chartjs ------------------------//

    var iChart = function (id) {

        var data = {
            labels: ["0","1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23"],
            datasets: [

            ]


        };
        var config = {
            type: 'line',
            data:data,
            options:{
                responsive: true,
                title:{
                    display:false,
                    text:''
                },
                tooltips: {
                    mode: "index",
                    intersect: true,
                },
                hover: {
                    mode: "index",
                    intersect: true
                },

            }
        };

        var ctx = document.getElementById(id).getContext("2d");
        var chart = new Chart(ctx,config);

        //chart.data.datasets[1].data = [40, 23, 31, 56, 1, 2,10];
        // chart.update();
        this.chart = chart;
    };
    iChart.prototype.addDataset1 = function (id) {
        var color = ["rgba(255,205,86,0.8)","rgba(151,187,205,1)","#E64C65","#11A8AB","#4FC4F6","#F46FDA","#878BB6","#FF8153","#FFEA88","#48A4D1","#ACC26D"];
        /*
         {
         label: "Octoproxy",
         backgroundColor: "rgba(231,233,237,0.0)",
         borderColor: "rgba(255,205,86,0.8)",
         pointBorderColor: "rgba(255,205,86,0.8)",
         pointBackgroundColor: "rgba(255,205,86,0.8)",
         pointHoverBorderColor:"rgba(55,55,55,1.0)",
         lineTension:0.1,
         borderWidth:2
         },
         {
         label: "Candy-4",
         backgroundColor: "rgba(151,187,205,0.0)",
         borderColor: "rgba(151,187,205,1)",
         pointBorderColor: "rgba(151,187,205,1)",
         pointBackgroundColor: "rgba(151,187,205,1)",
         pointHoverBorderColor:"rgba(151,187,205,1)",
         lineTension:0.1,
         borderCapStyle:"round",
         borderJoinStyle:"round",
         borderWidth:2
         }
         */
        return {
            backgroundColor: "rgba(0,0,0,0.0)",
            borderColor: color[id],
            pointBorderColor: color[id],
            pointBackgroundColor: "#ff616e",
            pointHoverBorderColor:"rgba(151,187,205,1)",
            lineTension:0.1,
            borderCapStyle:"round",
            borderJoinStyle:"round",
            borderWidth:2
        };
    };
    var control = function (name, oPrefSettings) {
        this.oPrefSettings = oPrefSettings;
        this.tmp = this.initTable(name);
        this.devTmp = this.initDevices("#node-devices-Monitor");
        this.block = undefined;
        this.num = 0;
        this.src = undefined; //顯示資料
        this.entries = {};
        this.history = {};
        this.logConnect = undefined;
        this.moveBottom = true;
        this.networkEntries = undefined;
        this.devicesEntries = {};
        this.devicesEntriesLen = 0;
        this.devicesSort = undefined;
        this.titleWidth = 0;
        this.fl2dbArray = [];
        this.filterShow = "";
        this.slStyle = {
            type: 'line',
            lineColor: '#8cc152',
            fillColor: 'transparent',
            spotColor: "transparent",
            minSpotColor: "transparent",
            maxSpotColor: "transparent"
        };
        this.navPages = {
            current: 0,
            total: 0,
            rowsPerPage: 25
        }
        var style = {
            // The color of the curcular bar. You can pass either a css valid color string like rgb, rgba hex or string colors. But you can also pass a function that accepts the current percentage as a value to return a dynamically generated color.
            barColor: '#2f9fe0',
            // The color of the track for the bar, false to disable rendering.
            trackColor: '#ffffff',
            // The color of the scale lines, false to disable rendering.
            scaleColor: 'transparent',
            // Defines how the ending of the bar line looks like. Possible values are: butt, round and square.
            lineCap: 'line',
            // Width of the bar line in px.
            lineWidth: 10,
            // Size of the pie chart in px. It will always be a square.
            size: 110,
            rotate:0,
            // Time in milliseconds for a eased animation of the bar growing, or false to deactivate.
            animate: 1000,
            // Callback function that is called at the start of any animation (only if animate is not false).
            onStart: function (value) {
                this.$el.find('span').text(value);
            },
            onStep: function(value) {
                this.$el.find($("span")).text(parseInt(value));
            },
            // Callback function that is called at the end of any animation (only if animate is not false).
            onStop: function (value, to) {
                this.$el.find('span').text(Math.round(to));
            }
        };
        $('.chartVisits').easyPieChart(style);
        style.barColor = "#2f9fe0";
        style.barColor = function (percent) {
            return (percent < 50 ? '#5cb85c' : percent < 85 ? '#f6bb42' : '#cb3935');
        };
        $('.chartInfo').easyPieChart(style);
        style.barColor = "#334454";

        $('.chartIncoming').easyPieChart(style);

        this.easyPieChartStyle = style;

        this.schedule = new Schedule();

    };
    control.prototype.initTable = function (name) {
        var copy = $(name).clone();
        copy.removeAttr("hidden");
        copy.removeClass("tmp");
        this.block = $(name).parents(".block").first();
        // this.block.find(".node-service").slideUp();
        $(name).parent().empty(); // remove all child.
        return copy;
    };
    control.prototype.initDevices = function (name) {
        var copy = $(name).find(".list-item-content").clone();
        copy.removeAttr("hidden");
        $(name).find(".list-item-content").parent().empty(); // remove all child.
        return copy;
    };
    control.prototype.setupGeneralHead = function () {
        var self = this;
        $(".block-toggle").click(function () {
            var box = $(this).parents(".block").first();
            self.switchCollapsed(box, $(this));
        });
    };
    control.prototype.switchCollapsed = function (box, btn, time) {
        var bf = box.find(".block-content");

        if (!box.hasClass("collapsed-box")) {
            box.addClass("collapsed-box");
            bf.slideUp(time);
            btn.children("span").removeClass("fa fa-chevron-down").addClass("fa fa-chevron-up");
        } else {
            box.removeClass("collapsed-box");
            bf.slideDown(time);
            btn.children("span").removeClass("fa fa-chevron-up").addClass("fa fa-chevron-down");
        }
    };
    control.prototype.update = function (src, admin) {
        this.src = src;
        var child;
        var item;
        var data;
        var name;
        this.fl2dbArray = [];
        this.threads = [];
        this.hashTables = new Map();
        let filterShow = this.filterShow.replace(/\s*/g,"");
        let filterGroup = filterShow.split(":");
        let filterType = "name";
        let filter;
        if (Array.isArray(this.src) === false) return false;
        let i = 0;
        for (i; i < this.src.length; i++) {
            name = "item" + i;
            data = this.src[i];
            this.fl2dbArray.push({
                id: i,
                name: data.name,
                f2db: data.f2db
            });
            if (data.name != "octoproxy") {
                this.threads.push(data.name);
                this.hashTables.set(data.name, data.pid);
            }
            if (i >= this.num) {
                child = this.tmp.clone();
                this.history[i] = {ram:[], cpu:[]};
                this.entries[name] = {
                    status:child.find(".pro-state"),
                    time:child.find(".list-item-date"),
                    progress:child.find(".pro-bar"),
                    assign:child.find(".pro-assign"),
                    file:child.find(".pro-file"),
                    count:child.find(".pro-count"),
                    payload:child.find(".pro-payload"),
                    memoryUsage:child.find(".pro-memory-usage"),
                    memoryHistory:child.find(".pro-memory-history"),
                    cpuUsage:child.find(".pro-cpu-usage"),
                    cpuHistory:child.find(".pro-cpu-history"),
                    log:child.find(".pro-log"),
                    tachometer:child.find(".list-tachometer"),
                    endpoint: child,
                    hidden:false,
                    title:child.find(".list-item-container-l")
                };
                child.appendTo($("#node-service"));
                this.setSettingEvent(i, child, admin);

                if (data.bitrates) {
                    child.find(".list-item-tachometer").css("display", "block");
                }

                this.num++;
            } else {
                child = this.entries[name].endpoint;
                if (this.entries[name].hidden) {
                    child.removeAttr("hidden");
                }
            }
            item = this.entries[name];

            this.titleWidth = Math.max(this.titleWidth, item.file.children("span").width());
            item.title.css("width", this.titleWidth);
            if (filterGroup.length == 1) {
                filter = filterShow;
            } else {
                if (filterGroup[0] === 'file') {
                    filterType = 'file';
                    filter = filterGroup[1];
                }
            }
            if (data[filterType].indexOf(filter) == -1) {
                item.endpoint.attr('hidden', true);
            } else {
                item.endpoint.removeAttr('hidden');
                this.setStatus(item.status, data.complete, i, data.trash);
                this.setUptime(item.time, data.uptime);

                this.setAssign(item.assign, data.name);

                this.setFile(item.file, data.file, data.lock);

                this.setCount(item.count, data.count);
                this.setPayload(item.payload, data.payload || data.count);
                this.setLogStatus(item.log, data, admin);
                this.setBitRates(item.tachometer, data, child);

                if (typeof data.memoryUsage == "undefined") data.memoryUsage = {rss:0};

                this.setMemory(i, item.memoryUsage, item.memoryHistory, data.memoryUsage.rss);
                let cpu = data.cpuUsage || data.cpu;
                this.setCPU(i, item.progress, item.cpuUsage, item.cpuHistory, cpu);

                this.setButtonStatus(i, child);
            }
        };
        if (this.num > this.src.length) {
            var n = this.src.length;

            while (n < this.num) {
                this.entries["item" + n].endpoint.attr("hidden", true);
                this.entries["item" + n].hidden = true;
                n++;
            }


        }

    };
    control.prototype.setUptime = function (el, uptime) {
        var d = new Date();
        d.setTime(uptime);
        /**/
        var time = Math.floor((new Date().getTime() - uptime) / 1000);
        var day  = "0";
        var hour = "0";
        var min  = "0";
        var sec;
        var f;
        if (time >= 3600) {
            hour = Math.floor(time / 3600);
            time = time - hour * 3600;
        }
        if (time >= 60) {
            min = Math.floor(time / 60);
            time = time - min * 60;
        }
        sec = time;
        if (hour >= 24) {
            day = Math.floor(hour / 24);
            f = day + "-day";
        }
        else if (hour != "0") {
            f = (hour >= 10 ? hour : ("0" + hour)) + ":" + (min >= 10 ? min : "0" + min);
        } else
        {
            f = (min >= 10 ? min : "0" + min) + ":" + ((sec >= 10) ? sec : "0" + sec);
        }
        el.html('<i class="fa fa-clock-o"></i> ' + f);
    };
    control.prototype.setStatus = function (el, status, id, trash) {
        var n = (el.html() == "ON");

        if (n == status) return;
        if (trash == true)  {
            el.removeClass("label-success");
            el.addClass("label-danger");
            el.html('<i class="fa fa-trash" aria-hidden="true"></i>');
        } else if (status) {
            el.removeClass("label-danger");
            el.addClass("label-success");
            el.html("ON");
        } else
        {
            el.removeClass("label-success");
            el.addClass("label-danger");
            el.html("OFF");
        }
    };
    control.prototype.setAssign = function (el, str) {

        if (el.attr("title") == str) return;

        el.attr("title", str);
        if (str.length > 30) {
            str = str.substring(0,20) + "...";
            el.html(str);
        } else {
            el.html(str);
        }
    };
    control.prototype.setFile = function (el, str, lock) {
        var state = !(el.children("i").attr("hidden") == "hidden");
        if (state != lock) {
            if (lock == true) el.children("i").attr("hidden", false);
            else el.children("i").attr("hidden", true);
        }

        if (el.children("span").html() == str) return;
        if (str.length > 25) {
            let str2 = [];
            for (var i = 0; i < str.length; i+=25) {
                str2.push(str.slice(i, 25+i));
            };
            el.children("span").html(str2.join("<p>"));
        } else {
            el.children("span").html(str);
        }

    };
    control.prototype.setCount = function (el, count) {
        var text = el.find(".text");
        if (text.html() == count) return;
        // if (count > 500) {}
        text.html(count);
        if (count > 0 && count < 500) {
            text.attr("class", "text");
        } else if (count >= 500 && count < 1000) {
            text.attr("class", "text text-info");
        } else if (count >= 1000 && count < 1600) {
            text.attr("class", "text badge badge-info");
        } else if (count >= 1600) {
            text.attr("class", "text badge badge-warning");
        } else {
            text.attr("class", "text");
        }
    };
    control.prototype.setMemory = function (i, el, el2, ram) {
        ram = ( ram / 1024 / 1024 ).toFixed(1);
        var value = ram;
        if (value > 1000) {
            value = (value/1024).toFixed(2) + " GB";
            el.css("color", "#EE7600");
            el.css("font-weight", "bold");
        } else {
            value += " MB";
            el.css("color", "#AAA");
            el.css("font-weight", "normal");
        }
        if (this.history[i].ram.length > 8) this.history[i].ram.shift();
        this.history[i].ram.push(ram);

        if (ram > 2048) this.slStyle.lineColor = "#da4453";
        else if (ram < 1024) this.slStyle.lineColor = "#8cc152";
        else this.slStyle.lineColor = "#f6bb42";

        if (this.oPrefSettings.memState) el2.sparkline(this.history[i].ram, this.slStyle);

        el.html(value);
    };
    control.prototype.setCPU = function (i, progress, el, el2, cpu) {
        cpu = Number(cpu);
        if (isNaN(cpu)) cpu = 0;
        if (this.history[i].cpu.length > 8) this.history[i].cpu.shift();
        this.history[i].cpu.push(cpu);

        if (cpu > 80) {
            this.slStyle.lineColor = "#da4453";
            progress.attr("class", "pro-bar progress-bar progress-bar-danger");
            el.attr("class", "pro-cpu-usage text-danger");
        }
        else if (cpu > 50 && cpu < 80) {
            this.slStyle.lineColor = "#f6bb42";
            progress.attr("class", "pro-bar progress-bar progress-bar-warning");
            el.attr("class", "pro-cpu-usage text-warning");
        }
        else {
            this.slStyle.lineColor = "#8cc152";
            progress.attr("class", "pro-bar progress-bar progress-bar-success");
            el.attr("class", "pro-cpu-usage");
        }

        if (this.oPrefSettings.cpuState) el2.sparkline(this.history[i].cpu, this.slStyle);

        if ((cpu + "%") == el.html()) return;

        el.html(cpu + "%");
        progress.css("width", cpu + "%");
    };
    control.prototype.setPayload = function (el, count) {
        // console.log(Number(el.html()) != count, el.html(), count);
        if (Number(el.html()) != count) {
            el.html(count);
        }
    };
    control.prototype.setLogStatus = function (el, data, admin) {
        // $.fn.editable.defaults.mode = 'popup';
        var status = el.find(".status");
        status.html(data.lv);
        status.editable({
            type: "select",
            title: 'Select Status',
            placement: 'right',
            value: data.lv,
            container: 'body',
            source: [
                {value: "quiet", text: "Quiet"},
                {value: "error", text: "Error"},
                {value: "warning", text: "Warning"},
                {value: "info", text: "Info"},
                {value: "debug", text: "Debug"},
                {value: "trace", text: "Trace"},
                {value: "log", text: "Log"}
            ],
            success: function (res, newValue) {
                // console.log('success', newValue, data.pid);
                admin.setLogLevel(data.pid, {lv:newValue});
            },
            url: function(params) {
                // console.log("url",params);
            }
        });
    };
    control.prototype.setBitRates = function (el, data, endpoint) {
        // var data2 = {
        //     bitrates:{"/video/daabdg/video0/":{"Bps":(Math.random()* 100).toFixed(2)},"/video/daabdg/video1/":{"Bps":(Math.random()* 100).toFixed(2)},"/video/daabdg/videosd/":{"Bps":(Math.random()* 100).toFixed(2)},"/video/daabdg/videohd/":{"Bps":(Math.random()* 100).toFixed(2)}}
        // };
        var view = el.find(".bitrates");
        var child = view.children();
        var len = view.children().length;
        var bitrates = data.bitrates;

        let list = endpoint.find(".list-tachometer");
        if (list.attr("class").indexOf("list-bitrates") != -1) return;

        if (typeof bitrates == "undefined") return;
        var keys = Object.keys(bitrates);
        var key;
        var obj;
        var bps_item;

        if (len > keys.length) {
            while (view.children().length > keys.length) {
                child.eq(0).remove();
            }
        }

        for (var i = 0; i < keys.length; i++) {
            key = keys[i];
            obj = bitrates[key];
            bps_item = child[i];
            if (typeof bps_item != "undefined" && bps_item != null) {
                child.eq(i).find("badge").html(key);
                child.eq(i).find(".bps").html(obj["Bps"]);
            } else {
                view.append('<p class="col-xs-6 col-md-4" style="padding-bottom: 6px;"><span class="label label-info2">' + key + '</span> <span class="bps" style="font-weight: bold;">' + obj["Bps"] + '</span> <small> Kb/s</small></p>');
            }
        }

    };
    control.prototype.setSettingEvent = function (i, el, admin) {
        var self = this;
        var tachometer = el.find(".list-item-tachometer");
        if (typeof tachometer != "undefined") {
            tachometer.click(function () {
                var list = el.find(".list-tachometer");
                list.toggleClass("list-bitrates");

                if (list.attr("class").indexOf("list-bitrates") == -1) {
                    var len = list.find(".bitrates").children().length;
                    if (len > 12) {
                        list.css("height", "300px");
                    } else
                    {
                        list.css("height", "100px");
                    }
                } else {
                    list.css("height", "");
                }
            });
        }

        function fadeout() {
            el.find(".list-item-controls").css("animation-name", "rightKeyframeOut");
            el.find(".list-item-controls").css("animation-play-state", "running");
            // el.find(".list-item-content").css("animation-name", "rightCntKeyframeOut");
            // el.find(".list-item-content").css("animation-play-state", "running");
        }

        //# Control Views open
        el.find(".list-item-trigger").click(function () {
            el.find(".list-item-controls").css("animation-name", "rightKeyframeIn");
            // el.find(".list-item-content").css("animation-name", "rightCntKeyframeIn");
        });
        //# Control Views close
        el.find(".list-item-controls > div > .chevron-right").click(function () {
            fadeout();
        });

        //# Control process edit
        el.find(".list-item-controls > div > .pro-edited").click(function () {
            console.log('click edited.', self.src[i].file);
            let {ats, lookout, file, name, tags} = self.src[i];

            $('#modal_edit_cluster .modal-title').text("Edit Cluster");
            $('#modal_edit_cluster .file').val(file);
            $('#modal_edit_cluster .file').attr('readonly', true); //開啟
            $('#modal_edit_cluster .assign').val(name);
            $('#modal_edit_cluster .assign').attr('data', name); //pre assign
            $('#modal_edit_cluster .memory-group').hide();

            $('#sendAssignBtn').hide();
            $('#sendClusterBtn').show();
            $('#sendClusterBtn').attr('data', 'edit');

            $("#cLookout").attr('disabled','disabled');
            $("#cATS").attr('disabled','disabled');
            $("#cLookout").prop("checked", (typeof lookout == "boolean") ? lookout: true);
            $("#cATS").prop("checked", (typeof ats == "boolean") ? ats: false);
            $('#tags-text').val((Array.isArray(tags) ? tags.toString() : tags));
            $("#modal_edit_cluster").modal('show');

        });
        //# Control process restart
        var btnRestart = el.find(".list-item-controls > div > .pro-restart");
        var btnResetHandler = function btnResetHandler(gracefully) {
            var assign = self.src[i].name;
            var pid = self.src[i].pid;
            console.log("btnRestart(%s)", i, assign, gracefully);

            if (assign != 'octoproxy') {
                admin.restartCluster(assign, pid, gracefully);
            }else {
                admin.restartSys();
            }
        };
        btnRestart.bootstrap_confirm_shutdown({
            "heading":"Cluster Restart Confirmation",
            "message":"Are your sure you want to restart?",
            "delete_callback":function (event) {
                btnResetHandler.apply(event["data"]["originalObject"], [0])
            },
            "gracefully_callback": (event) => {
                btnResetHandler.apply(event["data"]["originalObject"], [1])
            }
        });
        //# Control process Delete
        var btnDelete = el.find(".list-item-controls > div > .pro-delete");
        var btnDeadHandler = function btnDeadHandler() {
            var pid = self.src[i].pid;
            console.log("btnDeadHandler(%s)", i, pid);
            admin.killClusterToPID(pid);
        };
        btnDelete.bootstrap_confirm_delete({
            "heading":"Cluster Delete Confirmation",
            "message":"Are your sure you want to Delete?",
            "delete_callback":function (event) {
                btnDeadHandler.apply(event["data"]["originalObject"])
            }
        });
        //# Control process lock & unlock connect user
        var btnLock = el.find(".list-item-controls > div > .pro-locked");
        var btnLockHandler = function btnLockHandler() {
            console.log("btnLockHandler", self.src[i].lock);
            if (!self.src[i].lock) {
                btnLock.addClass("active");
                btnLock.removeClass("btn-default");
                btnLock.addClass("btn-success");
                btnLock.find(".fa-lock").removeAttr("hidden");
                btnLock.find(".fa-unlock").attr( "hidden", true);
            } else {
                btnLock.removeClass("active");
                btnLock.addClass("btn-default");
                btnLock.removeClass("btn-success");
                btnLock.find(".fa-unlock").removeAttr("hidden");
                btnLock.find(".fa-lock").attr( "hidden", true);
            }
            self.src[i].lock = !self.src[i].lock;

            var assign = self.src[i].name;
            console.log('set dontDisconnect', assign, self.src[i].lock);

            if (assign != 'octoproxy') {
                admin.refuseUser2PID(self.src[i].pid, self.src[i].lock);
            } else {
                admin.lockConnection(self.src[i].lock, self.src[i].pid);
            }

        };
        btnLock.bootstrap_confirm_delete({
            "heading":"Connect " + (!self.src[i].lock ? "lock": "unlock") + " to Cluster",
            "message":"Are your sure you want to " + (!self.src[i].lock ? "lock": "unlock") + "?",
            "delete_callback":function (event) {
                btnLockHandler.apply(event["data"]["originalObject"])
            }
        });
        //# Control process kick out user
        var btnKicOutHandler = function btnKicOutHandler() {
            var pid = self.src[i].pid;
            var trash = self.src[i].trash || false;
            var keys = el.find(".list-item-controls > div > .pro-kick-out-key").val() || "";
            keys = (Array.isArray(keys) ? keys : keys.split(","));
            console.log('btnKickoutHandler(%s)', i, pid, keys);
            admin.kickout(pid, trash, keys);
        };

        var btnKickOut = el.find(".list-item-controls > div > .pro-kick-out");
        btnKickOut.bootstrap_confirm_delete({
            "heading":"Cluster Kick Out Users Confirmation",
            "message":"Are your sure you want to Kick Out Users?",
            "delete_callback":function (event) {
                btnKicOutHandler.apply(event["data"]["originalObject"])
            }
        });

        var btnRecycleHandler = function btnRecycleHandler() {
            var pid = self.src[i].pid;
            var trash = self.src[i].trash || false;
            var keys = el.find(".list-item-controls > div > .game-recycle").val();

            keys = (Array.isArray(keys) ? keys : keys.split(","));
            console.log('btnRecycleHandler(%s)', i, pid, keys);
            admin.ipcMessage(pid, keys);
        };

        var btnRecycle = el.find(".list-item-controls > div > .game-recycle");
        btnRecycle.bootstrap_confirm_delete({
            "heading":"註銷流程事件",
            "message":"確定處理註銷流程？",
            "delete_callback":function (event) {
                btnRecycleHandler.apply(event["data"]["originalObject"])
            }
        });
        var btnHotReload = el.find(".list-item-controls > div > .pro-hotReload");

        var viewLog = el.find(".list-item-info");


        viewLog.click(function () {
            $("#modal_log_cluster").modal("show");
            self.setupLogConnect(self.src[i].pid.toString());
            $("#modal_log_cluster").find(".modal-title").text("Process System Logger [" + self.src[i].name + "]");
        });
    };
    control.prototype.setButtonStatus = function (i, el) {
        var btn1 = el.find(".list-item-controls > div > .pro-edited");
        var btn2 = el.find(".list-item-controls > div > .pro-delete");
        var btn3 = el.find(".list-item-controls > div > .pro-locked");
        var btn4 = el.find(".list-item-controls > div > .pro-kick-out");
        var btnLock = el.find(".list-item-controls > div > .pro-locked");
        if (this.src[i].file == "loadBalance" || this.src[i].file == "Main") {
            btn1.attr("disabled", "disabled");
            // btn1.removeClass("btn-primary");
            // btn1.addClass("btn-default");
            btn2.attr("disabled", "disabled");
        } else {
            if (btn1.attr("disabled") == "disabled") btn1.removeAttr("disabled");
            // btn1.addClass("btn-primary");
            // btn1.removeClass("btn-default");
            if (btn2.attr("disabled") == "disabled") btn2.removeAttr("disabled");
        }
        if (this.src[i].file == "loadBalance") {
            btn3.attr("disabled", "disabled");
            btn4.attr("disabled", "disabled");
        } else {
            if (btn3.attr("disabled") == "disabled") btn3.removeAttr("disabled");
            if (btn4.attr("disabled") == "disabled") btn4.removeAttr("disabled");
        }
        var nowLock = (btnLock.attr("class").indexOf("active") != -1);
        if (nowLock != this.src[i].lock) {
            if (this.src[i].lock) {
                btnLock.addClass("active");
                btnLock.removeClass("btn-default");
                btnLock.addClass("btn-success");
                btnLock.find(".fa-lock").removeAttr("hidden");
                btnLock.find(".fa-unlock").attr( "hidden", true);
            } else {
                btnLock.removeClass("active");
                btnLock.addClass("btn-default");
                btnLock.removeClass("btn-success");
                btnLock.find(".fa-unlock").removeAttr("hidden");
                btnLock.find(".fa-lock").attr( "hidden", true);
            }
        }
    };
    control.prototype.progressBarValue = function (el, value) {
        el.css("width", value + "%");
    };
    control.prototype.updateSysVisitors = function (data) {
        if (typeof data == "undefined") return;
        if (typeof this.sysVisits == "undefined") {
            this.sysVisits = {};
            var el = $(".system-visitors");
            this.sysVisits.percent = el.find("span");
            this.sysVisits.chat = el.find(".chartVisits");
            this.sysVisits.info = el.find(".widget-pie-info-num");
            this.sysVisits.text = el.find(".widget-pie-info-text");
        }
        var num = data.visitors.success + data.visitors.failure ;
        var percent = Math.floor((data.visitors.success/num * 100));
        this.sysVisits.percent.html(percent);
        this.sysVisits.chat.data('easyPieChart').update(percent);
        if (num >= 1000)
            this.sysVisits.info.html(String(num).replace(/\d(?=(\d{3})+$)/g, '$&,'));
        else
            this.sysVisits.info.html(num);
        // this.sysVisits.text.html('Used HD');
        console.log(`updateSysVisitors =>${num}`);

    };
    control.prototype.updateSysHDD = function (data) {
        if (typeof this.sysHDD == "undefined") {
            this.sysHDD = {};
            var el = $(".system-info-hdd");
            this.sysHDD.percent = el.find("span");
            this.sysHDD.chat = el.find(".chartInfo");
            this.sysHDD.info = el.find(".widget-pie-info-num");
            this.sysHDD.text = el.find(".widget-pie-info-text");
        }
        this.sysHDD.percent.html(data.hdd);
        this.sysHDD.chat.data('easyPieChart').update(data.hdd);

        if (typeof data.hddBlocks == "undefined") data.hddBlocks = 0;

        var size = (Math.floor(data.hddBlocks * data.hdd / 1024 /1024) / 100);

        if (size < 1) size = (Math.floor(data.hddBlocks * data.hdd / 1024) / 100) + "MB";
        else size += "GB";

        this.sysHDD.info.html(size);
    };
    control.prototype.updateSysLoadAvg = function (data) {
        if (typeof this.sysLoad == "undefined") {
            this.sysLoad = {};
            var el = $(".system-info-loadAvg");
            this.sysLoad.percent = el.find("span");
            this.sysLoad.chat = el.find(".chartInfo");
            this.sysLoad.info = el.find(".widget-pie-info-num");
            this.sysLoad.text = el.find(".widget-pie-info-text");
        }
        var avg = Math.floor(data.loadavg[0] * 100) / 100;

        this.sysLoad.chat.data('easyPieChart').update(Math.floor(avg / data.cpuCount * 100));

        this.sysLoad.info.html(avg);
    };
    control.prototype.updateIncoming = function (data) {
        if (typeof this.incoming == "undefined") {
            this.incoming = {};
            var el = $(".system-info-incoming");
            this.incoming.percent = el.find("span");
            this.incoming.chat = el.find(".chartIncoming");
            this.incoming.info = el.find(".widget-pie-info-num");
            this.incoming.text = el.find(".widget-pie-info-text");
        }
        var week = new Date().getDay();
        var total = 0;

        var weekIncoming = data.incomeCount[week];
        if (typeof weekIncoming == "undefined") weekIncoming = {};
        var keys = Object.keys(weekIncoming);
        for (var i = 0; i < keys.length; i++) {
            total += weekIncoming[keys[i]];
        }
        var success = data.visitors.success;
        var percent = Math.floor(((total/success) * 100));
        // var prevWeek = (week-1 <= 0) ? 7 : week-1;
        // var prevWeekIncoming = data[prevWeek];
        // keys = Object.keys(prevWeekIncoming);
        // var prevTotal = 0;
        // for (var i = 0; i < keys.length; i++) {
        //     prevTotal += prevWeekIncoming[keys[i]];
        // }

        if (percent == Number.POSITIVE_INFINITY || percent == Number.NEGATIVE_INFINITY) percent = 0;

        this.incoming.percent.html(total);
        this.incoming.chat.data('easyPieChart').update(percent);
        if (total > 1000) {
            this.incoming.info.html(String(total).replace(/\d(?=(\d{3})+$)/g, '$&,'));
        } else {
            this.incoming.info.html(total);
        }

    };
    //搜尋
    control.prototype.refreshFilters = function () {
        console.log(`refreshFilters`);
        let item;
        let name;
        let data;
        let filterShow = this.filterShow.replace(/\s*/g,"");
        let split = filterShow.split(":");
        let rule;
        let column = "name";
        if (split[0] == "file") {
            column = "file";
            rule = split[1];
        } else {
            rule = filterShow;
        }
        console.log(`COLUMN:${column}, rule:${rule}`);

        for (let i = 0; i < this.src.length; i++) {
            name = "item" + i;
            item = this.entries[name];
            data = this.src[i];
            if (data[column].indexOf(rule) == -1) {
                item.endpoint.attr('hidden', true);
            } else {
                item.endpoint.removeAttr('hidden');
            }
        }
    };
    control.prototype.threadEvent = function (mAdapter, alert) {
        var self = this;

        //送出按鈕
        $("#sendClusterBtn").click(function () {

            let mode = $(this).attr('data');
            console.log('sendClusterBtn() mode:', mode);

            let readonly = $('#modal_edit_cluster .file').attr('readonly');
            let file = $('#modal_edit_cluster .file').val();
            let assign = $('#modal_edit_cluster .assign').val();
            let old_assign = $('#modal_edit_cluster .assign').attr('data');
            let memory = $('#modal_edit_cluster .memory').val();
            let args = $('#modal_edit_cluster .args').val();
            let cmd = $('#modal_edit_cluster .launchCmd').val();
            let envVar = ($('#launchEnv-text').val());
            let tags = $('#modal_edit_cluster .tags').val();
            let lookout = document.getElementById("cLookout").checked;
            let ats = document.getElementById("cATS").checked;
            let env = [];
            if (typeof envVar == "string") {
                envVar.split(",").forEach((item) => {
                    if (item && item.indexOf('=') != -1) {
                        let [key, value] = item.split("=");
                        env.push([key, value]);
                    }
                });
            }

            let options = {args, lookout, ats, cmd, tags, env};

            if (file == "" && assign == "" && memory == 0) {
                alert.showAlert("錯誤:無效參數");
                return;
            }

            if (readonly == 'readonly' && mode == "edit") {
                //edit
                mAdapter.editCluster(old_assign, assign, options, self.hashTables.get(old_assign));

            }else {
                //add
                mAdapter.addCluster(file, assign, memory, options);
                $('#modal_edit_cluster .args').val("");
            }

            $("#modal_edit_cluster").modal('hide');

            self.clearThread();
        });
        $( "#addCluster" ).click(function() {
            console.log('addCluster()');
            var file   = $("#input1").val();
            var assign = $("#input2").val();
            var memory = $("#input3").val();

            if (file != "" && assign != "" && memory != 0) {
                mAdapter.addCluster(file, assign, memory);

            }else {
                console.log('addCluster input error.');
            }

        });
        $("#btn-insert-cluster").click(function () {
            self.clearThread();
            $('#sendAssignBtn').hide();
            $('#sendClusterBtn').show();
            $('#sendClusterBtn').attr('data', 'insert');
            $("#modal_edit_cluster").modal('show');
            $('#cLookout').prop('checked', true);
        });

        $("#btn-insert-assign").click(function () {

            $('#sendAssignBtn').show();
            $('#sendAssignBtn').attr('data', 'insert');
            $('#sendClusterBtn').hide();
            $("#modal_edit_cluster").modal('show');
        });
        // 新增修改assign清單
        $("#sendAssignBtn").click(function () {
            var mode = $(this).attr('data');

            var file = $('#modal_edit_cluster .file').val();
            var assign = $('#modal_edit_cluster .assign').val();
            var old_assign = $('#modal_edit_cluster .assign').attr('data');
            var memory = $('#modal_edit_cluster .memory').val();
            var args = $('#modal_edit_cluster .args').val();
            var lookout = document.getElementById("cLookout").checked;
            var ats = document.getElementById("cATS").checked;

            if (mode == "insert") {
                admin.addAssign(file, assign, memory, {ats:ats, lookout:lookout, args:args});
            }
            if (mode == "edit"){
                admin.editAssign(old_assign, file, assign, memory, args, lookout, ats);
            }

        });

    };
    control.prototype.clearThread = function () {
        $('#modal_edit_cluster .modal-title').text("Insert Cluster");
        $('#modal_edit_cluster .file').removeAttr("readonly");
        $('#modal_edit_cluster .file').val("");
        $('#modal_edit_cluster .assign').val("");
        $('#modal_edit_cluster .assign').attr('data', ""); // pre assign

        $('#modal_edit_cluster .memory').val("");
    };
    control.prototype.setupLogConnect = function (assign) {
        var self = this;
        if (typeof self.logConnect == "undefined") {
            self.logConnect = new connect('ws://' + document.getElementById('ipAddress').value + '/',['log'], function () {
                self.logConnect.liveLog(assign);
                self.currentLog = assign;
                self.logConnect.addListener("complete", function (d) {
                    var event = d.event;
                    if (event == "getLoggerList") {

                    } else if (event == "liveLog") {
                        console.log('data.event');
                        setTimeout(function () {
                            console.log('self.moveBottom', self.moveBottom);
                            if (self.moveBottom) $(".scroll-content-log").mCustomScrollbar("scrollTo", "bottom");
                        },10);
                        d.data.log = d.data.log.replace(/error/g, '<span style=color:#da4453;font-weight:bold;>error</span>');
                        d.data.log = d.data.log.replace(/info/g, '<span style=color:#2f9fe0;font-weight:bold;>info</span>');
                        d.data.log = d.data.log.replace(/warning/g, '<span style=color:#f6bb42;font-weight:bold;>warning</span>');

                        // var arr = d.data.log.split("\r\n");
                        // for (var i = 0; i < arr.length; i++) {
                        //
                        // }

                        $("#mCSB_1_container").append("<p style='margin: 0 0 0 0;'>" + d.data.log + "</p>");

                        var rows = $("#mCSB_1_container > p").length;
                        $("#modal_log_rows").html(rows);

                        if (rows > 2000) {
                            $("#mCSB_1_container").children().eq(0).remove();
                        }
                    }
                });
            });
            $(".scroll-content-log").mCustomScrollbar({
                callbacks:{
                    onScrollStart:function(){
                        // console.log('onScrollStart');
                    },
                    whileScrolling:function() {
                    },
                    onTotalScroll:function () {
                        //console.log('onTotalScroll');
                        self.moveBottom = true;
                    }
                }
            });
            $("#modal_log_cluster").on('hidden.bs.modal', function () {
                console.log('do something…');
                self.logConnect.leaveLog(assign);
                self.currentLog = undefined;
                $("#modal_log_cluster").find(".mCSB_container").empty();
                $("#modal_log_rows").html(0);
            });

        } else {
            if (typeof self.currentLog != "undefined") {
                self.logConnect.leaveLog(self.currentLog);
                self.currentLog = undefined;
                $("#modal_log_cluster").find(".mCSB_container").empty();
                $("#modal_log_rows").html(0);
            }
            self.logConnect.liveLog(assign);
            self.currentLog = assign;
        }

        $(".scroll-content-log").height( $( window ).height() - 200 );
    };
    control.prototype.updateNetwork = function (data) {
        var el;
        if (typeof this.networkEntries == "undefined") {
            el = $("#node-network-Monitor");
            this.networkEntries = {
                network: el,
                active:  el.find(".it-active"),
                passive: el.find(".it-passive"),
                currEstab: el.find(".it-currEstab"),
                retransRate: el.find(".it-retransRate")
            };
        }
        el = this.networkEntries;

        el.active.html(data["Tcp"]["ActiveOpens"]);
        el.passive.html(data["Tcp"]["PassiveOpens"]);
        el.currEstab.html(data["Tcp"]["CurrEstab"]);
        el.retransRate.html((Number(data["Tcp"]["retransRate"])*100).toFixed(2))

    };
    control.prototype.updateDevices = function (devices) {
        var list;
        var key;
        var child;
        var item;
        var data;
        var name;
        var chartArr;
        var self = this;
        if (typeof this.devicesSort == "undefined") {
            this.devicesSort = Object.keys(devices).sort();
        }
        list = this.devicesSort;

        var deviceInfo = function deviceInfo(i) {
            return new Promise(function (resolve, reject) {
                name = "item" + i;
                key  = list[i];
                data = devices[key];
                if (typeof self.devicesEntries[name] == "undefined") {
                    child = self.devTmp.clone();
                    self.devicesEntries["item" + i] = {
                        host:child.find(".dev-ipAddress"),
                        face:child.find(".dev-face"),
                        transmit:child.find(".transmit"),
                        tUnit:child.find(".t-unit"),
                        receive:child.find(".receive"),
                        rUnit:child.find(".r-unit"),
                        rxChart:child.find(".network-stat-transmit"),
                        txChart:child.find(".network-stat-receive"),
                        endpoint: child,
                        hidden:false
                    };
                    child.appendTo($("#node-devices-Monitor").find(".list"));
                    self.devicesEntriesLen = i;
                } else {
                    child = self.devicesEntries[name].endpoint;
                    if (self.devicesEntries[name].hidden) {
                        child.removeAttr("hidden");
                    }
                }
                item = self.devicesEntries[name];

                item.host.html(key);
                item.face.html("(" + data.face + ")");
                item.rUnit.html((data.receive > 1024) ? "MBs" : "kBs");

                item.receive.html((data.receive > 1024) ? (data.receive/1024).toFixed(2) : data.receive);

                item.tUnit.html((data.transmit > 1024) ? "MBs" : "kBs");
                item.transmit.html((data.transmit > 1024) ? (data.transmit/1024).toFixed(2) : data.transmit);

                if (typeof data.rxRecords != "undefined" && data.rxRecords.length >= 50) {
                    chartArr = data.rxRecords.slice(data.rxRecords.length-50, data.rxRecords.length);
                } else {
                    chartArr = data.rxRecords;
                }
                var width = $("#panel-network").width() - 30;
                item.rxChart.sparkline(chartArr, {
                    type: 'line',
                    width: width,
                    height: 26,
                    lineColor: '#8cc152',
                    fillColor: '#f6ffef',
                    spotColor: "transparent",
                    minSpotColor: "transparent",
                    maxSpotColor: "transparent"
                });
                if (typeof data.txRecords != "undefined" && data.txRecords.length >= 50) {
                    chartArr = data.txRecords.slice(data.txRecords.length-50, data.txRecords.length);
                } else {
                    chartArr = data.txRecords;
                }
                item.txChart.sparkline(chartArr, {
                    type: 'line',
                    width: width,
                    height:26,
                    lineColor: '#e05178',
                    fillColor: '#fff8f3',
                    spotColor: "transparent",
                    minSpotColor: "transparent",
                    maxSpotColor: "transparent"
                });
                setTimeout(function () {resolve(true);}, 20);
            });
        };

        var all = [];
        for (var j = 0; j < list.length; j++) {
            all.push(deviceInfo(j));
        }
        
        Promise.all(all).then(function (values) {
            if (self.devicesEntriesLen > list.length) {
                var n = list.length;

                while (n < self.devicesEntriesLen) {
                    self.entries["item" + n].endpoint.attr("hidden", true);
                    self.entries["item" + n].hidden = true;
                    n++;
                }
            }
        });

    };
    control.prototype.updateSchedule = function (src, admin) {
        if (typeof this.schedule == "undefined") this.schedule = new Schedule();
        this.schedule.empty();
        this.schedule.update(src, admin);
    };
    var Schedule = function () {
        this.tmp = this.clear();
    };
    Schedule.prototype.start = function () {
        if (typeof this.ts == "undefined") {
            this.ts = setInterval(function () {
                this.updateCountDown();
            }.bind(this), 1000);
        }
    };
    Schedule.prototype.stop = function () {
        clearInterval(this.ts);
        this.ts = undefined;
    };
    Schedule.prototype.clear = function () {
        const name = ".schedule-tmp";
        const copy = $(name).clone();
        copy.removeAttr("hidden");
        copy.removeClass("tmp");
        this.block = $(name).parents(".block").first();
        this.empty(); // remove all child.
        return copy;
    };
    Schedule.prototype.updateCountDown = function () {
        if (Array.isArray(this.src) == false) return;
        let complete = false;
        for (var i = 0; i < this.src.length; i++) {
            const {id, countDown, executeTime} = this.src[i];
            if (countDown <= 0) continue;
            complete = true;
            const now = new Date().getTime();
            const last = executeTime - now;

            this.src[i].countDown = last;
            if (this.src[i].countDown <= 0) {
                $("#" + id).find(".sch-cd").html('<i class="fa fa-check-square-o success"></i> 已完成');
            } else {
                $("#" + id).find(".sch-cd").html('<i class="fa fa-hourglass-half success"></i> ' + this.formatRemainingTime(last));

            }
        }
        if (!complete) this.stop();
    };
    Schedule.prototype.update = function (src, admin) {
        this.src = src;
        let child;
        let item;
        let data;
        let cd, event, schName, add, exe;
        // [{"id":"task-0","name":"binder","behavior":"reset","dateAdded":1608531500121,"countDown":299259878,"executeTime":1608830760000}]
        for (var i = 0; i < this.src.length; i++) {
            let {id, name, behavior, dateAdded, countDown, executeTime} = this.src[i];
            item = "item" + i;
            child = this.tmp.clone();
            cd = child.find(".sch-cd");
            event = child.find(".sch-event");
            schName = child.find(".sch-name");
            add = child.find(".sch-date-add");
            exe = child.find(".sch-exe-time");
            if (countDown <= 0) {
                cd.html('<i class="fa fa-check-square-o"></i> 已完成');
            } else {
                cd.html('<i class="fa fa-hourglass-half"></i> ' + this.formatRemainingTime(countDown));
            }

            event.html(behavior);
            schName.html(name);
            add.html('<i class="fa fa-clock-o"></i> ' + this.format(dateAdded));
            exe.html('<i class="fa fa-calendar"></i> ' + this.format(executeTime));
            child.removeClass("schedule-tmp");
            child.attr("id", id);
            child.appendTo($("#node-schedule"));
            child.find(".list-item-sch-rm").click(function () {
                admin.cancelSchedule({id: child.attr("id")})
            });
        }
        if (this.src.length == 0) {
            this.stop();
        } else {
            this.start();
        }
    };
    Schedule.prototype.formatRemainingTime = function (countDown) {

        let times = Math.ceil(countDown/1000);
        if (times < 60) {
            return times + ' Sec';
        }
        times = Math.ceil(times/60);
        if (times < 60) {
            return times + ' Min';
        }
        times = Math.ceil(times/60);
        if (times < 60) {
            return times + ' Hours';
        }
        times = Math.ceil(times/24);
        if (times < 24) {
            return times + ' Days';
        }
        times = Math.ceil(times/365);
        return times + ' Years';
    };
    Schedule.prototype.format = function (timestamp) {
        let date = new Date();
        date.setTime(timestamp);
        return (date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate() + " " + date.getHours() + ":" + date.getMinutes());
    };
    Schedule.prototype.empty = function () {
        $("#node-schedule").empty();
    };

    var tester = function (sid, game) {
        this.sid  = sid;
        this.game = game;
        this.print = $("#test-log").find(".console");
        this.print.empty();
    };
    tester.prototype.addValue = function (key, value) {
        this[key] = value;

    };
    tester.prototype.testing = function (host, f5, assign) {
        this.print.empty();
        var url = "ws://" + host + "/" + f5 + "/" + assign;
        this.casino = (f5 == "fxCasino");
        this.video  = (f5 == "fxLive");

        try {
            var ws = new WebSocket(url);
            ws.rule = {
                host:host,
                f5:f5,
                assign:assign
            };
            ws.endpoint = this;
            ws.onopen = this.onOpenHandle;
            ws.onclose = this.onCloseHandle;
            ws.onmessage = this.onMessageHandle;
        } catch (e) {
            console.log(e);
        }
        this.ts = new Date().getTime();
    };
    tester.prototype.onOpenHandle = function () {

    };
    tester.prototype.onCloseHandle = function (event) {
        var reason;
        alert(event.code);
        // See http://tools.ietf.org/html/rfc6455#section-7.4.1
        if (event.code == 1000)
            reason = "Normal closure, meaning that the purpose for which the connection was established has been fulfilled.";
        else if(event.code == 1001)
            reason = "An endpoint is \"going away\", such as a server going down or a browser having navigated away from a page.";
        else if(event.code == 1002)
            reason = "An endpoint is terminating the connection due to a protocol error";
        else if(event.code == 1003)
            reason = "An endpoint is terminating the connection because it has received a type of data it cannot accept (e.g., an endpoint that understands only text data MAY send this if it receives a binary message).";
        else if(event.code == 1004)
            reason = "Reserved. The specific meaning might be defined in the future.";
        else if(event.code == 1005)
            reason = "No status code was actually present.";
        else if(event.code == 1006)
            reason = "The connection was closed abnormally, e.g., without sending or receiving a Close control frame";
        else if(event.code == 1007)
            reason = "An endpoint is terminating the connection because it has received data within a message that was not consistent with the type of the message (e.g., non-UTF-8 [http://tools.ietf.org/html/rfc3629] data within a text message).";
        else if(event.code == 1008)
            reason = "An endpoint is terminating the connection because it has received a message that \"violates its policy\". This reason is given either if there is no other sutible reason, or if there is a need to hide specific details about the policy.";
        else if(event.code == 1009)
            reason = "An endpoint is terminating the connection because it has received a message that is too big for it to process.";
        else if(event.code == 1010) // Note that this status code is not used by the server, because it can fail the WebSocket handshake instead.
            reason = "An endpoint (client) is terminating the connection because it has expected the server to negotiate one or more extension, but the server didn't return them in the response message of the WebSocket handshake. <br /> Specifically, the extensions that are needed are: " + event.reason;
        else if(event.code == 1011)
            reason = "A server is terminating the connection because it encountered an unexpected condition that prevented it from fulfilling the request.";
        else if(event.code == 1015)
            reason = "The connection was closed due to a failure to perform a TLS handshake (e.g., the server certificate can't be verified).";
        else
            reason = "Unknown reason";

        if (reason == "Unknown reason") {
            this.endpoint.track("text-success", "close()");
        } else {
            this.endpoint.track("text-danger", "Error [" + event.code + "] " + reason);
        }
    };
    tester.prototype.onMessageHandle = function (evt) {
        var json = JSON.parse(evt.data);

        var self = this.endpoint;


        if (self.casino) {
            self.onCasinoWorkflow(json, this);
        } else if (self.video) {
            self.onVideoWorkflow(json, this);
        } else {
            this.close();
        }

    };
    tester.prototype.onVideoWorkflow = function (json, ws) {
        
    };
    tester.prototype.onCasinoWorkflow = function (json, ws) {
        var str;
        var self = this;
        switch (json.action) {
            case "ready": {
                if (typeof this.sid == "undefined" && typeof this.game == "undefined") {
                    ws.close();
                    return;
                }
                this.track("text-success","Info [ OK ] ready. " + (new Date().getTime() - this.ts) + "ms");
                this.ts = new Date().getTime();
                str = JSON.stringify({"action":"loginBySid","sid":this.sid,"gtype":this.game});
                break;
            }
            case "onLogin": {
                self.onLogin = true;
                if (self.onLogin && self.onTakeMachine) {
                    str = JSON.stringify({"action":"onLoadInfo2"});
                    this.ts = new Date().getTime();
                } else {
                    if (json.event) {
                        this.track("text-info","Info [Pending] onLogin:" + this.onLogin + ", onTakeMachine: " + this.onTakeMachine + ". " + (new Date().getTime() - this.ts) + "ms");
                    } else {
                        this.track("text-danger","Error [" + json.result.ErrorID + "] errCode:" + json.result.errCode + ". " + (new Date().getTime() - this.ts) + "ms");
                    }
                }
                break;
            }
            case "onTakeMachine": {

                if (json.result.event == true) self.onTakeMachine = true;
                if (self.onLogin && self.onTakeMachine) {
                    str = JSON.stringify({"action":"onLoadInfo2"});
                    this.ts = new Date().getTime();
                } else {
                    this.track("text-info","Info [Pending] onLogin:" + this.onLogin + ", onTakeMachine: " + this.onTakeMachine + ". " + (new Date().getTime() - this.ts) + "ms");
                }
                break;
            }
            case "onGetMachineDetail": {
                this.track("text-success","Info [ OK ] onGetMachineDetail. " + (new Date().getTime() - this.ts) + "ms");
                ws.close();
            }
        }
        if (typeof str != "undefined") ws.send(str);
    };
    tester.prototype.track = function (state, str) {
        var e = "<div class='media'>";
        if (state == "text-success")
        {
            e += '<div class="media-left"><span class="fa-stack fa-lg"><i class="fa fa-circle-thin fa-stack-2x text-success"></i><i class="fa fa-check fa-stack-1x fa-fw text-success"></i></span></div>';
        } else if (state == "text-info") {
            e += '<div class="media-left"><span class="fa-stack fa-lg"><i class="fa fa-circle-thin fa-stack-2x text-info"></i><i class="fa fa-info fa-stack-1x fa-fw text-info" style="margin-top: -1px;"></i></span></div>';
        } else if (state == "text-danger") {
            e += '<div class="media-left"><span class="fa-stack fa-lg"><i class="fa fa-circle-thin fa-stack-2x text-danger"></i><i class="fa fa-close fa-stack-1x fa-fw text-danger" style="margin-top: -1px;"></i></span></div>';
        } else if (state == "text-warning") {
            e += '<div class="media-left"><span class="fa-stack fa-lg"><i class="fa fa-circle-thin fa-stack-2x text-warning"></i><i class="fa fa-exclamation fa-stack-1x fa-fw text-warning"></i></span></div>';
        } else {
            e += '<div class="media-left"><span class="fa-stack fa-lg"><i class="fa fa-circle-thin fa-stack-2x text-muted"></i><i class="fa fa-minus fa-stack-1x fa-fw text-muted"></i></span></div>';
        }


        e += "<div class='media-body'><span>" + str + "</span></div></div>";

        this.print.append(e);

    };

    class pageControl {
        constructor(name) {
            this.init(name);
        }
        init(name) {
            let items = {
                previous:''
            }
            //previous
            $(".proc-nav-page ul li:first").click(() => {
                console.log('click-first');
            });
            $(".proc-nav-page ul li:nth-child(2)").click(() => {
                console.log('click+1');
            });
            $(".proc-nav-page ul li:nth-child(3)").click(() => {
                console.log('click+2');
            });
            $(".proc-nav-page ul li:nth-child(4)").click(() => {
                console.log('click+3');
            });
            $(".proc-nav-page ul li:last-child").click(() => {
                console.log('click-last-child');
            });
            //next

        }
    }

    return {
        logger:logger,
        connect: connect,
        AssignMenus:AssignMenus,
        tools:tools,
        lbTable:lbTable,
        chartJS:chartJS,
        alert:alert,
        iChart:iChart,
        control:control,
        tester: tester,
        Schedule: Schedule,
        pageControl: pageControl
    }

})();

/*
 var opts = {
 lines: 1000, // The number of lines to draw
 angle: 0.0, // The length of each line
 lineWidth: 0.1, // The line thickness
 pointer: {
 length: 0.9, // The radius of the inner circle
 strokeWidth: 0.035, // The rotation offset
 color: '#0D0D0D' // Fill color
 },
 limitMax: 'false',   // If true, the pointer will not go past the end of the gauge
 colorStart: '#6FADCF',   // Colors
 colorStop: '#8FC0DA',    // just experiment with them
 strokeColor: '#E0E0E0',   // to see which ones work best for you
 generateGradient: true
 };
 var target = document.getElementById('foo'); // your canvas element
 var gauge = new Gauge(target).setOptions(opts); // create sexy gauge!
 gauge.maxValue = 100; // set max gauge value
 gauge.animationSpeed = 32; // set animation speed (32 is default value)
 gauge.set(50); // set actual value
 */