package store

import (
	"context"

	"ai-subscriptions/internal/providers"
)

// SubscriptionRefs projects every subscription onto the provider-reference
// shape /api/providers enriches with counts. It implements the ProviderRefSource
// seam the providers ticket (#25) defined; a read error degrades to "no
// references", matching the old stack's empty-install behaviour.
func (s *Store) SubscriptionRefs() []providers.ProviderRef {
	rows, err := s.db.QueryContext(context.Background(),
		"SELECT provider, provider_custom FROM subscriptions ORDER BY rowid")
	if err != nil {
		return nil
	}
	defer rows.Close()

	refs := make([]providers.ProviderRef, 0)
	for rows.Next() {
		var ref providers.ProviderRef
		if err := rows.Scan(&ref.Provider, &ref.ProviderCustom); err != nil {
			return nil
		}
		refs = append(refs, ref)
	}
	return refs
}

// ToolRefs is the tools counterpart of SubscriptionRefs.
func (s *Store) ToolRefs() []providers.ProviderRef {
	rows, err := s.db.QueryContext(context.Background(),
		"SELECT provider, provider_custom FROM tools ORDER BY rowid")
	if err != nil {
		return nil
	}
	defer rows.Close()

	refs := make([]providers.ProviderRef, 0)
	for rows.Next() {
		var ref providers.ProviderRef
		if err := rows.Scan(&ref.Provider, &ref.ProviderCustom); err != nil {
			return nil
		}
		refs = append(refs, ref)
	}
	return refs
}
