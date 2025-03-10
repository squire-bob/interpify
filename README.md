# Interpify

A real-time translation platform that enables seamless communication across language barriers. Interpify uses advanced AI technology to provide instant translation and voice conversion, allowing people speaking different languages to communicate naturally.

## Features

- Real-time voice translation between multiple languages
- Push-to-talk functionality with space bar support
- Dark/Light theme support (resets on page refresh)
- Mobile-friendly interface with responsive design
- Support for 75 languages including all major world languages
- Instant audio playback of translations
- Chat-like interface showing transcriptions and translations
- Multi-user rooms with unlimited participants
- Visual indicators for recording and processing status
- Same-language users hear original audio
- Speakers see their own transcriptions immediately
- Official mobile app support with secure verification
- Cross-platform compatibility between web and mobile clients
- Automatic room cleanup and data privacy
- Rate limiting for API protection
- Cloudflare-compatible WebSocket configuration
- Automatic temporary file cleanup

## Supported Languages

Interpify supports 75 languages:

- Afrikaans
- Albanian
- Amharic
- Arabic
- Armenian
- Azerbaijani
- Basque
- Belarusian
- Bengali
- Bosnian
- Bulgarian
- Catalan
- Chinese (Simplified)
- Chinese (Traditional)
- Croatian
- Czech
- Danish
- Dutch
- English
- Estonian
- Finnish
- French
- Georgian
- German
- Greek
- Gujarati
- Haitian Creole
- Hebrew
- Hindi
- Hungarian
- Icelandic
- Igbo
- Indonesian
- Irish
- Italian
- Japanese
- Javanese
- Kazakh
- Khmer
- Korean
- Kurdish
- Latvian
- Lithuanian
- Macedonian
- Malay
- Maltese
- Marathi
- Mongolian
- Nepali
- Norwegian
- Persian
- Polish
- Portuguese
- Punjabi
- Romanian
- Russian
- Serbian
- Sinhala
- Slovak
- Slovenian
- Somali
- Spanish
- Swahili
- Swedish
- Tamil
- Telugu
- Thai
- Turkish
- Ukrainian
- Urdu
- Uzbek
- Vietnamese
- Welsh
- Xhosa
- Yoruba
- Zulu

## Privacy & Security

Interpify is designed with privacy in mind, implementing several features to protect user data:

- **Disposable Rooms**: All chat rooms are temporary and automatically disposed of when users leave. No conversation history is stored on the server.
- **Automatic Data Cleanup**: 
  - Audio files are immediately deleted after processing
  - Temporary files are automatically cleaned up
  - No conversation logs or transcripts are retained
  - Room data is cleared from memory when sessions end
  - No user preferences are stored between sessions
- **Local Processing**: All audio processing happens in real-time and is never stored permanently
- **Maximum Duration**: Audio clips are limited to 60 seconds for security
- **File Size Limits**: A 10MB file size limit is enforced to prevent abuse

These features ensure that your conversations remain private and temporary, with no data persistence beyond the active session.

## Technologies Used

- **Backend Framework**: Node.js with Express
- **Real-time Communication**: Socket.IO with WebSocket support
- **Speech Processing**:
  - OpenAI's Whisper for speech-to-text
  - OpenAI's GPT-4o-mini for translation
  - OpenAI's TTS for text-to-speech
- **Audio Processing**:
  - WebRTC for audio capture
  - FFmpeg for audio conversion
  - Voice activity detection
- **Security**:
  - CORS protection
  - Rate limiting
  - Time-based signature verification
  - Secure WebSocket configuration
- **Development Tools**:
  - ES Modules
  - Nodemon for development
  - Environment variable management

## Hosting Your Own Server

### Requirements

- Node.js (v16 or higher)
- npm (v8 or higher)
- FFmpeg installed on your system
  - Ubuntu/Debian: `sudo apt-get install ffmpeg`
  - macOS: `brew install ffmpeg`
  - Windows: Download from [FFmpeg website](https://ffmpeg.org/download.html)
- OpenAI API key with access to:
  - Whisper API
  - GPT-4o-mini API
  - TTS API
- A domain with HTTPS support (recommended for production)
- Sufficient storage for temporary audio processing
- Adequate bandwidth for real-time audio streaming

### Installation Steps

1. Clone the repository:
```bash
git clone https://github.com/yourusername/interpify.git
cd interpify
```

2. Install dependencies:
```bash
npm install
```

3. Copy the example environment file:
```bash
cp .env.example .env
```

4. Configure your environment:
   - Required variables:
     ```bash
     # OpenAI API key with necessary permissions
     OPENAI_API_KEY=your_api_key_here
     
     # Generate a unique APP_SECRET for mobile app support
     # Use this command:
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     APP_SECRET=your_generated_secret_here
     
     # Configure allowed origins (your domain)
     ALLOWED_ORIGINS=https://your-domain.com
     ```
   - Optional variables:
     ```bash
     PORT=3000
     NODE_ENV=production
     ```

5. Create and secure the temp directory:
```bash
mkdir temp
chmod 750 temp
```

6. Start the server:
   - For production:
     ```bash
     npm start
     ```
   - For development:
     ```bash
     npm run dev
     ```
   - To manually clean temporary files:
     ```bash
     npm run cleanup
     ```

### Security Considerations

1. **Environment Variables**
   - Never commit your `.env` file
   - Keep your OpenAI API key secure
   - Generate a unique APP_SECRET for each server instance
   - Rotate your APP_SECRET periodically (recommended every 90 days)

2. **CORS Configuration**
   - Configure ALLOWED_ORIGINS with your domain
   - For multiple domains, use comma-separated values
   - Always use full URLs including protocol (http:// or https://)
   - Development domains (localhost) must be explicitly allowed

3. **Mobile App Support**
   - The APP_SECRET is used to verify mobile app connections
   - Each server instance should have a unique APP_SECRET
   - Mobile apps must provide valid signatures to connect
   - Time-based verification prevents replay attacks
   - Signatures expire after 5 minutes

4. **Data Privacy**
   - Audio files are processed in memory and immediately deleted
   - No conversation data is stored
   - Room data is cleared when sessions end
   - Temporary files are automatically cleaned up
   - Maximum audio duration: 60 seconds
   - Maximum file size: 10MB

5. **Rate Limiting**
   - API endpoints are rate-limited
   - Default: 100 requests per 15 minutes per IP
   - Configurable in server.js
   - Prevents abuse and DoS attacks

### System Maintenance

1. **Temporary Files**
   - Located in the `temp` directory
   - Automatically cleaned up after processing
   - Manual cleanup available: `npm run cleanup`
   - Monitor disk usage in production

2. **Memory Management**
   - Monitor memory usage with multiple concurrent users
   - Audio processing is memory-intensive
   - Consider server capacity when scaling

3. **Network Configuration**
   - Ensure WebSocket ports are open
   - Configure reverse proxy properly if used
   - Set appropriate timeouts for long connections

4. **Logging**
   - Development mode logs:
     * Server operations (startup, shutdown)
     * Connection events (connects, disconnects)
     * Room management (creation, deletion)
     * Audio processing details
     * Error details
   - Production mode logs:
     * Critical errors only
     * Connection failures
     * Processing errors
   - Log Retention:
     * Logs are written to console only
     * No persistent log files are created
     * Use system logging (e.g., systemd, pm2) for persistence
   - Sensitive Data:
     * No audio content is logged
     * No conversation content is logged
     * No user identifiable information is stored
     * Room IDs and technical details only

### Troubleshooting

Common issues and solutions:

1. **Server won't start**
   - Check if all required environment variables are set
   - Verify FFmpeg is installed: `which ffmpeg`
   - Ensure the port is not in use: `lsof -i :3000`
   - Check temp directory permissions

2. **Mobile app can't connect**
   - Verify APP_SECRET is properly set
   - Check ALLOWED_ORIGINS includes your domain
   - Ensure your domain has valid HTTPS
   - Verify time synchronization between app and server

3. **CORS errors**
   - Add your domain to ALLOWED_ORIGINS
   - Check for typos in domain names
   - Verify protocol (http/https) matches
   - Check browser console for specific error messages

4. **Audio processing issues**
   - Verify FFmpeg installation and permissions
   - Check available disk space
   - Monitor server memory usage
   - Verify OpenAI API key permissions

For additional help:
- Check the issues on GitHub
- Review server logs for errors

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details. This means:

- You can freely use, modify, and distribute this software
- If you distribute modified versions, you must:
  - Make your source code available
  - License it under the same GPLv3 terms
  - State your modifications
- No warranty is provided

## Author

Created by Joshua Covelli (absolem)

© 2024 Interpify. All rights reserved.

## Contributing

While this is primarily a personal project, bug reports and suggestions are welcome through the issues system. If you'd like to contribute:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request 