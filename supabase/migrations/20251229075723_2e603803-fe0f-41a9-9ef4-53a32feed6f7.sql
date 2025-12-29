-- Step 1: Add new UUID column for playbook reference
ALTER TABLE trades ADD COLUMN playbook_id uuid REFERENCES playbooks(id) ON DELETE SET NULL;

-- Step 2: Migrate existing data (map model names to playbook IDs)
UPDATE trades t
SET playbook_id = p.id
FROM playbooks p
WHERE t.model = p.name AND t.model IS NOT NULL;

-- Step 3: Drop the old model column
ALTER TABLE trades DROP COLUMN model;