# Interpify

A real-time translation platform that enables seamless communication across language barriers. Interpify uses advanced AI technology to provide instant translation and voice conversion, allowing people speaking different languages to communicate naturally.

## Features

- Real-time voice translation between multiple languages
- Push-to-talk functionality with space bar support
- Dark/Light theme support
- Mobile-friendly interface
- Support for 10 major languages including English, Spanish, French, German, Italian, Portuguese, Russian, Japanese, Korean, and Chinese
- Instant audio playback of translations
- Chat-like interface showing both original and translated messages

## Privacy & Security

Interpify is designed with privacy in mind, implementing several features to protect user data:

- **Disposable Rooms**: All chat rooms are temporary and automatically disposed of when users leave. No conversation history is stored on the server.
- **Automatic Data Cleanup**: 
  - Audio files are immediately deleted after processing
  - Temporary files are automatically cleaned up
  - No conversation logs or transcripts are retained
  - Room data is cleared from memory when sessions end
- **Local Processing**: All audio processing happens in real-time and is never stored permanently
- **Maximum Duration**: Audio clips are limited to 60 seconds for security
- **File Size Limits**: A 10MB file size limit is enforced to prevent abuse

These features ensure that your conversations remain private and temporary, with no data persistence beyond the active session.

## Technologies Used

- Node.js with Express
- Socket.IO for real-time communication
- OpenAI's Whisper for speech-to-text
- OpenAI's GPT-4 for translation
- OpenAI's TTS for text-to-speech
- WebRTC for audio capture
- FFmpeg for audio processing

## Prerequisites

- Node.js (v16 or higher)
- npm (v8 or higher)
- FFmpeg installed on your system
  - Ubuntu/Debian: `sudo apt-get install ffmpeg`
  - macOS: `brew install ffmpeg`
  - Windows: Download from [FFmpeg website](https://ffmpeg.org/download.html)
- OpenAI API key

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/interpify.git
cd interpify
```

2. Install dependencies:
```bash
npm install
```

3. Copy the example environment file and update it with your values:
```bash
cp .env.example .env
```

4. Edit `.env` and add your OpenAI API key:
```
OPENAI_API_KEY=your_api_key_here
```

## Usage

Start the server:
```bash
npm start
```

For development with auto-restart:
```bash
npm run dev
```

Access the application at `http://localhost:3000`

## Development

- The `temp` directory is used for temporary audio files and is automatically cleaned up
- Run `npm run cleanup` to manually clean up old temporary files
- Check the console for detailed logs during development

## Security Notes

- Never commit your `.env` file
- Keep your OpenAI API key secure
- The temporary directory is automatically cleaned every 24 hours
- Audio files are deleted immediately after processing

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