// Package store is the SQLite storage engine (ADR-0017).
//
// It owns the schema (embedded migrations tracked by PRAGMA user_version), the
// WAL/runtime pragmas, file snapshots, and the document-level read/write APIs
// that the rest of the server uses. The old stack's lib/db.ts read-modify-write
// document is the behavioural reference; SQLite transactions replace its
// unlocked whole-file rewrite.
package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite" // pure-Go driver: keeps CGO_ENABLED=0 builds possible

	"ai-subscriptions/internal/crypto"
	"ai-subscriptions/internal/model"
)

// latestSchemaVersion is bumped by every migration file under migrations/.
const latestSchemaVersion = 1

// DefaultFilename is the SQLite database file inside DATA_DIR.
const DefaultFilename = "ai-subscriptions.db"

// migrationsFS is the embedded migration source.
//
//go:embed migrations/*.sql
var migrationsFS embed.FS

// Store is an open SQLite database.
type Store struct {
	db   *sql.DB
	path string
	now  func() time.Time
	// cipher is used only by the legacy apiKey→credentials import rule; live
	// credentials are stored verbatim (ADR-0017).
	cipher *crypto.Cipher
	// legacySnapshot is the pre-import subscriptions.json copy path.
	legacySnapshot string
	// skipLegacyImport lets operator tools drive the import explicitly.
	skipLegacyImport bool
}

// Option customises Open.
type Option func(*Store)

// WithClock replaces the time source (tests use it for deterministic snapshot
// names and timestamps; production uses time.Now).
func WithClock(now func() time.Time) Option {
	return func(s *Store) { s.now = now }
}

// WithCipher replaces the cipher used by the legacy import.
func WithCipher(c *crypto.Cipher) Option {
	return func(s *Store) { s.cipher = c }
}

// WithoutLegacyImport disables the automatic first-start import, so an
// operator tool can run and report on the import explicitly.
func WithoutLegacyImport() Option {
	return func(s *Store) { s.skipLegacyImport = true }
}

// Open opens (creating if needed) the SQLite database at path and applies
// embedded migrations. A database written by a newer schema is refused instead
// of being silently downgraded.
func Open(path string, opts ...Option) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create db dir: %w", err)
	}

	// Pragmas are set per connection via the DSN so every pooled connection
	// inherits them. WAL is persistent, but busy_timeout/foreign_keys are not.
	dsn := "file:" + path +
		"?_pragma=journal_mode(WAL)" +
		"&_pragma=busy_timeout(5000)" +
		"&_pragma=foreign_keys(1)" +
		"&_pragma=synchronous(NORMAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite %q: %w", path, err)
	}
	// One connection serialises writers and makes `:memory:` tests coherent.
	db.SetMaxOpenConns(1)

	s := &Store{db: db, path: path, now: time.Now, cipher: crypto.NewFromEnv(os.Getenv)}
	for _, opt := range opts {
		opt(s)
	}

	ctx := context.Background()
	if err := s.ensureWAL(ctx); err != nil {
		db.Close()
		return nil, err
	}
	if err := s.migrate(ctx); err != nil {
		db.Close()
		return nil, err
	}
	// ADR-0017: first start imports the old stack's JSON documents. The
	// importer snapshots them before touching the database.
	if !s.skipLegacyImport {
		if err := s.importLegacyIfNeeded(filepath.Dir(path)); err != nil {
			db.Close()
			return nil, err
		}
	}
	return s, nil
}

func (s *Store) ensureWAL(ctx context.Context) error {
	var mode string
	if err := s.db.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&mode); err != nil {
		return fmt.Errorf("read journal_mode: %w", err)
	}
	if !strings.EqualFold(mode, "wal") {
		if _, err := s.db.ExecContext(ctx, "PRAGMA journal_mode = WAL"); err != nil {
			return fmt.Errorf("enable WAL: %w", err)
		}
	}
	return nil
}

func (s *Store) migrate(ctx context.Context) error {
	version, err := s.userVersion(ctx)
	if err != nil {
		return err
	}
	if version > latestSchemaVersion {
		return fmt.Errorf(
			"database schema version %d is newer than this binary supports (%d): refusing to open",
			version, latestSchemaVersion,
		)
	}

	entries, err := fs.Glob(migrationsFS, "migrations/*.sql")
	if err != nil {
		return fmt.Errorf("list migrations: %w", err)
	}
	sort.Strings(entries)

	for i, entry := range entries {
		target := i + 1
		if target <= version {
			continue
		}
		body, err := fs.ReadFile(migrationsFS, entry)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", entry, err)
		}
		if err := s.applyMigration(ctx, target, string(body)); err != nil {
			return fmt.Errorf("apply migration %s: %w", entry, err)
		}
	}
	return nil
}

// applyMigration runs one migration file and records its version atomically.
func (s *Store) applyMigration(ctx context.Context, version int, body string) error {
	statements := splitStatements(body)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	for _, statement := range statements {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("statement %q: %w", firstLine(statement), err)
		}
	}
	// PRAGMA user_version does not accept parameters; version is an int.
	if _, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", version)); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("set user_version: %w", err)
	}
	return tx.Commit()
}

// splitStatements strips "--" line comments, then splits the migration on
// semicolons. Migrations are plain DDL, so a comment marker can never appear
// inside a string literal.
func splitStatements(body string) []string {
	var cleaned strings.Builder
	for _, line := range strings.Split(body, "\n") {
		if idx := strings.Index(line, "--"); idx >= 0 {
			line = line[:idx]
		}
		cleaned.WriteString(line)
		cleaned.WriteByte('\n')
	}

	var out []string
	for _, chunk := range strings.Split(cleaned.String(), ";") {
		trimmed := strings.TrimSpace(chunk)
		if trimmed == "" {
			continue
		}
		out = append(out, trimmed)
	}
	return out
}

func firstLine(statement string) string {
	if idx := strings.IndexByte(statement, '\n'); idx >= 0 {
		return statement[:idx]
	}
	return statement
}

func (s *Store) userVersion(ctx context.Context) (int, error) {
	var version int
	if err := s.db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return 0, fmt.Errorf("read user_version: %w", err)
	}
	return version, nil
}

// SchemaVersion returns the database's current PRAGMA user_version, or -1 if
// it cannot be read.
func (s *Store) SchemaVersion() int {
	version, err := s.userVersion(context.Background())
	if err != nil {
		return -1
	}
	return version
}

// Path returns the database file path.
func (s *Store) Path() string { return s.path }

// Close closes the database.
func (s *Store) Close() error { return s.db.Close() }

// DB exposes the underlying handle for the packages that share this database
// (auth, later domain services). Prefer the typed methods.
func (s *Store) DB() *sql.DB { return s.db }

// nowISO mirrors JavaScript's new Date().toISOString(): UTC, millisecond
// precision, trailing Z.
func (s *Store) nowISO() string { return model.FormatTimestamp(s.now()) }

// withTx runs fn inside a transaction, rolling back on error.
func (s *Store) withTx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// ---------- Snapshots (backup semantics, ADR-0017) ----------

const snapshotRetention = 10

// Snapshot writes a consistent copy of the database into <dir>/backups and
// prunes older snapshots, keeping the newest snapshotRetention files.
func (s *Store) Snapshot() (string, error) {
	dir := filepath.Join(filepath.Dir(s.path), "backups")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create snapshot dir: %w", err)
	}

	base := strings.TrimSuffix(filepath.Base(s.path), filepath.Ext(s.path))
	target := filepath.Join(dir, base+"."+snapshotTimestamp(s.now())+".db")
	for suffix := 1; fileExists(target); suffix++ {
		target = filepath.Join(dir, fmt.Sprintf("%s.%s-%d.db", base, snapshotTimestamp(s.now()), suffix))
	}

	// VACUUM INTO produces a transactionally consistent copy even while the
	// database is in WAL mode.
	statement := "VACUUM INTO " + quoteSQLString(target)
	if _, err := s.db.Exec(statement); err != nil {
		return "", fmt.Errorf("snapshot %q: %w", target, err)
	}
	if err := s.pruneSnapshots(dir); err != nil {
		return "", err
	}
	return target, nil
}

// SnapshotFiles lists existing snapshots newest first (absolute paths).
func (s *Store) SnapshotFiles() ([]string, error) {
	dir := filepath.Join(filepath.Dir(s.path), "backups")
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	base := strings.TrimSuffix(filepath.Base(s.path), filepath.Ext(s.path)) + "."
	paths := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), base) || !strings.HasSuffix(entry.Name(), ".db") {
			continue
		}
		absolute, err := filepath.Abs(filepath.Join(dir, entry.Name()))
		if err != nil {
			return nil, err
		}
		paths = append(paths, absolute)
	}
	// Timestamped names sort lexicographically in chronological order.
	sort.Sort(sort.Reverse(sort.StringSlice(paths)))
	return paths, nil
}

func (s *Store) pruneSnapshots(dir string) error {
	files, err := s.SnapshotFiles()
	if err != nil {
		return err
	}
	if len(files) <= snapshotRetention {
		return nil
	}
	for _, file := range files[snapshotRetention:] {
		if err := os.Remove(file); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("prune snapshot %q: %w", file, err)
		}
	}
	return nil
}

// snapshotTimestamp matches the old stack's backup stamp: ISO-8601 with ':'
// and '.' replaced by '-'.
func snapshotTimestamp(t time.Time) string {
	return strings.NewReplacer(":", "-", ".", "-").Replace(t.UTC().Format("2006-01-02T15:04:05.000Z"))
}

func quoteSQLString(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func isNoRows(err error) bool {
	return errors.Is(err, sql.ErrNoRows)
}
