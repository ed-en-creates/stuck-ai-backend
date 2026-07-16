const express = require('express');
const { OpenAI } = require('openai');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Initialize Groq AI
const groqAI = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1', 
});

// Initialize Supabase Database
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post('/whatsapp', async (req, res) => {
    const fromNumber = req.body.From || ''; // User's WhatsApp number
    const rawMessage = req.body.Body || '';
    const userMessage = rawMessage.trim();

    // Catch WhatsApp Location Pin coordinates if provided
    const incomingLatitude = req.body.Latitude || null;
    const incomingLongitude = req.body.Longitude || null;

    console.log(`📩 Incoming message from ${fromNumber}`);

    // FLOW A: User drops an actual location pin
    if (incomingLatitude && incomingLongitude) {
        console.log(`📍 User shared a GPS location pin: ${incomingLatitude}, ${incomingLongitude}`);
        
        // Save it to Supabase as their current home base for simplicity
        const { error } = await supabase.from('user_routes').insert([{
            phone_number: fromNumber,
            location_type: 'home',
            latitude: incomingLatitude,
            longitude: incomingLongitude,
            address: 'Shared WhatsApp Pin'
        }]);

        let confirmationText = "Awesome! I've pinned this location as your Home address. Next time you ask for traffic, I will use this spot!";
        if (error) {
            console.error("Supabase Save Error:", error);
            confirmationText = "I received your location pin, but had trouble saving it to my memory map. Try again!";
        }

        const twiml = `<Response><Message>${confirmationText}</Message></Response>`;
        res.header('Content-Type', 'text/xml');
        return res.status(200).send(twiml);
    }

    // Guard: If message is empty and no location pin was dropped
    if (!userMessage) {
        const emptyResponse = `<Response><Message>Send me a text or drop a location pin to get started!</Message></Response>`;
        res.header('Content-Type', 'text/xml');
        return res.status(200).send(emptyResponse);
    }

    try {
        // Fetch saved user context to help the AI remember them
        const { data: savedRoutes } = await supabase
            .from('user_routes')
            .select('location_type, address')
            .eq('phone_number', fromNumber);

        let memoryPrompt = "You don't know their saved routes yet.";
        if (savedRoutes && savedRoutes.length > 0) {
            memoryPrompt = "You know the following about them: " + savedRoutes.map(r => `${r.location_type}: ${r.address}`).join(', ');
        }

        // Make the call to Groq
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

app.get('/', (req, res) => {
    res.send('🚀 Stuck AI MVP with Memory Engine is live!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🟢 Stuck AI server is up and running on port ${PORT}`);
});
