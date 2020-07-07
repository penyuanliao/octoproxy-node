
using LiveCasinoWSClient.Core.Models;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Reflection;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Security.Permissions;
using System.IO;
using bcConnect.ctrl;

namespace bcConnect
{
    class Program
    {
        static private LiveCasinoWSClient.Core.LiveCasinoWSClient euroClient;
        static private BCGameServer gameServer;
        public delegate void iDelegate();

        static byte[] BCBytes = new Byte[4096];

        static StreamWriter log;

        static int PartnerID = 510;

        static int TableID = 820;
        // static int TableID = 120; //rou
        static int SPort = 10012;
        
        static string delimiter = "\r";

        static string GameController = "Baccarat";

        public enum IContorllers {
            Baccarat = 0,
            Roulette = 1
        }

        static void Main(string[] args)
        {

            Console.WriteLine("-----------------------------------");
            if (args == null || args.Length == 0) {
                GameController = getController(TableID);
                Console.WriteLine(" ** 2019 BC Live Casino ** TableID:{0} Controller:{1}", TableID, GameController);
            } else
            {
                SPort = Int32.Parse(args[0]);
                TableID = Int32.Parse(args[1]);
                GameController = getController(TableID);
                Console.WriteLine(" ** 2019 BC Live Casino ** TableID:{0} Controller:{1}", TableID, GameController);
            }
            Console.WriteLine("-----------------------------------");
            Console.WriteLine(Environment.SpecialFolder.MyDocuments);
            log = new StreamWriter(Path.Combine(".", "BetResult.txt"));
            using (log)
            {
                //log.WriteLine("write something");
            }
            // string getLobbyCommandRid = GetLobbyCommand(client);
            // string lobbySubscriptionRid = SubscribeToLobby(client);
            // string tableStateSubscribtionRid = SubscribeToTableState(client);
            // Unsubscribe(client, lobbySubscriptionRid);

            /*
            string url = "http://www.google.com";
            try
            {
                WebProxy gProxy = new WebProxy("10.33.78.2", 3128);
                HttpWebRequest req = WebRequest.Create(url) as HttpWebRequest;
                req.Proxy = gProxy;
                req.Method = WebRequestMethods.Http.Get;
                WebResponse response = (WebResponse)req.GetResponse();
                
                Console.WriteLine("url response:{0}", ((HttpWebResponse)response).StatusCode);
                response.Close();
            }
            catch (WebException e)
            {
                Console.WriteLine("\r\nWebException Raised. The following error occured : {0}", e.Status);

                if (e.Status == WebExceptionStatus.ProtocolError && e.Response != null)
                {
                    var resp = (HttpWebResponse)e.Response;
                    Console.WriteLine("exp url response:{0}", ((HttpWebResponse)resp).StatusCode);

                    string result = "";
                    using (StreamReader sr = new StreamReader(resp.GetResponseStream()))
                    {
                        result = sr.ReadToEnd();
                        Console.WriteLine("result:{0}", result);
                    }
                }

            }
            catch (Exception e) 
            {
                Console.WriteLine("\nThe following Exception was raised : {0}",e.Message);
            }
            */

            setupCasino();
            setupServer();

            Console.ReadLine();
        }
        static void setupServer()
        {
            Console.WriteLine(gameServer);

            gameServer = new BCGameServer();

            gameServer.incidentEventHandler += new EventHandler(callIncidentCmd);
            
            gameServer.setup(SPort);
        }
        static string getController(int tableID) {
            if (tableID == 120) return "Roulette";
            return "Baccarat";
        }
        static void setupCasino()
        {
            // string url = "http://rgs-livedealerwebsocket-tw.betintegration.com";
            // string url = "https://rgs-livedealerwebsocket-hk2.betintegration.com";
            string url = "http://rgs-livedealerwebsocket-tw.betintegration.com";
            // url = "https://rgs-livedealerwebsocket-hk1.betintegration.com";
            //url = "http://94.130.82.233:8001";
            Console.WriteLine(" ----- Start setupCasino url:{0} ----- ", url);
            Dictionary<string, string> headers = new Dictionary<string, string>();
            headers.Add("Host", "10.33.78.2:3128");
            euroClient = new LiveCasinoWSClient.Core.LiveCasinoWSClient(url, headers);
            euroClient.SetGlobalErrorHandler((sender, eventArgs) =>
            {
                Console.WriteLine("GLOBAL ERROR!");
                Console.WriteLine(eventArgs.ErrorMessage);
            });
            string rid = subscribeToTable(euroClient);
            //string lobbyRid = SubscribeToLobby(euroClient);
            //string cmdRid = GetLobbyCommand(euroClient);
            //GetIncidentCommand(euroClient, null, null, null);
        }
        /* (1) */
        static string subscribeToTable(LiveCasinoWSClient.Core.LiveCasinoWSClient client)
        {
            Console.WriteLine(" ----- Start subscribeToTable Partner:{0} ----- ", PartnerID);
            string rid = client.Subscribe(
                new ApiUrlParams(
                    PartnerID,  //Partner Id
                    GameController,  //Controller
                    "GetCommonTableState",  //Action
                    "en" //Language
                ),
                new { tableId = TableID, limitCategoryId = 1 }, // Query params
                new { }, // Custom Headers
                (sender, eventArgs) => //Error Handler
                {
                    Console.WriteLine("[INFO] 1.getCommonTableState({0}:{1}) Table State Success!", GameController, TableID);
                    // Console.WriteLine(eventArgs.Body);
                    if (Enum.GetName(typeof(IContorllers), IContorllers.Baccarat) == GameController)
                    {
                        GameInfo info = new GameInfo((dynamic)eventArgs.Body);
                        string json = JsonConvert.SerializeObject(info);
                        BCBytes = Encoding.UTF8.GetBytes(json);
                        // Console.WriteLine("Body.JSON:{0}", json);
                        gameServer.boardcast(BCBytes);
                    }
                    else
                    {
                        RouGameInfo info = new RouGameInfo((dynamic)eventArgs.Body);
                        string json = JsonConvert.SerializeObject(info);
                        BCBytes = Encoding.UTF8.GetBytes(json);
                        //Console.WriteLine("Body.JSON:{0}", json);
                        gameServer.boardcast(BCBytes);
                    }

                },
                (sender, eventArgs) => //Error Handler
                {
                    Console.WriteLine("[INFO] 1.getCommonTableState({0}) Table State Error!", TableID);
                    Console.WriteLine(eventArgs.ErrorMessage);
                },
                true //Is Common Action, false if data is player/partner specific, false otherways
            );

            return rid;
        }
        /* (2) */
        static string SubscribeToLobby(LiveCasinoWSClient.Core.LiveCasinoWSClient client)
        {
            Console.WriteLine("----- Start SubscribeToLobby -----");
            //Return the Request Id of the subscribtion
            string rid = client.Subscribe(
                new ApiUrlParams(
                    PartnerID,  //Partner Id
                    "Partner",  //Controller 
                    "GetLobby", //Action 
                    "en" //Langugage
                ),
                new { }, //Query params
                new { }, //Custom headers
                (sender, eventArgs) =>  //Success handler
                {
                    Console.WriteLine("2. SubscribeToLobby() Success!");
                    Console.WriteLine(eventArgs.Body);
                },
               (sender, eventArgs) =>  //Error handler
               {
                   Console.WriteLine("SubscribeToLobby() Error!");
                   Console.WriteLine(eventArgs.ErrorMessage);
               },
               true //Is Common Action, false if data is player/partner specific, false otherways
            );

            return rid;
        }
        /*3*/
        static string GetLobbyCommand(LiveCasinoWSClient.Core.LiveCasinoWSClient client)
        {
            Console.WriteLine("----- Start GetLobbyCommand -----");
            //Return the Request id of the command
            string rid = client.Command(
                "POST", //Method  GET, POST
                new ApiUrlParams(
                    PartnerID,  //Partner Id
                    "Application",  //Controller 
                    "InitSession", //Action 
                    "en" //Langugage
                ),
                new { limitCategoryId = 1, tableId = TableID, terminateActiveSessions = false }, //Query params
                new { LocalTime = "2019-04-03 12:06:55+04:00", PlatformType = "0" }, //Data  (if method is POST)
                new { }, //Custom headers
                (sender, eventArgs) =>  //Success handler
                {
                    Console.WriteLine("[INFO] InitSession Success! {0}");
                    Console.WriteLine(eventArgs.Body);
                    dynamic smDynamic = eventArgs.Body;

                    client.Command(
                        "GET", //Method  GET, POST
                        new ApiUrlParams(
                            PartnerID,  //Partner Id
                            "Baccarat",  //Controller 
                            "GetStartupInfo", //Action 
                            "en" //Langugage
                        ),
                        new { limitCategoryId = 1, tableId = TableID }, //Query params
                        new { }, //Data  (if method is POST)
                        new { sid = smDynamic["SessionId"], bid = smDynamic["BrowserId"] }, //Custom headers
                        (sender1, eventArgs1) =>  //Success handler
                        {
                            Console.WriteLine("GetStartupInfo Success!");
                            Console.WriteLine(eventArgs1.Body);
                        },
                        (sender1, eventArgs1) =>  //Error handler
                        {
                            Console.WriteLine("GetStartupInfo Error!");
                            Console.WriteLine(eventArgs1.ErrorMessage);
                        }
                    );

                },
               (sender, eventArgs) =>  //Error handler
               {
                   Console.WriteLine("[INFO] GetLobbyCommand() GetLobby Error!");
                   Console.WriteLine(eventArgs.ErrorMessage);
               }
            );

            return rid;
        }
        static void Unsubscribe(LiveCasinoWSClient.Core.LiveCasinoWSClient client, string rid)
        {
            Console.WriteLine("Unsubscribe" + rid);
            client.Unsubscribe(rid);
        }
        /** 遊戲註銷清單事件 **/
        static void GetIncidentCommand(LiveCasinoWSClient.Core.LiveCasinoWSClient client, int? roundId, DateTime? startDate, DateTime? endDate)
        {
            Console.WriteLine(" ----- Model IncidentCommand Partner:{0} TableID:{1} ----- ", PartnerID, TableID);
            string rid = client.Command(
                "GET", //Method  GET, POST
                new ApiUrlParams(
                    PartnerID,  //Partner Id
                    "Partner",  //Controller 
                    "GetIncidentList", //Action 
                    "en" //Langugage
                ),
                new { roundId = roundId, startDate = startDate, endDate = endDate, tableId = TableID }, //Query params
                new { }, //Custom headers
                new { }, //Data  (if method is POST)
                (sender, eventArgs) =>  //Success handler
                {
                    Console.WriteLine("[INFO] IncidentCommand(Partner:{0} TableID:{1}) Table State Success!", PartnerID, TableID);
                    Console.WriteLine(eventArgs.Body);
                    IncidentObject obj = new IncidentObject();
                    foreach (var item in (dynamic) eventArgs.Body)
                    {
                        IncidentInfo info = new IncidentInfo(item);

                        obj.data.Add(info);

                    };

                    string json = JsonConvert.SerializeObject(obj);
                    BCBytes = Encoding.UTF8.GetBytes(json);
                    gameServer.boardcast(BCBytes);
                },
               (sender, eventArgs) =>  //Error handler
               {
                   Console.WriteLine("[INFO] IncidentCommand(Partner:{0} TableID:{1}) GetLobby Error!", PartnerID, TableID);
                   Console.WriteLine(eventArgs.ErrorMessage);
               }
            );
        }
        static void callIncidentCmd(object sender, EventArgs e)
        {
            int roundId = (e as IncidentEventArgs).roundId;
            Console.WriteLine("[INFO] callIncidentCmd args.roundId: {0}", roundId);
            GetIncidentCommand(euroClient, roundId, null, null);
        }
    }
    public class BCGameServer
    {
        Socket[] Socks;
        ArrayList socketList = new ArrayList();
        int sockCIndex;

        IPAddress locIP = IPAddress.Parse("0.0.0.0");
        Int32 port = 8760;
        int dateLen = 5;
        TcpListener server = null;

        public static string data = null;
        static Socket listenSocket;
        /* delegate event */
        public event EventHandler incidentEventHandler;

        public BCGameServer()
        {
            Console.WriteLine("init BCGameServer");
        }
        public void setup(int sPort)
        {
            // 定義接收數據長度變量
            // int recv;
            // Data buffer for incoming data.  
            byte[] bytes = new Byte[1024];

            int backlog = 10;

            IPAddress hostName = IPAddress.Any;
            // listen port
            int port = sPort;
            //定義偵聽端口
            IPEndPoint ipEnd = new IPEndPoint(hostName, port);
            // create the socket
            listenSocket = new Socket(AddressFamily.InterNetwork,
                                        SocketType.Stream,
                                        ProtocolType.Tcp);
            //連接                   
            listenSocket.Bind(ipEnd);
            //開始偵聽
            listenSocket.Listen(backlog);
            Console.WriteLine("Starting...{0}", ipEnd);

            while (true)
            {
                Console.WriteLine("Waiting for a connection... ");
                // Perform a blocking call to accept requests.
                // You could also user server.AcceptSocket() here.
                Socket client = listenSocket.Accept();

                if (client.Connected)
                {
                    //獲取客戶端的IP和端口
                    IPEndPoint ipEndClient = (IPEndPoint)client.RemoteEndPoint;
                    //輸出客戶端的IP和端口
                    Console.WriteLine("Connect with {0} at Port {1}", ipEndClient.Address, ipEndClient.Port);
                    //初始化
                    // setupClient(client);
                    socketList.Add(client);
                    //創建一個通信線程 
                    ParameterizedThreadStart pts = new ParameterizedThreadStart(setupClient);
                    Thread thread = new Thread(pts);
                    //設置為後臺線程，隨著主線程退出而退出 
                    thread.IsBackground = true;
                    //啟動線程
                    thread.Start(client);
                    
                }

            }

        }
        public void setupTCPClient()
        {
            string hostName = Dns.GetHostName();
            IPAddress ip = IPAddress.Parse("127.0.0.1");

            server = new TcpListener(locIP, port);
            // Start listening for client requests.
            server.Start();

            Console.WriteLine("ip:" + ip);
            // Buffer for reading data
            Byte[] bytes = new Byte[256];
            // String data = null;
            // Enter the listening loop.
            while (true)
            {
                Console.Write("Waiting for a connection... ");


                TcpClient client = server.AcceptTcpClient();
                if (client.Connected)
                {
                    //setupClient(client);
                }
            }
        }
        private void setupClient(object sClient)
        {
            Socket client = sClient as Socket;
            int recv = 0;
            // Buffer for reading data
            Byte[] bytes = new Byte[256];
            // String data = null;
            // Enter the listening loop.

            Console.WriteLine("Client setupClient!");
            // Loop to receive all the data sent by the client.
            while (true)
            {
                // clean 
                bytes = new byte[1024];
                // 資料長度
                recv = client.Receive(bytes);
                if (recv == 0) break;
                //output message
                String msg = Encoding.UTF8.GetString(bytes, 0, recv);
                dynamic json = JsonConvert.DeserializeObject(msg);
                Console.WriteLine("[INFO] message: {0}", json["rule"]);
                if ((String)json["rule"] == "/bcLive") {
                    RejectObject rej = new RejectObject();
                    rej.act = "onTable";
                    rej.res = true;
                    String str = JsonConvert.SerializeObject(rej);
                    byte[] rejBufs = Encoding.UTF8.GetBytes(str);
                    client.Send(rejBufs, rejBufs.Length, SocketFlags.None);
                } else if ((String)json["rule"] == "/bcIncident") {
                    IncidentEventArgs incident = new IncidentEventArgs(){
                        roundId = (int)json["roundId"]
                    };
                    callIncidentEventHandler(incident);
                }

            }
            // Shutdown and end connection
            client.Close();
            socketList.Remove(client);
            Console.WriteLine("client destroy()");

        }
        public void call(Socket client, object items)
        {
            //定義待發送字符
            string json = JsonConvert.SerializeObject(items);
            //數據類型轉換
            byte[] bytes = Encoding.UTF8.GetBytes(json);
            //發送
            client.Send(bytes, bytes.Length, SocketFlags.None);
        }
        public void boardcast(byte[] bytes)
        {
            foreach (Socket client in socketList)
            {
                Console.Write("' ------ boardcast ------ '");
                Console.WriteLine("Len:{0}", bytes.Length);
                
                if (client.Connected)
                {
                    client.Send(bytes, bytes.Length, SocketFlags.None);
                }
                else
                {
                    socketList.Remove(client);
                }

            }
        }
        public void callIncidentEventHandler(IncidentEventArgs e)
        {
            incidentEventHandler(this, e);
        }

    }
    public class IncidentEventArgs: EventArgs
    {
        public int roundId {get; set;}
        public int startDate { get; set; }
        public int endDate { get; set; }
    }
    public class Sample
    {

        public int age { get; set; }

        public string name { get; set; }

        public Sample(int age, string name)
        {
            this.age = age;
            this.name = name;

        }
    }
    public struct RejectObject
    {
        public String act { get; set; }
        public Boolean res { get; set; }
    }


    public class GameInfo
    {
        public int PlayerPoints { get; set; }
        public int BankerPoints { get; set; }
        public JArray PlayerCards { get; set; }
        public JArray BankerCards { get; set; }
        public int TotalTime;
        public int RemainingTime;
        public int StateIndex;
        public dynamic Table;

        public Boolean IsSuspended; //暫停
        public Boolean MustShuffle; //洗牌
        public Boolean Results;

        public GameInfo(dynamic items)
        {
            this.PlayerPoints = (int)items["PlayerPoints"];
            
            this.BankerPoints = (int)items["BankerPoints"];

            this.PlayerCards = (JArray)items["PlayerCards"];

            this.BankerCards = (JArray)items["BankerCards"];

            this.Table = items["Table"];

            this.StateIndex = (int)items["StateIndex"];

            this.TotalTime = (int)items["TotalTime"];

            this.RemainingTime = (int)items["RemainingTime"];

            this.IsSuspended = (Boolean)items["IsSuspended"];

            this.MustShuffle = (Boolean)items["MustShuffle"];

            if (items["Results"] != null) {
                this.Results = true;
            }
            else
            {
                this.Results = false;
            }

            if (this.PlayerPoints != 0 || this.BankerPoints != 0) {
                Console.Write("[INFO] Round '{0}' Result:", this.Table["RoundId"]);
                Console.Write(" <Player> Points:{0} Cards: [{1}]", items["PlayerPoints"], String.Join(",", this.PlayerCards));
                Console.WriteLine(" <Banker> Points: {0} Cards: [{1}]", items["BankerPoints"], String.Join(",", this.BankerCards));
            }

        }
    }

    public class IncidentInfo
    {
        public string Text { get; set; }
        public int? TableId { get; set; }  //預設可Null
        public long? RoundId { get; set; }
        public string TableName { get; set; }
        public string TypeName { get; set; }

        public IncidentInfo(dynamic items) 
        {
            this.Text = (string)items["Text"];
            this.TableId = (int?)items["TableId"];
            this.RoundId = (long?)items["RoundId"];
            this.TableName = (string)items["TableName"];
            this.TypeName = (string)items["TypeName"];
        }
    }
    public class IncidentObject
    {
        public string cmd { get; set; }
        public ArrayList data { get; set; }
        public IncidentObject()
        {
            this.cmd = "onIncident";
        }
    }
    
}
