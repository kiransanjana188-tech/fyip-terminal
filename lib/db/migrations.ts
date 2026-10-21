/**
 * FYIP TERMINAL — forward-only SQL migrations.
 * Each migration is applied once and recorded in `schema_migrations`.
 * Never edit an applied migration; append a new one.
 *
 * High-frequency market events are intentionally NOT stored here — only the
 * bounded latest snapshot per instrument lives in `quote_snapshots`. See
 * docs/DATA_ARCHITECTURE.md for the retention rationale.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "core_identity_and_audit",
    sql: `
      CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        display_name  TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'active',
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE TABLE roles (
        id          TEXT PRIMARY KEY,
        key         TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        description TEXT
      );

      CREATE TABLE user_roles (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, role_id)
      );

      CREATE TABLE sessions (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        issued_at    TEXT NOT NULL,
        expires_at   TEXT NOT NULL,
        revoked_at   TEXT,
        user_agent   TEXT,
        ip           TEXT
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      CREATE TABLE audit_logs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        at          TEXT NOT NULL,
        actor_id    TEXT,
        actor_email TEXT,
        action      TEXT NOT NULL,
        target      TEXT,
        status      TEXT NOT NULL,
        detail      TEXT,
        ip          TEXT
      );
      CREATE INDEX idx_audit_at ON audit_logs(at DESC);
      CREATE INDEX idx_audit_action ON audit_logs(action);
    `,
  },
  {
    version: 2,
    name: "instrument_master",
    sql: `
      CREATE TABLE exchanges (
        id            TEXT PRIMARY KEY,
        code          TEXT NOT NULL UNIQUE,
        name          TEXT NOT NULL,
        timezone      TEXT NOT NULL,
        country       TEXT
      );

      CREATE TABLE trading_sessions (
        id           TEXT PRIMARY KEY,
        exchange_id  TEXT NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        open_local   TEXT NOT NULL,
        close_local  TEXT NOT NULL,
        session_type TEXT NOT NULL
      );

      CREATE TABLE instruments (
        id                 TEXT PRIMARY KEY,
        symbol             TEXT NOT NULL,
        display_name       TEXT NOT NULL,
        asset_class        TEXT NOT NULL,
        exchange_id        TEXT REFERENCES exchanges(id),
        currency           TEXT NOT NULL,
        price_scale        INTEGER NOT NULL DEFAULT 2,
        tick_size          REAL NOT NULL DEFAULT 0.01,
        contract_multiplier REAL NOT NULL DEFAULT 1,
        expiration         TEXT,
        futures_month      TEXT,
        futures_year       INTEGER,
        is_continuous      INTEGER NOT NULL DEFAULT 0,
        roll_methodology   TEXT,
        underlying_id      TEXT REFERENCES instruments(id),
        underlying_kind    TEXT,
        timezone           TEXT NOT NULL DEFAULT 'America/New_York',
        status             TEXT NOT NULL DEFAULT 'active',
        deep_link          TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
      CREATE INDEX idx_instruments_symbol ON instruments(symbol);
      CREATE INDEX idx_instruments_class ON instruments(asset_class);
      CREATE INDEX idx_instruments_underlying ON instruments(underlying_id);

      CREATE TABLE instrument_mappings (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        instrument_id      TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
        provider           TEXT NOT NULL,
        provider_symbol    TEXT NOT NULL,
        entitlement        TEXT,
        UNIQUE (provider, provider_symbol)
      );
      CREATE INDEX idx_mappings_instrument ON instrument_mappings(instrument_id);
    `,
  },
  {
    version: 3,
    name: "quotes_and_providers",
    sql: `
      CREATE TABLE data_provider_configs (
        id           TEXT PRIMARY KEY,
        provider_key TEXT NOT NULL UNIQUE,
        kind         TEXT NOT NULL,
        enabled      INTEGER NOT NULL DEFAULT 0,
        entitlement  TEXT,
        notes        TEXT,
        updated_at   TEXT NOT NULL
      );

      -- Bounded latest snapshot per instrument+provider. Not a tick archive.
      CREATE TABLE quote_snapshots (
        instrument_id      TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
        provider           TEXT NOT NULL,
        provider_symbol    TEXT,
        exchange           TEXT,
        bid                REAL,
        ask                REAL,
        last               REAL,
        open               REAL,
        high               REAL,
        low                REAL,
        prev_close         REAL,
        volume             REAL,
        open_interest      REAL,
        data_status        TEXT NOT NULL DEFAULT 'unavailable',
        entitlement        TEXT,
        event_timestamp    TEXT,
        received_timestamp TEXT NOT NULL,
        updated_at         TEXT NOT NULL,
        PRIMARY KEY (instrument_id, provider)
      );

      CREATE TABLE bridge_installations (
        id              TEXT PRIMARY KEY,
        label           TEXT NOT NULL,
        platform        TEXT NOT NULL,
        token_hash      TEXT NOT NULL,
        last_heartbeat  TEXT,
        connection_state TEXT NOT NULL DEFAULT 'disconnected',
        capabilities    TEXT,
        version         TEXT,
        created_at      TEXT NOT NULL,
        revoked_at      TEXT
      );
    `,
  },
  {
    version: 4,
    name: "watchlists_and_workspaces",
    sql: `
      CREATE TABLE watchlists (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_watchlists_user ON watchlists(user_id);

      CREATE TABLE watchlist_items (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        watchlist_id TEXT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
        instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        UNIQUE (watchlist_id, instrument_id)
      );

      CREATE TABLE workspaces (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        layout     TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_workspaces_user ON workspaces(user_id);

      CREATE TABLE workspace_panels (
        id           TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        module_key   TEXT NOT NULL,
        position     INTEGER NOT NULL,
        config       TEXT,
        linked_instrument_id TEXT
      );

      CREATE TABLE saved_charts (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        instrument_id TEXT REFERENCES instruments(id),
        title        TEXT NOT NULL,
        timeframe    TEXT NOT NULL,
        study        TEXT,
        template     TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      CREATE TABLE chart_annotations (
        id          TEXT PRIMARY KEY,
        chart_id    TEXT NOT NULL REFERENCES saved_charts(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL,
        payload     TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
    `,
  },
  {
    version: 5,
    name: "news_economics_research",
    sql: `
      CREATE TABLE news_sources (
        id           TEXT PRIMARY KEY,
        key          TEXT NOT NULL UNIQUE,
        name         TEXT NOT NULL,
        kind         TEXT NOT NULL,
        homepage     TEXT,
        licensed     INTEGER NOT NULL DEFAULT 0,
        enabled      INTEGER NOT NULL DEFAULT 0,
        notes        TEXT
      );

      CREATE TABLE news_items (
        id              TEXT PRIMARY KEY,
        source_key      TEXT NOT NULL,
        headline        TEXT NOT NULL,
        summary         TEXT,
        url             TEXT,
        priority        TEXT NOT NULL DEFAULT 'general',
        priority_rule   TEXT,
        categories      TEXT,
        instruments     TEXT,
        published_at    TEXT NOT NULL,
        received_at     TEXT NOT NULL,
        ingested_via    TEXT NOT NULL,
        is_fixture      INTEGER NOT NULL DEFAULT 0,
        dedupe_key      TEXT,
        UNIQUE (source_key, dedupe_key)
      );
      CREATE INDEX idx_news_published ON news_items(published_at DESC);
      CREATE INDEX idx_news_priority ON news_items(priority);

      CREATE TABLE economic_events (
        id            TEXT PRIMARY KEY,
        country       TEXT NOT NULL,
        indicator     TEXT NOT NULL,
        importance    TEXT NOT NULL,
        scheduled_at  TEXT NOT NULL,
        timezone      TEXT NOT NULL DEFAULT 'UTC',
        unit          TEXT,
        source        TEXT NOT NULL,
        source_url    TEXT,
        status        TEXT NOT NULL DEFAULT 'scheduled',
        is_fixture    INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_econ_scheduled ON economic_events(scheduled_at);

      CREATE TABLE economic_observations (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id     TEXT REFERENCES economic_events(id) ON DELETE SET NULL,
        country      TEXT NOT NULL,
        indicator    TEXT NOT NULL,
        period       TEXT,
        actual       REAL,
        consensus    REAL,
        previous     REAL,
        revised_previous REAL,
        unit         TEXT,
        source       TEXT NOT NULL,
        source_url   TEXT,
        is_fixture   INTEGER NOT NULL DEFAULT 0,
        published_at TEXT NOT NULL
      );
      CREATE INDEX idx_econ_obs_indicator ON economic_observations(country, indicator, published_at);

      CREATE TABLE company_profiles (
        instrument_id  TEXT PRIMARY KEY REFERENCES instruments(id) ON DELETE CASCADE,
        legal_name     TEXT NOT NULL,
        sector         TEXT,
        industry       TEXT,
        country        TEXT,
        employees      INTEGER,
        description    TEXT,
        cik            TEXT,
        fiscal_year_end TEXT,
        source         TEXT,
        updated_at     TEXT NOT NULL
      );

      CREATE TABLE company_financials (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
        statement     TEXT NOT NULL,
        line_item     TEXT NOT NULL,
        period        TEXT NOT NULL,
        period_type   TEXT NOT NULL,
        value         REAL,
        unit          TEXT,
        currency      TEXT,
        source        TEXT NOT NULL,
        filed_at      TEXT,
        UNIQUE (instrument_id, statement, line_item, period)
      );

      CREATE TABLE filings (
        id            TEXT PRIMARY KEY,
        instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
        form_type     TEXT NOT NULL,
        title         TEXT,
        filed_at      TEXT NOT NULL,
        period        TEXT,
        url           TEXT,
        accession     TEXT,
        source        TEXT NOT NULL
      );
      CREATE INDEX idx_filings_instrument ON filings(instrument_id, filed_at DESC);
    `,
  },
  {
    version: 6,
    name: "options_analytics_alerts",
    sql: `
      CREATE TABLE options_snapshots (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        underlying_id     TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
        as_of             TEXT NOT NULL,
        expiration        TEXT NOT NULL,
        strike            REAL NOT NULL,
        option_type       TEXT NOT NULL,
        bid               REAL,
        ask               REAL,
        last              REAL,
        volume            REAL,
        open_interest     REAL,
        implied_vol       REAL,
        delta             REAL,
        gamma             REAL,
        theta             REAL,
        vega              REAL,
        rho               REAL,
        greeks_source     TEXT NOT NULL,
        underlying_price  REAL,
        source            TEXT NOT NULL
      );
      CREATE INDEX idx_opts_underlying ON options_snapshots(underlying_id, as_of DESC);

      CREATE TABLE analytics_runs (
        id           TEXT PRIMARY KEY,
        kind         TEXT NOT NULL,
        input_hash   TEXT NOT NULL,
        model_version TEXT NOT NULL,
        params       TEXT NOT NULL,
        result       TEXT NOT NULL,
        created_by   TEXT,
        created_at   TEXT NOT NULL
      );

      CREATE TABLE alerts (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        kind         TEXT NOT NULL,
        target       TEXT,
        condition    TEXT NOT NULL,
        delivery     TEXT NOT NULL DEFAULT 'in_app',
        enabled      INTEGER NOT NULL DEFAULT 1,
        state        TEXT NOT NULL DEFAULT 'idle',
        last_fired_at TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX idx_alerts_user ON alerts(user_id);

      CREATE TABLE alert_events (
        id         TEXT PRIMARY KEY,
        alert_id   TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
        fired_at   TEXT NOT NULL,
        message    TEXT NOT NULL,
        payload    TEXT,
        source     TEXT
      );
      CREATE INDEX idx_alert_events_alert ON alert_events(alert_id, fired_at DESC);
    `,
  },
  {
    version: 7,
    name: "portfolio_bots_entitlements",
    sql: `
      CREATE TABLE portfolio_accounts (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label         TEXT NOT NULL,
        broker        TEXT NOT NULL,
        account_ref   TEXT NOT NULL,
        base_currency TEXT NOT NULL DEFAULT 'USD',
        mode          TEXT NOT NULL DEFAULT 'read_only',
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_port_accounts_user ON portfolio_accounts(user_id);

      CREATE TABLE positions (
        id            TEXT PRIMARY KEY,
        account_id    TEXT NOT NULL REFERENCES portfolio_accounts(id) ON DELETE CASCADE,
        instrument_id TEXT NOT NULL REFERENCES instruments(id),
        quantity      REAL NOT NULL,
        avg_price     REAL NOT NULL,
        opened_at     TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_positions_account ON positions(account_id);

      CREATE TABLE trades (
        id            TEXT PRIMARY KEY,
        account_id    TEXT NOT NULL REFERENCES portfolio_accounts(id) ON DELETE CASCADE,
        instrument_id TEXT NOT NULL REFERENCES instruments(id),
        side          TEXT NOT NULL,
        quantity      REAL NOT NULL,
        price         REAL NOT NULL,
        fees          REAL NOT NULL DEFAULT 0,
        realized_pnl  REAL,
        executed_at   TEXT NOT NULL,
        source        TEXT NOT NULL
      );
      CREATE INDEX idx_trades_account ON trades(account_id, executed_at DESC);

      CREATE TABLE bot_connections (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label         TEXT NOT NULL,
        platform      TEXT NOT NULL,
        strategy      TEXT,
        version       TEXT,
        enabled       INTEGER NOT NULL DEFAULT 0,
        exec_enabled  INTEGER NOT NULL DEFAULT 0,
        last_heartbeat TEXT,
        state         TEXT NOT NULL DEFAULT 'unknown',
        metadata      TEXT,
        created_at    TEXT NOT NULL
      );

      CREATE TABLE bot_events (
        id           TEXT PRIMARY KEY,
        bot_id       TEXT NOT NULL REFERENCES bot_connections(id) ON DELETE CASCADE,
        at           TEXT NOT NULL,
        level        TEXT NOT NULL,
        event_type   TEXT NOT NULL,
        message      TEXT NOT NULL,
        payload      TEXT
      );
      CREATE INDEX idx_bot_events_bot ON bot_events(bot_id, at DESC);

      CREATE TABLE entitlement_records (
        id            TEXT PRIMARY KEY,
        provider      TEXT NOT NULL,
        dataset       TEXT NOT NULL,
        level         TEXT NOT NULL,
        user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
        granted_at    TEXT NOT NULL,
        expires_at    TEXT,
        notes         TEXT
      );
    `,
  },
  {
    version: 8,
    name: "orderflow_archive",
    sql: `
      -- Bounded archive of real bridge events used by the order-flow APIs.
      -- Depth snapshots are throttled server-side (≤1/s per instrument) and both
      -- tables are pruned to FYIP_ORDERFLOW_RETENTION_HOURS (default 72h).
      -- No synthetic rows are ever written here.
      CREATE TABLE trade_prints (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        instrument_id      TEXT NOT NULL,
        provider           TEXT NOT NULL,
        provider_symbol    TEXT,
        price              REAL NOT NULL,
        size               REAL NOT NULL,
        side               TEXT,
        side_source        TEXT NOT NULL DEFAULT 'unknown',
        event_timestamp    TEXT NOT NULL,
        received_timestamp TEXT NOT NULL,
        data_status        TEXT NOT NULL,
        sequence           REAL
      );
      CREATE INDEX idx_trade_prints_instrument_time ON trade_prints(instrument_id, event_timestamp);
      CREATE INDEX idx_trade_prints_time ON trade_prints(event_timestamp);

      CREATE TABLE depth_snapshots (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        instrument_id      TEXT NOT NULL,
        provider           TEXT NOT NULL,
        provider_symbol    TEXT,
        event_timestamp    TEXT NOT NULL,
        received_timestamp TEXT NOT NULL,
        bids               TEXT NOT NULL,
        asks               TEXT NOT NULL,
        data_status        TEXT NOT NULL
      );
      CREATE INDEX idx_depth_snapshots_instrument_time ON depth_snapshots(instrument_id, event_timestamp);
      CREATE INDEX idx_depth_snapshots_time ON depth_snapshots(event_timestamp);
    `,
  },
  {
    version: 9,
    name: "futures_minute_volume",
    sql: `
      -- Materialized per-minute price aggregates. Keeping this tiny table current
      -- on ingest lets the futures analytics endpoint answer in milliseconds even
      -- while trade_prints holds millions of rows. Backfilled once from the
      -- existing archive; no synthetic rows are ever written here.
      CREATE TABLE futures_minute_volume (
        instrument_id TEXT NOT NULL,
        minute        TEXT NOT NULL,
        price         REAL NOT NULL,
        volume        REAL NOT NULL,
        buy_volume    REAL NOT NULL,
        sell_volume   REAL NOT NULL,
        prints        INTEGER NOT NULL,
        price_volume  REAL NOT NULL,
        PRIMARY KEY (instrument_id, minute, price)
      ) WITHOUT ROWID;

      INSERT INTO futures_minute_volume (
        instrument_id, minute, price, volume, buy_volume, sell_volume, prints, price_volume)
      SELECT instrument_id,
             substr(event_timestamp, 1, 16),
             price,
             SUM(size),
             SUM(CASE WHEN side = 'buy' THEN size ELSE 0 END),
             SUM(CASE WHEN side = 'sell' THEN size ELSE 0 END),
             COUNT(*),
             SUM(price * size)
        FROM trade_prints
       GROUP BY instrument_id, substr(event_timestamp, 1, 16), price;
    `,
  },
];