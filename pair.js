import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();

// Ensure the session directory exists
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || `session`);

    // Remove existing session if present
    await removeFile(dirs);

    // Clean the phone number - remove any non-digit characters
    num = num.replace(/[^0-9]/g, '');

    // Validate the phone number using awesome-phonenumber
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ code: 'Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK, 84987654321 for Vietnam, etc.) without + or spaces.' });
        }
        return;
    }
    // Use the international number format (E.164, without '+')
    num = phone.getNumber('e164').replace('+', '');

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version, isLatest } = await fetchLatestBaileysVersion();
            let KnightBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows('Chrome'),
                markOnlineOnConnect: true,
                generateHighQualityLinkPreview: true,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            // Add message event listener for debugging
            KnightBot.ev.on('messages.upsert', async (m) => {
                console.log('📩 Message delivery update:', m);
            });

            KnightBot.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline, qr } = update;
                console.log('🔗 Connection update:', connection);

                if (connection === 'open') {
                    console.log("✅ Connected successfully!");
                    console.log("📱 Sending session file to user...");

                    try {
                        const sessionKnight = fs.readFileSync(dirs + '/creds.json');
                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');

                        // Wait for connection to stabilize
                        await delay(3000);

                        // Send session file to user
                        const fileMessage = await KnightBot.sendMessage(userJid, {
                            document: sessionKnight,
                            mimetype: 'application/json',
                            fileName: 'benzo-md-session.json',
                            caption: '🔐 *BENZO MD Session File*\n\nThis file contains your WhatsApp session credentials for BENZO MD Bot.'
                        });
                        console.log("📄 Session file sent successfully", fileMessage?.key?.id);

                        // Wait before sending next message
                        await delay(2000);

                        // Send welcome message with bot information
                        const welcomeMessage = await KnightBot.sendMessage(userJid, {
                            text: `🤖 *Welcome to BENZO MD Bot!* 🤖

✨ *Your session has been successfully configured!*

┌─✦ *Bot Information* ✦
│
├─ 🚀 *BENZO MD Bot*
├─ 📞 *Support: +2547590065xx*
├─ 🔧 *Version: 2.0*
├─ 👨‍💻 *Developer: Mr Amon*
│
└─ *Ready to serve you!*`
                        });
                        console.log("🤖 Welcome message sent successfully", welcomeMessage?.key?.id);

                        // Wait before sending warning message
                        await delay(2000);

                        // Send security warning message
                        const warningMessage = await KnightBot.sendMessage(userJid, {
                            text: `⚠️ *SECURITY ALERT* ⚠️

🔒 *KEEP YOUR SESSION FILE SAFE!*

❌ *DO NOT SHARE* this session file with anyone
❌ *DO NOT FORWARD* to other chats
❌ *DO NOT UPLOAD* to public platforms

This file contains your WhatsApp credentials and can be used to access your account.

*Your security is our priority!*`
                        });
                        console.log("⚠️ Security warning sent successfully", warningMessage?.key?.id);

                        // Wait before sending features message
                        await delay(2000);

                        // Send features and support information
                        const featuresMessage = await KnightBot.sendMessage(userJid, {
                            text: `🎯 *BENZO MD Features:*

• 🤖 Advanced AI Chat
• 🎵 Media Downloader
• 🔧 Utility Tools
• 🎮 Entertainment
• 📊 Information Tools
• ⚡ Fast Response

📞 *Support Contact:* +254759006509
📢 *Telegram:* @Techhub254_bot
🐙 *GitHub:* github.com/spark-x1

*Type .help to see all commands*`
                        });
                        console.log("🎯 Features message sent successfully", featuresMessage?.key?.id);

                        // Send final confirmation message
                        await delay(1000);
                        const confirmMessage = await KnightBot.sendMessage(userJid, {
                            text: `✅ *Setup Complete!*

Your BENZO MD Bot is now ready to use! Enjoy the features and remember to keep your session file secure.

Thank you for choosing BENZO MD! 🚀`
                        });
                        console.log("✅ Final confirmation sent");

                        // Clean up session after use
                        console.log("🧹 Cleaning up session in 5 seconds...");
                        await delay(5000);
                        removeFile(dirs);
                        console.log("✅ Session cleaned up successfully");
                        console.log("🎉 BENZO MD setup completed successfully!");

                    } catch (error) {
                        console.error("❌ Error sending messages:", error);
                        
                        // Try to send error notification to user
                        try {
                            const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                            await KnightBot.sendMessage(userJid, {
                                text: `❌ *Setup Error*\n\nThere was an issue completing your setup. Please try generating a new pair code.\n\nError: ${error.message}`
                            });
                        } catch (e) {
                            console.error("Couldn't send error message:", e);
                        }
                        
                        // Clean up session
                        removeFile(dirs);
                    }
                }

                if (isNewLogin) {
                    console.log("🔐 New login detected");
                }

                if (isOnline) {
                    console.log("📶 Client is online and ready");
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log("🔌 Connection closed, status:", statusCode);

                    if (statusCode === 401) {
                        console.log("❌ Logged out from WhatsApp. Need to generate new pair code.");
                    } else {
                        console.log("🔁 Connection closed — may restart...");
                    }
                }
            });

            if (!KnightBot.authState.creds.registered) {
                await delay(5000);
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    let code = await KnightBot.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!res.headersSent) {
                        console.log("📋 Pair code generated for:", num);
                        console.log("🔢 Code:", code);
                        await res.send({ code });
                    }
                } catch (error) {
                    console.error('❌ Error requesting pairing code:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ code: 'Failed to get pairing code. Please check your phone number and try again.' });
                    }
                }
            }

            KnightBot.ev.on('creds.update', saveCreds);

        } catch (err) {
            console.error('❌ Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable. Please try again later.' });
            }
        }
    }

    await initiateSession();
});

// Global uncaught exception handler
process.on('uncaughtException', (err) => {
    let e = String(err);
    if (e.includes("conflict")) return;
    if (e.includes("not-authorized")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    if (e.includes("Stream Errored")) return;
    if (e.includes("Stream Errored (restart required)")) return;
    if (e.includes("statusCode: 515")) return;
    if (e.includes("statusCode: 503")) return;
    console.log('Caught exception: ', err);
});

export default router;
