using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

class Activity
{
    public string id { get; set; }
    public string name { get; set; }
    public string emoji { get; set; }
    public string color { get; set; }
    public string blurb { get; set; }
}

class Vote
{
    public string voterId { get; set; }
    public string name { get; set; }
    public string activityId { get; set; }
    public long at { get; set; }
}

class Room
{
    public string id { get; set; }
    public string hostToken { get; set; }
    public long createdAt { get; set; }
    public bool closed { get; set; }
    public List<Vote> votes { get; set; }
}

class Database
{
    public Dictionary<string, Room> rooms { get; set; }
}

class Reply
{
    public int Status;
    public string ContentType;
    public byte[] Bytes;
}

class HttpReq
{
    public string Method;
    public string Path;
    public string Body;
}

class Program
{
    static readonly string Root = AppDomain.CurrentDomain.BaseDirectory;
    static readonly string PublicDir = Path.Combine(Root, "public");
    static readonly string DataFile = Path.Combine(Root, "data", "rooms.json");
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly object Gate = new object();
    static readonly Regex RoomPattern = new Regex("^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$");
    static readonly Regex VoterPattern = new Regex("^[A-Za-z0-9-]{8,64}$");
    static readonly Regex TunnelPattern = new Regex(@"https://[A-Za-z0-9-]+\.trycloudflare\.com");

    static Database db = new Database();
    static List<Activity> activities = new List<Activity>();
    static string publicUrl = "";
    static Process tunnel;
    static Mutex mutex;

    static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.Title = "团建幸运大转盘";
        Json.MaxJsonLength = 8 * 1024 * 1024;

        bool createdNew;
        mutex = new Mutex(true, "Local\\TeamWheelLucky", out createdNew);
        if (!createdNew)
        {
            Console.WriteLine("转盘已经在运行，直接打开浏览器即可。");
            if (!HasFlag(args, "--no-browser")) OpenBrowser("http://127.0.0.1:3780/");
            return 0;
        }

        try
        {
            LoadActivities();
            LoadDatabase();
        }
        catch (Exception ex)
        {
            Console.WriteLine("启动失败：" + ex.Message);
            return 1;
        }

        TcpListener listener = null;
        var port = 0;
        for (var p = 3780; p <= 3789; p++)
        {
            try
            {
                var candidate = new TcpListener(IPAddress.Any, p);
                candidate.Start();
                listener = candidate;
                port = p;
                break;
            }
            catch
            {
                continue;
            }
        }
        if (listener == null)
        {
            Console.WriteLine("端口 3780-3789 都无法打开。");
            return 1;
        }

        var mode = "all";
        var addresses = LanAddresses();
        Console.WriteLine("团建幸运大转盘正在运行");
        Console.WriteLine("不要关闭这个窗口，关掉后大家就进不来了。");
        Console.WriteLine("本机打开  http://127.0.0.1:" + port + "/");
        for (var i = 0; i < addresses.Count; i++)
        {
            Console.WriteLine("同一 Wi-Fi  http://" + addresses[i] + ":" + port + "/");
        }
        if (addresses.Count == 0)
        {
            Console.WriteLine("没有发现局域网地址，手机可能打不开。");
        }

        StartTunnel(port);

        if (!HasFlag(args, "--no-browser")) OpenBrowser("http://127.0.0.1:" + port + "/");

        Console.CancelKeyPress += delegate { StopTunnel(); };
        try
        {
            while (true)
            {
                TcpClient client;
                try { client = listener.AcceptTcpClient(); }
                catch { break; }
                ThreadPool.QueueUserWorkItem(delegate (object state)
                {
                    var tcp = (TcpClient)state;
                    try { ServeClient(tcp, port, mode, addresses); }
                    catch (Exception ex) { Console.WriteLine(ex.Message); }
                    finally { try { tcp.Close(); } catch { } }
                }, client);
            }
        }
        finally
        {
            StopTunnel();
            listener.Stop();
        }
        return 0;
    }

    static void ServeClient(TcpClient tcp, int port, string mode, List<string> addresses)
    {
        tcp.ReceiveTimeout = 8000;
        tcp.SendTimeout = 8000;
        var stream = tcp.GetStream();
        var req = ReadHttp(stream);
        if (req == null) return;
        Reply reply;
        try { reply = Handle(req, port, mode, addresses); }
        catch (Exception ex)
        {
            Console.WriteLine(ex.Message);
            reply = BytesReply(500, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("error"));
        }
        WriteHttp(stream, reply);
    }

    static bool HasFlag(string[] args, string flag)
    {
        if (args == null) return false;
        for (var i = 0; i < args.Length; i++)
        {
            if (string.Equals(args[i], flag, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    static void OpenBrowser(string url)
    {
        try { Process.Start(url); }
        catch { }
    }

    static List<string> LanAddresses()
    {
        var found = new List<string>();
        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (nic.OperationalStatus != OperationalStatus.Up) continue;
            foreach (var addr in nic.GetIPProperties().UnicastAddresses)
            {
                if (addr.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                var ip = addr.Address.ToString();
                if (ip.StartsWith("127.")) continue;
                if (ip.StartsWith("169.254.")) continue;
                if (!found.Contains(ip)) found.Add(ip);
            }
        }
        found.Sort(delegate (string a, string b)
        {
            return Rank(a) - Rank(b);
        });
        return found;
    }

    static int Rank(string ip)
    {
        if (ip.StartsWith("192.168.")) return 0;
        if (ip.StartsWith("10.")) return 1;
        return 2;
    }

    static void LoadActivities()
    {
        var path = Path.Combine(Root, "activities.json");
        var text = ReadUtf8(path);
        activities = Json.Deserialize<List<Activity>>(text);
        if (activities == null || activities.Count == 0) throw new Exception("activities.json 是空的");
    }

    static void LoadDatabase()
    {
        Directory.CreateDirectory(Path.Combine(Root, "data"));
        if (!File.Exists(DataFile))
        {
            db = new Database();
            db.rooms = new Dictionary<string, Room>();
            SaveDatabase();
            return;
        }
        try
        {
            db = Json.Deserialize<Database>(ReadUtf8(DataFile));
        }
        catch
        {
            db = new Database();
        }
        if (db == null) db = new Database();
        if (db.rooms == null) db.rooms = new Dictionary<string, Room>();
        foreach (var room in db.rooms.Values)
        {
            if (room.votes == null) room.votes = new List<Vote>();
        }
    }

    static void SaveDatabase()
    {
        var tmp = DataFile + ".tmp";
        File.WriteAllText(tmp, Json.Serialize(db), new UTF8Encoding(false));
        if (File.Exists(DataFile)) File.Replace(tmp, DataFile, null);
        else File.Move(tmp, DataFile);
    }

    static string ReadUtf8(string path)
    {
        var text = File.ReadAllText(path, Encoding.UTF8);
        if (text.Length > 0 && text[0] == '\uFEFF') text = text.Substring(1);
        return text;
    }

    static void StartTunnel(int port)
    {
        var exe = Path.Combine(Root, "cloudflared.exe");
        if (!File.Exists(exe)) return;
        try
        {
            var psi = new ProcessStartInfo();
            psi.FileName = exe;
            psi.Arguments = "tunnel --url http://127.0.0.1:" + port + " --no-autoupdate";
            psi.UseShellExecute = false;
            psi.RedirectStandardError = true;
            psi.RedirectStandardOutput = true;
            psi.CreateNoWindow = true;
            tunnel = Process.Start(psi);
            DataReceivedEventHandler onLine = delegate (object sender, DataReceivedEventArgs e)
            {
                if (e.Data == null) return;
                var match = TunnelPattern.Match(e.Data);
                if (!match.Success) return;
                if (publicUrl.Length > 0) return;
                publicUrl = match.Value;
                Console.WriteLine("群链接    " + publicUrl);
                try { File.WriteAllText(Path.Combine(Root, "data", "tunnel-url.txt"), publicUrl, new UTF8Encoding(false)); }
                catch { }
            };
            tunnel.OutputDataReceived += onLine;
            tunnel.ErrorDataReceived += onLine;
            tunnel.BeginOutputReadLine();
            tunnel.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            Console.WriteLine("外网链接没能打开：" + ex.Message);
        }
    }

    static void StopTunnel()
    {
        try
        {
            if (tunnel != null && !tunnel.HasExited) tunnel.Kill();
        }
        catch { }
    }

    static Reply Handle(HttpReq req, int port, string mode, List<string> addresses)
    {
        var path = req.Path ?? "/";
        var method = string.IsNullOrEmpty(req.Method) ? "GET" : req.Method;

        if (path == "/api/meta" && method == "GET")
        {
            var urls = new List<string>();
            for (var i = 0; i < addresses.Count; i++) urls.Add("http://" + addresses[i] + ":" + port);
            var tunnelExe = Path.Combine(Root, "cloudflared.exe");
            var tunnelState = "off";
            if (File.Exists(tunnelExe)) tunnelState = publicUrl.Length > 0 ? "ready" : "pending";
            return JsonReply(200, new
            {
                activities = activities,
                port = port,
                mode = mode,
                addresses = urls,
                publicUrl = publicUrl,
                tunnel = tunnelState
            });
        }

        if (path == "/api/rooms" && method == "POST")
        {
            Room room;
            lock (Gate)
            {
                room = new Room();
                room.id = NewRoomId();
                room.hostToken = NewToken();
                room.createdAt = Now();
                room.closed = false;
                room.votes = new List<Vote>();
                db.rooms[room.id] = room;
                SaveDatabase();
            }
            Console.WriteLine("新房间 " + room.id);
            return JsonReply(200, new { id = room.id, hostToken = room.hostToken });
        }

        var match = Regex.Match(path, "^/api/rooms/([A-Za-z0-9]{4})(?:/(spin|close|reopen|reset))?$");
        if (match.Success)
        {
            var id = match.Groups[1].Value.ToUpperInvariant();
            var action = match.Groups[2].Value;
            if (!RoomPattern.IsMatch(id)) return JsonReply(400, Err("bad_room"));
            if (method == "GET" && action.Length == 0)
            {
                object payload = null;
                var missing = false;
                lock (Gate)
                {
                    var found = Find(id);
                    if (found == null) missing = true;
                    else payload = PublicRoom(found);
                }
                if (missing) return JsonReply(404, Err("room_not_found"));
                return JsonReply(200, payload);
            }
            if (method == "POST" && action == "spin") return Spin(req.Body, id);
            if (method == "POST" && (action == "close" || action == "reopen" || action == "reset"))
            {
                return HostAction(req.Body, id, action);
            }
        }

        if (method != "GET" && method != "HEAD") return JsonReply(404, Err("not_found"));
        return ServeStatic(path);
    }

    static Reply Spin(string rawBody, string id)
    {
        var body = ParseBody(rawBody);
        var name = Str(body, "name").Trim();
        var voterId = Str(body, "voterId").Trim();
        if (!ValidName(name))
        {
            return JsonReply(400, Err(name.Length == 0 ? "name_required" : "name_invalid"));
        }
        if (!VoterPattern.IsMatch(voterId))
        {
            return JsonReply(400, Err("bad_voter"));
        }

        int status = 200;
        object payload = null;
        lock (Gate)
        {
            var room = Find(id);
            if (room == null)
            {
                status = 404;
                payload = Err("room_not_found");
            }
            else if (room.closed)
            {
                status = 403;
                payload = Err("closed");
            }
            else if (room.votes.Count >= 300)
            {
                status = 400;
                payload = Err("room_full");
            }
            else
            {
                Vote existing = null;
                Vote sameName = null;
                for (var i = 0; i < room.votes.Count; i++)
                {
                    if (room.votes[i].voterId == voterId) existing = room.votes[i];
                    if (room.votes[i].name == name) sameName = room.votes[i];
                }
                if (existing != null)
                {
                    status = 409;
                    payload = new { error = "already_voted", activityId = existing.activityId, name = existing.name };
                }
                else if (sameName != null)
                {
                    status = 409;
                    payload = Err("name_taken");
                }
                else
                {
                    var index = RandomIndex(activities.Count);
                    var activity = activities[index];
                    var vote = new Vote();
                    vote.voterId = voterId;
                    vote.name = name;
                    vote.activityId = activity.id;
                    vote.at = Now();
                    room.votes.Add(vote);
                    SaveDatabase();
                    status = 200;
                    payload = new { index = index, activity = activity, room = PublicRoom(room) };
                    Console.WriteLine(room.id + "  " + name + " -> " + activity.name);
                }
            }
        }
        return JsonReply(status, payload);
    }

    static Reply HostAction(string rawBody, string id, string action)
    {
        var token = Str(ParseBody(rawBody), "hostToken");
        int status = 200;
        object payload = null;
        lock (Gate)
        {
            var room = Find(id);
            if (room == null)
            {
                status = 404;
                payload = Err("room_not_found");
            }
            else if (token.Length == 0 || token != room.hostToken)
            {
                status = 403;
                payload = Err("forbidden");
            }
            else
            {
                if (action == "close") room.closed = true;
                if (action == "reopen") room.closed = false;
                if (action == "reset")
                {
                    room.votes = new List<Vote>();
                    room.closed = false;
                }
                SaveDatabase();
                payload = PublicRoom(room);
                Console.WriteLine(room.id + "  " + action);
            }
        }
        return JsonReply(status, payload);
    }

    static Room Find(string id)
    {
        Room room;
        if (db.rooms.TryGetValue(id, out room)) return room;
        return null;
    }

    static object PublicRoom(Room room)
    {
        var votes = new List<object>();
        for (var i = 0; i < room.votes.Count; i++)
        {
            var vote = room.votes[i];
            votes.Add(new { name = vote.name, activityId = vote.activityId, at = vote.at });
        }
        return new
        {
            id = room.id,
            closed = room.closed,
            createdAt = room.createdAt,
            votes = votes,
            voterCount = room.votes.Count
        };
    }

    static object Err(string code)
    {
        return new { error = code };
    }

    static Dictionary<string, object> ParseBody(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return new Dictionary<string, object>();
        if (text.Length > 8192) text = text.Substring(0, 8192);
        try
        {
            var parsed = Json.DeserializeObject(text) as Dictionary<string, object>;
            if (parsed == null) return new Dictionary<string, object>();
            return parsed;
        }
        catch
        {
            return new Dictionary<string, object>();
        }
    }

    static string Str(Dictionary<string, object> body, string key)
    {
        if (body == null) return "";
        object value;
        if (!body.TryGetValue(key, out value) || value == null) return "";
        return Convert.ToString(value);
    }

    static bool ValidName(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return false;
        if (name.Length < 1 || name.Length > 12) return false;
        foreach (var ch in name)
        {
            if (char.IsControl(ch)) return false;
        }
        return true;
    }

    static string NewRoomId()
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        for (var guard = 0; guard < 30; guard++)
        {
            var bytes = new byte[4];
            using (var rng = new RNGCryptoServiceProvider()) rng.GetBytes(bytes);
            var chars = new char[4];
            for (var i = 0; i < 4; i++) chars[i] = alphabet[bytes[i] % alphabet.Length];
            var id = new string(chars);
            if (!db.rooms.ContainsKey(id)) return id;
        }
        return Guid.NewGuid().ToString("N").Substring(0, 4).ToUpperInvariant();
    }

    static string NewToken()
    {
        var bytes = new byte[16];
        using (var rng = new RNGCryptoServiceProvider()) rng.GetBytes(bytes);
        var sb = new StringBuilder(32);
        for (var i = 0; i < bytes.Length; i++) sb.Append(bytes[i].ToString("x2"));
        return sb.ToString();
    }

    static int RandomIndex(int count)
    {
        var bytes = new byte[4];
        using (var rng = new RNGCryptoServiceProvider()) rng.GetBytes(bytes);
        var value = BitConverter.ToUInt32(bytes, 0);
        return (int)(value % (uint)count);
    }

    static long Now()
    {
        return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
    }

    static Reply ServeStatic(string path)
    {
        if (path == "/") path = "/index.html";
        var rel = path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
        var full = Path.GetFullPath(Path.Combine(PublicDir, rel));
        var root = Path.GetFullPath(PublicDir);
        if (!root.EndsWith(Path.DirectorySeparatorChar.ToString())) root = root + Path.DirectorySeparatorChar;
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
        {
            return BytesReply(404, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("404"));
        }
        return BytesReply(200, Mime(Path.GetExtension(full)), File.ReadAllBytes(full));
    }

    static string Mime(string ext)
    {
        ext = (ext ?? "").ToLowerInvariant();
        if (ext == ".html") return "text/html; charset=utf-8";
        if (ext == ".css") return "text/css; charset=utf-8";
        if (ext == ".js") return "text/javascript; charset=utf-8";
        if (ext == ".json") return "application/json; charset=utf-8";
        if (ext == ".svg") return "image/svg+xml";
        if (ext == ".png") return "image/png";
        return "application/octet-stream";
    }

    static Reply JsonReply(int status, object body)
    {
        return BytesReply(status, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(Json.Serialize(body)));
    }

    static Reply BytesReply(int status, string type, byte[] bytes)
    {
        var reply = new Reply();
        reply.Status = status;
        reply.ContentType = type;
        reply.Bytes = bytes ?? new byte[0];
        return reply;
    }

    static HttpReq ReadHttp(NetworkStream stream)
    {
        var buffer = new MemoryStream();
        var chunk = new byte[4096];
        var headerEnd = -1;
        while (buffer.Length < 65536)
        {
            int read;
            try { read = stream.Read(chunk, 0, chunk.Length); }
            catch { return null; }
            if (read <= 0) break;
            buffer.Write(chunk, 0, read);
            headerEnd = FindBytes(buffer.GetBuffer(), (int)buffer.Length);
            if (headerEnd >= 0) break;
        }
        if (headerEnd < 0) return null;
        var all = buffer.ToArray();
        var head = Encoding.ASCII.GetString(all, 0, headerEnd);
        var lines = head.Split(new string[] { "\r\n" }, StringSplitOptions.None);
        if (lines.Length == 0) return null;
        var parts = lines[0].Split(' ');
        if (parts.Length < 2) return null;
        var contentLength = 0;
        for (var i = 1; i < lines.Length; i++)
        {
            if (lines[i].StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
            {
                int.TryParse(lines[i].Substring(15).Trim(), out contentLength);
            }
        }
        if (contentLength < 0) contentLength = 0;
        if (contentLength > 8192) contentLength = 8192;
        var bodyStart = headerEnd + 4;
        var have = all.Length - bodyStart;
        var bodyBytes = new byte[contentLength];
        var copied = 0;
        if (have > 0 && contentLength > 0)
        {
            var take = have < contentLength ? have : contentLength;
            Buffer.BlockCopy(all, bodyStart, bodyBytes, 0, take);
            copied = take;
        }
        while (copied < contentLength)
        {
            int read;
            try { read = stream.Read(bodyBytes, copied, contentLength - copied); }
            catch { break; }
            if (read <= 0) break;
            copied += read;
        }
        var req = new HttpReq();
        req.Method = parts[0].ToUpperInvariant();
        var target = parts[1];
        var query = target.IndexOf('?');
        req.Path = query >= 0 ? target.Substring(0, query) : target;
        req.Body = Encoding.UTF8.GetString(bodyBytes, 0, copied);
        return req;
    }

    static int FindBytes(byte[] data, int length)
    {
        for (var i = 0; i + 3 < length; i++)
        {
            if (data[i] == 13 && data[i + 1] == 10 && data[i + 2] == 13 && data[i + 3] == 10) return i;
        }
        return -1;
    }

    static void WriteHttp(NetworkStream stream, Reply reply)
    {
        if (reply == null) reply = BytesReply(500, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("error"));
        if (reply.Bytes == null) reply.Bytes = new byte[0];
        var reason = "OK";
        if (reply.Status == 400) reason = "Bad Request";
        else if (reply.Status == 403) reason = "Forbidden";
        else if (reply.Status == 404) reason = "Not Found";
        else if (reply.Status == 409) reason = "Conflict";
        else if (reply.Status == 500) reason = "Error";
        var head = "HTTP/1.1 " + reply.Status + " " + reason + "\r\n"
            + "Content-Type: " + reply.ContentType + "\r\n"
            + "Content-Length: " + reply.Bytes.Length + "\r\n"
            + "Cache-Control: no-store\r\n"
            + "Connection: close\r\n\r\n";
        var headBytes = Encoding.ASCII.GetBytes(head);
        stream.Write(headBytes, 0, headBytes.Length);
        if (reply.Bytes.Length > 0) stream.Write(reply.Bytes, 0, reply.Bytes.Length);
        stream.Flush();
    }
}
