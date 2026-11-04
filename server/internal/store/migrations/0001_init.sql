-- Schema 0001: document tables mapped 1:1 onto lib/types.ts shapes.
--
-- ADR-0017: this is data movement, not data redesign. Column names are the
-- JSON keys in snake_case; nesting that the old stack expressed as embedded
-- arrays/objects becomes child tables. Fields the old stack left optional stay
-- NULLable (or default '') so the importer can round-trip an absent value.

CREATE TABLE subscriptions (
    id                    TEXT PRIMARY KEY,
    name                  TEXT    NOT NULL,
    category              TEXT    NOT NULL,
    provider              TEXT    NOT NULL,
    provider_custom       TEXT    NOT NULL DEFAULT '',
    subscription_type     TEXT    NOT NULL DEFAULT 'recurring',
    billing_cycle         TEXT    NOT NULL DEFAULT '',
    price                 REAL    NOT NULL DEFAULT 0,
    start_date            TEXT    NOT NULL DEFAULT '',
    renewal_date          TEXT    NOT NULL DEFAULT '',
    status                TEXT    NOT NULL DEFAULT 'active',
    notes                 TEXT    NOT NULL DEFAULT '',
    -- Ciphertext exactly as the Node stack wrote it; never re-encrypted.
    credentials           TEXT    NOT NULL DEFAULT '',
    balance               REAL,
    balance_currency      TEXT    NOT NULL DEFAULT '',
    low_balance_threshold REAL,
    plan_id               TEXT    NOT NULL DEFAULT '',
    created_at            TEXT    NOT NULL,
    updated_at            TEXT    NOT NULL
);

CREATE TABLE reset_schedules (
    id               TEXT PRIMARY KEY,
    subscription_id  TEXT    NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
    type             TEXT    NOT NULL,
    enabled          INTEGER NOT NULL DEFAULT 1,
    time_of_day      TEXT,
    timezone         TEXT,
    day_of_week      INTEGER,
    day_of_month     INTEGER,
    next_reset_time  TEXT    NOT NULL DEFAULT '',
    exhausted        INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT    NOT NULL,
    updated_at       TEXT    NOT NULL,
    -- At most one schedule per type per subscription (ADR-0001/0002).
    UNIQUE (subscription_id, type)
);

CREATE INDEX reset_schedules_subscription_idx ON reset_schedules (subscription_id);

CREATE TABLE tags (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE subscription_tags (
    subscription_id TEXT NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
    tag_id          TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    position        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (subscription_id, tag_id)
);

CREATE INDEX subscription_tags_tag_idx ON subscription_tags (tag_id);

CREATE TABLE categories (
    name     TEXT PRIMARY KEY,
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE priority_scenes (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE priority_scene_items (
    scene_id        TEXT    NOT NULL REFERENCES priority_scenes (id) ON DELETE CASCADE,
    position        INTEGER NOT NULL,
    subscription_id TEXT    NOT NULL,
    PRIMARY KEY (scene_id, position)
);

CREATE TABLE tools (
    id              TEXT PRIMARY KEY,
    name            TEXT    NOT NULL,
    category        TEXT    NOT NULL DEFAULT '',
    provider        TEXT    NOT NULL DEFAULT '',
    provider_custom TEXT    NOT NULL DEFAULT '',
    forms_json      TEXT    NOT NULL DEFAULT '[]',
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_open_source  INTEGER NOT NULL DEFAULT 0,
    repo_url        TEXT    NOT NULL DEFAULT '',
    status          TEXT    NOT NULL DEFAULT 'active',
    notes           TEXT    NOT NULL DEFAULT '',
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL
);

CREATE TABLE tool_priority_scenes (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE tool_priority_scene_items (
    scene_id TEXT    NOT NULL REFERENCES tool_priority_scenes (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    tool_id  TEXT    NOT NULL,
    PRIMARY KEY (scene_id, position)
);

CREATE TABLE proxy_subscriptions (
    id              TEXT PRIMARY KEY,
    name            TEXT    NOT NULL,
    monthly_price   REAL    NOT NULL DEFAULT 0,
    expiration_date TEXT    NOT NULL DEFAULT '',
    website         TEXT    NOT NULL DEFAULT '',
    notes           TEXT    NOT NULL DEFAULT '',
    status          TEXT    NOT NULL DEFAULT 'unused',
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL
);

CREATE TABLE proxy_tags (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE proxy_subscription_tags (
    proxy_subscription_id TEXT NOT NULL REFERENCES proxy_subscriptions (id) ON DELETE CASCADE,
    tag_id                TEXT NOT NULL REFERENCES proxy_tags (id) ON DELETE CASCADE,
    position              INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (proxy_subscription_id, tag_id)
);

CREATE TABLE notification_channels (
    id              TEXT PRIMARY KEY,
    type            TEXT    NOT NULL,
    name            TEXT    NOT NULL DEFAULT '',
    url             TEXT    NOT NULL DEFAULT '',
    secret          TEXT    NOT NULL DEFAULT '',
    app_id          TEXT    NOT NULL DEFAULT '',
    app_secret      TEXT    NOT NULL DEFAULT '',
    receive_id      TEXT    NOT NULL DEFAULT '',
    receive_id_type TEXT    NOT NULL DEFAULT '',
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_send_json  TEXT,
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL
);

-- notifications.json is one document with a scalar plus a map; both get a
-- single-row home each so the document stays fully representable.
CREATE TABLE notification_settings (
    id                            INTEGER PRIMARY KEY CHECK (id = 1),
    default_low_balance_threshold REAL NOT NULL DEFAULT 10
);

CREATE TABLE balance_transition_states (
    subscription_id TEXT PRIMARY KEY,
    status          TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE auth_user (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    username      TEXT    NOT NULL,
    -- bcrypt hash, carried over from auth.json unchanged.
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL,
    updated_at    TEXT    NOT NULL,
    is_initial    INTEGER NOT NULL DEFAULT 1
);

-- Scalar document leftovers (last-monthly-reset.json today) as key/value.
CREATE TABLE app_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
