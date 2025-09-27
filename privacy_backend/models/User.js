// models/User.js
const db = require('../db');
const bcrypt = require('bcryptjs');

class User {
  static async create(userData) {
    const { username, email, password } = userData;
    
    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    const query = `
      INSERT INTO users (username, email, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, NOW(), NOW())
    `;
    
    try {
      const [result] = await db.execute(query, [username, email, hashedPassword]);
      return result.insertId;
    } catch (error) {
      throw error;
    }
  }
  
  static async findByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = ?';
    try {
      const [rows] = await db.execute(query, [email]);
      return rows[0] || null;
    } catch (error) {
      throw error;
    }
  }
  
  static async findByUsername(username) {
    const query = 'SELECT * FROM users WHERE username = ?';
    try {
      const [rows] = await db.execute(query, [username]);
      return rows[0] || null;
    } catch (error) {
      throw error;
    }
  }
  
  static async verifyPassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }
}

module.exports = User;