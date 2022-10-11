
var componentKit = (function ()
{
    /**
     * @constructor
     */
    class ISelect2 {
        constructor(id) {
            this.id = id;
            this.iSelect = $(`#${id}`);
            this.choose = {
                version: '',
                value: ''
            };
        }
        get selected() {
            // return document.getElementById(this.id).value.split(":")[0];
            return this.choose.value;
        }
        set selected({id, title}) {
            this.choose.value = id;
            this.choose.title = title;
            console.log(`value -> `, this.choose);
        }
        get version() {
            return this.choose.title;
        }
        get chose() {
            return (typeof $.cookie(this.id) != "undefined");
        }
        create(selectOptions) {
            let { iSelect, id } = this;
            let customize = true;
            let cookie = $.cookie(id);
            let el;
            for (let [cls, {label, data}] of selectOptions.entries()) {
                el = iSelect.append(this.createOptgroup(cls, label));
                data.forEach((item) => {
                    let op = new Option(item[0], item[1], false);
                    op.title = item[2] || "v1";
                    el.append(op);
                    if (item[1] == cookie) customize = false;
                })
            }
            if (this.chose && customize) {
                this.addOption($.cookie(id));
            }
            return this;
        }
        addOption(value) {
            let { iSelect } = this;
            let el = iSelect.append(this.createOptgroup('Customize', 'Customize'));
            let op = new Option(value, value, false);
            op.title = 'v1';
            el.append(op);
            return this;
        };
        createOptgroup(cls, label) {
            return `<optgroup class="${cls}" label="${label}"></optgroup>`
        };
        load() {
            let { iSelect, id } = this;
            iSelect.select2({tags: true}).on('select2:select', (e) => {
                var data = e.params.data;
                var videoSrv = (data.text.indexOf("HK") != -1 || data.text.indexOf("TPE") != -1);
                $.cookie("videoSrv", videoSrv);
                this.selected = data;
                $.cookie(id, data.id);
            });
            if (this.chose) {
                iSelect.val($.cookie(id)).change();
                this.selected = iSelect.select2('data')[0];
            }
            return this;
        };
    }
    class IDispatch {
        constructor () {
            this._listeners = {};
        }
        addListener(type, listener) {
            if (typeof this._listeners[type] == "undefined"){
                this._listeners[type] = [];
            }
            this._listeners[type].push(listener);
        }
        dispatchEvent(event, data) {
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
        }
        removeListener(type, listener) {
            if (this._listeners[type] instanceof Array){
                var listeners = this._listeners[type];
                for (var i=0, len=listeners.length; i < len; i++){
                    if (listeners[i] === listener){
                        listeners.splice(i, 1);
                        break;
                    }
                }
            }
        }
    }
    class IConnect extends IDispatch {
        constructor(url, protocol) {
            super()
            this.responder  = new Map();
            this.url        = url;
            this.protocol   = this.getProtocol(url, protocol);
            this.binaryType = "arraybuffer";
            this.tokenId    = 0;
            this.interval   = null;
            this.onComplete = null;
            this.isClosed   = false;
            this._ready     = false;
            this.awaitReady = null;
            this.count      = 0;
            this.isAuthEnabled = false;
            this.__types    = this.__enums({});
            this.status     = this.StatusTypes.unknown;
        };
        static regularIPv4(input) {
            let accept = input.match(/^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/g);
            if (accept != null) {
                return accept.toString();
            } else {
                return '';
            }
        }
        /**
         *
         * @param types
         * @return {*}
         * @private
         */
        __enums(types) {
            types[types["unknown"] = 0] = "unknown";
            types[types["connected"] = 1] = "connected";
            types[types["not_authorized"] = 2] = "not_authorized";
            return types;
        }
        get StatusTypes() {
            return this.__types;
        }
        set ready(value) {
            this._ready = value;
            if (this.awaitReady) this.awaitReady(this._ready);
        }
        get ready() {
            return this._ready;
        };
        /**
         * 登入狀態
         * @return {string}
         */
        getStatus() {
            return this.StatusTypes[this.status];
        };
        setStatus(bool) {
            if (bool) {
                this.status = this.StatusTypes.connected;
            } else {
                this.status = this.StatusTypes.not_authorized;
            }
        };
        getProtocol(url, protocol) {
            if (typeof protocol == "string") return protocol;
            if (url.indexOf(":80/") != -1 ||
                url.indexOf(":8000/") != -1 ||
                url.indexOf(":443/") != -1 ||
                url.indexOf(":1935/") != -1) return "admin";
            else
                return protocol;
        };
        createConnect() {
            return new Promise((resolve) => {
                let ws = new WebSocket(this.url, this.protocol);
                ws.binaryType = this.binaryType;
                ws.onopen = () => {
                    resolve(ws);
                    this.isClosed = false;
                }
                ws.onclose = (err) => {
                    resolve(false);
                    this.onClosed(err);
                }
                ws.onerror = (err) => {
                    resolve(false);
                }
                ws.onmessage = this.onMessage.bind(this);
            });
        };
        onClosed(error) {
            console.log(`onClosed`, error);
            if (this.isClosed == false) {
                this.stopAuto();
                this.alertDisconnect();
            }
            this.isClosed = true;
            this.ready = false;
        };
        onMessage(event) {
            let json = JSON.parse(event.data);
            let tokenId = json.tokenId || -1;
            if (this.responder.has(tokenId)) {
                this.responder.get(tokenId)(json);
                this.responder.delete(tokenId);
            } else {
                let { event } = json;
                if (event == "liveLog") {
                    this["complete"](json["event"],json);
                } else {
                    let data = json["data"] || json;
                    this["complete"](json["event"], data, json["action"]);
                }
                if (event === 'ready') {
                    this.ready = true;
                }
            }

        };
        complete(event, data, action) {
            this.dispatchEvent({
                type:"complete",
                event:event,
                data:data,
                action:action
            });
        }
        isReady() {
            return new Promise((resolve) => {
                this.awaitReady = resolve;
            });
        };
        async send(obj) {
            return new Promise((resolve) => {
                let json;
                let tokenId = "/" + this.tokenId++;
                if (typeof obj == "string") {
                    json = JSON.parse(obj);
                } else {
                    json = obj;
                }
                json.tokenId = tokenId;

                if (typeof json != "string") {
                    json = JSON.stringify(json);
                }
                if (this.ws.readyState == 3) {
                    this.onClosed();
                } else {
                    this.ws.send(json);
                    this.responder.set(tokenId, function (result) { resolve(result); });
                }

            });
        };
        submit(obj) {
            let json = JSON.stringify(obj);
            this.ws.send(json);
        };
        async start() {
            let res = await this.createConnect();
            if (res == false) {
                $("#srvConnect").attr('class', 'btn btn-danger');
                $("#srvConnect").prop( "disabled", false );
                return false;
            } else {
                $("#srvConnect").attr('class', 'btn btn-success');
                $("#srvConnect").prop( "disabled", true );
                this.ws = res;
                return true;
            }
        };
        stop() {
            this.ws.close();
        };
        async load(onComplete) {
            let data = await this.getServiceInfo();
            onComplete(data);
            if (data.result) {
                this.startAuto(onComplete, 5000);
            }
        }
        startAuto(complete, sec) {
            this.onComplete = {
                block: complete,
                sec: sec
            };
            clearInterval(this.interval);
            this.interval = setInterval(async () => {
                complete(await this.getServiceInfo());
                if (this.count%2 == 0) complete(await this.getDashboardInfo());
                if (this.count%10 == 0) complete(await this.getSysInfo());
                this.count++;
            }, sec);
        };
        stopAuto() {
            clearInterval(this.interval);
        };
        async startAuthenticate({onComplete, token}) {
            let { isAuthEnabled } = this;
            if (isAuthEnabled) {
                if (token == '') return false;
                let res_login = await this.login(token);
                if (!res_login.result) {
                    return false;
                }
            }
            await this.load(onComplete);
            return true;
        }
        alertDisconnect() {
            let timerInterval;
            let timer = 60000;
            swal.fire({
                // icon:'info',
                html: `<br>
                <i style="font-size: xxx-large" class="fa-solid fa-spinner fa-spin-pulse"></i>
                <br><br>
                Manager has encountered an error.<br> 
                Retrying in <b>${Math.floor(timer/1000)}</b> seconds`,
                cancelButtonText: 'abort',
                showCancelButton: true,
                showConfirmButton: false,
                timerProgressBar: false,
                timer: timer,
                didOpen: () => {
                    // Swal.showLoading()
                    const b = Swal.getHtmlContainer().querySelector('b')
                    timerInterval = setInterval(() => {
                        b.textContent = Math.floor(Swal.getTimerLeft()/1000);
                    }, 1000)
                },
                willClose: () => {
                    clearInterval(timerInterval)
                }
            }).then(async (result) => {
                if (result.dismiss != 'cancel') {
                    await this.start();
                    if (this.onComplete) {
                        let { block, sec } = this.onComplete;
                        this.startAuto(block, sec);
                    }
                }
            })
        };
        /** 服務資訊 **/
        async getServiceInfo() {
            return await this.send({action: "getServiceInfo"});
        };
        async getSysInfo() {
            return await this.send({
                action: 'getSysInfo'
            });
        };
        async getDashboardInfo() {
            return await this.send({
                action: 'getDashboardInfo'
            });
        };
        async login(token) {
            let data = await this.send({
                action: 'login',
                token: token
            });
            this.setStatus(data.result);
            return data;
        };
        /** 新增服務 **/
        async addCluster(params) {
            let {file, assign, memory, options} = params;
            if (!memory) memory = 1024;
            if (!file) return {result: false, error: "notFoundName"};
            if (!assign && !options.rules) return {result: false, error: "notAssignName"};
            return await this.send({action: "addCluster","data": {file, assign, memory, options}});
        };
        /** 編輯指定名單規則 **/
        async editCluster({oAssign, nAssign, options}) {
            if (!oAssign || !nAssign) return {result: false, error: "notAssignName"};
            return await this.send({action: "editCluster", data: arguments[0]})
        };
        async killCluster({pid, trash}) {
            if (typeof pid == "number") {
                return await this.send({action: "killCluster","data":{pid, trash}});
            } else {
                return {result: false, error: "pid has null"}
            }
        };
        async restartCluster({assign, pid, gracefully}) {
            return await this.send({
                action: 'restartCluster',
                data: {
                    pid,
                    name: assign,
                    gracefully
                }
            });
        };
        async restartMultiCluster(data) {
            return await this.send({
                action: 'restartMultiCluster',
                data
            });
        };
        async kickout({pid, trash, params}) {
            return await this.send({
                action: 'kickoutToPID',
                data: {
                    pid,
                    trash,
                    params
                }
            });
        };
        async ipcMessage({pid, params}) {
            return await this.send({
                action: 'ipcMessage',
                data: {
                    pid,
                    params
                }
            });
        };
        async getMetadata() {
            return await this.send({
                action: 'getMetadata'
            });
        };
        /** 讀取pid服務log資訊 **/
        async liveLog({name, bool}) {
            return await this.send({
                action: 'liveLog',
                data: {name, bool}
            });
        };
        liveLog_v1({name, bool}) {
            let event = (bool ? 'liveLog' : 'leaveLog');
            this.submit({
                event,
                data:[name]
            });
        };
        /** 該服務關閉禁止使用者連入 **/
        async refuseUser({pid, trash, lock}) {

            return await this.send({
                action: 'refuseUser',
                data: {pid, trash, lock}
            });
        };
        async getLBGamePath() {
            return await this.send({
                action: 'getLBGamePath'
            });
        };
        async setLBGamePath(data) {
            return await this.send({
                action: 'setLBGamePath',
                data
            });
        };
        async getAMFConfig() {
            return await this.send({
                action: 'getAMFConfig'
            });
        };
        async setAMFConfig(data) {
            return await this.send({
                action: 'setAMFConfig',
                data
            });
        };
        async setLogLevel({pid, lv}) {
            return await this.send({
                action: 'setLogLevel',
                data: {pid, lv}
            });
        };
        async blockAll(bool) {
            return await this.send({
                action: 'blockAll',
                data: {bool}
            });
        }

        async getIPFilter() {
            return await this.send({
                action: 'getIPFilter'
            });
        };
        async setIPFilter({ip, state}) {
            console.log('setIPFilter', ip, state);
            return await this.send({
                action: 'setIPFilter',
                data: {ip, state}
            });
        };
        async startWarp({from, togo, that}) {
            return await this.send({
                action: 'startWarp',
                data: {from, togo, that}
            });
        };
        async getPods() {
            return await new Promise((element) => {
                element({
                    result: false,
                    error: "not implemented"
                });
            });
        };
        async getSchedule() {
            return await this.send({ action: 'getSchedule' });
        }
        async addSchedule(data) {
            return await this.send({
                action: 'addSchedule',
                data: data
            })
        }
        async cancelSchedule(data) {
            return await this.send({
                action: 'cancelSchedule',
                data
            })
        }
        async command(action, data) {
            return await this.send({action, data});
        }
        async createSmsManager() {
            return await this.send( { action: 'createUDPManager'} );
        }
        clear() {
            this.onComplete = null;
        }
    }
    class IFetcher {
        static login_token() {
            let token = $.cookie("token");

            if (token) {
                return token;
            } else {
                return "";
            }
        }
        constructor(delegate, options) {
            this.delegate = delegate;
            this.options = { appid: '284vu86', scheme: 'http', port: 80, host: '127.0.0.1', route: '/octopus'};
            this.setupConnect(options);
        }
        setup({control}) {
            this.control = control;
        }
        setupConnect({host, port, scheme, appid}) {
            if (host) {
                this.options.host = host;
            }
            if (port) {
                this.options.port = port;
            }
            if (scheme) {
                this.options.scheme = scheme || 'http';
            }
            if (appid) {
                this.options.appid = appid || '284vu86';
            }
        }
        completionHandler(d) {
            if (!d) return false;
            let {event, data} = d;
            switch (event) {
                case "getServiceInfo":
                case "getClusterInfos":
                    break;

            }
        }
        getServiceInfo() {

        }
        getBearerToken() {
            let token = IFetcher.login_token();
            console.log(`token =>`, token);
            if (token) {
                return `Bearer ${token}`;
            } else {
                return "";
            }
        }
        //讀取資料夾清單
        async appSettingsDir(folder) {
            const {host, port, appid, route} = this.options;
            if (!folder) folder = '';
            let path = `http://${host}:${port}${route}/dir/${folder}`;
            const authorization = this.getBearerToken();
            const resolve = await fetch(path, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    appid: appid,
                    authorization
                }
            });
            return await resolve.json();
        };
        //讀取檔案
        async appSettingsFile({filename, folder}) {
            const {host, port, appid, route} = this.options;
            if (filename) {
                filename = `/${filename}`;
            } else {
                filename = ""
            }
            if (!folder) folder = '';
            let path = `http://${host}:${port}${route}/dir/${folder}${filename}`;
            const authorization = this.getBearerToken();
            const resolve = await fetch(path, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    appid: appid,
                    authorization
                }
            });
            return await resolve.json();
        };
        //儲存檔案
        async appSettingsSave({filename, folder}, data) {
            const {host, port, appid, route} = this.options;
            if (filename) {
                filename = `/${filename}`;
            } else {
                filename = ""
            }
            if (!folder) folder = 'appsettings';
            let path = `http://${host}:${port}${route}/dir/${folder}${filename}`;
            const authorization = this.getBearerToken();
            const resolve = await fetch(path, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    appid: appid,
                    authorization
                },
                body: JSON.stringify({data})
            });
            return await resolve.json();
        };
        async login({username, password}) {
            let {host, port, scheme, appid, route} = this.options;
            let path = `${scheme}://${host}:${port}${route}/user/login`;
            let aes = new IEncoder();
            const userLogin = await fetch(path, {
                method: 'POST',
                body: JSON.stringify({
                    username,
                    password: aes.encryption(password)
                }),
                headers: {
                    'Content-Type': 'application/json',
                    appid: appid
                }
            });
            return await userLogin.json();
        };

        async logout({username}) {
            let {host, port, scheme, appid, route} = this.options;

            let path = `${scheme}://${host}:${port}${route}/user/logout`;
            const userLogout = await fetch(path, {
                method: 'POST',
                body: JSON.stringify({ username }),
                headers: {
                    'Content-Type': 'application/json',
                    appid: appid
                }
            });
            return await userLogout.json();
        }
        async getMetadata() {
            const {host, port, scheme, appid, route} = this.options;
            let path = `${scheme}://${host}:${port}${route}/process/sys/metadata`;
            const authorization = this.getBearerToken();
            const resolve = await fetch(path, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    appid: appid,
                    authorization
                }
            });
            return await resolve.json();
        }
    }
    class IConnectAdapter {
        constructor() {
            this.admin = null;
            this.manager = null;
            this.version = "v1";
            this.completed = null;
        }
        get isConnected() {
            return ($("#srvConnect").attr( "disabled") == 'disabled');
        }
        get isAuthEnabled() {
            if (this.version == 'v2') {
                return this.manager.isAuthEnabled;
            } else {
                return false;
            }
        }
        get status() {
            if (this.version == 'v2') {
                return this.manager.getStatus();
            } else {
                return false;
            }
        }
        setVersion({v1, v2, version, completed}) {
            this.admin = v1;
            this.manager = v2;
            this.version = version;
            this.completed = completed;
            this.timer = 0;
            this.clockTimer = undefined;


            if (this.version == 'v1' && typeof v1 == "undefined") {
                this.version = 'v2';
            } else if (this.version == 'v2' && typeof v2 == "undefined") {
                this.version = 'v1';
            }
        }
        stop() {
            const {version} = this;
            if (version === "v1") {

            } else {
                this.manager.stopAuto();
            }
            this.stopHeartbeat();
        };
        start() {
            const {version} = this;
            if (version === "v1") {
                // ==== init load config ==== //
                this.getSysInfo();
                // ========================== //
                this.startHeartbeat();
            } else {
            }

        };
        startAuthenticate({onComplete, token}) {
            if (this.version == 'v2') {
                return this.manager.startAuthenticate({onComplete, token});
            } else {
                return false;
            }
        }
        initLoadConfig() {
            // ==== init load config ==== //
            this.getSysInfo();
            // ========================== //
        };
        startHeartbeat() {
            if (this.clockTimer) clearInterval(this.clockTimer);
            this.clockTimer = setInterval(() => {
                this.timer++;
                if (this.timer == 180) {
                    this.timer = 0;
                }
                this.getSysInfo();
            }, 10000);
            return this;
        }
        stopHeartbeat() {
            clearInterval(this.clockTimer);
        }

        async getClusterInfos() {
            if (this.version === "v1") {
                this.admin.getClusterInfos();
            } else {
                let data = await this.manager.getServiceInfo();
                this.completed(data);
                return data;
            }
        }
        async getSysLog() {
            if (this.version === "v1") {
                this.admin.getSysLog();
            } else {
                let data = await this.manager.getDashboardInfo();
                this.completed(data);
            }
        }
        async getSysInfo() {
            if (this.version === "v1") {
                this.admin.getSysInfo();
            } else {
                let data = await this.manager.getSysInfo();
                this.completed(data);
            }
        }
        async getDashboardInfo() {
            if (this.version === "v1") {
                this.admin.getDashboardInfo();
            } else {
                let data = await this.manager.getDashboardInfo();
                this.completed(data);
            }
        }
        async getLBGamePath() {
            if (this.version === "v1") {
                this.admin.getLBGamePath();
            } else {
                let data = await this.manager.getLBGamePath();
                console.log('data', data);
                this.completed(data);
            }
        }
        async setLBGamePath(saveData) {
            if (this.version === "v1") {
                this.admin.setLBGamePath(saveData);
            } else {
                let data = await this.manager.setLBGamePath(saveData);
                if (this.completed) {
                    this.completed(data);
                }
            }
        };
        async getAMFConfig() {
            if (this.version == 'v1') {
                this.admin.getAMFConfig();
            } else {
                let data = await this.manager.getAMFConfig();
                this.completed(data);
            }
        }
        async setAMFConfig(saveData) {
            if (this.version == 'v1') {
                this.admin.setAMFConfig(saveData);
            } else {
                let data = await this.manager.setAMFConfig(saveData);
                this.completed(data);
            }
        }
        async restartCluster(assign, pid, gracefully) {
            console.log('restartCluster', this.version, assign, pid);
            if (this.version === "v1") {
                this.admin.restartCluster(assign, pid);
            } else {
                let data = await this.manager.restartCluster({assign, pid, gracefully});
                console.log('restartCluster', data);
                if (this.completed) this.completed(data);
            }
        }
        async restartMultiCluster(group, delay, deploy) {
            if (this.version === "v1") {
                this.admin.restartMultiCluster(group);
            } else {
                let data = await this.manager.restartMultiCluster({group, delay, deploy});
                if (this.completed) this.completed(data);
            }
        }
        async restartSys() {
            return true;
        }
        async killClusterToPID(pid, trash) {
            if (this.version === "v1") {
                this.admin.killClusterToPID(pid);
            } else {
                let data = await this.manager.killCluster({pid, trash});
                data.pid = pid;
                if (this.completed) this.completed(data);
            }
        }
        async refuseUser2PID(pid, lock) {
            if (this.version === "v1") {
                this.admin.refuseUser2PID(pid, lock);
            } else {
                let data = await this.manager.refuseUser({pid, lock});
                if (this.completed) this.completed(data);
            }
        }
        async blockAll(lock, pid) {
            if (this.version === "v1") {
                this.admin.lockConnection(lock);
            } else {
                let data = await this.manager.blockAll(lock);
                if (this.completed) this.completed(data);
            }
        }
        async kickout(pid, trash, params) {
            if (this.version === "v1") {
                this.admin.kickout(pid, trash, params);
            } else {
                let data = await this.manager.kickout({pid, trash, params});
                if (this.completed) this.completed(data);
            }
        }
        async ipcMessage(pid, params) {
            if (this.version === "v1") {
                this.admin.ipcMessage(pid, params);
            } else {
                let data = await this.manager.ipcMessage({pid, params});
                if (this.completed) this.completed(data);
            }
        }
        async editCluster(oAssign, nAssign, options, pid) {
            if (this.version === "v1") {
                this.admin.editCluster(oAssign, nAssign);
            } else {
                let data = await this.manager.editCluster({oAssign, nAssign, options, pid});
                console.log('editCluster:', data);
                if (this.completed) this.completed(data);
            }
        }
        async addCluster(file, assign, memory, options) {
            if (this.version === "v1") {
                this.admin.addCluster(file, assign, memory, options);
            } else {

                let data = await this.manager.addCluster({file, assign, memory, options});
                if (this.completed) this.completed(data);
            }
        }
        async setLogLevel(pid, params) {
            if (this.version === "v1") {
                this.admin.setLogLevel(pid, params);
            } else {
                let data = await this.manager.setLogLevel({pid, lv: params.lv});
                if (this.completed) this.completed(data);
            }
        }
        async getAssign() {
            if (this.version === "v1") {
                this.admin.getAssign();
            } else {

            }
        }
        async deleteAssign(assign) {
            if (this.version === "v1") {
                this.admin.deleteAssign(assign);
            } else {

            }
        }
        async joinPod(value) {
            if (this.version === "v1") {
                this.admin.joinPod(value);
            } else {
            }
        }
        async startWarp({from, togo, that}) {
            if (this.version === "v1") {
                this.admin.hotUpdate(from, {
                    togo,
                    togoKey: that
                });
            } else {
                let data = await this.manager.startWarp(arguments[0]);
                if (this.completed) this.completed(data);
            }
        }
        async setIPFilter(value, bool) {
            if (this.version === "v1") {
                this.admin.setIPFilter(value, bool);
            } else {
                let data = await this.manager.setIPFilter({
                    ip: value,
                    state: (typeof bool == "boolean") ? bool : false
                });
                if (this.completed) this.completed(data);
            }
        }
        async getIPFilter() {
            if (this.isConnected == false) return Swal.fire({ icon: 'warning', title: 'Not connected'});
            if (this.version === "v1") {
                this.admin.getIPFilter();
            } else {
                let data = await this.manager.getIPFilter();
                if (this.completed) this.completed(data);
            }
        }
        async getSchedule() {
            if (this.version === "v1") {
                this.admin.getSchedule();
            } else {
                let data = await this.manager.getSchedule();
                console.log('getSchedule:', data);
                if (this.completed) this.completed(data);
            }
        }
        async addSchedule(values) {
            if (this.version === "v1") {
                this.admin.addSchedule.apply(this.admin, arguments);
            } else {
                let data = await this.manager.addSchedule(values);
                console.log('addSchedule:', data);
                if (this.completed) this.completed(data);
            }
        }
        async cancelSchedule(id) {
            if (this.version === "v1") {
                this.admin.cancelSchedule.apply(this.admin, arguments);
            } else {
                let data = await this.manager.cancelSchedule(id);
                console.log('cancelSchedule:', data);
                if (this.completed) this.completed(data);
            }
        }
        async smsManager() {
            if (this.version === 'v1') {

            } else {
                return await this.manager.createSmsManager();
            }
        }
        async wait(sec) {
            return new Promise((resolve) => {
                setTimeout(() => {
                    resolve()
                }, sec * 1000);
            })
        }

    }
    class IViewControl {
        constructor(delegate) {
            this.token = null;
            this.delegate = delegate;
            this.infoSample = undefined;
            this.iFetchManger = new IFetcher(this, {
                host: "127.0.0.1",
                port: 8000,
                appid: '284vu86'
            });
            this.target = null;
            this.editor = new Map();
            this.currentFile = null;
            this.mAdapter = null;
            this.setup();
        }
        popup({icon, title, text}) {
            const Toast = Swal.mixin({
                toast: true,
                position: 'top-center',
                showConfirmButton: false,
                timer: 2000,
                timerProgressBar: true,
                didOpen: (toast) => {
                    toast.addEventListener('mouseenter', Swal.stopTimer)
                    toast.addEventListener('mouseleave', Swal.resumeTimer)
                }
            })

            Toast.fire({ icon, title, text });
        }
        setup() {
            //Settings Panel 設定
            $('#sch-pan-tabs a').click(async (e) => {
                const href = $(e.target).attr('href');
                this.target = $(`#${href.substr(1)}`);
                switch (href) {
                    case '#tab-app':
                    case '#tab-conf':
                        let folder = '';
                        if (href == '#tab-conf') folder = 'configuration';
                        let {result, code, message, data, error} = await this.appSettings({folder});
                        if (result) {
                            let select = this.target.find('.app-settings-dir');
                            select.empty();
                            data.forEach((value) => {
                                select.append(new Option(value, value));
                            })

                        } else if (code) {
                            this.popup({ icon: 'error', title: code, text: message});
                        } else {
                            this.popup({ icon: 'error', title: error});
                        }
                        break;
                    case "#tab-sms":
                        if (this.mAdapter) {
                            let {group} = await this.mAdapter.smsManager();
                            console.log(`tab-sms`, group);
                            if (group) {
                                if (this.sms_table) this.sms_table.destroy();
                                this.sms_table = $('#sms-table-display').DataTable({
                                    data: group,
                                    columns: [
                                        { title: 'hostname'},
                                        { title: 'port'},
                                        { title: 'ip'}
                                    ],
                                    deferRender:true
                                });
                            }
                        } else {
                            Swal.fire({ icon: 'warning', title: 'Not connected'})
                            // this.popup({ icon: 'error', title: 'Not connected'});
                        }
                        break;
                }
            });
            $('.app-settings[name=open]').click(async () => {
                if (!this.target) return console.log("target null");
                const filename = this.target.find('.app-settings-dir').val();
                let folder = 'appsettings';
                let id = this.target.attr('id');
                if (id == 'tab-conf') folder = 'configuration';
                let {result, code, message, data, error} = await this.appSettings({filename, folder});
                if (result) {
                    const { editor } = this;

                    if (!editor.has(id)) {
                        editor.set(id, new JsonEditor(`#json-display-${id}`, data));
                    } else {
                        editor.get(id).load(data);
                    }
                    this.currentFile = filename;
                } else if (code) {
                    this.popup({ icon: 'error', title: code, text: message});
                } else {
                    this.popup({ icon: 'error', title: error});
                }
            });
            $('.app-settings[name=save]').click(async () => {
                const { editor, currentFile, delegate, target } = this;
                if (!target) return console.log("target null");
                let folder = '';
                let id = this.target.attr('id');
                if (id == 'tab-conf') folder = 'configuration';
                let jsonDisplay = editor.get(target.attr('id'));
                if (jsonDisplay) {
                    let {result, code, message, error} = await this.appSettingsSave({
                        filename: currentFile,
                        folder
                    }, jsonDisplay.get());
                    if (result) {
                        this.popup({ icon: 'success', title: 'Completed'});
                    } else if (code) {
                        this.popup({ icon: 'error', title: code, text: message});
                    } else {
                        this.popup({ icon: 'error', title: error});
                    }


                }
            })

        }
        loginBtn(mAdapter) {
            $("#btn-logout").hide();
            $.cookie("token", '');
            $("#btn-login").click(async () => {
                $("#user_login").modal("show");
            });
            $("#btn-logout").click(async () => {
                let respond = await this.iFetchManger.logout({
                    username: $('#username').val()
                });
                $("#btn-logout").hide();
                $("#btn-login").show();
                $.cookie("token", '');
                // location.reload();
            });

            $("#btn-login-submit").click(async () => {
                $("#user_message").empty();
                //let host = document.getElementById('ipAddress').value;
                const username = $('#username').val();
                const password = $('#password').val();

                let respond = await this.iFetchManger.login({ username, password });

                if (!respond.result) {
                    // alert("Internal error occurred: account is not active.")
                    $("#user_message").append(
                    '                    <div class="alert alert-danger">\n' +
                    '                        <strong>Danger!</strong> Invalid login name or password.\n' +
                    '                    </div>');
                    // Swal.fire({
                    //     icon: 'error',
                    //     title: 'Oops...',
                    //     text: 'Invalid login name or password'
                    // });
                } else {

                    this.token = respond.data.token;
                    $("#user_login").modal("hide");
                    $("#btn-login").hide();
                    $.cookie("token", this.token);
                    $.cookie("username", username);

                    this.popup({
                        icon: 'success',
                        title: 'Signed in successfully'
                    });
                    $("#btn-logout").show();
                    $("#btn-logout").attr('title', $('#username').val());
                    if (mAdapter) {
                        if (mAdapter.isAuthEnabled && mAdapter.status == 'not_authorized') {
                            mAdapter.startAuthenticate({onComplete: mAdapter.completed, token: this.token})
                        }
                        console.log(`isAuthEnabled: ${mAdapter.isAuthEnabled} status: ${mAdapter.status}`);
                    }
                }

                $('#username').val('');
                $('#password').val('');
            });
            return this;
        };
        setOptions({host, port}) {
            this.iFetchManger.setupConnect({host, port});
        };
        async appSettingsFolder(folder) {
            return await this.iFetchManger.appSettingsDir(folder);
        }
        async appSettings({filename, folder}) {
            if (filename) {
                return await this.iFetchManger.appSettingsFile({filename, folder});
            } else {
                return await this.iFetchManger.appSettingsDir(folder);
            }
        };
        async appSettingsSave({filename, folder}, data) {
            console.log(`appSettingsSave -> ${filename} ${folder}`);
            if (filename) {
                return await this.iFetchManger.appSettingsSave({filename, folder}, data);
            }
        };
        f2dbInfo(table) {
            $("#f2dbInfo").click(() => {
                $("#modal_process_info").modal("show");
                var body = $("#modal_process_info").find(".info-tbody");
                var child;
                if (typeof this.infoSample == "undefined")
                    this.infoSample = $("#modal_process_info").find(".info-tr").clone();
                body.empty();
                for (var i = 0; i < table.fl2dbArray.length; i++) {
                    child = this.infoSample.clone();
                    child.find(".info-id").html("#" + table.fl2dbArray[i].id);
                    child.find(".info-ar").html(table.fl2dbArray[i].name);
                    child.find(".info-add").html(table.fl2dbArray[i].f2db);
                    child.appendTo(body);
                }
            });
            return this;
        };
        download(content, fileName, contentType) {
            let a = document.createElement('a');
            let file = new Blob([content], {type: contentType});
            a.href = URL.createObjectURL(file);
            a.download = fileName;
            a.click();
        };
    }

    class IPagination {
        constructor() {
            this.pagination = null;
            this.pageNumber = 1;
            this.total = 1;
            this.current = null;
            this.onChange = null;
        }
        previous() {
            let { pagination } = this;
            let page = Math.max(this.pageNumber - 1, 1);
            let child = pagination.children()[page];
            return this.goto($(child), page);
        }
        next() {
            let { pagination } = this;
            let page = Math.min(this.pageNumber + 1, this.total);
            let child = pagination.children()[page];
            return this.goto($(child), page);
        }
        select(page) {
            let { pagination } = this;
            page = Math.max(Math.min(page, this.total), 1);
            let child = pagination.children()[page];
            return this.goto($(child), page);
        }
        goto(endpoint, page) {
            let prev = this.current;
            let bool = false;
            if (prev) {
                prev.toggleClass('active');
            }
            endpoint.toggleClass('active');
            bool = (this.pageNumber != page);
            this.pageNumber = page;
            this.current = endpoint;
            return bool;
        }
        onClick(container) {
            let endpoint = $(container);
            let label = endpoint.attr('aria-label');
            let bool = false;

            if (label == 'Previous') {
                bool = this.previous();
                // if (!bool) endpoint.parent().toggleClass('disabled');
            }
            else if (label == 'Next') {
                bool = this.next();
            }
            else {
                bool = this.select(Number.parseInt(label));
            }
            if (this.onChange instanceof Function && bool) {
                this.onChange(this.pageNumber);
            }
        }
        load(root, total) {
            const endpoint = this;
            this.pagination = $(root);
            this.total = total;
            let { pagination } = this;
            if (pagination.children().length != 0) {
                pagination.empty();
            }
            pagination.append(this.previousButton());
            for (let i = 1; i <= total; i++) {
                pagination.append(this.pageButton(i));
            }
            pagination.append(this.nextButton());

            pagination.find('.page-item > a').on('click', function () {
                endpoint.onClick(this);
            });

            let child = pagination.children()[this.pageNumber];
            this.current = $(child);
        };
        previousButton() {
            return `
            <li class="page-item">
                <a class="page-link" href="#" aria-label="Previous">
                    <span aria-hidden="true">&laquo;</span>
                    <span class="sr-only">Previous</span>
                </a>
            </li>`;
        };
        nextButton() {
            return `
            <li class="page-item">
                <a class="page-link" href="#" aria-label="Next">
                    <span aria-hidden="true">&raquo;</span>
                    <span class="sr-only">Next</span>
                </a>
            </li>
            `;
        };
        pageButton(value) {
            return `
                <li class="page-item ${this.pageNumber == value ? 'active': ''}"><a class="page-link" href="#" aria-label="${value}">${value}</a></li>
            `;
        };
    };

    class IDataTable {
        constructor(delegate) {
            this.delegate = delegate;
            this._manager = null;
            this.oPrefSettings = {
                memState: true,
                cpuState: true
            };
            this.root = null;
            this.table = null;
            this.items = new Map();
            this.template = null;
            this.db = [];
            this.src = [];
            this.fl2dbArray = [];
            this.hashTables = new Map();
            this.metadata = new Map();
            this.rows = 20;
            this.index = 0;
            this.history = new Map([
                ['cpu', []],
                ['ram', []]
            ]);
            //過濾用
            this.filterShow = null;
            this.slStyle = {
                type: 'line',
                lineColor: '#8cc152',
                fillColor: 'transparent',
                spotColor: "transparent",
                minSpotColor: "transparent",
                maxSpotColor: "transparent"
            };

            this.pagination = null;

            this.moveBottom = true; //live log

        }
        set manager(manager) {
            this._manager = manager;
            this.tracer = undefined;
        }
        get manager() {
            if (this._manager) {
                return this._manager;
            }
        }
        get threads() {
            return [...this.hashTables.values()];
        }
        get totalPages() {
            return Math.ceil(this.db.length / this.rows);
        }
        create(container) {
            this.root = $(container);
            this.template = this.root.find('.progress-tmp').clone();
            this.table = this.root.find('.list').empty();
            for (let i = 0; i < this.rows; i++) {
                this.table.append(this.createRow(this.template.clone(), i));
                let row = this.table.find(`.row-${i}`);
                let status = row.find('.pro-status');
                let time = row.find('.list-item-date');
                let assign = row.find('.pro-assign');
                let el_tags = row.find('.pro-hashtag');
                let cpu = row.find('.pro-cpu-usage');
                let cpu_history = row.find('.pro-cpu-history');
                let ram = row.find('.pro-memory-usage');
                let ram_history = row.find('.pro-memory-history');
                let el_count = row.find('.pro-count');
                let el_lock = row.find('.pro-lock');
                let filename = row.find('.pro-file');
                let subview = row.find('.pro-subview');
                let el_monitor = row.find('.pro-monitor');
                let el_metadata = row.find('.pro-metadata');
                let el_db = row.find('.pro-db');
                let item = {
                    row,
                    status,
                    time,
                    assign,
                    el_tags,
                    cpu,
                    cpu_history,
                    ram,
                    ram_history,
                    el_count,
                    el_lock,
                    filename,
                    subview,
                    el_monitor,
                    el_metadata,
                    el_db
                };
                this.items.set(`row-${i}`, item);
                this.event(row, item);
            }
            return this;
        };
        createRow(tmp, id) {
            tmp.removeClass('progress-tmp');
            tmp.addClass(`row-${id}`);
            tmp.attr('value', id);
            return tmp
        }
        update(src) {

            if (!Array.isArray(src)) return false;

            this.db = src;

            if (this.filterShow) {
                this.src = this.filter(this.filterShow, src);
            } else {
                this.src = this.db;
            }
            this.hashTables.clear();
            this.fl2dbArray.length = 0;
            src.forEach(({name, f2db, pid, memoryUsage, cpuUsage}, id) => {
                this.fl2dbArray.push({ id, name, f2db });
                if (name != 'octoproxy') {
                    this.hashTables.set(name, pid);
                }
                this.updateHistory(id, {memoryUsage, cpuUsage});
            });

            this.change();

            this.pageRefresh();

            return true;
        };
        /**
         * 搜尋
         * @param filterShow
         * @param {Array} src
         */
        filter(filterShow, src) {
            filterShow = filterShow.replace(/\s*/g,"");
            let split = filterShow.split(":");
            let rule;
            let column = "name";
            if (split[0] == "file") {
                column = "file";
                rule = split[1];
            } else {
                rule = filterShow;
            }
            return src.filter((data) => (data[column].indexOf(rule) != -1));
        }
        updateMetadata(src) {
            this.metadata = new Map(src);
        };
        updateHistory(index, {memoryUsage, cpuUsage}) {
            let ramMap = this.history.get('ram');
            if (!Array.isArray(ramMap[index])) ramMap[index] = [];
            let history = ramMap[index];

            let ram = (memoryUsage || {rss: 0}).rss;
            ram = ( ram / 1024 / 1024 ).toFixed(1);
            if (history.length > 8) history.shift();
            history.push(ram);

            let cpuMap = this.history.get('cpu');
            if (!Array.isArray(cpuMap[index])) cpuMap[index] = [];
            history = cpuMap[index];
            let value = Number(cpuUsage);
            if (isNaN(value)) value = 0;
            if (history.length > 8) history.shift();
            history.push(value);
        };
        change(page) {
            if (page) this.index = (page - 1);
            let { rows, src, index } = this;
            let start = index * rows;
            let ended = Math.min((index + 1) * rows, this.src.length);
            for (let i = 0; i < rows; i++) {
                let {
                    row,
                    status,
                    time,
                    assign,
                    filename,
                    el_lock,
                    el_count,
                    ram,
                    ram_history,
                    cpu,
                    cpu_history,
                    el_monitor,
                    el_metadata,
                    el_tags,
                    el_db,
                    subview
                } = this.items.get(`row-${i}`);
                if (start >= ended) {
                    row.attr('hidden', 'hidden');
                } else {
                    row.removeAttr('hidden');
                    let { pid, file, name, pkey, count, lock, complete, trash,
                        memoryUsage, uptime, cpuUsage, bitrates, lv,
                        payload, monitor, tags, f2db, rules
                    } = src[start];
                    row.attr('value', start++);
                    this.setStatus(status, complete, trash);
                    this.setUptime(time, uptime);
                    this.setAssign(assign, name);
                    this.tooltip(assign, name, rules)
                    this.setText(filename, file);
                    this.setHidden(el_lock, (lock == true));
                    this.setCount(el_count, count, payload);
                    this.setTags(el_tags, (i == 0) ? '' : tags);
                    if (!memoryUsage) memoryUsage = {rss: 0};
                    this.setMemory(ram, ram_history, memoryUsage.rss, this.history.get('ram')[i]);
                    this.setCPU(cpu, cpu_history, cpuUsage, this.history.get('cpu')[i]);
                    this.setBitRates(subview, {
                        title: 'Rates:',
                        values: bitrates
                    });
                    this.setSubInfo(el_monitor, monitor);
                    this.setSubInfo(el_metadata, this.metadata.get(pid));
                    this.setLogLevel(row, {lv}, this.manager);
                    this.setHostInfo(el_db, f2db);
                    this.ctrlButton(row);
                }
            }
        };
        event(el, item) {
            const self = this;

            //# Control Views open
            el.find(".list-item-trigger").click(() => {
                el.find(".list-item-controls").css("animation-name", "rightKeyframeIn");
            });
            //# Control Views close
            el.find(".list-item-controls > div > .chevron-right").click(function () {
                el.find(".list-item-controls").css("animation-name", "rightKeyframeOut");
                el.find(".list-item-controls").css("animation-play-state", "running");
            });

            let tachometer = el.find(".list-item-tachometer");
            tachometer.click(() => {
                var list = el.find(".list-tachometer");
                list.toggleClass("list-bitrates");
                if (list.attr("class").indexOf("list-bitrates") == -1) {
                    var len = list.find(".bitrates").children().length;
                    list.css("height", "auto");
                    list.css("display", "block");
                } else {
                    list.css("height", "");
                    list.css("display", "none");
                }
            });
            let monitorBtn = el.find('.list-item-monitor');
            monitorBtn.click(() => {
                let cMonitor = el.find('.pro-monitor');
                if (cMonitor.attr("class").indexOf("monitor-toggle") == -1) {
                    cMonitor.css("height", "auto");
                    cMonitor.css("display", "block");

                } else {
                    cMonitor.css("height", "0");
                    cMonitor.css("display", "none");
                }
                cMonitor.toggleClass('monitor-toggle');

                let cMetadata = el.find('.pro-metadata');

                if (cMetadata.attr("class").indexOf("metadata-toggle") == -1) {
                    cMetadata.css("height", "auto");
                    cMetadata.css("display", "block");

                } else {
                    cMetadata.css("height", "0");
                    cMetadata.css("display", "none");
                }
                cMetadata.toggleClass('metadata-toggle');

            });

            el.find('.list-item-cmd').click(() => {
                // $('#modal_process_info').modal('show')
            });

            //# Control process edit
            el.find(".list-item-controls > div > .pro-edited").click(function () {
                const { manager } = self;
                let index = el.attr("value");
                console.log(`Click edited index: ${index} => ${self.src[index].file}`);
                new IModalEditor().show(self.src[index], manager);
            });
            //# Control process restart
            var btnRestart = el.find(".list-item-controls > div > .pro-restart");
            var btnResetHandler = function btnResetHandler(gracefully) {
                const { manager } = self;
                let index = el.attr("value");
                var assign = self.src[index].name;
                var pid = self.src[index].pid;
                console.log("btnRestart(%s)", index, assign, gracefully);

                if (assign != 'octoproxy') {
                    manager.restartCluster(assign, pid, gracefully);
                }else {
                    manager.restartSys();
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
                const { manager } = self;
                let index = el.attr("value");
                let {pid, trash} = self.src[index];
                console.log("btnDeadHandler(%s)", index, pid);
                manager.killClusterToPID(pid, trash);
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
                const { manager } = self;
                let index = el.attr("value");
                let {lock, name, pid} = self.src[index];
                if (!lock) {
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
                self.src[index].lock = !lock;

                console.log('set dontDisconnect', name, !lock);

                if (name != 'octoproxy') {
                    manager.refuseUser2PID(pid, !lock);
                } else {
                    manager.blockAll(!lock);
                }

            };
            btnLock.bootstrap_confirm_delete({
                "heading":"Disconnect",
                "message":"Are your sure you want to do ?",
                "delete_callback":function (event) {
                    btnLockHandler.apply(event["data"]["originalObject"])
                }
            });
            //# Control process kick out user
            var btnKicOutHandler = function btnKicOutHandler() {
                const { manager } = self;
                let index = el.attr('value');
                let pid = self.src[index].pid;
                let trash = self.src[index].trash || false;
                let keys = el.find(".list-item-controls > div > .pro-kick-out-key").val() || "";
                keys = (Array.isArray(keys) ? keys : keys.split(","));
                console.log(`btnKickoutHandle (${index}) pid:${pid} => ${keys}`, index, pid, keys);
                manager.kickout(pid, trash, keys);
            };

            var btnKickOut = el.find(".list-item-controls > div > .pro-kick-out");
            btnKickOut.bootstrap_confirm_delete({
                "heading":"Cluster Kick Out Users Confirmation",
                "message":"Are your sure you want to Kick Out Users?",
                "delete_callback":function (event) {
                    btnKicOutHandler.apply(event["data"]["originalObject"])
                }
            });

            let btnRecycle = el.find(".list-item-controls > div > .game-recycle");
            btnRecycle.click(async () => {
                let { value: parameters, isDismissed } = await Swal.fire({
                    title: '自訂參數流程事件',
                    // text: '確定處理自訂參數流程？',
                    input: 'text',
                    inputLabel: 'Your customize URL parameters',
                    inputValue: '',
                    inputPlaceholder: 'You=Code&Key=Value',
                    showCancelButton: true,
                    customClass: {
                        actions: 'swal2-actions-2',
                        confirmButton: 'swal-sort-2',
                        cancelButton: 'swal-sort-1 right-gap',
                    }
                });
                if (isDismissed) return false;
                console.log(`ipcMessage parameters => ${ [...new URLSearchParams(parameters)]}`);
                const { manager } = self;
                let index = el.attr('value');
                let pid = self.src[index].pid;
                let trash = self.src[index].trash || false;
                manager.ipcMessage(pid, [...new URLSearchParams(parameters)]);
            })

            var btnHotReload = el.find(".list-item-controls > div > .pro-hotReload");

            var viewLog = el.find(".list-item-info");
            viewLog.click( () => {
                let index = el.attr('value');
                let pid = self.src[index].pid.toString();
                self.startTracerLog(pid);
                $("#modal_log_cluster").find(".modal-title").text("Process System Logger [" + self.src[index].name + "]");
                $("#modal_log_cluster").modal("show");
            });

        };
        ctrlButton(el) {
            let index = el.attr("value");
            let { file, lock, bitrates } = this.src[index];
            let btn1 = el.find(".list-item-controls > div > .pro-edited");
            let btn2 = el.find(".list-item-controls > div > .pro-delete");
            let btn3 = el.find(".list-item-controls > div > .pro-locked");
            let btn4 = el.find(".list-item-controls > div > .pro-kick-out");
            let btnLock = el.find(".list-item-controls > div > .pro-locked");
            if (file == "loadBalance" || file == "Main") {
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
            if (file == "loadBalance") {
                btn3.attr("disabled", "disabled");
                btn4.attr("disabled", "disabled");
            } else {
                if (btn3.attr("disabled") == "disabled") btn3.removeAttr("disabled");
                if (btn4.attr("disabled") == "disabled") btn4.removeAttr("disabled");
            }
            let nowLock = (btnLock.attr("class").indexOf("active") != -1);
            if (nowLock != lock) {
                if (lock) {
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

            if (bitrates && Object.keys(bitrates).length != 0) {
                el.find(".list-item-tachometer").css("display", "block");
            } else {
                el.find(".list-item-tachometer").css("display", "none");
            }
        };
        btnEnabled(el) {
            let index = el.attr('value');
            let {file, lock} = this.src[index];
        }
        setStatus(el, status, trash) {
            el.children().attr('hidden', 'hidden');
            if (trash) status = 4;
            if (typeof status == "boolean") {
                status = (status ? 1 : 0)
            }
            switch (status) {
                case 0:
                    el.find('.state-off').removeAttr('hidden');
                    break;
                case 1:
                    el.find('.state-on').removeAttr('hidden');
                    break;
                case 2:
                    el.find('.state-pend').removeAttr('hidden');
                    break;
                case 3:
                    el.find('.state-maint').removeAttr('hidden');
                    break;
                case 4:
                    el.find('.state-trash').removeAttr('hidden');
                    break;
                case 5:
                    break;
            }
        };
        setUptime(el, uptime) {
            let d = new Date();
            d.setTime(uptime);
            let time = Math.floor((new Date().getTime() - uptime) / 1000);
            let day  = "0";
            let hour = "0";
            let min  = "0";
            let sec;
            let f;
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
                f = (hour >= 10 ? hour : ("0" + hour)) + "h:" + (min >= 10 ? min : "0" + min);
                f += '';
            } else
            {
                f = (min >= 10 ? min : "0" + min) + ":" + ((sec >= 10) ? sec : "0" + sec);
            }
            el.html(' ' + f);
        };
        setAssign(el, str) {
            if (el.attr("title") == str) return false;
            el.attr("title", str);
            if (str.length > 30) {
                str = str.substring(0, 20) + "...";
                el.html(str);
            } else {
                el.html(str);
            }
        };
        tooltip(el, assign, rules) {
            if (!Array.isArray(rules)) rules = [];
            el.attr('title', `assign => ${assign}<br>rules => [${rules.toString()}]`);
            el.tooltip({
                container: 'body',
                placement: 'right',
                // trigger: 'click',
                html: true,
                template: `
                    <div class="tooltip tooltip-custom">
                        <div class="tooltip-arrow" style="border-right:5px solid #757575;"></div>
                        <div class="tooltip-inner" style="background-color: #757575; text-align: left; font-size: 14px;"></div>
                    </div>`
            });
        }
        setText(el, str) {
            el.text(str);
        };
        setHidden(el, bool) {
            let state = !(el.attr("hidden") == "hidden");
            if (state != bool) {
                if (bool) {
                    el.removeAttr('hidden');
                } else {
                    el.attr("hidden", 'hidden');
                }
            }

        };
        setCount(el, count, payload) {
            let text = el;
            text.attr('title', `payload: ${payload}`);
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
        setTags(el, tags) {
            if (tags) {
                let str = ''
                tags.forEach((value, index) => {
                    str += `${value}`
                    if ((index + 1) < tags.length) str += ',';
                    if (index % 2 == 1) str += '<br>';
                })
                el.html(str);
            } else {
                el.html('');
            }
        };
        setMemory(el, el2, ram, history) {
            let value = ( ram / 1024 / 1024 ).toFixed(1);
            if (value > 1000) {
                value = (value/1024).toFixed(2) + " GB";
                el.css("color", "#EE7600");
                el.css("font-weight", "bold");
            } else {
                value += " MB";
                el.css("color", "#AAA");
                el.css("font-weight", "normal");
            }
            el.html(value);

            if (value > 2048) this.slStyle.lineColor = "#da4453";
            else if (value < 1024) this.slStyle.lineColor = "#8cc152";
            else this.slStyle.lineColor = "#f6bb42";

            if (this.oPrefSettings.memState) {
                el2.sparkline(history, this.slStyle);
            }

        };
        setCPU(el, el2, cpu, history) {
            let value = Number(cpu);
            if (isNaN(value)) value = 0;

            if ((value + "%") == el.html()) return;
            el.html(value + "%");

            if (value >= 80) {
                this.slStyle.lineColor = "#da4453";
                el.attr("class", "text-muted pro-cpu-usage text-danger");
            }
            else if (value >= 50 && value < 80) {
                this.slStyle.lineColor = "#f6bb42";
                el.attr("class", "text-muted pro-cpu-usage text-warning");
            }
            else {
                this.slStyle.lineColor = "#8cc152";
                el.attr("class", "text-muted pro-cpu-usage");
            }
            if (!Array.isArray(history)) history = [];
            if (this.oPrefSettings.cpuState) el2.sparkline(history, this.slStyle);


        };
        setLogLevel(el, {lv}, manager) {
            if (!lv) lv = 'debug';
            let level = el.find(".pro-log-level");
            level.html(`${lv[0].toUpperCase()}${lv.substr(1)}`);
            level.editable({
                type: "select",
                title: 'Select Level',
                placement: 'right',
                container: 'body',
                value: lv,
                source: [
                    {value: "none",  text: 'None'},
                    {value: "quiet", text: "Quiet"},
                    {value: "error", text: "Error"},
                    {value: "warning", text: "Warning"},
                    {value: "info", text: "Info"},
                    {value: "debug", text: "Debug"},
                    {value: "trace", text: "Trace"},
                    {value: "log", text: "Log"}
                ],
                success: (res, newValue) => {
                    let index = el.attr("value");
                    let {pid} = this.src[index];
                    console.log(`setLogLevel: ${index} pid: ${pid} newValue: ${newValue}`);
                    manager.setLogLevel(pid, {lv:newValue});
                },
                url: (params) => {
                    console.log("url",params);
                }
            });
        };
        setHostInfo(el, host) {
            if (host) el.text(host);
            else el.text('NONE');
        }
        setBitRates(el, {title, values}) {
            if (typeof values == "undefined") return;
            let titleLabel = el.find(".title");
            titleLabel.html(title);

            let view = el.find(".subview-content");
            let keys;
            if (Array.isArray(values)) {
            } else if (typeof values == "object") {
                keys = Object.keys(values);
            }
            let badge;
            let value;
            view.empty();
            for (var i = 0; i < keys.length; i++) {
                badge = keys[i];
                value = values[badge];
                view.append(this.addBadgeView({ badge, value }));
            }
        };
        setSubInfo(el, data) {
            let content = el.find('.content');
            let str = '';
            if (!data) {

            } else if (Array.isArray(data)) {
                data.forEach((item) => {
                    console.log(item);
                    if (Array.isArray(item) && item.length == 2) {
                        let [key, value] = item;
                        str += `<strong>${key}</strong>`;
                        str += '<br>';
                        if (typeof item == "object") {
                            str += JSON.stringify(value, null, '\t');
                        } else {
                            str += value.toString();
                        }
                    } else if (typeof item == "object") {
                        str += JSON.stringify(item, null, '\t');
                    } else {
                        str += item.toString();
                    }
                    str += '<br>';
                })
            } else if (typeof data == "object") {
                str = JSON.stringify(data, null, '\t');
                let keys = Object.keys(data);
                keys.forEach((key) => {
                    str += key;
                    str += '<br>';
                    if (typeof data[key] == "object") {
                        str += JSON.stringify(data[key], null, '\t');
                    } else {
                        str += data.toString();
                    }
                    str += '<br>';
                });
            } else {
                str = data;
            }
            str = str.replace(/(\r\n)|(\n)/g,'<br>');
            content.html(
                `<p>${str}</p>`
            );
        }
        addBadgeView({badge, value}) {
            let unit = "";
            let key = "";
            let val = "";
            let sub = "";
            if (typeof value == "object") {
                let keys = Object.keys(value);
                keys.forEach((key) => {
                    unit = (key == 'Bps' || key == 'RX' || key == 'TX') ? ' Kb/s' : '';
                    val = value[key];
                    sub += this.addBadgeSubView({key, val, unit});
                })
            } else {
                val = value;
                sub = this.addBadgeSubView({key, val, unit});
            }
            return `
                <p class="col-xs-10 col-sm-8 col-md-4">
                    <span class="badge badge-info">${badge}</span> 
                    ${sub}
                </p>
            `;
        };
        addBadgeSubView({key, val, unit}) {
            return `
               <span class="badge-sub">
                    <strong class="badge-key">${key}</strong> 
                    <span class="badge-text">${val}</span> 
                    <small class="text-muted badge-unit"> ${unit}</small>
                </span>
            `;
        };
        filterButton(btn) {
            const endpoint = this;
            let instance = (typeof btn == "string") ? $(btn) : btn;
            instance.change(function () {
                console.log(`filterShow.change = ${$(this).val()}`);
                endpoint.filterShow = $(this).val();
                endpoint.update(this.db);
            });
            instance.keyup(function() {
                endpoint.filterShow = $(this).val();
            });
            return this;
        };
        appendPagination() {
            let pagination = new IPagination();
            pagination.onChange = (page) => {
                console.log(`page number => ${page}`);
                this.change(page);
            };
            this.pagination = pagination;
            return this;
        };
        pageRefresh() {
            let { pagination } = this;
            if (pagination) {
                pagination.load('#project_pagination', this.totalPages);
            }
        }
        test() {
            this.updateMetadata([
                [4227, [
                    [
                        "video/daabb/video0",
                        {
                            "presetname": "Custom",
                            "creationdate": "Fri Aug 19 19:17:59 2022\n",
                            "videodevice": "OBS-Camera",
                            "framerate": 10,
                            "width": 640,
                            "height": 360,
                            "videocodecid": "avc1",
                            "videodatarate": 168,
                            "avclevel": 31,
                            "avcprofile": 66,
                            "videokeyframe_frequency": 5,
                            "audiodevice": "OBS-Audio",
                            "audiosamplerate": 44100,
                            "audiochannels": 2,
                            "audioinputvolume": 75,
                            "audiocodecid": "mp4a",
                            "audiodatarate": 48
                        }
                    ],
                    [
                        "video/daabb/videosd",
                        {
                            "presetname": "Custom",
                            "creationdate": "Fri Aug 19 19:17:59 2022\n",
                            "videodevice": "OBS-Camera",
                            "framerate": 10,
                            "width": 640,
                            "height": 360,
                            "videocodecid": "avc1",
                            "videodatarate": 168,
                            "avclevel": 31,
                            "avcprofile": 66,
                            "videokeyframe_frequency": 5,
                            "audiodevice": "OBS-Audio",
                            "audiosamplerate": 44100,
                            "audiochannels": 2,
                            "audioinputvolume": 75,
                            "audiocodecid": "mp4a",
                            "audiodatarate": 48
                        }
                    ]
                ]]
            ])
            return [{
                "pid": 4211,
                "file": "Main",
                "name": "octoproxy",
                "pkey": "octoproxy",
                "count": 2000,
                "lock": false,
                "memoryUsage": {"rss": 29569024, "heapTotal": 13877248, "heapUsed": 9090288, "external": 64562},
                "complete": 1,
                "lv": "debug",
                "uptime": 1658271846019,
                "payload": 203,
                "cpuUsage": 0
            }, {
                "pid": 4227,
                "name": "inind",
                "pkey": "inind_0",
                "count": 0,
                "lock": false,
                "complete": 3,
                "uptime": 1658271832582,
                "ats": false,
                "lookout": true,
                "args": [],
                "memoryUsage": {"rss": 40308736, "heapTotal": 23314432, "heapUsed": 11766784, "external": 1699590},
                "lv": "debug",
                "f2db": "",
                "bitrates": {},
                "file": "./lib/remoteSrv.js",
                "payload": 0,
                "cpuUsage": 80
            }, {
                "pid": 31273,
                "name": "bac-1",
                "pkey": "bac-1_0",
                "count": 2,
                "lock": false,
                "complete": true,
                "uptime": 1659494543892,
                "ats": false,
                "lookout": true,
                "args": [],
                "memoryUsage": {"rss": 33681408, "heapTotal": 20180992, "heapUsed": 14674992, "external": 178465},
                "lv": "debug",
                "f2db": "",
                "bitrates": {
                    "/video/daabc/video0/": {
                        "Bps": 37,
                        "RX": 100,
                        "TX": 100
                    },
                    "/video/daabc/video1/": {
                        "Bps": 6
                    },
                    "/video/daabc/videosd/": {
                        "Bps": 69
                    },
                    "/video/daabc/videohd/": {
                        "Bps": 0
                    },
                    "/video/daabc/video0x/": {
                        "Bps": 0
                    },
                    "/video/daabc/video1x/": {
                        "Bps": 0
                    },
                    "/video/daabc/videosdx/": {
                        "Bps": 0
                    }
                },
                "file": "../Dealer/BacDealer/main.js",
                "payload": 2,
                "trash": true,
                "cpuUsage": 10,
            }, {
                "pid": 28847,
                "name": "bac-2",
                "pkey": "bac-2_0",
                "count": 2,
                "lock": false,
                "complete": true,
                "uptime": 1659492965901,
                "ats": false,
                "lookout": true,
                "args": [],
                "memoryUsage": {"rss": 32706560, "heapTotal": 19656704, "heapUsed": 14166120, "external": 124994},
                "lv": "debug",
                "f2db": "",
                "bitrates": {},
                "file": "../Dealer/BacDealer/main.js",
                "payload": 2,
                "cpuUsage": 0
            }, {
                "pid": 28883,
                "name": "bac-3",
                "pkey": "bac-3_0",
                "count": 2,
                "lock": true,
                "complete": true,
                "uptime": 1659492978445,
                "ats": false,
                "lookout": true,
                "args": [],
                "memoryUsage": {"rss": 33153024, "heapTotal": 19656704, "heapUsed": 14200728, "external": 169277},
                "lv": "debug",
                "f2db": "",
                "bitrates": {},
                "file": "../Dealer/BacDealer/main.js",
                "payload": 2,
                "cpuUsage": 60,
                "tags": ['#tags']
            }, {
                "pid": 4248,
                "name": "bac-6",
                "pkey": "bac-6_0",
                "count": 2,
                "lock": false,
                "complete": 2,
                "uptime": 1658271832600,
                "ats": false,
                "lookout": true,
                "args": [],
                "memoryUsage": {"rss": 33157120, "heapTotal": 18071552, "heapUsed": 12194568, "external": 151119},
                "lv": "debug",
                "f2db": "127.0.0.1",
                "bitrates": {},
                "file": "../Dealer/BacDealer/main.js",
                "payload": 2,
                "cpuUsage": 0
            }]
        };
        async startTracerLog(assign) {
            let { tracer, manager } = this;
            const { version } = manager;
            if (typeof tracer == "undefined") {
                let host = document.getElementById('ipAddress').value;
                tracer = new IConnect(`ws://${host}/`, ['log']);
                let res = await tracer.start();
                tracer.addListener('complete', async ({event, data}) => {
                    if (event == 'ready') await tracer.liveLog({name: assign, bool: true});
                    if (event == 'liveLog' && data.name == assign) this.logDraw(data);
                });

                this.tracer = tracer;
                $(".scroll-content-log").mCustomScrollbar({
                    callbacks:{
                        onScrollStart:function(){
                            // console.log('onScrollStart');
                        },
                        whileScrolling:function() {
                        },
                        onTotalScroll:function () {
                            //console.log('onTotalScroll');
                            this.moveBottom = true;
                        }
                    }
                });
                $("#modal_log_cluster").on('hidden.bs.modal', () => {
                    console.log(`modal-log-cluster show => `);
                    tracer.liveLog({name: assign, bool: false});
                    $("#modal_log_cluster").find(".mCSB_container").empty();
                    $("#modal_log_rows").html(0);
                });
                $('#modal_log_cluster').on('shown.bs.modal', () => {
                    if (version == 'v1') {
                        console.log(`v1`);
                        tracer.liveLog_v1({name: assign, bool: true});
                    }
                });
            } else {
                if (typeof this.tracer != "undefined") {
                    if (version == 'v1') {
                        tracer.liveLog_v1({name: assign, bool: true});
                    } else {
                        tracer.liveLog({name: assign, bool: false});
                    }
                    $("#modal_log_cluster").find(".mCSB_container").empty();
                    $("#modal_log_rows").html(0);
                }
            }

        };
        logDraw(d) {
            let { log } = d;
            setTimeout(() => {
                if (this.moveBottom) $(".scroll-content-log").mCustomScrollbar("scrollTo", "bottom");
            },10);
            let str = log.replace(/error/g, '<span style=color:#da4453;font-weight:bold;>error</span>');
            str = str.replace(/info/g, '<span style=color:#2f9fe0;font-weight:bold;>info</span>');
            str = str.replace(/warning/g, '<span style=color:#f6bb42;font-weight:bold;>warning</span>');
            $("#mCSB_1_container").append("<p style='margin: 0 0 0 0;'>" + str + "</p>");
            var rows = $("#mCSB_1_container > p").length;
            $("#modal_log_rows").html(rows);

            if (rows > 2000) {
                $("#mCSB_1_container").children().eq(0).remove();
            }
        };
        stopTracerLog() {
            let { tracer } = this;
            if (tracer) tracer.close();
        };
        appendInsertBtn() {
            $("#btn-insert-cluster").unbind('click');
            $("#btn-insert-cluster").click(() => new IModalEditor().show({}, this.manager));
            return this;
        }
    }
    class IPanel {
        constructor() {
            this.networkEntries = undefined;
            this.devicesEntries = {};
            this.devicesEntriesLen = 0;
            this.devicesSort = undefined;
            this.easyPieChartStyle = {
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
            this.initEasyPieChart();
        }
        initEasyPieChart() {
            let style = this.easyPieChartStyle;
            $('.chartVisits').easyPieChart(style);
            style.barColor = "#2f9fe0";
            style.barColor = function (percent) {
                return (percent < 50 ? '#5cb85c' : percent < 85 ? '#f6bb42' : '#cb3935');
            };
            $('.chartInfo').easyPieChart(style);
            style.barColor = "#334454";

            $('.chartIncoming').easyPieChart(style);
        };
        //
        setupGeneralHead() {
            const self = this;
            $(".block-toggle").click(function () {
                const box = $(this).parents(".block").first();
                self.switchCollapsed(box, 500);
            });
            const panel = $('#wrapper');
            this.switchCollapsed(panel, 0, false);
            // IButton.collapse({ panel: $('.assignPanel'), visible: false });
            // IButton.collapse({ panel: $('#panel-network'), visible: false });
            // IButton.collapse({ panel: $('#node-tools-panel'), visible: false });
            // IButton.collapse({ panel: $('.connectionsPanel'), visible: false });
            IButton.collapse({ panel: $('#process-content'), visible: true });
            return this;
        };
        refresh() {
            return this;
        };
        switchCollapsed(panel, time, visible) {
            IButton.collapse({ panel, time, visible })
        }
        updateSysVisitors(data) {
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
        };
        updateSysHDD(data) {
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
        updateSysLoadAvg(data) {
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
        updateIncoming(data) {
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
        updateNetwork(data) {
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
        updateDevices(devices) {
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
                return new Promise(function (resolve) {
                    name = "item" + i;
                    key  = list[i];
                    data = devices[key];
                    if (typeof self.devicesEntries[name] == "undefined") {
                        if (!self.devTmp) self.devTmp = self.initDevices("#node-devices-Monitor");
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
                        self.devicesEntries["item" + n].endpoint.attr("hidden", true);
                        self.devicesEntries["item" + n].hidden = true;
                        n++;
                    }
                }
            });
        };
        initDevices(name) {
            var copy = $(name).find(".list-item-content").clone();
            copy.removeAttr("hidden");
            $(name).find(".list-item-content").parent().empty(); // remove all child.
            return copy;
        };
        updateSchedule(src, manager) {

            if (typeof this.schedule == "undefined") {
                this.schedule = new component.Schedule();
            }
            this.schedule.empty();
            this.schedule.update(src, manager);
        };
    };

    class IModalEditor {
        constructor() {
            this.target = null;
        }
        create(data) {
            let content = this.createContent(data);
            let context = this.createModal({id: 'modal_edit_cluster', content});
            $("body").append(context);
            this.data = data;
            this.target = $("#modal_edit_cluster");
            return this;
        }
        createModal({id, content}) {
            return `<div 
            class="modal fade in" 
            id="${id}" 
            tabindex="-1" 
            role="dialog">${content}</div>`
        }
        createContent(data) {
            return `<div class="modal-dialog" role="document">
                        <div class="modal-content">
                            ${this.createHeader(!this.isEmpty(data))}
                            ${this.createBody(data)}
                            ${this.createFooter()}
                        </div>
                    </div>`
        };
        createHeader(edit) {
            return `
            <div class="modal-header">
                <a class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></a>
                <h4 class="modal-title" id="modal_edit_clusterLabel">
                    ${edit ? '<i class="fa fa-file-arrow-edit"></i> ' : '<i class="fa fa-file-arrow-up"></i> '} 
                    ${edit ? 'Edit' : 'Insert'} Cluster</h4>
            </div>`;
        };
        createBody({pid, file, name, mxoss, args, cmd, env, tags, lookout, ats, assign2syntax, rules}) {
            let disabled = (pid ? 'disabled' : '');
            return `
            <div class="modal-body">
                <form id="cluster-form">
                    <div class="form-group">
                        <label for="file-text" class="control-label">File:</label>
                        <input name="file" type="text" class="form-control file" placeholder="Run Node path to js file." value="${(file || "")}" ${disabled}>
                    </div>
                    <div class="form-group">
                        <label for="assign-text" class="control-label">Assign:</label>
                        <input name="assign" type="text" class="form-control assign" placeholder="how do user assign the room.(ex:Hall)" value="${(name || "")}">
                        <input type="checkbox" class="skipAssign" name="assign2syntax" ${assign2syntax ? 'checked' : ''}> skip additional command line arguments
                        <input type="hidden"  name="rules" type="text" class="form-control assign" placeholder="set assign order rules" value="${Array.isArray(rules) ? rules.toString() : ''}">
                    </div>
                    <div class="form-group memory-group">
                        <label for="memory-text" class="control-label">Memory:</label>
                        <input name="mxoss" type="number" value="${(mxoss || 1024)}" class="form-control memory" id="memory-text" placeholder="increasing the memory limit.(MB)" ${disabled}>
                    </div>
                    <div class="form-group">
                        <label for="args-text" class="control-label">Args:</label>
                        <input name="args" type="text" class="form-control args" id="args-text" placeholder="Command line call to packaged app ./app assign b c" value="${(args || []).toString()}" ${disabled}>
                    </div>
                    <div class="form-group launchCmd-group">
                        <label for="launchCmd-text" class="control-label">Launch Command:</label>
                        <input name="cmd" type="text" class="form-control launchCmd" id="launchCmd-text" placeholder="Type the name of a program." value="${(cmd || "")}" ${disabled}>
                    </div>
                    <div class="form-group launchCmd-group">
                        <label for="launchEnv-text" class="control-label">Launch Env:</label>
                        <input name="env" type="text" class="form-control envVars" id="launchEnv-text" placeholder="set process environment variables.(ex: key1=value1,key2=value2)" value="${(env || []).toString()}" ${disabled}>
                    </div>
                    <div class="form-group tags-group">
                        <label for="tags-text" class="control-label">Tags:</label>
                        <input name="tags" type="text" class="form-control tags" id="tags-text" placeholder="set process tags(#istag)" value="${(tags || []).toString()}">
                    </div>
                    <div class="form-group">
                        <label>
                            <input name="lookout" type="checkbox" id="cLookout" ${lookout ? 'checked': ''}> Launch Interval between ping-pong heartbeats. [default true]
                        </label>
                    </div>
                    <div class="form-group">
                        <label>
                            <input name="ats" type="checkbox" id="cATS" ${ats ? 'checked': ''}> Enable Automated Transfer Systems (ATS) [default false]
                        </label>
                    </div>
                </form>
            </div>`
        }
        createFooter() {
            return `
            <div class="modal-footer">
                <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
                <button type="submit" class="btn btn-primary" id="modal-submit">submit</button>
            </div>`
        }
        show(data, manager) {
            if (this.isEmpty(data)) data = {
                file: "",
                name: "",
                mxoss: 2048,
                env: [],
                args: [],
                tags: [],
                ats: false,
                lookout: true,
                assign2syntax: false
            };
            data = {
                file: "./test/webServer.js",
                name: "http,http2",
                mxoss: 2048,
                env: [],
                args: [],
                tags: [],
                ats: false,
                lookout: true,
                assign2syntax: false
            };
            const { target } = this.create(data);
            target.modal('show');
            $("#modal-submit").click(() => {
                let res = true;
                if (this.data.pid) {
                    res = this.editSubmit(manager);
                } else {
                    res = this.insertSubmit(manager);
                }
                if (res) $("#modal_edit_cluster").remove();
            });
            target.on('hidden.bs.modal', () => this.release());
        };
        inputSerialize() {
            let fields = $('#cluster-form').find('input').serializeArray();
            let data = {};
            for (let { name, value } of fields) {
                if (!this.verification(name, value)) {
                    Swal.fire({
                        icon: 'error',
                        text: `The '${name}' value is not detected.`
                    });
                    return false;
                }
                switch (name) {
                    case 'lookout':
                    case 'ats':
                    case 'assign2syntax':
                        data[name] = (value == 'on');
                        break;
                    case 'args':
                    case 'tags':
                        data[name] = this.parseArgs(value);
                        break;
                    case 'env':
                        data[name] = this.parseEnv(value);
                        break;
                    default :
                        data[name] = value;
                }
            }

            if (data.assign2syntax) {
                // data['rules'] = data['assign'].split(",");
                // delete data['assign'];
            }

            return data;
        }
        verification(name, value) {
            switch (name) {
                case 'file':
                case 'assign':
                    return !this.isEmpty(value);
                case 'mxoss':
                    return !(Number.parseInt(value) <= 0);
            }

            return true;
        };
        parseArgs(str) {
            return str.split(",");
        };
        parseEnv(envVar) {
            let env = [];
            envVar.split(",").forEach((item) => {
                if (item && item.indexOf('=') != -1) {
                    let [key, value] = item.split("=");
                    env.push([key, value]);
                }
            });
            return env;
        };
        isEmpty(value) {
            if (!value) return true;
            if (typeof value == "undefined") return true;
            if (value == "") return true;
            return (typeof value == "object" && (Object.keys(value).length == 0 || !value.pid));
        }
        insertSubmit(manager) {
            let options = this.inputSerialize();
            console.log(`modal-insert-submit`);
            let { file, assign, mxoss } = options;
            this.target.modal('hide');
            manager.addCluster(file, assign, mxoss, options);
            return true;
        };
        editSubmit(manager) {
            let options = this.inputSerialize();
            let oAssign = this.data.name;
            let pid = this.data.pid;
            let nAssign = options.assign;
            console.log(`modal-edit-submit`);
            this.target.modal('hide');
            manager.editCluster(oAssign, nAssign, options, pid);
            return true;
        }
        release() {
            console.log(`IModalEditor.release()`);
            this.target.remove();
            this.target = null;
            this.data = null;
        }
    }
    class IModalBatch extends IModalEditor{
        /**
         * 批次重啟
         */
        constructor() {
            super();
        }
        create(data) {
            let content = this.createContent(data);
            let context = this.createModal({id: 'modal_batch', content});
            $("body").append(context);
            this.target = $("#modal_batch");
            return this;
        };
        createHeader() {
            return `
            <div class="modal-header">
                <button type="button" class="close" data-dismiss="modal" aria-hidden="true">×</button>
                <h4 class="modal-title">Batch Reboot</h4>
            </div>
            `;
        };
        createBody(data) {
            return `
            <div class="modal-body">
                <form id="batch-form" style="min-height: 300px;">
                    <div class="form-group">
                        <input class="form-check-batch-mode" type="radio" name="batch_select" id="batchRebootRadios1" value="id" checked>
                        <label for="batchRebootRadios1" style="font-size: small">Select multiple service reboot:</label>
                        <select class="form-control form-control-lg" id="select-batch-multiple" name="batch_mode_rule" style="width: 100%" multiple="multiple"></select>
                    </div>
                    <div class="form-group">
                        <input class="form-check-batch-mode" type="radio" name="batch_select" id="batchRebootRadios2" value="tags">
                        <label for="batchRebootRadios2" style="font-size: small">Select Tags service reboot:</label>
                        <select class="form-control form-control-lg" id="select-batch-tags" name="batch_tag_rule" style="width: 100%"></select>
                    </div>
                    <div class="form-group">
                        <label>Delay(milliseconds)</label>
                        <input class="form-control" type="number" name="batch_delay" value="100"> ms
                    </div>
                    <div class="form-group">
                        <label>Deployments </label>
                        <select id="select-batch-deployment" class="form-control">
                            <option value="Reboot" selected>Reboot</option>
                            <option value="Gracefully">Reboot-gracefully</option>
                            <option value="BlueGreen">BlueGreen</option>
                        </select>
                    </div>
                </form>
            </div>`;
        };
        createFooter() {
            return `
            <div class="modal-footer">
                <button type="button" class="btn btn-primary" id="btn-batch-submit" data-dismiss="modal">Submit</button>
                <button type="button" class="btn btn-default btn-clean" data-dismiss="modal">Close</button>
            </div>`;
        };
        show(db, mAdapter) {
            const { target } = this.create();
            target.modal('show');
            $("#select-batch-multiple").empty();
            $("#select-batch-tags").empty();
            this.createOptions(db);
            $("#select-batch-multiple").select2({
                placeholder: "Choose multiple subprocesses",
                closeOnSelect : false,
                allowHtml: true,
                allowClear: true,
                multiple: true,
                tags: true
            });
            $('#select-batch-tags').select2();

            $("#btn-batch-submit").click(() => {

                let deploy = $("#select-batch-deployment").val();
                let batchOpt = $("input[name='batch_select']:checked").val();
                let delay = $("input[name='batch_delay']").val();
                let list = [];
                console.log(`deploy=${deploy}`);
                if (batchOpt == 'id') {
                    list = ($("#select-batch-multiple").val() || []).filter(function (value) {
                        return (isNaN(parseInt(value)) == false);
                    });
                    if (!list) list = [];
                    mAdapter.restartMultiCluster(list, delay, deploy);
                } else if (batchOpt == 'tags') {
                    let sl_tags = $("#select-batch-tags").val()
                    for (let i = 1; i < db.length; i++) {
                        let { pid, tags, name} = db[i];
                        let tagsSet = new Set(tags);
                        if (tagsSet.has(sl_tags)) list.push(String(pid))
                    }
                    mAdapter.restartMultiCluster(list, delay, deploy);
                }
                $("#modal_edit_cluster").remove();
            });
            target.on('hidden.bs.modal', () => this.release());

        };
        createOptions(db) {
            for  (var i = 1; i < db.length; i++) {
                let {file, pid, name} = db[i];
                if (file == "Main" || file == "loadBalance" || file.indexOf("remoteSrv") != -1) continue;
                $("#select-batch-multiple").append("<option value='"+ pid +"'>" + name + "</option>");
            }
            let tags = db[0].tags;
            if (Array.isArray(tags)) {
                tags.forEach((value) => {
                    $("#select-batch-tags").append("<option value='"+ value +"'>" + value + "</option>");
                });
            }
        }
    }

    class ICommandPanel {
        constructor() {
            this.target = null;
        }
        create() {
            let content = this.createContent();
            let context = this.createModal({id: 'modal_batch', content});
            $("body").append(context);
            this.target = $("#modal_batch");
            return this;
        };
        createModal({id, content}) {
            return `<div 
            class="modal fade in" 
            id="${id}" 
            tabindex="-1" 
            role="dialog">${content}</div>`
        }
        createContent() {
            return `<div class="modal-dialog" role="document">
                        <div class="modal-content">
                            ${this.createHeader()}
                            ${this.createBody()}
                            ${this.createFooter()}
                        </div>
                    </div>`
        };
        createHeader() {
            return `
            <div class="modal-header">
                <button type="button" class="close" data-dismiss="modal" aria-hidden="true">×</button>
                <h4 class="modal-title">Batch Reboot</h4>
            </div>
            `;
        };
        createBody() {
            return `
            <div class="modal-body">
                <form id="batch-form" style="min-height: 300px;">
                </form>
            </div>`;
        };
        createFooter() {
            return `
            <div class="modal-footer">
                <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
                <button type="submit" class="btn btn-primary" id="modal-submit">submit</button>
            </div>`
        }
        show() {
            const { target } = this.create();
            target.modal('show');
        }
        release() {
            this.target.remove();
            this.target = null;
            this.data = null;
        }
    }

    class IConfirmButton {
        constructor({panel, name}) {
            if (panel) {
                this.element = panel.find(`.${name}`);
            } else {
                this.element = $(`#${name}`);
            }
            this.element.click(() => this.onClicked());
            this.enabled = false;
            this.block = null;
            this.options = null;
        }
        fire(options, block) {
            if (!this.options) {
                this.options = options;
                this.block = block;
            }
            return this;
        }
        async onClicked() {
            let result = {};
            if (this.options) {
                const { title, text } = this.options;
                result = await Swal.fire({
                    title,
                    text,
                    icon: 'info',
                    confirmButtonColor: '#388E3C',
                    confirmButtonText: 'Save',
                    showCancelButton: true,
                    showConfirmButton: true,
                    customClass: {
                        actions: 'swal2-actions-2',
                        confirmButton: 'swal-sort-2',
                        cancelButton: 'swal-sort-1 right-gap',
                    }
                });
                // console.log(`result`, result);
            }

            if (this.block) this.block(result);
            return true;
        }
        set enabled(value) {
            this.element.prop('disabled', !value);
        }
        get enabled() {
            return this.element.prop('disabled');
        }
        clear() {
            this.options = null;
            this.block = null;
        }
    }

    class IButton {
        static refreshSchedule({mAdapter, manager, viewCtrl, panelSchedule}) {
            panelSchedule.find(".block-refresh").click(async () => {

                const tag = $("#sch-pan-tabs .active a").attr("href");
                console.log(`tag ---->`, tag);
                switch (tag) {
                    case "#tab-task":
                        mAdapter.getSchedule();
                        break;
                    case "#tab-app":
                        console.log(`tab-app`, await viewCtrl.appSettings({folder: ''}));
                        break;
                    case "#tab-conf":
                        console.log(`tab-conf`, await viewCtrl.appSettings({folder: 'configuration'}));
                        break;
                    case "#tab-sms":
                        console.log(`tab-sms`, await manager.smsManager());
                        break;
                    default:

                }
            });
        }
        static sendSchedule(mAdapter) {
            //建立排程
            $("#sendSchedule").click(() => {
                const pid = ($("#schedule-thread").select2("data")[0].id);
                const name = ($("#schedule-thread").select2("data")[0].text);
                const behavior = $("#schedule-behavior").select2("data")[0].text;
                const date = $("#form_datetime").val();
                const repeating = $("#schedule-repeating").select2("data")[0].text;
                console.log(`add-schedule pid: ${1}`,pid);
                if (date == "") return;

                const group = date.split(" ");
                const [year, month, day] = group[0].split("-");
                const [hours, min] = group[1].split(":");

                console.log(group[0].split("-"), year, month, day);

                mAdapter.addSchedule({
                    time: [year, month, day, hours, min, 0],
                    name,
                    pid,
                    behavior,
                    repeating
                });
            });
        };
        static alertAuthenticationRequired() {
            swal.fire({
                icon:'warning',
                title: 'AuthenticationRequired',
                text: 'Please Login first to your account.'
            })
        };
        static collapse(options) {
            let { id, name, time, panel, visible } = options || {};
            if (panel) {

            } else if (id) {
                panel = $(`#${id}`);
            }
            else if (name) {
                panel = $(`.${name}`);
            }
            else {
                console.error('collapse not found');
                return false;
            }
            let btn = panel.find('.block-toggle');
            let content = panel.find('.block-content');

            if (typeof visible == "string") {
                visible = (visible == 'show')
            } else if (typeof visible == "boolean") {

            } else {
                visible = (content.css('display') == 'none');
            }
            if (!visible) {
                //hidden
                content.slideUp(time || 0);
                btn.children("span").removeClass("fa fa-chevron-down").addClass("fa fa-chevron-up");
            } else {
                //visible
                content.slideDown(time || 0);
                btn.children("span").removeClass("fa fa-chevron-up").addClass("fa fa-chevron-down");
            }

            return true;
        }
    }
    class IEditTables {
        constructor({id, tHeads, tdBody, mAdapter}) {
            this.id      = id;
            this.panel   = $(`.${id}`);
            this.tHeads  = tHeads;
            this.raw     = {};
            this.data    = [];
            this.body    = this.panel.find('tbody');
            this.tdBody  = tdBody || [];
            this.mAdapter  = mAdapter;
            this.btn_save = new IConfirmButton({
                panel: this.panel,
                name: 'btn-save'
            });
        };
        set enabled(value) {
            this.btn_save.enabled = value;
        };
        get enabled() {
            return this.btn_save.enabled;
        };
        load() {
            //# Load Balance click event

            let content = this.panel.find('.list');
            content.empty();
            let table = this.createTables({tHeads: this.tHeads});
            content.append(table);
            this.body = this.panel.find('tbody');
            this.createEvent();
            return this;
        };
        modal(focus, time) {
            const { panel } = this;
            let bf = panel.find(".block-content");
            let visible = !(bf.css('display') == 'none');
            if (!time) time = 5;
            console.log(`${this.id} visible: ${visible} focus: ${focus}`);
            IButton.collapse({ panel, time, visible: focus });
            return this;
        };
        clean() {
            this.body.empty();
        }
        createTables({tHeads}) {
            return `
            <table class="table table-bordered">
                <thead>
                    <tr>
                        ${this.createTablesThead(tHeads)}
                    </tr>
                </thead>
                <tbody></tbody>
            </table>`;
        }
        createTablesThead(tHeads) {
            let str = '';
            tHeads.forEach(({name, type}) => {

                str += `<th class="${type || 't-small'}">${name}</th>`;
            });
            return str;
        }
        createRow({index, data}) {
            let { tdBody } = this;
            let body = `<tr id="tr${index}">`;
            let columns = `<td>${index}</td>`;
            for (let i = 0; i < tdBody.length; i++) {
                let options = tdBody[i];
                columns += this.createColumn(index, options, data[i]);
            }
            body += columns;
            body += '</tr>';

            return body;
        }
        /**
         *
         * @param index
         * @param key
         * @param type
         * @param title
         * @param data
         * @return {string}
         * @private
         */
        createColumn(index, {key, type, title}, data) {
            return `
            <td>
                <a class="${this.id}-${key}" 
                href="#"
                style="word-break: break-all;"
                data-type="${type || "text" }"
                data-placement="right"
                data-title="${title || 'Enter value'}" 
                data-pk="${index}">${data.toString()}</a>
            </td>`;
        };
        addColumnOption({ index, key, type, title, options }) {
            if (!key) return new Error('table key Not Found.');
            if (index) {
                this.tdBody[index] = arguments[0];
            } else {
                this.tdBody.push(arguments[0]);
            }
            return this;
        };
        createEvent() {
            const { panel, mAdapter } = this;

            panel.find(".block-refresh").click(async () => {
                if (mAdapter.isConnected) mAdapter.getLBGamePath()
            });
            panel.find(".btn-load").click(async () => {
                if (mAdapter.isConnected) mAdapter.getLBGamePath()
            });
            panel.find(".btn-insert").click(() => this.insert());
        };
        update(data) {
            this.raw = data;
            this.clean();
            let keys = Object.keys(this.raw);
            let body = '';
            this.data = [];
            keys.forEach((path, index) => {
                let rule = this.raw[path];
                this.data.push([path, rule]);
                body += this.createRow({index, data: [path, rule]});
            });
            this.body.append(body);
            return this;
        };
        refresh() {
            let { body, tdBody, id } = this;
            for (let i = 0; i < tdBody.length; i++) {
                let { key, options } = tdBody[i];
                body.find(`.${id}-${key}`).editable(options);
            }
            return this;
        };
        insert() {
            let index = this.data.length;
            this.data.push([]);
            let row = this.createRow({index, data: ["", ""]});
            this.body.append(row);
            this.refresh();
        };

        confirm() {
            let { btn_save, mAdapter } = this;
            btn_save.fire({
                title: "Load Balance Save Confirmation",
                text: "Are your sure you want to 'Save'?",
            }, ({isConfirmed}) => {
                console.log(`isConfirmed: ${isConfirmed}`);
                if (isConfirmed) {
                    let saveData = {};
                    this.data.forEach(([key, value]) => {
                        if (key) saveData[key] = (value ? value : []);
                    })
                    mAdapter.setLBGamePath(saveData);
                }
            });
        };
        //# edit table config and complete return
        editableOptions1() {
            return {
                placement: 'top',
                success: (response, newValue) => {
                    console.log('Saved value: ', newValue, arguments);
                },
                url:(params) => {
                    const { data } = this;
                    let { pk, value } = params;
                    console.log('url pk:%s, value:%s ', pk, value, JSON.stringify(params));
                    if (typeof data[pk] != "undefined") {
                        data[pk][0] = value;
                    } else {
                        data[pk] = [];
                        data[pk][0] = value;
                    }

                },
                validate: (value) => {
                    let { data } = this;
                    let result = data.filter((item) => {
                        return item[0] == value;
                    })

                    console.log('Validate:', value, result);

                    if(result && result.length != 0 && result[0][0] != "") {
                        return 'This field is repeat key!!!';
                    }
                }
            }
        };
        editableOptions2() {
            return {
                url: (params) => {
                    let { pk, value } = params;
                    console.log(`pk: ${pk}, value: ${value}`, this.data[pk], this.data);
                    if (!Array.isArray(this.data[pk])) this.data[pk] = [];
                    this.data[pk]["1"] = value.replace(/\s+/g, "").split(",");
                    console.log(this.data);
                }
            }
        };
    }
    class IEditTablesDB extends IEditTables {
        constructor({id, tHeads, tdBody, mAdapter}) {
            super({id, tHeads, tdBody, mAdapter});
        }
        confirm() {
            let { btn_save, mAdapter } = this;
            btn_save.fire({
                title: "AMF Config Save Confirmation",
                text: "Are your sure you want to 'Save'?",
            }, ({isConfirmed}) => {
                console.log(`isConfirmed: ${isConfirmed}`);
                if (!isConfirmed) return false;
                let saveData = {};
                this.data.forEach(([key, value]) => {
                    if (key) saveData[key] = value ? value : [];
                })
                mAdapter.setAMFConfig(saveData);
            });
        };
        createEvent() {
            const { panel, mAdapter } = this;

            panel.find(".block-refresh").click(async () => {
                if (mAdapter.isConnected) mAdapter.getAMFConfig();
            });
            panel.find(".btn-load").click(async () => {
                if (mAdapter.isConnected) mAdapter.getAMFConfig();
            });
            panel.find(".btn-insert").click(() => this.insert());
        };
    }
    class IEncoder {
        constructor(key, iv) {
            this.key = CryptoJS.enc.Utf8.parse(key || "2ccf858554a5f119f33516b514efa9d2");  //十六位十六進制數作為密鑰
            this.iv = CryptoJS.enc.Utf8.parse(iv || 'c2e9d24aa29d125d');   //十六位十六進制數作為密鑰偏移量
        }
        //加密方法
        encryption(word) {
            const { key, iv } = this;
            const srcs = CryptoJS.enc.Utf8.parse(word);
            const encrypted = CryptoJS.AES.encrypt(srcs, key, { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
            return encrypted.ciphertext.toString();
        }
        //解密方法
        decryption(word) {
            const { key, iv } = this;
            let encryptedHexStr = CryptoJS.enc.Hex.parse(word);
            let srcs = CryptoJS.enc.Base64.stringify(encryptedHexStr);
            let decrypt = CryptoJS.AES.decrypt(srcs, key, { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
            let decryptedStr = decrypt.toString(); //CryptoJS.enc.Utf8
            return decryptedStr.toString();
        }

    }

    class ITesting {
        constructor() {
            this.log = $('.testing-console');
            this.log.empty();
            this.ws = null;
            this.line = 0;
        }
        init() {
            $(`#scheme-key`).editable();
            $(`#host-key`).editable();
            $(`#sid-key`).editable();
            $(`#f5-key`).editable();
            $(`#game-key`).editable();
            $('#btn-testing-start').click(() => {
                let scheme = $('#scheme-key').text();
                let host = $(`#host-key`).text();
                let f5 = $(`#f5-key`).text();
                let game = $(`#game-key`).text();
                let sid = $(`#sid-key`).text();
                let url = `${scheme}://${host}/${f5}/fxLB?gameType=${game}`;
                let params = { scheme, host, f5, game, sid };
                $.cookie('testing', JSON.stringify(params));
                this.start(url, params);

            });
            $('#btn-testing-stop').click(() => this.stop());
            return this;
        }
        load() {
            let params = $.cookie('testing');
            if (params) {
                let { scheme, host, f5, game, sid } = JSON.parse(params);
                $(`#scheme-key`).text(scheme)
                $(`#host-key`).text(host);
                $(`#f5-key`).text(f5);
                $(`#game-key`).text(game);
                $(`#sid-key`).text(sid);
            }
            return this;
        }
        start(url, params) {
            let ws = new WebSocket(url);
            ws.onopen = () => {
                this.point(`${url} has connected.`)
            };
            ws.onmessage = ({data}) => {
                let value = (typeof data == "object") ? JSON.stringify(data) : data;
                this.point(`message: ${value}`);
                this.handle(data, params);
            };
            ws.onclose = (close) => {
                this.point(`closed: ${close.code}`);
            };
            ws.onerror = (error) => {
                this.point(`error: There was an error with your websocket.`);
            };
            this.ws = ws;
        }
        stop() {
            if (this.ws) this.ws.close();
            this.ws = null;
        }
        handle(data, params) {
            let json = JSON.parse(data);
            let {f5, sid} = params;
            if (f5.toLowerCase() =='fxLive'.toLowerCase()) {
                if (json.action === 'ready') {
                    this.login_check(params);
                }
            }

        }
        login_check({sid}) {
            let json = {
                action: 'hallLogin',
                sid
            }
            this.ws.send(JSON.stringify(json))
        }
        point(value) {
            const { log } = this;

            if (this.line >= 50) log.empty();

            let htmlString = log.html();
            let str = `<p>${value}</p><br>`;
            log.html(htmlString + str);

            this.line++;
        }
    }
    
    return {
        IConnect: IConnect,
        IConnectAdapter: IConnectAdapter,
        IViewControl: IViewControl,
        IPagination: IPagination,
        IDataTable: IDataTable,
        IPanel: IPanel,
        IModalEditor: IModalEditor,
        IModalBatch: IModalBatch,
        ISelect2: ISelect2,
        ICommandPanel: ICommandPanel,
        IConfirmButton,
        IButton,
        IFetcher,
        IEditTables,
        IEditTablesDB,
        IEncoder,
        ITesting
    }
})();