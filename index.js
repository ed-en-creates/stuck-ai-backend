const express = require('express');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 👻 1. Initialize Ghost Memory
const activeSessions = new Map();

// 🧠 2. The AI Intent Router (Groq JSON Mode)
async function analyzeUserMessage(message) {
    const prompt = `You are the brain of Stuck AI, an intelligent mobility and traffic assistant for commuters in Nigeria. 
    Analyze this message from the user: "${message}"
    
    Respond ONLY with a valid JSON object containing exactly 3 keys:
    1. "intent": MUST be exactly "CHAT", "ROUTE", or "OUT_OF_BOUNDS". 
       - Use "CHAT" for greetings, saying thank you, or general pleasantries.
       - Use "OUT_OF_BOUNDS" if the user asks about unrelated topics (e.g., personal advice, politics, programming, jokes).
       - Use "ROUTE" if the user mentions a location, city, or landmark they want to travel to.
    2. "destination": If the intent is ROUTE, write the full, clean location name adding ", Nigeria" to it (e.g., "Sapele, Delta State, Nigeria" or "Jabi Lake Mall, Abuja, Nigeria"). If not a ROUTE, leave as null.
    3. "reply": If intent is CHAT or OUT_OF_BOUNDS, write your highly conversational, empathetic, and human-like response here. Gently redirect OUT_OF_BOUNDS back to mobility. If intent is ROUTE, leave this null.`;

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
                response_format: { type: "json_object" },
                temperature: 0.1
            })
        });
        const data = await response.json();
        return JSON.parse(data.choices[0].message.content);
    } catch (error) {
        console.error('Groq Intent Error:', error);
        return { intent: 'CHAT', reply: "I'm having a slight brain freeze, give me a second!", destination: null };
    }
}

// 🗺️ 3. Helper: Geocoding with Nigeria Bias
async function geocodeAddress(address, userLat, userLng) {
    // filter=countrycode:ng locks search to Nigeria. bias=proximity searches near the user first.
    let url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(address)}&filter=countrycode:ng&limit=1&apiKey=${process.env.GEOAPIFY_API_KEY}`;
    
    if (userLat && userLng) {
        url += `&bias=proximity:${userLng},${userLat}`;
    }

    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.features && data.features.length > 0) {
            return {
                lat: data.features[0].properties.lat,
                lng: data.features[0].properties.lon,
                formattedName: data.features[0].properties.formatted
            };
        }
        return null;
    } catch (error) {
        console.error('Geocoding Error:', error);
        return null;
    }
}

// 🚗 4. Helper: Routing
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

// 💬 5. Helper: Groq Humanizer for Routes
async function generateRouteReply(destName, distance, time) {
    const prompt = `You are Stuck AI, a friendly mobility assistant. The user is driving to ${destName}. The trip is ${distance} kilometers and takes ${time} minutes in current traffic. Write a warm, human-like WhatsApp reply giving them this information. Do not sound robotic. Keep it brief.`;
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
        return `You're all set! The drive to ${destName} is about ${distance}km and should take ${time} minutes. Drive safe!`;
    }
}

// 🚦 6. Main WhatsApp Webhook 
app.post('/whatsapp', async (req, res) => {
    const fromNumber = req.body.From;
    const rawMessage = req.body.Body || '';
    const userMessage = rawMessage.trim();
    
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
    // EVENT B: User labels their location
    else if (session.state === 'AWAITING_LABEL') {
        const msgLower = userMessage.toLowerCase();
        if (msgLower.includes('work')) {
            session.work = session.currentLocation;
            replyMessage = "Alright, your Work address is now pinned! 🏢 I'll remember this. So, where are you headed to right now?";
        } else if (msgLower.includes('home')) {
            session.home = session.currentLocation;
            replyMessage = "Alright, your Home address is now pinned! 🏠 I've got it locked in. Where are you headed to right now?";
        } else {
            replyMessage = "Perfect, I'll just use this as a temporary starting point! 📍 Where are you headed to?";
        }
        session.state = 'READY_TO_ROUTE';
    } 
    // EVENT C: Smart Intent Engine (General Chat OR Routing)
    else {
        // We ask the AI to figure out what the user actually wants
        const analysis = await analyzeUserMessage(userMessage);

        if (analysis.intent === 'CHAT' || analysis.intent === 'OUT_OF_BOUNDS') {
            // The AI handles the conversation naturally. State remains the same.
            replyMessage = analysis.reply;
        } 
        else if (analysis.intent === 'ROUTE') {
            if (!session.currentLocation) {
                replyMessage = "I'd love to route you there, but I don't have your current location yet! Could you drop your live location pin for me?";
            } else {
                // Now we search for the specific destination the AI extracted
                let targetCoords = null;
                let destName = analysis.destination;

                if (userMessage.toLowerCase().includes('home') && session.home) {
                    targetCoords = session.home;
                    destName = "Home";
                } else if (userMessage.toLowerCase().includes('work') && session.work) {
                    targetCoords = session.work;
                    destName = "Work";
                } else {
                    targetCoords = await geocodeAddress(analysis.destination, session.currentLocation.lat, session.currentLocation.lng);
                }

                if (targetCoords) {
                    const route = await getRouteDetails(
                        session.currentLocation.lat, session.currentLocation.lng, 
                        targetCoords.lat, targetCoords.lng
                    );
                    
                    if (route) {
                        replyMessage = await generateRouteReply(destName, route.distanceKm, route.timeMinutes);
                        session.state = 'READY_TO_ROUTE'; // Keep them in the routing loop
                    } else {
                        replyMessage = `I found ${destName}, but I couldn't calculate a clear driving route there right now.`;
                    }
                } else {
                     replyMessage = "I couldn't quite pinpoint that exact destination on the map. Could you be a bit more specific?";
                }
            }
        }
    }

    const twiml = `<Response><Message>${replyMessage}</Message></Response>`;
    res.header('Content-Type', 'text/xml');
    res.status(200).send(twiml);
});

app.get('/', (req, res) => {
    res.send('🚀 Stuck AI - AI Intent Engine is live!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🟢 Stuck AI server is up and running on port ${PORT}`);
});
