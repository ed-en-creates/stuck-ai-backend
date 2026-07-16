const express = require('express');
const { OpenAI } = require('openai');

const app = express();

// 1. Initialize Groq using the official OpenAI SDK
const groqAI = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1', 
});

// Parse incoming URL-encoded and JSON payloads
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 2. The main WhatsApp Webhook endpoint
app.post('/whatsapp', async (req, res) => {
    // Safely grab the incoming message and trim extra spaces
    const rawMessage = req.body.Body || '';
    const userMessage = rawMessage.trim();
    
    console.log(`📩 Incoming message from ${req.body.From || 'Unknown'}: "${userMessage}"`);

    // Guard: If the message is empty (e.g., user sent an image, document, or sticker)
    if (!userMessage) {
        console.log(`⚠️ Received empty text body. Skipping API call.`);
        const emptyResponse = `
            <Response>
                <Message>I received your message, but I can only read text right now! Ask me a traffic question.</Message>
            </Response>
        `;
        res.header('Content-Type', 'text/xml');
        return res.status(200).send(emptyResponse);
    }

    try {
        console.log(`🚀 Forwarding message to Groq (llama-3.1-8b-instant)...`);
        
        // 3. Make the API call to Groq
        const response = await groqAI.chat.completions.create({
            model: "llama-3.1-8b-instant", // High-speed, ultra-stable production model ID on Groq
            messages: [
                { 
                    role: "system", 
                    content: "You are Stuck AI, a warm, helpful mobility assistant for commuters in Africa. Keep your responses engaging, conversational, and under two short sentences. You do not have access to real-time maps yet, so if asked about specific routes, politely mention you are preparing for launch." 
                },
                { role: "user", content: userMessage }
            ],
            max_tokens: 120, // Enough headroom for a friendly 2-sentence response
            temperature: 0.7 // Balanced between creative/conversational and structured
        });

        const aiReply = response.choices[0].message.content.trim();
        console.log(`✅ Groq AI successfully generated response: "${aiReply}"`);

        // 4. Send the TwiML XML response back to Twilio
        const twimlResponse = `
            <Response>
                <Message>${aiReply}</Message>
            </Response>
        `;

        res.header('Content-Type', 'text/xml');
        return res.status(200).send(twimlResponse);

    } catch (error) {
        // Log the exact details of the error to your Render dashboard
        console.error("❌ Groq API Error:", error.message || error);
        
        const errorResponse = `
            <Response>
                <Message>Oops! My brain hit a temporary bottleneck. Try sending your text again in a few seconds!</Message>
            </Response>
        `;
        res.header('Content-Type', 'text/xml');
        return res.status(200).send(errorResponse);
    }
});

// 5. Basic server home route for health monitoring
app.get('/', (req, res) => {
    res.send('🚀 Stuck AI MVP is active and listening to Groq!');
});

// 6. Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🟢 Stuck AI server is up and running on port ${PORT}`);
});
