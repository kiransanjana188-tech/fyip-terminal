// FYIP TERMINAL - NinjaTrader 8 Add-On (read-only market data bridge)
// Compiled with NinjaTrader's own toolchain: New -> NinjaScript Editor ->
// AddOns, right-click FYIPBridge -> Compile.
//
// Uses ONLY assemblies NinjaTrader references by default (no Newtonsoft, no
// System.Net.Http): hand-rolled JSON read/write + System.Net.WebClient.
//
// API notes for this build (verified against the compiler diagnostics):
//   - instrument.MarketData is a NinjaTrader.Data.MarketData object and is
//     subscribed via its "Update" event on the instrument's Dispatcher.
//   - instrument.MarketDepth likewise exposes "Update", plus snapshot ladders
//     in MarketDepth.Asks / MarketDepth.Bids (MarketDepthRow.Price/Volume).
//   - NinjaTrader.Data.MarketDataType has no Closing/DailyOpenInterest.
//
// PURPOSE
//   Forwards market events for mapped instruments to a FYIP TERMINAL endpoint:
//     POST {Url}/api/v1/bridge/ingest        Authorization: Bearer {Token}
//
//   Three event channels (server contract, schemaVersion 1):
//     - market.quote: L1 quote state (bid/ask/last/OHLC/volume)
//     - market.depth: order-book ladder snapshot (every level the provider
//       supplies, up to "depthLevels" per side, default 100)
//     - market.trade: individual Last prints (time & sales)
//
// SAFETY / HONESTY RULES (mirror the server contract)
//   - READ-ONLY market data. No orders, no account access, no broker writes.
//   - Every event carries dataStatus from options (default "delayed"). Set
//     "live" only if your exchange entitlement permits routing to your own
//     personal dashboard.
//   - Failures log + back off; they never throw into NT's UI loop.
//   - Subscriptions last for the NinjaTrader session (the docs warn against
//     unsubscribing when not subscribed); Disconnect just stops publishing.
//
// OPTIONS FILE: Documents\fyip_bridge_options.json
//   {
//     "url":            "http://localhost:3000",
//     "token":          "<FYIP_BRIDGE_TOKEN - the same value the server uses>",
//     "dataStatus":     "delayed",
//     "intervalMs":     250,
//     "depth":          true,
//     "depthLevels":    100,
//     "trades":         true,
//     "symbolMap":      "ES 12-26=inst_esz6;NQ 12-26=inst_nqz6",
//     "optionsMap":     "ESZ6=inst_esz6;NQZ6=inst_nqz6",
//     "optionStrikes":  40
//   }
//
// symbolMap maps NinjaTrader Full instrument symbols (e.g. "ES 12-26") to FYIP
// instrument-master ids for that contract month:
//   SELECT i.symbol, m.provider_symbol FROM instrument_mappings m
//   JOIN instruments i ON i.id = m.instrument_id
//   WHERE m.provider = 'ninjatrader' AND i.asset_class = 'future';
//
// optionsMap enables the CME futures-option channel used by the GEX/SURF
// decks: "<contract code>=<FYIP underlying id>", e.g. "ESZ6=inst_esz6" maps
// ES Dec-2026 options to the ESZ6 futures contract. Options are published as
// market.quote events with FYIP ids following
//   opt_<contractcode-lower>_c<strike>  /  opt_<contractcode-lower>_p<strike>
// (e.g. opt_esz6_c6800, opt_esz6_p6675). Once the first trailing trade on the
// underlying futures contract arrives, the Add-On resolves the CME option
// names (candidates: "ES 12-26 6800 Call", "ES 12-26 6800 C", "ESZ6 C6800")
// for a strike grid centered on that price (optionStrikes per side) and
// subscribes the instruments NinjaTrader actually has. Open Interest arrives
// as MarketDataType.OpenInterest and is forwarded in the quote event's
// openInterest field. Nothing is fabricated: option names NinjaTrader cannot
// resolve are skipped once and logged.
//
// MENU: Control Center -> New -> FYIP Bridge: Connect / Disconnect.

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows;
using NinjaTrader.Cbi;
using NinjaTrader.Data;
using NinjaTrader.Gui;
using NinjaTrader.Gui.Tools;

namespace NinjaTrader.NinjaScript.AddOns.FYIP
{
  public sealed class SnapshotState
  {
    public string InstrumentId;
    public string ProviderSymbol;
    public double? Bid;
    public double? Ask;
    public double? Last;
    public double? Open;
    public double? High;
    public double? Low;
    public double? PrevClose;
    public double? Volume;
    public double? OpenInterest;

    // Snapshot ladder as {price, volume} pairs, best level first.
    public List<double[]> BidLevels = new List<double[]>();
    public List<double[]> AskLevels = new List<double[]>();

    public DateTime QuoteUpdatedUtc = DateTime.MinValue;
    public DateTime DepthUpdatedUtc = DateTime.MinValue;
    public bool Subscribed;
  }

  public sealed class FYIPBridgeOptions
  {
    public string Url = "http://localhost:3000";
    public string Token = "";
    public string DataStatus = "delayed";
    public int IntervalMs = 250;
    public bool Depth = true;
    public int DepthLevels = 100;
    public bool Trades = true;
    public string SymbolMap = "";
    public string OptionsMap = "";
    public int OptionStrikesSide = 40;
    public string Entitlement = "exchange-entitlement-required";

    public static string DefaultFilePath
    {
      get
      {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "fyip_bridge_options.json");
      }
    }

    public static string LogFilePath
    {
      get
      {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "fyip_bridge_log.txt");
      }
    }

    private static FYIPBridgeOptions ParseFlatJson(string raw)
    {
      var o = new FYIPBridgeOptions();
      if (raw == null) return o;
      int i = raw.IndexOf('{');
      if (i < 0) return o;
      i = i + 1;
      while (i < raw.Length)
      {
        while (i < raw.Length && (raw[i] == ' ' || raw[i] == '\t' || raw[i] == '\r' || raw[i] == '\n' || raw[i] == ',')) i++;
        if (i >= raw.Length || raw[i] == '}') break;
        if (raw[i] != '"') break;
        int keyEnd;
        string key = ReadJsonString(raw, i, out keyEnd);
        i = keyEnd;
        while (i < raw.Length && (raw[i] == ' ' || raw[i] == ':')) i++;
        if (i >= raw.Length) break;
        string value;
        if (raw[i] == '"')
        {
          int valueEnd;
          value = ReadJsonString(raw, i, out valueEnd);
          i = valueEnd;
        }
        else
        {
          int start = i;
          while (i < raw.Length && raw[i] != ',' && raw[i] != '}') i++;
          value = raw.Substring(start, i - start).Trim();
        }
        if (key == "url") o.Url = value;
        else if (key == "token") o.Token = value;
        else if (key == "dataStatus") o.DataStatus = value;
        else if (key == "symbolMap") o.SymbolMap = value;
        else if (key == "optionsMap") o.OptionsMap = value;
        else if (key == "entitlement") o.Entitlement = value;
        else if (key == "intervalMs") { int n; if (int.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out n)) o.IntervalMs = n; }
        else if (key == "depthLevels") { int n; if (int.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out n)) o.DepthLevels = n; }
        else if (key == "optionStrikes") { int n; if (int.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out n)) o.OptionStrikesSide = n; }
        else if (key == "depth") { bool b; if (bool.TryParse(value, out b)) o.Depth = b; }
        else if (key == "trades") { bool b; if (bool.TryParse(value, out b)) o.Trades = b; }
      }
      return o;
    }

    private static string ReadJsonString(string raw, int start, out int endIndex)
    {
      var sb = new StringBuilder();
      int i = start + 1;
      while (i < raw.Length)
      {
        char c = raw[i];
        if (c == '\\')
        {
          if (i + 1 < raw.Length)
          {
            char n = raw[i + 1];
            if (n == 'n') sb.Append('\n');
            else if (n == 'r') sb.Append('\r');
            else if (n == 't') sb.Append('\t');
            else sb.Append(n);
            i += 2;
            continue;
          }
          i++;
          continue;
        }
        if (c == '"') { i++; break; }
        sb.Append(c);
        i++;
      }
      endIndex = i;
      return sb.ToString();
    }

    public static FYIPBridgeOptions Load()
    {
      try
      {
        if (File.Exists(DefaultFilePath))
        {
          var o = ParseFlatJson(File.ReadAllText(DefaultFilePath));
          o.Url = string.IsNullOrEmpty(o.Url) ? "http://localhost:3000" : o.Url;
          o.Token = o.Token ?? "";
          o.DataStatus = string.IsNullOrEmpty(o.DataStatus) ? "delayed" : o.DataStatus;
          if (o.IntervalMs < 100) o.IntervalMs = 250;
        if (o.DepthLevels < 1) o.DepthLevels = 100;
        if (o.DepthLevels > 100) o.DepthLevels = 100;   // server contract limit
        o.SymbolMap = o.SymbolMap ?? "";
        o.OptionsMap = o.OptionsMap ?? "";
        if (o.OptionStrikesSide < 1) o.OptionStrikesSide = 40;
        if (o.OptionStrikesSide > 200) o.OptionStrikesSide = 200;
        o.Entitlement = string.IsNullOrEmpty(o.Entitlement) ? "exchange-entitlement-required" : o.Entitlement;
          return o;
        }
      }
      catch { /* fall back to defaults on malformed file */ }
      return new FYIPBridgeOptions();
    }
  }

  public sealed class FYIPBridgeService
  {
    private static FYIPBridgeService instance;
    private readonly ConcurrentDictionary<string, SnapshotState> snapshots =
      new ConcurrentDictionary<string, SnapshotState>();
    private readonly ConcurrentDictionary<string, Instrument> mapped =
      new ConcurrentDictionary<string, Instrument>();

    // CME futures-option channel plans (optionsMap), keyed by FYIP underlying
    // instrument id. Option subscription is deferred until the underlying
    // futures contract prints its first price of the session.
    private sealed class OptionRootPlan
    {
      public string ContractCode;   // e.g. "ESZ6"
      public string FyipId;         // e.g. "inst_esz6"
      public bool Subscribed;
    }
    private readonly Dictionary<string, OptionRootPlan> optionRoots =
      new Dictionary<string, OptionRootPlan>(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> boundOptionIds =
      new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    private readonly ConcurrentQueue<object[]> tradeRing = new ConcurrentQueue<object[]>();
    private readonly object stateGate = new object();
    private Timer flushTimer;
    private FYIPBridgeOptions options;
    private bool connected;
    private long sequence;
    private int posting;
    private DateTime pausedUntilUtc = DateTime.MinValue;

    public bool IsConnected
    {
      get { return connected; }
    }

    public FYIPBridgeOptions Options
    {
      get
      {
        if (options == null) options = FYIPBridgeOptions.Load();
        return options;
      }
    }

    public static FYIPBridgeService Instance
    {
      get
      {
        if (instance == null) instance = new FYIPBridgeService();
        return instance;
      }
    }

    public void Connect()
    {
      if (connected) return;
      lock (stateGate)
      {
        if (connected) return;
        try
        {
          // Pick up edits to fyip_bridge_options.json on every connect, so a
          // dataStatus/symbolMap change needs only Disconnect -> Connect.
          options = FYIPBridgeOptions.Load();
          optionRoots.Clear();
          boundOptionIds.Clear();
          SubscribeMappedInstruments();
          if (snapshots.IsEmpty)
            BridgeLog("FYIP Bridge: no symbol map entries resolved - nothing to publish");
          if (optionRoots.Count > 0)
            BridgeLog("FYIP Bridge: option channel armed for " + string.Join(",", optionRoots.Keys.ToArray()) +
                      " (subscriptions start on the first quote of each underlying)");
          sequence = 0;
          pausedUntilUtc = DateTime.MinValue;
          int interval = Options.IntervalMs;
          flushTimer = new Timer(Flush, null, interval, interval);
          connected = true;
          BridgeLog("FYIP Bridge connected -> " + Options.Url +
                    " (" + snapshots.Count + " mapped instruments, dataStatus=" + Options.DataStatus +
                    ", depth=" + (Options.Depth ? ("on/" + Options.DepthLevels + " levels") : "off") +
                    ", trades=" + (Options.Trades ? "on" : "off") + ")");
        }
        catch (Exception ex)
        {
          BridgeLog("FYIP Bridge connect failed: " + ex.Message);
          StopTimer();
          throw;
        }
      }
    }

    public void Disconnect()
    {
      if (!connected) return;
      connected = false;
      lock (stateGate) { StopTimer(); }
      BridgeLog("FYIP Bridge disconnected");
    }

    private void StopTimer()
    {
      try { if (flushTimer != null) flushTimer.Dispose(); } catch { }
      flushTimer = null;
    }

    private void SubscribeMappedInstruments()
    {
      var entries = (Options.SymbolMap ?? "")
        .Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries)
        .Select(delegate(string s) { return s.Trim(); })
        .Where(delegate(string s) { return s.Length > 0; });
      var fyipToNt = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
      foreach (var entry in entries)
      {
        int eq = entry.IndexOf('=');
        if (eq <= 0)
        {
          BridgeLog("symbolMap entry missing '=': " + entry);
          continue;
        }
        string full = entry.Substring(0, eq).Trim();
        string fyipId = entry.Substring(eq + 1).Trim();
        fyipToNt[fyipId] = full;
        try
        {
          SnapshotState existing;
          if (snapshots.TryGetValue(full, out existing) && existing.Subscribed) continue;
          Instrument nt = Instrument.GetInstrument(full);
          if (nt == null)
          {
            BridgeLog("unknown NinjaTrader symbol in map: " + full);
            continue;
          }
          SnapshotState state = new SnapshotState();
          state.InstrumentId = fyipId;
          state.ProviderSymbol = full;
          state.Subscribed = true;
          snapshots[full] = state;
          mapped[full] = nt;
          Instrument boundInstrument = nt;
          if (Options.Depth)
          {
            nt.Dispatcher.InvokeAsync(delegate
            {
              boundInstrument.MarketData.Update += delegate(object s, MarketDataEventArgs ev) { OnMarketData(boundInstrument, ev); };
              boundInstrument.MarketDepth.Update += delegate(object s, MarketDepthEventArgs ev) { OnMarketDepth(boundInstrument, ev); };
            });
          }
          else
          {
            nt.Dispatcher.InvokeAsync(delegate
            {
              boundInstrument.MarketData.Update += delegate(object s, MarketDataEventArgs ev) { OnMarketData(boundInstrument, ev); };
            });
          }
        }
        catch (Exception ex)
        {
          BridgeLog("subscribe '" + full + "' failed: " + ex.Message);
        }
      }

      // Options channel plans: "<contract code>=<FYIP underlying id>". The
      // underlying must also appear in symbolMap so its first quote can arm
      // the strike grid.
      var optionEntries = (Options.OptionsMap ?? "")
        .Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries)
        .Select(delegate(string s) { return s.Trim(); })
        .Where(delegate(string s) { return s.Length > 0; });
      foreach (var entry in optionEntries)
      {
        int eq = entry.IndexOf('=');
        if (eq <= 0)
        {
          BridgeLog("optionsMap entry missing '=': " + entry);
          continue;
        }
        string code = entry.Substring(0, eq).Trim();
        string fyipId = entry.Substring(eq + 1).Trim();
        string ntName;
        if (!fyipToNt.TryGetValue(fyipId, out ntName))
        {
          BridgeLog("optionsMap: underlying '" + fyipId + "' for " + code +
                    " is not in symbolMap - add e.g. \"ES 12-26=inst_esz6\" so the option grid can arm");
          continue;
        }
        OptionRootPlan plan = new OptionRootPlan();
        plan.ContractCode = code;
        plan.FyipId = fyipId;
        plan.Subscribed = false;
        optionRoots[fyipId] = plan;
      }
    }

    // --------------------------- L1 quotes ---------------------------
    private void OnMarketData(Instrument inst, MarketDataEventArgs e)
    {
      if (e == null) return;
      try
      {
        SnapshotState snap;
        if (!snapshots.TryGetValue(inst.FullName, out snap)) return;
        DateTime utcNow = DateTime.UtcNow;

        if (e.MarketDataType == MarketDataType.Last)
        {
          snap.Last = e.Price;
          if (Options.Trades && e.Volume > 0)
          {
            // {instrumentId, price, size, dataStatus, tsIso}
            tradeRing.Enqueue(new object[] {
              snap.InstrumentId, e.Price, e.Volume,
              Options.DataStatus, utcNow.ToString("o")
            });
          }
        }
        else if (e.MarketDataType == MarketDataType.Ask) snap.Ask = e.Price;
        else if (e.MarketDataType == MarketDataType.Bid) snap.Bid = e.Price;
        else if (e.MarketDataType == MarketDataType.Opening) snap.Open = e.Price;
        else if (e.MarketDataType == MarketDataType.DailyHigh) snap.High = e.Price;
        else if (e.MarketDataType == MarketDataType.DailyLow) snap.Low = e.Price;
        else if (e.MarketDataType == MarketDataType.DailyVolume) snap.Volume = e.Volume;
        else if (e.MarketDataType == MarketDataType.OpenInterest) snap.OpenInterest = e.Volume;
        snap.QuoteUpdatedUtc = utcNow;

        // Arm the CME option strike grid on the first price of a mapped
        // underlying futures contract (see optionsMap docs in the header).
        if (optionRoots.Count > 0 && snap.Last != null)
          TrySubscribeOptionRoot(snap.InstrumentId, inst.FullName, snap.Last.Value);
      }
      catch (Exception ex)
      {
        BridgeLog("market data handler issue: " + ex.Message);
      }
    }

    // ------------------------- CME option channel -------------------------
    // Strike-step rules for the roots the options channel supports today.
    // CME lists quarterly index options on those grids by default.
    private static readonly Dictionary<string, double> CmeOptionStrikeSteps =
      new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase)
      {
        { "ES",   25 },
        { "NQ",   10 },
        { "RTY",   5 },
        { "YM",    5 },
        { "MES",   5 },
        { "MNQ",   2 },
        { "MYM",   1 },
        { "MRTY",  1 },
      };

    private static readonly Dictionary<char, int> CmeMonthFromCode = new Dictionary<char, int>
    {
      { 'F', 1 }, { 'G', 2 }, { 'H', 3 }, { 'J', 4 }, { 'K', 5 }, { 'M', 6 },
      { 'N', 7 }, { 'Q', 8 }, { 'U', 9 }, { 'V', 10 }, { 'X', 11 }, { 'Z', 12 },
    };

    private static double OptionStrikeStepFor(string root)
    {
      double step;
      return CmeOptionStrikeSteps.TryGetValue(root, out step) ? step : 0;
    }

    // Arms one optionRoots entry: from the underlying's first price, build the
    // CME option-name candidates for a centered strike grid, resolve what
    // NinjaTrader has, and bind those instruments to the bridge. One attempt
    // per Connect cycle so failures do not retry every tick.
    private void TrySubscribeOptionRoot(string fyipId, string underlyingFullName, double spot)
    {
      OptionRootPlan plan;
      if (!optionRoots.TryGetValue(fyipId ?? "", out plan) || plan.Subscribed) return;
      plan.Subscribed = true;   // re-arm via Disconnect -> Connect
      try
      {
        string code = plan.ContractCode ?? "";
        if (code.Length < 3) { BridgeLog("optionsMap: contract code too short: " + code); return; }
        char yearDigit = code[code.Length - 1];
        char monthCode = code[code.Length - 2];
        int contractMonth;
        if (!char.IsDigit(yearDigit) || !CmeMonthFromCode.TryGetValue(char.ToUpperInvariant(monthCode), out contractMonth))
        {
          BridgeLog("optionsMap: unresolved CME contract code '" + code + "' (expect e.g. ESZ6)");
          return;
        }
        string root = code.Substring(0, code.Length - 2);
        foreach (char ch in root)
        {
          if (!char.IsLetter(ch)) { BridgeLog("optionsMap: unexpected root in code '" + code + "'"); return; }
        }
        double step = OptionStrikeStepFor(root);
        if (step <= 0)
        {
          BridgeLog("optionsMap: no strike-step rule for root '" + root +
                    "' (supported: ES 25, NQ 10, RTY 5, YM 5, MES 5, MNQ 2, MYM 1, MRTY 1)");
          return;
        }

        // Derive the CME option naming pieces from the underlying NinjaTrader
        // name, e.g. "ES 12-26" -> root "ES", month 12, year 26.
        string ntName = (underlyingFullName ?? "").Trim();
        int space = ntName.IndexOf(' ');
        if (space <= 0) { BridgeLog("optionsArm: cannot split NinjaTrader name '" + ntName + "'"); return; }
        string ntMonthYear = ntName.Substring(space + 1).Trim();
        int dash = ntMonthYear.IndexOf('-');
        if (dash <= 0) { BridgeLog("optionsArm: cannot parse '<mm>-<yy>' from '" + ntName + "'"); return; }
        int mm, yy;
        if (!int.TryParse(ntMonthYear.Substring(0, dash), NumberStyles.Integer, CultureInfo.InvariantCulture, out mm) ||
            !int.TryParse(ntMonthYear.Substring(dash + 1), NumberStyles.Integer, CultureInfo.InvariantCulture, out yy) ||
            mm < 1 || mm > 12 || yy < 0 || yy > 99)
        {
          BridgeLog("optionsArm: unhandled contract month/year in '" + ntName + "'");
          return;
        }
        if (mm != contractMonth || (yy % 10) != (yearDigit - '0'))
        {
          BridgeLog("optionsArm: underlying '" + ntName + "' does not match contract code '" + code + "' - skipped");
          return;
        }

        string ntRoot = ntName.Substring(0, space);
        int side = Math.Max(1, Math.Min(200, Options.OptionStrikesSide));
        double center = Math.Round(spot / step) * step;
        int attempted = 0, resolved = 0;
        for (int i = -side; i <= side; i++)
        {
          double strike = center + i * step;
          if (strike <= 0) continue;
          attempted += 2;
          if (BindOptionContract(code, ntRoot, mm, yy, strike, true)) resolved++;
          if (BindOptionContract(code, ntRoot, mm, yy, strike, false)) resolved++;
        }
        BridgeLog("options channel: " + code + " armed at " + spot.ToString(CultureInfo.InvariantCulture) +
                  " (strike step " + step.ToString(CultureInfo.InvariantCulture) + ", " + side + " per side); " +
                  "resolved " + resolved + "/" + attempted + " contracts; first candidate '" +
                  ntRoot + " " + mm.ToString("00", CultureInfo.InvariantCulture) + "-" + yy.ToString("00", CultureInfo.InvariantCulture) +
                  " " + (center + -side * step).ToString("0.###", CultureInfo.InvariantCulture) + " C'");
        if (resolved == 0 && attempted > 0)
          BridgeLog("options channel: NinjaTrader resolved no " + code + " option names - open the Options Trader for '" +
                    ntName + "' once so NT materializes the chain, then Disconnect -> Connect to re-arm");
      }
      catch (Exception ex)
      {
        BridgeLog("option subscription failed: " + ex.Message);
      }
    }

    // Resolve one CME option contract (call/put at strike); when NinjaTrader
    // knows any candidate name, bind its market-data stream to the bridge and
    // register the FYIP snapshot state under the opt_ id. Idempotent.
    private bool BindOptionContract(string code, string ntRoot, int mm, int yy, double strike, bool isCall)
    {
      try
      {
        string strikeText = strike.ToString("0.###", CultureInfo.InvariantCulture);
        string optionId = "opt_" + code.ToLowerInvariant() + (isCall ? "_c" : "_p") + strikeText;
        if (boundOptionIds.Contains(optionId)) return true;

        string monthText = mm.ToString("00", CultureInfo.InvariantCulture);
        string yearText = yy.ToString("00", CultureInfo.InvariantCulture);
        string word = isCall ? "Call" : "Put";
        string letter = isCall ? "C" : "P";
        string rootMonthStrike = ntRoot + " " + monthText + "-" + yearText + " " + strikeText;
        string codeStrike = code.ToUpperInvariant() + " " + strikeText;
        string[] candidates = new string[]
        {
          rootMonthStrike + " " + word,
          rootMonthStrike + " " + letter,
          code.ToUpperInvariant() + " " + letter + strikeText,
          codeStrike + " " + letter,
          codeStrike + letter,
          rootMonthStrike + letter,
          ntRoot + " " + monthText + "-" + yearText + " " + letter + strikeText,
        };

        Instrument option = null;
        string resolvedName = null;
        foreach (string name in candidates)
        {
          Instrument candidate;
          try { candidate = Instrument.GetInstrument(name); }
          catch { candidate = null; }
          if (candidate != null) { option = candidate; resolvedName = name; break; }
        }
        if (option == null || string.IsNullOrEmpty(resolvedName)) return false;

        // A snapshot entry for this name that already points at the same
        // optionId means the binding was done in an earlier session — keep it
        // and never re-attach handlers (NinjaTrader docs warn against re-add).
        SnapshotState existing;
        bool hasNamed = snapshots.TryGetValue(resolvedName, out existing);
        if (hasNamed && existing.Subscribed && existing.InstrumentId == optionId)
        {
          boundOptionIds.Add(optionId);
          mapped[resolvedName] = option;
          return true;
        }

        SnapshotState st = hasNamed ? existing : new SnapshotState();
        st.InstrumentId = optionId;
        st.ProviderSymbol = resolvedName;
        st.Subscribed = true;
        if (!hasNamed) snapshots[resolvedName] = st;
        mapped[resolvedName] = option;

        Instrument bound = option;
        if (boundOptionIds.Add(optionId))
        {
          bound.MarketData.Update += delegate(object s, MarketDataEventArgs ev) { OnMarketData(bound, ev); };
          if (Options.Depth)
          {
            bound.MarketDepth.Update += delegate(object s, MarketDepthEventArgs ev) { OnMarketDepth(bound, ev); };
          }
        }
        return true;
      }
      catch (Exception ex)
      {
        BridgeLog("option bind '" + code + "' " + (isCall ? "C" : "P") + strike.ToString(CultureInfo.InvariantCulture) + " failed: " + ex.Message);
        return false;
      }
    }

    // --------------------------- Depth ladders ---------------------------
    private void OnMarketDepth(Instrument inst, MarketDepthEventArgs e)
    {
      if (e == null) return;
      try
      {
        SnapshotState snap;
        if (!snapshots.TryGetValue(inst.FullName, out snap)) return;

        bool isBid = e.MarketDataType == MarketDataType.Bid;
        bool isAsk = e.MarketDataType == MarketDataType.Ask;
        if (!isBid && !isAsk) return;

        // NinjaTrader updates its own snapshot ladder before raising Update,
        // so copying it here is race-free and yields the same full book the
        // SuperDOM shows (Rithmic etc.). Reading these lists from the timer
        // thread is what used to produce stale/duplicate/crossed rows.
        // Bids/Asks are ordered best-first (position 0 = inside market).
        var md = inst.MarketDepth;
        if (md == null) return;
        List<double[]> levels = SnapshotLevels(isBid ? md.Bids : md.Asks, Options.DepthLevels);
        if (isBid) snap.BidLevels = levels;
        else snap.AskLevels = levels;   // reference swap: Flush reads a coherent list
        snap.DepthUpdatedUtc = DateTime.UtcNow;
      }
      catch (Exception ex)
      {
        BridgeLog("market depth handler issue: " + ex.Message);
      }
    }

    // Copies the best "limit" levels with positive price/volume, de-duplicated
    // by price, preserving NinjaTrader's best-first ordering.
    private static List<double[]> SnapshotLevels(List<MarketDepthRow> rows, int limit)
    {
      var levels = new List<double[]>(Math.Min(rows.Count, limit));
      var seen = new HashSet<double>();
      for (int i = 0; i < rows.Count && levels.Count < limit; i++)
      {
        double price = rows[i].Price;
        double volume = rows[i].Volume;
        if (price <= 0 || volume <= 0) continue;
        if (!seen.Add(price)) continue;
        levels.Add(new double[] { price, volume });
      }
      return levels;
    }

    // --------------------------- Flush / publish ---------------------------
    private void Flush(object ignored)
    {
      if (!connected) return;
      if (DateTime.UtcNow < pausedUntilUtc) return;

      try
      {
        DateTime nowUtc = DateTime.UtcNow;
        var batch = new StringBuilder(512);
        batch.Append("{\"events\":[");
        int eventCount = 0;

        foreach (var pair in snapshots)
        {
          SnapshotState snap = pair.Value;

          if (snap.QuoteUpdatedUtc != DateTime.MinValue)
          {
            if (eventCount > 0) batch.Append(',');
            AppendQuoteEvent(batch, snap, nowUtc);
            eventCount++;
            snap.QuoteUpdatedUtc = DateTime.MinValue;
          }

          if (Options.Depth && snap.DepthUpdatedUtc != DateTime.MinValue)
          {
            if (eventCount > 0) batch.Append(',');
            AppendDepthEvent(batch, snap, nowUtc);
            eventCount++;
            snap.DepthUpdatedUtc = DateTime.MinValue;
          }
        }

        object[] trade;
        while (tradeRing.TryDequeue(out trade) && eventCount < 2000)
        {
          if (eventCount > 0) batch.Append(',');
          AppendTradeEvent(batch, trade);
          eventCount++;
        }

        batch.Append("]}");
        if (eventCount > 0) Post(batch.ToString());
      }
      catch (Exception ex)
      {
        BridgeLog("flush issue: " + ex.Message);
        PauseBriefly();
      }
    }

    private void AppendQuoteEvent(StringBuilder sb, SnapshotState snap, DateTime nowUtc)
    {
      sb.Append("{\"schemaVersion\":1,\"eventType\":\"market.quote\",\"provider\":\"ninjatrader\"");
      sb.Append(",\"instrumentId\":").Append(JStr(snap.InstrumentId));
      sb.Append(",\"providerSymbol\":").Append(JStr(snap.ProviderSymbol));
      sb.Append(",\"eventTimestamp\":").Append(JStr(snap.QuoteUpdatedUtc.ToString("o")));
      sb.Append(",\"receivedTimestamp\":").Append(JStr(nowUtc.ToString("o")));
      sb.Append(",\"dataStatus\":").Append(JStr(Options.DataStatus));
      sb.Append(",\"sequence\":").Append(Interlocked.Increment(ref sequence));
      sb.Append(",\"bid\":").Append(JNum(snap.Bid));
      sb.Append(",\"ask\":").Append(JNum(snap.Ask));
      sb.Append(",\"last\":").Append(JNum(snap.Last));
      sb.Append(",\"open\":").Append(JNum(snap.Open));
      sb.Append(",\"high\":").Append(JNum(snap.High));
      sb.Append(",\"low\":").Append(JNum(snap.Low));
      sb.Append(",\"prevClose\":").Append(JNum(snap.PrevClose));
      sb.Append(",\"volume\":").Append(JNum(snap.Volume));
      sb.Append(",\"openInterest\":").Append(JNum(snap.OpenInterest));
      sb.Append(",\"entitlement\":").Append(JStr(Options.Entitlement));
      sb.Append('}');
    }

    private void AppendDepthEvent(StringBuilder sb, SnapshotState snap, DateTime nowUtc)
    {
      sb.Append("{\"schemaVersion\":1,\"eventType\":\"market.depth\",\"provider\":\"ninjatrader\"");
      sb.Append(",\"instrumentId\":").Append(JStr(snap.InstrumentId));
      sb.Append(",\"providerSymbol\":").Append(JStr(snap.ProviderSymbol));
      sb.Append(",\"eventTimestamp\":").Append(JStr(snap.DepthUpdatedUtc.ToString("o")));
      sb.Append(",\"receivedTimestamp\":").Append(JStr(nowUtc.ToString("o")));
      sb.Append(",\"dataStatus\":").Append(JStr(Options.DataStatus));
      sb.Append(",\"sequence\":").Append(Interlocked.Increment(ref sequence));
      AppendLevels(sb, "bids", snap.BidLevels);
      AppendLevels(sb, "asks", snap.AskLevels);
      sb.Append(",\"entitlement\":").Append(JStr(Options.Entitlement));
      sb.Append('}');
    }

    private static void AppendLevels(StringBuilder sb, string key, List<double[]> levels)
    {
      sb.Append(",\"").Append(key).Append("\":[");
      for (int i = 0; i < levels.Count; i++)
      {
        if (i > 0) sb.Append(',');
        sb.Append("{\"price\":").Append(JNum(levels[i][0]));
        sb.Append(",\"volume\":").Append(JNum(levels[i][1])).Append('}');
      }
      sb.Append(']');
    }

    private void AppendTradeEvent(StringBuilder sb, object[] trade)
    {
      sb.Append("{\"schemaVersion\":1,\"eventType\":\"market.trade\",\"provider\":\"ninjatrader\"");
      sb.Append(",\"instrumentId\":").Append(JStr(trade[0] as string));
      double price = Convert.ToDouble(trade[1], CultureInfo.InvariantCulture);
      double size = Convert.ToDouble(trade[2], CultureInfo.InvariantCulture);
      sb.Append(",\"eventTimestamp\":").Append(JStr(trade[4] as string));
      sb.Append(",\"receivedTimestamp\":").Append(JStr(trade[4] as string));
      sb.Append(",\"dataStatus\":").Append(JStr(trade[3] as string));
      sb.Append(",\"sequence\":").Append(Interlocked.Increment(ref sequence));
      sb.Append(",\"price\":").Append(JNum(price));
      sb.Append(",\"size\":").Append(JNum(size));
      sb.Append(",\"side\":null");
      sb.Append(",\"entitlement\":").Append(JStr(Options.Entitlement));
      sb.Append('}');
    }

    // --------------------------- JSON helpers ---------------------------
    private static string JStr(string s)
    {
      if (s == null) return "null";
      var sb = new StringBuilder(s.Length + 2);
      sb.Append('"');
      foreach (char c in s)
      {
        if (c == '"') sb.Append("\\\"");
        else if (c == '\\') sb.Append("\\\\");
        else if (c == '\n') sb.Append("\\n");
        else if (c == '\r') sb.Append("\\r");
        else if (c == '\t') sb.Append("\\t");
        else if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4"));
        else sb.Append(c);
      }
      sb.Append('"');
      return sb.ToString();
    }

    private static string JNum(double? v)
    {
      if (v == null || double.IsNaN(v.Value) || double.IsInfinity(v.Value)) return "null";
      return v.Value.ToString("R", CultureInfo.InvariantCulture);
    }

    private static string JNum(double v)
    {
      if (double.IsNaN(v) || double.IsInfinity(v)) return "null";
      return v.ToString("R", CultureInfo.InvariantCulture);
    }

    // --------------------------- Post ---------------------------
    private void Post(string json)
    {
      // UploadString runs synchronously on the thread-pool timer thread; the
      // posting guard prevents overlapping re-entries.
      if (Interlocked.CompareExchange(ref posting, 1, 0) != 0) return;
      try
      {
        string url = Options.Url.TrimEnd('/') + "/api/v1/bridge/ingest";
        using (var client = new WebClient())
        {
          client.Encoding = Encoding.UTF8;
          client.Headers[HttpRequestHeader.Authorization] = "Bearer " + (Options.Token ?? "");
          client.Headers[HttpRequestHeader.ContentType] = "application/json";
          var response = client.UploadString(url, json);
          int accepted, rejected;
          ExtractCounts(response, out accepted, out rejected);
          if (rejected > 0)
            BridgeLog(accepted + " accepted, " + rejected + " rejected by server");
          pausedUntilUtc = DateTime.MinValue;
        }
      }
      catch (WebException wex)
      {
        var http = wex.Response as HttpWebResponse;
        if (http != null)
          BridgeLog("POST failed " + (int)http.StatusCode + " (" + http.StatusDescription + ")");
        else
          BridgeLog("POST error: " + wex.Message);
        PauseBriefly();
      }
      catch (Exception ex)
      {
        BridgeLog("POST error: " + ex.Message);
        PauseBriefly();
      }
      finally
      {
        Interlocked.Exchange(ref posting, 0);
      }
    }

    private static void ExtractCounts(string body, out int accepted, out int rejected)
    {
      accepted = 0;
      rejected = 0;
      if (string.IsNullOrEmpty(body)) return;
      accepted = ExtractInt(body, "accepted");
      rejected = ExtractInt(body, "rejected");
    }

    private static int ExtractInt(string body, string key)
    {
      string needle = "\"" + key + "\":";
      int i = body.IndexOf(needle, StringComparison.Ordinal);
      if (i < 0) return 0;
      i += needle.Length;
      int start = i;
      while (i < body.Length && (char.IsDigit(body[i]) || body[i] == '-')) i++;
      int n;
      int.TryParse(body.Substring(start, i - start), NumberStyles.Integer, CultureInfo.InvariantCulture, out n);
      return n;
    }

    private void PauseBriefly()
    {
      if (pausedUntilUtc > DateTime.UtcNow) return;
      pausedUntilUtc = DateTime.UtcNow.AddSeconds(3);
      BridgeLog("pausing posts until " + pausedUntilUtc.ToString("o"));
    }

    private static void BridgeLog(string message)
    {
      var line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "  " + message + Environment.NewLine;
      try
      {
        var path = FYIPBridgeOptions.LogFilePath;
        var fi = new System.IO.FileInfo(path);
        if (fi.Exists && fi.Length > 1000000) File.WriteAllText(path, line);  // keep log bounded
        else File.AppendAllText(path, line);
      }
      catch
      {
        try { System.Diagnostics.Debug.WriteLine("[fyip-bridge] " + message); }
        catch { /* never throw from logging */ }
      }
    }
  }

  public class FYIPBridgeAddOn : AddOnBase
  {
    private NTMenuItem menuItem;

    protected override void OnStateChange()
    {
      if (State == State.SetDefaults)
      {
        Description = "Read-only market data bridge that forwards NinjaTrader quotes, depth and trades to FYIP TERMINAL.";
        Name = "FYIPBridge";
      }
    }

    protected override void OnWindowCreated(Window window)
    {
      ControlCenter cc = window as ControlCenter;
      if (cc == null) return;
      if (menuItem != null) return;   // attach once per session

      NTMenuItem existing = cc.FindFirst("ControlCenterMenuItemNew") as NTMenuItem;
      if (existing == null) return;

      menuItem = new NTMenuItem();
      menuItem.Header = MenuText();
      menuItem.Style = Application.Current.TryFindResource("MainMenuItem") as Style;
      existing.Items.Add(menuItem);
      menuItem.Click += OnMenuItemClick;
    }

    private void OnMenuItemClick(object sender, RoutedEventArgs e)
    {
      var service = FYIPBridgeService.Instance;
      if (service.IsConnected) service.Disconnect();
      else service.Connect();
      if (menuItem != null) menuItem.Header = MenuText();
    }

    private static string MenuText()
    {
      if (FYIPBridgeService.Instance.IsConnected) return "FYIP Bridge: Disconnect";
      return "FYIP Bridge: Connect";
    }
  }
}
