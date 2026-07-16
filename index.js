const express = require('express');
const { OpenAI } = require('openai');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// 1. Initialize Groq AI pointing to their fast API endpoint
const groqAI = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1', 
});

// 2. Initialize Supabase Database
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Parse incoming URL-encoded and JSON payloads
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 3. The main WhatsApp Webhook endpoint
app.post('/whatsapp', async (req, res) => {
    const fromNumber = req.body.From || ''; 
    const rawMessage = req.body.Body || '';
    const userMessage = rawMessage.trim();

    // Support BOTH lowercase and uppercase coordinate parameters sent by Twilio
    const incomingLatitude = req.body.Latitude || req.body.latitude || null;
    const incomingLongitude = req.body.Longitude || req.body.longitude || null;

    console.log(`📩 Incoming payload from ${fromNumber}. Text: "${userMessage}"`);
    console.log(`📍 Received Coordinates: Lat: ${incomingLatitude}, Lng: ${incomingLongitude}`);

    // FLOW A: User drops an actual location pin
    if (incomingLatitude && incomingLongitude) {
        console.log(`💾 Attempting to save GPS location pin to Supabase: ${incomingLatitude}, ${incomingLongitude}`);
        
        const { error } = await supabase.from('user_routes').insert([{
            phone_number: fromNumber,
            location_type: 'home', // Saves as home by default for now
            latitude: String(incomingLatitude),
            longitude: String(incomingLongitude),
            address: 'Shared WhatsApp Pin'
        }]);

        let confirmationText = "Awesome! I've pinned this location as your Home address. Next time you ask for traffic, I'll use this spot!";
        if (error) {
            console.error("❌ Supabase Save Error:", error);
            confirmationText = "I received your location pin, but had trouble saving it to my memory map. Try again!";
        }

        const twiml = `<Response><Message>${confirmationText}</Message></Response>`;
        res.header('Content-Type', 'text/xml');
        return res.status(200).send(twiml);
    }

    // FLOW B: Guard against empty messages (Only triggers if they sent NO text AND NO coordinates)
    if (!userMessage && !incomingLatitude) {
        console.log(`⚠️ Empty text and no coordinates detected.`);
        const emptyResponse = `<Response><Message>Send me a text or drop a location pin to get started!</Message></Response>`;
        res.header('Content-Type', 'text/xml');
        return res.status(200).send(emptyResponse);
    }

    // FLOW C: Standard conversational traffic message
    try {
        // Fetch saved user context to help Groq remember their pinned locations
        const { data: savedRoutes } = await supabase
            .from('user_routes')
            .select('location_type, address, latitude, longitude')
            .eq('phone_number', fromNumber);

        let memoryPrompt = "You don't know their saved routes yet.";
        if (savedRoutes && savedRoutes.length > 0) {
            memoryPrompt = "You know the following about them: " + savedRoutes.map(r => `${r.location_type}: ${r.address || (r.latitude + ',' + r.longitude)}`).join(', ');
        }

        // Send contextual prompt to Groq
        const response = await groqAI.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [
                { 
                    role: "system", 
                    content: `You are Stuck AI, a warm, helpful mobility assistant for commuters in Africa. Keep responses under two sentences. ${memoryPrompt}. If they ask you to save a location like 'Save my office as Lekki', instruct them to drop a location pin or tell you clearly.` 
                },
                { role: "user", content: userMessage }
            ],
            max_tokens: 120,
            temperature: 0.7
        });

        const aiReply = response.choices[0].message.content.trim();
        const twimlResponse = `<Response><Message>${aiReply}</Message></Response>`;

        res.header('Content-Type', 'text/xml');
        return res.status(200).send(twimlResponse);

    } catch (error) {
        console.error("❌ Process Error:", error);
        const errorResponse = `<Response><Message>Oops! Brain traffic jam. Send your text again!</Message></Response>`;
        res.header('Content-Type', 'text/xml');
        return res.status(200).send(errorResponse);
    }
});

// Basic server home route for health monitoring
app.get('/', (req, res) => {
    res.send('🚀 Stuck AI MVP with Memory Engine is live!');
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🟢 Stuck AI server is up and running on port ${PORT}`);
});
