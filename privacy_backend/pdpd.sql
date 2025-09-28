-- paste the bcrypt hash you generated for your chosen password
-- node -e "console.log(require('bcryptjs').hashSync('Passw0rd!',10))"
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uniq_idx
  ON users ((LOWER(email)));

INSERT INTO users (email, username, password_hash)
VALUES (LOWER('patelkrina701@gmail.com'), 'krina', '<$2b$12$46JA9yUdzQ7uGEDwKZpEhet61RNMJQDPg0..f55G4s1V6ozGxFi0C>')
ON CONFLICT ON CONSTRAINT users_email_lower_uniq
DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  username      = EXCLUDED.username,
  updated_at    = now();
