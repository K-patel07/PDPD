// controllers/authController.js
const User = require('../models/User');
const JWTService = require('../services/jwtService');

class AuthController {
  static async signup(req, res) {
    try {
      const { username, email, password } = req.body;
      
      // Validation
      if (!username || !email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Username, email, and password are required'
        });
      }
      
      // Check if user already exists
      const existingUserByEmail = await User.findByEmail(email);
      if (existingUserByEmail) {
        return res.status(409).json({
          success: false,
          message: 'User with this email already exists'
        });
      }
      
      const existingUserByUsername = await User.findByUsername(username);
      if (existingUserByUsername) {
        return res.status(409).json({
          success: false,
          message: 'Username already taken'
        });
      }
      
      // Create new user
      const userId = await User.create({ username, email, password });
      
      // Generate JWT token
      const token = JWTService.generateToken({
        userId: userId,
        username: username,
        email: email
      });
      
      res.status(201).json({
        success: true,
        message: 'User created successfully',
        token: token,
        user: {
          id: userId,
          username: username,
          email: email
        }
      });
      
    } catch (error) {
      console.error('Signup error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
  
  static async login(req, res) {
    try {
      const { email, password } = req.body;
      
      // Validation
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Email and password are required'
        });
      }
      
      // Find user by email
      const user = await User.findByEmail(email);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }
      
      // Verify password
      const isValidPassword = await User.verifyPassword(password, user.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }
      
      // Generate JWT token
      const token = JWTService.generateToken({
        userId: user.id,
        username: user.username,
        email: user.email
      });
      
      res.status(200).json({
        success: true,
        message: 'Login successful',
        token: token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email
        }
      });
      
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
}

module.exports = AuthController;