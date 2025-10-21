import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { 
    makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    makeCacheableSignalKeyStore, 
    Browsers, 
    jidNormalizedUser, 
    fetchLatestBaileysVersion,
    DisconnectReason
} from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();

// Enhanced file removal with better error handling
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
        return true;
    } catch (e) {
        console.error('Error removing file:', e);
        return false;
    }
}

// Session cleanup with retry mechanism
async function cleanupSession(dirs, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (fs.existsSync(dirs)) {
                removeFile(dirs);
                console.log("✅ Session cleaned up successfully");
                return true;
            }
            break;
        } catch (error) {
            console.warn(`⚠️ Cleanup attempt ${attempt} failed:`, error.message);
            if (attempt < maxRetries) {
                await delay(1000 * attempt);
            }
        }
    }
    return false;
}

// Validate phone number
function validatePhoneNumber(num) {
    const cleanedNum = num.replace(/[^0-9]/g, '');
    const phone = pn('+' + cleanedNum);
    
    if (!phone.isValid()) {
        throw new Error('Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK, 84987654321 for Vietnam, etc.) without + or spaces.');
    }
    
    return phone.getNumber('e164').replace('+', '');
}

// Send session files to user
async function sendSessionFiles(KnightBot, userJid, dirs) {
    try {
        const sessionKnight = fs.readFileSync(dirs + '/creds.json');

        // Send session file
        await KnightBot.sendMessage(userJid, {
            document: sessionKnight,
            mimetype: 'application/json',
            fileName: 'creds.json'
        });
        console.log("📄 Session file sent successfully");

        // Send video thumbnail with caption
        await KnightBot.sendMessage(userJid, {
            image: { url: 'https://img.youtube.com/vi/-oz_u1iMgf8/maxresdefault.jpg' },
            caption: `🎬 *KnightBot MD V2.0 Full Setup Guide!*\n\n🚀 Bug Fixes + New Commands + Fast AI Chat\n📺 Watch Now: https://youtu.be/-oz_u1iMgf8`
        });
        console.log("🎬 Video guide sent successfully");

        // Send warning message
        await KnightBot.sendMessage(userJid, {
            text: `⚠️ *SECURITY WARNING* ⚠️\n\nDo not share this file with anybody!\n\nThis file contains your WhatsApp session credentials.\n\n┌┤✑ Thanks for using Knight Bot\n│└────────────┈ ⳹\n│©2024 Mr Unique Hacker\n└─────────────────┈ ⳹`
        });
        console.log("⚠️ Warning message sent successfully");

        return true;
    } catch (error) {
        console.error("❌ Error sending messages:", error);
        throw error;
    }
}

router.get('/', async (req, res) => {
    // Set timeout for the request
    req.setTimeout(120000); // 2 minutes
    
    let num = req.query.number;
    if (!num) {
        return res.status(400).send({ 
            error: 'Phone number is required. Use ?number=1234567890' 
        });
    }

    let dirs = './' + (num || `session`);

    try {
        // Validate and clean phone number
        num = validatePhoneNumber(num);
    } catch (error) {
        return res.status(400).send({ error: error.message });
    }

    // Remove existing session if present
    await cleanupSession(dirs);

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);
        let KnightBot = null;

        try {
            const { version } = await fetchLatestBaileysVersion();
            
            KnightBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "error" }).child({ level: "error" }),
                browser: Browsers.ubuntu('Chrome'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: true,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 10000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
                emitOwnEvents: true,
                fireInitQueries: true,
                mobile: false
            });

            KnightBot.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr, isNewLogin } = update;

                if (qr) {
                    console.log("📱 QR Code received");
                }

                if (connection === 'open') {
                    console.log("✅ Connected successfully!");
                    
                    try {
                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                        
                        // Send session files
                        await sendSessionFiles(KnightBot, userJid, dirs);
                        
                        // Wait a bit longer for delivery confirmation
                        await delay(5000);
                        
                        // Clean up session
                        await cleanupSession(dirs);
                        
                        console.log("🎉 Process completed successfully!");
                        
                    } catch (error) {
                        console.error("❌ Error in session process:", error);
                        // Still attempt cleanup
                        await cleanupSession(dirs);
                    }
                }

                if (isNewLogin) {
                    console.log("🔐 New login detected");
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const restartRequired = lastDisconnect?.error?.output?.payload?.restartRequired;
                    
                    console.log(`🔌 Connection closed. Status: ${statusCode}`);

                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        console.log("❌ Logged out from WhatsApp. Need new pairing.");
                        await cleanupSession(dirs);
                        return;
                    }

                    if (statusCode === DisconnectReason.restartRequired || restartRequired) {
                        console.log("🔄 Restart required, reinitializing...");
                        await delay(5000);
                        initiateSession();
                        return;
                    }

                    if (statusCode === DisconnectReason.connectionLost) {
                        console.log("🔁 Connection lost, attempting reconnect...");
                        await delay(3000);
                        initiateSession();
                        return;
                    }

                    // For other close reasons, attempt reconnect
                    console.log("🔁 Attempting to reconnect...");
                    await delay(5000);
                    initiateSession();
                }
            });

            KnightBot.ev.on('creds.update', saveCreds);

            // Handle pairing code request
            if (!KnightBot.authState.creds.registered) {
                await delay(2000);
                
                try {
                    let code = await KnightBot.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    
                    console.log(`🔢 Pairing code generated for: ${num}`);
                    
                    if (!res.headersSent) {
                        res.send({ 
                            number: num,
                            code: code,
                            message: 'Use this code to pair your device in WhatsApp'
                        });
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ 
                            error: 'Failed to get pairing code. Please check your phone number and try again.',
                            details: error.message 
                        });
                    }
                    await cleanupSession(dirs);
                }
            }

        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) {
                res.status(500).send({ 
                    error: 'Failed to initialize session',
                    details: err.message 
                });
            }
            await cleanupSession(dirs);
        }
    }

    await initiateSession();
});

// Enhanced global error handlers
process.on('uncaughtException', (err) => {
    const errorMsg = String(err);
    
    // Ignore these common errors
    const ignorableErrors = [
        "conflict",
        "not-authorized", 
        "Socket connection timeout",
        "rate-overlimit",
        "Connection Closed",
        "Timed Out",
        "Value not found",
        "Stream Errored",
        "statusCode: 515",
        "statusCode: 503",
        "ECONNREFUSED",
        "ECONNRESET"
    ];

    if (ignorableErrors.some(ignore => errorMsg.includes(ignore))) {
        return;
    }
    
    console.log('🚨 Uncaught Exception: ', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown handler
process.on('SIGINT', async () => {
    console.log('🛑 Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 Received SIGTERM, shutting down...');
    process.exit(0);
});

export default router;
