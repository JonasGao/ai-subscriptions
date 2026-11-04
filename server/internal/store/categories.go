package store

import (
	"context"
	"database/sql"
	"fmt"
)

// DefaultCategories is the seed catalogue of a fresh install
// (lib/types.ts defaultCategories).
var DefaultCategories = []string{"官方订阅", "中转站"}

// AddCategory appends a category and returns the full list. Adding an existing
// name is a no-op, exactly like lib/db.ts addCategory.
func (s *Store) AddCategory(name string) ([]string, error) {
	if name == "" {
		return nil, ErrCategoryEmpty
	}
	ctx := context.Background()
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		var position int
		err := tx.QueryRowContext(ctx,
			"SELECT COALESCE(MAX(position) + 1, 0) FROM categories").Scan(&position)
		if err != nil {
			return fmt.Errorf("read category position: %w", err)
		}
		_, err = tx.ExecContext(ctx,
			"INSERT OR IGNORE INTO categories(name, position) VALUES(?, ?)", name, position)
		if err != nil {
			return fmt.Errorf("insert category %q: %w", name, err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.Categories()
}

// DeleteCategory removes an unused category and returns the remaining list.
// A category still referenced by a subscription is refused (lib/db.ts
// deleteCategory) so no subscription is left pointing at a missing group.
func (s *Store) DeleteCategory(name string) ([]string, error) {
	ctx := context.Background()
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		var inUse int
		if err := tx.QueryRowContext(ctx,
			"SELECT COUNT(*) FROM subscriptions WHERE category = ?", name).Scan(&inUse); err != nil {
			return fmt.Errorf("count subscriptions in category %q: %w", name, err)
		}
		if inUse > 0 {
			return ErrCategoryInUse
		}
		if _, err := tx.ExecContext(ctx,
			"DELETE FROM categories WHERE name = ?", name); err != nil {
			return fmt.Errorf("delete category %q: %w", name, err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.Categories()
}

// categoriesSeededMarker records that the fresh-install catalogue has been
// written, so an operator who deletes every category does not get the defaults
// back on the next restart (the old stack kept an existing file untouched).
const categoriesSeededMarker = "default_categories_seeded"

// seedDefaultCategories mirrors getInitialData(): a fresh install starts with
// the built-in catalogue. An install imported from legacy JSON keeps whatever
// the old stack persisted, even when that list is empty.
func (s *Store) seedDefaultCategories(ctx context.Context) error {
	marker, err := s.AppState(categoriesSeededMarker)
	if err != nil {
		return err
	}
	if marker != "" {
		return nil
	}

	// A completed legacy import means the old stack already owned the
	// catalogue; keep it verbatim even when the list is empty.
	if imported, err := s.AppState(legacyImportMarker); err != nil {
		return err
	} else if imported != "" {
		return s.SetAppState(categoriesSeededMarker, "imported")
	}

	var count int
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM categories").Scan(&count); err != nil {
		return fmt.Errorf("count categories: %w", err)
	}
	if count > 0 {
		// Imported data already carries its own catalogue.
		return s.SetAppState(categoriesSeededMarker, "imported")
	}
	return s.withTx(ctx, func(tx *sql.Tx) error {
		for position, name := range DefaultCategories {
			if _, err := tx.ExecContext(ctx,
				"INSERT INTO categories(name, position) VALUES(?, ?)", name, position); err != nil {
				return fmt.Errorf("seed category %q: %w", name, err)
			}
		}
		if _, err := tx.ExecContext(ctx,
			"INSERT OR REPLACE INTO app_state(key, value) VALUES(?, ?)",
			categoriesSeededMarker, "seeded"); err != nil {
			return fmt.Errorf("write category seed marker: %w", err)
		}
		return nil
	})
}

var (
	// ErrCategoryEmpty rejects blank category names.
	ErrCategoryEmpty = errCategory("Category must be a non-empty string")
	// ErrCategoryInUse preserves the old stack's refusal to delete a category
	// that subscriptions still reference.
	ErrCategoryInUse = errCategory("Cannot delete category with subscriptions")
)

type errCategory string

func (e errCategory) Error() string { return string(e) }
