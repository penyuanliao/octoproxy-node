
let IManagerConfig =
    {
        server: {
            //server被動等連線
            passive: {
                enabled: true,
                host: "0.0.0.0",
                port: 8100,
                // 提供HTTP Server
                web: true,
                // 是否聆聽port服務
                listen: true
            },
            //server主動連線
            active: {
                enabled: false,
                port: 8100,
                host: "127.0.0.1",
            },
        },
        client: {
            mode: "active",
            active: {
                host: "127.0.0.1",
                port: 8100
            },
            passive: {
                host: "0.0.0.0",
                port: 8100
            }
        },
        SIGNATURE: "284vu86"
    };

module.exports = exports = IManagerConfig;