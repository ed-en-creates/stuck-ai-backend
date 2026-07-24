require('dotenv').config();
const express = require('express');
const { OpenAI } = require('openai');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 🧠 1. Initialize Groq AI (The Brain)
const groqAI = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1', 
});

// 👻 2. Initialize Ghost Memory (RAM Storage)
// This stores locations only while the server is running. No databases, zero privacy risk.
const activeSessions = new Map();

// 🗺️ 3. Helper: Geocoding (Converts text like "Jabi Lake Mall" to Coordinates)
async function geocodeAddress(address) {
    const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(address)}&limit=1&apiKey=${process.env.GEOAPIFY_API_KEY}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.features && data.features.length > 0) {
            return {
                lat: data.features[0].properties.lat,
                lng: data.features[0].properties.lon
            };
        }
        return null;
    } catch (error) {
        console.error('Geocoding Error:', error);
        return null;
    }
}

// 🚗 4. Helper: Routing (Calculates distance and time)
async function getRouteDetails(startLat, startLon, endLat, endLon) {
    const url = `https://api.geoapify.com/v1/routing?waypoints=${startLat},${startLon}|${endLat},${endLon}&mode=drive&apiKey=${process.env.GEOAPIFY_API_KEY}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.features && data.features.length > 0) {
            const props = data.features[0].properties;
            return {
                distanceKm: (props.distance / 1000).toFixed(1),
                timeMinutes: Math.round(props.time / 60)
            };
        }
        return null;
    } catch (error) {
        console.error('Routing Error:', error);
        return null;
    }
}

// 💬 5. Helper: Groq Humanizer (Makes the output sound natural)
async function generateHumanReply(prompt) {
    try {
        const response = await groqAI.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [{ role: "system", content: prompt }],
            max_tokens: 150,
            temperature: 0.7
        });
        return response.choices[0].message.content.trim();
    } catch (error) {
        return "Got it! Traffic looks clear, you're good to go.";
    }
}

// 🚦 6. Main WhatsApp Webhook (The Conversation State Machine)
app.post('/whatsapp', async (req, res) => {
    const fromNumber = req.body.From;
    const rawMessage = req.body.Body || '';
    const userMessage = rawMessage.trim().toLowerCase();
    
    // Extract GPS coordinates if user sent a Live Location pin
    const lat = req.body.Latitude || req.body.latitude;
    const lng = req.body.Longitude || req.body.longitude;

    // Create a Ghost Memory session for new users
    if (!activeSessions.has(fromNumber)) {
        activeSessions.set(fromNumber, { 
            state: 'START', 
            home: null, 
            work: null, 
            currentLocation: null 
        });
    }
    const session = activeSessions.get(fromNumber);
    let replyMessage = '';

    // --- CONVERSATION LOGIC ---

    // EVENT A: User sends a Location Pin
    if (lat && lng) {
        session.currentLocation = { lat, lng };
        session.state = 'AWAITING_LABEL';
        replyMessage = "Got it! 📍 Do you want me to pin this as your Home, Work, or just a temporary starting point?";
    } 
    
    // EVENT B: New User says Hello/Start
    else if (session.state === 'START' || userMessage.includes('hello') || userMessage.includes('hi')) {
        replyMessage = "Hey there! 👋 Welcome to Stuck AI. Where are you currently, and where are you headed to? If you don't mind, drop your live location pin so I can see exactly where we're starting from!";
        session.state = 'AWAITING_LOCATION';
    } 
    
    // EVENT C: User labels their location (Work/Home)
    else if (session.state === 'AWAITING_LABEL') {
        if (userMessage.includes('work')) {
            session.work = session.currentLocation;
            replyMessage = "Alright, your Work address is now pinned! 🏢 I'll remember this. So, where are you headed to right now?";
            session.state = 'READY_TO_ROUTE';
        } else if (userMessage.includes('home')) {
            session.home = session.currentLocation;
            replyMessage = "Alright, your Home address is now pinned! 🏠 I've got it locked in. Where are you headed to right now?";
            session.state = 'READY_TO_ROUTE';
        } else {
            replyMessage = "Perfect, I'll just use this as a temporary starting point! 📍 Where are you headed to?";
            session.state = 'READY_TO_ROUTE';
        }
    } 
    
    // EVENT D: User gives a destination (The Routing Engine)
    else if (session.state === 'READY_TO_ROUTE') {
        let targetCoords = null;
        let destName = userMessage;

        // Check if they are heading to a saved place
        if (userMessage.includes('home') && session.home) {
            targetCoords = session.home;
            destName = "Home";
        } else if (userMessage.includes('work') && session.work) {
            targetCoords = session.work;
            destName = "Work";
        } else {
            // If it's a new place (e.g., "Jabi Lake Mall"), look it up dynamically!
            targetCoords = await geocodeAddress(userMessage);
        }

        if (targetCoords && session.currentLocation) {
            const route = await getRouteDetails(
                session.currentLocation.lat, session.currentLocation.lng, 
                targetCoords.lat, targetCoords.lng
            );
            
            if (route) {
                // Pass the raw data to Groq so it sounds like a human wrote it
                const prompt = `You are Stuck AI, a friendly mobility assistant. The user is driving to ${destName}. The trip is ${route.distanceKm} kilometers and takes ${route.timeMinutes} minutes in current traffic. Write a warm, human-like WhatsApp reply giving them this information. Do not sound robotic. Keep it brief.`;
                replyMessage = await generateHumanReply(prompt);
            } else {
                replyMessage = "I tried to map that out, but I couldn't find a clear route. Could you try typing the destination name a bit differently?";
            }
        } else if (!session.currentLocation) {
             replyMessage = "I'd love to route you there, but I don't know where you are right now! Could you drop your live location pin for me?";
        } else {
             replyMessage = "I couldn't quite pinpoint that destination. Could you be a bit more specific (like 'Ring Road, Benin City')?";
        }
    } 
    
    // EVENT E: Fallback Conversation
    else {
        const prompt = `You are Stuck AI, a friendly mobility assistant. The user just said: "${userMessage}". Give a very brief, warm reply. If they need routing, gently remind them to drop a location pin.`;
        replyMessage = await generateHumanReply(prompt);
    }

    // Send the final Twilio XML response
    const twiml = `<Response><Message>${replyMessage}</Message></Response>`;
    res.header('Content-Type', 'text/xml');
    res.status(200).send(twiml);
});

// Server Health Check
app.get('/', (req, res) => {
    res.send('🚀 Stuck AI Dynamic Conversational Engine is live!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🟢 Stuck AI server is up and running on port ${PORT}`);
});
