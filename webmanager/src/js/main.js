var delIPDenyClicked
function load(info) {
    const protocol  = "admin.op"; //'admin.op.aes';
    let version = "v1";
    let firstConnect = false;
    let proc_duration = 5;
    let proc_duration_time;
    let admin     = null; // version 1.0
    let manager   = null; // version 2.0
    //中間層跳轉
    let mAdapter = new componentKit.IConnectAdapter();
    let alert     = new component.alert($(".top-bar")); // alert popup
    /* New Assign Configuration table */
    let confTable = new component.lbTable("#srv-config > tbody:last", ["file","assign","mxoss","edit", "dead"]);
    let iptable   = new component.lbTable("#ip-address-blocking > tbody:last", ["ip", "dead"]);
    let ipDataTable;
    let parser = new UAParser();
    // console.log(JSON.stringify(parser.getResult(), null, '\t'));

    const {
        ISelect2,
        IDataTable,
        IViewControl,
        IPanel,
        IModalBatch,
        ICommandPanel,
        IButton,
        IFetcher,
        IConnect
    } = componentKit;

    let balanceTable = new componentKit.IEditTables({
        id: 'load-balance-panel',
        tHeads: [{name: '#', type: 'col-5'}, {name: 'PATH', type: 'col-25'}, {name: 'RULE', type: 'col-70'}],
        mAdapter
    });
    balanceTable.modal('hidden', 0)
        .addColumnOption({
            key: 'path',
            options: balanceTable.editableOptions1()
        })
        .addColumnOption({
            key: 'rule',
            type: 'textarea',
            title: 'Enter assign',
            options: balanceTable.editableOptions2()
        })
        .load(mAdapter);
    let dbTable = new componentKit.IEditTablesDB({
        id: 'amf-config-panel',
        tHeads: [{name: '#', type: 'col-5'}, {name: 'PATH', type: 'col-25'}, {name: 'RULE', type: 'col-70'}],
        mAdapter
    })
    dbTable.modal('hidden', 0)
        .addColumnOption({
            key: 'path',
            options: dbTable.editableOptions1()
        })
        .addColumnOption({
            key: 'rule',
            type: 'textarea',
            title: 'Enter assign',
            options: dbTable.editableOptions2()
        })
        .load(mAdapter);

    //IP選單
    let addrSelect = new ISelect2('ipAddress')
        .create(selectOptions)
        .load()
        .onDidChange(async ({value, version}) => {
            let [host, port] = value.split(":");
            viewCtrl.setOptions({host, port: (port || 80)});
            let data = await viewCtrl.version();
            if (data.result) {
                version = 'v2';
            }
            return {value, version};
        });
    let proTable = new IDataTable({delegate: this, rows: 20})
        .create('#process-content')
        .filterButton($("#proc-filter"))
        .appendPagination()
        .appendInsertBtn();
    let proPanel = new IPanel()
        .setupGeneralHead()
        .refresh();

    let viewCtrl = new IViewControl({ alert, info })
        .loginBtn(mAdapter)
        .f2dbInfo(proTable);
    //init hidden
    var projects =  $("#node-service").parents(".block").first();
    var panelConf = $("#srv-config").parents(".block").first();
    var panelSchedule = $("#node-schedule").parents(".block").first();
    var srvConnect = $("#srv-connect").parents(".block").first();

    $( "#srvConnect" ).click(() => {
        version = addrSelect.version;
        let authority = addrSelect.selected;
        console.log(`=> Start Connect authority:${authority} version:${version}`);
        let url = `ws://${authority}/`;
        if (version == "v1") {
            createConnection1(url);
        } else {
            createConnection2(url);
            let [host, port] = authority.split(":");
            viewCtrl.setOptions({host, port: (port || 80)})
        }
    });
    //#0 WebSocket //
    const createConnection1 = function (url) {
        admin = new component.connect(url,[protocol], onConnect);
        admin.addListener("complete", onComplete);
        //更新動畫
        $(".pro-refresh").removeClass("paused-animation").addClass("run-animation");
        proc_duration_time = setInterval(() => {
            if (proc_duration > 0) $(".project-duration").html(--proc_duration);
        }, 1000);
    };
    const createConnection2 = async function (url) {
        manager = new IConnect(url, [protocol]);
        manager.addListener("complete", async ({event, data}) => {
            switch (event) {
                case 'ready':
                    let { version, isAuthEnabled} = data;
                    manager.isAuthEnabled = (isAuthEnabled == true);
                    console.info(`=> Version: ${version}`);
                    break;
                case 'progressSteps':
                    console.log('data => ', res);
                    break;
            }
        });
        manager.onClosed = onDisconnect;

        let res = await manager.start();
        console.info(`Connected: %c${res}`, 'color: green;');
        let isReady = await manager.isReady();
        console.info(`IsReady: ${isReady} IsAuthEnabled: ${manager.isAuthEnabled}`);
        res ? onConnect() : onDisconnect();
        if (!res) return false;

        if (isReady) {
            let res_login = await manager.startAuthenticate(
                {
                    onComplete,
                    token: info.token
                });
            if (!res_login) {
                IButton.alertAuthenticationRequired();
                return false;
            }
        }
        //更新動畫
        $(".pro-refresh").removeClass("paused-animation").addClass("run-animation");
        proc_duration_time = setInterval(() => {
            if (proc_duration > 0) $(".project-duration").html(--proc_duration);
        }, 1000);
    };

    var onDisconnect = function () {
        $("#srvConnect").attr('class', 'btn btn-danger');
        $("#srvConnect").prop( "disabled", false );
        manager.stopAuto();
        dbTable.enabled = false;
        balanceTable.enabled = false;
        clearInterval(proc_duration_time);
    };
    var onConnect = function () {

        mAdapter.setVersion({
            v1: admin,
            v2: manager,
            version: version,
            completed: onComplete
        });
        $("#srvConnect").attr('class', 'btn btn-success');
        $("#srvConnect").prop( "disabled", true );
        viewCtrl.mAdapter = mAdapter;
        proTable.manager = mAdapter;

        if (firstConnect) return;
        firstConnect = true;

        mAdapter.start();

        //# Projects Refresh Click Event
        projects.find(".block-refresh").click(async () => {
            await mAdapter.getClusterInfos();
            await mAdapter.getSysInfo();
        });
        $("#loadList").click(async () => {
            let ts = Date.now();
            $('#loadList').find(".fa-refresh").removeClass("paused-animation").addClass("run-animation");
            await mAdapter.getClusterInfos();
            if (Date.now() - ts < 1000) await mAdapter.wait(1);
            $('#loadList').find(".fa-refresh").removeClass("run-animation").addClass("paused-animation");
        });
        $("#sysInfoBtn").click(async () => {
            await mAdapter.getSysInfo();
            await mAdapter.getDashboardInfo();
        })

        //排程更新
        IButton.refreshSchedule({ manager, mAdapter, viewCtrl, panelSchedule });
        IButton.sendSchedule(mAdapter);

        $("#btn-batch").click(() => {
            new IModalBatch().show(proTable.db, proTable.manager);
        });

        panelConf.find(".block-refresh").click((element) => {
            mAdapter.getAssign();
        });

        balanceTable.confirm();

        dbTable.confirm();

        //連線ip資訊
        srvConnect.find(".block-refresh").click(async () => mAdapter.getSysLog());

        panelSchedule.find(".block-plus").click(() => {
            let schedule_thread = $(`#schedule-thread`);
            schedule_thread.empty();
            for (let [name, pid] of proTable.hashTables.entries()) {
                schedule_thread.append(new Option(String(name), String(pid), false));
            }
            $("#schedule_edit").modal('show');
        });
        $('#datetimepicker1').datetimepicker({
            autoclose: true,
            startDate: new Date(),
            pickerPosition:"bottom-left"
        });

        $("#schedule-thread").select2().on('select2:select', function (e) {
        });
        $("#schedule-behavior").select2().on('select2:select', function (e) {
        });
        $("#schedule-repeating").select2();


    };

    var onComplete = function (d) {
        let {event, error, message} = d;
        console.log(`event: ${event}`);
        if (error === 'authenticationRequired') {
            swal.fire({
                title: error,
                text: message
            });
            mAdapter.stop();
            return;
        }


        switch (event) {
            case "getServiceInfo":
            case "getClusterInfos":
                proTable.update(d.data, mAdapter);
                proc_duration = 5;
                break;
            case "getAssign":
                let {cluster } = d.data;
                confTable.update(cluster);
                IButton.collapse({panel: proPanel, visible: true});
                break;
            case "getLBGamePath":
            case "onGetLBGamePath":
                balanceTable.update(d.data).refresh().modal('show');
                balanceTable.enabled = true;
                break;
            case "getAMFConfig":
            case "onGetAMFConfig":
                dbTable.update(d.data).refresh().modal('show');
                dbTable.enabled = true;
                break;
            case "getIPFilter":
            case "onGetIPFilter":
                if (setting.connPanel != true) break;
                var deny = Object.keys(d.data.deny);
                iptable.update(deny, "blocking");
                break;
            case 'killCluster':
                let {pid, result} = d;
                alert.showAlert(result ? 'success': 'error');

                break;
            case "setLBGamePath":
            case "onSetLBGamePath":
                if (d.data == 1 || d.result == true) {
                    alert.showAlert("success");
                } else if (d.data == 0 || d.result == false) {
                    alert.showAlert("error");
                } else {
                    alert.showAlert("warning");
                }
                break;
            case "onGetSysLog":
            case "getDashboardInfo":
                proPanel.updateSysVisitors(d.data);
                proPanel.updateIncoming(d.data);

                setTimeout(() => {

                    if (typeof d.data.income == "undefined") return;

                    let keys = Object.keys(d.data.income);
                    let len  = keys.length;
                    let data = [];
                    while (--len >= 0) {
                        let ip = keys[len];
                        let count = (typeof d.data.income[ip] == "number") ?  d.data.income[ip] : d.data.income[ip][0];
                        let time = (typeof d.data.income[ip] == "number") ? null : d.data.income[ip][1];
                        data.push([len, ip, count, time]);
                    }
                    if (ipDataTable) ipDataTable.destroy();
                    ipDataTable = $("#srv-connect").DataTable({data, deferRender:true});
                }, 5000);
                break;
            case "getSysInfo":
                proPanel.updateSysHDD(d.data);
                proPanel.updateSysLoadAvg(d.data);
                proPanel.updateNetwork(d.data.snmp);
                proPanel.updateDevices(d.data.devices);
                break;
            case "onGetSchedule":
            case "getSchedule":
                proPanel.updateSchedule(d.data, mAdapter);
                break;
            case "onAddSchedule":
            case "onCancelSchedule":
            case "addSchedule":
            case "cancelSchedule":
                if (d.result) {alert.showAlert("success");}
                else {alert.showAlert("error");}
                proPanel.updateSchedule(d.data, mAdapter);
                break;
            case "result":
                if (d.data == 1) {
                    alert.showAlert("success");
                    if (d["action"] == "onEditAssign" || d["action"] == "onAddAssign" || d["action"] == "onDeleteAssign") {
                        mAdapter.getAssign();
                    }

                }else {
                    alert.showAlert("error");
                }
                break;
            default:
            {
                if (d.result === true) {
                    alert.showAlert("success");
                } else if (d.result === false) {
                    alert.showAlert("error");
                }
            }
        }
    };

    $(".sparkline").each(function () {
        var $this = $(this);
        $this.sparkline('html', $this.data());
    });
    //# setup cookie value
    let setting = new componentKit.ISettings();
    setting.start();

    // ip address blocking //
    delIPDenyClicked = function DelIPDenyClicked(id) {
        mAdapter.setIPFilter(iptable.data[id], false);
    };
    $("#btn-blocking-load").click(function () {
        mAdapter.getIPFilter();
    })
    $("#btn-blocking").click(async () => {
        let input = $("#input-blocking").val();
        let IPAddress = IConnect.regularIPv4(input);
        if (IPAddress) {
            console.log(`IPAddress => ${IPAddress} res: ${await mAdapter.setIPFilter(IPAddress, true)}`);
        }
    })
    let contentFrame = parent.document.getElementById("contentFrame");
    if (contentFrame) contentFrame.height = document.body.scrollHeight;
    let testing = new componentKit.ITesting()
        .init()
        .load();
};