const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

// In-memory DB
let db;
function initDB() {
  db = new sqlite3.Database(':memory:');
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      balance REAL DEFAULT 0,
      is_active BOOLEAN DEFAULT FALSE,
      verified_email BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      method TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      tx_id TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Insert admin user
  db.run(`
    INSERT INTO users (email, username, password, balance, is_active, verified_email)
    VALUES ('admin@platform.com', 'Admin', '$2b$10$9XqoQ7r8LkM6VgZc5uPjN.zUxGdCtWvBfRJHhKlAeTmYiOqXzYpXa', 1000000, TRUE, TRUE)
    ON CONFLICT (email) DO NOTHING
  `);
}

initDB();

// Helper to hash password
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Routes
export default (req, res) => {
  if (req.method === 'POST') {
    if (req.url === '/api/register') {
      const { email, username, password } = req.body;

      if (!email || !username || !password) {
        return res.status(400).json({ error: 'All fields required' });
      }

      db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (user) return res.status(409).json({ error: 'Email already exists' });

        const hash = hashPassword(password);
        db.run('INSERT INTO users (email, username, password, balance, is_active, verified_email) VALUES (?, ?, ?, 0, FALSE, FALSE)', [email, username, hash], function(err) {
          if (err) return res.status(500).json({ error: 'Error saving user' });
          res.status(201).json({ message: 'Registration successful. Please login.' });
        });
      });
    }

    if (req.url === '/api/login') {
      const { email, password } = req.body;

      db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const validPassword = hashPassword(password) === user.password;
        if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

        const token = crypto.randomBytes(32).toString('hex');
        res.json({
          token,
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            balance: user.balance,
            isActive: user.is_active,
            verified_email: user.verified_email
          }
        });
      });
    }
  }

  if (req.method === 'GET') {
    if (req.url === '/api/user/:id') {
      const { id } = req.query;
      db.get('SELECT id, email, username, balance, is_active, verified_email FROM users WHERE id = ?', [id], (err, user) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
      });
    }

    if (req.url === '/api/transactions/:userId') {
      const { userId } = req.query;
      db.all('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC', [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows);
      });
    }

    if (req.url === '/api/messages') {
      db.all('SELECT m.id, m.message, m.created_at, u.username FROM messages m JOIN users u ON m.user_id = u.id ORDER BY m.created_at DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows);
      });
    }
  }

  if (req.method === 'POST') {
    if (req.url === '/api/deposit') {
      const { userId, method, amount } = req.body;

      if (!method || !amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid data' });
      }

      const txId = crypto.randomBytes(16).toString('hex').substring(0, 20);
      const status = ['pending', 'successful', 'failed'][Math.floor(Math.random() * 3)];
      let success = status === 'successful';

      let address = '';
      if (method === 'BTC') address = '35DrUNecGXnuhQvizUTxYD42WN9PqcHUHz';
      else if (method === 'ETH') address = '0x86a2fda85b8978cd747c28ba7f5bdb5e855c7db0';
      else if (method === 'USDT') address = 'TZ3jxLmbSEDKHLcEgw5uwM9kqUiSHj9njD';

      db.run('INSERT INTO transactions (user_id, type, method, amount, status, tx_id, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)', [userId, 'deposit', method, amount, status, txId], function(err) {
        if (err) return res.status(500).json({ error: 'Error saving transaction' });

        if (success) {
          db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, userId]);
        }

        if (address) {
          res.json({
            message: `Send $${amount} to this address: ${address}\nTX ID: ${txId}`,
            address,
            txId
          });
        } else {
          res.json({ message: `Deposit of $${amount} via ${method} is being reviewed.` });
        }
      });
    }

    if (req.url === '/api/approve-deposit') {
      const { txId } = req.body;
      db.run('UPDATE transactions SET status = "successful" WHERE tx_id = ?', [txId], function(err) {
        if (err) return res.status(500).json({ error: 'Error approving deposit' });
        res.json({ message: 'Deposit approved!' });
      });
    }

    if (req.url === '/api/freeze-account') {
      const { userId } = req.body;
      db.run('UPDATE users SET is_active = FALSE WHERE id = ?', [userId], function(err) {
        if (err) return res.status(500).json({ error: 'Error freezing account' });
        res.json({ message: 'Account frozen.' });
      });
    }

    if (req.url === '/api/unfreeze-account') {
      const { userId } = req.body;
      db.run('UPDATE users SET is_active = TRUE WHERE id = ?', [userId], function(err) {
        if (err) return res.status(500).json({ error: 'Error unfreezing account' });
        res.json({ message: 'Account unfrozen.' });
      });
    }

    if (req.url === '/api/send-message') {
      const { userId, message } = req.body;
      db.run('INSERT INTO messages (user_id, message) VALUES (?, ?)', [userId, message], function(err) {
        if (err) return res.status(500).json({ error: 'Error saving message' });
        res.json({ message: 'Message sent successfully.' });
      });
    }
  }

  res.status(404).json({ error: 'Route not found' });
};
