import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { registerMatrixUser, loginMatrixUser } from '../services/matrixService.js';

const prisma = new PrismaClient();

// Generate JWT token
const generateToken = (id: number) => {
  return jwt.sign({ id }, process.env.JWT_SECRET!, {
    expiresIn: '30d'
  });
};

// Register a user
export const registerUser = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    
    // Check if user exists in our database
    const userExists = await prisma.user.findUnique({
      where: { username }
    });
    
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }
    
    // Register with Matrix
    const matrixRegistration = await registerMatrixUser(username, password);
    
    // Hash password for our own storage
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create user in our database
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        matrixUserId: matrixRegistration.userId,
        matrixAccessToken: matrixRegistration.accessToken,
        matrixDeviceId: matrixRegistration.deviceId,
        settings: {
          create: {} // Create default settings
        }
      }
    });
    
    // Create a session
    const token = generateToken(user.id);
    
    // Store session in database
    await prisma.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      }
    });
    
    res.status(201).json({
      id: user.id,
      username: user.username,
      matrixUserId: user.matrixUserId,
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      message: error instanceof Error ? error.message : 'Registration failed' 
    });
  }
};

// Login user
export const loginUser = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    
    // Find user in our database
    const user = await prisma.user.findUnique({
      where: { username }
    });
    
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    // Check password
    const passwordMatch = await bcrypt.compare(password, user.password);
    
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    // Login to Matrix to get a fresh token
    const matrixLogin = await loginMatrixUser(username, password);
    
    // Update the access token in our database
    await prisma.user.update({
      where: { id: user.id },
      data: {
        matrixAccessToken: matrixLogin.accessToken,
        matrixDeviceId: matrixLogin.deviceId
      }
    });
    
    // Generate and store a new session token
    const token = generateToken(user.id);
    
    await prisma.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      }
    });
    
    res.json({
      id: user.id,
      username: user.username,
      matrixUserId: user.matrixUserId,
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      message: error instanceof Error ? error.message : 'Login failed' 
    });
  }
};

// Logout user
export const logoutUser = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const token = req.headers.authorization?.split(' ')[1];
    
    if (token) {
      // Delete this session
      await prisma.session.deleteMany({
        where: {
          userId,
          token
        }
      });
    }
    
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: 'Logout failed' });
  }
};