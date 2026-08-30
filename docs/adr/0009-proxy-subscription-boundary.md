# Proxy Subscriptions Have an Independent Boundary

Proxy Subscriptions are stored and managed as a separate entity from AI Subscriptions, including a separate JSON data file, API surface, status vocabulary, and tag vocabulary. This preserves the existing AI Subscription invariants (providers, quota schedules, usage queries, and stable AI tags) while allowing proxy access to use its own manually maintained lifecycle and expiration-date model.

The proxy record persists only its expiration date; the optional start-date plus duration input is a form-level calculation that writes the inclusive expiration date (`start + days - 1`). Expiration notices are informational and only calculated for records manually marked In Use, so an Unused record never participates in expiry processing.
