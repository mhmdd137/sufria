-- 0019_order_item_notes — brief ن (item notes).
-- order_items.notes has existed since 0001 and was never written. From brief ن
-- the engine writes the customer's note for a line, as written, at «أكّد».
-- One to 100 characters, or NULL: the engine never writes an empty note.
BEGIN;

ALTER TABLE order_items
  ADD CONSTRAINT order_items_notes_length
  CHECK (notes IS NULL OR char_length(notes) BETWEEN 1 AND 100);

COMMIT;
