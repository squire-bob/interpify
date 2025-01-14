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

// Define __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const MAX_AUDIO_DURATION = 60; // seconds
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const TEMP_DIR = path.join(__dirname, 'temp');

// Initialize OpenAI with your API key
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "https://interpify.nerdvoid.com",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  // Additional Socket.IO settings for better performance with Cloudflare
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
  upgradeTimeout: 10000,
  // Cloudflare has a 100s timeout, so keep alive interval should be less than that
  pingInterval: 20000,
  pingTimeout: 5000,
  // Cookie settings
  cookie: {
    name: 'io',
    path: '/',
    httpOnly: true,
    sameSite: 'strict'
  },
  // Security settings
  maxHttpBufferSize: 10e6, // 10MB to match MAX_FILE_SIZE
  connectTimeout: 45000,
  // Additional headers for Cloudflare
  allowEIO3: true,
  cors: {
    origin: "https://interpify.nerdvoid.com",
    methods: ["GET", "POST"],
    credentials: true,
    headers: [
      "X-Requested-With",
      "content-type",
      "CF-Connecting-IP",
      "CF-Ray",
      "CF-Visitor"
    ]
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use(limiter);

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

// Rooms
let rooms = {};

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Create room endpoint
app.post('/create-room', (req, res) => {
  // Generate a room ID that starts with a number (1-9) followed by 5 alphanumeric characters
  const firstNumber = Math.floor(Math.random() * 9) + 1; // 1-9
  const remainingChars = Math.random().toString(36).substring(2, 7); // 5 chars
  const roomId = `${firstNumber}${remainingChars}`;
  rooms[roomId] = { users: [] };
  console.log(`Room created via HTTP: ${roomId}`);
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
  en: 'alloy',    // English
  es: 'nova',     // Spanish
  fr: 'nova',     // French
  de: 'nova',     // German
  it: 'nova',     // Italian
  pt: 'nova',     // Portuguese
  ru: 'alloy',    // Russian
  ja: 'nova',     // Japanese
  ko: 'nova',     // Korean
  zh: 'nova',     // Chinese
};

// Language names for better prompts
const LANGUAGE_NAMES = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese (Mandarin)',
};

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;

  socket.on('error', (error) => {
    console.error('Socket error:', error);
    socket.emit('errorMessage', { message: 'Connection error occurred' });
  });

  socket.on('disconnect', (reason) => {
    console.log(`Client disconnected. Reason: ${reason}`);
    if (reason === 'io server disconnect') {
      socket.connect();
    }
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

  socket.on('createRoom', (callback) => {
    // Generate a room ID that starts with a number (1-9) followed by 5 alphanumeric characters
    const firstNumber = Math.floor(Math.random() * 9) + 1; // 1-9
    const remainingChars = Math.random().toString(36).substring(2, 7); // 5 chars
    const roomId = `${firstNumber}${remainingChars}`;
    rooms[roomId] = { users: [] };
    console.log(`Room created: ${roomId}`);
    callback(roomId);
  });

  socket.on('joinRoom', ({ roomId, username, language }, callback) => {
    if (rooms[roomId]) {
      if (rooms[roomId].users.length < 2) {
        const user = { 
          id: socket.id, 
          username, 
          language,
          socketId: socket.id
        };
        rooms[roomId].users.push(user);
        socket.join(roomId);
        
        // Store room ID in socket for easy reference
        socket.roomId = roomId;
        
        io.to(roomId).emit(
          'updateUserList',
          rooms[roomId].users.map((user) => user.username)
        );
        callback(true);
        console.log(
          `User ${username} joined room ${roomId} with language ${language}`
        );
      } else {
        callback(false);
        console.log(`Failed to join room ${roomId}: Room is full.`);
      }
    } else {
      callback(false);
      console.log(`Failed to join room ${roomId}: Room does not exist.`);
    }
  });

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

    if (!isSpeaking && audioData.length > 0) {
      processAudioData(roomId, socket, audioData);
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
    console.log(`Processing audio data for room ${roomId}...`);
    let tempFilePath;
    let wavFilePath;

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
      const receiver = room.users.find(user => user.socketId !== socket.id);

      if (!sender || !receiver) {
        throw new Error('Could not find sender or receiver in room. Make sure there are two users in the room.');
      }

      console.log('Translation participants:', {
        sender: {
          username: sender.username,
          language: sender.language,
          socketId: sender.socketId
        },
        receiver: {
          username: receiver.username,
          language: receiver.language,
          socketId: receiver.socketId
        }
      });

      // Transcribe audio using converted WAV file
      console.log('Starting transcription with Whisper...');
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(wavFilePath),
        model: 'whisper-1',
        language: sender.language,
        response_format: 'text',
      }).catch(error => {
        console.error('Transcription error details:', {
          error: error.message,
          status: error.status,
          type: error.type,
          code: error.code
        });
        throw new Error(`Transcription failed: ${error.message}`);
      });

      console.log('Transcription result:', {
        text: transcription,
        length: transcription?.length,
        language: sender.language
      });

      if (!transcription || !transcription.trim()) {
        throw new Error('Transcription returned empty text.');
      }

      // Translate text
      console.log(`Starting translation from ${LANGUAGE_NAMES[sender.language]} to ${LANGUAGE_NAMES[receiver.language]}`);
      
      const translationResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a professional translator specializing in ${LANGUAGE_NAMES[sender.language]} to ${LANGUAGE_NAMES[receiver.language]} translation.
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
      }).catch(error => {
        console.error('Translation error details:', {
          error: error.message,
          status: error.status,
          type: error.type,
          code: error.code
        });
        throw new Error(`Translation failed: ${error.message}`);
      });

      const translatedText = translationResponse.choices[0].message.content.trim();
      console.log('Translation result:', {
        originalText: transcription,
        translatedText,
        fromLanguage: sender.language,
        toLanguage: receiver.language
      });

      if (!translatedText) {
        throw new Error('Translation returned empty text.');
      }

      // Generate speech from translated text
      console.log('Starting speech generation:', {
        text: translatedText,
        voice: LANGUAGE_TO_VOICE[receiver.language] || 'alloy',
        language: receiver.language
      });
      
      const speechResponse = await openai.audio.speech.create({
        model: 'tts-1',
        voice: LANGUAGE_TO_VOICE[receiver.language] || 'alloy',
        input: translatedText,
        response_format: 'mp3',
        speed: 1.0,
      }).catch(error => {
        console.error('Speech generation error details:', {
          error: error.message,
          status: error.status,
          type: error.type,
          code: error.code
        });
        throw new Error(`Speech generation failed: ${error.message}`);
      });

      const audioBufferResponse = Buffer.from(
        await speechResponse.arrayBuffer()
      );

      console.log('Speech generation complete:', {
        outputSize: audioBufferResponse.length,
        timestamp: new Date().toISOString()
      });

      // Emit transcription to the entire room
      io.to(roomId).emit('transcription', {
        username: sender.username,
        message: transcription,
        isOriginal: true
      });

      // Emit translated text and audio to the receiver
      socket.to(receiver.socketId).emit('translatedAudio', {
        username: sender.username,
        text: translatedText,
        audio: audioBufferResponse.toString('base64'),
        isTranslation: true
      });

    } catch (error) {
      console.error('Audio processing error details:', {
        error: error.message,
        stack: error.stack,
        roomId,
        socketId: socket.id,
        timestamp: new Date().toISOString()
      });
      socket.emit('errorMessage', { 
        message: error.message || 'Error processing audio data'
      });
    } finally {
      // Clean up temporary files with error handling
      for (const filePath of [tempFilePath, wavFilePath]) {
        if (filePath && fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            console.log(`Cleaned up temp file: ${filePath}`);
          } catch (error) {
            console.error(`Error deleting temp file:`, {
              path: filePath,
              error: error.message
            });
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

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      leaveRoom(socket, roomId);
    }
  });

  function leaveRoom(socket, roomId) {
    if (rooms[roomId]) {
      rooms[roomId].users = rooms[roomId].users.filter(
        (user) => user.socketId !== socket.id
      );
      if (rooms[roomId].users.length === 0) {
        delete rooms[roomId];
        console.log(`Room ${roomId} deleted due to no active users.`);
      } else {
        io.to(roomId).emit(
          'updateUserList',
          rooms[roomId].users.map((user) => user.username)
        );
      }
    }
  }
});

// Initialize the server
initializeServer();