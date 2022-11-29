
# Issue
```
# 有問題程序導到其他程序
# 模擬Red5服務, Apache服務
# configuration 設定規劃
```
//
```
Website Publishing Component : WPC 
WPC Logging Port : 10081
WPC HTTP Port : 10083
```

```
// -------------------------- //

#1 第一次要執行npm install
#2 sh startup.sh

# node_forever.sh 監聽服務是否活著

// -------------------------- //
```

```shell script
# config.js 設定檔案


```


// ------ 以下是紀錄 ------ //

### basicHeader Info
```
# basicHeader: 第一個字節 fmt(2b)

    + fmt -> readUInt8(0) >> 6; ex: 12.. .... 位移 6 取值
    (1) fmt = 0, header length = 12
    (2) fmt = 1, header length = 8
    (3) fmt = 2, header length = 4
    (4) fmt = 3, header length = 0

# basicHeader: 第一個字節 csid(chunk stream ID)(6b)

    + csid -> readUInt8(0) & (0x3f) ex: ..34 5678 mode 0x3f 最大值
    (1) csid = 0,1,2,3,4
    csid=0(2bytes)[64,319]
    csid=1(3bytes)[64, 65599]
    csid=2 控制訊息跟命令訊息
    csid=3 ~ 65599 自定義協定csid

# basicHeader: Cx04 Status
    + chunk = bodysize

# basicHeaer: Cx02 Status
    + 未知還沒處理

```
### ChannelID Info
 
 

amf0Encode -> amf0EncodeOne -> amfXEncodeOne

handshake::onResponse >




```script
+--------------+					+--------------+
| Client(Node) | 					| GrpcServer (FMS) |
+--------------+ 					+--------------+
	   |                                                    |
	   |                      C0 + C1                       |
	   |------------------------------------------------->  + handshake start
	   |                                                    |
	   |                    C0 + C1 + S2                    |
	   |  <-------------------------------------------------|
	   |                                                    |
	   |                         C2                         |
	   |------------------------------------------------->  + handshake ended
	   |                                                    |
	   |                 connect('rtmp server')             |
	   |------------------------------------------------->  |
	   |                                                    |
	   |         Window Acknowledgement Size 2500000        |
	   |  <-------------------------------------------------|
	   |                                                    |
	   |            Set Peer Bandwidth 25000000             |
	   |  <-------------------------------------------------|
	   |                                                    |
	   |                  Set Chunk Size 4096               |
	   |  <-------------------------------------------------|
	   |                                                    |
	   |       _result('NetConnection.Connect.Success')     |
	   +  <-------------------------------------------------| connect complete
	   |                                                    |
	   |        Windows Acknowledgement Size 2500000        |
	   |------------------------------------------------->  + #ACK-1 Start Record
	   |                                                    |
	   |                    createStream()                  |
	   |------------------------------------------------->  |
	   |                                                    |
	   |                      _result(1)                    |
	   +  <-------------------------------------------------| createStream complete
	   |                                                    |
	   |                      play(name)                    |
	   |------------------------------------------------->  |
	   |                                                    |
	   |                  Set Chunk Size 4096               |
	   |  <-------------------------------------------------|
	   |                                                    |
	   |                     Stream Begin 1                 |
	   +  <-------------------------------------------------| StreamID=1
	   |                                                    |
	   |           onStatus('NetStream.Play.Reset')         |
	   |  <-------------------------------------------------|
	   |                                                    |
	   |           onStatus('NetStream.Play.Start')         |
	   |  <-------------------------------------------------|
	   |                                                    |
	   |                |RtmpSampleAccess()                 |
	   |  <-------------------------------------------------|
	   |                                                    |
	   |                    onMetaData()                    |
	   +  <-------------------------------------------------+ Video Start
	   |                                                    |
	   |                     Video Data                     |
	   |  <-------------------------------------------------|
	   |                                                    |
	   |                     Video Data                     |
	   |  <-------------------------------------------------|
	   |                                                    |
	   |           Acknowledgement 1250123                  |
	   |------------------------------------------------->  + #ACK-2 Report
	   |                                                    |
	   |             Acknowledgement 2500123  		   		|
	   |------------------------------------------------->  + #ACK-3 Clinet total Chunk body Size >
	   |                                                    |
	   |                    Ping Request                    |
	   |  <-------------------------------------------------|
	   |                                                    |
	   |                    Ping Response                   |
	   |------------------------------------------------->  + Ping event
	   |                                                    |
	   |                  deleteStream()                    |
	   |------------------------------------------------->  + stop

```
### User Control Message (Type ID: 0x04) 

*Ping Request 
```txt
Length: 18 bytes
Event Tyep: Ping Request(6)
+-----+------+-----------+----------+--------+-----------+-------------------------+
| fmt | csid | timestamp | bodySize | typeid | stream id |        RTMP Body        |
+-----+------+-----------+----------+--------+-----------+-------------------------+
|  2b |  6b  |     3B    |    3B    |   1B   |     4B    | Event Type:2B, value:4B |
+-----+------+-----------+----------+--------+-----------+-------------------------+
|  0  |  02  |     00    |    06    |  0x04  |     00    |     ET:06, value:U32    |
+-----+------+-----------+----------+--------+-----------+-------------------------+
```

*Ping Response
```txt
Length: 14 bytes
Event Tyep: Ping Response(7)
Vlaue: The data on Ping Request Value.
+-----+------+-----------+----------+--------+-----------+-------------------------+
| fmt | csid | timestamp | bodySize | typeid | stream id |        RTMP Body        |
+-----+------+-----------+----------+--------+-----------+-------------------------+
|  2b |  6b  |     3B    |    3B    |   1B   |     4B    | Event Type:2B, value:4B |
+-----+------+-----------+----------+--------+-----------+-------------------------+
|  0  |  02  |     00    |    06    |  0x04  |     00    |     ET:07, value:U32    |
+-----+------+-----------+----------+--------+-----------+-------------------------+

```

*Buffer Ready
EventType = ReadUInt16BE(); // 2 Bytes

EventType = 0x1F(31) Stream Buffer Ready 
Value     = ReadUInt32BE(2); // 4 Bytes

Hex = "020000000000060400000000000f00000001"

<http://blog.csdn.net/leixiaohua1020/article/details/12972399>

### Audio Data Info (Type ID: 0x08)

### Video Data Info (Type ID: 0x09)
```
+----------+------------+
|  Header  |    Body    |
+----------+------------+
| 12B - 1B |   ~remain  |
+----------+------------+
    (1) Header
+---+----+---------+--------+---------+--------+
|fmt|csid|timestamp|bodySize|msgTypeID|StreamID|
+--------+---------+--------+---------+--------+
| 1B     | 3B      | 3B     | 1B      | 4B     |
+--------+---------+--------+---------+--------+
    (2) Body
+------+--------+-----------+
| type | Format | videoData |
+------+--------+-----------+
| 4b   | 4b     |  ~remain  |
+------+--------+-----------+
```


### Invoke Command
+-----+------+-----------+----------+--------+-----------+--------+
| fmt | csid | timestamp | bodySize | typeid | stream id |  body  |
+-----+------+-----------+----------+--------+-----------+--------+
|  2b |  6b  |     3B    |    3B    |   1B   |     4B    |        |
+-----+------+-----------+----------+--------+-----------+--------+
    (1) Body
     > Command-Name(AMF-String)
     > Transaction-Id(AMF-Number)
     > Command-Object(AMF-Object or AMF-Null)
     > InvokeArguments(AMF-ALL)
### onGetFPS()
````txt
Length: 28 bytes
Type ID: AMF0 Data (0x12)
+-----+------+-----------+----------+--------+---------------+--------+
| fmt | csid | Timestamp | BodySize | TypeID |       RTMP Body        |
+-----+------+-----------+----------+--------+---------------+--------+
|  1  |  04  |     00    |    20    |  0x12  | onGetFPS(11B) | 10(9B) |
+-----+------+-----------+----------+--------+---------------+--------+

````
### extends


### Stream Control

Video info(5) > Keyframe(1) > inter-frame(2)

```txt
Frame Type UB [4] (0000 ....)
Type of video frame. The following values are defined:
1 = key frame (for AVC, a seekable frame)
2 = inter frame (for AVC, a non-seekable frame)
3 = disposable inter frame (H.263 only)
4 = generated key frame (reserved for server use only)
5 = video info/command frame

CodecID UB [4] (.... 0000)
Codec Identifier. The following values are defined:
2 = Sorenson H.263
3 = Screen video
4 = On2 VP6
5 = On2 VP6 with alpha channel
6 = Screen video version 2
7 = AVC

AVCPacketType F UI8
The following values are defined:
0 = AVC sequence header
1 = AVC NALU
2 = AVC end of sequence (lower level NALU sequence ender is
not required or supported)
```


//http://www.kinmen.info/vic/study/game/game_01.htm



warp flow =>

manager => evt: startWarp -> child_process
child   => evt: warp_handle -> main_process
main    => evt: warp_socket -> child_process


