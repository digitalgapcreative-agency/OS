-- DGAP OS v0.1 · MySQL 8+ · all financial amounts are integer IDR, not floats.
-- Import into a dedicated database. Re-running is safe for initial tables only.
CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','manager','member','finance','client') NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX(expires_at)
);
CREATE TABLE IF NOT EXISTS clients (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  industry VARCHAR(120) DEFAULT '',
  contact_name VARCHAR(150) DEFAULT '',
  contact_email VARCHAR(190) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS client_memberships (
  user_id CHAR(36) NOT NULL,
  client_id CHAR(36) NOT NULL,
  permission ENUM('viewer','approver') NOT NULL DEFAULT 'viewer',
  PRIMARY KEY(user_id,client_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS invitations (
  id CHAR(36) PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  client_id CHAR(36) NOT NULL,
  email VARCHAR(190) NOT NULL,
  permission ENUM('viewer','approver') NOT NULL DEFAULT 'viewer',
  expires_at DATETIME NOT NULL,
  redeemed_at DATETIME DEFAULT NULL,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS leads (
  id CHAR(36) PRIMARY KEY,
  company_name VARCHAR(190) NOT NULL,
  contact_name VARCHAR(150) DEFAULT '',
  email VARCHAR(190) DEFAULT '',
  source VARCHAR(80) DEFAULT 'Manual',
  service VARCHAR(80) DEFAULT 'Strategic Diagnosis',
  stage VARCHAR(60) NOT NULL DEFAULT 'New Lead',
  budget BIGINT NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX(stage)
);
CREATE TABLE IF NOT EXISTS projects (
  id CHAR(36) PRIMARY KEY,
  client_id CHAR(36) NOT NULL,
  title VARCHAR(190) NOT NULL,
  service VARCHAR(80) NOT NULL,
  business_stage ENUM('launch','existing') NOT NULL DEFAULT 'existing',
  status ENUM('active','on_hold','completed') NOT NULL DEFAULT 'active',
  owner_id CHAR(36) DEFAULT NULL,
  start_date DATE DEFAULT NULL,
  due_date DATE DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id) REFERENCES clients(id),
  FOREIGN KEY(owner_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS project_members (
  project_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  PRIMARY KEY(project_id,user_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS project_stages (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  sort_index INT NOT NULL,
  name VARCHAR(80) NOT NULL,
  status ENUM('locked','active','approved') NOT NULL DEFAULT 'locked',
  approved_by CHAR(36) DEFAULT NULL,
  approved_at DATETIME DEFAULT NULL,
  approval_note TEXT,
  UNIQUE(project_id,sort_index),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS tasks (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  stage_id CHAR(36) DEFAULT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  status ENUM('todo','in_progress','review','blocked','done') NOT NULL DEFAULT 'todo',
  assignee_id CHAR(36) DEFAULT NULL,
  due_date DATE DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(stage_id) REFERENCES project_stages(id) ON DELETE SET NULL,
  FOREIGN KEY(assignee_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS file_assets (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  uploader_id CHAR(36) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  storage_key VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  byte_size BIGINT NOT NULL,
  visible_to_client TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(uploader_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS deliverables (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  stage_id CHAR(36) DEFAULT NULL,
  title VARCHAR(190) NOT NULL,
  status ENUM('draft','internal_review','client_review','approved','changes_requested') NOT NULL DEFAULT 'draft',
  file_id CHAR(36) DEFAULT NULL,
  version INT NOT NULL DEFAULT 1,
  visible_to_client TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(stage_id) REFERENCES project_stages(id) ON DELETE SET NULL,
  FOREIGN KEY(file_id) REFERENCES file_assets(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS deliverable_versions (
  deliverable_id CHAR(36) NOT NULL,
  version INT NOT NULL,
  file_id CHAR(36) NOT NULL,
  published_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(deliverable_id,version),
  FOREIGN KEY(deliverable_id) REFERENCES deliverables(id) ON DELETE CASCADE,
  FOREIGN KEY(file_id) REFERENCES file_assets(id)
);
CREATE TABLE IF NOT EXISTS approvals (
  id CHAR(36) PRIMARY KEY,
  deliverable_id CHAR(36) NOT NULL,
  version INT NOT NULL,
  actor_id CHAR(36) NOT NULL,
  decision ENUM('approved','changes_requested') NOT NULL,
  note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(deliverable_id) REFERENCES deliverables(id),
  FOREIGN KEY(actor_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS project_comments (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  author_id CHAR(36) NOT NULL,
  body TEXT NOT NULL,
  visible_to_client TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(author_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS finance_accounts (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  kind ENUM('bank','cash','savings') NOT NULL DEFAULT 'bank',
  opening_balance BIGINT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS finance_categories (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  kind ENUM('income','expense') NOT NULL,
  UNIQUE(name,kind)
);
CREATE TABLE IF NOT EXISTS invoices (
  id CHAR(36) PRIMARY KEY,
  client_id CHAR(36) NOT NULL,
  project_id CHAR(36) DEFAULT NULL,
  invoice_number VARCHAR(64) NOT NULL UNIQUE,
  amount BIGINT NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  status ENUM('draft','issued','void') NOT NULL DEFAULT 'issued',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id) REFERENCES clients(id),
  FOREIGN KEY(project_id) REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS bills (
  id CHAR(36) PRIMARY KEY,
  supplier VARCHAR(190) NOT NULL,
  category_id CHAR(36) DEFAULT NULL,
  project_id CHAR(36) DEFAULT NULL,
  amount BIGINT NOT NULL,
  due_date DATE NOT NULL,
  status ENUM('open','void') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(category_id) REFERENCES finance_categories(id),
  FOREIGN KEY(project_id) REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS finance_transactions (
  id CHAR(36) PRIMARY KEY,
  posted_date DATE NOT NULL,
  kind ENUM('income','expense','transfer') NOT NULL,
  account_id CHAR(36) NOT NULL,
  destination_account_id CHAR(36) DEFAULT NULL,
  category_id CHAR(36) DEFAULT NULL,
  amount BIGINT NOT NULL,
  description VARCHAR(255) NOT NULL,
  idempotency_key VARCHAR(100) NOT NULL UNIQUE,
  project_id CHAR(36) DEFAULT NULL,
  invoice_id CHAR(36) DEFAULT NULL,
  bill_id CHAR(36) DEFAULT NULL,
  created_by CHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(account_id) REFERENCES finance_accounts(id),
  FOREIGN KEY(destination_account_id) REFERENCES finance_accounts(id),
  FOREIGN KEY(category_id) REFERENCES finance_categories(id),
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(invoice_id) REFERENCES invoices(id),
  FOREIGN KEY(bill_id) REFERENCES bills(id),
  FOREIGN KEY(created_by) REFERENCES users(id),
  INDEX(posted_date), INDEX(invoice_id), INDEX(bill_id)
);
CREATE TABLE IF NOT EXISTS budgets (
  id CHAR(36) PRIMARY KEY,
  month CHAR(7) NOT NULL,
  category_id CHAR(36) NOT NULL,
  limit_amount BIGINT NOT NULL,
  UNIQUE(month,category_id),
  FOREIGN KEY(category_id) REFERENCES finance_categories(id)
);
CREATE TABLE IF NOT EXISTS audit_events (
  id CHAR(36) PRIMARY KEY,
  actor_id CHAR(36) NOT NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id CHAR(36) NOT NULL,
  metadata JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(actor_id) REFERENCES users(id),
  INDEX(entity_type, entity_id)
);
CREATE TABLE IF NOT EXISTS app_state (
  id TINYINT PRIMARY KEY,
  initialized TINYINT(1) NOT NULL DEFAULT 0
);
INSERT IGNORE INTO app_state(id,initialized) VALUES(1,0);
