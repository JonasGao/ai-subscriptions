# Stable Identity for Subscription Tags

Subscription Tags are stored as independent entities with stable IDs, and subscriptions reference those IDs instead of embedding Tag names. Although embedded names would make the initial JSON shape simpler, stable identity preserves every subscription association across global renames, allows unused Tags to remain available, and makes global deletion an explicit operation over one known entity.

## Status

Accepted

## Consequences

- Tag name uniqueness is validated separately from identity. Names are trimmed and compared case-sensitively, so `OpenAI` and `openai` may coexist.
- Renaming a Tag updates only the Tag entity; subscriptions retain their existing Tag IDs and ordering.
- Deleting a Tag removes its ID from every subscription in the same atomic data write.
- Existing subscriptions migrate with no Tag associations, and no default Tags are created.
