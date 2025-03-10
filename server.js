/*
    Interpify - Real-time voice translation platform
    Copyright (C) 2024  Joshua Covelli (absolem)

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

// server.js

import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import ffmpeg from 'fluent-ffmpeg';
import rateLimit from 'express-rate-limit';
import { cleanupOldFiles } from './cleanup-temp.js';
import { exec } from 'child_process';
import crypto from 'crypto';
import cors from 'cors';

// Define __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const MAX_AUDIO_DURATION = 60; // seconds
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const TEMP_DIR = path.join(__dirname, 'temp');

// Interpify app verification
const APP_SECRET = process.env.APP_SECRET;
const MOBILE_INITIAL_KEY = process.env.MOBILE_INITIAL_KEY;
const verifiedOrigins = new Set(process.env.ALLOWED_ORIGINS.split(','));
const usedNonces = new Map();

// Nonce cleanup for mobile verification
setInterval(() => {
  const now = Date.now();
  for (const [nonce, timestamp] of usedNonces.entries()) {
    if (now - timestamp > 24 * 60 * 60 * 1000) usedNonces.delete(nonce);
  }
}, 60 * 60 * 1000);

// Function to verify Interpify client signature
const verifyInterpifyClient = (timestamp, signature, origin) => {
  const maxAge = 5 * 60 * 1000; // 5 minutes
  const now = Date.now();
  
  // Check if timestamp is within acceptable range
  if (now - parseInt(timestamp) > maxAge) {
    return false;
  }
  
  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', APP_SECRET)
    .update(`${timestamp}:${origin}`)
    .digest('hex');
    
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
};

// Initialize OpenAI with your API key
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();
const server = http.createServer(app);

// Combined CORS configuration for both web and mobile clients
const corsConfig = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, etc)
    if (!origin) {
      callback(null, true);
      return;
    }
    
    // Check if the origin is in our allowed list
    if (verifiedOrigins.has(origin)) {
      callback(null, true);
    } else {
      console.log(`CORS blocked origin: ${origin}, Allowed origins: ${Array.from(verifiedOrigins).join(', ')}`);
      callback(new Error('Origin not allowed by CORS'));
    }
  },
  methods: ["GET", "POST"],
  credentials: true,
  allowedHeaders: [
    "X-Requested-With",
    "content-type",
    "CF-Connecting-IP",
    "CF-Ray",
    "CF-Visitor",
    "X-Interpify-Timestamp",
    "X-Interpify-Signature",
    "X-Interpify-Device-Id",
    "X-Interpify-Nonce",
    "X-Interpify-Bundle-Id"
  ]
};

// Socket.IO configuration with all settings preserved
const io = new Server(server, {
  cors: corsConfig,
  // Socket.IO settings for better stability
  pingTimeout: 45000,         // Increased from 30000 to 45000
  pingInterval: 20000,         // Decreased from 25000 to 20000 for more frequent pings
  reconnection: true,
  reconnectionAttempts: 15,    // Increased from 10 to 15
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,  // Maximum reconnection delay
  // Additional Socket.IO settings for better performance with Cloudflare
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
  upgradeTimeout: 15000,       // Increased from 10000 to 15000
  // Cookie settings
  cookie: {
    name: 'io',
    path: '/',
    httpOnly: true,
    sameSite: 'lax'            // 'lax' for better cross-site behavior
  },
  // Security settings
  maxHttpBufferSize: 10e6,     // 10MB to match MAX_FILE_SIZE
  connectTimeout: 60000,       // Increased from 45000 to 60000
  // Additional compatibility
  allowEIO3: true,
  // Additional stability settings
  perMessageDeflate: {
    threshold: 1024            // Only compress messages larger than 1KB
  }
});

app.use(express.json());
app.use(cors(corsConfig));

// Serve static files
app.use(express.static(path.join(__dirname)));

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

// Apply rate limiting to API routes only, not static files
app.use('/verify-origin', limiter);
app.use('/create-room', limiter);

// Add mobile verification endpoint before socket.io setup
app.post('/verify-origin', (req, res) => {
  // Handle mobile app verification
  if (req.body.clientType === 'mobile-app' && MOBILE_INITIAL_KEY) {
    const challenge = req.body;
    
    // Check nonce
    if (usedNonces.has(challenge.nonce)) {
      return res.status(403).json({ error: 'Nonce already used' });
    }

    // Verify client
    const expectedHash = crypto.createHash('sha256')
      .update(`${challenge.deviceId}:${challenge.timestamp}:${challenge.nonce}:${challenge.bundleId}:${MOBILE_INITIAL_KEY}`)
      .digest('hex');

    if (challenge.verificationHash !== expectedHash) {
      return res.status(403).json({ error: 'Invalid verification' });
    }

    // Store nonce
    usedNonces.set(challenge.nonce, Date.now());

    // Generate app key
    const serverChallenge = crypto.randomBytes(32).toString('hex');
    const serverVerification = crypto.createHash('sha256')
      .update(`${serverChallenge}:${challenge.verificationHash}`)
      .digest('hex');
    const appKey = crypto.createHash('sha256')
      .update(APP_SECRET)
      .digest('hex')
      .substring(0, 32);

    return res.json({
      success: true,
      appKey,
      serverChallenge,
      serverVerification
    });
  }

  // Handle web client verification (existing logic)
  const timestamp = req.headers['x-interpify-timestamp'];
  const signature = req.headers['x-interpify-signature'];
  const origin = req.headers.origin;

  if (!timestamp || !signature || !origin) {
    return res.status(400).json({ error: 'Missing required headers' });
  }

  try {
    if (verifyInterpifyClient(timestamp, signature, origin)) {
      verifiedOrigins.add(origin);
      res.json({ success: true, message: 'Origin verified and added' });
    } else {
      res.status(403).json({ error: 'Invalid signature' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Check ffmpeg installation
function checkFfmpeg() {
  return new Promise((resolve, reject) => {
    exec('which ffmpeg', (error, stdout, stderr) => {
      if (error) {
        console.error('FFmpeg is not installed. Please install it using: sudo apt-get install ffmpeg');
        reject(new Error('FFmpeg not found'));
      } else {
        console.log('FFmpeg is installed at:', stdout.trim());
        resolve(true);
      }
    });
  });
}

// Initialize server
async function initializeServer() {
  try {
    // Check required environment variables
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    if (!process.env.APP_SECRET) {
      throw new Error('APP_SECRET environment variable is required');
    }
    if (!process.env.ALLOWED_ORIGINS) {
      throw new Error('ALLOWED_ORIGINS environment variable is required');
    }

    // Check ffmpeg installation
    await checkFfmpeg();

    // Ensure temp directory exists
    if (!fs.existsSync(TEMP_DIR)) {
      try {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
      } catch (error) {
        console.log('Could not create temp directory, it may already exist:', error.message);
      }
    }

    // Start server
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Server initialization failed:', error);
    process.exit(1);
  }
}

// At the top level of the file
let rooms = {};
let roomLanguageGroups = {};

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Create room endpoint
app.post('/create-room', (req, res) => {
  // Generate a room ID that starts with a number (1-9) followed by 5 alphanumeric characters
  let roomId;
  let attempts = 0;
  const maxAttempts = 5;
  
  // Ensure the room ID is unique
  do {
    const firstNumber = Math.floor(Math.random() * 9) + 1; // 1-9
    const remainingChars = Math.random().toString(36).substring(2, 7); // 5 chars
    roomId = `${firstNumber}${remainingChars}`;
    attempts++;
  } while (rooms[roomId] && attempts < maxAttempts);
  
  if (attempts >= maxAttempts && rooms[roomId]) {
    console.error('Failed to create a unique room ID after multiple attempts');
    return res.status(500).json({ error: 'Failed to create a unique room' });
  }
  
  rooms[roomId] = { users: [] };
  console.log(`Room created via API: ${roomId}, Total rooms: ${Object.keys(rooms).length}`);
  res.json({ roomId });
});

// Audio validation middleware
const validateAudio = (buffer) => {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error('Audio file too large');
  }
  return true;
};

// Language to voice mapping for better TTS results
const LANGUAGE_TO_VOICE = {
  af: 'alloy',    // Afrikaans
  sq: 'alloy',    // Albanian
  am: 'alloy',    // Amharic
  ar: 'nova',     // Arabic
  hy: 'alloy',    // Armenian
  az: 'alloy',    // Azerbaijani
  eu: 'alloy',    // Basque
  be: 'alloy',    // Belarusian
  bn: 'nova',     // Bengali
  bs: 'alloy',    // Bosnian
  bg: 'alloy',    // Bulgarian
  ca: 'nova',     // Catalan
  'zh-CN': 'nova', // Chinese Simplified
  'zh-TW': 'nova', // Chinese Traditional
  hr: 'alloy',    // Croatian
  cs: 'alloy',    // Czech
  da: 'nova',     // Danish
  nl: 'nova',     // Dutch
  en: 'alloy',    // English
  et: 'alloy',    // Estonian
  fi: 'nova',     // Finnish
  fr: 'nova',     // French
  ka: 'alloy',    // Georgian
  de: 'nova',     // German
  el: 'nova',     // Greek
  gu: 'alloy',    // Gujarati
  ht: 'alloy',    // Haitian Creole
  he: 'nova',     // Hebrew
  hi: 'nova',     // Hindi
  hu: 'alloy',    // Hungarian
  is: 'alloy',    // Icelandic
  ig: 'alloy',    // Igbo
  id: 'nova',     // Indonesian
  ga: 'alloy',    // Irish
  it: 'nova',     // Italian
  ja: 'nova',     // Japanese
  jv: 'alloy',    // Javanese
  kk: 'alloy',    // Kazakh
  km: 'alloy',    // Khmer
  ko: 'nova',     // Korean
  ku: 'alloy',    // Kurdish
  lv: 'alloy',    // Latvian
  lt: 'alloy',    // Lithuanian
  mk: 'alloy',    // Macedonian
  ms: 'nova',     // Malay
  mt: 'alloy',    // Maltese
  mr: 'nova',     // Marathi
  mn: 'alloy',    // Mongolian
  ne: 'alloy',    // Nepali
  no: 'nova',     // Norwegian
  fa: 'nova',     // Persian
  pl: 'nova',     // Polish
  pt: 'nova',     // Portuguese
  pa: 'nova',     // Punjabi
  ro: 'nova',     // Romanian
  ru: 'alloy',    // Russian
  sr: 'alloy',    // Serbian
  si: 'alloy',    // Sinhala
  sk: 'alloy',    // Slovak
  sl: 'alloy',    // Slovenian
  so: 'alloy',    // Somali
  es: 'nova',     // Spanish
  sw: 'alloy',    // Swahili
  sv: 'nova',     // Swedish
  ta: 'nova',     // Tamil
  te: 'nova',     // Telugu
  th: 'nova',     // Thai
  tr: 'nova',     // Turkish
  uk: 'nova',     // Ukrainian
  ur: 'nova',     // Urdu
  uz: 'alloy',    // Uzbek
  vi: 'nova',     // Vietnamese
  cy: 'alloy',    // Welsh
  xh: 'alloy',    // Xhosa
  yo: 'alloy',    // Yoruba
  zu: 'alloy',    // Zulu
};

// Language names for better prompts
const LANGUAGE_NAMES = {
  af: 'Afrikaans',
  sq: 'Albanian',
  am: 'Amharic',
  ar: 'Arabic',
  hy: 'Armenian',
  az: 'Azerbaijani',
  eu: 'Basque',
  be: 'Belarusian',
  bn: 'Bengali',
  bs: 'Bosnian',
  bg: 'Bulgarian',
  ca: 'Catalan',
  'zh-CN': 'Chinese Simplified',
  'zh-TW': 'Chinese Traditional',
  hr: 'Croatian',
  cs: 'Czech',
  da: 'Danish',
  nl: 'Dutch',
  en: 'English',
  et: 'Estonian',
  fi: 'Finnish',
  fr: 'French',
  ka: 'Georgian',
  de: 'German',
  el: 'Greek',
  gu: 'Gujarati',
  ht: 'Haitian Creole',
  he: 'Hebrew',
  hi: 'Hindi',
  hu: 'Hungarian',
  is: 'Icelandic',
  ig: 'Igbo',
  id: 'Indonesian',
  ga: 'Irish',
  it: 'Italian',
  ja: 'Japanese',
  jv: 'Javanese',
  kk: 'Kazakh',
  km: 'Khmer',
  ko: 'Korean',
  ku: 'Kurdish',
  lv: 'Latvian',
  lt: 'Lithuanian',
  mk: 'Macedonian',
  ms: 'Malay',
  mt: 'Maltese',
  mr: 'Marathi',
  mn: 'Mongolian',
  ne: 'Nepali',
  no: 'Norwegian',
  fa: 'Persian',
  pl: 'Polish',
  pt: 'Portuguese',
  pa: 'Punjabi',
  ro: 'Romanian',
  ru: 'Russian',
  sr: 'Serbian',
  si: 'Sinhala',
  sk: 'Slovak',
  sl: 'Slovenian',
  so: 'Somali',
  es: 'Spanish',
  sw: 'Swahili',
  sv: 'Swedish',
  ta: 'Tamil',
  te: 'Telugu',
  th: 'Thai',
  tr: 'Turkish',
  uk: 'Ukrainian',
  ur: 'Urdu',
  uz: 'Uzbek',
  vi: 'Vietnamese',
  cy: 'Welsh',
  xh: 'Xhosa',
  yo: 'Yoruba',
  zu: 'Zulu'
};

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;

  socket.on('error', (error) => {
    console.error('Socket error:', error);
    socket.emit('errorMessage', { message: 'Connection error occurred' });
  });

  socket.on('reconnect_attempt', () => {
    reconnectAttempts++;
    if (reconnectAttempts > maxReconnectAttempts) {
      socket.emit('errorMessage', { 
        message: 'Maximum reconnection attempts reached. Please refresh the page.' 
      });
    }
  });

  socket.on('reconnect', () => {
    reconnectAttempts = 0;
    socket.emit('status', { message: 'Reconnected successfully' });
  });

  // Handle disconnection with both reconnection and room cleanup
  socket.on('disconnect', (reason) => {
    console.log(`Client disconnected. Reason: ${reason}, Socket ID: ${socket.id}`);
    
    // Handle server-initiated disconnects
    if (reason === 'io server disconnect') {
      socket.connect();
    }
    
    // Clean up rooms when client disconnects
    // Make a copy of the room keys to avoid modification during iteration
    const roomKeys = Object.keys(rooms);
    for (const roomId of roomKeys) {
      if (rooms[roomId] && rooms[roomId].users.some(user => user.socketId === socket.id)) {
        console.log(`Cleaning up user ${socket.id} from room ${roomId}`);
        leaveRoom(socket, roomId);
      }
    }
  });

  socket.on('createRoom', (callback) => {
    // Generate a room ID that starts with a number (1-9) followed by 5 alphanumeric characters
    let roomId;
    let attempts = 0;
    const maxAttempts = 5;
    
    // Ensure the room ID is unique
    do {
      const firstNumber = Math.floor(Math.random() * 9) + 1; // 1-9
      const remainingChars = Math.random().toString(36).substring(2, 7); // 5 chars
      roomId = `${firstNumber}${remainingChars}`;
      attempts++;
    } while (rooms[roomId] && attempts < maxAttempts);
    
    if (attempts >= maxAttempts && rooms[roomId]) {
      console.error('Failed to create a unique room ID after multiple attempts');
      callback(null);
      return;
    }
    
    rooms[roomId] = { users: [] };
    console.log(`Room created: ${roomId}, Total rooms: ${Object.keys(rooms).length}`);
    callback(roomId);
  });

  socket.on('joinRoom', ({ roomId, username, language }, callback) => {
    console.log(`Join room attempt: ${roomId}, Available rooms: ${Object.keys(rooms).join(', ')}`);
    if (rooms[roomId]) {
      // Check if user with this socket ID already exists in the room
      const existingUserIndex = rooms[roomId].users.findIndex(u => u.socketId === socket.id);
      
      if (existingUserIndex !== -1) {
        // User already exists in the room, update their info
        console.log(`User with socket ID ${socket.id} already exists in room ${roomId}, updating info`);
        
        // Get the existing user to check if language changed
        const existingUser = rooms[roomId].users[existingUserIndex];
        const oldLanguage = existingUser.language;
        
        // Update user info
        rooms[roomId].users[existingUserIndex] = { 
          id: socket.id, 
          username, 
          language,
          socketId: socket.id
        };
        
        // If language changed, update language groups
        if (oldLanguage !== language && roomLanguageGroups[roomId]) {
          // Remove from old language group
          const oldLangGroup = roomLanguageGroups[roomId].get(oldLanguage);
          if (oldLangGroup) {
            const index = oldLangGroup.findIndex(u => u.socketId === socket.id);
            if (index !== -1) {
              oldLangGroup.splice(index, 1);
            }
            if (oldLangGroup.length === 0) {
              roomLanguageGroups[roomId].delete(oldLanguage);
            }
          }
          
          // Add to new language group
          const newLangGroup = roomLanguageGroups[roomId].get(language) || [];
          newLangGroup.push(rooms[roomId].users[existingUserIndex]);
          roomLanguageGroups[roomId].set(language, newLangGroup);
        }
      } else {
        // New user, add to room
        const user = { 
          id: socket.id, 
          username, 
          language,
          socketId: socket.id
        };
        
        // Add user to room
        rooms[roomId].users.push(user);
        
        // Update language groups for the room
        if (!roomLanguageGroups[roomId]) {
          roomLanguageGroups[roomId] = new Map();
        }
        
        // Add user to their language group
        const langGroup = roomLanguageGroups[roomId].get(language) || [];
        langGroup.push(user);
        roomLanguageGroups[roomId].set(language, langGroup);
      }
      
      // Join the socket to the room
      socket.join(roomId);
      
      // Store room ID in socket for easy reference
      socket.roomId = roomId;
      
      // Update user list for all clients in the room
      io.to(roomId).emit(
        'updateUserList',
        rooms[roomId].users.map((user) => ({
          username: user.username,
          language: user.language
        }))
      );
      
      callback(true);
      console.log(
        `User ${username} joined room ${roomId} with language ${language}`
      );
    } else {
      console.log(`Failed to join room ${roomId}: Room not found. Available rooms: ${Object.keys(rooms).join(', ')}`);
      callback(false);
      socket.emit('errorMessage', { message: 'Room not found or invalid. Please check the room ID and try again.' });
    }
  });

  // Simplify the updateRecordingStatus handler
  socket.on('updateRecordingStatus', ({ roomId, username, isRecording }) => {
    if (rooms[roomId]) {
      io.to(roomId).emit('recordingStatusUpdate', { username, isRecording });
    }
  });

  // Clean up the audioData handler
  socket.on('audioData', ({ roomId, audioData, isSpeaking }) => {
    console.log(
      `Received audioData from ${socket.id} in room ${roomId}:`,
      {
        isSpeaking,
        dataLength: audioData.length,
        sampleStart: audioData.substring(0, 50) + '...',
        timestamp: new Date().toISOString()
      }
    );

    // Verify room exists and socket is in the room
    if (!rooms[roomId]) {
      console.error(`Room ${roomId} not found`);
      socket.emit('errorMessage', { message: 'Room not found' });
      return;
    }

    const room = rooms[roomId];
    if (!room.users.some(user => user.socketId === socket.id)) {
      console.error(`Socket ${socket.id} not found in room ${roomId}`);
      socket.emit('errorMessage', { message: 'Not a member of this room' });
      return;
    }

    const sender = room.users.find(user => user.socketId === socket.id);
    if (sender) {
      io.to(roomId).emit('processingStatusUpdate', { username: sender.username });
    }

    if (!isSpeaking && audioData.length > 0) {
      processAudioData(roomId, socket, audioData);
    }
  });

  // Add heartbeat handler to respond to client pings
  socket.on('heartbeat', (clientTime, callback) => {
    // Log heartbeats at debug level
    if (process.env.NODE_ENV === 'development') {
      console.log(`Heartbeat received from ${socket.id}, client time: ${clientTime}`);
    }
    
    // Check if the socket is still in a room
    const socketRooms = Array.from(socket.rooms).filter(room => room !== socket.id);
    const isInRoom = socketRooms.length > 0;
    
    // Respond with the client's timestamp and server status to calculate round-trip time
    if (typeof callback === 'function') {
      callback(clientTime, { 
        serverTime: Date.now(),
        isInRoom,
        rooms: socketRooms
      });
    }
  });

  // Helper function to convert audio to WAV format
  async function convertToWav(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      console.log('Converting audio to WAV format:', {
        input: inputPath,
        output: outputPath
      });

      ffmpeg(inputPath)
        .toFormat('wav')
        .audioFrequency(16000) // Whisper expects 16kHz
        .audioChannels(1)      // Mono audio
        .on('error', (err) => {
          console.error('FFmpeg conversion error:', err);
          reject(err);
        })
        .on('end', () => {
          console.log('Audio conversion completed successfully');
          resolve();
        })
        .save(outputPath);
    });
  }

  async function processAudioData(roomId, socket, base64AudioData) {
    let tempFilePath = null;
    let wavFilePath = null;

    try {
      console.log('Decoding base64 audio data:', {
        inputLength: base64AudioData.length,
        sampleStart: base64AudioData.substring(0, 50) + '...'
      });

      const audioBuffer = Buffer.from(base64AudioData, 'base64');
      
      console.log('Audio buffer details:', {
        size: audioBuffer.length,
        type: typeof base64AudioData,
        timestamp: new Date().toISOString()
      });
      
      validateAudio(audioBuffer);

      // Create unique filenames with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileId = uuidv4();
      tempFilePath = path.join(TEMP_DIR, `temp_${timestamp}_${fileId}.mp4`);
      wavFilePath = path.join(TEMP_DIR, `temp_${timestamp}_${fileId}.wav`);
      
      // Write original audio file
      fs.writeFileSync(tempFilePath, audioBuffer, { mode: 0o644 });
      
      // Log original file details
      const fileStats = fs.statSync(tempFilePath);
      console.log('Original audio file details:', {
        path: tempFilePath,
        size: fileStats.size,
        created: fileStats.birthtime,
        mode: fileStats.mode.toString(8)
      });

      // Convert to WAV format
      await convertToWav(tempFilePath, wavFilePath);
      
      // Log converted file details
      const wavStats = fs.statSync(wavFilePath);
      console.log('Converted WAV file details:', {
        path: wavFilePath,
        size: wavStats.size,
        created: wavStats.birthtime,
        mode: wavStats.mode.toString(8)
      });
      
      // Check audio duration using ffmpeg
      const duration = await getAudioDuration(wavFilePath);
      console.log('Audio duration details:', {
        duration,
        path: wavFilePath,
        timestamp: new Date().toISOString()
      });
      
      if (duration > MAX_AUDIO_DURATION) {
        throw new Error('Audio duration exceeds maximum limit');
      }

      const room = rooms[roomId];
      if (!room) {
        throw new Error('Room not found');
      }

      const sender = room.users.find(user => user.socketId === socket.id);
      if (!sender) {
        throw new Error('Sender not found in room');
      }

      // Get transcription first
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(wavFilePath),
        model: 'whisper-1',
        language: sender.language,
        response_format: 'text',
      });

      if (!transcription || !transcription.trim()) {
        throw new Error('Transcription returned empty text.');
      }

      // Send original transcription back to the speaker
      socket.emit('translatedAudio', {
        username: sender.username,
        text: transcription,
        audio: null, // No need to send audio back to the speaker
        language: sender.language,
        isTranslation: false
      });

      // Get all unique languages in the room except sender's
      const targetLanguages = new Set();
      const sameLanguageUsers = [];
      
      room.users.forEach(user => {
        if (user.socketId !== socket.id) {
          if (user.language === sender.language) {
            sameLanguageUsers.push(user);
          } else {
            targetLanguages.add(user.language);
          }
        }
      });

      // Send original text and audio to users with the same language
      if (sameLanguageUsers.length > 0) {
        const speechResponse = await openai.audio.speech.create({
          model: 'tts-1',
          voice: LANGUAGE_TO_VOICE[sender.language] || 'alloy',
          input: transcription,
          response_format: 'mp3',
          speed: 1.0,
        });

        const audioBufferResponse = Buffer.from(
          await speechResponse.arrayBuffer()
        );

        // Send audio to all users with the same language
        sameLanguageUsers.forEach(user => {
          socket.to(user.socketId).emit('translatedAudio', {
            username: sender.username,
            text: transcription,
            audio: audioBufferResponse.toString('base64'),
            language: sender.language,
            isTranslation: false
          });
        });
      }

      // Translate and generate speech for each target language
      for (const targetLang of targetLanguages) {
        // Get translation for this language
        const translationResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are a professional translator specializing in ${LANGUAGE_NAMES[sender.language]} to ${LANGUAGE_NAMES[targetLang]} translation.
Your task is to translate the following text naturally and idiomatically, preserving the original meaning and tone.
For informal speech, maintain a conversational style. For formal content, maintain appropriate formality.
Provide ONLY the translation without any explanations or notes.`,
            },
            {
              role: 'user',
              content: transcription,
            },
          ],
          temperature: 0.3,
        });

        const translatedText = translationResponse.choices[0].message.content.trim();
        
        // Generate speech for this translation
        const speechResponse = await openai.audio.speech.create({
          model: 'tts-1',
          voice: LANGUAGE_TO_VOICE[targetLang] || 'alloy',
          input: translatedText,
          response_format: 'mp3',
          speed: 1.0,
        });

        const audioBufferResponse = Buffer.from(
          await speechResponse.arrayBuffer()
        );

        // Get all users who need this language
        const targetUsers = room.users.filter(
          user => user.language === targetLang && user.socketId !== sender.socketId
        );

        // Emit translated text and audio to all users of this language
        targetUsers.forEach(user => {
          socket.to(user.socketId).emit('translatedAudio', {
            username: sender.username,
            text: translatedText,
            audio: audioBufferResponse.toString('base64'),
            language: targetLang,
            isTranslation: true
          });
        });
      }

    } catch (error) {
      const sender = rooms[roomId]?.users.find(user => user.socketId === socket.id);
      socket.emit('errorMessage', { 
        message: error.message || 'Error processing audio data',
        username: sender?.username
      });
    } finally {
      // Clean up temporary files with error handling
      for (const filePath of [tempFilePath, wavFilePath]) {
        if (filePath && fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (error) {
            console.error(`Error deleting temp file: ${filePath}`);
          }
        }
      }
    }
  }

  // Helper function to get audio duration
  function getAudioDuration(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) reject(err);
        else resolve(metadata.format.duration);
      });
    });
  }

  function leaveRoom(socket, roomId) {
    if (!rooms[roomId]) {
      return; // Room doesn't exist, nothing to do
    }
    
    const user = rooms[roomId].users.find(u => u.socketId === socket.id);
    if (!user) {
      return; // User not in this room, nothing to do
    }
    
    // Remove user from language groups
    if (roomLanguageGroups[roomId]) {
      const langGroup = roomLanguageGroups[roomId].get(user.language);
      if (langGroup) {
        const index = langGroup.findIndex(u => u.socketId === socket.id);
        if (index !== -1) {
          langGroup.splice(index, 1);
        }
        if (langGroup.length === 0) {
          roomLanguageGroups[roomId].delete(user.language);
        }
      }
    }

    // Remove user from room
    rooms[roomId].users = rooms[roomId].users.filter(
      (u) => u.socketId !== socket.id
    );

    // If room is empty, delete it immediately
    if (rooms[roomId].users.length === 0) {
      delete rooms[roomId];
      delete roomLanguageGroups[roomId];
      console.log(`Room ${roomId} deleted due to no active users.`);
    } else {
      // Otherwise, update the user list for remaining users
      io.to(roomId).emit(
        'updateUserList',
        rooms[roomId].users.map((u) => ({
          username: u.username,
          language: u.language
        }))
      );
    }
  }
});

// Initialize the server
initializeServer();