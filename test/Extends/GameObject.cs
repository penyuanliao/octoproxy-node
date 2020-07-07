using System;

namespace bcConnect.ctrl
{
    public class RouGameInfo
    {
        public int? WinNumber;
        public dynamic Table;
        public int TotalTime;
        public int RemainingTime;
        public Boolean IsSuspended; //暫停
        public int RemainingRounds;
        public Boolean IsMuted; //靜音
        public dynamic Room;
        public dynamic CurrentCameraId;
        public int StateIndex;
        public Boolean Results;

        public RouGameInfo(dynamic items)
        {

            this.Table = items["Table"];

            this.StateIndex = (int)items["StateIndex"];

            this.TotalTime = (int)items["TotalTime"];

            this.RemainingTime = (int)items["RemainingTime"];

            this.IsSuspended = (Boolean)items["IsSuspended"];

            this.RemainingRounds = (int)items["RemainingRounds"];

            this.IsMuted = (Boolean)items["IsMuted"];

            this.Room = items["Room"];

            this.CurrentCameraId = items["CurrentCameraId"];

            this.Results = (items["WinNumber"] != null);

            if (this.Results)
            {
                this.WinNumber = (int)items["WinNumber"];
                Console.Write("[INFO] Round '{0}' Result:", this.Table["RoundId"]);
                Console.WriteLine(" <EndRound> Win Points:{0} ", items["WinNumber"]);
            }
        }
    }
}