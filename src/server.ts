import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { initSocketServer } from './socket/socketManager.js';
import authRoutes from './routes/authRoutes.js';
import matrixRoutes from './routes/matrixRoutes.js';
import instagramRoutes from './routes/instagramRoutes.js';

// Load environment variables
dotenv.config();

// Initialize Prisma client
const prisma = new PrismaClient();

// Create Express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.io server
const io = initSocketServer(server);

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/matrix', matrixRoutes);
app.use('/api/instagram', instagramRoutes);

// Health check
app.get('/', (req, res) => {
  res.send('Matrix Integration API is running');
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Handle shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});