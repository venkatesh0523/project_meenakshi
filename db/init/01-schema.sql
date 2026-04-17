CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(200) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pending_user_registrations (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(200) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  otp_code VARCHAR(6) NOT NULL,
  otp_expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devices (
  id SERIAL PRIMARY KEY,
  device_id VARCHAR(100) NOT NULL UNIQUE,
  device_name VARCHAR(150) NOT NULL,
  device_type VARCHAR(100) NOT NULL DEFAULT 'arduino',
  location VARCHAR(150),
  wifi_ssid VARCHAR(150),
  wifi_password TEXT,
  wifi_configured_at TIMESTAMPTZ,
  device_secret VARCHAR(128),
  last_seen_at TIMESTAMPTZ,
  last_status VARCHAR(30),
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS led_commands (
  id SERIAL PRIMARY KEY,
  device_id VARCHAR(100) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  command VARCHAR(10) NOT NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'next-app',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE devices
ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE devices
ADD COLUMN IF NOT EXISTS device_secret VARCHAR(128);

ALTER TABLE devices
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

ALTER TABLE devices
ADD COLUMN IF NOT EXISTS last_status VARCHAR(30);

ALTER TABLE devices
ADD COLUMN IF NOT EXISTS wifi_ssid VARCHAR(150);

ALTER TABLE devices
ADD COLUMN IF NOT EXISTS wifi_password TEXT;

ALTER TABLE devices
ADD COLUMN IF NOT EXISTS wifi_configured_at TIMESTAMPTZ;

ALTER TABLE pending_user_registrations
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

INSERT INTO devices (device_id, device_name, device_type, location)
VALUES ('arduino-led-01', 'Starter LED Device', 'arduino', 'Workbench')
ON CONFLICT (device_id) DO NOTHING;
