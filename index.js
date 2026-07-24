const express = require('express');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 👻 1. Initialize Ghost Memory (RAM Storage)
const activeSessions = new Map();

// 🗺️ 2. Helper: Geocoding (Converts text to Coordinates)
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

// 🚗 3. Helper: Routing (Calculates distance and time)
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

// 💬 4. Helper: Groq Humanizer (Using Native Fetch)
async function generateHumanReply(prompt) {
    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [{ role: "system", content: prompt }],
                max_tokens: 150,
                temperature: 0.7
            })
        });
        const data = await response.json();
        return data.choices[0].message.content.trim();
    } catch (error) {
        console.error('Groq Error:', error);
        return "Got it! Traffic looks clear, you're good to go.";
    }
}

// 🚦 5. Main WhatsApp Webhook 
app.post('/whatsapp', async (req, res) => {
    const fromNumber = req.body.From;
    const rawMessage = req.body.Body || '';
    const userMessage = rawMessage.trim().toLowerCase();
    
    const lat = req.body.Latitude || req.body.latitude;
    const lng = req.body.Longitude || req.body.longitude;

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

    // EVENT A: User sends a Location Pin
    if (lat && lng) {
        session.currentLocation = { lat, lng };
        session.state = 'AWAITING_LABEL';
        replyMessage = "Got it! 📍 Do you want me to pin this as your Home, Work, or just a temporary starting point?";
    } 
    // EVENT B: New User says Hello/Start
    else if (session.state === 'START' || userMessage.includes('hello') || userMessage.includes('hi') || userMessage.includes('start')) {
        replyMessage = "Hey there! 👋 Welcome to Stuck AI. Where are you currently, and where are you headed to? If you don't mind, drop your live location pin so I can see exactly where we're starting from!";
        session.state = 'AWAITING_LOCATION';
    } 
    // EVENT C: User labels their location
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
    // EVENT D: User gives a destination
    else if (session.state === 'READY_TO_ROUTE') {
        let targetCoords = null;
        let destName = userMessage;

        if (userMessage.includes('home') && session.home) {
            targetCoords = session.home;
            destName = "Home";
        } else if (userMessage.includes('work') && session.work) {
            targetCoords = session.work;
            destName = "Work";
        } else {
            targetCoords = await geocodeAddress(userMessage);
        }

        if (targetCoords && session.currentLocation) {
            const route = await getRouteDetails(
                session.currentLocation.lat, session.currentLocation.lng, 
                targetCoords.lat, targetCoords.lng
            );
            
            if (route) {
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

    const twiml = `<Response><Message>${replyMessage}</Message></Response>`;
    res.header('Content-Type', 'text/xml');
    res.status(200).send(twiml);
});

app.get('/', (req, res) => {
    res.send('🚀 Stuck AI Dynamic Conversational Engine is live!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🟢 Stuck AI server is up and running on port ${PORT}`);
});
