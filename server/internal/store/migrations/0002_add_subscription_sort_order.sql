-- Add sort_order column to subscriptions for drag-and-drop reordering
ALTER TABLE subscriptions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
