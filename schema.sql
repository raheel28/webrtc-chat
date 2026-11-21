-- Same table and column names as the original project where possible.
CREATE TABLE IF NOT EXISTS users_data (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,          -- new: first names are not unique, usernames are
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  gender TEXT,
  phone_number TEXT,
  pass_word TEXT NOT NULL,                -- bcrypt hash
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One-to-one history. Text and files travel peer-to-peer; the SENDER's browser also reports each
-- message here so history survives reloads. read_status drives the read receipts.
CREATE TABLE IF NOT EXISTS chats (
  id SERIAL PRIMARY KEY,
  sender TEXT NOT NULL REFERENCES users_data(username),
  recipient TEXT NOT NULL REFERENCES users_data(username),
  mess_age TEXT,
  file_name TEXT,
  base TEXT,                              -- file as a base64 data URL (max ~5 MB)
  read_status BOOLEAN NOT NULL DEFAULT false,
  sent_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (mess_age IS NOT NULL OR base IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS chats_pair_idx ON chats (sender, recipient, sent_time);

-- Room history. Room messages go through the server and are saved before being broadcast.
CREATE TABLE IF NOT EXISTS room_chat (
  id SERIAL PRIMARY KEY,
  room TEXT NOT NULL,
  sender TEXT NOT NULL REFERENCES users_data(username),
  mess_age TEXT,
  file_name TEXT,
  base TEXT,
  sent_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (mess_age IS NOT NULL OR base IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS room_chat_idx ON room_chat (room, sent_time);
